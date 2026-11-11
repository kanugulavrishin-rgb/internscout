// The page is one HTML file. The career-track rules live in lib/tracks.js (the server uses them
// to tag every job); this puts the same source into the page so a resume, a typed question and
// a job title are all judged by identical rules.
import { readFile } from "node:fs/promises";

export async function pageHtml() {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const src = (await readFile(new URL("./tracks.js", import.meta.url), "utf8")).replace(/^export /gm, "");
  return html.replace("/*@TRACKS@*/", () => src);
}
