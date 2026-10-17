// Finds employer job boards to monitor. Every application link in the community internship
// and new-grad lists (current and past entries) names the employer's applicant tracking
// system; we collect those boards and poll them directly, which surfaces internships the
// lists never picked up. Run: node scripts/discover.mjs   (merges into companies.json)
import { readFile, writeFile } from "node:fs/promises";

const LISTS = [
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2025-Internships/dev/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2024-Internships/dev/.github/scripts/listings.json",
];
// Markdown lists: every link in them is checked for an applicant tracking system.
const READMES = [
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/master/README.md",
  "https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md",
  "https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/NEW_GRAD_USA.md",
  "https://raw.githubusercontent.com/zapplyjobs/Internships-2026/main/README.md",
  "https://raw.githubusercontent.com/northwesternfintech/2027QuantInternships/main/README.md",
  ...["Software-Engineer", "Business-Analyst", "Data-Analysis", "Engineer", "Product-Management", "Marketing", "Design", "Accounting", "Finance"].map((r) => `https://raw.githubusercontent.com/jobright-ai/2026-${r}-Internship/master/README.md`),
];
const file = new URL("../companies.json", import.meta.url);
const current = JSON.parse(await readFile(file, "utf8"));

const boards = { jobvite: new Map(), jazzhr: new Map(), greenhouse: new Map(), lever: new Map(), ashby: new Map(), smartrecruiters: new Map(), workable: new Map(), workday: new Map(), oracle: new Map(), icims: new Map(), jibe: new Map(), eightfold: new Map(), rippling: new Map() };
const add = (type, key, value) => { if (!boards[type].has(key)) boards[type].set(key, value); };
// keep everything already configured
for (const [type, list] of Object.entries(current)) for (const v of list) {
  const o = typeof v === "string" ? { slug: v } : v;
  add(type, (o.slug || (o.site ? `${o.host}|${o.site}` : o.host)).toLowerCase(), o);
}

let seen = 0;
const entries = [];
for (const url of LISTS) {
  try { const r = await fetch(url); if (r.ok) entries.push(...(await r.json())); } catch {}
}
for (const url of READMES) {
  try {
    const r = await fetch(url); if (!r.ok) continue;
    for (const m of (await r.text()).matchAll(/https?:\/\/[^\s)"'<>\]|]+/g)) entries.push({ url: m[0], company_name: undefined });
  } catch {}
}
{
  for (const x of entries) {
    let u; try { u = new URL(x.url); } catch { continue; }
    seen++;
    const h = u.hostname.toLowerCase(), p = u.pathname.split("/").filter(Boolean), company = x.company_name;
    if (/(^|\.)greenhouse\.io$/.test(h) && p[0] && !["embed", "v1"].includes(p[0])) add("greenhouse", p[0].toLowerCase(), { slug: p[0].toLowerCase(), company });
    else if (h === "boards.greenhouse.io" && u.searchParams.get("for")) add("greenhouse", u.searchParams.get("for").toLowerCase(), { slug: u.searchParams.get("for").toLowerCase(), company });
    else if (h === "jobs.lever.co" && p[0]) add("lever", p[0].toLowerCase(), { slug: p[0].toLowerCase(), company });
    else if (h === "jobs.ashbyhq.com" && p[0]) add("ashby", decodeURIComponent(p[0]).toLowerCase(), { slug: decodeURIComponent(p[0]), company });
    else if (h === "jobs.smartrecruiters.com" && p[0]) add("smartrecruiters", p[0].toLowerCase(), { slug: p[0], company });
    else if (h === "apply.workable.com" && p[0] && p[0] !== "j") add("workable", p[0].toLowerCase(), { slug: p[0].toLowerCase(), company });
    else if (/\.myworkdayjobs\.com$/.test(h)) {
      let site = p[0]; if (/^[a-z]{2}-[A-Z]{2}$/.test(site || "")) site = p[1];
      if (site && site !== "job") add("workday", `${h}|${site}`.toLowerCase(), { host: h, tenant: h.split(".")[0], site, company });
    } else if (/\.myworkdaysite\.com$/.test(h) && p[0] === "recruiting" && p[1] && p[2]) {
      add("workday", `${h}|${p[2]}`.toLowerCase(), { host: h, tenant: p[1], site: p[2], company });
    } else if (/\.icims\.com$/.test(h) && p[0] === "jobs") {
      add("icims", h, { host: h, company });
    } else if (u.searchParams.has("icims") && p[0] === "jobs") {
      add("jibe", h, { host: h, company }); // iCIMS career sites on the company's own domain
    } else if (/\.eightfold\.ai$/.test(h) || h === "apply.careers.microsoft.com") {
      const domain = u.searchParams.get("domain") || (h === "apply.careers.microsoft.com" ? "microsoft.com" : h.split(".")[0] + ".com");
      add("eightfold", h, { host: h, domain, company });
    } else if (h === "ats.rippling.com" && p[0]) {
      const slug = /^[a-z]{2}-[A-Z]{2}$/.test(p[0]) ? p[1] : p[0];
      if (slug) add("rippling", slug.toLowerCase(), { slug, company });
    } else if (h === "jobs.jobvite.com" && p[0]) {
      add("jobvite", p[0].toLowerCase(), { slug: p[0].toLowerCase(), company });
    } else if (/\.applytojob\.com$/.test(h)) {
      const slug = h.split(".")[0]; add("jazzhr", slug, { slug, company });
    } else if (/\.oraclecloud\.com$/.test(h) && p.includes("sites")) {
      const site = p[p.indexOf("sites") + 1];
      if (site) add("oracle", `${h}|${site}`.toLowerCase(), { host: h, site, company });
    }
  }
}
const out = Object.fromEntries(Object.entries(boards).map(([k, m]) => [k, [...m.values()]]));
await writeFile(file, JSON.stringify(out, null, 1) + "\n");
console.log(`Read ${seen} links. Monitoring:`, Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), "total", Object.values(out).reduce((n, v) => n + v.length, 0));
