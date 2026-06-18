// Ground-truth measurement: read the CANVAS pixels to find where glyphs are
// actually DISPLAYED, and compare to (a) our overlay glyph (text-layer Range),
// (b) the mask box. Quantifies "overlay higher than original" and "mask cuts
// the descender". Scans processed body words with descenders.
// Usage: node test/probe-canvas.mjs [pdf-url] [page]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://arxiv.org/pdf/1706.03762";
const PAGE = parseInt(process.argv[3] ?? "10", 10);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9357;
const userDataDir = join(tmpdir(), `fx-canvas-${process.pid}`);
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

// In-page helper: canvas dark-pixel vertical extent within a viewport x-range &
// y-band. Returns {top,bottom} in viewport CSS px, or null.
const HELPER = `
window.__canvasGlyphExtent = (pv, x0, x1, yTop, yBot, targetCy) => {
  const canvas = pv.canvas || pv.div.querySelector('canvas');
  if (!canvas) return null;
  const cr = canvas.getBoundingClientRect();
  const sx = canvas.width / cr.width, sy = canvas.height / cr.height;
  const px0 = Math.max(0, Math.floor((x0 - cr.left) * sx));
  const px1 = Math.min(canvas.width, Math.ceil((x1 - cr.left) * sx));
  const py0 = Math.max(0, Math.floor((yTop - cr.top) * sy));
  const py1 = Math.min(canvas.height, Math.ceil((yBot - cr.top) * sy));
  if (px1 <= px0 || py1 <= py0) return null;
  const ctx = canvas.getContext('2d');
  let img; try { img = ctx.getImageData(px0, py0, px1 - px0, py1 - py0); } catch (e) { return { error: String(e) }; }
  const d = img.data, W = px1 - px0, H = py1 - py0;
  const darkRow = [];
  for (let r = 0; r < H; r++) {
    let dark = 0;
    for (let c = 0; c < W; c++) {
      const i = (r * W + c) * 4;
      const lum = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      if (d[i+3] > 40 && lum < 140) dark++;
    }
    darkRow.push(dark >= 2);
  }
  // cluster contiguous dark rows (allow 2px gaps); pick the cluster whose
  // center (in viewport px) is nearest the target center — isolates THIS line
  // from the line above/below that share the x-range.
  const rowToVp = (r) => yTop + (py0 + r - (yTop - cr.top) * sy) / sy;
  const clusters = [];
  let start = -1, gap = 0;
  for (let r = 0; r <= H; r++) {
    if (r < H && darkRow[r]) { if (start < 0) start = r; gap = 0; }
    else { if (start >= 0) { gap++; if (gap > Math.ceil(2 * sy) || r === H) { clusters.push([start, r - gap]); start = -1; gap = 0; } } }
  }
  if (!clusters.length) return null;
  let best = clusters[0], bestD = Infinity;
  for (const [a, b] of clusters) {
    const cyVp = (rowToVp(a) + rowToVp(b + 1)) / 2;
    const dd = Math.abs(cyVp - targetCy);
    if (dd < bestD) { bestD = dd; best = [a, b]; }
  }
  return { top: rowToVp(best[0]), bottom: rowToVp(best[1] + 1) };
};
`;

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
  await ev(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 30; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 50) break; }
  await ev(`window.PDFViewerApplication.page = ${PAGE}`); await sleep(2500);
  await ev(HELPER);

  const out = await ev(`(() => {
    const r2 = (n) => Math.round(n*10)/10;
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE-1});
    const div = pv.textLayer.div;
    const glyph = (s) => { const rg=document.createRange(); rg.selectNodeContents(s); const rs=[...rg.getClientRects()].filter(r=>r.width>0&&r.height>0); if(!rs.length) return null; let t=Infinity,b=-Infinity,l=Infinity,r=-Infinity; for(const q of rs){t=Math.min(t,q.top);b=Math.max(b,q.bottom);l=Math.min(l,q.left);r=Math.max(r,q.right);} return {top:t,bottom:b,left:l,right:r}; };
    const masks = [...pv.div.querySelectorAll('.fx-mask > div')].map(m=>m.getBoundingClientRect());
    const done = [...div.querySelectorAll('span[data-fx-done]')].filter(s => /[gjpqy]/.test(s.textContent) && s.textContent.trim().length>3);
    const rows = [];
    for (const s of done.slice(0, 16)) {
      const og = glyph(s); if (!og) continue;
      // canvas extent over a generous y-band around the overlay glyph
      const cv = window.__canvasGlyphExtent(pv, og.left, og.right, og.top - 10, og.bottom + 12, (og.top + og.bottom) / 2);
      if (!cv || cv.error) continue;
      let mb=null,bestov=0; for(const m of masks){const ov=Math.min(og.bottom,m.bottom)-Math.max(og.top,m.top); if(ov>bestov&&Math.min(og.right,m.right)-Math.max(og.left,m.left)>0){bestov=ov;mb=m;}}
      rows.push({
        t: s.textContent.trim().slice(0,16),
        overlayTop: r2(og.top), overlayBot: r2(og.bottom),
        canvasTop: r2(cv.top), canvasBot: r2(cv.bottom),
        overlayHigherBy: r2(cv.top - og.top),       // >0 => overlay ABOVE canvas (overlay higher)
        overlayBotDiff: r2(cv.bottom - og.bottom),
        maskBot_minus_canvasBot: mb ? r2(mb.bottom - cv.bottom) : null, // <0 => mask cuts canvas descender
        maskTop_minus_canvasTop: mb ? r2(mb.top - cv.top) : null,
      });
    }
    const avg = (f) => rows.length ? +(rows.reduce((a,x)=>a+(x[f]??0),0)/rows.length).toFixed(2) : null;
    return {
      page: ${PAGE}, matched: rows.length,
      avgOverlayHigherBy: avg('overlayHigherBy'),
      avgMaskBotMinusCanvasBot: avg('maskBot_minus_canvasBot'),
      descenderCut: rows.filter(x => x.maskBot_minus_canvasBot != null && x.maskBot_minus_canvasBot < -0.5).length,
      sample: rows.slice(0, 12),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error("canvas probe error:", e);
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
