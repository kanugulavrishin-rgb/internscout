// Finds Greenhouse, Lever and Ashby boards for employers we know by name but whose list
// entries link elsewhere (iCIMS, custom sites). Tries a few likely board names per company
// and keeps boards that exist and have open jobs. Run: node scripts/guess-boards.mjs
import { readFile, writeFile } from "node:fs/promises";

const LISTS = [
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2025-Internships/dev/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json",
];
const file = new URL("../companies.json", import.meta.url);
const companies = JSON.parse(await readFile(file, "utf8"));
const have = new Set(Object.values(companies).flat().map((b) => (typeof b === "string" ? b : b.slug || "").toLowerCase()).filter(Boolean));
const haveNames = new Set(Object.values(companies).flat().map((b) => (b.company || "").toLowerCase()).filter(Boolean));

const names = new Set();
for (const url of LISTS) {
  try { const r = await fetch(url); if (r.ok) for (const x of await r.json()) if (x.company_name) names.add(x.company_name.trim()); } catch {}
}
const candidates = [...names].filter((n) => !haveNames.has(n.toLowerCase()));
const slugsFor = (name) => {
  const base = name.toLowerCase().replace(/&/g, "and").replace(/\b(inc|llc|ltd|corp|corporation|co|company|group|holdings|technologies|the)\b\.?/g, "").replace(/[^a-z0-9 ]/g, "").trim();
  const words = base.split(/\s+/).filter(Boolean);
  return [...new Set([words.join(""), words.join("-"), words[0]].filter((s) => s && s.length > 2))];
};
const CHECK = {
  greenhouse: async (s) => (await json(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`))?.jobs?.length,
  lever: async (s) => { const j = await json(`https://api.lever.co/v0/postings/${s}?mode=json&limit=1`); return Array.isArray(j) ? j.length : 0; },
  ashby: async (s) => (await json(`https://api.ashbyhq.com/posting-api/job-board/${s}`))?.jobs?.length,
};
async function json(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); return r.ok ? r.json() : null; } catch { return null; }
}

const found = { greenhouse: [], lever: [], ashby: [] };
let i = 0, checked = 0;
await Promise.all(Array.from({ length: 16 }, async () => {
  while (i < candidates.length) {
    const name = candidates[i++];
    for (const slug of slugsFor(name)) {
      if (have.has(slug)) continue;
      let hit = false;
      for (const [type, check] of Object.entries(CHECK)) {
        checked++;
        if (await check(slug)) { found[type].push({ slug, company: name }); have.add(slug); hit = true; break; }
      }
      if (hit) break;
    }
  }
}));
for (const [type, list] of Object.entries(found)) companies[type] = [...(companies[type] || []), ...list];
await writeFile(file, JSON.stringify(companies, null, 1) + "\n");
console.log(`Checked ${checked} guesses for ${candidates.length} companies. Added:`, Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length])));
