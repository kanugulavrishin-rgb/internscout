# InternScout

US internship aggregator with live updates, rich filters and an AI search chat ("Scout").

## Run

```bash
npm install
npm start            # http://localhost:3000
```

## Optional keys (all free)

| Env var | What it unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | Claude-powered chat (otherwise a keyword parser is used) |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Adzuna's licensed feed, which aggregates listings from thousands of US job sites — developer.adzuna.com |
| `USAJOBS_API_KEY`, `USAJOBS_EMAIL` | Federal internships — developer.usajobs.gov |
| `REFRESH_MINUTES` | Poll interval (default 10) |

## Sources

InternScout reads employers' own application systems directly (about 61,600 boards):

| System | How | Boards |
|---|---|---|
| Workday | career-site JSON API, searched for "intern" and "summer co-op" | ~13,100 |
| BambooHR | `/careers/list` JSON | ~11,300 |
| iCIMS | classic boards (HTML) and company-domain sites (JSON) | ~10,200 |
| Greenhouse | job board API + pay transparency | ~9,000 |
| Paylocity | job board page data | ~8,300 |
| Lever / Ashby | posting APIs with pay | ~8,600 |
| SmartRecruiters, Oracle, Workable, Rippling, Jobvite, JazzHR, Eightfold | public APIs / pages | ~1,100 |
| Amazon, TikTok | their own career APIs | |

plus 31 public internship lists on GitHub (Simplify, vanshb03, speedyapply, tailed-community, dreamworkhq, zshah101, mehek-builds, adminazhar and others). List rows are kept only when they link to the employer's own application; a list row is dropped as closed when its board was read successfully and no longer contains it.

Growing coverage:
- `node scripts/import-directories.mjs` imports public board directories (Feashliaa/job-board-aggregator, groundtruthtools/ats-jobs-mcp)
- `node scripts/discover.mjs` finds boards from every link in the community lists
- `node scripts/guess-boards.mjs` tries likely board names for companies known only by name

Scheduling: boards that have had internships are checked every cycle (10 minutes); quiet boards are rechecked after 1–3 days; closed boards after a week. State lives in `data/boards.json`. Each system has its own request lane and backs off on rate limits.

## Finance coverage

Titles are sorted into six finance fields as well as the tech and business ones: **Investment Banking**, **Quant & Finance** (sales & trading, markets, quant), **Asset Mgmt & PE** (equity research, private equity, wealth, hedge funds), **Corporate Finance** (FP&A, treasury, financial analyst), **Accounting & Audit** and **Risk & Insurance** (risk, compliance, underwriting, actuarial). Full-time finance roles (analyst, associate, rotational programs, accountant, underwriter, trader and so on) are collected at every level, and Workday, Oracle and Google Jobs searches include finance terms such as "summer analyst" and "financial analyst".

`node scripts/add-finance-boards.mjs` looks for the career boards of about 300 banks, boutiques, funds, asset managers, insurers, accounting firms, exchanges and fintechs and adds the ones that exist to `companies.json`. Only whole-name matches are accepted, and Greenhouse boards must report a matching company name.

## When an internship runs (off-cycle detection)

`lib/terms.js` reads each posting's title and full description and records:

- **Term**: Spring/Summer/Fall/Winter + year, from phrases like "Spring 2027 semester", or inferred from dates ("January 11 – May 7, 2027" → Spring 2027). A long co-op is tagged with every term it spans.
- **Dates and length**: start/end month, weeks ("12-week program", "6-month co-op"), hours per week.
- **Arrangement**: Co-op, Part-time (stated, or 25 hours a week or fewer), Year-round, Contract/temporary.
- **Evidence**: the sentence it came from, shown on the card. `term.source` is `description`, `title` or `list`.

Guards: sentences about the student's schooling ("enrolled for Fall 2027", "graduating Spring 2028") are ignored; explicit dates outrank loose season mentions; the posting's own words outrank a community list's label. Roles whose every dated term has already started are dropped.

Each job gets `cycle` (any of Summer, Fall, Spring, Winter, Co-op, Part-time, Year-round, Contract) and `offCycle` (anything other than summer-only). The board's "When it runs" bar, the Length and Term-evidence filters, and the chat ("off-cycle", "co-op", "part-time during school") all use these.

Descriptions come from each system's detail endpoint and are cached in `data/details.json`. Listings are saved to `data/jobs.json` so a restart shows them immediately.

## Pay

- **Published**: read from structured pay fields (Greenhouse, Lever, Ashby, USAJobs) or from pay-transparency text in the posting, normalized to dollars per hour.
- **Estimated**, in order of preference: the same company's other internships with published pay; Claude web research on that company's intern pay (needs `ANTHROPIC_API_KEY`, cached 30 days in `data/research.json`, `RESEARCH_PER_CYCLE` per refresh); similar internships in the same state; similar internships nationwide. Each estimate says what it is based on.
- Postings that say they're unpaid are marked unpaid.
- Pay in a posting is read in many forms: `$25/hr`, `$85,000 – $105,000 per year`, `USD 95,000 to 120,000`, `$4,500 per month`, `$1,800 per week`, `$3,000 bi-weekly`, `$8,000 for the summer`, `$60–75k a year`. A period unit right after the amount counts as proof of pay even without a word like "salary", while "$50 million raised" and "$10,000 relocation" are ignored.
- Cards show posted pay in the unit the employer used; hover for the same amount per hour, week, month and year. Adzuna (with a key) now runs ten finance and early-career queries and keeps only salaries it did not predict.

## Career tracks

Every job is tagged with the specific job families it belongs to (`lib/tracks.js`, a job can have several): **Finance** (corporate finance, FP&A, treasury), **Investment Banking**, **Equity Research**, **Private Credit**, **Alternative Credit**, **Alternative Investments**, **Sales & Trading**, **Quant Trading**, **Data Science**, **Data Engineering**, **Data Analytics**, **Product Management**, **Technical PM** and **Product Strategy**. Tags come from the title and the employer: "Analyst" at a boutique bank is banking, a "Trader" at a proprietary trading firm is quant trading, "Research Assistant" at a manufacturer is not equity research. The board shows a chip per track with live counts; pick any number.

Roles in these tracks are collected as full-time jobs even when no older job-family pattern matches them, at the early-career, mid and senior levels. Workday boards of financial employers are also searched for banking, research, credit, trading, data and product terms (`TRACK_SEARCHES` in `server.js`).

`npm test` runs the track classifier tests and the snapshot round-trip test. The same `lib/tracks.js` is inlined into the page (`lib/page.js`), so the server, a typed question and a resume's job titles all use identical rules.

## Resume matching

Upload a PDF, Word or text resume (button in the rail, the paperclip, or drag and drop), or start from one of the three starter profiles (Finance, Data & Product, Markets & Trading), which carry only the shape of a resume (field, experience areas, tools) and no names, contact details or employers. Everything is read in the browser; only the derived profile is kept, in that browser. With an API key the live server also has Claude read it once (not stored).

What a resume does:
- **Sets the search.** Its career tracks become the board's track filter ("Only my tracks"), full-time and internships both show, and senior and leadership roles are hidden. "Rank everything" keeps all roles but orders them by fit instead.
- **Judges direction, not just keywords.** Each role title on the resume is classified with the same rules as the listings, tracks in the resume's main direction count fully and other directions count less, and the degree adds adjacent tracks.
- **Ranks.** Track fit, a recognized financial employer (for finance resumes), pay, graduation year, and any summer already booked ("Incoming ... Summer Analyst, May 2027 - Aug 2027" pushes down that summer's internships).
- **Combines with what you type.** "Private credit analyst in New York" adds the place and swaps the tracks; "only remote" adds remote; the resume keeps ranking. Up to four resumes are saved at once, switch between them with one click, or search with all of them together.
- **Explains itself.** Each row and card says which track it matched and why.

The page also shows how many roles are new since you last looked, and the same posting in several offices is one row ("+3 more locations").

## Chat

Type the way you'd talk. One message can say who you are and what you want ("I'm a junior studying finance and data science. I want full-time IB or equity research roles in New York or Charlotte starting 2028, over 100k"):
- **Who you are vs. what you want.** Only the request becomes a search; background only helps when the request names no field.
- **Hard filters and soft ranking.** Field, place, internship vs full-time and employers filter. Level, start year, pay and any other words (energy, restructuring) rank. "Entry level" hides senior roles instead of requiring an exact label, and "roles" or "jobs" show internships and full-time together.
- **It never leaves you with one result.** If only a few roles match every detail, the least important details loosen one at a time until there is a real list, and Scout says what it loosened.
- **It answers.** A reply says how many roles fit, the mix, who is hiring most and where. "Which quant firms are hiring new grads?" lists the firms, and each is one tap to their roles.
- **Prompt and file together.** The paperclip (or drag and drop) puts the resume in the composer; it is read together with your request when you send, so the resume's tracks and level apply and the request narrows them. Several files can go at once.
- **Optional: a real chatbot.** The ✦ button takes your own Anthropic API key (kept only in this browser). Scout then answers in free-form and picks the filters; Anthropic sees your message, your filters, a short summary of your resume (tracks and skills, not the text) and a few matching job titles. Without a key everything runs in the browser.

## Shareable snapshot

With the server running: `node scripts/build-snapshot.mjs` writes `dist/internscout.html`, a single page with the current listings built in. Listings are stored packed (`lib/pack.js`: repeated employers, hosts, locations and pay notes live in tables, each listing is a short array), about a third of the size of plain JSON, so a snapshot of 65,000+ listings is roughly 6 MB and opens quickly.

## Adding coverage

Add company slugs to `companies.json` (the part after `boards.greenhouse.io/`, `jobs.lever.co/`, or `jobs.ashbyhq.com/`). Each source is fetched in parallel; listings that disappear from a source are removed as closed.

LinkedIn, Indeed, Handshake and Glassdoor are intentionally not scraped: their terms forbid it and they block scrapers. Their listings mostly originate on the company ATS boards above or reach you through Adzuna.
