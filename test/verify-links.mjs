// Corpus check for the link-border fix + a guard that OUR masks track the
// DISPLAYED glyphs (not the logical text box). Per paper, on 2 sampled pages:
//  - native hyperref link borders present with fx OFF? suppressed with fx ON?
//  - link <a> still clickable (href kept, external links pointer-events!=none)?
//  - avg |maskTop - glyphTop| and worst mask-above-glyph for processed spans.
// Usage: node test/verify-links.mjs [browser]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const BROWSER = process.argv.slice(2).find((a) => a.toLowerCase().endsWith(".exe")) ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PAPERS = [
  ["Two-column A", "https://yilud.me/usenixsecurity25-dong-yilu.pdf", [3, 5]],
  ["Two-column B", "https://yilud.me/usenixsecurity24-tu.pdf", [4, 10]],
  ["Two-column C", "https://yilud.me/AFC_Attacks_NSDI.pdf", [3, 5]],
  ["Two-column D", "https://yilud.me/Proteus-ccs24.pdf", [3, 6]],
  ["arXiv", "https://arxiv.org/pdf/1706.03762", [3, 10]],
];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9353;
const userDataDir = join(tmpdir(), `fx-vlinks-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(BROWSER, [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,1800",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
  return { ws, ev };
}

const MEASURE = (pages) => `(() => {
  const r2 = (n) => Math.round(n*10)/10;
  const glyphRect = (s) => { const rg = document.createRange(); rg.selectNodeContents(s); const rs=[...rg.getClientRects()].filter(r=>r.width>0&&r.height>0); if(!rs.length) return null; let t=Infinity,b=-Infinity; for(const r of rs){t=Math.min(t,r.top);b=Math.max(b,r.bottom);} return {top:t,bottom:b}; };
  let linkBorders=0, linksTotal=0, linksClickable=0, offN=0, offSum=0, maskAbove=0, doneN=0;
  for (const p of ${JSON.stringify(pages)}) {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(p-1);
    if (!pv?.textLayer?.div) continue;
    const layer = pv.div.querySelector('.annotationLayer');
    if (layer) for (const a of layer.querySelectorAll('.linkAnnotation')) {
      linksTotal++;
      const cs = getComputedStyle(a);
      if (parseFloat(cs.borderTopWidth) > 0) linkBorders++;
      const link = a.querySelector('a') || a;
      const href = link.getAttribute && link.getAttribute('href');
      if (href && getComputedStyle(link).pointerEvents !== 'none') linksClickable++;
    }
    const div = pv.textLayer.div;
    const masks = [...pv.div.querySelectorAll('.fx-mask > div')].map(m=>m.getBoundingClientRect());
    for (const s of [...div.querySelectorAll('span[data-fx-done]')].slice(0,60)) {
      const g = glyphRect(s); if (!g) continue;
      const box = s.getBoundingClientRect();
      let mtop=null,bestov=0; for(const m of masks){const ov=Math.min(box.bottom,m.bottom)-Math.max(box.top,m.top); if(ov>bestov&&Math.min(box.right,m.right)-Math.max(box.left,m.left)>0){bestov=ov;mtop=m;}}
      offSum += Math.abs(box.top - g.top); offN++; doneN++;
      if (mtop && mtop.bottom < g.top + (g.bottom-g.top)*0.4) maskAbove++; // mask sits above glyph
    }
  }
  return { linksTotal, linkBorders, linksClickable, doneN, avgBoxGlyphOffset: r2(offSum/Math.max(1,offN)), maskAbove };
})()`;

let fails = 0;
try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.url.includes("service-worker")); if (sw) extId = new URL(sw.url).hostname; else await sleep(250); }
  console.log(`Browser: ${version.Browser}\n`);
  console.log("paper            | links | bordersOFF | bordersON | clickable | done | offset | maskAbove");
  for (const [name, url, pages] of PAPERS) {
    const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(url)}`;
    const tab = await http(`/json/new?${viewerUrl}`, "PUT");
    const { ws, ev } = await cdp(tab.webSocketDebuggerUrl);
    try {
      await sleep(2000);
      await ev(`chrome.storage.sync.set({ enabled: false })`); await sleep(500);
      for (const p of pages) { await ev(`window.PDFViewerApplication.page = ${p}`); await sleep(1800); }
      const off = await ev(MEASURE(pages));
      await ev(`chrome.storage.sync.set({ enabled: true })`); await sleep(1500);
      for (const p of pages) { await ev(`window.PDFViewerApplication.page = ${p}`); await sleep(1800); }
      const on = await ev(MEASURE(pages));
      // expectations: borders present OFF (if the paper has them) are gone ON;
      // clickable count preserved; our masks track glyphs (offset small, no mask-above).
      const bordersGoneOn = on.linkBorders === 0;
      const clickKept = on.linksClickable >= Math.min(off.linksClickable, on.linksTotal) * 0.9 || on.linksTotal === 0;
      const masksTrackGlyphs = on.avgBoxGlyphOffset <= 4 && on.maskAbove === 0;
      const ok = bordersGoneOn && clickKept && masksTrackGlyphs;
      if (!ok) fails++;
      console.log(`${name.padEnd(16)} | ${String(on.linksTotal).padStart(5)} | ${String(off.linkBorders).padStart(10)} | ${String(on.linkBorders).padStart(9)} | ${String(on.linksClickable).padStart(9)} | ${String(on.doneN).padStart(4)} | ${String(on.avgBoxGlyphOffset).padStart(6)} | ${String(on.maskAbove).padStart(9)}  ${ok ? "" : "<< FAIL"}`);
    } finally { ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); }
  }
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL LINK CHECKS PASSED");
} catch (e) { console.error("verify-links error:", e); fails++; }
finally { browser.kill(); await sleep(500); rmSync(userDataDir, { recursive: true, force: true }); }
process.exit(fails ? 1 : 0);
