// Pay: read it from postings, normalize everything to US dollars per hour, and estimate it
// for postings that don't say.
//
// A job's `pay` is one of:
//   { basis: "posted",   min, max, period, note }            amounts the employer published
//   { basis: "unpaid",   note }                               the posting says it is unpaid
//   { basis: "estimate", min, max, note, confidence, sources? }
// min/max are always hourly. A full-time week is 40 hours.

const HOURS = { hour: 1, week: 40, month: 2080 / 12, year: 2080 };
const round = (n) => Math.round(n * 100) / 100;

export function toHourly(value, period) {
  return value / (HOURS[period] || 1);
}

// Pick the period when a posting gives only a number. Intern pay is almost always hourly
// (under $300), monthly ($1.5k–$20k) or a full-year salary.
export function guessPeriod(value) {
  if (value <= 300) return "hour";
  if (value <= 20000) return "month";
  return "year";
}

function plausible(min, max) {
  return min >= 8 && max <= 250 && max >= min;
}

export function posted(min, max, period, note = "") {
  period ||= guessPeriod(max || min);
  const lo = toHourly(min || max, period), hi = toHourly(max || min, period);
  if (!plausible(lo, hi)) return null;
  return { basis: "posted", min: round(lo), max: round(hi), period, note };
}

const PERIOD_WORDS = [
  [/^(?:\s*(?:usd|us\$))?\s*(?:\/|per|an|a)\s*(?:hour|hr)\b|^\s*hourly\b/i, "hour"],
  [/^(?:\s*(?:usd|us\$))?\s*(?:\/|per|a)\s*(?:week|wk)\b|^\s*weekly\b/i, "week"],
  [/^(?:\s*(?:usd|us\$))?\s*(?:\/|per|a)\s*(?:month|mo)\b|^\s*monthly\b/i, "month"],
  [/^(?:\s*(?:usd|us\$))?\s*(?:\/|per|a|an)\s*(?:year|yr|annum)\b|^\s*(?:annually|annual|yearly)\b/i, "year"],
];
const PAY_CONTEXT = /\b(pay|salary|compensation|wage|hourly|rate|base|stipend|earn|range)\b/i;
const NOT_PAY = /\b(housing|relocation|bonus|raised|funding|revenue|valuation|million|billion|series [a-f]|equipment|reimburse|tuition|401k|donat)/i;
const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k)?(?:\s*(?:-|–|—|to)\s*\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k)?)?/gi;

export function htmlToText(html = "") {
  // some feeds send escaped markup ("&lt;p&gt;"): decode it first so the tags get stripped too
  if (/&lt;\/?[a-z]/i.test(html)) html = html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#36;|&dollar;/g, "$").replace(/&ndash;|&#8211;/g, "–").replace(/&mdash;|&#8212;/g, "—")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ");
}

// Read pay out of free text such as "The hourly rate for this role is $42.00 - $48.00 USD".
export function parsePay(text = "") {
  if (!text) return null;
  const t = text.length > 400 && /</.test(text) ? htmlToText(text) : text;
  if (/\bunpaid\b|without (?:pay|compensation)|for academic credit only|volunteer (?:role|position|internship)/i.test(t) && !/\$\s?\d/.test(t)) {
    return { basis: "unpaid", note: "The posting says this internship is unpaid." };
  }
  for (const m of t.matchAll(MONEY)) {
    const before = t.slice(Math.max(0, m.index - 220), m.index);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (!PAY_CONTEXT.test(before + " " + after.slice(0, 20)) || NOT_PAY.test(before.slice(-30).split(/[.;!?]/).pop() + " " + after.slice(0, 25).split(/[.;!?]/)[0])) continue;
    const num = (whole, frac, k) => (Number(whole.replace(/,/g, "")) + (frac ? Number("0." + frac) : 0)) * (k ? 1000 : 1);
    const a = num(m[1], m[2], m[3] || m[6]);
    const b = m[4] ? num(m[4], m[5], m[6]) : a;
    const period = PERIOD_WORDS.find(([re]) => re.test(after))?.[1] || (/hourly|per hour|an hour/i.test(before.slice(-120)) ? "hour" : null);
    const p = posted(Math.min(a, b), Math.max(a, b), period, "Pay range published in the job posting.");
    if (p) return p;
  }
  return null;
}

/* ---------------- estimates ---------------- */

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]; };
const squash = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const mid = (j) => (j.pay.min + j.pay.max) / 2;

// Fill `pay` for every job that has none, preferring evidence closest to the job:
// the same company's other postings, then outside research on that company, then
// similar internships in the same state, then similar internships nationwide.
export function applyEstimates(jobs, research = {}, stateNames = {}) {
  const withPay = jobs.filter((j) => j.pay?.basis === "posted");
  const group = (keyFn) => {
    const m = new Map();
    for (const j of withPay) { const k = keyFn(j); if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(mid(j)); }
    return m;
  };
  const byCoCat = group((j) => squash(j.company) + "|" + j.category);
  const byCo = group((j) => squash(j.company));
  const byCatState = new Map();
  for (const j of withPay) for (const s of j.states) { const k = j.category + "|" + s; (byCatState.get(k) || byCatState.set(k, []).get(k)).push(mid(j)); }
  const byCat = group((j) => j.category);
  const all = withPay.map(mid);

  const spread = (xs, note, confidence, extra = {}) => {
    const lo = xs.length >= 4 ? pct(xs, 0.25) : Math.min(...xs);
    const hi = xs.length >= 4 ? pct(xs, 0.75) : Math.max(...xs);
    return { basis: "estimate", min: round(lo), max: round(hi), typical: round(median(xs)), note, confidence, ...extra };
  };
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  for (const j of jobs) {
    if (j.pay) continue;
    const co = squash(j.company);
    const a = byCoCat.get(co + "|" + j.category);
    if (a?.length) { j.pay = spread(a, `Based on ${plural(a.length, "other " + j.company + " " + j.category + " internship")} with published pay.`, "high"); continue; }
    const b = byCo.get(co);
    if (b?.length) { j.pay = spread(b, `Based on ${plural(b.length, "other " + j.company + " internship")} with published pay.`, "high"); continue; }
    const r = research[co];
    if (r?.hourlyMin) {
      j.pay = { basis: "estimate", min: round(r.hourlyMin), max: round(r.hourlyMax || r.hourlyMin), typical: round(((r.hourlyMin + (r.hourlyMax || r.hourlyMin)) / 2)), note: r.summary || `From public reports of ${j.company} intern pay.`, confidence: "medium", sources: r.sources || [] };
      continue;
    }
    const st = j.states.map((s) => [s, byCatState.get(j.category + "|" + s)]).filter(([, xs]) => xs?.length >= 5).sort((x, y) => y[1].length - x[1].length)[0];
    if (st) { j.pay = spread(st[1], `Typical for ${j.category} internships in ${stateNames[st[0]] || st[0]} (${st[1].length} postings with published pay).`, "low"); continue; }
    const c = byCat.get(j.category);
    if (c?.length >= 5) { j.pay = spread(c, `Typical for ${j.category} internships nationwide (${c.length} postings with published pay).`, "low"); continue; }
    if (all.length >= 5) j.pay = spread(all, `Typical for US internships overall (${all.length} postings with published pay).`, "low");
  }
  return jobs;
}
