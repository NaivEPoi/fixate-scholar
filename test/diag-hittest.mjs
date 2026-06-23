// Hit-test diagnostic: for each "[N]" citation, find the topmost element at the
// bracket center vs the digit center (document.elementsFromPoint), and report
// the native annotation-layer links overlapping the citation (pointer-events,
// rect). Reveals WHY a number isn't clickable when geometry says a hit covers
// it: a native link or other element sits on top of the digits.
// Usage: node test/diag-hittest.mjs [template]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const FILTER = process.argv.slice(2).find((a) => !a.toLowerCase().endsWith(".exe")) ?? "arXiv";
const PAPERS = {
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "arXiv": "https://arxiv.org/pdf/1706.03762",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9391 + (process.pid % 150);
const userDataDir = join(tmpdir(), `fx-hit-${process.pid}`);
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
  const out = [];
  const desc = (el) => el ? (el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(/\\s+/).join(".") : "") + (el.dataset && el.dataset.fxDone ? "[done]" : "") + " pe=" + getComputedStyle(el).pointerEvents) : "·";
  const textNodeAt = (span, idx) => { const w = document.createTreeWalker(span, NodeFilter.SHOW_TEXT); let pos = 0; for (let n = w.nextNode(); n; n = w.nextNode()) { if (idx <= pos + n.data.length) return { node: n, off: idx - pos }; pos += n.data.length; } return null; };
  const subRect = (span, a, b) => { const s = textNodeAt(span, a), e = textNodeAt(span, b); if (!s || !e) return null; const r = document.createRange(); r.setStart(s.node, s.off); r.setEnd(e.node, e.off); const bb = r.getBoundingClientRect(); return bb.width > 0 ? bb : null; };
  const ov = (a, b) => { const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return w > 0 && h > 0 ? w * h : 0; };
  const rr = (r) => ({ l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });

  for (let i = 0; i < viewer.pagesCount && out.length < 10; i++) {
    const pv = viewer.getPageView(i);
    const div = pv?.textLayer?.div;
    if (!div || !div.childElementCount) continue;
    const aLayer = pv.div.querySelector(".annotationLayer");
    const links = aLayer ? [...aLayer.querySelectorAll("a")] : [];
    for (const span of div.querySelectorAll("span")) {
      const m = /\\[(\\d{1,3})\\]/.exec(span.textContent);
      if (!m) continue;
      const lb = m.index, num0 = m.index + 1, num1 = m.index + 1 + m[1].length;
      const brR = subRect(span, lb, lb + 1);
      const dgR = subRect(span, num0, num1);
      if (!brR || !dgR) continue;
      const bx = brR.left + brR.width / 2, by = brR.top + brR.height / 2;
      const dx = dgR.left + dgR.width / 2, dy = dgR.top + dgR.height / 2;
      const stackB = document.elementsFromPoint(bx, by).slice(0, 3).map(desc);
      const stackD = document.elementsFromPoint(dx, dy).slice(0, 3).map(desc);
      // native links overlapping the full [N]
      const fullR = { left: brR.left, top: brR.top, right: dgR.right + brR.width, bottom: brR.bottom };
      const overLinks = links.filter((a) => ov(a.getBoundingClientRect(), fullR) > 0).map((a) => ({ href: (a.getAttribute("href") || "").slice(0, 18), pe: getComputedStyle(a).pointerEvents, rect: rr(a.getBoundingClientRect()) }));
      out.push({ page: pv.id, cite: m[0], flag: span.dataset.fxDone ? "DONE" : span.dataset.fxKeep ? "KEEP" : span.dataset.fxTable ? "TABLE" : "canvas", topAtBracket: stackB, topAtDigit: stackD, overLinks });
      if (out.length >= 10) break;
    }
  }
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
  for (let p = 1; p <= Math.min(pages, 10); p++) { await ev(`window.PDFViewerApplication.page = ${p}`); await sleep(1100); }
  await ev(`window.PDFViewerApplication.page = 2`); await sleep(800);
  const res = await ev(PROBE);
  console.log(JSON.stringify(res, null, 2));
  writeFileSync(join(root, "test", "out", `hittest-${FILTER.replace(/\W+/g, "")}.json`), JSON.stringify(res, null, 2));
} catch (e) { console.error("hittest error:", e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
