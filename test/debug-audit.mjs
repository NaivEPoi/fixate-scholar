// Audit every page of a paper for body prose left UNPROCESSED — a span with
// many lowercase words that is neither emphasized (data-fx-done) nor skipped
// (data-fx-table) nor kept (data-fx-keep). Flags pages with several such spans
// (the "whole region/page skipped" symptom). Skips the refs pages and front
// matter (legitimately unprocessed). Usage: node test/debug-audit.mjs <url>
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://yilud.me/usenixsecurity24-tu.pdf";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9371 + (process.pid % 500);
const ud = join(tmpdir(), `fx-audit-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [`--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--disable-sync",
   "--window-size=1400,1800", `--user-data-dir=${ud}`, `--load-extension=${EXT}`,
   `--disable-extensions-except=${EXT}`, "about:blank"], { stdio: "ignore" });
try {
  let v = null;
  for (let i = 0; i < 40 && !v; i++) { try { v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); } }
  let ext = null;
  for (let i = 0; i < 40 && !ext; i++) { const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const sw = t.find((x) => x.url.includes("service-worker")); if (sw) ext = new URL(sw.url).hostname; else await sleep(250); }
  const url = `chrome-extension://${ext}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PDF_URL)}`;
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${url}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; const h = (e) => { const M = JSON.parse(e.data); if (M.id === i) { ws.removeEventListener("message", h); res(M.result); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;
  await sleep(1500); await ev(`chrome.storage.sync.set({ enabled: true })`);
  let pages = 0;
  for (let i = 0; i < 50; i++) { await sleep(1000); const s = await ev(`({p:window.PDFViewerApplication?.pagesCount??0,b:document.querySelectorAll('.textLayer .fx-b').length,r:globalThis.__fxRefPages?.length??-1})`); if (s?.p > 0 && s?.b > 50 && s.r >= 0) { pages = s.p; break; } }
  const refPages = await ev(`globalThis.__fxRefPages ?? []`);
  const cs = await ev(`globalThis.__fxContentStart`);
  const flags = [];
  for (let p = 1; p <= pages; p++) {
    if (refPages.includes(p)) continue;
    await ev(`window.PDFViewerApplication.page=${p}`);
    let ok = false;
    for (let i = 0; i < 18; i++) { await sleep(500); const n = await ev(`(window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div?.querySelectorAll('span').length??0)`); if (n > 0) { ok = true; break; } }
    if (!ok) continue;
    await sleep(2500); // let idle-time processing settle on heavy pages
    const r = await ev(`(() => {
      const div = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;
      if (!div) return { done:0, unproc:0, samples:[] };
      const LW = /^[a-zà-ÿ]{2,}$/;
      let done=0, unproc=0; const samples=[];
      for (const s of div.querySelectorAll('span')) {
        if (s.querySelector('span')) continue;
        if (s.dataset.fxDone) { done++; continue; }
        if (s.dataset.fxTable || s.dataset.fxKeep) continue;
        let lc=0; for (const w of (s.textContent||'').trim().split(/\\s+/)) if (LW.test(w)) lc++;
        if (lc >= 6) { unproc++; if (samples.length<4) samples.push(s.textContent.slice(0,40)); }
      }
      return { done, unproc, samples };
    })()`);
    if (r.unproc >= 4) flags.push({ page: p, ...r });
  }
  console.log(`pages=${pages} refPages=${JSON.stringify(refPages)} contentStart=${JSON.stringify(cs)}`);
  if (!flags.length) console.log("CLEAN — no page with unprocessed body prose");
  else for (const f of flags) console.log(`FLAG p${f.page}: done=${f.done} unprocessed-prose=${f.unproc} ${JSON.stringify(f.samples)}`);
  ws.close();
} finally { b.kill(); await sleep(500); try { rmSync(ud, { recursive: true, force: true }); } catch {} }
