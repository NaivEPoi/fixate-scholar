// Citation behavior audit. Per page, for every numeric citation bracket
// (incl. locator forms like "[9, §5.2.2.1]"):
//  - JUMP-CITE: an ACTIVE native link annotation overlaps it -> clicking
//    would scroll to the bibliography instead of opening our card (reconcile
//    failure). Must be 0.
//  - NO-HIT: no .fx-cite-hit covers it -> no card at all. Must be 0.
//  - UNRESOLVED: cited numbers missing from the parsed bibliography
//    (__fxRefNums); such keys still get a stub card, but a nonzero count
//    flags extraction gaps (or a paper citing beyond its own bibliography).
// Usage: node test/citeaudit.mjs <url> [--pages=A-B]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const URL0 = process.argv[2];
const RANGE = (process.argv.slice(3).find((a) => a.startsWith("--pages="))?.slice(8) ?? "").split("-").map((n) => parseInt(n, 10));
const EXT = "C:\\misc\\Claude_Workspace\\fixate-scholar\\extension";
const PORT = 9271 + (process.pid % 140);
const userDataDir = join(tmpdir(), `fx-ca-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 400)); return r.result.value; };

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(3000);
  for (let i = 0; i < 25; i++) { const ok = await ev(`!!(typeof chrome!=='undefined' && chrome.storage && chrome.storage.sync)`).catch(() => false); if (ok) break; await sleep(400); }
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  for (let i = 0; i < 40; i++) { await sleep(700); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 80) break; }
  const nPages = await ev(`window.PDFViewerApplication.pdfViewer.pagesCount`);
  const p0 = RANGE[0] || 1;
  const p1 = RANGE[1] || nPages;
  let totalActive = 0;
  let totalMissing = 0;
  for (let p = p0; p <= p1; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`).catch(() => {});
    await sleep(2500);
    for (let i = 0; i < 20; i++) {
      const n = await ev(`(() => { const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1}); return pv && pv.textLayer ? pv.textLayer.div.querySelectorAll('span[data-fx-done]').length : 0; })()`).catch(() => 0);
      if (n > 0) break;
      await sleep(600);
    }
    await sleep(800);
    const res = await ev(`(() => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
      if (!pv || !pv.textLayer) return null;
      const out = { jumpCites: [], noHit: [], missing: [] };
      // Active native internal-destination links (pointer-events not disabled).
      const activeLinks = [];
      const layer = pv.div.querySelector('.annotationLayer');
      if (layer) {
        for (const a of layer.querySelectorAll('a')) {
          const href = a.getAttribute('href') || '';
          if (/^(https?|mailto|tel):/i.test(href)) continue;
          const r = a.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const sec = a.closest('section') || a;
          if (a.style.pointerEvents === 'none' && sec.style.pointerEvents === 'none') continue;
          activeLinks.push(r);
        }
      }
      const hits = [...pv.div.querySelectorAll('.fx-cite-hit')].map((h) => h.getBoundingClientRect());
      const ov = (a, b) => { const w = Math.min(a.right,b.right)-Math.max(a.left,b.left); const h = Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top); return w>0&&h>0 ? w*h : 0; };
      // Rebuild page text exactly like the annotator (skip markedContent wrappers).
      let joined = '';
      const spans = [];
      for (const s of pv.textLayer.div.querySelectorAll('span')) {
        if (s.querySelector('span')) continue;
        const t = s.textContent;
        if (!t) continue;
        spans.push({ s, start: joined.length, end: joined.length + t.length });
        joined += t;
      }
      const rangeRects = (span, start, end) => {
        const range = document.createRange();
        let pos = 0, startSet = false;
        const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const len = node.data.length;
          if (!startSet && start < pos + len) { range.setStart(node, start - pos); startSet = true; }
          if (startSet && end <= pos + len) { range.setEnd(node, end - pos); return [...range.getClientRects()].filter((r) => r.width > 0); }
          pos += len;
        }
        return [];
      };
      const rectsFor = (a, b) => {
        const rs = [];
        for (const sg of spans) {
          if (sg.end <= a || sg.start >= b) continue;
          const ls = Math.max(0, a - sg.start), le = Math.min(sg.end - sg.start, b - sg.start);
          rs.push(...rangeRects(sg.s, ls, le));
        }
        return rs;
      };
      // Match numeric citations INCLUDING a locator ("[9, §5.2.2.1]").
      const NUM = /\\[(\\d{1,3}(?:\\s*[,;\\u2013\\u2014-]\\s*\\d{1,3})*)(?:\\s*,\\s*(?:§|¶|pp?\\.|[A-Z])[^\\]]{0,55})?\\]/g;
      for (const m of joined.matchAll(NUM)) {
        const a = m.index, b = m.index + m[0].length;
        // lists containing 0 are math vectors, not citations (parser rule)
        if (m[1].split(/[^0-9]+/).includes('0')) continue;
        if (spans.some((sg) => sg.end > a && sg.start < b && sg.s.dataset.fxRefs)) continue;
        const rs = rectsFor(a, b);
        // Bug 1: an ACTIVE native link overlaps this citation -> click jumps to
        // the bibliography instead of opening our card.
        const jumps = rs.some((cr) => activeLinks.some((lr) => ov(cr, lr) > 0.25 * cr.width * cr.height));
        if (jumps) out.jumpCites.push({ cite: m[0].slice(0, 24), x: Math.round(rs[0]?.left||0), y: Math.round(rs[0]?.top||0) });
        // Card coverage: is there a hit-target over this citation?
        const hasHit = rs.some((cr) => hits.some((hr) => ov(cr, hr) > 0.25 * cr.width * cr.height));
        if (!hasHit) out.noHit.push({ cite: m[0].slice(0, 24), x: Math.round(rs[0]?.left||0), y: Math.round(rs[0]?.top||0) });
        // Resolution: keys parsed vs entries present.
        const keys = [];
        for (const part of m[1].split(/[,;]/)) {
          const rg = /^\\s*(\\d{1,3})\\s*[\\u2013\\u2014-]\\s*(\\d{1,3})\\s*$/.exec(part);
          if (rg) { const a0 = parseInt(rg[1],10), b0 = parseInt(rg[2],10); for (let n = a0; n <= Math.min(b0, a0+12); n++) keys.push(n); }
          else { const n1 = /^\\s*(\\d{1,3})\\s*$/.exec(part); if (n1) keys.push(parseInt(n1[1],10)); }
        }
        const nums = globalThis.__fxRefNums || [];
        const unresolved = keys.filter((k) => !nums.includes(k));
        if (unresolved.length) out.missing.push({ cite: m[0].slice(0, 24), unresolved });
      }
      return out;
    })()`);
    if (!res) { console.log('p' + p + ': no textLayer'); continue; }
    for (const l of res.jumpCites) { totalActive++; console.log(`p${p} JUMP-CITE (${l.x},${l.y}) "${l.cite}"`); }
    for (const l of res.noHit) { console.log(`p${p} NO-HIT (${l.x},${l.y}) "${l.cite}"`); }
    for (const mm of res.missing) { totalMissing++; console.log(`p${p} UNRESOLVED ${JSON.stringify(mm)}`); }
    console.log(`p${p}: jumpCites=${res.jumpCites.length} noHit=${res.noHit.length} unresolved=${res.missing.length}`);
  }
  console.log(`TOTAL jumpCites=${totalActive} unresolved=${totalMissing} refCount=` + await ev('globalThis.__fxRefCount ?? -1').catch(() => -1));
} catch (e) { console.error('citeaudit error:', e.message || e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
