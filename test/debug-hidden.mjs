// Verify processing pauses while the document is hidden (so it never measures
// geometry on a suspended layout) and resumes correctly when visible again.
// Forces document.hidden via a getter override, re-triggers processing, and
// checks that nothing is processed while hidden, then everything is once shown.
// Usage: node test/debug-hidden.mjs <pdf-url> <page>
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://yilud.me/usenixsecurity24-tu.pdf";
const PAGE = parseInt(process.argv[3] ?? "10", 10);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9351 + (process.pid % 500);
const userDataDir = join(tmpdir(), `fx-hidden-${process.pid}`);
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
  await sleep(1500);
  await ev(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 45; i++) { await sleep(1000); const s = await ev(`({p:window.PDFViewerApplication?.pagesCount??0,b:document.querySelectorAll('.textLayer .fx-b').length})`); if (s?.p > 0 && s?.b > 50) break; }
  await ev(`window.PDFViewerApplication.page=${PAGE}`);
  for (let i = 0; i < 20; i++) { await sleep(700); const n = await ev(`(window.PDFViewerApplication.pdfViewer.getPageView(${PAGE-1})?.textLayer?.div?.querySelectorAll('span[data-fx-done]').length??0)`); if (n > 0) break; }
  await sleep(1200);
  const doneCount = `(window.PDFViewerApplication.pdfViewer.getPageView(${PAGE-1})?.textLayer?.div?.querySelectorAll('span[data-fx-done]').length??0)`;
  console.log("baseline done:", await ev(doneCount));

  // Override visibility to "hidden".
  await ev(`(()=>{window.__hidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hidden});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__hidden?'hidden':'visible'});return document.hidden;})()`);
  // Toggle emphasis off then on while "hidden" → processing should DEFER.
  await ev(`chrome.storage.sync.set({ enabled: false })`); await sleep(800);
  await ev(`chrome.storage.sync.set({ enabled: true })`); await sleep(2500);
  const whileHidden = await ev(doneCount);
  console.log("done while HIDDEN (expect ~0, deferred):", whileHidden);

  // Become visible again → processing should resume and complete.
  await ev(`(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));})()`);
  await sleep(3000);
  const afterVisible = await ev(doneCount);
  const overlaps = await ev(`(()=>{const div=window.PDFViewerApplication.pdfViewer.getPageView(${PAGE-1}).textLayer.div;const done=[...div.querySelectorAll('span[data-fx-done]')];const rs=done.map(s=>s.getBoundingClientRect()).sort((a,b)=>(a.top-b.top)||(a.left-b.left));let o=0;for(let i=1;i<rs.length;i++){if(Math.abs(rs[i-1].top-rs[i].top)<rs[i-1].height*0.5&&rs[i].left<rs[i-1].right-2)o++;}return o;})()`);
  console.log("done after VISIBLE (expect >100):", afterVisible, " overlaps:", overlaps);
  console.log(whileHidden < afterVisible * 0.5 && afterVisible > 100 ? "PASS: paused while hidden, resumed when visible" : "FAIL");
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
