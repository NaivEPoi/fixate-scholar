// Find/search regression. PDF.js's find controller rewrites each MATCHED text
// div — TextHighlighter wraps the match in its own <span class="highlight">,
// and on clear resets the div to the raw item string. Both defeated the
// overlay, so this asserts, for a match landing on PROCESSED text:
//  1. the matched glyphs are VISIBLE — the injected span must not keep the
//     stock `.textLayer span { color: transparent }`, or the match renders as
//     an empty coloured box (the canvas glyphs under it are masked away);
//  2. fixation emphasis survives the rewrite (the <b class="fx-b"> wrappers
//     are re-applied around the match spans, so matched lines stay bolded and
//     the span still renders at the --scale-x calibrated for bolded text);
//  3. clearing the search leaves no match spans and full emphasis behind;
//  4. a page rendered WHILE a search is active shows both its matches and its
//     emphasis.
// Usage: node test/search.mjs [url] [query] [page]
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { browserPath, extensionDir, outDir, profileDir } from "./lib/env.mjs";

const shotDir = outDir();
const URL0 = process.argv[2] ?? "https://yilud.me/Proteus-ccs24.pdf";
const QUERY = process.argv[3] ?? "protocol";
const PAGE = parseInt(process.argv[4] ?? "2", 10);
const EXT = extensionDir;
const PORT = 9871 + (process.pid % 110);
const userDataDir = profileDir("search");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank"], { stdio: "ignore" });
let ws, nextId = 0, failed = false;
const fail = (m) => { console.error("FAIL:", m); failed = true; };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  ws.addEventListener("message", h); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text||"").slice(0,500)); return r.result.value; };
// Ink coverage inside the match box. An unstyled/transparent match measures ~0
// because the mask has whited out the canvas glyphs beneath it.
const inkOf = async (band, save) => {
  const s = await send("Page.captureScreenshot", { format: "png", clip: { x: band.x, y: band.y, width: band.w, height: band.h, scale: 2 } });
  if (save) writeFileSync(save, Buffer.from(s.data, "base64"));
  return ev(`(async () => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64,${s.data}"; });
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) { n++; if (0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2] < 110) dark++; }
    return +(100*dark/n).toFixed(1);
  })()`);
};
// Scroll the first match sitting on PROCESSED text into view, then report it.
// (Matches are spread over the document; whichever one the find controller
// selects may be on another page, so place it ourselves before measuring.)
const SHOW_MATCH = `(() => {
  const sel = [...document.querySelectorAll(".textLayer span.highlight")]
    .find((h) => h.closest("span[data-fx-done]") && h.getBoundingClientRect().width > 3);
  if (!sel) return false;
  sel.scrollIntoView({ block: "center" });
  return true;
})()`;
const MATCH = `(() => {
  const sel = [...document.querySelectorAll(".textLayer span.highlight")].find((h) => {
    const r = h.getBoundingClientRect();
    return h.closest("span[data-fx-done]") && r.width > 3 && r.top > 140 && r.bottom < innerHeight - 80;
  });
  if (!sel) return null;
  const r = sel.getBoundingClientRect();
  const host = sel.closest("span[data-fx-done]");
  return { text: (sel.textContent||"").slice(0, 30), color: getComputedStyle(sel).color,
           boldInHost: host.querySelectorAll("b.fx-b").length,
           band: { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(6, Math.round(r.width)), h: Math.round(r.height) } };
})()`;
// Counts are scoped to ONE page view: pages keep rendering and processing as
// the viewer scrolls, so document-wide totals drift for reasons unrelated to
// the search and can't be compared before/after.
const countsOn = (page) => ev(`(() => {
  const d = window.PDFViewerApplication.pdfViewer.getPageView(${page - 1})?.textLayer?.div;
  return { fxb: d ? d.querySelectorAll("b.fx-b").length : -1,
           done: d ? d.querySelectorAll("span[data-fx-done]").length : -1,
           hl: d ? d.querySelectorAll("span.highlight").length : -1 };
})()`);
// Wait until this page's emphasis count stops moving, so the baseline isn't
// sampled mid-process.
const settle = async (page) => {
  let prev = -1;
  for (let i = 0; i < 25; i++) {
    const c = await countsOn(page);
    if (c.fxb > 0 && c.fxb === prev) return c;
    prev = c.fxb;
    await sleep(700);
  }
  return countsOn(page);
};
const find = (q) => ev(`window.PDFViewerApplication.eventBus.dispatch("find", { source: window, type: "",
  query: ${JSON.stringify(q)}, caseSensitive: false, entireWord: false, highlightAll: true,
  findPrevious: false, matchDiacritics: false })`);
try {
  let v=null; for (let i=0;i<50&&!v;i++){try{v=await http("/json/version");}catch{await sleep(300);}}
  let extId=null; for (let i=0;i<60&&!extId;i++){const t=await http("/json/list");const sw=t.find((x)=>x.type==="service_worker"&&x.url.includes("service-worker.mjs"));if(sw)extId=new URL(sw.url).hostname;else await sleep(300);}
  const tab=await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`,"PUT");
  ws=new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r)=>(ws.onopen=r));
  await send("Page.enable"); await send("Runtime.enable");
  await sleep(3000);
  for (let i=0;i<25;i++){const ok=await ev("!!(chrome&&chrome.storage&&chrome.storage.sync)").catch(()=>false);if(ok)break;await sleep(400);}
  await ev("new Promise((r)=>chrome.storage.sync.set({enabled:true},r))"); await sleep(3500);
  for (let i=0;i<30;i++){await sleep(700);const b=await ev("document.querySelectorAll('.textLayer .fx-b').length").catch(()=>0);if(b>80)break;}
  await ev(`window.PDFViewerApplication.page = ${PAGE}`); await sleep(4000);
  await settle(PAGE);

  await find(QUERY); await sleep(3000);
  // Put a match that lands on processed text on screen, wherever it lives, and
  // anchor every emphasis count to THAT page.
  let shown = false;
  for (let i = 0; i < 6 && !shown; i++) {
    shown = await ev(SHOW_MATCH);
    if (!shown) await sleep(1000);
  }
  await sleep(2000);
  const page = await ev(`window.PDFViewerApplication.page`);
  const m = await ev(MATCH);
  if (!m) fail(`no match for "${QUERY}" over processed text`);
  else {
    console.log(`match on page ${page}:`, JSON.stringify(m));
    // (1) visible glyphs
    if (m.color === "rgba(0, 0, 0, 0)") fail("matched text is transparent — renders as an empty box on processed text");
    const ink = await inkOf(m.band, join(shotDir, "search-match.png"));
    console.log("ink inside the match box:", ink + "%");
    if (ink < 4) fail(`match box looks empty (ink ${ink}%) — matched glyphs not rendering`);
    // (2) emphasis survived in the matched span
    if (m.boldInHost === 0) fail("emphasis lost in the matched span (fixation prefixes gone)");
  }
  const during = await countsOn(page);
  console.log("during search:", JSON.stringify(during));
  if (!during.hl) fail("no match spans rendered on the match's page");

  // (3) clearing the search — and the emphasis baseline for this page, which is
  // only trustworthy once no match markup is left on it.
  await ev(`window.PDFViewerApplication.eventBus.dispatch("findbarclose", { source: window })`); await sleep(2500);
  const after = await settle(page);
  console.log("after clearing:", JSON.stringify(after));
  if (after.hl !== 0) fail("match spans survived clearing the search");
  if (during.fxb < after.fxb * 0.95) {
    fail(`emphasis lost during search on page ${page}: ${after.fxb} unsearched -> ${during.fxb} while searching`);
  }

  // (4) A page first rendered WHILE a search is already running: the engine
  // processes it after the highlighter has already marked it up, so the matches
  // must survive that pass and the page must still be emphasized. Only assert
  // when the find controller actually reports matches for that page.
  await find(QUERY); await sleep(2500);
  const target = page + 3;
  await ev(`window.PDFViewerApplication.page = ${target}`); await sleep(6000);
  const later = await ev(`(() => {
    const app = window.PDFViewerApplication;
    const d = app.pdfViewer.getPageView(${target - 1})?.textLayer?.div;
    return { expected: (app.findController.pageMatches?.[${target - 1}] || []).length,
             hl: d ? d.querySelectorAll("span.highlight").length : -1,
             fxb: d ? d.querySelectorAll("b.fx-b").length : -1,
             done: d ? d.querySelectorAll("span[data-fx-done]").length : -1 }; })()`);
  console.log(`page ${target} rendered during an active search:`, JSON.stringify(later));
  if (later.expected > 0 && later.hl === 0) fail(`matches missing on page ${target}, rendered during an active search`);
  if (later.done > 0 && later.fxb === 0) fail(`no emphasis on page ${target}, rendered during an active search`);

  console.log(failed ? "SEARCH: FAIL" : "SEARCH: PASS");
} catch (e) { console.error("search error:", e.message || e); failed = true; }
finally { try{ws?.close();}catch{} browser.kill(); await sleep(500); try{rmSync(userDataDir,{recursive:true,force:true});}catch{} process.exit(failed ? 1 : 0); }
