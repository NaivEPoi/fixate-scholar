// Zoomed screenshot of a page region for visual inspection of glyph rendering.
// Usage: node test/debug-shot.mjs <pdf-url> <page> <zoom> <scrollToText>
import { spawn } from "node:child_process";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2];
const PAGE = parseInt(process.argv[3] ?? "11", 10);
const ZOOM = parseFloat(process.argv[4] ?? "2.5");
const FINDTEXT = process.argv[5] ?? null;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9341 + (process.pid % 500);
const userDataDir = join(tmpdir(), `fx-shot-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [`--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--disable-sync",
   "--window-size=1600,2000", `--user-data-dir=${userDataDir}`,
   `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, "about:blank"],
  { stdio: "ignore" },
);
try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); }
  }
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
  await sleep(1500);
  const ENABLED = !process.argv.includes("--off");
  await send("Runtime.evaluate", { expression: `chrome.storage.sync.set({ enabled: ${ENABLED} })`, awaitPromise: true });
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const s = await send("Runtime.evaluate", { returnByValue: true,
      expression: `({ pages: window.PDFViewerApplication?.pagesCount ?? 0, bolded: document.querySelectorAll('.textLayer .fx-b').length })` });
    if (s.result.value?.pages > 0 && (!ENABLED || s.result.value?.bolded > 50)) break;
  }
  await send("Runtime.evaluate", { expression: `window.PDFViewerApplication.page = ${PAGE}` });
  await sleep(1500);
  await send("Runtime.evaluate", { expression: `window.PDFViewerApplication.pdfViewer.currentScaleValue = ${ZOOM}` });
  await sleep(1500);
  if (FINDTEXT) {
    await send("Runtime.evaluate", { awaitPromise: true, expression: `(async () => {
      const el = [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.includes(${JSON.stringify(FINDTEXT)}));
      if (el) el.scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 800));
    })()` });
  }
  await sleep(800);
  mkdirSync(join(root, "test", "out"), { recursive: true });
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const out = join(root, "test", "out", `zoom-${PAGE}.png`);
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`saved ${out}`);
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
