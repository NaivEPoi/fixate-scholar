// Robust overlay-vs-canvas baseline measurement across device-scale-factors.
// Picks the canvas dark-row cluster by MAX OVERLAP with the overlay glyph box
// (not nearest-center), which is reliable at high DPI where lines pack closer.
// Reports the median vertical offset of the overlay em-box vs the canvas ink,
// plus per-span CSS (fontSize, marginTop) — to find the high-DPI drift.
// Usage: node test/diag-baseline.mjs [template] [page] --dsf=1.75

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--") && !a.toLowerCase().endsWith(".exe"));
const FILTER = POS.find((a) => !/^\d+$/.test(a)) ?? "arXiv";
const PAGE = parseInt(POS.find((a) => /^\d+$/.test(a)) ?? "10", 10);
const DSF = parseFloat(process.argv.slice(2).find((a) => a.startsWith("--dsf="))?.slice(6) ?? "0");
const ZOOM = parseFloat(process.argv.slice(2).find((a) => a.startsWith("--zoom="))?.slice(7) ?? "0"); // PDF.js currentScale
// --attach=PORT: connect to an ALREADY-RUNNING Chrome started with
// --remote-debugging-port=PORT (the user's real profile, real display DPI), and
// measure the viewer tab they already have open. No browser is spawned.
const ATTACH = parseInt(process.argv.slice(2).find((a) => a.startsWith("--attach="))?.slice(9) ?? "0", 10);
const PAPERS = { "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf", "arXiv": "https://arxiv.org/pdf/1706.03762" };
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = ATTACH || 9551 + (process.pid % 120);
const userDataDir = join(tmpdir(), `fx-bl-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = ATTACH ? null : spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,1800",
  ...(DSF ? [`--force-device-scale-factor=${DSF}`, "--high-dpi-support=1"] : []),
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };

const HELPER = `
window.__canvasInk = (pv, x0, x1, yc, halfBand) => {
  const canvas = pv.canvas || pv.div.querySelector('canvas'); if (!canvas) return null;
  const cr = canvas.getBoundingClientRect();
  const sx = canvas.width / cr.width, sy = canvas.height / cr.height;
  const px0 = Math.max(0, Math.floor((x0 - cr.left) * sx)), px1 = Math.min(canvas.width, Math.ceil((x1 - cr.left) * sx));
  const py0 = Math.max(0, Math.floor((yc - halfBand - cr.top) * sy)), py1 = Math.min(canvas.height, Math.ceil((yc + halfBand - cr.top) * sy));
  if (px1 <= px0 || py1 <= py0) return null;
  let img; try { img = canvas.getContext('2d').getImageData(px0, py0, px1 - px0, py1 - py0); } catch (e) { return { error: String(e) }; }
  const d = img.data, W = px1 - px0, H = py1 - py0; const dark = [];
  for (let r = 0; r < H; r++) { let n = 0; for (let c = 0; c < W; c++) { const i = (r*W+c)*4; const lum = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; if (d[i+3] > 40 && lum < 140) n++; } dark.push(n >= 2); }
  const rowVp = (r) => (py0 + r) / sy + cr.top;
  const clusters = []; let s = -1, gap = 0;
  for (let r = 0; r <= H; r++) { if (r < H && dark[r]) { if (s < 0) s = r; gap = 0; } else { if (s >= 0) { gap++; if (gap > Math.ceil(2*sy) || r === H) { clusters.push([s, r - gap]); s = -1; gap = 0; } } } }
  return clusters.map(([a, b]) => ({ top: rowVp(a), bottom: rowVp(b + 1) }));
};`;

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  let tab;
  if (ATTACH) {
    // Use the viewer tab the user already has open (their PDF, fx on).
    const list = await http("/json/list");
    tab = list.find((x) => x.type === "page" && /viewer\.html/.test(x.url));
    if (!tab) throw new Error("no open viewer tab found on the attached Chrome — open a PDF in the extension first");
    console.log("attached to:", tab.url.slice(0, 90));
  } else {
    const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`;
    tab = await http(`/json/new?${viewerUrl}`, "PUT");
  }
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable"); await sleep(ATTACH ? 600 : 2500);
  if (!ATTACH) {
    await ev(`globalThis.__fxDebug = true`).catch(() => {});
    await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`).catch(() => {});
    for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 80) break; }
    if (ZOOM) { await ev(`window.PDFViewerApplication.pdfViewer.currentScale = ${ZOOM}`); await sleep(2500); }
    await ev(`window.PDFViewerApplication.page = ${PAGE}`); await sleep(2800);
  }
  await ev(HELPER);
  const out = await ev(`(() => {
    const r2 = (n) => Math.round(n*100)/100;
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE-1});
    const div = pv.textLayer.div;
    const glyph = (s) => { const rg=document.createRange(); rg.selectNodeContents(s); const rs=[...rg.getClientRects()].filter(r=>r.width>0&&r.height>0); if(!rs.length) return null; let t=Infinity,b=-Infinity,l=Infinity,r=-Infinity; for(const q of rs){t=Math.min(t,q.top);b=Math.max(b,q.bottom);l=Math.min(l,q.left);r=Math.max(r,q.right);} return {top:t,bottom:b,left:l,right:r}; };
    const done = [...div.querySelectorAll('span[data-fx-done]')].filter(s => s.textContent.trim().length>4 && !/[gjpqy,]/.test(s.textContent));
    const topErrs = [], botErrs = [], rows = [];
    for (const s of done.slice(0, 40)) {
      const og = glyph(s); if (!og) continue;
      const lineH = og.bottom - og.top;
      const cl = window.__canvasInk(pv, og.left, og.right, (og.top+og.bottom)/2, lineH*0.8);
      if (!cl || cl.error || !cl.length) continue;
      // pick the canvas cluster with MAX overlap to the overlay box
      let best=null, bestOv=0; for (const c of cl) { const ov = Math.min(og.bottom,c.bottom)-Math.max(og.top,c.top); if (ov>bestOv){bestOv=ov;best=c;} }
      if (!best || bestOv < lineH*0.3) continue;
      const topErr = best.top - og.top;     // >0 => overlay top ABOVE canvas top (overlay higher)
      const botErr = best.bottom - og.bottom; // >0 => canvas bottom BELOW overlay bottom (overlay higher)
      topErrs.push(topErr); botErrs.push(botErr);
      if (rows.length < 6) rows.push({ t: s.textContent.trim().slice(0,12), topErr: r2(topErr), botErr: r2(botErr), fs: getComputedStyle(s).fontSize, mt: getComputedStyle(s).marginTop, ff: getComputedStyle(s).fontFamily.split(',')[0] });
    }
    const med = (a) => { if (!a.length) return null; const x=[...a].sort((p,q)=>p-q); return r2(x[Math.floor(x.length/2)]); };
    return { dpr: window.devicePixelRatio, pdfZoom: Math.round(window.PDFViewerApplication.pdfViewer.currentScale*1000)/1000, page: ${PAGE}, n: topErrs.length, medTopErr: med(topErrs), medBotErr: med(botErrs), rows };
  })()`);
  const calib = await ev(`globalThis.__fxBaselineCalib || null`).catch(() => null);
  console.log(`dsf=${DSF || 1} zoom=${ZOOM || "default"}  ${JSON.stringify({ dpr: out.dpr, pdfZoom: out.pdfZoom, n: out.n, medTopErr: out.medTopErr, medBotErr: out.medBotErr })}  calib=${JSON.stringify(calib)}`);
} catch (e) { console.error("baseline diag error:", e); }
finally { try { ws?.close(); } catch {} browser?.kill(); await sleep(500); if (!ATTACH) { try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} } }
