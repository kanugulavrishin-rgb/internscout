// Builds a single page with the current listings baked in. Run while the server is up:
//   node scripts/build-snapshot.mjs               -> dist/internscout.html (Claude artifact)
//   node scripts/build-snapshot.mjs --standalone  -> dist/index.html (any static host, e.g. GitHub Pages)
const standalone = process.argv.includes("--standalone");
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const base = process.env.SERVER || "http://localhost:3000";
const { jobs, status } = await (await fetch(`${base}/api/jobs`)).json();
const slim = jobs.map(({ alsoOn, source, location, ...j }) => ({ ...j, location }));
const snapshot = { jobs: slim, status: { lastRefresh: status.lastRefresh, total: slim.length } };

let html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
// The artifact host supplies the document skeleton, so keep only the page content there.
if (!standalone) html = html
  .replace(/<!doctype html>\s*/i, "")
  .replace(/<\/?html[^>]*>\s*/gi, "")
  .replace(/<\/?head>\s*/gi, "")
  .replace(/<\/?body>\s*/gi, "")
  .replace(/<meta[^>]*>\s*/gi, "");
const packed = gzipSync(JSON.stringify(snapshot), { level: 9 }).toString("base64");
const data = `<script>window.__SNAPSHOT_GZ__ = "${packed}";</script>\n`;
html = html.replace(/<script>\n\(\(\) => \{/, data + "<script>\n(() => {");
const out = standalone ? "index.html" : "internscout.html";
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(new URL(`../dist/${out}`, import.meta.url), html);
console.log(`dist/${out}: ${slim.length} listings, ${(html.length / 1e6).toFixed(1)} MB`);
