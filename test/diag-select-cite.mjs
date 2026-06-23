// Diagnostic for three reported issues in reading (fx-on) mode:
//   1. citation hit-target: only the brackets of "[N]" are clickable, not the
//      number — measure, per citation, whether a .fx-cite-hit covers the DIGITS
//      sub-rect as well as the bracket sub-rects.
//   2. selection highlight: programmatically select a body line and report the
//      captured text (native copy of a partial selection uses the selection's
//      toString), plus the computed ::selection background reachability.
//   3. copy: verify getSelection().toString() reassembles words+spaces.
// Walks the first ~12 pages, enables fx, then probes.
// Usage: node test/diag-select-cite.mjs [template]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const FILTER = process.argv.slice(2).find((a) => !a.toLowerCase().endsWith(".exe")) ?? "Two-column B";
const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "Two-column C": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "arXiv": "https://arxiv.org/pdf/1706.03762",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9371 + (process.pid % 150);
const userDataDir = join(tmpdir(), `fx-diag-${process.pid}`);
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

const PROBE = `(() => {
  const viewer = window.PDFViewerApplication.pdfViewer;
  const out = { cites: [], selection: null, copyHandler: null };
  const rr = (r) => ({ l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  const ov = (a, b) => { const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return w > 0 && h > 0 ? w * h : 0; };

  // --- Citation hit coverage ---
  // For each leaf/colored span containing a "[N]" pattern, build sub-ranges for
  // the digits vs the brackets, then check whether a .fx-cite-hit covers each.
  const rangeRect = (node, from, to) => { const r = document.createRange(); r.setStart(node, from); r.setEnd(node, to); const b = r.getBoundingClientRect(); return b.width > 0 ? b : null; };
  // Find the deepest text node + offset for a character index within a span.
  const textNodeAt = (span, idx) => {
    const w = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let pos = 0;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (idx <= pos + n.data.length) return { node: n, off: idx - pos };
      pos += n.data.length;
    }
    return null;
  };
  const subRect = (span, a, b) => {
    const s = textNodeAt(span, a), e = textNodeAt(span, b);
    if (!s || !e) return null;
    const r = document.createRange();
    r.setStart(s.node, s.off); r.setEnd(e.node, e.off);
    const bb = r.getBoundingClientRect();
    return bb.width > 0 ? bb : null;
  };

  let scanned = 0;
  for (let i = 0; i < viewer.pagesCount && out.cites.length < 14; i++) {
    const pv = viewer.getPageView(i);
    const div = pv?.textLayer?.div;
    if (!div || !div.childElementCount) continue;
    const hits = [...pv.div.querySelectorAll(".fx-cite-hit")].map((a) => a.getBoundingClientRect());
    // every span (leaf OR wrapped) — citations may be inside a colored wrapper
    const spans = [...div.querySelectorAll("span")];
    for (const span of spans) {
      const txt = span.textContent;
      const m = /\\[(\\d{1,3})\\]/.exec(txt);
      if (!m) continue;
      scanned++;
      const lb = m.index, num0 = m.index + 1, num1 = m.index + 1 + m[1].length, rb = num1;
      const full = subRect(span, lb, rb + 1);
      const digits = subRect(span, num0, num1);
      const lbR = subRect(span, lb, lb + 1);
      const rbR = subRect(span, rb, rb + 1);
      if (!full || !digits) continue;
      const cover = (r) => r ? hits.reduce((s, h) => s + ov(r, h), 0) / Math.max(1, r.width * r.height) : null;
      out.cites.push({
        page: pv.id,
        text: txt.slice(Math.max(0, lb - 6), rb + 7).trim().slice(0, 24),
        cite: m[0],
        wrapped: !!span.querySelector("span"),
        flag: span.dataset.fxDone ? "DONE" : span.dataset.fxKeep ? "KEEP" : span.dataset.fxTable ? "TABLE" : "canvas",
        hitCount: hits.length,
        coverFull: +(cover(full) || 0).toFixed(2),
        coverDigits: +(cover(digits) || 0).toFixed(2),
        coverLB: +(cover(lbR) || 0).toFixed(2),
        coverRB: +(cover(rbR) || 0).toFixed(2),
        fullRect: rr(full), digitsRect: rr(digits),
        html: span.outerHTML.slice(0, 200),
      });
      if (out.cites.length >= 14) break;
    }
  }
  out.scanned = scanned;

  // --- Selection / copy test ---
  // Pick a processed body span on the first content page and select ~6 words.
  for (let i = 0; i < viewer.pagesCount; i++) {
    const pv = viewer.getPageView(i);
    const div = pv?.textLayer?.div;
    if (!div) continue;
    const done = [...div.querySelectorAll("span[data-fx-done]")].filter((s) => s.textContent.trim().split(/\\s+/).length >= 5);
    if (done.length < 3) continue;
    const a = done[1], b = done[Math.min(done.length - 1, 3)];
    const sel = window.getSelection();
    sel.removeAllRanges();
    const r = document.createRange();
    r.setStart(a.firstChild || a, 0);
    r.setEndAfter(b.lastChild || b);
    sel.addRange(r);
    const selText = sel.toString();
    // computed ::selection bg is not directly queryable; report the matched CSS
    // by checking which stylesheet rule wins via a temp probe is unreliable —
    // instead report that selection captured text + word/space integrity.
    out.selection = {
      page: pv.id,
      spanCount: done.length,
      text: selText.slice(0, 160),
      len: selText.length,
      hasSpaces: /\\s/.test(selText),
      words: selText.trim().split(/\\s+/).length,
    };
    break;
  }
  out.copyHandler = !!document.getElementById("hiddenCopyElement");
  return out;
})()`;

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.url.includes("service-worker")); if (sw) extId = new URL(sw.url).hostname; else await sleep(250); }
  console.log(`Browser: ${version.Browser}  paper: ${FILTER}\n`);
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(2500);
  await ev(`globalThis.__fxDebug = true`);
  await ev(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 100) break; }
  const pages = await ev(`window.PDFViewerApplication.pagesCount`);
  for (let p = 1; p <= Math.min(pages, 12); p++) { await ev(`window.PDFViewerApplication.page = ${p}`); await sleep(1100); }
  await ev(`window.PDFViewerApplication.page = 1`); await sleep(800);
  const res = await ev(PROBE);
  console.log(JSON.stringify(res, null, 2));
  writeFileSync(join(root, "test", "out", `diag-${FILTER.replace(/\W+/g, "")}.json`), JSON.stringify(res, null, 2));
} catch (e) { console.error("diag error:", e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
