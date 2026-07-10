// Visual-review capture: for every page of a paper, render fx-on with a
// CLASSIFICATION OVERLAY (green = processed body [data-fx-done], red = skipped /
// left-on-canvas [data-fx-table], blue = kept math/special [data-fx-keep]) and
// save a screenshot + a per-page classification JSON (counts, samples, and the
// data-fx-why skip reason per skipped block). Lets a reviewer check each page,
// figure and table against TESTING.md Section 3. See REVIEW_LOG.md.
//
// Usage:
//   node test/review-capture.mjs "Two-column B"   # one paper, all pages
//   node test/review-capture.mjs                  # every paper
// Output: test/out/review/<paper>/pNN.png + pNN.json, and <paper>.json roll-up.

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "Two-column C": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "Two-column D": "https://yilud.me/Proteus-ccs24.pdf",
  "Two-column E": "https://yilud.me/SIB-Auth.pdf",
  "Two-column F": "https://yilud.me/a33-dong%20stamped.pdf",
  "arXiv": "https://arxiv.org/pdf/1706.03762",
  // Added 2026-07 from the updated yilud.me publications list.
  "5GCVerif": "https://yilud.me/5GCVerif-ccs23.pdf",
  "5GShield": "https://yilud.me/5GShield.pdf",
  "AFC-Diss": "https://yilud.me/afc_testing_DISS.pdf",
  "ACL": "https://yilud.me/2026.acl-long.2136.pdf",
  "UC-Scheme": "https://yilud.me/UC_Scheme.pdf",
};
const ONLY = process.argv.slice(2).find((a) => !a.startsWith("--") && !a.toLowerCase().endsWith(".exe"));
const TARGETS = ONLY ? [ONLY] : Object.keys(PAPERS);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const OUTDIR = join(root, "test", "out", "review");
mkdirSync(OUTDIR, { recursive: true });
const PORT = 9651 + (process.pid % 120);
const userDataDir = join(tmpdir(), `fx-review-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1300,2000",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };

// Tint spans by the engine's decision so misclassification is visible as color.
const OVERLAY_ON = `(() => {
  let s = document.getElementById("fx-review");
  if (!s) { s = document.createElement("style"); s.id = "fx-review"; document.head.append(s); }
  s.textContent = ".textLayer span[data-fx-done]{background:rgba(0,170,0,.20)!important;outline:.5px solid rgba(0,120,0,.5)}" +
    ".textLayer span[data-fx-table]{background:rgba(230,0,0,.18)!important;outline:.5px solid rgba(200,0,0,.45)}" +
    ".textLayer span[data-fx-keep]{background:rgba(0,90,255,.20)!important;outline:.5px solid rgba(0,60,220,.5)}";
  return true;
})()`;
const OVERLAY_OFF = `(() => { document.getElementById("fx-review")?.remove(); return true; })()`;

const PAGE_JSON = (p) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
  const div = pv && pv.textLayer && pv.textLayer.div;
  if (!div) return { page: ${p}, error: "no text layer" };
  const leaves = [...div.querySelectorAll("span")].filter((s) => !s.querySelector("span") && s.textContent.trim());
  const done = [], skip = {}, keep = [], other = [];
  for (const s of leaves) {
    const t = s.textContent.trim();
    if (s.dataset.fxDone) { if (done.length < 8) done.push(t.slice(0, 50)); }
    else if (s.dataset.fxTable) { const why = s.dataset.fxWhy || "?"; (skip[why] ||= { n: 0, ex: [] }); skip[why].n++; if (skip[why].ex.length < 4) skip[why].ex.push(t.slice(0, 44)); }
    else if (s.dataset.fxKeep) { if (keep.length < 6) keep.push(t.slice(0, 30)); }
    else { if (other.length < 8) other.push(t.slice(0, 40)); }
  }
  const countAttr = (a) => div.querySelectorAll("span[" + a + "]").length;
  return {
    page: ${p}, leafSpans: leaves.length,
    processedDone: countAttr("data-fx-done"), skippedTable: countAttr("data-fx-table"), keptKeep: countAttr("data-fx-keep"),
    cites: pv.div.querySelectorAll(".fx-cite-hit").length,
    sampleDone: done, skipByReason: skip, sampleKeep: keep, sampleOther: other,
  };
})()`;

async function capturePaper(name) {
  const dir = join(OUTDIR, name.replace(/[^\w]+/g, "_"));
  mkdirSync(dir, { recursive: true });
  const viewerUrl = `chrome-extension://${ws.__extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[name])}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  const pageWs = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (pageWs.onopen = r));
  const prevWs = ws; ws = pageWs; // route ev()/send() to this tab
  try {
    await send("Page.enable"); await sleep(2500);
    await ev(`globalThis.__fxDebug = true`).catch(() => {});
    await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`).catch(() => {});
    for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 60) break; }
    await ev(`window.PDFViewerApplication.pdfViewer.currentScaleValue = "page-fit"`).catch(() => {});
    await sleep(1500);
    const pages = await ev(`window.PDFViewerApplication.pagesCount`);
    const roll = { paper: name, url: PAPERS[name], pages, perPage: [] };
    for (let p = 1; p <= pages; p++) {
      await ev(`window.PDFViewerApplication.page = ${p}`);
      // wait for this page's text layer + processing to settle
      for (let i = 0; i < 25; i++) { await sleep(300); const ok = await ev(`(()=>{const d=window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;return !!(d&&d.childElementCount)})()`).catch(() => false); if (ok) break; }
      await sleep(1500);
      await ev(OVERLAY_ON);
      const clip = await ev(`(()=>{const pv=window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});const r=pv.div.getBoundingClientRect();return {x:Math.max(0,r.left),y:Math.max(0,r.top),width:Math.min(r.width, innerWidth),height:Math.min(r.height, innerHeight)};})()`);
      const shot = await send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1.4 } });
      writeFileSync(join(dir, `p${String(p).padStart(2, "0")}.png`), Buffer.from(shot.data, "base64"));
      await ev(OVERLAY_OFF);
      const pj = await ev(PAGE_JSON(p));
      writeFileSync(join(dir, `p${String(p).padStart(2, "0")}.json`), JSON.stringify(pj, null, 1));
      roll.perPage.push(pj);
      const sk = Object.entries(pj.skipByReason || {}).map(([k, v]) => `${k}:${v.n}`).join(",");
      console.log(`  ${name} p${p}/${pages}  done=${pj.processedDone} skip=${pj.skippedTable}[${sk}] keep=${pj.keptKeep} other=${pj.sampleOther?.length} cites=${pj.cites}`);
    }
    writeFileSync(join(dir, `${name.replace(/[^\w]+/g, "_")}.json`), JSON.stringify(roll, null, 1));
    console.log(`  saved ${dir}`);
  } finally { try { pageWs.close(); } catch {} ws = prevWs; await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`).catch(() => {}); }
}

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  console.log(`Browser: ${version.Browser}  ext: ${extId}\n`);
  // a throwaway control ws so send()/ev() are usable before per-paper tabs open
  const ctrl = await http(`/json/new?about:blank`, "PUT");
  ws = new WebSocket(ctrl.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r)); ws.__extId = extId;
  for (const name of TARGETS) {
    if (!PAPERS[name]) { console.log(`skip unknown paper: ${name}`); continue; }
    console.log(`=== ${name} ===`);
    try { await capturePaper(name); } catch (e) { console.error(`  ${name} ERROR:`, e.message); }
    ws.__extId = extId;
  }
} catch (e) { console.error("review-capture error:", e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(600); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
