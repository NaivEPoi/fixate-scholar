// Verify the typography survives a zoom (viewport change) without leaving the
// canvas glyphs and our text both visible ("double layer"). Loads a page,
// enables emphasis, then changes the scale and checks that every processed
// span is still width-matched and masked, with no done/non-done overlaps.
// Usage: node test/debug-zoom.mjs <pdf-url> <pageNumber> [scale] [browser]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://arxiv.org/pdf/1706.03762";
const PAGE = parseInt(process.argv[3] ?? "1", 10);
const SCALE = process.argv[4] ?? "1.75";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9342 + (process.pid % 500); // unique per run — avoid zombie collisions
const userDataDir = join(tmpdir(), `fx-zoomdbg-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(
  process.argv[5] || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    `--remote-debugging-port=${PORT}`,
    "--headless=new",
    "--no-first-run",
    "--disable-sync",
    "--window-size=1400,1800",
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      await sleep(250);
    }
  }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const sw = targets.find((t) => t.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(250);
  }
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PDF_URL)}#page=${PAGE}`;
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${viewerUrl}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 0;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === id) {
          ws.removeEventListener("message", h);
          resolve(m.result);
        }
      };
      ws.addEventListener("message", h);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await sleep(1500);
  await send("Runtime.evaluate", { expression: `chrome.storage.sync.set({ enabled: true })`, awaitPromise: true });
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const s = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `({ pages: window.PDFViewerApplication?.pagesCount ?? 0, bolded: document.querySelectorAll('.textLayer .fx-b').length })`,
    });
    if (s.result.value?.pages > 0 && s.result.value?.bolded > 50) break;
  }
  await send("Runtime.evaluate", { expression: `window.PDFViewerApplication.page = ${PAGE}` });
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    const s = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1})?.textLayer?.div?.querySelectorAll('span[data-fx-done]').length ?? 0)`,
    });
    if (s.result.value > 0) break;
  }
  await sleep(1500);

  const probe = (label) => `(() => {
    const app = window.PDFViewerApplication;
    const pv = app.pdfViewer.getPageView(${PAGE - 1});
    const div = pv?.textLayer?.div;
    if (!div) return { label: ${JSON.stringify(label)}, error: 'page not rendered' };
    const done = [...div.querySelectorAll('span[data-fx-done]')];
    const mask = pv.div.querySelector('.fx-mask');
    const all = [...div.querySelectorAll('span')].filter(s => !s.querySelector('span'));
    // done spans overlapping a non-done span on the same line (the ghost symptom)
    let overlaps = 0; const samples = [];
    for (const s of done) {
      const r1 = s.getBoundingClientRect();
      for (const o of all) {
        if (o === s || o.dataset.fxDone) continue;
        const r2 = o.getBoundingClientRect();
        const yO = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
        const xO = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
        if (yO > r1.height * 0.5 && xO > 3) { overlaps++; if (samples.length < 5) samples.push({a: s.textContent.slice(0,20), b: o.textContent.slice(0,20), xO: Math.round(xO)}); break; }
      }
    }
    return {
      label: ${JSON.stringify(label)},
      scale: Math.round(app.pdfViewer.currentScale * 1000) / 1000,
      doneCount: done.length,
      maskRects: mask ? mask.childElementCount : 0,
      overlaps, samples,
    };
  })()`;

  const before = await send("Runtime.evaluate", { returnByValue: true, expression: probe("before-zoom") });
  console.log(JSON.stringify(before.result.value, null, 2));

  // Change the viewport scale, then wait for re-render + reprocessing.
  await send("Runtime.evaluate", { expression: `window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(SCALE)}` });
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    const s = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1})?.textLayer?.div?.querySelectorAll('span[data-fx-done]').length ?? 0)`,
    });
    if (s.result.value > 0) break;
  }
  await sleep(2000);

  const after = await send("Runtime.evaluate", { returnByValue: true, expression: probe("after-zoom") });
  console.log(JSON.stringify(after.result.value, null, 2));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(root, "test", "out", "zoom-after.png"), Buffer.from(shot.data, "base64"));
  console.log("saved test/out/zoom-after.png");
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
