// Career tracks: the specific job families people search for, assigned from a posting's title
// and employer. A job can belong to several (a "Technical Product Manager" is also a "Product
// Manager"). The broader `category` field stays; tracks are the sharper lens.

export const TRACKS = [
  { id: "finance", label: "Finance", group: "Finance", hint: "Corporate finance, FP&A, treasury, financial analyst, strategic and project finance" },
  { id: "ib", label: "Investment Banking", group: "Finance", hint: "M&A, leveraged finance, capital markets, restructuring, coverage groups" },
  { id: "er", label: "Equity Research", group: "Finance", hint: "Sell-side and buy-side research analysts and associates" },
  { id: "privcredit", label: "Private Credit", group: "Finance", hint: "Direct lending, middle-market credit, private debt, special situations" },
  { id: "altcredit", label: "Alternative Credit", group: "Finance", hint: "Asset-based finance, structured credit, specialty finance, distressed" },
  { id: "altinv", label: "Alternative Investments", group: "Finance", hint: "Private equity, hedge funds, venture, real assets, family offices, fund investing" },
  { id: "st", label: "Sales & Trading", group: "Markets", hint: "Sales, trading, structuring and strats across rates, credit, FX, equities, commodities" },
  { id: "quant", label: "Quant Trading", group: "Markets", hint: "Quantitative trading and research, algorithmic and systematic strategies" },
  { id: "datasci", label: "Data Science", group: "Data & Product", hint: "Data scientists, machine learning and applied scientists, decision science" },
  { id: "dataeng", label: "Data Engineering", group: "Data & Product", hint: "Pipelines, warehouses, analytics engineering, data platforms" },
  { id: "dataan", label: "Data Analytics", group: "Data & Product", hint: "Data, BI, insights, product and business analysts" },
  { id: "pm", label: "Product Management", group: "Data & Product", hint: "Product managers, associate PMs, product owners" },
  { id: "tpm", label: "Technical PM", group: "Data & Product", hint: "Technical, platform, API, data and AI product managers and technical program managers" },
  { id: "prodstrat", label: "Product Strategy", group: "Data & Product", hint: "Product strategy and operations, strategy & operations, business strategy, chief of staff" },
];
export const TRACK_IDS = TRACKS.map((t) => t.id);

// Employers whose generic "Analyst" or "Associate" openings belong to a track.
const BOUTIQUE = /\b(evercore|lazard|moelis|houlihan|pjt|centerview|perella|guggenheim|jefferies|piper sandler|william blair|cowen|td securities|lincoln international|harris williams|rothschild|greenhill|qatalyst|raine|solomon partners|keefe|kbw|roth capital|b\.? riley|truist securities)\b/i;
const ALT_MANAGER = /\b(blackstone|kkr|apollo|carlyle|tpg|ares|blue owl|owl rock|hps|golub|antares|churchill|sixth street|oaktree|brookfield|bain capital|warburg|hellman|thoma bravo|vista equity|general atlantic|silver lake|eqt|advent|clayton dubilier|cerberus|fortress|angelo gordon|monroe capital|crescent|benefit street|barings|comvest|twin brook|kayne anderson|marathon asset|new mountain|audax|neuberger|hamilton lane|stepstone|partners group|ardian|permira|cvc|insight partners|tiger global|coatue|general catalyst|andreessen|sequoia|lightspeed|accel|bessemer|ta associates|summit partners|francisco partners|leonard green|stone point|genstar|kelso|harvest|wafra|lone star|starwood|nuveen|pgim|pimco|wellington|capital group|bridgewater|millennium|balyasny|point72|citadel|exodus|schonfeld|elliott|third point|viking|lone pine|maverick|d1 capital|soroban|marshall wace|man group|aqr|two sigma|d\.? ?e\.? shaw|renaissance)\b/i;
const CREDIT_MANAGER = /\b(ares|blue owl|owl rock|hps|golub|antares|churchill|sixth street|oaktree|monroe capital|crescent|benefit street|barings|comvest|twin brook|kayne anderson|marathon asset|cerberus|fortress|angelo gordon|new mountain|audax|apollo|carlyle|bain capital credit|silver point|brightwood|varagon|maranon|stellus|medalist|bluebay|ellington|anchorage|davidson kempner)\b/i;
const CREDIT_PURE = /\b(ares|blue owl|owl rock|hps|golub|antares|churchill|sixth street|monroe capital|crescent|benefit street|comvest|twin brook|kayne anderson|new mountain|audax|silver point|brightwood|varagon|maranon|stellus|medalist|davidson kempner|anchorage|ellington)\b/i;
const PROP = /\b(jane street|hudson river|hrt|jump trading|drw|optiver|imc|susquehanna|sig|citadel securities|akuna|virtu|tower research|five rings|old mission|flow traders|xtx|radix|wolverine|belvedere|pdt partners|voleon|two sigma|d\.? ?e\.? shaw|millennium|squarepoint|worldquant|qube|aqr|renaissance|cubist|balyasny|exodus|schonfeld|gsa capital|man group|marshall wace|cfm|winton|g-research|alphagrep|headlands|dv trading|geneva trading|simplex|mako|jain global|tradelink|chicago trading|peak6|vatic|gresham|volant|spot trading|trexquant|kershner|quantbot|capula|point72|citadel)\b/i;


// Employers that are financial firms; weak title patterns ("research analyst", "credit analyst")
// only count here, so a research assistant at a sports-equipment company is not equity research.
const FIN_CO = /\b(goldman|jpmorgan|j\.p\. morgan|morgan stanley|bank of america|bofa|citi|citigroup|wells fargo|truist|pnc|u\.?s\.? bank|barclays|deutsche|ubs|hsbc|rbc|bmo|mizuho|nomura|mufg|smbc|cibc|macquarie|santander|bnp|natixis|societe generale|credit suisse|blackrock|vanguard|fidelity|state street|t\.? rowe|invesco|franklin|schwab|morningstar|msci|s&p global|moody|factset|wellington|capital group|pimco|nuveen|northern trust|bny|raymond james|stifel|baird|oppenheimer|edward jones|ameriprise|janus|lord abbett|dimensional|loomis|\bmfs\b|neuberger|pgim|prudential|metlife|new york life|mass ?mutual|northwestern mutual|principal financial|lincoln financial|aig|susquehanna|capital one|american express|discover|synchrony|ally|nasdaq|\bcme\b|\bice\b|cboe|fhlb|federal reserve|fannie|freddie|farmer mac)\b/i;
const finCo = (co) => BOUTIQUE.test(co) || ALT_MANAGER.test(co) || FIN_CO.test(co);

const SWE = /\b(software|swe|devops|sre|front[- ]?end|back[- ]?end|full[- ]?stack|mobile|ios|android|site reliability|firmware|hardware|security engineer|qa|test engineer|network engineer)\b/i;
const GENERIC_JUNIOR = /^(?:(?:summer|full[- ]time|spring|fall|winter|20\d\d)\s+)*(?:(?:investment|financial|junior|graduate|campus|early career|rotational)\s+)?(?:analyst|associate|summer analyst|summer associate|intern|analyst program|associate program|rotational program|trainee)\b/i;

const RX = {
  finance: /financ(?:e|ial) (?:analyst|associate|planning|manager|rotation\w*|leadership|development|program|intern|operations|reporting|management|analysis)|\bfp&a\b|\bfp and a\b|\btreasury\b|corporate finance|strategic finance|business finance|commercial finance|capital planning|project finance|\bfinance (?:intern|co-?op|summer|manager|analyst|associate)|cost analyst|financial (?:planning|analysis)/i,
  dataeng: /\bdata (?:engineer|engineering|platform|infrastructure|architect|pipeline|reliability|operations engineer)|analytics engineer|\betl (?:developer|engineer)|big data (?:engineer|developer)|\b(?:spark|databricks|snowflake|dbt|airflow|hadoop|kafka|bigquery|redshift) (?:engineer|developer)|\bdatabase (?:engineer|developer)|data warehouse|\bdwh\b|\bbi (?:engineer|developer)|business intelligence (?:engineer|developer)|\bmlops\b|(?:machine learning|ml) (?:platform|infrastructure) engineer|data (?:integration|ingestion) (?:engineer|developer)|\bdata ?ops\b/i,
  datasci: /\bdata scien(?:ce|tist)|machine learning (?:engineer|scientist|researcher|research|intern)|\bml (?:engineer|scientist|researcher)|applied (?:scientist|science|research scientist)|decision scien|research scientist|\b(?:nlp|ai|llm|computer vision|deep learning|genai|generative ai) (?:engineer|scientist|researcher|intern)|\bstatistician\b|causal inference|data science|quantitative (?:data|modeler)|predictive model/i,
  dataan: /\bdata analy(?:st|tics|sis)|analytics (?:analyst|associate|specialist|consultant|manager|intern|lead)|business intelligence|\bbi (?:analyst|developer|intern|specialist)|insights? analyst|reporting analyst|product analyst|product analytics|(?:marketing|growth|operations|pricing|supply chain|sales|revenue|people|hr|risk|fraud|finance|financial|commercial|strategic|business) analytics|(?:marketing|growth|pricing|revenue|business|decision) analyst|decision support|data (?:associate|specialist|visualization|insights?|steward|quality)|(?:tableau|power bi|looker) (?:developer|analyst)|\banalytics\b/i,
  pm: /\bproduct manag(?:er|ement)|\bapm\b|associate product manager|\bproduct owner\b|\bproduct lead\b|group product manager|\bgpm\b|head of product|(?:director|vp|vice president|chief)[ ,-]*(?:of )?product\b|\bcpo\b|\bpm intern\b|\bproduct (?:leader|specialist)\b/i,
  tpm: /technical product manag|\btpm\b|technical program manag|(?:platform|api|apis|data|ai|ml|machine learning|infrastructure|developer|developers|cloud|security|devops|payments|core|backend|systems|engineering|fintech|trading|risk) product manag|(?:ai|ml|data|platform|api|developer|infrastructure|cloud|technical)[ /-]+product (?:owner|lead|operations)|product manager[ ,-]+\(?(?:technical|platform|api|apis|data|ai|ml|machine learning|infrastructure|developer|cloud|payments)/i,
  prodstrat: /product strateg|strateg(?:y|ic) (?:&|and) (?:operations|ops|analytics|planning|insights)|(?:product|business|growth|strategic|revenue|commercial) operations|product ops\b|bizops|biz ops|strategic initiatives|corporate strategy|strategy (?:analyst|associate|intern|consultant)|(?:business|corporate|growth) strategy|chief of staff|go[- ]to[- ]market strateg|gtm strateg|monetization strateg|pricing strateg|strategic (?:finance|planning|analyst|partnerships)|strategy (?:&|and) (?:business )?development|product (?:insights|planning)/i,
  ib: /investment bank|\bibd\b|\bm&a\b|mergers|leveraged finance|\blevfin\b|restructuring|capital markets|\becm\b|\bdcm\b|equity capital|debt capital|banking (?:analyst|associate|summer|intern|division|group)|coverage (?:analyst|associate|group)|financial advisory|financial sponsors|(?:healthcare|tmt|technology|energy|industrials|consumer|real estate|power|infrastructure|fig|natural resources|mining|metals|oil|gas|retail|media|telecom|software|fintech|insurance|financial institutions|gaming|aerospace|defense|chemicals|transportation|logistics|sustainability|renewables|utilities) (?:banking|coverage|investment banking|m&a|group)|global banking|corporate (?:finance advisory|banking)|(?:advisory|transaction advisory|valuation) (?:analyst|associate)|summer analyst.*banking|project finance (?:analyst|associate)|acquisition finance/i,
  er: /equity research|sell[- ]side research|buy[- ]side research|investment research|(?:fundamental|equity|credit|thematic|macro|sector) research (?:analyst|associate|assistant|intern)|equity analyst|securities analyst|analyst,? research|\bresearch (?:division|department|team)|\bsector (?:analyst|specialist)|\bcredit research/i,
  privcredit: /private credit|private debt|direct lending|middle[- ]market (?:lending|credit|finance)|(?:unitranche|leveraged|sponsor|sponsored|growth|venture) (?:lending|credit|debt)|credit (?:opportunities|investments?|fund|funds)|special situations|distressed (?:debt|credit|investing)|mezzanine|\bbdc\b|structured credit|private (?:debt|credit) (?:&|and) equity/i,
  altcredit: /alternative credit|alternatives credit|asset[- ]based (?:finance|lending|financing)|specialty finance|structured (?:credit|finance)|\bclo\b|credit opportunities|opportunistic credit|distressed (?:debt|credit|investing)|special situations|real estate (?:debt|credit)|litigation finance|credit (?:hedge|solutions|strategies)|hybrid capital|specialty lending|equipment (?:finance|leasing)|aircraft (?:finance|leasing)|esoteric|\babs\b|\bcmbs\b|\brmbs\b|securitiz/i,
  altinv: /private equity|venture capital|growth equity|buyout|hedge fund|alternative investments?|\balternatives\b|fund of funds|secondaries|infrastructure (?:invest|fund)|real assets|real estate (?:private equity|investment|acquisitions|fund|equity)|family office|\bpe (?:analyst|associate|investor)|\bvc (?:analyst|associate|intern)|investment (?:professional|team|strategy)|investor relations|capital formation|fundrais|limited partner|co-?invest|multi-?strateg|fundamental (?:long|equity)|investor solutions|(?:operating|value creation) (?:partner|associate|team)|endowment|\bfund (?:analyst|associate|investor)|investments? (?:summer|intern)/i,
  st: /sales (?:and|&) trading|\bs&t\b|sales trader|trading (?:analyst|associate|desk|assistant|intern)|\btraders?\b|global markets|markets (?:analyst|associate|summer|intern|division)|(?:rates|credit|fx|foreign exchange|commodit\w*|equity|equities|derivatives|fixed income|municipal|muni|securitized|mortgage|structured products|emerging markets|flow|exotic|volatility|cash|prime|electronic|agency|futures|options|etf|treasuries|repo|securities lending|institutional|financing|macro) (?:sales|trading|trader|desk|structuring|strats?|strategist)\b|institutional (?:equity |fixed income )?sales|\bstrats?\b|\bstructur(?:er|ing)\b|market[- ]mak(?:er|ing)|execution (?:trader|services|consultant)|prime (?:services|brokerage)|securities (?:sales|trading)|capital markets (?:sales|trading)|(?:investment grade|high yield|hy|ig) (?:sales|trading)|treasury (?:trading|sales)|syndicate/i,
  quant: /quant(?:itative)? (?:trader|trading|researcher|research|developer|strategist|desk|software|engineer)|\bquants?\b|systematic (?:trad|invest|research|strateg|macro|equity)|algo(?:rithmic)? trad|trading (?:researcher|strategist|developer|engineer|systems|technolog)|(?:alpha|signal|strategy) research|market microstructure|high[- ]frequency|\bhft\b|portfolio (?:researcher|construction|optimi)|execution (?:researcher|quant)|derivatives (?:pricing|quant)|pricing quant|(?:quant|research) (?:and|&) trading|\btrading (?:and|&) research|stat(?:istical)? arb|market data (?:scientist|researcher)/i,
};


// every pattern must start at a word boundary ("direct lending" is not in "indirect lending")
for (const k of Object.keys(RX)) RX[k] = new RegExp("\\b(?:" + RX[k].source + ")", "i");

// tracks for one job: title plus employer. Pure and cheap.
export function tracksOf(title = "", company = "", category = "") {
  const t = title.toLowerCase().replace(/\s+/g, " ");
  const out = new Set();
  const engineeringish = SWE.test(t);
  const junior = GENERIC_JUNIOR.test(t.replace(/^[^a-z0-9]*/, "")) && !/\b(fp&a|accounting|accountant|controller|operations|compliance|legal|human resources|\bhr\b|recruit|marketing|technology|engineer|facilities|administrat|tax|audit|treasury|payroll|support|reporting|vice president|\bavp\b|director|manager)\b/.test(t);
  for (const [id, re] of Object.entries(RX)) if (re.test(t)) out.add(id);

  // "analytics" inside an engineering or scientist title belongs to that role, not data analytics
  if (out.has("dataan") && (/\b(engineer|scientist|architect|developer)\b/.test(t) || out.has("dataeng") || out.has("datasci"))) out.delete("dataan");
  if (out.has("datasci") && engineeringish) out.delete("datasci");
  if (out.has("dataeng") && /\b(security|network|hardware)\b/.test(t)) out.delete("dataeng");
  if (out.has("er") && /\b(user|ux|design|clinical|scientist|market research|product|engineering|lab|biolog|chemi|sensor|patient|medical|consumer)\b/.test(t)) out.delete("er");
  if (out.has("st") && /\b(fleet|trade show|tradeshow|sales (?:manager|executive|representative|development|engineer)|account (?:executive|manager)|business development|customer success)\b/.test(t) && !/\b(markets|securities|trading desk|sales (?:and|&) trading)\b/.test(t)) out.delete("st");
  if (out.has("pm") && /\b(project|program|pmo)\b/.test(t) && !/\bproduct manag/.test(t)) out.delete("pm");
  if (out.has("tpm") && /\bproduct (?:manag|owner|lead)/.test(t)) out.add("pm");  if (out.has("altcredit") && !/credit|debt|lending|finance|financing|abs|clo|receivable|royalt|distress|special situations|securitiz|leasing|esoteric|mbs|insurance/.test(t)) out.delete("altcredit");

  const co = company || "";
  // weak title patterns count only at financial employers (or in finance categories)
  const money = finCo(co);
  if (money && !engineeringish) {
    if (/\bresearch (?:analyst|associate|assistant|summer)/.test(t) && !/\b(clinical|user|ux|market|sports|lab|science|scientist)\b/.test(t)) out.add("er");
    const fund = ALT_MANAGER.test(co) || CREDIT_MANAGER.test(co);
    if (fund && /\b(?:credit|lending|debt) (?:analyst|associate)|\borigination|underwriting (?:analyst|associate)|portfolio (?:management|monitoring)/.test(t)) { out.add("privcredit"); out.add("altcredit"); }
    if ((ALT_MANAGER.test(co) || /\b(wellington|capital group|pimco|nuveen|blackrock|invesco|franklin|t\.? rowe|fidelity|vanguard|state street|neuberger|pgim|janus|dimensional|loomis|lord abbett)\b/i.test(co)) && /\b(?:investment|portfolio|fund) (?:analyst|associate)|\bportfolio (?:management|construction)/.test(t) && !/\b(compliance|accountant|accounting|operations|administrat|tax|legal|hr|recruit|marketing|technology|support|trade support|reporting|risk)\b/.test(t)) out.add("altinv");
    if ((PROP.test(co) || ALT_MANAGER.test(co)) && /\bquant(?:itative)? (?:analyst|associate|modeler|finance|portfolio|investment)/.test(t)) out.add("quant");
  }
  if (junior && !engineeringish) {
    if (BOUTIQUE.test(co)) out.add("ib");
    if (ALT_MANAGER.test(co)) out.add("altinv");
    if (CREDIT_PURE.test(co)) { out.add("privcredit"); out.add("altcredit"); }
  }
  if (PROP.test(co) && /\b(trader|trading|quant|research(?:er)?|strategist|desk)\b/.test(t) && !/\b(recruit|hr|legal|counsel|finance|accounting|marketing|office|admin|facilities)\b/.test(t)) out.add("quant");
  if (ALT_MANAGER.test(co) && /\b(investment|investor|portfolio|fund|deal|acquisition)s?\b/.test(t) && !engineeringish) out.add("altinv");
  if (CREDIT_MANAGER.test(co) && /\b(credit|lending|debt|underwrit|origination|portfolio|special situations|distressed|structured)\b/.test(t) && !engineeringish) { out.add("privcredit"); out.add("altcredit"); }

  // "finance" is corporate finance: FP&A, financial analyst, treasury, strategic and project finance
  if (RX.finance.test(t) && !engineeringish && !/\b(accountant|accounting|audit|tax|bookkeep|payroll|controller|actuar|underwrit|compliance|collections|insurance|data scien|data engineer|software)\b/.test(t)) out.add("finance");

  return [...out].sort((a, b) => TRACK_IDS.indexOf(a) - TRACK_IDS.indexOf(b));
}

// A title worth collecting as a full-time role even when no older job-family pattern matches
// it: it belongs to a specific track, not just the broad "finance" umbrella.
export function collectableTrack(title, company = "") {
  const tr = tracksOf(title, company);
  return tr.some((x) => x !== "finance");
}
