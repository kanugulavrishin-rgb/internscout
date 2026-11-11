// Compact snapshot format. The published page used to carry every listing as a full JSON
// object (54 MB for ~67,000 listings): the browser had to parse all of it before showing anything.
// Packed, repeated strings (employers, hosts, locations, pay notes) are stored once and each
// listing is a short array, so the same data is about a fifth of the size and parses fast.
//
// Row layout (index: field):
//  0 company  1 title  2 host (or -1)  3 url path (or full url when host is -1)  4 postedAt (unix seconds, 0 = none)
//  5 states "GA,NY"  6 flags (1 remote, 2 not-direct, 4 offCycle, 8 full-time)  7 category  8 seasons "Summer 2027|Fall 2027"
//  9 degrees  10 sponsorship  11 level (-1 none)  12 term (object or 0)  13 cycle  14 pay (array, object or 0)
//  15 location  16 tracks "ib,finance"  17 id prefix (-1 when the id is not "<prefix>:<url>")  18 explicit id or 0  19 seenOn or 0

const BASIS = ["posted", "unpaid", "estimate"];
const CONF = ["", "high", "medium", "low"];
const PAY_KEYS = new Set(["basis", "min", "max", "typical", "note", "confidence", "period"]);

export function pack(jobs, status = {}) {
  const T = { company: [], host: [], cat: [], spons: [], loc: [], note: [], cyc: [], deg: [], lvl: [], pre: [] };
  const maps = Object.fromEntries(Object.keys(T).map((k) => [k, new Map()]));
  const ix = (k, v) => { const m = maps[k]; let i = m.get(v); if (i === undefined) { i = T[k].length; m.set(v, i); T[k].push(v); } return i; };
  const rows = jobs.map((j) => {
    let host = -1, rest = j.url || "";
    try { const u = new URL(j.url); if (u.host === j.applyHost && j.url.startsWith("https://" + u.host)) { host = ix("host", u.host); rest = j.url.slice(8 + u.host.length); } } catch {}
    const suffix = ":" + j.url;
    const pre = j.id?.endsWith(suffix) ? ix("pre", j.id.slice(0, -suffix.length)) : -1;
    let pay = 0;
    if (j.pay) {
      const extra = Object.keys(j.pay).some((k) => !PAY_KEYS.has(k));
      pay = extra ? j.pay : [BASIS.indexOf(j.pay.basis), j.pay.min ?? null, j.pay.max ?? null, j.pay.typical ?? null, j.pay.note ? ix("note", j.pay.note) : -1, Math.max(0, CONF.indexOf(j.pay.confidence || "")), j.pay.period || ""];
    }
    return [
      ix("company", j.company), j.title, host, rest, j.postedAt ? Math.round(Date.parse(j.postedAt) / 1000) : 0,
      (j.states || []).join(","), (j.remote ? 1 : 0) | (j.direct === false ? 2 : 0) | (j.offCycle ? 4 : 0) | (j.kind === "Full-time" ? 8 : 0),
      ix("cat", j.category), (j.seasons || []).join("|"), ix("deg", (j.degrees || []).join("|")), ix("spons", j.sponsorship || ""),
      j.level ? ix("lvl", j.level) : -1, j.term && Object.keys(j.term).length ? j.term : 0, ix("cyc", (j.cycle || []).join("|")), pay,
      ix("loc", j.location || ""), (j.tracks || []).join(","), pre, pre === -1 ? j.id : 0, j.seenOn?.length ? j.seenOn : 0,
    ];
  });
  return { v: 2, t: T, rows, status };
}
