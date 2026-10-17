// When does an internship run? Reads the title and the job description for the term,
// start and end dates, length, weekly hours, and whether it is a co-op, part-time,
// year-round or contract role. Everything it reports carries the sentence it came from.
//
// termsFrom(title, description) ->
//   { seasons: ["Spring 2027"], start: "2027-01", end: "2027-05", weeks: 16, hours: 20,
//     coop, partTime, yearRound, contract, source: "description" | "title", evidence: "…" }

import { htmlToText } from "./pay.js";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthNum = (m) => MONTHS[m.toLowerCase().slice(0, 4)] || MONTHS[m.toLowerCase().slice(0, 3)];
const SEASON = "(spring|summer|fall|autumn|winter)";
const cap = (s) => { s = s.toLowerCase().replace("autumn", "fall"); return s[0].toUpperCase() + s.slice(1); };
const pad = (n) => String(n).padStart(2, "0");

// The season a start month belongs to on a US academic calendar.
export function seasonOfMonth(m) {
  if (m === 12) return "Winter";
  if (m <= 3) return "Spring";
  if (m <= 4) return "Spring";
  if (m <= 7) return "Summer";
  return "Fall";
}

const clip = (text, index, len) => {
  const dot = text.lastIndexOf(". ", index);
  const a = Math.max(dot < 0 ? 0 : dot + 2, index - 90);
  let b = text.indexOf(". ", index + len); b = b < 0 ? text.length : b + 1;
  return text.slice(a, Math.min(b, index + len + 110)).trim().replace(/\s+/g, " ").slice(0, 200);
};

// Words that show a sentence is about when the role runs rather than generic boilerplate.
// Sentences about the student's schooling, not about when the job runs.
const SCHOOLING = /\b(enroll(?:ed|ment)?|graduat\w*|returning to (?:school|campus)|degree|class of|expected|pursuing|complet\w* (?:your|their|a|\d)|matriculat\w*|academic standing|coursework|requirement|licensure|eligib\w*|credit hours?|units?)\b/i;
// Company-wide boilerplate about staff benefits, not about this role's schedule.
const BENEFITS = /\b(benefits?|eligib\w*|employees|401\(?k|paid time off|pto|insurance|accru\w*)\b/i;
const sentenceAt = (text, at, len = 0) => { const a = Math.max(text.lastIndexOf(". ", at), text.lastIndexOf("\n", at)) + 1; let b = text.indexOf(". ", at + len); if (b < 0) b = text.length; return text.slice(a, b); };

// The sentences of a description that talk about timing. Small enough to cache, so the
// term logic can be improved later without downloading every posting again.
const KEEP = /\b(spring|summer|fall|autumn|winter|jan(?:uary)?|feb(?:ruary)?|march|april|may|june|july|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|weeks?|months?|hours?|co-?ops?|part[- ]time|full[- ]time|year[- ]round|contract\w*|temporary|seasonal|freelance|semester|term|start\w*|begin\w*|duration|20\d\d)\b/i;
export function termText(text = "") {
  const out = [];
  let size = 0;
  for (const sent of String(text).split(/(?<=[.!?])\s+|\n+|\s{2,}•\s*/)) {
    if (sent.length < 12 || sent.length > 400 || !KEEP.test(sent)) continue;
    out.push(sent.trim()); size += sent.length;
    if (size > 2600) break;
  }
  return out.join(" ");
}
const aboutSchool = (text, at) => { const dot = Math.max(text.lastIndexOf(". ", at), text.lastIndexOf("\n", at)); return SCHOOLING.test(text.slice(Math.max(dot + 1, at - 90), at)); };
const TIMING = /\b(intern(?:ship)?|co-?op|term|semester|session|program|position|role|assignment|start(?:s|ing)?|begin(?:s|ning)?|dates?|duration|runs?|from|through|available|availability|commit|work(?:ing)?)\b/i;

export function termsFrom(title = "", description = "", now = new Date()) {
  const t = String(title);
  const WORDS = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, twenty: 20 };
  const d = (description && description.length > 300 && /</.test(description) ? htmlToText(description) : String(description || ""))
    .replace(/\b(three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|twenty)(?=[\s-](?:week|month))/gi, (w) => WORDS[w.toLowerCase()]);
  const out = { seasons: [], coop: false, partTime: false, yearRound: false, contract: false };
  const year0 = now.getFullYear();
  const plausibleYear = (y) => y >= year0 && y <= year0 + 2;
  const add = (season, year) => { const label = `${cap(season)} ${year}`; if (plausibleYear(Number(year)) && !out.seasons.includes(label)) out.seasons.push(label); };
  const note = (source, evidence) => { if (!out.source || (out.source === "title" && source === "description")) { out.source = source; if (evidence) out.evidence = evidence; } };

  // ---- title ----
  for (const m of t.matchAll(new RegExp(`\\b${SEASON}\\b(?:\\s*(?:\\/|&|and|or|,)\\s*${SEASON})?[^0-9]{0,12}(20\\d\\d)`, "gi"))) { add(m[1], m[3]); if (m[2]) add(m[2], m[3]); note("title"); }
  for (const m of t.matchAll(new RegExp(`\\b(20\\d\\d)\\s*${SEASON}\\b`, "gi"))) { add(m[2], m[1]); note("title"); }
  const bareSeason = !out.seasons.length && t.match(new RegExp(`\\b${SEASON}\\b`, "i"));
  const titleYear = t.match(/\b(20\d\d)\b/);

  // ---- description: "Spring 2027", "2027 Fall semester" ----
  const counts = new Map();
  if (d) {
    for (const m of d.matchAll(new RegExp(`\\b${SEASON}\\b(?:\\s*(?:\\/|&|and|or|,)\\s*${SEASON})?(?:\\s+(?:semester|term|session|quarter|co-?op|internship|intern))?[\\s,]*(?:of\\s+)?(20\\d\\d)`, "gi"))) {
      for (const s of [m[1], m[2]].filter(Boolean)) {
        const label = `${cap(s)} ${m[3]}`;
        if (!plausibleYear(Number(m[3])) || aboutSchool(d, m.index)) continue;
        const c = counts.get(label) || { n: 0, at: m.index, len: m[0].length };
        c.n++; counts.set(label, c);
      }
    }
    for (const m of d.matchAll(new RegExp(`\\b(20\\d\\d)\\s+${SEASON}\\b(?=\\s+(?:semester|term|session|co-?op|intern))`, "gi"))) {
      const label = `${cap(m[2])} ${m[1]}`;
      if (plausibleYear(Number(m[1])) && !aboutSchool(d, m.index)) { const c = counts.get(label) || { n: 0, at: m.index, len: m[0].length }; c.n++; counts.set(label, c); }
    }
    // Keep description seasons only when the title didn't already settle it, or they agree.
    const fromDesc = [...counts.entries()].filter(([, c]) => TIMING.test(d.slice(Math.max(0, c.at - 80), c.at + c.len + 80)));
    if (!out.seasons.length) {
      for (const [label, c] of fromDesc.sort((a, b) => b[1].n - a[1].n).slice(0, 3)) { out.seasons.push(label); note("description", clip(d, c.at, c.len)); }
    } else {
      const agree = fromDesc.find(([label]) => out.seasons.includes(label));
      if (agree) note("description", clip(d, agree[1].at, agree[1].len));
    }

    // ---- date range: "January 11, 2027 – May 7, 2027", "from June to August 2027" ----
    const range = d.match(new RegExp(`\\b${MONTH}\\.?\\s*(\\d{1,2})?(?:st|nd|rd|th)?,?\\s*(20\\d\\d)?\\s*(?:-|–|—|to|through|thru|until)\\s*${MONTH}\\.?\\s*(\\d{1,2})?(?:st|nd|rd|th)?,?\\s*(20\\d\\d)`, "i"));
    if (range && !aboutSchool(d, range.index) && !SCHOOLING.test(sentenceAt(d, range.index, range[0].length)) && TIMING.test(d.slice(Math.max(0, range.index - 100), range.index + range[0].length + 40))) {
      const m1 = monthNum(range[1]), m2 = monthNum(range[4]), y2 = Number(range[6]);
      const y1 = Number(range[3]) || (m1 > m2 ? y2 - 1 : y2);
      if (plausibleYear(y2) && m1 && m2) {
        out.start = `${y1}-${pad(m1)}`; out.end = `${y2}-${pad(m2)}`;
        const days = (new Date(y2, m2 - 1, Number(range[5]) || 28) - new Date(y1, m1 - 1, Number(range[2]) || 1)) / 864e5;
        if (days > 20 && days < 430) out.weeks = Math.round(days / 7);
        if (out.source !== "title" || !out.seasons.length) {
          out.seasons = [`${seasonOfMonth(m1)} ${y1}`];
          // a long co-op spans several terms: tag each one it covers
          for (let k = 1, mm = m1, yy = y1; k < 14 && (yy < y2 || mm < m2); k++) {
            mm++; if (mm > 12) { mm = 1; yy++; }
            if ((mm === 6 || mm === 9 || (mm === 1 && k > 1)) && (yy < y2 || mm < m2)) { const label = `${seasonOfMonth(mm)} ${yy}`; if (!out.seasons.includes(label)) out.seasons.push(label); }
          }
        }
        note("description", clip(d, range.index, range[0].length));
      }
    }
    // ---- start date: "start date: January 2027", "beginning in September 2027" ----
    if (!out.start) {
      const st = d.match(new RegExp(`\\b(?:start(?:s|ing)?(?:\\s+date)?|begin(?:s|ning)?|commenc(?:es|ing))\\b[^.]{0,40}?\\b${MONTH}\\.?\\s*(\\d{1,2})?(?:st|nd|rd|th)?,?\\s*(20\\d\\d)`, "i"));
      if (st && plausibleYear(Number(st[3])) && !aboutSchool(d, st.index)) {
        const m1 = monthNum(st[1]);
        out.start = `${st[3]}-${pad(m1)}`;
        if (out.source !== "title" || !out.seasons.length) out.seasons = [`${seasonOfMonth(m1)} ${st[3]}`];
        note("description", clip(d, st.index, st[0].length));
      }
    }
    // ---- length: "12-week internship", "6 month co-op", "10 to 12 weeks" ----
    const len = d.match(/\b(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\s*(?:-|\s)?\s*(week|month)s?\b[^.]{0,60}?\b(intern(?:ship)?s?|co-?ops?|program|assignment|term|rotation|duration|commitment)\b/i)
      || d.match(/\b(?:intern(?:ship)?s?|co-?ops?|program|assignment|duration|term)\b[^.]{0,60}?\b(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\s*(?:-|\s)?\s*(week|month)s?\b/i);
    if (len) {
      const n = Number(len[2] || len[1]);
      const weeks = /month/i.test(len[3]) ? Math.round(n * 4.35) : n;
      if (weeks >= 4 && weeks <= 60) { out.weeks = weeks; if (!out.evidence) note("description", clip(d, len.index, len[0].length)); }
    }
    // ---- hours per week ----
    const hrs = d.match(/\b(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\s*(?:\+\s*)?hours?\s*(?:per|a|each|\/)\s*week\b/i);
    if (hrs && !BENEFITS.test(sentenceAt(d, hrs.index, hrs[0].length))) { const h = Number(hrs[2] || hrs[1]); if (h >= 5 && h <= 60) out.hours = h; }
  }
  // "our fall internship", "spring semester co-op" with no year anywhere
  if (d && !out.seasons.length && !bareSeason) {
    const bare = new Map();
    for (const m of d.matchAll(new RegExp(`\\b${SEASON}\\s+(?:20\\d\\d\\s+)?(?:intern(?:ship)?s?|co-?ops?|semesters?|terms?|sessions?)\\b`, "gi"))) {
      if (aboutSchool(d, m.index)) continue;
      // "Spring, Summer, and Fall interns": pick up the seasons listed just before
      const lead = d.slice(Math.max(0, m.index - 40), m.index).match(new RegExp(`((?:${SEASON}\\s*(?:,|\\/|&|and|or)?\\s*(?:and|or)?\\s*)+)$`, "i"));
      const listed = lead ? [...lead[1].matchAll(new RegExp(SEASON, "gi"))].map((x) => cap(x[1])) : [];
      for (const k of [...listed, cap(m[1])]) if (!bare.has(k)) bare.set(k, m);
    }
    if (bare.size >= 1 && bare.size <= 3) {
      const first = [...bare.values()][0];
      // one mention is the term; a short list means the employer hires in each of them
      if (bare.size === 1 || [...bare.values()].every((m) => m === first)) { out.seasons.push(...bare.keys()); note("description", clip(d, first.index, first[0].length)); }
    }
  }
  if (bareSeason && !out.seasons.length) {
    // "Summer Intern" with a year elsewhere in the title, or no year at all
    const y = titleYear?.[1];
    if (y && plausibleYear(Number(y))) add(bareSeason[1], y); else out.seasons.push(cap(bareSeason[1]));
    note("title");
  }
  if (!out.seasons.length && titleYear && plausibleYear(Number(titleYear[1]))) out.seasons.push(titleYear[1]);

  // ---- kind of arrangement ----
  const both = `${t}\n${d}`;
  out.coop = /\bco-?ops?\b/i.test(t) || /\b(?:\d{1,2}[- ]month|multi[- ]term|alternating|full[- ]time) co-?op\b|\bco-?op (?:term|assignment|rotation|work term|session)s?\b|\bthis co-?op\b/i.test(d);
  out.yearRound = /\byear[- ]round\b/i.test(t) || /\byear[- ]round (?:intern(?:ship)?s?|positions?|roles?|opportunit\w+|program|co-?ops?|basis)\b/i.test(d) || /\bintern(?:ship)?s? (?:are|is) (?:offered |available )?year[- ]round\b/i.test(d);
  const pt = d.match(/\bpart[- ]time\b[^.]{0,80}\b(?:during|while|semester|school|academic|classes)\b/i);
  out.partTime = /\bpart[- ]time\b/i.test(t) || (!!pt && !BENEFITS.test(sentenceAt(d, pt.index, pt[0].length))) || (out.hours && out.hours <= 25) || false;
  out.contract = /\b(?:contract|contractor|temporary|temp|seasonal|freelance)\b/i.test(t) || /\b(?:\d{1,2}[- ]month contract|contract (?:position|role|opportunity|to hire)|independent contractor|w-?2 contract|1099|freelance)\b/i.test(d);
  // quote the sentence behind an arrangement label when nothing else was quoted
  if (!out.evidence && d) {
    const m = (out.yearRound && d.match(/year[- ]round/i)) || (out.partTime && d.match(/part[- ]time|\d{1,2}(?:\s*(?:-|–|to)\s*\d{1,2})?\s*hours?\s*(?:per|a|each|\/)\s*week/i)) || (out.coop && d.match(/co-?op/i)) || (out.contract && d.match(/contract|temporary/i));
    if (m) note("description", clip(d, m.index, m[0].length));
  }
  if (out.weeks >= 20 && !out.coop && /\b(?:6|six|8|eight)[- ]month\b/i.test(both)) out.coop = out.coop || /co-?op/i.test(both);
  return out;
}

// Roll the facts up into the labels people filter by.
// cycle: any of Summer, Fall, Spring, Winter, Co-op, Part-time, Year-round, Contract
export function cycleOf(seasons, info = {}) {
  const cycle = new Set();
  for (const s of seasons) { const m = s.match(/^(Spring|Summer|Fall|Winter)\b/); if (m) cycle.add(m[1]); }
  if (info.coop) cycle.add("Co-op");
  if (info.partTime) cycle.add("Part-time");
  if (info.yearRound) cycle.add("Year-round");
  if (info.contract) cycle.add("Contract");
  const offCycle = [...cycle].some((c) => c !== "Summer");
  return { cycle: [...cycle], offCycle };
}
