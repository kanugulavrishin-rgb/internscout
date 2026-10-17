// One full scrape, then a standalone site in site/index.html. Used by the scheduled
// GitHub Action (and works locally): node scripts/scrape-once.mjs
// MAX_MINUTES (default 320) caps the run; whatever has been collected by then is published.
import { spawn } from "node:child_process";
import { mkdir, copyFile } from "node:fs/promises";

const PORT = process.env.PORT || "3456";
const deadline = Date.now() + Number(process.env.MAX_MINUTES || 320) * 60_000;
const server = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT }, stdio: "inherit" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let done = false;
while (Date.now() < deadline) {
  await sleep(30_000);
  try {
    const { status } = await (await fetch(`http://localhost:${PORT}/api/jobs`)).json();
    if (status.cycle >= 1 && status.refreshing === false) { done = true; break; }
  } catch {}
}
console.log(done ? "Scrape finished." : "Time limit reached; publishing what was collected so far.");

const build = spawn(process.execPath, ["scripts/build-snapshot.mjs", "--standalone"], { env: { ...process.env, SERVER: `http://localhost:${PORT}` }, stdio: "inherit" });
const code = await new Promise((r) => build.on("exit", r));
server.kill();
if (code !== 0) process.exit(code);
await mkdir("site", { recursive: true });
await copyFile("dist/index.html", "site/index.html");
console.log("Site written to site/index.html");
process.exit(0);
