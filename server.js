// InternScout — aggregates US internship listings from public ATS feeds and
// licensed aggregator APIs, then serves a filterable UI with an AI search chat.
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { posted, parsePay, htmlToText, applyEstimates } from "./lib/pay.js";
import { PayResearch } from "./lib/research.js";
import { termsFrom, cycleOf, termText } from "./lib/terms.js";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const PORT = Number(process.env.PORT || 3000);
const REFRESH_MS = Number(process.env.REFRESH_MINUTES || 10) * 60_000;
const ROOT = import.meta.dirname;
const companies = JSON.parse(await readFile(path.join(ROOT, "companies.json"), "utf8"));

// ---------- normalization helpers ----------
const STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const CITY_STATE = {
  "san francisco": "CA", "los angeles": "CA", "palo alto": "CA", "mountain view": "CA", "san jose": "CA",
  "sunnyvale": "CA", "san mateo": "CA", "san diego": "CA", "menlo park": "CA", "new york": "NY", "nyc": "NY",
  "seattle": "WA", "bellevue": "WA", "austin": "TX", "dallas": "TX", "houston": "TX", "boston": "MA",
  "cambridge, ma": "MA", "chicago": "IL", "denver": "CO", "boulder": "CO", "atlanta": "GA", "miami": "FL",
  "washington, dc": "DC", "washington dc": "DC", "pittsburgh": "PA", "philadelphia": "PA", "portland": "OR",
  "salt lake city": "UT", "phoenix": "AZ", "raleigh": "NC", "minneapolis": "MN", "detroit": "MI",
};
const FOREIGN = /\b(canada|toronto|vancouver|montreal|london|uk|united kingdom|ireland|dublin|germany|berlin|munich|france|paris|india|bangalore|bengaluru|hyderabad|singapore|japan|tokyo|australia|sydney|melbourne|brazil|mexico|netherlands|amsterdam|spain|madrid|poland|warsaw|israel|tel aviv|korea|seoul|china|hong kong|switzerland|zurich|sweden|stockholm|emea|apac|latam)\b/i;
// Titles that mean "internship": intern/internship, co-op, and the banking/consulting
// "Summer Analyst/Associate" programs. "Internal", "international", "internist" don't count.
const INTERN_RE = /\b(intern|interns|internship|internships|co-op|co-ops|co op)\b|\bsummer (?:20\d\d )?(?:analyst|associate|scholar|fellow)s?\b|\bstudent (?:intern|trainee)\b/i;

const CA_PROVINCE = /\b(ON|BC|QC|AB|MB|NS|NB|SK|NL|PE)\s*,\s*CA\b|\bCanada\b/;

// Each location segment ("Toronto, ON, CA • Seattle, WA") is judged on its own so a
// foreign office never leaks a US state into the listing.
const CANADA = /\b(CAN|Canada|Quebec|Québec|Ontario|Alberta|British Columbia|Manitoba|Nova Scotia|Saskatchewan|New Brunswick|Newfoundland)\b|^\s*CA\s*-\s*(?:ON|QC|BC|AB|MB|NS|NB|SK|NL|PE)\b/;
function parseSegment(text) {
  const states = new Set();
  if (CANADA.test(text)) return { states, remote: false, isUS: false };
  // Workday style "US-IA-CEDAR RAPIDS" or "USA - WI - Racine"
  const wd = text.match(/^\s*(?:US|USA)\s*-\s*([A-Z]{2})\b/);
  if (wd && STATES[wd[1]]) return { states: new Set([wd[1]]), remote: /remote/i.test(text), isUS: true };
  if (FOREIGN.test(text) || CA_PROVINCE.test(text)) return { states, remote: false, isUS: false };
  for (const m of text.matchAll(/(?:,|\s|^)\s*([A-Z]{2})\b/g)) if (STATES[m[1]]) states.add(m[1]);
  for (const [abbr, name] of Object.entries(STATES)) if (new RegExp(`\\b${name}\\b`, "i").test(text) && !(abbr === "WA" && /washington,? d\.?c/i.test(text))) states.add(abbr);
  for (const [city, abbr] of Object.entries(CITY_STATE)) if (text.toLowerCase().includes(city)) states.add(abbr);
  const remote = /remote|anywhere|distributed/i.test(text);
  const saysUS = /\b(united states|usa|u\.s\.|us)\b/i.test(text);
  return { states, remote, isUS: states.size > 0 || saysUS || remote };
}

function parseLocation(raw) {
  const segments = (raw || "").split(/\s*(?:•|;|\||\/)\s*/).filter(Boolean);
  const states = new Set();
  let remote = false, isUS = false;
  for (const seg of segments) {
    const r = parseSegment(seg);
    if (!r.isUS) continue;
    isUS = true;
    remote ||= r.remote;
    r.states.forEach((x) => states.add(x));
  }
  return { states: [...states], remote, isUS };
}

function classify(title) {
  const t = title.toLowerCase();
  if (/machine learning|\bml\b|\bai\b|data scien|research scien|applied scien/.test(t)) return "AI & Data Science";
  if (/data (engineer|analyst|analytics)|analytics|business intelligence/.test(t)) return "Data & Analytics";
  if (/software|engineer|developer|swe|backend|frontend|full.?stack|infrastructure|security|mobile|ios|android/.test(t)) return "Software Engineering";
  if (/product manag|\bpm\b|program manag/.test(t)) return "Product";
  if (/design|ux|ui\b|brand|creative|illustrat|animat/.test(t)) return "Design";
  if (/hardware|electrical|mechanical|silicon|asic|fpga/.test(t)) return "Hardware";
  if (/finance|account|strategy|operations|business|sales|consult|legal|people|recruit|hr\b/.test(t)) return "Business & Ops";
  if (/marketing|growth|communications|content|social/.test(t)) return "Marketing";
  if (/quant|trading|trader/.test(t)) return "Quant & Finance";
  if (/research/.test(t)) return "Research";
  return "Other";
}

function seasonsFrom(title) {
  const m = title.match(/\b(summer|fall|autumn|spring|winter)\b[^0-9]{0,6}(20\d\d)?/i);
  const y = title.match(/\b(20\d\d)\b/);
  const s = m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase().replace("Autumn", "Fall") : null;
  const label = [s, y?.[1]].filter(Boolean).join(" ");
  return label ? [label] : [];
}

function degreesFrom(title) {
  if (/\bph\.?d\b|doctoral/i.test(title)) return ["PhD"];
  if (/\bmba\b/i.test(title)) return ["MBA"];
  if (/\b(master'?s?|ms|m\.s\.|graduate)\b/i.test(title)) return ["Master's"];
  return ["Bachelor's", "Master's"];
}

// Where the "Apply" button leads. Only an employer's own careers site or its applicant
// tracking system counts as a direct application; job boards and aggregators do not.
const AGGREGATOR = /(^|\.)(linkedin|indeed|joinhandshake|handshake|glassdoor|ziprecruiter|simplify|adzuna|monster|careerbuilder|wayup|jooble|talent|lensa|dice|zapply|dreamworkhq|resumax|hirly|jobbie|jobright|applyguy|builtin|levels|wellfound|understudy|intern-list|internshala|github|imgur|shields|example|trylitos|builtin[a-z]*|jooble|talentify|jobgether|remotive|otta|welcometothejungle)\.(com|jobs|co|us|io|me|ai|bot|fyi|org)$|^(www\.)?google\.com$/i;
function applyInfo(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$|src$|gh_src$|lever-source)/i.test(k)) u.searchParams.delete(k);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    return { url: u.toString(), applyHost: host, direct: !AGGREGATOR.test(host) };
  } catch {
    return null;
  }
}

// Lists sometimes keep a role "active" after its term has started. Drop roles whose every
// dated term is already underway or over (e.g. "Summer 2026" in October 2026).
const TERM_START = { Winter: 0, Spring: 3, Summer: 5, Fall: 8 };
function termPassed(term, now = new Date()) {
  const m = term.match(/^(Winter|Spring|Summer|Fall)\s+(20\d\d)$/);
  if (!m) return false;
  return new Date(Number(m[2]), TERM_START[m[1]] + 1, 1) < now;
}

const SPONSORSHIP = { "Offers Sponsorship": "Sponsors visas", "Does Not Offer Sponsorship": "No visa sponsorship", "U.S. Citizenship is Required": "U.S. citizens only" };

// Early-career full-time roles: new grad, entry level, rotational programs, level-I titles.
const NEWGRAD_RE = /\b(new[- ]?grads?|new graduates?|recent (?:college )?grad(?:uate)?s?|university grad(?:uate)?s?|college grad(?:uate)?s?|campus hire|graduate (?:program|scheme|rotational|engineer|analyst|developer|associate|trainee)|entry[- ]level|early[- ]career|rotational(?: program)?|leadership development program|development program|associate (?:software|engineer|developer|data|analyst|consultant|scientist|product)|(?:engineer|developer|analyst|scientist|consultant|designer|accountant|programmer) (?:i|1)\b|junior|jr\.? (?:engineer|developer|analyst|designer|data|software)|class of 20\d\d|20\d\d (?:start|graduate|new grad|university)|university (?:hire|graduate|program)|full[- ]time.*20\d\d graduates?)\b/i;
const SENIOR_RE = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp|vice president|architect|\b(?:ii|iii|iv|2|3|4)\b(?! ?20)|experienced|mid[- ]level|supervisor|chief|distinguished)\b/i;
// "Internship", "Full-time" (early-career) or null for everything else.
function kindOf(title, hint) {
  if (INTERN_RE.test(title)) return "Internship";
  if (hint) return hint;
  if (NEWGRAD_RE.test(title) && !SENIOR_RE.test(title)) return "Full-time";
  return null;
}

function normalize({ source, company, title, location, url, postedAt, remoteFlag, trusted, category, seasons, degrees, sponsorship, kind: kindHint }) {
  title = (title || "").trim();
  const kind = kindOf(title, kindHint || (trusted ? "Internship" : null));
  if (!kind) return null;
  const loc = parseLocation(location);
  if (remoteFlag) loc.remote = true;
  if (!loc.isUS) return null;
  const apply = applyInfo(url);
  if (!apply) return null;
  if (postedAt && Date.now() - new Date(postedAt) > 400 * 864e5) return null;
  return applyTerm({
    listSeasons: (seasons || []).map((t) => String(t).trim().replace(/^autumn/i, "Fall").replace(/^[a-z]/, (c) => c.toUpperCase())).filter((t) => /^(Spring|Summer|Fall|Winter)\b/.test(t)),
    id: `${source}:${apply.url}`,
    source, company: htmlToText(company || "").trim(), title: htmlToText(title).trim(), location: location || (loc.remote ? "Remote" : "United States"),
    url: apply.url, applyHost: apply.applyHost, direct: apply.direct,
    postedAt: postedAt ? new Date(postedAt).toISOString() : null,
    states: loc.states, remote: loc.remote,
    category: category || classify(title),
    seasons: [],
    degrees: degrees?.length ? degrees : degreesFrom(title),
    sponsorship: SPONSORSHIP[sponsorship] || "Not stated",
    kind,
  }, compactTerm(termsFrom(title, "")));
}

// Term facts worth keeping (and caching): drop empty fields.
function compactTerm(info) {
  const o = {};
  for (const k of ["seasons", "start", "end", "weeks", "hours", "coop", "partTime", "yearRound", "contract", "source", "evidence"]) if (info[k] && (!Array.isArray(info[k]) || info[k].length)) o[k] = info[k];
  return o;
}
// Attach term facts to a job; returns null when every dated term has already started.
function applyTerm(n, info) {
  // The posting's own words outrank a community list's label, which is sometimes a default.
  const own = (info.seasons || []).filter((t) => /^(Spring|Summer|Fall|Winter)\b/.test(t));
  const seasons = own.length ? info.seasons : [...new Set([...(n.listSeasons || []), ...(info.seasons || [])])];
  const { seasons: _drop, ...rest } = info;
  if (!own.length && n.listSeasons?.length) rest.source = "list";
  n.seasons = seasons;
  n.term = rest;
  Object.assign(n, cycleOf(seasons, info));
  if (n.kind === "Full-time") { n.offCycle = false; n.cycle = info.contract ? ["Contract"] : []; return n; } // seasons here mean the start date
  if (seasons.some((t) => /20\d\d/.test(t)) && seasons.filter((t) => /20\d\d/.test(t)).every((t) => termPassed(t))) return null;
  return n;
}
// Re-read a job's term using its full description.
const describeJob = (n, text) => applyTerm(n, compactTerm(termsFrom(n.title, text || "")));

// ---------- sources ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// fetch that retries dropped connections (resets, DNS hiccups) a few times before giving up
async function fetchRetry(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await fetch(url, { ...init, signal: AbortSignal.timeout(40_000) }); }
    catch (e) { if (attempt >= 3) throw e; await sleep(1000 * 2 ** attempt + Math.random() * 500); }
  }
}
// Retries politely when a site asks us to slow down (429) or hiccups (502/503).
async function getJSON(url, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchRetry(url, { ...init, headers: { accept: "application/json", "user-agent": "InternScout/1.0 (+internship aggregator)", ...(init?.headers || {}) } });
    if ([429, 502, 503].includes(res.status) && attempt < 4) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 1500 * 2 ** attempt + Math.random() * 1000;
      await sleep(Math.min(wait, 30_000));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
}
const postJSON = (url, body) => getJSON(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Run tasks with at most `n` in flight so thousands of boards don't hammer anyone.
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const pretty = (slug) => slug.replace(/(^|[-_])(\w)/g, (_, s, c) => (s ? " " : "") + c.toUpperCase());
const board = (v) => (typeof v === "string" ? { slug: v } : v);

// Detail pages (pay text, Workday locations) are fetched once per posting and cached on disk.
const DETAILS_FILE = path.join(ROOT, "data", "details.json");
let details = {};
try { details = JSON.parse(await readFile(DETAILS_FILE, "utf8")); } catch {}
let detailBudget = 0;
for (const k of Object.keys(details)) if (!k.startsWith("5|")) delete details[k]; // older cache format
async function detail(key, fetcher) {
  key = "5|" + key;
  if (key in details) return details[key];
  if (detailBudget <= 0) return undefined; // fetched on a later cycle
  detailBudget--;
  try { details[key] = await fetcher(); } catch { details[key] = null; }
  return details[key];
}

const periodFrom = (s = "") => /hour/i.test(s) ? "hour" : /week/i.test(s) ? "week" : /month/i.test(s) ? "month" : /year|annual|salary/i.test(s) ? "year" : null;

async function fromGreenhouse({ slug, company }) {
  const { jobs } = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
  const out = [];
  for (const j of jobs) {
    const n = normalize({ source: "greenhouse", company: j.company_name || company || pretty(slug), title: j.title, location: j.location?.name, url: j.absolute_url, postedAt: j.first_published || j.updated_at });
    if (!n) continue;
    const d = await detail(`gh:${slug}:${j.id}:${j.updated_at}`, async () => {
      const x = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${j.id}?pay_transparency=true`);
      const r = x.pay_input_ranges?.find((p) => p.currency_type === "USD");
      const text = htmlToText(htmlToText(x.content || "")); // content arrives HTML-escaped
      const tt = termText(text);
      if (r) return { x: tt, pay: posted(r.min_cents / 100, r.max_cents / 100, periodFrom(r.title + " " + htmlToText(r.blurb)), "Pay range published in the job posting.") };
      return { x: tt, pay: parsePay(text) };
    });
    if (d?.pay) n.pay = d.pay;
    if (d && d.x != null && !describeJob(n, d.x)) continue;
    out.push(n);
  }
  return out;
}

const LEVER_PERIOD = { "per-hour-wage": "hour", "per-week-salary": "week", "per-month-salary": "month", "per-year-salary": "year", "one-time": null };
async function fromLever({ slug, company }) {
  const jobs = await getJSON(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  return jobs.map((j) => {
    const n = normalize({ source: "lever", company: company || pretty(slug), title: j.text, location: [j.categories?.location, ...(j.categories?.allLocations || [])].filter(Boolean).join(" • "), url: j.hostedUrl, postedAt: j.createdAt, remoteFlag: j.workplaceType === "remote" });
    if (!n) return null;
    const sr = j.salaryRange;
    const text = [j.descriptionPlain, j.additionalPlain, ...(j.lists || []).map((l) => htmlToText(l.content || ""))].join(" ");
    n.pay = (sr && sr.currency === "USD" && posted(sr.min, sr.max, LEVER_PERIOD[sr.interval])) || parsePay(text) || undefined;
    return describeJob(n, text);
  });
}

const ASHBY_PERIOD = { "1 HOUR": "hour", "1 WEEK": "week", "1 MONTH": "month", "1 YEAR": "year" };
async function fromAshby({ slug, company }) {
  const { jobs } = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`);
  return jobs.filter((j) => j.isListed !== false).map((j) => {
    const n = normalize({ source: "ashby", company: company || pretty(slug), title: j.title, location: [j.location, ...(j.secondaryLocations || []).map((s) => s.location)].join(" • "), url: j.jobUrl, postedAt: j.publishedAt, remoteFlag: j.isRemote });
    if (!n) return null;
    const c = j.compensation?.summaryComponents?.find((x) => /salary|hourly|wage/i.test(x.compensationType) && x.currencyCode === "USD");
    n.pay = (c && posted(c.minValue, c.maxValue, ASHBY_PERIOD[c.interval])) || parsePay(j.descriptionPlain) || undefined;
    return describeJob(n, j.descriptionPlain);
  });
}

// Workday hosts most large employers. Its career sites read from a public JSON API.
function workdayDate(s = "") {
  if (/today/i.test(s)) return new Date();
  if (/yesterday/i.test(s)) return new Date(Date.now() - 864e5);
  const m = s.match(/(\d+)\+?\s*days?/i);
  return m ? new Date(Date.now() - Number(m[1]) * 864e5) : null;
}
async function fromWorkday({ host, tenant, site, company }) {
  const api = `https://${host}/wday/cxs/${tenant}/${site}`;
  const postings = [], seenPaths = new Set();
  // "intern" finds intern/internship; "summer co-op" finds Summer Analyst programs and co-ops.
  for (const searchText of ["intern", "summer co-op", "new graduate", "entry level"]) {
    if (searchText !== "intern" && !postings.length) break; // quiet site: skip the second search
    for (let offset = 0; offset < 400; offset += 20) {
      const page = await postJSON(`${api}/jobs`, { appliedFacets: {}, limit: 20, offset, searchText });
      for (const p of page.jobPostings || []) if (!seenPaths.has(p.externalPath)) { seenPaths.add(p.externalPath); postings.push(p); }
      if (!page.jobPostings?.length || offset + 20 >= (page.total || 0)) break;
    }
  }
  const out = [];
  for (const p of postings) {
    if (!kindOf(p.title || "")) continue;
    const multi = /\d+\s+locations/i.test(p.locationsText || "");
    if (!multi && !parseLocation(p.locationsText).isUS && !/united states|usa|\bus\b/i.test(p.locationsText || "")) continue;
    const d = await detail(`wd:${host}:${p.externalPath}`, async () => {
      const x = (await getJSON(`${api}${p.externalPath}`)).jobPostingInfo || {};
      const text = htmlToText(x.jobDescription || "");
      return { location: [x.location, ...(x.additionalLocations || [])].filter(Boolean).join(" • "), url: x.externalUrl, postedAt: x.startDate, pay: parsePay(text), x: termText(text + (x.timeType ? ` ${x.timeType}.` : "")) };
    });
    if (multi && !d) continue; // locations unknown until the detail page is read
    const base = host.endsWith("myworkdaysite.com") ? `https://${host}/recruiting/${tenant}/${site}` : `https://${host}/${site}`;
    const n = normalize({ source: "workday", company: company || pretty(tenant), title: p.title, location: d?.location || p.locationsText, url: d?.url || base + p.externalPath, postedAt: d?.postedAt || workdayDate(p.postedOn) });
    if (!n) continue;
    if (d?.pay) n.pay = d.pay;
    if (d && d.x != null && !describeJob(n, d.x)) continue;
    out.push(n);
  }
  return out;
}

async function fromSmartRecruiters({ slug, company }) {
  const out = [], seenIds = new Set();
  for (const q of ["intern", "graduate", "entry level"]) for (let offset = 0; offset < 300; offset += 100) {
    const page = await getJSON(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?q=${encodeURIComponent(q)}&limit=100&offset=${offset}`);
    page.content = (page.content || []).filter((p) => !seenIds.has(p.id) && seenIds.add(p.id));
    for (const p of page.content || []) {
      if (p.location?.country && p.location.country !== "us") continue;
      const n = normalize({ source: "smartrecruiters", company: p.company?.name || company || slug, title: p.name, location: p.location?.remote ? "Remote, US" : [p.location?.city, p.location?.region, "US"].filter(Boolean).join(", "), url: `https://jobs.smartrecruiters.com/${slug}/${p.id}`, postedAt: p.releasedDate, remoteFlag: p.location?.remote });
      if (!n) continue;
      const d = await detail(`sr:${slug}:${p.id}`, async () => {
        const x = await getJSON(`https://api.smartrecruiters.com/v1/companies/${slug}/postings/${p.id}`);
        const text = htmlToText(Object.values(x.jobAd?.sections || {}).map((s) => s?.text || "").join(" "));
        return { pay: parsePay(text), x: termText(text) };
      });
      if (d?.pay) n.pay = d.pay;
      if (d && d.x != null && !describeJob(n, d.x)) continue;
      out.push(n);
    }
    if ((page.content || []).length < 100) break;
  }
  return out;
}

async function fromWorkable({ slug, company }) {
  const results = [], seenCodes = new Set();
  for (const query of ["intern", "graduate"]) {
    const r = await postJSON(`https://apply.workable.com/api/v3/accounts/${slug}/jobs`, { query, location: [], department: [], worktype: [], remote: [] });
    for (const j of r.results || []) if (!seenCodes.has(j.shortcode)) { seenCodes.add(j.shortcode); results.push(j); }
  }
  const out = [];
  for (const j of results) {
    const l = j.location || {};
    if (l.countryCode && l.countryCode !== "US") continue;
    const n = normalize({ source: "workable", company: company || pretty(slug), title: j.title, location: j.remote ? "Remote, US" : [l.city, l.region, "US"].filter(Boolean).join(", "), url: `https://apply.workable.com/${slug}/j/${j.shortcode}/`, postedAt: j.published, remoteFlag: j.remote });
    if (!n) continue;
    const d = await detail(`wk:${slug}:${j.shortcode}`, async () => {
      const x = await getJSON(`https://apply.workable.com/api/v2/accounts/${slug}/jobs/${j.shortcode}`);
      const text = htmlToText([x.description, x.requirements, x.benefits].join(" "));
      return { pay: parsePay(text), x: termText(text) };
    });
    if (d?.pay) n.pay = d.pay;
    if (d && d.x != null && !describeJob(n, d.x)) continue;
    out.push(n);
  }
  return out;
}

async function fromOracle({ host, site, company }) {
  const reqs = new Map();
  for (const kw of ["intern", "graduate", "entry level"]) {
    const data = await getJSON(`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},keyword=${encodeURIComponent(kw)},limit=100`);
    for (const r of data.items?.[0]?.requisitionList || []) reqs.set(r.Id, r);
  }
  const out = [];
  for (const r of reqs.values()) {
    const n = normalize({ source: "oracle", company: company || host.split(".")[0], title: r.Title, location: [r.PrimaryLocation, ...(r.secondaryLocations || []).map((x) => x.Name)].filter(Boolean).join(" • "), url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${r.Id}`, postedAt: r.PostedDate, remoteFlag: r.WorkplaceTypeCode === "ORA_REMOTE" });
    if (!n) continue;
    const short = [r.ShortDescriptionStr, r.ExternalResponsibilitiesStr, r.ExternalQualificationsStr].join(" ");
    const d = await detail(`or:${host}:${site}:${r.Id}`, async () => {
      const x = (await getJSON(`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${r.Id}%22,siteNumber=${site}`)).items?.[0] || {};
      const text = htmlToText([x.ExternalDescriptionStr, x.ExternalResponsibilitiesStr, x.ExternalQualificationsStr, x.JobSchedule, x.WorkDurationMonths ? `${x.WorkDurationMonths} month assignment` : ""].join(" "));
      return { pay: parsePay(text), x: termText(text) };
    });
    n.pay = d?.pay || parsePay(short) || undefined;
    if (!describeJob(n, d?.x ?? htmlToText(short))) continue;
    out.push(n);
  }
  return out;
}

// iCIMS career sites hosted on the employer's own domain ("Jibe") expose a JSON search API.
async function fromJibe({ host, company }) {
  const out = [];
  const seenSlugs = new Set();
  for (const kw of ["intern", "graduate", "entry level"]) for (let page = 1; page <= 5; page++) {
    const data = await getJSON(`https://${host}/api/jobs?keywords=${encodeURIComponent(kw)}&page=${page}&limit=100`);
    data.jobs = (data.jobs || []).filter(({ data: d }) => !seenSlugs.has(d.slug) && seenSlugs.add(d.slug));
    for (const { data: d } of data.jobs || []) {
      const loc = d.multipleLocations?.length ? d.multipleLocations.map((l) => [l.city, l.state, l.country].filter(Boolean).join(", ")).join(" • ") : [d.city, d.state, d.country].filter(Boolean).join(", ") || d.location_name;
      const n = normalize({ source: "icims", company: d.hiring_organization || company, title: d.title, location: loc, url: d.meta_data?.canonical_url || `https://${host}/jobs/${d.slug}`, postedAt: d.posted_date, remoteFlag: /remote/i.test(d.location_type || "") });
      if (n) { const text = htmlToText([d.description, d.responsibilities, d.qualifications].join(" ")); n.pay = parsePay(text) || undefined; if (describeJob(n, text)) out.push(n); }
    }
    if ((data.jobs || []).length < 100 || page * 100 >= (data.count || 0)) break;
  }
  return out;
}

// Classic iCIMS boards (careers-company.icims.com) only render HTML, so read the listing rows.
const ICIMS_ROW = /Job Locations<\/span>\s*<span[^>]*>\s*([^<]*?)\s*<\/span>[\s\S]*?<a href="(https?:\/\/[^"]+?\/jobs\/\d+\/[^"?]+\/job)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>\s*([^<]+?)\s*<\/h3>/g;
async function fromIcims({ host, company }) {
  const out = [], seen = new Set();
  for (let pr = 0; pr < 10; pr++) {
    const res = await fetchRetry(`https://${host}/jobs/search?pr=${pr}&searchKeyword=intern&in_iframe=1`, { headers: { "user-agent": "Mozilla/5.0 InternScout" } });
    if (!res.ok) throw new Error(`${res.status} ${host}`);
    const html = await res.text();
    let fresh = 0;
    for (const [, loc, url, title] of html.matchAll(ICIMS_ROW)) {
      if (seen.has(url)) continue;
      seen.add(url); fresh++;
      const n = normalize({ source: "icims", company: company || host.replace(/^(us)?careers-|\.icims\.com$/g, ""), title: htmlToText(title).trim(), location: loc.replace(/\s*\|\s*/g, " • "), url });
      if (!n) continue;
      const d = await detail(`ic:${url}`, async () => {
        const page = await (await fetchRetry(url + "?in_iframe=1", { headers: { "user-agent": "Mozilla/5.0 InternScout" } })).text();
        const posted = page.match(/Posted Date[\s\S]{0,200}?(\d{1,2}\/\d{1,2}\/\d{4}|\d+ days? ago|\d+\+? days ago)/i)?.[1];
        const at = page.indexOf("iCIMS_JobContent");
        const text = htmlToText(page.slice(at > 0 ? page.indexOf(">", at) + 1 : 0));
        return { pay: parsePay(text), x: termText(text), postedAt: posted && /\//.test(posted) ? new Date(posted).toISOString() : posted ? workdayDate(posted)?.toISOString() : null };
      });
      if (d?.pay) n.pay = d.pay;
      if (d && d.x != null && !describeJob(n, d.x)) continue;
      if (d?.postedAt) n.postedAt = d.postedAt;
      out.push(n);
    }
    if (!fresh) break;
  }
  return out;
}

// Eightfold career sites (Microsoft, John Deere and others) share one search API.
async function fromEightfold({ host, domain, company }) {
  const out = [];
  for (const query of ["intern", "new grad", "university graduate"]) for (let start = 0; start < 500; start += 100) {
    const { data } = await getJSON(`https://${host}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=${encodeURIComponent(query)}&location=United%20States&start=${start}&num=100`);
    for (const p of data?.positions || []) {
      const n = normalize({ source: "eightfold", company: company || domain.split(".")[0], title: p.name, location: (p.standardizedLocations?.length ? p.standardizedLocations : p.locations || []).join(" • "), url: `https://${host}${p.positionUrl}`, postedAt: p.postedTs ? p.postedTs * 1000 : null, remoteFlag: /remote/i.test(p.workLocationOption || "") });
      if (n) out.push(n);
    }
    if ((data?.positions || []).length < 100) break;
  }
  return out;
}

async function fromRippling({ slug, company }) {
  const jobs = await getJSON(`https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(slug)}/jobs`);
  return (Array.isArray(jobs) ? jobs : []).map((j) => normalize({ source: "rippling", company: company || pretty(slug), title: j.name, location: j.workLocation?.label || "", url: j.url }));
}

// Jobvite and JazzHR boards render HTML lists.
async function getHTML(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchRetry(url, { headers: { "user-agent": "Mozilla/5.0 InternScout" } });
    if ([429, 503].includes(res.status) && attempt < 4) { await sleep(Number(res.headers.get("retry-after")) * 1000 || 3000 * 2 ** attempt); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.text();
  }
}
async function fromJobvite({ slug, company }) {
  const html = await getHTML(`https://jobs.jobvite.com/${slug}/search?q=intern`);
  const out = [];
  for (const [, href, title, loc] of html.matchAll(/<td class="jv-job-list-name">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<td class="jv-job-list-location">([\s\S]*?)<\/td>/g)) {
    const n = normalize({ source: "jobvite", company: company || pretty(slug), title: htmlToText(title).trim(), location: htmlToText(loc).trim(), url: new URL(href, "https://jobs.jobvite.com").toString() });
    if (n) out.push(n);
  }
  return out;
}
async function fromJazzHR({ slug, company }) {
  const html = await getHTML(`https://${slug}.applytojob.com/apply`);
  const out = [];
  for (const [, href, title, loc] of html.matchAll(/<a href="(https?:\/\/[^"]+applytojob\.com\/apply\/[A-Za-z0-9]+\/[^"]*)"[^>]*>([^<]+)<\/a>[\s\S]*?<li>[\s\S]*?<\/i>\s*([^<]+)/g)) {
    const n = normalize({ source: "jazzhr", company: company || pretty(slug), title: htmlToText(title).trim(), location: loc.trim(), url: href.replace(/^http:/, "https:") });
    if (n) out.push(n);
  }
  return out;
}

// BambooHR career sites have a JSON list endpoint.
async function fromBambooHR({ slug, company }) {
  const res = await fetchRetry(`https://${slug}.bamboohr.com/careers/list`, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 InternScout" }, redirect: "manual" });
  if (res.status >= 300 && res.status < 400 || res.status === 401 || !/json/.test(res.headers.get("content-type") || "")) throw new Error(`404 no longer on BambooHR: ${slug}`);
  if (!res.ok) throw new Error(`${res.status} ${slug}.bamboohr.com`);
  const { result = [] } = await res.json();
  const out = [];
  for (const j of result) {
    const l = j.atsLocation?.city || j.atsLocation?.state ? j.atsLocation : j.location || {};
    const n = normalize({ source: "bamboohr", company: company || pretty(slug), title: j.jobOpeningName, location: [l.city, l.state || l.province, l.country].filter(Boolean).join(", ") || (j.isRemote ? "Remote" : ""), url: `https://${slug}.bamboohr.com/careers/${j.id}`, remoteFlag: !!j.isRemote });
    if (!n) continue;
    const d = await detail(`bh:${slug}:${j.id}`, async () => {
      const x = (await getJSON(`https://${slug}.bamboohr.com/careers/${j.id}/detail`)).result?.jobOpening || {};
      const text = htmlToText([x.description, x.compensation ? `Pay: ${x.compensation}` : "", x.employmentStatusLabel].join(" "));
      return { pay: parsePay(text), postedAt: x.datePosted || null, x: termText(text) };
    });
    if (d?.pay) n.pay = d.pay;
    if (d?.postedAt) n.postedAt = new Date(d.postedAt).toISOString();
    if (d && d.x != null && !describeJob(n, d.x)) continue;
    out.push(n);
  }
  return out;
}

// Paylocity job boards embed their listings as JSON in the page.
async function fromPaylocity({ guid, company }) {
  const html = await getHTML(`https://recruiting.paylocity.com/Recruiting/Jobs/All/${guid}`);
  const m = html.match(/window\.pageData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) return [];
  const data = JSON.parse(m[1]);
  return (data.Jobs || []).filter((j) => !j.IsInternal).map((j) => {
    const l = j.JobLocation || {};
    const n = normalize({ source: "paylocity", company: company || data.CompanyName || "Unknown", title: j.JobTitle, location: l.City ? [l.City, l.State, l.Country].filter(Boolean).join(", ") : j.LocationName, url: `https://recruiting.paylocity.com/Recruiting/Jobs/Details/${j.JobId}`, postedAt: j.PublishedDate, remoteFlag: !!j.IsRemote });
    if (!n) return null;
    n.pay = parsePay(j.Description) || undefined;
    return describeJob(n, j.Description);
  });
}

// Single large employers with their own public career APIs.
async function fromAmazon() {
  const out = [];
  for (const q of ["intern", "internship", "co-op", "new grad", "university graduate", "entry level"]) {
    for (let offset = 0; offset < 1000; offset += 100) {
      const d = await getJSON(`https://www.amazon.jobs/en/search.json?base_query=${q}&loc_query=United%20States&country=USA&result_limit=100&offset=${offset}`);
      for (const j of d.jobs || []) {
        const n = normalize({ source: "amazon", company: j.company_name || "Amazon", title: j.title, location: j.normalized_location || j.location, url: `https://www.amazon.jobs${j.job_path}`, postedAt: j.posted_date });
        if (n) { const text = htmlToText([j.description, j.preferred_qualifications, j.basic_qualifications].join(" ")); n.pay = parsePay(text) || undefined; if (describeJob(n, text)) out.push(n); }
      }
      if ((d.jobs || []).length < 100) break;
    }
  }
  return out;
}

async function fromTikTok() {
  const out = [];
  for (const kw of ["intern", "graduate"]) for (let offset = 0; offset < 3000; offset += 100) {
    const { data } = await postJSONWith("https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts", { "website-path": "tiktok" }, { keyword: kw, limit: 100, offset });
    for (const j of data?.job_post_list || []) {
      const chain = []; for (let c = j.city_info; c; c = c.parent) chain.push(c.en_name);
      if (!chain.some((x) => /^United States/.test(x || ""))) continue;
      const n = normalize({ source: "tiktok", company: "TikTok", title: j.title, location: chain.slice(0, 2).join(", ") + ", United States", url: `https://lifeattiktok.com/search/${j.id}` });
      if (n) { const s = j.job_post_info; n.pay = (s?.min_salary && posted(Number(s.min_salary), Number(s.max_salary), null)) || parsePay([j.description, j.requirement].join(" ")) || undefined; if (describeJob(n, [j.description, j.requirement].join(" "))) out.push(n); }
    }
    if ((data?.job_post_list || []).length < 100) break;
  }
  return out;
}
const postJSONWith = (url, headers, body) => getJSON(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

// Community-maintained internship lists on GitHub catch employers on systems with no
// public API (iCIMS, Taleo, custom sites). Fetched with ETags so unchanged files are free.
const etagCache = new Map();
async function getJSONCached(url) {
  const hit = etagCache.get(url);
  const res = await fetch(url, { headers: hit ? { "if-none-match": hit.etag } : {}, signal: AbortSignal.timeout(60_000) });
  if (res.status === 304 && hit) return hit.data;
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const data = await res.json();
  if (res.headers.get("etag")) etagCache.set(url, { etag: res.headers.get("etag"), data });
  return data;
}
const LIST_CATEGORY = { "AI/ML/Data": "AI & Data Science", "Data Science, AI & Machine Learning": "AI & Data Science", "Software": "Software Engineering", "Software Engineering": "Software Engineering", "Hardware": "Hardware", "Hardware Engineering": "Hardware", "Product": "Product", "Product Management": "Product", "Quant": "Quant & Finance" };
async function fromCommunityList(url, label, kind = "Internship") {
  const list = await getJSONCached(url);
  return list.filter((j) => j.active && j.is_visible !== false).map((j) => normalize({
    source: label, trusted: true, company: j.company_name, title: j.title,
    location: (j.locations || []).join(" • "), url: j.url, postedAt: j.date_posted * 1000,
    category: LIST_CATEGORY[j.category] || null,
    seasons: (j.terms || (j.season ? [j.season] : [])).filter((t) => t && t !== "N/A"),
    degrees: j.degrees, sponsorship: j.sponsorship, kind,
  }));
}
// Other public internship lists on GitHub: JSON files and markdown tables. Rows are kept
// only when they link straight to the employer's application.
const LIST_SOURCES = [
  ["dreamwork", "https://raw.githubusercontent.com/dreamworkhq/Open-Tech-Internships-2027/main/data/listings.json", true],
  ["dreamwork-biz", "https://raw.githubusercontent.com/dreamworkhq/Open-Tech-Internships-2027/main/data/business-listings.json", true],
  ["waypoint", "https://raw.githubusercontent.com/suryavjay/waypoint-job-feed/main/feed/jobs.json", true],
  ["tailed", "https://raw.githubusercontent.com/tailed-community/tailed-internships-new-grad/main/data/jobs.json", false],
  ["wonofakind", "https://raw.githubusercontent.com/WonOfAKind/New-Grad-And-Internships-2027/main/data/roles.json", false],
  ["neetiv", "https://raw.githubusercontent.com/neetiv/Tech-Internship-Listings/main/docs/data.json", true],
  ["hiderrick", "https://raw.githubusercontent.com/hiderrick/Engineering-Internships-Summer-2027/main/jobs.json", true],
  ["semis", "https://raw.githubusercontent.com/sarva12/Semiconductor-Startup-Internships-2027/main/data/jobs.json", true],
  ["mecheng", "https://raw.githubusercontent.com/thebargon/2027-Mechanical-Engineering-Internships/main/data/listings.json", true],
  ["keugene", "https://raw.githubusercontent.com/Keugene11/Summer-2027-Tech-Internships/main/.github/scripts/listings.json", true],
  ["zshah", "https://raw.githubusercontent.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/main/data/jobs.json", true],
  ["secnet", "https://raw.githubusercontent.com/ihrtkaii/secnet-internships/main/data/jobs.json", true],
  ["mech-tracker", "https://raw.githubusercontent.com/Tracker05/mechanical-engineering-internships/main/data/jobs.json", true],
  ["applyguy", "https://raw.githubusercontent.com/ApplyGuy/2027-Internships/main/data/internships.json", true],
  ["speedy-swe", "https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md", true],
  ["speedy-ai", "https://raw.githubusercontent.com/speedyapply/2027-AI-College-Jobs/main/README.md", true],
  ["sndsh", "https://raw.githubusercontent.com/sndsh404/summer-2027-internships/main/README.md", true],
  ["jobbie", "https://raw.githubusercontent.com/jobbie-bot/Summer-2027-Tech-Internships/main/README.md", true],
  ["chieler", "https://raw.githubusercontent.com/Chieler/Summer-2027-SWE-Internships/main/README.md", true],
  ["derec", "https://raw.githubusercontent.com/DereC4/internships-and-newgrad/main/README.md", true],
  ["azhar", "https://raw.githubusercontent.com/adminazhar/Summer-2027-Internships/main/README.md", true],
  ["azhar-biz", "https://raw.githubusercontent.com/adminazhar/Summer-2027-Internships/main/BUSINESS_INTERNSHIPS.md", true],
  ["azhar-eng", "https://raw.githubusercontent.com/adminazhar/Summer-2027-Internships/main/ENGINEERING_INTERNSHIPS.md", true],
  ["mehek", "https://raw.githubusercontent.com/mehek-builds/Summer2027-Internships/main/README.md", true],
  ["mehek-biz", "https://raw.githubusercontent.com/mehek-builds/Summer2027-Internships/main/lists/business-finance-and-marketing.md", true],
  ["mehek-hw", "https://raw.githubusercontent.com/mehek-builds/Summer2027-Internships/main/lists/hardware-and-other-engineering.md", true],
  ["mehek-ds", "https://raw.githubusercontent.com/mehek-builds/Summer2027-Internships/main/lists/data-science-ai-and-machine-learning.md", true],
  ["resumax", "https://raw.githubusercontent.com/resumax/tech-internships/main/README.md", true],
  ["speedy-swe-ng", "https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/NEW_GRAD_USA.md", "newgrad"],
  ["speedy-ai-ng", "https://raw.githubusercontent.com/speedyapply/2027-AI-College-Jobs/main/NEW_GRAD_USA.md", "newgrad"],
  ["internatlas", "https://raw.githubusercontent.com/sonak11/internatlas/main/README.md", true],
  ["nuft-quant", "https://raw.githubusercontent.com/northwesternfintech/2027QuantInternships/main/README.md", true],
];
const NOT_INTERN = /\b(senior|sr\.?|staff|principal|lead|manager|director|new grad|new graduate|full[- ]time|experienced|entry[- ]level)\b/i;
const pick = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== "") return o[k]; };
function rowsOf(j) {
  if (Array.isArray(j)) return j;
  for (const k of ["jobs", "listings", "data", "results", "roles", "items"]) if (Array.isArray(j?.[k])) return j[k];
  const vals = Object.values(j || {});
  return vals.length && typeof vals[0] === "object" && !Array.isArray(vals[0]) ? vals : [];
}
const textOf = (cell) => htmlToText(cell.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")).replace(/[*_`]|🆕|🔥|🛂|🇺🇸|🔒|✅/g, "").trim();
function mdRows(md) {
  const out = [];
  let lastCompany = "";
  for (const line of md.split("\n")) {
    if (!line.startsWith("|") || /^\|\s*:?-{2,}/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1);
    if (cells.length < 4) continue;
    const urls = [...line.matchAll(/https?:\/\/[^\s)"'<>\]]+/g)].map((m) => m[0]);
    const companyUrl = (cells[0].match(/https?:\/\/[^\s)"'<>\]]+/) || [])[0];
    const url = urls.find((u) => u !== companyUrl && applyInfo(u)?.direct && !/\.(png|svg|jpg|gif)(\?|$)/i.test(u));
    let company = textOf(cells[0]);
    if (/^↳|^$/.test(company)) company = lastCompany; else lastCompany = company;
    if (!url || /company|^-+$/i.test(company) && /role|title/i.test(textOf(cells[1]))) continue;
    const payCell = cells.find((c) => /\$\s?\d/.test(c));
    out.push({ company, title: textOf(cells[1]), location: textOf(cells[2]).replace(/<\/?br\s*\/?>/gi, " • "), url, pay: payCell ? textOf(payCell) : null });
  }
  return out;
}
async function fromRepoList(name, url, internshipOnly) {
  let rows;
  if (url.endsWith(".md")) {
    const res = await fetchRetry(url); if (!res.ok) throw new Error(`${res.status} ${url}`);
    rows = mdRows(await res.text());
  } else rows = rowsOf(await getJSONCached(url));
  const out = [];
  for (let r of rows) {
    if (!r || typeof r !== "object") continue;
    if (r.job && typeof r.job === "object") r = { ...r, ...r.job };
    if (r.active === false || r.is_visible === false || /closed|expired|inactive/i.test(r.status || "")) continue;
    const title = String(pick(r, ["title", "role", "position", "job_title", "name"]) || "").trim();
    const kind = String(pick(r, ["type", "role_type", "employment_type"]) || "");
    const termsRaw = [].concat(pick(r, ["terms", "term", "season"]) || []).filter((t) => t && t !== "N/A");
    let rowKind = INTERN_RE.test(title) || /intern|co-?op/i.test(kind) ? "Internship" : null;
    if (!rowKind && (internshipOnly === "newgrad" || /full|new ?grad|entry/i.test(kind) || NEWGRAD_RE.test(title)) && !SENIOR_RE.test(title)) rowKind = "Full-time";
    if (!rowKind) {
      // Internship lists sometimes carry other roles; without an internship word, require clear student signals.
      if (internshipOnly !== true || NOT_INTERN.test(title)) continue;
      if (!termsRaw.length && !/student|apprentice|fellow|trainee|summer|scholar|program/i.test(title)) continue;
      rowKind = "Internship";
    }
    let company = pick(r, ["company", "company_name", "companyName", "employer", "organization"]);
    if (company && typeof company === "object") company = company.name;
    let loc = pick(r, ["location", "locations", "city"]);
    if (Array.isArray(loc)) loc = loc.join(" • ");
    if (loc && typeof loc === "object") loc = [loc.city, loc.state, loc.country].filter(Boolean).join(", ");
    const link = [pick(r, ["url", "canonical_url", "apply_url", "applyUrl", "job_url", "application_url", "link"]), r.listingUrl].filter(Boolean).find((u) => applyInfo(u)?.direct);
    if (!link) continue;
    let when = pick(r, ["date_posted", "postedAt", "posted", "employer_posted_at", "posted_at", "first_seen", "firstSeenAt", "date_added", "firstIndexedAt"]);
    if (typeof when === "number" && when < 1e12) when *= 1000;
    if (when && Date.now() - new Date(when) > 240 * 864e5) continue; // list rows this old have usually closed
    const terms = [].concat(pick(r, ["terms", "term", "season"]) || []).filter((t) => t && t !== "N/A");
    const n = normalize({ source: name, trusted: true, company: String(company || ""), title, location: String(loc || ""), url: link, postedAt: when && !Number.isNaN(new Date(when).getTime()) ? when : null, seasons: terms.map(String), kind: rowKind });
    if (!n || !n.company) continue;
    const min = Number(r.salaryMin), max = Number(r.salaryMax);
    n.pay = (min > 0 && posted(min, max || min, periodFrom(r.salaryPeriod || ""))) || parsePay(r.pay ? "pay " + r.pay : typeof r.compensation === "string" ? "pay " + r.compensation : "") || undefined;
    out.push(n);
  }
  return out;
}

const COMMUNITY_LISTS = [
  ["simplify", "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json"],
  ["community", "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json"],
  ["simplify-newgrad", "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json", "Full-time"],
  ["community-newgrad", "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/.github/scripts/listings.json", "Full-time"],
];

// Adzuna (optional key) aggregates job boards; its links are not direct applications,
// so its listings are hidden in the UI.
async function fromAdzuna() {
  const { ADZUNA_APP_ID: id, ADZUNA_APP_KEY: key } = process.env;
  if (!id || !key) return [];
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const q = new URLSearchParams({ app_id: id, app_key: key, what_or: "intern internship", results_per_page: "50", max_days_old: "14", sort_by: "date" });
    const { results } = await getJSON(`https://api.adzuna.com/v1/api/jobs/us/search/${page}?${q}`);
    out.push(...results.map((j) => normalize({ source: "adzuna", company: j.company?.display_name || "Unknown", title: j.title?.replace(/<[^>]+>/g, ""), location: j.location?.display_name, url: j.redirect_url, postedAt: j.created })));
    if (results.length < 50) break;
  }
  return out;
}

// USAJobs: the federal government's own application site. Free key: developer.usajobs.gov
async function fromUSAJobs() {
  const { USAJOBS_API_KEY: key, USAJOBS_EMAIL: email } = process.env;
  if (!key || !email) return [];
  const data = await getJSON("https://data.usajobs.gov/api/search?Keyword=intern&ResultsPerPage=500&HiringPath=student", { headers: { "Authorization-Key": key, "User-Agent": email, Host: "data.usajobs.gov" } });
  return data.SearchResult.SearchResultItems.map(({ MatchedObjectDescriptor: d }) => {
    const n = normalize({ source: "usajobs", trusted: true, company: d.OrganizationName, title: d.PositionTitle, location: d.PositionLocationDisplay, url: d.PositionURI, postedAt: d.PublicationStartDate });
    const r = d.PositionRemuneration?.[0];
    if (n && r) n.pay = posted(Number(r.MinimumRange), Number(r.MaximumRange), r.RateIntervalCode === "PH" ? "hour" : "year", "Federal pay range from USAJobs.");
    return n;
  });
}

// ---------- store + refresh loop ----------
const jobs = new Map(); // id -> job
const status = { lastRefresh: null, sources: {}, refreshing: false, cycle: 0, boards: 0 };
const listeners = new Set();
// Board state survives restarts: { name: [internshipsFoundLastTime, lastCheckedMs] }
const BOARDS_FILE = path.join(ROOT, "data", "boards.json");
let boardState = {};
try { boardState = JSON.parse(await readFile(BOARDS_FILE, "utf8")); } catch {}
// Boards with internships are checked every cycle. Boards that had none are rechecked after
// a day (three days for the heavy HTML sites), so 60k boards stay polite and fast.
const QUIET_RECHECK_MS = { icims: 72 * 36e5, paylocity: 72 * 36e5, bamboohr: 48 * 36e5, default: 24 * 36e5 };
function due(name) {
  const st = boardState[name];
  if (!st) return true;
  if (st[0] > 0) return true;
  const type = name.split(":")[0];
  return Date.now() - st[1] > (QUIET_RECHECK_MS[type] || QUIET_RECHECK_MS.default);
}
// Each system gets its own lane so a slow or rate-limited one never holds up the rest.
const LANES = { workday: 8, icims: 5, paylocity: 2, workable: 2, bamboohr: 16, lever: 12, ashby: 12, greenhouse: 24, default: 16 };
const research = new PayResearch({ anthropic: process.env.ANTHROPIC_API_KEY ? new Anthropic() : null, file: path.join(ROOT, "data", "research.json"), perCycle: Number(process.env.RESEARCH_PER_CYCLE || 20) });
await research.load();

const FETCHERS = { greenhouse: fromGreenhouse, lever: fromLever, ashby: fromAshby, workday: fromWorkday, smartrecruiters: fromSmartRecruiters, workable: fromWorkable, oracle: fromOracle, jibe: fromJibe, icims: fromIcims, eightfold: fromEightfold, rippling: fromRippling, jobvite: fromJobvite, jazzhr: fromJazzHR, bamboohr: fromBambooHR, paylocity: fromPaylocity };

function allTasks() {
  const tasks = [];
  for (const [type, fn] of Object.entries(FETCHERS)) for (const v of companies[type] || []) {
    const b = board(v);
    tasks.push([`${type}:${b.slug || b.guid || (b.site ? `${b.host}/${b.site}` : b.host)}`, () => fn(b)]);
  }
  tasks.push(...COMMUNITY_LISTS.map(([label, url, kind]) => ["list:" + label, () => fromCommunityList(url, label, kind)]),
    ...LIST_SOURCES.map(([label, url, only]) => ["list:" + label, () => fromRepoList(label, url, only)]), ["adzuna", fromAdzuna], ["usajobs", fromUSAJobs], ["amazon", fromAmazon], ["tiktok", fromTikTok]);
  return tasks;
}

async function refresh() {
  if (status.refreshing) return;
  status.refreshing = true;
  status.cycle++;
  detailBudget = Number(process.env.DETAIL_BUDGET || 25000);
  // Boards with internships are checked every cycle; quiet boards every sixth cycle (hourly).
  const only = process.env.ONLY?.split(",");
  const tasks = allTasks().filter(([name]) => (!only || only.some((o) => name.startsWith(o))) && (name.startsWith("list:") || !name.includes(":") || due(name)));
  status.boardsTotal = allTasks().length;
  status.boardsThisCycle = tasks.length;
  const ran = new Set(), seenNow = new Set();
  const firstRun = jobs.size === 0 || status.cycle === 1;
  const tick = setInterval(publish, 20_000); // show progress during long first runs
  const run = async ([name, fn]) => {
    try {
      const list = (await fn()).filter(Boolean);
      status.sources[name] = { ok: true, count: list.length };
      boardState[name] = [list.length, Date.now()];
      ran.add(name);
      for (const j of list) {
        j.sourceKey = name;
        seenNow.add(j.id);
        const prev = jobs.get(j.id);
        if (prev) Object.assign(prev, j);
        else jobs.set(j.id, { ...j, firstSeen: new Date().toISOString() });
      }
    } catch (e) {
      status.sources[name] = { ok: false, error: `${e.message || e}${e.cause ? ` (${e.cause.code || e.cause.message})` : ""}`.slice(0, 200) };
      if (/^(404|410|422)/.test(e.message || "")) boardState[name] = [0, Date.now() + 6 * 864e5]; // gone: check again in a week
    }
  };
  const byLane = new Map();
  for (const t of tasks) { const lane = LANES[t[0].split(":")[0]] ? t[0].split(":")[0] : "default"; (byLane.get(lane) || byLane.set(lane, []).get(lane)).push(t); }
  const saveState = setInterval(() => writeFile(BOARDS_FILE, JSON.stringify(boardState)).catch(() => {}), 60_000);
  await Promise.all([...byLane].map(([lane, list]) => pool(list, LANES[lane], run)));
  clearInterval(saveState);
  await writeFile(BOARDS_FILE, JSON.stringify(boardState)).catch(() => {});
  clearInterval(tick);
  // A listing that vanished from a board we just read successfully has closed.
  for (const [id, j] of jobs) if (ran.has(j.sourceKey) && !seenNow.has(id)) jobs.delete(id);
  status.boards = Object.keys(status.sources).length;
  const before = new Set(published.map(dedupeKey));
  publish();
  const newcomers = firstRun ? [] : published.filter((j) => !before.has(dedupeKey(j)));
  status.lastRefresh = new Date().toISOString();
  status.refreshing = false;
  await mkdir(path.dirname(DETAILS_FILE), { recursive: true }).then(() => writeFile(DETAILS_FILE, JSON.stringify(details))).catch(() => {});
  await saveJobs();
  console.log(`[refresh] cycle ${status.cycle}: ${tasks.length} boards checked, ${published.length} US internships (${jobs.size} before merging duplicates), ${newcomers.length} new, ${status.withPay} with published pay`);
  if (newcomers.length) for (const send of listeners) send(newcomers);
  researchPay();
}

// Rebuild the public list: merge duplicates, then estimate pay where none is published.
// The board a link belongs to, named the way refresh() names its tasks.
function boardOf(url) {
  try {
    const u = new URL(url), h = u.hostname.toLowerCase(), p = u.pathname.split("/").filter(Boolean);
    if (/greenhouse\.io$/.test(h)) return p[0] && `greenhouse:${(u.searchParams.get("for") || p[0]).toLowerCase()}`;
    if (h === "jobs.lever.co") return p[0] && `lever:${p[0].toLowerCase()}`;
    if (h === "jobs.ashbyhq.com") return p[0] && `ashby:${decodeURIComponent(p[0])}`;
    if (/myworkdayjobs\.com$/.test(h)) { const site = /^[a-z]{2}-[A-Z]{2}$/.test(p[0] || "") ? p[1] : p[0]; return site && `workday:${h}/${site}`; }
    if (h === "jobs.smartrecruiters.com") return p[0] && `smartrecruiters:${p[0]}`;
  } catch {}
  return null;
}
// Identity of a job from its link, ignoring locale segments and tracking parameters.
function jobKey(url) {
  try {
    const u = new URL(url), h = u.hostname.toLowerCase().replace(/^www\./, "");
    const id = u.searchParams.get("gh_jid") || u.pathname.split("/").filter(Boolean).pop() || "";
    if (/greenhouse\.io$/.test(h) || u.searchParams.get("gh_jid")) return `gh|${id}`;
    return `${h.split(".").slice(-3).join(".")}|${id.toLowerCase()}`;
  } catch { return url; }
}
const LIST_SOURCE_NAMES = new Set(["simplify", "community", "simplify-newgrad", "community-newgrad", ...LIST_SOURCES.map(([n]) => n)]);
function publish() {
  // A list row whose board we read successfully, but which wasn't on that board, has closed.
  const okBoards = new Set(Object.entries(status.sources).filter(([, v]) => v.ok).map(([k]) => k));
  const live = new Set([...jobs.values()].filter((j) => !LIST_SOURCE_NAMES.has(j.source)).map((j) => jobKey(j.url)));
  const all = [...jobs.values()].filter((j) => {
    if (!LIST_SOURCE_NAMES.has(j.source)) return true;
    const b = boardOf(j.url);
    return !b || !okBoards.has(b) || live.has(jobKey(j.url));
  });
  published = dedupe(all);
  for (const j of published) Object.assign(j, cycleOf(j.seasons, j.term || {}));
  for (const k of ["Internship", "Full-time"]) applyEstimates(published.filter((j) => (j.kind || "Internship") === k), k === "Internship" ? research.findings() : {}, STATES);
  status.total = published.length;
  status.withPay = published.filter((j) => j.pay?.basis === "posted").length;
  status.employers = new Set(published.map((j) => squash(j.company))).size;
  if (!status.lastRefresh && published.length) status.lastRefresh = new Date().toISOString();
  payload = null;
}

// Companies with the most internships and no published pay anywhere get researched first.
async function researchPay() {
  const counts = new Map();
  for (const j of published) {
    if (j.pay?.basis === "posted" || j.pay?.basis === "unpaid" || j.pay?.confidence === "high") continue;
    const k = squash(j.company);
    counts.set(k, { key: k, company: j.company, n: (counts.get(k)?.n || 0) + 1 });
  }
  const n = await research.run([...counts.values()].sort((a, b) => b.n - a.n));
  if (n) { publish(); console.log(`[research] looked up intern pay for ${n} companies`); }
}

// The same opening often appears on a company board and in a community list.
// Keep one copy, preferring the company's own feed, and fill gaps from the others.
let published = [];
let payload = null;
const SOURCE_RANK = { "simplify-newgrad": 1, "community-newgrad": 2, "speedy-swe-ng": 2, "speedy-ai-ng": 2, internatlas: 2, dreamwork: 2, "dreamwork-biz": 2, waypoint: 2, tailed: 2, wonofakind: 2, neetiv: 2, hiderrick: 2, semis: 2, mecheng: 2, keugene: 2, zshah: 2, secnet: 2, "mech-tracker": 2, applyguy: 2, "speedy-swe": 2, "speedy-ai": 2, sndsh: 2, jobbie: 2, chieler: 2, derec: 2, azhar: 2, "azhar-biz": 2, "azhar-eng": 2, mehek: 2, "mehek-biz": 2, "mehek-hw": 2, "mehek-ds": 2, resumax: 2, "nuft-quant": 2, greenhouse: 0, lever: 0, ashby: 0, workday: 0, smartrecruiters: 0, workable: 0, oracle: 0, icims: 0, eightfold: 0, rippling: 0, amazon: 0, tiktok: 0, jobvite: 0, jazzhr: 0, bamboohr: 0, paylocity: 0, usajobs: 0, simplify: 1, community: 2, adzuna: 3 };
const squash = (s) => (s || "").toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|co|company|technologies|technology)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
const dedupeKey = (j) => `${squash(j.company)}|${squash(j.title)}|${j.states[0] || (j.remote ? "remote" : "us")}`;
function dedupe(list) {
  const byUrl = new Map(), byKey = new Map();
  const sorted = [...list].sort((a, b) => (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9));
  for (const j of sorted) {
    const urlKey = j.url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
    const keep = byUrl.get(urlKey) || byKey.get(dedupeKey(j));
    if (keep) {
      if (j.seasons.length && !keep.seasons.some((t) => /^(Spring|Summer|Fall|Winter)\b/.test(t))) { keep.seasons = j.seasons; keep.term = { ...keep.term, source: j.term?.source || "list" }; }
      for (const k of ["coop", "partTime", "yearRound", "contract"]) if (j.term?.[k]) keep.term = { ...keep.term, [k]: true };
      if (keep.sponsorship === "Not stated") keep.sponsorship = j.sponsorship;
      if (!keep.pay && j.pay?.basis === "posted") keep.pay = j.pay;
      if (j.source !== keep.source && SOURCE_RANK[j.source] < 3 && j.degrees?.length) keep.degrees = j.degrees;
      if (j.category && keep.category === "Other") keep.category = j.category;
      if (j.postedAt && (!keep.postedAt || j.postedAt < keep.postedAt)) keep.postedAt = j.postedAt;
      continue;
    }
    const copy = { ...j, pay: j.pay?.basis === "estimate" ? undefined : j.pay };
    byUrl.set(urlKey, copy); byKey.set(dedupeKey(j), copy);
  }
  return [...new Set(byKey.values())].sort((a, b) => (b.postedAt || "").localeCompare(a.postedAt || ""));
}

// ---------- AI search: natural language -> filters ----------
const CATEGORIES = ["Software Engineering", "AI & Data Science", "Data & Analytics", "Product", "Design", "Hardware", "Quant & Finance", "Business & Ops", "Marketing", "Research", "Other"];
const Filters = z.object({
  reply: z.string().describe("One or two friendly sentences describing what you searched for"),
  keywords: z.array(z.string()).describe("Title keywords to match, e.g. ['frontend'] — empty if none"),
  categories: z.array(z.enum(CATEGORIES)),
  states: z.array(z.string()).describe("Two-letter US state codes"),
  remoteOnly: z.boolean(),
  season: z.string().describe("e.g. 'Summer 2027', 'Fall', or empty string"),
  degree: z.enum(["", "Bachelor's", "Master's", "PhD", "MBA"]).describe("The student's degree program, if they mentioned it"),
  kind: z.enum(["", "Internship", "Full-time"]).describe("Internship, Full-time (new grad / entry level), or empty for both"),
  offCycle: z.boolean().describe("True if the student wants internships outside the summer: fall, spring, winter, co-ops, part-time during school, year-round"),
  cycle: z.array(z.enum(["Summer", "Fall", "Spring", "Winter", "Co-op", "Part-time", "Year-round", "Contract"])).describe("Specific kinds of term or arrangement the student asked for; empty if none"),
  minHourlyPay: z.number().describe("Minimum pay in US dollars per hour the student asked for; convert monthly (x12/2080) or yearly (/2080). 0 if not mentioned"),
  paidOnly: z.boolean().describe("True if the student only wants paid internships"),
  needsVisa: z.boolean().describe("True if the student needs visa sponsorship (international student, F-1, OPT/CPT, H-1B)"),
  companies: z.array(z.string()),
  postedWithinDays: z.number().describe("0 means any time"),
});

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// `current` is the search already on screen; the user's message refines it unless they start over.
async function aiFilters(message, current) {
  if (!anthropic) return heuristicFilters(message, current);
  const response = await anthropic.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 2048,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: zodOutputFormat(Filters) },
    system: `You turn a student's internship search request into structured filters for a US internship database. Today is ${new Date().toDateString()}. You receive the filters currently applied and the student's new message. Return the complete updated filter set: keep current filters unless the message changes, removes or replaces them, and clear everything if the student starts a new, unrelated search. Only add a filter when the student implied it. Company names should match how companies call themselves (e.g. "OpenAI", "Stripe"). The reply is one warm sentence, written to the student, that reflects their words back.`,
    messages: [{ role: "user", content: `Current filters: ${JSON.stringify(current || {})}\n\nMessage: ${message}` }],
  });
  if (response.stop_reason === "refusal") return heuristicFilters(message, current);
  const text = response.content.find((b) => b.type === "text")?.text;
  return Filters.parse(JSON.parse(text));
}

function heuristicFilters(message, current = {}) {
  const m = message.toLowerCase();
  const fresh = /start over|new search|instead|forget|reset/.test(m);
  const base = fresh ? {} : current;
  const states = new Set();
  for (const [abbr, name] of Object.entries(STATES)) if (m.includes(name.toLowerCase()) || new RegExp(`\\b${abbr}\\b`).test(message)) states.add(abbr);
  for (const [city, abbr] of Object.entries(CITY_STATE)) if (m.includes(city)) states.add(abbr);
  const categories = new Set();
  if (/software|swe|engineer|developer|coding/.test(m)) categories.add("Software Engineering");
  if (/\bml\b|machine learning|\bai\b|data scien/.test(m)) categories.add("AI & Data Science");
  if (/analyst|analytics/.test(m)) categories.add("Data & Analytics");
  if (/product/.test(m)) categories.add("Product");
  if (/design|ux/.test(m)) categories.add("Design");
  if (/finance|business|ops|strategy/.test(m)) categories.add("Business & Ops");
  if (/marketing/.test(m)) categories.add("Marketing");
  if (/hardware|electrical/.test(m)) categories.add("Hardware");
  const s = m.match(/\b(summer|fall|spring|winter)\b(?:\s*(20\d\d))?/);
  const days = /today|24 ?h/.test(m) ? 1 : /this week|past week|7 days/.test(m) ? 7 : 0;
  const degree = /ph\.?d|doctoral/.test(m) ? "PhD" : /\bmba\b/.test(m) ? "MBA" : /master|grad school/.test(m) ? "Master's" : /undergrad|bachelor|freshman|sophomore|junior|senior year/.test(m) ? "Bachelor's" : "";
  const visa = /visa|sponsor|international student|\bopt\b|\bcpt\b|h-?1b|f-?1/.test(m);
  const anywhere = /anywhere|any (state|location|city)/.test(m);
  const payM = m.match(/\$?\s?(\d{2,3}(?:,\d{3})*|\d+(?:\.\d+)?)\s*(k)?\s*(?:\/|an?|per)\s*(hour|hr|month|mo|year|yr)/) || m.match(/(?:at least|over|above|min(?:imum)?)\s*\$\s?(\d+(?:,\d{3})*)(k)?/);
  let minPay = 0;
  if (payM) { const v = Number(payM[1].replace(/,/g, "")) * (payM[2] ? 1000 : 1); const per = payM[3] || (v > 300 ? (v > 20000 ? "year" : "month") : "hour"); minPay = Math.round(/^mo/.test(per) ? (v * 12) / 2080 : /^y/.test(per) ? v / 2080 : v); }
  const cyc = new Set(fresh ? [] : base.cycle || []);
  if (/\bco-?ops?\b/.test(m)) cyc.add("Co-op");
  if (/part[- ]time|during (the )?(school|semester|academic)|while (in|at) school/.test(m)) cyc.add("Part-time");
  if (/year[- ]round/.test(m)) cyc.add("Year-round");
  if (/\bcontract|temp(orary)?\b|freelance/.test(m)) cyc.add("Contract");
  for (const [re, label] of [[/\bfall\b|autumn/, "Fall"], [/\bspring\b/, "Spring"], [/\bwinter\b/, "Winter"]]) if (re.test(m) && !s?.[2]) cyc.add(label);
  const offCycle = /off[- ]?(cycle|season)|not (in )?(the )?summer|non[- ]summer|outside (of )?(the )?summer/.test(m) || (!/any (term|season|time)/.test(m) && !!base.offCycle);
  const kind = /full[- ]?time|new ?grad|entry[- ]level|after (i )?graduat|junior role|first job/.test(m) ? "Full-time" : /\bintern(ship)?s?\b|co-?op/.test(m) ? "Internship" : /both|either|any (role|job) type/.test(m) ? "" : base.kind ?? "Internship";
  return {
    kind,
    offCycle,
    cycle: /any (term|season|time)/.test(m) ? [] : [...cyc],
    minHourlyPay: minPay || (/any pay|unpaid ok/.test(m) ? 0 : base.minHourlyPay || 0),
    paidOnly: /\bpaid\b/.test(m) && !/unpaid/.test(m) ? true : !!base.paidOnly,
    reply: "",
    keywords: base.keywords || [],
    categories: categories.size ? [...categories] : base.categories || [],
    states: anywhere ? [] : states.size ? [...states] : base.states || [],
    remoteOnly: /not remote|in.?person|on.?site/.test(m) ? false : /remote/.test(m) || (!anywhere && !!base.remoteOnly),
    season: s ? s[0].replace(/^\w/, (c) => c.toUpperCase()) : /any (time|season)/.test(m) ? "" : base.season || "",
    degree: degree || base.degree || "",
    needsVisa: visa || !!base.needsVisa,
    companies: base.companies || [],
    postedWithinDays: days || (/any time|older/.test(m) ? 0 : base.postedWithinDays || 0),
  };
}

// ---------- resume: text -> profile used for ranking (only with an API key; the page has a
// local fallback). The resume text is not stored.
const Profile = z.object({
  name: z.string().describe("First name only, or empty"),
  skills: z.array(z.string()).describe("Concrete technical and domain skills, lowercase, most important first, max 40"),
  roles: z.array(z.string()).describe("Internship roles this person is a strong fit for, e.g. 'backend engineering', 'machine learning'"),
  categories: z.array(z.enum(CATEGORIES)).describe("Best-fitting internship categories, best first"),
  degree: z.enum(["", "Bachelor's", "Master's", "PhD", "MBA"]),
  major: z.string(),
  gradYear: z.number().describe("Expected graduation year, 0 if unknown"),
  states: z.array(z.string()).describe("Two-letter US states where they live or study"),
  summary: z.string().describe("One warm sentence to the student about what makes them a strong candidate"),
});
async function readResume(text) {
  const response = await anthropic.beta.messages.create({
    model: "claude-opus-5-5", max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: zodOutputFormat(Profile) },
    system: "You read a student's resume and describe what internships they are a strong fit for. Be specific and generous but accurate.",
    messages: [{ role: "user", content: text }],
  });
  if (response.stop_reason === "refusal") return null;
  return Profile.parse(JSON.parse(response.content.find((b) => b.type === "text")?.text));
}

// ---------- HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/jobs") {
      payload ||= gzipSync(JSON.stringify({
        jobs: published.map(({ sourceKey, firstSeen, alsoOn, listSeasons, ...j }) => j),
        status: { ...status, ai: !!anthropic },
      }));
      if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
        res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
        return res.end(payload);
      }
      return send(res, 200, JSON.parse(gunzipSync(payload)));
    }
    if (url.pathname === "/api/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const push = (fresh) => res.write(`data: ${JSON.stringify(fresh)}\n\n`);
      listeners.add(push);
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => { listeners.delete(push); clearInterval(ping); });
      return;
    }
    if (url.pathname === "/api/resume" && req.method === "POST") {
      let body = "";
      for await (const c of req) { body += c; if (body.length > 400_000) break; }
      const { text } = JSON.parse(body || "{}");
      if (!anthropic || !text) return send(res, 200, { profile: null });
      try { return send(res, 200, { profile: await readResume(String(text).slice(0, 60_000)) }); }
      catch (e) { console.error("[resume]", e.message); return send(res, 200, { profile: null }); }
    }
    if (url.pathname === "/api/chat" && req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      const { message, current } = JSON.parse(body || "{}");
      if (!message) return send(res, 400, { error: "message required" });
      try {
        return send(res, 200, await aiFilters(String(message).slice(0, 1000), current));
      } catch (e) {
        console.error("[chat]", e);
        return send(res, 200, heuristicFilters(message, current));
      }
    }
    const file = path.join(ROOT, "public", url.pathname === "/" ? "index.html" : path.normalize(url.pathname));
    if (!file.startsWith(path.join(ROOT, "public"))) return send(res, 403, "forbidden", "text/plain");
    return send(res, 200, await readFile(file), MIME[path.extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, "not found", "text/plain");
  }
}).listen(PORT, () => console.log(`InternScout on http://localhost:${PORT} (AI search: ${anthropic ? "Claude" : "keyword fallback"})`));

// Listings are saved to disk so a restart shows them immediately instead of starting empty.
const JOBS_FILE = path.join(ROOT, "data", "jobs.json");
const saveJobs = () => writeFile(JOBS_FILE, JSON.stringify([...jobs.values()])).catch(() => {});
try {
  for (const j of JSON.parse(await readFile(JOBS_FILE, "utf8"))) if (j?.id && j.term) jobs.set(j.id, j);
  if (jobs.size) { publish(); console.log(`[start] restored ${published.length} listings from disk`); }
} catch {}
setInterval(saveJobs, 5 * 60_000);

refresh();
setInterval(refresh, REFRESH_MS);
