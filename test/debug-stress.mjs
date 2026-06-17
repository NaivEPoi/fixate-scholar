// Stress the re-layout paths that a "switch windows / scroll / zoom" can
// trigger, and check whether processed-span spacing collapses (adjacent done
// spans overlapping). Captures a screenshot after each step.
// Usage: node test/debug-stress.mjs <pdf-url> <page>
import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://yilud.me/usenixsecurity24-tu.pdf";
const PAGE = parseInt(process.argv[3] ?? "10", 10);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9347 + (process.pid % 500);
const userDataDir = join(tmpdir(), `fx-stress-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [`--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--disable-sync",
   "--window-size=1400,1800", `--user-data-dir=${userDataDir}`,
   `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, "about:blank"],
  { stdio: "ignore" },
);
try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const sw = targets.find((t) => t.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(250);
  }
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PDF_URL)}#page=${PAGE}`;
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${viewerUrl}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 0;
  const send = (m, p = {}) => new Promise((resolve) => {
    const id = ++nextId;
    const h = (e) => { const M = JSON.parse(e.data); if (M.id === id) { ws.removeEventListener("message", h); resolve(M.result); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;
  const FONTMODE = process.argv[4] ?? "original";
  await sleep(1500);
  await ev(`chrome.storage.sync.set({ enabled: true, fontMode: ${JSON.stringify(FONTMODE)} })`);
  for (let i = 0; i < 45; i++) { await sleep(1000); const s = await ev(`({p:window.PDFViewerApplication?.pagesCount??0,b:document.querySelectorAll('.textLayer .fx-b').length})`); if (s?.p > 0 && s?.b > 50) break; }
  const goto = async (p) => { await ev(`window.PDFViewerApplication.page=${p}`); for (let i=0;i<20;i++){ await sleep(600); const n=await ev(`(window.PDFViewerApplication.pdfViewer.getPageView(${p-1})?.textLayer?.div?.querySelectorAll('span[data-fx-done]').length??0)`); if(n>0)break; } };
  const probe = `(()=>{const div=window.PDFViewerApplication.pdfViewer.getPageView(${PAGE-1})?.textLayer?.div;if(!div)return{e:'no'};const done=[...div.querySelectorAll('span[data-fx-done]')];const rs=done.map(s=>({r:s.getBoundingClientRect(),t:s.textContent})).sort((a,b)=>(a.r.top-b.r.top)||(a.r.left-b.r.left));let ov=0,samp=[];for(let i=1;i<rs.length;i++){const a=rs[i-1],b=rs[i];if(Math.abs(a.r.top-b.r.top)<a.r.height*0.5&&b.r.left<a.r.right-2){ov++;if(samp.length<5)samp.push(a.t.slice(0,10)+'|'+b.t.slice(0,10));}}return{done:done.length,scale:Math.round(window.PDFViewerApplication.pdfViewer.currentScale*1000)/1000,ov,samp};})()`;
  const snap = async (label) => { await goto(PAGE); await sleep(1200); const r = await ev(probe); console.log(label, JSON.stringify(r)); const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(root, "test", "out", `stress-${label}.png`), Buffer.from(shot.data, "base64")); };

  await snap("0-initial");
  // Scroll far away and back (page virtualization → re-render path).
  await goto(1); await sleep(1500); await goto(PAGE); await sleep(1500);
  await snap("1-scrollback");
  // Numeric zoom in, then back to auto (TextLayer.update fast path + re-render).
  await ev(`window.PDFViewerApplication.pdfViewer.currentScaleValue='1.6'`); await sleep(2500);
  await ev(`window.PDFViewerApplication.pdfViewer.currentScaleValue='auto'`); await sleep(2500);
  await snap("2-zoomcycle");
  // Settings change (Edge-sync analog) → updateSettings → restoreAll+processAll.
  await ev(`chrome.storage.sync.set({ boldWeight: 600 })`); await sleep(2500);
  await snap("3-setchange");
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
