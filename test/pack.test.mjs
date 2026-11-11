// The page reads packed listings (lib/pack.js -> unpackRows in public/index.html). Packing then
// unpacking must give back exactly what the page uses.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pack } from "../lib/pack.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const src = html.match(/function unpackRows\(d\) \{[\s\S]*?\n\}\n/)[0];
const unpackRows = new Function(src + "\nreturn unpackRows;")();

const base = (o) => ({
  id: "greenhouse:https://boards.greenhouse.io/acme/jobs/1", company: "Acme", title: "Data Analyst Intern", url: "https://boards.greenhouse.io/acme/jobs/1", applyHost: "boards.greenhouse.io", direct: true,
  postedAt: "2026-11-10T20:52:31.000Z", states: ["GA", "NY"], remote: false, category: "Data & Analytics", seasons: ["Summer 2027"], degrees: ["Bachelor's", "Master's"], sponsorship: "Not stated",
  kind: "Internship", term: {}, cycle: ["Summer"], offCycle: false, location: "Atlanta, GA", tracks: ["dataan"], ...o,
});
const USED = ["id", "company", "title", "url", "applyHost", "direct", "postedAt", "states", "remote", "category", "seasons", "degrees", "sponsorship", "kind", "term", "cycle", "offCycle", "location", "tracks", "level", "pay", "seenOn"];
const pick = (j) => Object.fromEntries(USED.filter((k) => j[k] !== undefined).map((k) => [k, j[k]]));

test("round trip keeps every field the page uses", () => {
  const jobs = [
    base({}),
    base({ id: "lever:https://jobs.lever.co/x/2", url: "https://jobs.lever.co/x/2", applyHost: "jobs.lever.co", kind: "Full-time", level: "Early career", pay: { basis: "posted", min: 41.5, max: 50, period: "year", note: "Pay range published in the job posting." }, tracks: ["ib", "finance"], remote: true }),
    base({ id: "workday:https://a.wd1.myworkdayjobs.com/en/x/3", url: "https://a.wd1.myworkdayjobs.com/en/x/3", applyHost: "a.wd1.myworkdayjobs.com", pay: { basis: "estimate", min: 25, max: 33, typical: 27.13, note: "Typical for Software Engineering internships in Tennessee (26 postings with published pay).", confidence: "low" }, term: { start: "2027-01", end: "2027-05", weeks: 17, source: "description", evidence: "January 11 – May 7, 2027" }, offCycle: true, cycle: ["Spring"], seasons: ["Spring 2027"] }),
    base({ id: "x:https://e.com/4", url: "https://e.com/4", applyHost: "e.com", pay: { basis: "unpaid", note: "The posting says this internship is unpaid." } }),
    base({ id: "list:custom-id-not-from-url", url: "http://insecure.example/5", applyHost: "insecure.example", direct: false, postedAt: null, states: [], seenOn: ["Linkedin"] }),
    base({ id: "estimate:https://r.com/6", url: "https://r.com/6", applyHost: "r.com", pay: { basis: "estimate", min: 20, max: 30, typical: 25, note: "From public reports.", confidence: "medium", sources: ["https://example.com/pay"] } }),
  ];
  const back = unpackRows(JSON.parse(JSON.stringify(pack(jobs))));
  assert.equal(back.length, jobs.length);
  jobs.forEach((j, i) => assert.deepEqual(pick(back[i]), pick(j), `job ${i}`));
});

test("repeated strings are stored once", () => {
  const jobs = Array.from({ length: 50 }, (_, i) => base({ id: `greenhouse:https://boards.greenhouse.io/acme/jobs/${i}`, url: `https://boards.greenhouse.io/acme/jobs/${i}`, title: `Role ${i}` }));
  const p = pack(jobs);
  assert.equal(p.t.company.length, 1);
  assert.equal(p.t.host.length, 1);
  assert.ok(JSON.stringify(p).length < JSON.stringify(jobs).length / 2);
});
