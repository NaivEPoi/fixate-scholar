// Definitive visual: with fx ON, HIDE the masks and color our overlay RED, so
// the original canvas glyphs (black) and our overlay glyphs (red) are both
// visible. If red sits above black, the overlay is genuinely higher. A second
// shot shows the mask boxes (red, semi-transparent) over the text to see if the
// mask bottom clears the descenders.
// Usage: node test/probe-overlap.mjs [pdf-url] [searchText] [page]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://arxiv.org/pdf/1706.03762";
const SEARCH = process.argv[3] ?? "recurrent";
const PAGE = parseInt(process.argv[4] ?? "10", 10);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9359;
const userDataDir = join(tmpdir(), `fx-ovl-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,1800",
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
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const shot = async (name) => {
  const clip = await ev(`(() => {
    const div = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE-1}).textLayer.div;
    const s = [...div.querySelectorAll('span')].find(x => x.textContent.includes(${JSON.stringify(SEARCH)}));
    if (!s) return null; const r = s.getBoundingClientRect();
    if (r.top < 20 || r.bottom > window.innerHeight - 20) return { off: Math.round(r.top) };
    return { x: Math.max(0, r.left - 10), y: Math.max(0, r.top - 24), width: 460, height: 60 };
  })()`);
  if (clip && !clip.off) { const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { ...clip, scale: 4 } }); writeFileSync(join(root, "test", "out", name), Buffer.from(s.data, "base64")); console.log("saved " + name); }
  else console.log(name + " skip " + JSON.stringify(clip));
};

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.url.includes("service-worker")); if (sw) extId = new URL(sw.url).hostname; else await sleep(250); }
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PDF_URL)}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(2500);
  // (0) fx OFF: color the (native) text layer red to see if PDF.js's OWN text
  // layer (original font, original position) aligns with the black canvas.
  await ev(`chrome.storage.sync.set({ enabled: false })`); await sleep(600);
  await ev(`window.PDFViewerApplication.page = ${PAGE}`); await sleep(2500);
  await ev(`(() => { const st=document.createElement('style'); st.id='__probe0'; st.textContent='.textLayer span{color:red !important}'; document.head.appendChild(st); })()`);
  await sleep(400);
  await shot("overlap-native.png");
  await ev(`document.getElementById('__probe0')?.remove()`);

  await ev(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 30; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 50) break; }
  await ev(`window.PDFViewerApplication.page = ${PAGE}`); await sleep(2500);

  // (A) masks hidden + overlay RED → see canvas(black) vs overlay(red) offset.
  await ev(`(() => {
    const st = document.createElement('style'); st.id='__probe';
    st.textContent = '#viewerContainer.fx-on .fx-mask{display:none !important} ' +
      '#viewerContainer.fx-on .textLayer span[data-fx-done]{color:red !important} ' +
      '#viewerContainer.fx-on .textLayer span[data-fx-done] .fx-b{color:red !important; -webkit-text-stroke: 0 !important}';
    document.head.appendChild(st);
  })()`);
  await sleep(600);
  await shot("overlap-red.png");

  // (B) masks shown in translucent red over text → see if mask bottom clears descenders.
  await ev(`(() => {
    document.getElementById('__probe').remove();
    const st = document.createElement('style'); st.id='__probe2';
    st.textContent = '#viewerContainer.fx-on .fx-mask > div{background: rgba(255,0,0,0.35) !important}';
    document.head.appendChild(st);
  })()`);
  await sleep(600);
  await shot("overlap-mask.png");
} catch (e) {
  console.error("overlap probe error:", e);
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
