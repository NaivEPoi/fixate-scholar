// Corpus probe: walk every page, group text-layer spans into lines, report
// PROSE lines (>=4 lowercase words) that are fully unprocessed. Shows the
// data-fx-why reason when the block pass skipped them intentionally; lines
// with NO reason are candidate-filter victims (e.g. contentStart cut).
// Usage: node skipline.mjs <paper> [--pages=A-B]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILTER = POS[0] ?? "UC-Scheme";
const RANGE = (process.argv.slice(2).find((a) => a.startsWith("--pages="))?.slice(8) ?? "").split("-").map((n) => parseInt(n, 10));
const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "Two-column C": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "Two-column D": "https://yilud.me/Proteus-ccs24.pdf",
  "Two-column E": "https://yilud.me/SIB-Auth.pdf",
  "Two-column F": "https://yilud.me/a33-dong%20stamped.pdf",
  "arXiv": "https://arxiv.org/pdf/2502.04915",
  "5GCVerif": "https://yilud.me/5GCVerif-ccs23.pdf",
  "5GShield": "https://yilud.me/5GShield.pdf",
  "AFC-Diss": "https://yilud.me/afc_testing_DISS.pdf",
  "ACL": "https://yilud.me/2026.acl-long.2136.pdf",
  "UC-Scheme": "https://yilud.me/UC_Scheme.pdf",
};
const EXT = "C:\\misc\\Claude_Workspace\\fixate-scholar\\extension";
const PORT = 9451 + (process.pid % 140);
const userDataDir = join(tmpdir(), `fx-sl-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 400)); return r.result.value; };

const PROBE = (p) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
  const div = pv?.textLayer?.div;
  if (!div || !div.childElementCount) return null;
  const fxRect = pv.div.getBoundingClientRect();
  const leaves = [...div.querySelectorAll('span')].filter((s) => !s.querySelector('span') && s.textContent.trim());
  const byLine = new Map();
  for (const s of leaves) {
    const r = s.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // separate columns: quantize x to halves of the page
    const col = (r.left - fxRect.left) > fxRect.width * 0.5 ? 1 : 0;
    const key = col + ':' + Math.round((r.top - fxRect.top) / 5);
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(s);
  }
  const out = [];
  for (const [key, spans] of byLine) {
    const text = spans.map((s) => s.textContent).join(' ');
    const lw = (text.match(/[a-zà-ÿ]{2,}/g) || []).length;
    if (lw < 4) continue;
    const anyDone = spans.some((s) => s.dataset.fxDone || s.closest('[data-fx-done]'));
    const anyKeep = spans.some((s) => s.dataset.fxKeep || s.dataset.fxTable);
    if (anyDone || anyKeep) continue;
    const whys = [...new Set(spans.map((s) => s.dataset.fxWhy || s.closest('[data-fx-why]')?.dataset.fxWhy || '').filter(Boolean))];
    const r0 = spans[0].getBoundingClientRect();
    out.push({ key, y: Math.round(r0.top - fxRect.top), x: Math.round(r0.left - fxRect.left), why: whys.join('+') || 'NONE', t: text.slice(0, 70) });
  }
  out.sort((a, b) => a.y - b.y);
  return out;
})()`;

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(2500);
  let appOk = false;
  for (let i = 0; i < 30; i++) { appOk = await ev(`!!(window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer)`).catch(() => false); if (appOk) break; await sleep(500); }
  if (!appOk) throw new Error("viewer never loaded");
  await ev(`globalThis.__fxDebug = true`);
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`).catch(() => {});
  for (let i = 0; i < 40; i++) { await sleep(700); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 80) break; }
  const pages = await ev(`window.PDFViewerApplication.pagesCount`);
  const from = RANGE[0] || 1, to = Math.min(RANGE[1] || pages, pages);
  console.log(`paper: ${FILTER} pages ${from}-${to}`);
  for (let p = from; p <= to; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`);
    // Wait until the page's processed-span count is nonzero AND stable across
    // two polls — a page probed mid-reprocess (restore wipes data-fx-done,
    // re-marking is incremental) reads as a sea of "unprocessed prose".
    let prev = -1;
    for (let i = 0; i < 30; i++) {
      await sleep(600);
      const n = await ev(`(()=>{const d=window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;return d?d.querySelectorAll('[data-fx-done]').length:0})()`).catch(() => 0);
      if (n > 0 && n === prev) break;
      prev = n;
    }
    await sleep(600);
    const rows = await ev(PROBE(p)).catch((e) => null);
    if (!rows) { console.log(`p${p}: no layer`); continue; }
    console.log(`p${p}: unprocessed prose lines=${rows.length}`);
    for (const r of rows) console.log(`   [${r.why}] (${r.x},${r.y}) "${r.t}"`);
  }
  console.log("DONE");
} catch (e) { console.error("skipline error:", e.message || e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
