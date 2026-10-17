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

## Resume matching

Upload a PDF, Word or text resume (button in the rail, the paperclip, or drag and drop). It's read in the browser; only the derived profile (skills, degree, graduation year, state) is kept, in that browser. With an API key the live server also has Claude read it once (not stored). Every internship gets a match score with reasons.

## Shareable snapshot

With the server running: `node scripts/build-snapshot.mjs` writes `dist/internscout.html`, a single page with the current listings built in.

## Adding coverage

Add company slugs to `companies.json` (the part after `boards.greenhouse.io/`, `jobs.lever.co/`, or `jobs.ashbyhq.com/`). Each source is fetched in parallel; listings that disappear from a source are removed as closed.

LinkedIn, Indeed, Handshake and Glassdoor are intentionally not scraped: their terms forbid it and they block scrapers. Their listings mostly originate on the company ATS boards above or reach you through Adzuna.
