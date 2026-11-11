// The chat planner's pure parts live in public/index.html; pull them out and test them directly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const slice = (from, to) => { const a = html.indexOf(from); return html.slice(a, html.indexOf(to, a)); };
const code = slice("const WANT_RX", "const GENERIC_WORDS") + "\nreturn { splitIntent, payWish };";
const { splitIntent, payWish } = new Function(code)();

test("who you are is kept apart from what you want", () => {
  const r = splitIntent("I'm a junior at UGA studying finance and data science. I want full-time investment banking or equity research analyst roles in New York or Charlotte starting in 2028");
  assert.match(r.want, /investment banking/);
  assert.doesNotMatch(r.want, /data science/);
  assert.match(r.about, /data science/);
});

test("one sentence with both halves is split at the request", () => {
  const r = splitIntent("I'm studying finance at UGA and I want equity research roles in Atlanta");
  assert.match(r.want, /equity research/);
  assert.doesNotMatch(r.want, /studying finance/);
});

test("a plain request is all request", () => {
  assert.equal(splitIntent("quant trading firms hiring new grads").want, "quant trading firms hiring new grads");
});

test("pay wishes become hourly pay", () => {
  assert.equal(payWish(" paying over 100k "), Math.round(100000 / 2080));
  assert.equal(payWish(" at least $120,000 "), Math.round(120000 / 2080));
  assert.equal(payWish(" $45/hr or more "), 45);
  assert.equal(payWish(" starting in 2028 "), 0);
  assert.equal(payWish(" class of 2027 in new york "), 0);
});
