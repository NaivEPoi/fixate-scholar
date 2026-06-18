// Measure the vertical offset between a processed span's BOX rect (what the
// mask is built from) and the actual rendered GLYPH rect (Range.getClientRects
// = the "displayed" position). If the box is taller/offset from the glyphs,
// the mask sits above/below the real text. Compares processed vs pristine and
// captures a screenshot of the region.
// Usage: node test/probe-offset.mjs [pdf-url] [searchText]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://arxiv.org/pdf/1706.03762";
const SEARCH = process.argv[3] ?? "Acknowledg";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9347;
const userDataDir = join(tmpdir(), `fx-offset-${process.pid}`);
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

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const t = await http("/json/list");
    const sw = t.find((x) => x.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(250);
  }
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PDF_URL)}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(2500);
  await ev(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 30; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 50) break; }

  // Find the page containing SEARCH; navigate there.
  const pageNo = await ev(`(async () => {
    const app = window.PDFViewerApplication;
    for (let p = 1; p <= app.pagesCount; p++) {
      const tc = await app.pdfDocument.getPage(p).then(pg => pg.getTextContent());
      if (tc.items.some(it => (it.str||'').includes(${JSON.stringify(SEARCH)}))) return p;
    }
    return 1;
  })()`);
  await ev(`window.PDFViewerApplication.page = ${pageNo}`);
  await sleep(2500);

  const out = await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${pageNo - 1});
    const div = pv.textLayer.div;
    const r2 = (n) => Math.round(n * 10) / 10;
    // glyph rect via Range over the span's text nodes
    const glyphRect = (s) => {
      const range = document.createRange();
      range.selectNodeContents(s);
      const rs = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
      if (!rs.length) return null;
      let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
      for (const r of rs) { top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); left = Math.min(left, r.left); right = Math.max(right, r.right); }
      return { top, bottom, left, right };
    };
    const done = [...div.querySelectorAll('span[data-fx-done]')].filter(s => s.textContent.trim().length > 3);
    const masks = [...pv.div.querySelectorAll('.fx-mask > div')].map(m => m.getBoundingClientRect());
    const samples = [];
    let sumBoxVsGlyphTop = 0, n = 0, maskAboveGlyph = 0;
    for (const s of done.slice(0, 40)) {
      const box = s.getBoundingClientRect();
      const g = glyphRect(s);
      if (!g) continue;
      // mask covering this span (max vertical overlap)
      let mTop = null, bestOv = 0;
      for (const m of masks) { const ov = Math.min(box.bottom, m.bottom) - Math.max(box.top, m.top); if (ov > bestOv && Math.min(box.right,m.right)-Math.max(box.left,m.left) > 0) { bestOv = ov; mTop = m; } }
      const boxTopVsGlyphTop = box.top - g.top;      // <0 means box extends above glyph
      const boxBotVsGlyphBot = box.bottom - g.bottom; // >0 means box extends below glyph
      sumBoxVsGlyphTop += boxTopVsGlyphTop; n++;
      if (mTop && mTop.bottom < g.top + (g.bottom-g.top)*0.4) maskAboveGlyph++; // mask sits mostly above glyph
      if (samples.length < 10) samples.push({
        t: s.textContent.trim().slice(0, 16),
        boxH: r2(box.height), glyphH: r2(g.bottom - g.top),
        boxTop: r2(box.top), glyphTop: r2(g.top),
        boxTop_minus_glyphTop: r2(boxTopVsGlyphTop),
        boxBot_minus_glyphBot: r2(boxBotVsGlyphBot),
        maskTop: mTop ? r2(mTop.top) : null, maskBot: mTop ? r2(mTop.bottom) : null,
      });
    }
    return { page: ${pageNo}, doneCount: done.length, avgBoxTopMinusGlyphTop: r2(sumBoxVsGlyphTop / Math.max(1,n)), maskAboveGlyph, samples };
  })()`);
  console.log(JSON.stringify(out, null, 2));

  // screenshot the search region (first-pass)
  const clip = await ev(`(() => {
    const div = window.PDFViewerApplication.pdfViewer.getPageView(${pageNo-1}).textLayer.div;
    const s = [...div.querySelectorAll('span')].find(x => x.textContent.includes(${JSON.stringify(SEARCH)}));
    if (!s) return null;
    const r = s.getBoundingClientRect();
    if (r.top < 20 || r.bottom > window.innerHeight - 20) return { off: Math.round(r.top) };
    return { x: Math.max(0, r.left - 30), y: Math.max(0, r.top - 70), width: 760, height: 150 };
  })()`);
  if (clip && !clip.off) {
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { ...clip, scale: 2 } });
    const o = join(root, "test", "out", "offset-region.png");
    writeFileSync(o, Buffer.from(shot.data, "base64"));
    console.log("saved " + o);
  } else console.log("shot skipped:", JSON.stringify(clip));
} catch (e) {
  console.error("offset probe error:", e);
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
