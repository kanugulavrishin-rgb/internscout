// Probes many slug variants per firm across Greenhouse, Lever, Ashby, Workable and SmartRecruiters,
// and keeps a board only when it has jobs AND its company name / job text clearly names the firm.
// Usage: node scripts/probe-slugs.mjs [--write] [--only=jane,citadel] [--out=file.json]
//   --write  add verified boards to companies.json (no duplicates)
// Firm line format: Name ; match keys (comma, normalized substrings that must appear) ; extra slugs (comma)
import { readFile, writeFile } from "node:fs/promises";

const FIRMS = `
Jane Street ; janestreet ; janestreet,jane-street,janestreetcapital
Hudson River Trading ; hudsonrivertrading,hrt ; hudsonrivertrading,hrt,hudson-river-trading,wehrtyou
Jump Trading ; jumptrading,jump trading ; jumptrading,jump-trading,jump
DRW ; drw ; drweng,drw,drwholdings,drw-trading
Optiver ; optiver ; optiver,optiverus,optiver-us
IMC Trading ; imc ; imc,imctrading,imc-trading,imcfinancialmarkets
Susquehanna International Group ; susquehanna,sig ; sig,susquehanna,susquehannainternationalgroup,susquehanna-international-group
Citadel ; citadel ; citadel,citadelllc,citadel-llc
Citadel Securities ; citadelsecurities,citadel securities ; citadelsecurities,citadel-securities
Two Sigma ; twosigma,two sigma ; twosigma,two-sigma,twosigmainvestments
D. E. Shaw ; deshaw,d. e. shaw,d.e. shaw ; deshaw,de-shaw,deshawresearch
Millennium Management ; millennium ; millennium,millenniummanagement,mlp
Point72 ; point72 ; point72,point72llc,cubist,cubistsystematic
Balyasny Asset Management ; balyasny,bam ; balyasny,bamfunds,balyasnyassetmanagement
Akuna Capital ; akuna ; akunacapital,akuna,akuna-capital
Five Rings ; fiverings,five rings ; fiveringsllc,fiverings,five-rings,fiveringscapital
Old Mission Capital ; oldmission,old mission ; oldmission,oldmissioncapital,old-mission
Belvedere Trading ; belvedere ; belvederetrading,belvedere,belvedere-trading
Virtu Financial ; virtu ; virtu,virtufinancial,virtu-financial
Tower Research Capital ; tower research ; towerresearchcapital,tower-research-capital,towerresearch
XTX Markets ; xtx ; xtxmarkets,xtx,xtx-markets
Radix Trading ; radix ; radixtrading,radix,radix-trading
Wolverine Trading ; wolverine ; wolverinetrading,wolverine,wolverine-trading,wolverinetradingllc
Flow Traders ; flowtraders,flow traders ; flowtraders,flow-traders
PDT Partners ; pdt ; pdtpartners,pdt,pdt-partners
Voleon Group ; voleon ; voleon,thevoleongroup,voleongroup
Squarepoint Capital ; squarepoint ; squarepoint,squarepointcapital,squarepoint-capital
WorldQuant ; worldquant ; worldquant,world-quant
Bridgewater Associates ; bridgewater ; bridgewater,bridgewater89,bridgewaterassociates
AQR Capital Management ; aqr ; aqr,aqrcapital,aqrcapitalmanagement
Man Group ; man group,mangroup,man ahl,ahl ; mangroup,man-group,man,mangroupplc
Renaissance Technologies ; renaissance tech ; rentec,renaissancetechnologies
Peak6 ; peak6 ; peak6,peak6investments
Schonfeld ; schonfeld ; schonfeld,schonfeldstrategicadvisors
ExodusPoint ; exoduspoint ; exoduspoint,exoduspointcapital
Marshall Wace ; marshallwace,marshall wace ; marshallwace,marshall-wace
Maven Securities ; maven securities ; mavensecurities,maven-securities
Cumberland DRW ; cumberland ; cumberland,cumberlanddrw
Quadrature Capital ; quadrature ; quadrature,quadraturecapital
Hap Capital ; hap capital ; hapcapital
Geneva Trading ; geneva trading ; genevatrading,geneva-trading
Chicago Trading Company ; chicago trading ; chicagotrading,ctc,chicagotradingcompany
Headlands Technologies ; headlands ; headlandstech,headlandstechnologies,headlands
Engineers Gate ; engineers gate ; engineersgate,engineers-gate
Jain Global ; jain global ; jainglobal
Verition Fund Management ; verition ; verition,veritionfundmanagement
Walleye Capital ; walleye ; walleye,walleyecapital
Hudson Bay Capital ; hudson bay ; hudsonbaycapital,hudsonbay
Ares Management ; ares ; aresmanagement,ares,ares-management,aresmgmt
Blue Owl Capital ; blue owl,blueowl ; blueowl,blueowlcapital,blue-owl
HPS Investment Partners ; hps ; hps,hpsinvestmentpartners,hpsinvestment
Golub Capital ; golub ; golubcapital,golub,golub-capital
Antares Capital ; antares ; antarescapital,antares,antares-capital
Churchill Asset Management ; churchill ; churchill,churchillassetmanagement,churchillam
Sixth Street ; sixth street ; sixthstreet,sixth-street,sixthstreetpartners
Oaktree Capital ; oaktree ; oaktree,oaktreecapital,oaktree-capital
Apollo Global Management ; apollo global,apollo ; apollo,apolloglobal,apollomanagement,apolloglobalmanagement
KKR ; kkr ; kkr,kkrcareers
Blackstone ; blackstone ; blackstone,blackstonegroup
TPG ; tpg ; tpg,tpgcapital
Brookfield ; brookfield ; brookfield,brookfieldasset,brookfieldam
Carlyle ; carlyle ; carlyle,carlylegroup,thecarlylegroup
Bain Capital ; bain capital ; baincapital,bain-capital
Warburg Pincus ; warburg ; warburgpincus,warburg-pincus
General Atlantic ; general atlantic ; generalatlantic,general-atlantic
Thoma Bravo ; thoma bravo ; thomabravo,thoma-bravo
Vista Equity Partners ; vista equity ; vistaequitypartners,vistaequity
Silver Lake ; silver lake ; silverlake,silver-lake
Advent International ; advent ; adventinternational,advent
Cerberus Capital Management ; cerberus ; cerberus,cerberuscapital
Fortress Investment Group ; fortress ; fortress,fortressinvestmentgroup
Centerbridge Partners ; centerbridge ; centerbridge,centerbridgepartners
Leonard Green & Partners ; leonard green ; leonardgreen,leonardgreenpartners
Hamilton Lane ; hamilton lane ; hamiltonlane,hamilton-lane
StepStone Group ; stepstone ; stepstone,stepstonegroup,stepstone-group
Neuberger Berman ; neuberger ; neubergerberman,neuberger-berman,nb
PGIM ; pgim ; pgim,pgiminc
Wellington Management ; wellington management ; wellington,wellingtonmanagement
T. Rowe Price ; rowe price ; troweprice,t-rowe-price,trowe
Franklin Templeton ; franklin templeton,franklin resources ; franklintempleton,franklin-templeton,franklinresources
Cresset ; cresset ; cresset,cressetcapital
Evercore ; evercore ; evercore,evercoreinc
Lazard ; lazard ; lazard,lazardinc
Moelis & Company ; moelis ; moelis,moelisandcompany
PJT Partners ; pjt ; pjt,pjtpartners
Centerview Partners ; centerview ; centerview,centerviewpartners
Perella Weinberg Partners ; perella ; perellaweinberg,pwp,perellaweinbergpartners
Houlihan Lokey ; houlihan ; houlihanlokey,houlihan-lokey,hl
Jefferies ; jefferies ; jefferies,jefferiesgroup
Piper Sandler ; piper sandler ; pipersandler,piper-sandler
William Blair ; william blair ; williamblair,william-blair
Guggenheim Partners ; guggenheim ; guggenheim,guggenheimpartners
Robert W. Baird ; baird ; baird,rwbaird,robertwbaird
Cowen ; cowen ; cowen,tdcowen
BTIG ; btig ; btig
Stephens Inc ; stephens ; stephens,stephensinc
Raymond James ; raymond james ; raymondjames,raymond-james
Lincoln International ; lincoln international ; lincolninternational,lincoln-international
Harris Williams ; harris williams ; harriswilliams,harris-williams
Stifel ; stifel ; stifel,stifelfinancial
Oppenheimer ; oppenheimer ; oppenheimer,oppenheimerco
Needham & Company ; needham ; needham,needhamandcompany
Cantor Fitzgerald ; cantor ; cantor,cantorfitzgerald
KeyBanc Capital Markets ; keybanc ; keybanc,keybanccapitalmarkets
Rothschild & Co ; rothschild ; rothschild,rothschildandco
Jefferies Finance ; jefferies ; jefferiesfinance
Macquarie ; macquarie ; macquarie,macquariegroup
Mizuho ; mizuho ; mizuho,mizuhoamericas
Nomura ; nomura ; nomura,nomuraamerica
Barclays ; barclays ; barclays,barclaysus
Deutsche Bank ; deutsche bank ; deutschebank,deutsche-bank
UBS ; ubs ; ubs,ubsgroup
BNP Paribas ; bnp ; bnpparibas,bnp-paribas
Societe Generale ; societe generale ; societegenerale,socgen
Natixis ; natixis ; natixis
RBC Capital Markets ; rbc ; rbc,rbccm
BMO ; bmo ; bmo,bmocm
TD Securities ; td securities,td bank ; tdsecurities,td
Wells Fargo ; wells fargo ; wellsfargo,wells-fargo
Morgan Stanley ; morgan stanley ; morganstanley,morgan-stanley
Goldman Sachs ; goldman ; goldmansachs,goldman-sachs,goldman
JPMorgan Chase ; jpmorgan ; jpmorgan,jpmorganchase,jpmc
Citi ; citi ; citi,citigroup
Truist ; truist ; truist,truistfinancial
Kalshi ; kalshi ; kalshi
Polymarket ; polymarket ; polymarket
Robinhood ; robinhood ; robinhood,robinhoodmarkets
Plaid ; plaid ; plaid
Ramp ; ramp ; ramp
Brex ; brex ; brex
Mercury ; mercury ; mercury,mercuryfinancial,mercury-technologies
Stripe ; stripe ; stripe
Databricks ; databricks ; databricks
Snowflake ; snowflake ; snowflake,snowflakecomputing
Palantir ; palantir ; palantir,palantirtechnologies
Scale AI ; scale ; scaleai,scale-ai,scale
Datadog ; datadog ; datadog
Coinbase ; coinbase ; coinbase
Chime ; chime ; chime
SoFi ; sofi ; sofi
Affirm ; affirm ; affirm
Marqeta ; marqeta ; marqeta
Carta ; carta ; carta
Addepar ; addepar ; addepar
Anchorage Digital ; anchorage ; anchorage,anchoragedigital
Fireblocks ; fireblocks ; fireblocks
Kraken ; kraken ; kraken,krakenfx,kraken-digital-asset-exchange
Gemini ; gemini ; gemini,geminitrust
Circle ; circle ; circle,circlefinancial
Ripple ; ripple ; ripple
Chainalysis ; chainalysis ; chainalysis
Alchemy ; alchemy ; alchemy,alchemyplatform
Betterment ; betterment ; betterment
Wealthfront ; wealthfront ; wealthfront
Toast ; toast ; toast,toasttab
Bill.com ; bill ; bill,billcom
Navan ; navan ; navan,tripactions
Rippling ; rippling ; rippling
Gusto ; gusto ; gusto
Deel ; deel ; deel
Airtable ; airtable ; airtable
Figma ; figma ; figma
Notion ; notion ; notion,notionhq
OpenAI ; openai ; openai
Anthropic ; anthropic ; anthropic
Anduril ; anduril ; anduril,andurilindustries
Verkada ; verkada ; verkada
Samsara ; samsara ; samsara
Flexport ; flexport ; flexport
Instacart ; instacart ; instacart,maplebear
DoorDash ; doordash ; doordash
Reddit ; reddit ; reddit,redditinc
Pinterest ; pinterest ; pinterest
Lyft ; lyft ; lyft
Cloudflare ; cloudflare ; cloudflare
MongoDB ; mongodb ; mongodb
Confluent ; confluent ; confluent
Elastic ; elastic ; elastic
Okta ; okta ; okta
Twilio ; twilio ; twilio
Dropbox ; dropbox ; dropbox
Asana ; asana ; asana
Vercel ; vercel ; vercel
Mixpanel ; mixpanel ; mixpanel
Amplitude ; amplitude ; amplitude
Fivetran ; fivetran ; fivetran
dbt Labs ; dbt ; dbtlabsinc,dbtlabs,dbt-labs
Hex ; hex ; hextechnologies,hex
Mode Analytics ; mode ; mode,modeanalytics
Tradeweb ; tradeweb ; tradeweb
MarketAxess ; marketaxess ; marketaxess
Clearwater Analytics ; clearwater ; clearwateranalytics,clearwater
SS&C ; ss&c,ssc ; ssc,ssandc,ssctech
Broadridge ; broadridge ; broadridge
FactSet ; factset ; factset
Morningstar ; morningstar ; morningstar
MSCI ; msci ; msci
S&P Global ; s&p global ; spglobal,sandpglobal
Moody's ; moody ; moodys,moody
Nasdaq ; nasdaq ; nasdaq
CME Group ; cme ; cmegroup,cme
Cboe ; cboe ; cboe,cboeglobalmarkets
BlackRock ; blackrock ; blackrock
Vanguard ; vanguard ; vanguard
State Street ; state street ; statestreet,state-street
Northern Trust ; northern trust ; northerntrust
Invesco ; invesco ; invesco
PIMCO ; pimco ; pimco
Nuveen ; nuveen ; nuveen
Capital Group ; capital group ; capitalgroup
Janus Henderson ; janus ; janushenderson,janus-henderson
Dimensional Fund Advisors ; dimensional ; dimensional,dfa
Fisher Investments ; fisher investments ; fisherinvestments
Mariner Wealth Advisors ; mariner ; mariner,marinerwealthadvisors
Focus Financial Partners ; focus financial ; focusfinancial,focusfinancialpartners
Creative Planning ; creative planning ; creativeplanning
Hightower ; hightower ; hightower,hightoweradvisors
Kroll ; kroll ; kroll
FTI Consulting ; fti ; fticonsulting,fti
Alvarez & Marsal ; alvarez ; alvarezandmarsal,alvarezmarsal
Huron Consulting ; huron ; huron,huronconsulting
`.trim().split("\n").map((l) => l.split(";").map((s) => s.trim())).filter((p) => p[0]);

const file = new URL("../companies.json", import.meta.url);
const companies = JSON.parse(await readFile(file, "utf8"));
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).toLowerCase().split(",").filter(Boolean);
const outFile = (args.find((a) => a.startsWith("--out=")) || "").slice(6);
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function req(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "internscout-probe/1.0", accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function slugVariants(name, extra) {
  const base = name.toLowerCase().replace(/&/g, "and").replace(/[.'’,]/g, "");
  const words = base.split(/\s+/).filter(Boolean);
  const joined = words.join(""), hy = words.join("-");
  const set = new Set([joined, hy, ...extra]);
  for (const suf of ["capital", "llc", "inc", "group", "careers", "jobs", "us", "usa", "trading", "securities", "partners", "management"]) { set.add(joined + suf); set.add(hy + "-" + suf); }
  set.add(joined + "1"); // some boards use numeric tails
  return [...set].filter((s) => s.length > 1);
}

const textHas = (keys, s) => { const n = norm(s); return keys.some((k) => n.includes(norm(k))); };
// Count of jobs whose own text names the firm; at least 2 (or half of tiny boards) must.
const mostlyAbout = (keys, texts) => { const hits = texts.filter((t) => textHas(keys, t)).length; return hits >= Math.min(2, texts.length) && hits / texts.length >= 0.3; };

const PROBES = {
  greenhouse: async (s, keys) => {
    const b = await req(`https://boards-api.greenhouse.io/v1/boards/${s}`);
    if (!b?.name || !textHas(keys, b.name)) return null; // board name must name the firm
    const j = await req(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`);
    return j?.jobs?.length ? { company: b.name, jobs: j.jobs.length } : null;
  },
  lever: async (s, keys) => {
    const j = await req(`https://api.lever.co/v0/postings/${s}?mode=json`);
    if (!Array.isArray(j) || !j.length) return null;
    const texts = j.slice(0, 25).map((p) => `${p.descriptionPlain || ""} ${p.additionalPlain || ""} ${p.hostedUrl || ""}`);
    return mostlyAbout(keys, texts) ? { jobs: j.length } : null;
  },
  ashby: async (s, keys) => {
    const j = await req(`https://api.ashbyhq.com/posting-api/job-board/${s}`);
    if (!j?.jobs?.length) return null;
    const texts = j.jobs.slice(0, 25).map((p) => `${p.descriptionPlain || ""} ${p.jobUrl || ""}`);
    return mostlyAbout(keys, texts) ? { jobs: j.jobs.length } : null;
  },
  workable: async (s, keys) => {
    const j = await req(`https://apply.workable.com/api/v1/widget/accounts/${s}`);
    if (!j?.jobs?.length || !textHas(keys, j.name || "")) return null;
    return { company: j.name, jobs: j.jobs.length };
  },
  smartrecruiters: async (s, keys) => {
    const j = await req(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`);
    if (!j?.content?.length) return null;
    const names = j.content.map((p) => p.company?.name || "");
    const ok = names.filter((n) => textHas(keys, n)).length;
    return ok >= Math.ceil(names.length / 2) ? { company: names.find((n) => textHas(keys, n)), jobs: j.totalFound } : null;
  },
};

const tasks = [];
for (const [name, keyStr, slugStr] of FIRMS) {
  if (only.length && !only.some((o) => name.toLowerCase().includes(o))) continue;
  const keys = keyStr.split(",").map((s) => s.trim()).filter(Boolean);
  const extra = (slugStr || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const slug of slugVariants(name, extra)) for (const ats of Object.keys(PROBES)) tasks.push({ name, keys, slug, ats });
}
console.error(`${FIRMS.length} firms, ${tasks.length} probes`);

const hits = [];
let next = 0, done = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < tasks.length) {
    const t = tasks[next++];
    const r = await PROBES[t.ats](t.slug, t.keys);
    if (r) { hits.push({ ...t, ...r }); console.error(`HIT ${t.ats}:${t.slug} -> ${t.name} (${r.jobs} jobs)`); }
    if (++done % 1000 === 0) console.error(`...${done}/${tasks.length}`);
  }
}));

// One board per firm per ATS: prefer the one with most jobs.
const best = new Map();
for (const h of hits) { const k = `${h.name}|${h.ats}`; if (!best.has(k) || h.jobs > best.get(k).jobs) best.set(k, h); }
const final = [...best.values()];
if (outFile) await writeFile(outFile, JSON.stringify(final, null, 1));

const have = new Set(Object.entries(companies).flatMap(([t, l]) => l.map((b) => `${t}:${(b.slug || "").toLowerCase()}`)));
let added = 0;
const byAts = {};
for (const h of final) {
  if (have.has(`${h.ats}:${h.slug.toLowerCase()}`)) { console.log(`exists  ${h.ats}:${h.slug} (${h.name})`); continue; }
  console.log(`NEW     ${h.ats}:${h.slug} -> ${h.name} (${h.jobs} jobs)`);
  if (args.includes("--write")) {
    (companies[h.ats] ||= []).push({ slug: h.slug, company: h.name });
    byAts[h.ats] = (byAts[h.ats] || 0) + 1; added++;
  }
}
if (args.includes("--write") && added) { await writeFile(file, JSON.stringify(companies, null, 1) + "\n"); console.log("Added", byAts); }
