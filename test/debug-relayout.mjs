// Reproduce the "switch windows / change monitor" symptom: the page is
// processed, then the viewport size + devicePixelRatio change (as when a
// window moves to another monitor), forcing PDF.js to re-lay-out the text
// layer. We capture a sample span's word-spacing/scale-x and the rendered
// word gaps before and after, plus screenshots, to compare against native.
// Usage: node test/debug-relayout.mjs <pdf-url> <page>
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
const PORT = 9343 + (process.pid % 500);
const userDataDir = join(tmpdir(), `fx-relayout-${process.pid}`);
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
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); resolve(m.result); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalIn = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1800, deviceScaleFactor: 1, mobile: false });
  await sleep(1500);
  await evalIn(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const s = await evalIn(`({ pages: window.PDFViewerApplication?.pagesCount ?? 0, bolded: document.querySelectorAll('.textLayer .fx-b').length })`);
    if (s?.pages > 0 && s?.bolded > 50) break;
  }
  await evalIn(`window.PDFViewerApplication.page = ${PAGE}`);
  for (let i = 0; i < 25; i++) { await sleep(800); const n = await evalIn(`(window.PDFViewerApplication.pdfViewer.getPageView(${PAGE-1})?.textLayer?.div?.querySelectorAll('span[data-fx-done]').length ?? 0)`); if (n > 0) break; }
  await sleep(1500);

  const probe = `(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const div = pv?.textLayer?.div; if (!div) return {error:'no layer'};
    const done = [...div.querySelectorAll('span[data-fx-done]')];
    // measure inter-word gaps: for done spans, compare right edge to next span left
    const sample = done.slice(0, 60).map(s => ({
      ws: s.style.wordSpacing, sx: s.style.getPropertyValue('--scale-x'),
      w: Math.round(s.getBoundingClientRect().width*10)/10,
      fs: Math.round(parseFloat(getComputedStyle(s).fontSize)*10)/10,
      t: s.textContent.slice(0,14),
    }));
    // overlaps between adjacent done spans (jammed text symptom)
    let overlaps = 0;
    const rs = done.map(s => ({r:s.getBoundingClientRect(), t:s.textContent})).sort((a,b)=> (a.r.top-b.r.top)||(a.r.left-b.r.left));
    for (let i=1;i<rs.length;i++){ const a=rs[i-1].r,b=rs[i].r; if (Math.abs(a.top-b.top)<a.height*0.5 && b.left < a.right-1.5) overlaps++; }
    return { scale: Math.round(pv.viewport.scale*1000)/1000, dpr: window.devicePixelRatio, doneCount: done.length, overlaps, sample: sample.slice(0,6) };
  })()`;

  const before = await evalIn(probe);
  console.log("BEFORE relayout:", JSON.stringify(before, null, 1));
  let shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(root, "test", "out", "relayout-before.png"), Buffer.from(shot.data, "base64"));

  // Simulate moving the window to a higher-DPI monitor of a different size.
  await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 1500, deviceScaleFactor: 2, mobile: false });
  await sleep(3000);

  const after = await evalIn(probe);
  console.log("AFTER relayout: ", JSON.stringify(after, null, 1));
  shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(root, "test", "out", "relayout-after.png"), Buffer.from(shot.data, "base64"));
  console.log("saved relayout-before.png / relayout-after.png");
  console.log(`OVERLAPS before=${before.overlaps} after=${after.overlaps}`);
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
