// Merges public directories of employer job boards into companies.json.
// Sources (both list boards that were confirmed against each system's public API):
//   Feashliaa/job-board-aggregator  data/*_companies.json
//   groundtruthtools/ats-jobs-mcp   src/ats_jobs_mcp/directory.json
// Run: node scripts/import-directories.mjs
import { readFile, writeFile } from "node:fs/promises";

const FEASH = "https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/";
const file = new URL("../companies.json", import.meta.url);
const companies = JSON.parse(await readFile(file, "utf8"));

const keyOf = (type, b) => (typeof b === "string" ? b : b.slug || (b.site ? `${b.host}|${b.site}` : b.host || b.guid) || "").toLowerCase();
const known = Object.fromEntries(Object.entries(companies).map(([t, list]) => [t, new Set(list.map((b) => keyOf(t, b)))]));
const added = {};
function add(type, board) {
  companies[type] ||= []; known[type] ||= new Set();
  const k = keyOf(type, board);
  if (!k || known[type].has(k)) return;
  known[type].add(k); companies[type].push(board); added[type] = (added[type] || 0) + 1;
}
const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };

for (const s of await get(FEASH + "greenhouse_companies.json")) add("greenhouse", { slug: s.toLowerCase() });
for (const s of await get(FEASH + "lever_companies.json")) add("lever", { slug: s.toLowerCase() });
for (const s of await get(FEASH + "ashby_companies.json")) add("ashby", { slug: s });
for (const s of await get(FEASH + "bamboohr_companies.json")) add("bamboohr", { slug: s.toLowerCase() });
for (const s of await get(FEASH + "icims_companies.json")) add("icims", { host: `${s.replace(/^-+/, "").toLowerCase()}.icims.com` });
for (const row of await get(FEASH + "workday_companies.json")) {
  const [tenant, wd, site] = row.split("|");
  if (tenant && wd && site) add("workday", { host: `${tenant}.${wd}.myworkdayjobs.com`, tenant, site });
}
for (const c of await get(FEASH + "paylocity_companies_clean.json")) if (c.jobs > 0) add("paylocity", { guid: c.guid, company: c.name });
const gt = await get("https://raw.githubusercontent.com/groundtruthtools/ats-jobs-mcp/main/src/ats_jobs_mcp/directory.json");
for (const b of gt.boards) if (b.ats === "greenhouse" || b.ats === "ashby" || b.ats === "lever") add(b.ats, { slug: b.ats === "ashby" ? b.board : b.board.toLowerCase(), ...(b.company ? { company: b.company } : {}) });

await writeFile(file, JSON.stringify(companies, null, 1) + "\n");
const total = Object.values(companies).reduce((n, v) => n + v.length, 0);
console.log("Added:", added, "\nNow monitoring:", Object.fromEntries(Object.entries(companies).map(([k, v]) => [k, v.length])), "total", total);
