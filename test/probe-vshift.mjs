// Measure the VERTICAL shift between the original (fx-off = canvas-aligned) glyph
// position and our overlay (fx-on) glyph position for the SAME spans, plus
// whether the mask bottom covers the original glyph's descender. Targets words
// with descenders. Captures fx-off / fx-on high-zoom screenshots.
// Usage: node test/probe-vshift.mjs [pdf-url] [searchText] [page]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://arxiv.org/pdf/1706.03762";
const SEARCH = process.argv[3] ?? "Acknowledg";
const PAGE = parseInt(process.argv[4] ?? "10", 10);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9355;
const userDataDir = join(tmpdir(), `fx-vshift-${process.pid}`);
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
    return { x: Math.max(0, r.left - 10), y: Math.max(0, r.top - 30), width: 420, height: 70 };
  })()`);
  if (clip && !clip.off) { const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { ...clip, scale: 3 } }); writeFileSync(join(root, "test", "out", name), Buffer.from(s.data, "base64")); console.log("saved " + name); }
  else console.log(name + " skip " + JSON.stringify(clip));
};

// Build a stable key per span (text+rounded-left) so we can match fx-off↔fx-on.
const SNAP = `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE-1});
  const div = pv.textLayer.div;
  const r2 = (n)=>Math.round(n*10)/10;
  const glyph = (s) => { const rg=document.createRange(); rg.selectNodeContents(s); const rs=[...rg.getClientRects()].filter(r=>r.width>0&&r.height>0); if(!rs.length) return null; let t=Infinity,b=-Infinity; for(const r of rs){t=Math.min(t,r.top);b=Math.max(b,r.bottom);} return {top:t,bottom:b}; };
  const masks = [...pv.div.querySelectorAll('.fx-mask > div')].map(m=>m.getBoundingClientRect());
  const out = {};
  for (const s of div.querySelectorAll('span')) {
    if (s.querySelector('span')) continue;
    const txt = s.textContent.trim(); if (txt.length < 2 || !/[gjpqy]/.test(txt)) continue; // descender words
    const box = s.getBoundingClientRect(); if (box.width < 1) continue;
    const g = glyph(s); if (!g) continue;
    const key = txt.slice(0,16) + '@' + Math.round(box.left);
    let mb=null,bestov=0; for(const m of masks){const ov=Math.min(box.bottom,m.bottom)-Math.max(box.top,m.top); if(ov>bestov&&Math.min(box.right,m.right)-Math.max(box.left,m.left)>0){bestov=ov;mb=m;}}
    out[key] = { txt: txt.slice(0,16), ff: getComputedStyle(s).fontFamily.split(',')[0].replace(/["']/g,'').slice(0,12), done: !!s.dataset.fxDone, glyphTop: r2(g.top), glyphBot: r2(g.bottom), maskTop: mb?r2(mb.top):null, maskBot: mb?r2(mb.bottom):null };
  }
  return out;
})()`;

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
  await ev(`chrome.storage.sync.set({ enabled: false })`); await sleep(500);
  await ev(`window.PDFViewerApplication.page = ${PAGE}`); await sleep(2500);
  const off = await ev(SNAP);
  await shot("vshift-off.png");
  await ev(`chrome.storage.sync.set({ enabled: true })`); await sleep(3000);
  const on = await ev(SNAP);
  await shot("vshift-on.png");

  // Compare matched keys.
  const rows = [];
  for (const k of Object.keys(off)) {
    if (!on[k]) continue;
    const o = off[k], n = on[k];
    rows.push({
      txt: o.txt, done: n.done, ffOff: o.ff, ffOn: n.ff,
      glyphTopShift: +(n.glyphTop - o.glyphTop).toFixed(1),   // <0 => overlay HIGHER than original
      glyphBotShift: +(n.glyphBot - o.glyphBot).toFixed(1),
      maskBot_minus_origBot: n.maskBot != null ? +(n.maskBot - o.glyphBot).toFixed(1) : null, // <0 => mask cuts original descender
      maskTop_minus_origTop: n.maskTop != null ? +(n.maskTop - o.glyphTop).toFixed(1) : null,
    });
  }
  const avg = (f) => rows.length ? +(rows.reduce((a, r) => a + (r[f] ?? 0), 0) / rows.length).toFixed(2) : null;
  console.log(JSON.stringify({
    matched: rows.length,
    avgGlyphTopShift: avg('glyphTopShift'),
    avgMaskBotMinusOrigBot: avg('maskBot_minus_origBot'),
    descenderCut: rows.filter(r => r.maskBot_minus_origBot != null && r.maskBot_minus_origBot < -0.5).length,
    sample: rows.slice(0, 12),
  }, null, 2));
} catch (e) {
  console.error("vshift probe error:", e);
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
