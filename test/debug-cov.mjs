// Check that every rendered (done/keep) span is covered by a mask rectangle.
// Reports spans whose center is NOT under any .fx-mask div (canvas ghosting).
// Usage: node test/debug-cov.mjs <pdf-url> <page>
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://yilud.me/usenixsecurity24-tu.pdf";
const PAGE = parseInt(process.argv[3] ?? "2", 10);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9361 + (process.pid % 500);
const ud = join(tmpdir(), `fx-cov-${process.pid}`);
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
  const url = `chrome-extension://${ext}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PDF_URL)}#page=${PAGE}`;
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${url}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; const h = (e) => { const M = JSON.parse(e.data); if (M.id === i) { ws.removeEventListener("message", h); res(M.result); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;
  await sleep(1500); await ev(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 45; i++) { await sleep(1000); const s = await ev(`({p:window.PDFViewerApplication?.pagesCount??0,b:document.querySelectorAll('.textLayer .fx-b').length})`); if (s?.p > 0 && s?.b > 50) break; }
  await ev(`window.PDFViewerApplication.page=${PAGE}`);
  for (let i = 0; i < 20; i++) { await sleep(700); const n = await ev(`(window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1})?.textLayer?.div?.querySelectorAll('span[data-fx-done]').length??0)`); if (n > 0) break; }
  await sleep(1200);
  console.log(JSON.stringify(await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const mask = pv.div.querySelector('.fx-mask');
    const masks = [...(mask?.children ?? [])].map(d => d.getBoundingClientRect());
    const covered = (r) => { const cx=r.left+r.width/2, cy=r.top+r.height/2; return masks.some(m => cx>=m.left&&cx<=m.right&&cy>=m.top&&cy<=m.bottom); };
    const rendered = [...pv.textLayer.div.querySelectorAll('span[data-fx-done],span[data-fx-keep]')];
    const uncov = rendered.filter(s => { const r=s.getBoundingClientRect(); return r.width>0 && !covered(r); });
    return { page:${PAGE}, maskCount: masks.length, rendered: rendered.length,
      uncovered: uncov.length, samples: uncov.slice(0,12).map(s => s.textContent.slice(0,18)) };
  })()`), null, 1));
  ws.close();
} finally { b.kill(); await sleep(500); try { rmSync(ud, { recursive: true, force: true }); } catch {} }
