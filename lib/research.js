// Researches what a company pays its US interns, using Claude with web search, for companies
// whose own postings don't publish pay. Results are cached on disk for 30 days so each
// company is looked up rarely. Runs only when ANTHROPIC_API_KEY is set.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const TTL_MS = 30 * 864e5;
const Finding = z.object({
  hourlyMin: z.number().nullable(),
  hourlyMax: z.number().nullable(),
  summary: z.string(),
  sources: z.array(z.string()),
});

export class PayResearch {
  constructor({ anthropic, file, perCycle = 20 }) {
    this.anthropic = anthropic;
    this.file = file;
    this.perCycle = perCycle;
    this.cache = {};
    this.running = false;
  }

  async load() {
    try { this.cache = JSON.parse(await readFile(this.file, "utf8")); } catch { this.cache = {}; }
  }

  async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.cache, null, 1));
  }

  // { companyKey: finding } for findings that are still fresh and usable
  findings() {
    const out = {};
    for (const [k, v] of Object.entries(this.cache)) if (v.hourlyMin && Date.now() - v.checkedAt < TTL_MS) out[k] = v;
    return out;
  }

  // Look up the companies with the most internships and no published pay first.
  async run(candidates) {
    if (!this.anthropic || this.running) return 0;
    this.running = true;
    let done = 0;
    try {
      const todo = candidates.filter(({ key }) => !this.cache[key] || Date.now() - this.cache[key].checkedAt > TTL_MS).slice(0, this.perCycle);
      for (const { key, company } of todo) {
        try {
          const f = await this.research(company);
          this.cache[key] = { ...f, company, checkedAt: Date.now() };
        } catch (e) {
          console.error(`[research] ${company}:`, e.message);
          this.cache[key] = { company, hourlyMin: null, hourlyMax: null, summary: "", sources: [], checkedAt: Date.now() - TTL_MS + 864e5 }; // retry tomorrow
        }
        done++;
      }
      if (done) await this.save();
    } finally {
      this.running = false;
    }
    return done;
  }

  async research(company) {
    const messages = [{ role: "user", content: `How much does ${company} pay its interns in the United States? Search for recent, specific evidence: ${company}'s own job postings that list a pay range, Levels.fyi intern pages, Glassdoor or Indeed salary pages, or news. Convert to US dollars per hour (monthly × 12 ÷ 2080, annual ÷ 2080). If the evidence is thin or contradictory, give a wider range and say so. If you find nothing specific to ${company}, use null for both numbers.

End your answer with only a JSON object in a \`\`\`json block:
{"hourlyMin": number|null, "hourlyMax": number|null, "summary": "one sentence a student can read, naming where the numbers come from", "sources": ["url", ...]}` }];
    for (let turn = 0; turn < 4; turn++) {
      const response = await this.anthropic.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
        messages,
      });
      if (response.stop_reason === "refusal") throw new Error("declined");
      if (response.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: response.content }); continue; }
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const json = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].pop()?.[1] || text.match(/\{[\s\S]*"hourlyMin"[\s\S]*\}/)?.[0];
      if (!json) throw new Error("no JSON in answer");
      const f = Finding.parse(JSON.parse(json));
      if (f.hourlyMin && (f.hourlyMin < 8 || f.hourlyMin > 250)) return { ...f, hourlyMin: null, hourlyMax: null };
      if (f.hourlyMin && f.hourlyMax && f.hourlyMax < f.hourlyMin) [f.hourlyMin, f.hourlyMax] = [f.hourlyMax, f.hourlyMin];
      return f;
    }
    throw new Error("search did not finish");
  }
}
