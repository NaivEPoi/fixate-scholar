// Verify: (1) a real click on the DIGIT of a "[N]" citation opens the reference
// card (.fx-cite-popup), and (2) a selection spanning a citation copies the
// "[N]" text. Targets the first in-viewport citation on page 1.
// Usage: node test/diag-click.mjs [template]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const FILTER = process.argv.slice(2).find((a) => !a.toLowerCase().endsWith(".exe")) ?? "arXiv";
const PAPERS = {
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "arXiv": "https://arxiv.org/pdf/1706.03762",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9431 + (process.pid % 150);
const userDataDir = join(tmpdir(), `fx-click-${process.pid}`);
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
const click = async (x, y) => { await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 1, clickCount: 1 }); };

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
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 80) break; }

  // Find the first citation anywhere, scroll it to viewport center, then return
  // its digit-center point and the owning page's text-layer span index.
  await ev(`(() => {
    const v = window.PDFViewerApplication.pdfViewer;
    for (let i = 0; i < v.pagesCount; i++) {
      const div = v.getPageView(i)?.textLayer?.div;
      if (!div) continue;
      for (const span of div.querySelectorAll("span")) {
        if (/\\[(\\d{1,3})\\]/.test(span.textContent)) { globalThis.__citePage = i; span.scrollIntoView({ block: "center" }); return; }
      }
    }
  })()`);
  await sleep(900);
  const target = await ev(`(() => {
    const pageIdx = globalThis.__citePage ?? 0;
    const div = window.PDFViewerApplication.pdfViewer.getPageView(pageIdx).textLayer.div;
    const textNodeAt = (span, idx) => { const w = document.createTreeWalker(span, NodeFilter.SHOW_TEXT); let pos = 0; for (let n = w.nextNode(); n; n = w.nextNode()) { if (idx <= pos + n.data.length) return { node: n, off: idx - pos }; pos += n.data.length; } return null; };
    const subRect = (span, a, b) => { const s = textNodeAt(span, a), e = textNodeAt(span, b); if (!s || !e) return null; const r = document.createRange(); r.setStart(s.node, s.off); r.setEnd(e.node, e.off); const bb = r.getBoundingClientRect(); return bb.width > 0 ? bb : null; };
    const spans = [...div.querySelectorAll("span")];
    for (const span of spans) {
      const m = /\\[(\\d{1,3})\\]/.exec(span.textContent);
      if (!m) continue;
      const dg = subRect(span, m.index + 1, m.index + 1 + m[1].length);
      if (!dg) continue;
      if (dg.top < 80 || dg.bottom > window.innerHeight - 80) continue;
      return { cite: m[0], pageIdx, x: Math.round(dg.left + dg.width / 2), y: Math.round(dg.top + dg.height / 2), spanIdx: spans.indexOf(span), start: m.index, len: m[0].length };
    }
    return null;
  })()`);
  if (!target) { console.log("no in-viewport citation on page 1"); }
  else {
    console.log("target citation:", target.cite, "at", target.x, target.y);
    await ev(`document.querySelector(".fx-cite-popup")?.remove()`);
    await click(target.x, target.y);
    await sleep(700);
    const popup = await ev(`(() => { const p = document.querySelector(".fx-cite-popup"); return p ? { shown: true, text: p.textContent.slice(0, 80) } : { shown: false }; })()`);
    console.log("CLICK number → popup:", JSON.stringify(popup));

    // Selection spanning the citation: copy must include "[N]".
    const selInfo = await ev(`(() => {
      const div = window.PDFViewerApplication.pdfViewer.getPageView(${target.pageIdx}).textLayer.div;
      const spans = [...div.querySelectorAll("span")];
      const span = spans[${target.spanIdx}];
      const sel = window.getSelection(); sel.removeAllRanges();
      const r = document.createRange();
      r.setStartBefore(span.firstChild || span);
      // extend two spans to the right to cross the citation into following text
      const after = spans[${target.spanIdx} + 2] || span;
      r.setEndAfter(after.lastChild || after);
      sel.addRange(r);
      const t = sel.toString();
      return { text: t.slice(0, 100), includesCite: t.includes(${JSON.stringify(target.cite)}) };
    })()`);
    console.log("SELECT across citation:", JSON.stringify(selInfo));
  }
} catch (e) { console.error("click error:", e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
