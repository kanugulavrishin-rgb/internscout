// Finds career boards for finance employers (banks, boutiques, PE, hedge funds, asset managers,
// insurers, accounting, exchanges, fintech) and adds the ones that exist to companies.json.
// Tries Greenhouse, Lever, Ashby, SmartRecruiters and Workday (several hosts and site names).
// Run: node scripts/add-finance-boards.mjs
import { readFile, writeFile } from "node:fs/promises";

const FIRMS = `Goldman Sachs|JPMorgan Chase|Morgan Stanley|Bank of America|Citigroup|Wells Fargo|Truist|Barclays|Deutsche Bank|UBS|HSBC|RBC Capital Markets|BMO Capital Markets|TD Securities|Mizuho|Nomura|MUFG|SMBC Nikko|BNP Paribas|Societe Generale|Natixis|Santander|Macquarie|
Evercore|Lazard|Moelis|Houlihan Lokey|PJT Partners|Centerview|Perella Weinberg|Guggenheim Partners|Jefferies|Piper Sandler|Raymond James|Stifel|William Blair|Baird|TD Cowen|Oppenheimer|Needham|Cantor Fitzgerald|BTIG|KeyBanc Capital Markets|Rothschild|Stephens Inc|Lincoln International|Harris Williams|Kroll|FTI Consulting|Alvarez & Marsal|Huron|Marsh McLennan|Aon|Willis Towers Watson|
Blackstone|KKR|Carlyle|Apollo Global Management|TPG|Warburg Pincus|Bain Capital|Advent International|Thoma Bravo|Vista Equity Partners|General Atlantic|Silver Lake|Hellman & Friedman|EQT|Ares Management|Oaktree|Brookfield|Blue Owl|Golub Capital|HPS Investment Partners|Sixth Street|Hamilton Lane|StepStone|Neuberger Berman|Cerberus|Fortress Investment Group|Centerbridge|Leonard Green|Insight Partners|Tiger Global|Coatue|
Citadel|Citadel Securities|Jane Street|Two Sigma|D. E. Shaw|Millennium Management|Point72|Bridgewater|AQR|Renaissance Technologies|Hudson River Trading|Virtu|Susquehanna|Optiver|IMC Trading|DRW|Akuna Capital|Flow Traders|Jump Trading|Old Mission|Belvedere Trading|Wolverine Trading|Peak6|Five Rings|Tower Research|XTX Markets|Maven Securities|Cumberland|Radix Trading|Squarepoint|Balyasny|ExodusPoint|Schonfeld|Marshall Wace|Man Group|
BlackRock|Vanguard|Fidelity Investments|State Street|Northern Trust|BNY Mellon|T. Rowe Price|Invesco|Franklin Templeton|PIMCO|Nuveen|Charles Schwab|Capital Group|Wellington Management|Dimensional Fund Advisors|Janus Henderson|Principal Financial|Prudential Financial|MetLife|AIG|Allstate|Travelers|Chubb|Lincoln Financial|Nationwide|MassMutual|Northwestern Mutual|New York Life|Pacific Life|Voya|Transamerica|Liberty Mutual|Progressive|USAA|State Farm|Hartford|CNA Financial|Swiss Re|Munich Re|Guardian Life|Ameriprise|Edward Jones|LPL Financial|Betterment|Wealthfront|
Capital One|American Express|Discover|Synchrony|Ally Financial|PNC|U.S. Bancorp|Fifth Third|KeyCorp|Huntington|Regions|M&T Bank|Citizens Financial|First Citizens|Comerica|Zions|Synovus|Flagstar|BMO Harris|TD Bank|CIBC|First Horizon|Webster|Valley National|East West Bank|
Visa|Mastercard|PayPal|Block|Stripe|Plaid|Chime|Robinhood|Coinbase|SoFi|Affirm|Brex|Ramp|Mercury|Marqeta|Toast|Adyen|Wise|Klarna|Upstart|LendingClub|Carta|Addepar|Bloomberg|FactSet|Morningstar|MSCI|S&P Global|Moody's|Fitch Ratings|Nasdaq|CME Group|Intercontinental Exchange|Cboe|FIS|Fiserv|Broadridge|SS&C|Envestnet|Clearwater Analytics|Tradeweb|MarketAxess|DTCC|FINRA|
Deloitte|PwC|EY|KPMG|Grant Thornton|BDO|RSM|Crowe|Baker Tilly|Plante Moran|CohnReznick|Cherry Bekaert|Eide Bailly|Forvis Mazars|Moss Adams|CBIZ|EisnerAmper|Citrin Cooperman|Withum|Armanino|
Cresset|Mariner Wealth|Focus Financial|Creative Planning|Edelman Financial|Hightower|Fisher Investments|Carson Group|Savant Wealth|Beacon Pointe|Kestra|Commonwealth Financial|Osaic|Cetera|Wealth Enhancement Group|
Equifax|Global Payments|Ryan Specialty|Genworth|Primerica|Aflac|Unum|Cigna|Humana`.split("|").map((s) => s.trim()).filter(Boolean);

const file = new URL("../companies.json", import.meta.url);
const companies = JSON.parse(await readFile(file, "utf8"));
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const haveNames = new Set(Object.values(companies).flat().map((b) => norm(b.company || b.slug)));
const haveSlug = new Set(Object.entries(companies).flatMap(([t, l]) => l.map((b) => `${t}:${(b.slug || b.host + "/" + (b.site || "")).toLowerCase()}`)));

async function req(url, init) {
  try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) }); return r.ok ? r.json() : null; } catch { return null; }
}
const words = (n) => n.toLowerCase().replace(/&/g, "and").replace(/['.]/g, "").replace(/\b(inc|llc|ltd|corp|corporation|co|company|group|holdings|the|financial|management|partners|capital|global)\b/g, "").replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
// First-word slugs ("block", "apollo") belong to other companies too, so only whole-name slugs count.
const slugsOf = (name) => { const w = words(name); return [...new Set([w.join(""), w.join("-"), norm(name), ...(w.length === 1 ? w : [])].filter((s) => s && s.length > 3))]; };

const SITES = (t, cap) => ["External", "Careers", "careers", "External_Career_Site", "ExternalCareerSite", "External_Careers", "ExternalSite", "Jobs", "Campus", "Early_Careers", t, cap, `${cap}Careers`, `${cap}_Careers`, `${cap}External`, `${cap}ExternalCareerSite`];
const WD_HOSTS = ["wd1", "wd5", "wd3", "wd12", "wd501", "wd103", "wd2"];
const post = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 1, offset: 0, searchText: "" }) };

const found = { greenhouse: [], lever: [], ashby: [], smartrecruiters: [], workday: [] };
const probes = {
  greenhouse: async (s, name) => { const b = await req(`https://boards-api.greenhouse.io/v1/boards/${s}`); return b?.name && (norm(b.name).includes(norm(words(name).join(""))) || norm(name).includes(norm(b.name))) && (await req(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`))?.jobs?.length; },
  lever: async (s) => { const j = await req(`https://api.lever.co/v0/postings/${s}?mode=json&limit=1`); return Array.isArray(j) ? j.length : 0; },
  ashby: async (s) => (await req(`https://api.ashbyhq.com/posting-api/job-board/${s}`))?.jobs?.length,
  smartrecruiters: async (s) => (await req(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`))?.totalFound,
};
async function workday(name) {
  for (const t of slugsOf(name).slice(0, 3)) {
    const cap = t[0].toUpperCase() + t.slice(1);
    for (const wd of WD_HOSTS) {
      const host = `${t}.${wd}.myworkdayjobs.com`;
      // A tenant that exists answers 200/400/422 even for a wrong site name; a missing one doesn't resolve or 404s.
      const probe = await fetch(`https://${host}/wday/cxs/${t}/External/jobs`, { ...post, signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!probe || ![200, 400, 422].includes(probe.status)) continue;
      for (const site of SITES(t, cap)) {
        const j = await req(`https://${host}/wday/cxs/${t}/${site}/jobs`, post);
        if (j?.jobPostings) return { host, tenant: t, site, company: name };
      }
    }
  }
  return null;
}

let i = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  while (i < FIRMS.length) {
    const name = FIRMS[i++];
    if (haveNames.has(norm(name))) continue;
    let hit = false;
    for (const slug of slugsOf(name)) {
      for (const [type, check] of Object.entries(probes)) {
        if (haveSlug.has(`${type}:${slug.toLowerCase()}`)) continue;
        if (await check(slug, name)) { found[type].push({ slug, company: name }); haveSlug.add(`${type}:${slug}`); hit = true; console.log(type, slug, "<-", name); break; }
      }
      if (hit) break;
    }
    if (!hit) { const w = await workday(name); if (w && !haveSlug.has(`workday:${w.host}/${w.site}`)) { found.workday.push(w); haveSlug.add(`workday:${w.host}/${w.site}`); console.log("workday", w.host, w.site, "<-", name); } }
  }
}));
for (const [type, list] of Object.entries(found)) companies[type] = [...(companies[type] || []), ...list];
await writeFile(file, JSON.stringify(companies, null, 1) + "\n");
console.log("Added:", Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length])));
