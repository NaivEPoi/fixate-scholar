// Real mouse-drag selection + copy probe. Drags across a body line via CDP
// Input events, reads the resulting selection, screenshots it (to see whether
// the highlight is visible), and confirms a Ctrl+C copy isn't swallowed by
// PDF.js's select-all handler. Run before/after the fixes for before/after
// evidence. Usage: node test/diag-drag.mjs [template]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const FILTER = process.argv.slice(2).find((a) => !a.toLowerCase().endsWith(".exe")) ?? "arXiv";
const TAG = process.argv.slice(2).find((a) => a.startsWith("--tag="))?.slice(6) ?? "pre";
const PAPERS = {
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "arXiv": "https://arxiv.org/pdf/1706.03762",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9411 + (process.pid % 150);
const userDataDir = join(tmpdir(), `fx-drag-${process.pid}`);
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
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseMoved" ? 1 : 1, clickCount: 1, ...extra });

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.url.includes("service-worker")); if (sw) extId = new URL(sw.url).hostname; else await sleep(250); }
  console.log(`Browser: ${version.Browser}  paper: ${FILTER}  tag: ${TAG}\n`);
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(2500);
  await ev(`globalThis.__fxDebug = true`);
  await ev(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 100) break; }
  // Scroll a multi-word processed body line near the top of some page into the
  // viewport center, so two-column papers (page-1 top is title/authors) have a
  // clean line to drag. Records which page for the selection coords below.
  await ev(`(() => {
    const v = window.PDFViewerApplication.pdfViewer;
    for (let i = 0; i < v.pagesCount; i++) {
      const div = v.getPageView(i)?.textLayer?.div;
      if (!div) continue;
      const cand = [...div.querySelectorAll("span[data-fx-done]")].find((s) => s.textContent.trim().split(/\\s+/).length >= 6);
      if (cand) { cand.scrollIntoView({ block: "center" }); return; }
    }
  })()`);
  await sleep(900);
  // Install a copy listener that records what would be written and whether
  // pdf.js intercepted (copyAll class).
  await ev(`
    globalThis.__copy = null;
    document.addEventListener("copy", (e) => {
      globalThis.__copy = { sel: document.getSelection().toString(), copyAll: window.PDFViewerApplication.pdfViewer.viewer.classList.contains("copyAll") };
    }, true);
  `);
  // Pick a processed body line currently in the viewport (any page) and compute
  // drag start/end in viewport coords.
  const drag = await ev(`(() => {
    const v = window.PDFViewerApplication.pdfViewer;
    let done = [];
    for (let i = 0; i < v.pagesCount; i++) {
      const div = v.getPageView(i)?.textLayer?.div;
      if (!div) continue;
      const d = [...div.querySelectorAll("span[data-fx-done]")].filter((s) => { const r = s.getBoundingClientRect(); return r.top > 60 && r.bottom < window.innerHeight - 60 && r.width > 0 && s.textContent.trim().split(/\\s+/).length >= 4; });
      if (d.length >= 4) { done = d; break; }
    }
    if (done.length < 4) return null;
    const a = done[2].getBoundingClientRect();
    const b = done[Math.min(done.length - 1, 5)].getBoundingClientRect();
    return { x0: a.left + 2, y0: a.top + a.height / 2, x1: b.right - 2, y1: b.top + b.height / 2, top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: a.left, right: b.right };
  })()`);
  if (!drag) { console.log("no draggable line found"); }
  else {
    await mouse("mousePressed", drag.x0, drag.y0);
    const steps = 8;
    for (let s = 1; s <= steps; s++) await mouse("mouseMoved", drag.x0 + (drag.x1 - drag.x0) * s / steps, drag.y0 + (drag.y1 - drag.y0) * s / steps);
    await mouse("mouseReleased", drag.x1, drag.y1);
    await sleep(300);
    const selText = await ev(`document.getSelection().toString()`);
    // Trigger copy (Ctrl+C)
    await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "c", code: "KeyC", windowsVirtualKeyCode: 67 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "c", code: "KeyC", windowsVirtualKeyCode: 67 });
    await sleep(200);
    const copyInfo = await ev(`globalThis.__copy`);
    console.log("selection.toString():", JSON.stringify(selText.slice(0, 120)), `(len ${selText.length})`);
    console.log("copy event:", JSON.stringify(copyInfo));
    // Screenshot the selected region (scaled) to inspect the highlight.
    const clip = { x: Math.max(0, drag.left - 20), y: Math.max(0, drag.top - 14), width: Math.min(900, drag.right - drag.left + 60), height: drag.bottom - drag.top + 28 };
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { ...clip, scale: 2 } });
    const outPath = join(root, "test", "out", `drag-${FILTER.replace(/\W+/g, "")}-${TAG}.png`);
    writeFileSync(outPath, Buffer.from(shot.data, "base64"));
    console.log("saved", outPath);
  }
} catch (e) { console.error("drag error:", e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
