// Zoomed screenshot of a page region for visual inspection of glyph rendering.
// Usage: node test/debug-shot.mjs <pdf-url> <page> <zoom> <scrollToText>
import { spawn } from "node:child_process";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { browserPath } from "./lib/env.mjs";

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
  browserPath("edge"),
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
  // The outline sidebar, gone. A PDF with /PageMode /UseOutlines opens it, and
  // it keeps its layout width even when the toggle reports it closed — pushing
  // the right-hand column past the viewport edge, so a fifth of the page never
  // reaches the screenshot and the capture reads "clean" on a page it only
  // partly saw.
  await send("Runtime.evaluate", { expression: `(() => {
    const st = document.createElement("style");
    st.textContent = "#sidebarContainer{display:none!important}#outerContainer.sidebarOpen #viewerContainer{inset-inline-start:0!important}";
    document.head.appendChild(st);
    return true;
  })()` });
  await send("Runtime.evaluate", { expression: `window.PDFViewerApplication.page = ${PAGE}` });
  await sleep(1500);
  await send("Runtime.evaluate", { expression: `window.PDFViewerApplication.pdfViewer.currentScaleValue = ${ZOOM}` });
  await sleep(1500);
  // Settle on the PAGE being photographed, not on a document-wide threshold.
  //
  // `bolded > 50` above says only that SOME page has been processed; it says
  // nothing about this one. With a fixed sleep after it, the shutter fired while
  // the last lines of the target page were still being emphasized, and the
  // result looked exactly like a product defect — a whole batch of phantom
  // "emphasis missing from this paragraph" findings during the v1.0.8 gate,
  // every one of which evaporated once the capture waited properly.
  //
  // Two counters, because an emphasis run is painted AFTER its span is marked
  // data-fx-done: a stable processed-span count is not completion.
  if (ENABLED) {
    let last = "";
    let stable = 0;
    for (let i = 0; i < 90; i++) {
      const st = await send("Runtime.evaluate", { returnByValue: true,
        expression: `(() => {
          const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
          if (!pv || !pv.textLayer) return "0/0";
          return pv.textLayer.div.querySelectorAll("span[data-fx-done]").length + "/" +
                 pv.textLayer.div.querySelectorAll(".fx-b").length;
        })()` });
      const cur = st.result.value ?? "x";
      if (cur === last && !String(cur).startsWith("0/")) {
        if (++stable >= 8) break;
      } else { stable = 0; last = cur; }
      await sleep(600);
    }
  }
  if (FINDTEXT) {
    await send("Runtime.evaluate", { awaitPromise: true, expression: `(async () => {
      const el = [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.includes(${JSON.stringify(FINDTEXT)}));
      if (el) el.scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 800));
    })()` });
  }
  await sleep(800);
  mkdirSync(join(root, "test", "out"), { recursive: true });
  // Clip to the PAGE's own rect (unless a --find scrolled somewhere specific),
  // so the capture is the page rather than whatever the viewport happens to show.
  let clip = null;
  if (!FINDTEXT) {
    const r = await send("Runtime.evaluate", { returnByValue: true,
      expression: `(() => {
        const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
        if (!pv) return null;
        const vc = document.getElementById("viewerContainer");
        if (vc) vc.scrollTop = Math.round(vc.scrollTop);
        const b = pv.div.getBoundingClientRect();
        return { x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)),
                 width: Math.round(b.width), height: Math.round(b.height) };
      })()` });
    if (r.result.value?.width > 0) clip = { ...r.result.value, scale: 1 };
  }
  const shot = await send("Page.captureScreenshot",
    clip ? { format: "png", captureBeyondViewport: true, clip } : { format: "png" });
  const out = join(root, "test", "out", `zoom-${PAGE}.png`);
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`saved ${out}`);
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
