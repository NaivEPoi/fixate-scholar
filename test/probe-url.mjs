// Identify what the cyan box around a URL is (our mask? native link
// annotation?) and whether any fx-mask is vertically offset from the displayed
// glyphs. Dumps every element stacked at the URL, and the mask-vs-glyph
// geometry for the URL's text line. fx-off and fx-on screenshots.
// Usage: node test/probe-url.mjs [pdf-url] [urlText] [page]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://arxiv.org/pdf/1706.03762";
const URLTEXT = process.argv[3] ?? "tensor2tensor";
const PAGE = parseInt(process.argv[4] ?? "10", 10);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9349;
const userDataDir = join(tmpdir(), `fx-url-${process.pid}`);
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
const shotRegion = async (name) => {
  const clip = await ev(`(() => {
    const div = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE-1}).textLayer.div;
    const s = [...div.querySelectorAll('span')].find(x => x.textContent.includes(${JSON.stringify(URLTEXT)}));
    if (!s) return null;
    const r = s.getBoundingClientRect();
    if (r.top < 20 || r.bottom > window.innerHeight - 20) return { off: Math.round(r.top) };
    return { x: Math.max(0, r.left - 200), y: Math.max(0, r.top - 60), width: 760, height: 130 };
  })()`);
  if (clip && !clip.off) {
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { ...clip, scale: 2 } });
    writeFileSync(join(root, "test", "out", name), Buffer.from(shot.data, "base64"));
    console.log("saved " + name);
  } else console.log(name + " skipped:", JSON.stringify(clip));
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
  // Keep fx OFF first.
  await ev(`chrome.storage.sync.set({ enabled: false })`);
  await sleep(500);
  await ev(`window.PDFViewerApplication.page = ${PAGE}`);
  await sleep(2500);
  await shotRegion("url-fxoff.png");

  // Now enable fx.
  await ev(`chrome.storage.sync.set({ enabled: true })`);
  await sleep(3000);
  await shotRegion("url-fxon.png");

  const out = await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE-1});
    const div = pv.textLayer.div;
    const r2 = (n) => Math.round(n*10)/10;
    const urlSpan = [...div.querySelectorAll('span')].find(s => s.textContent.includes(${JSON.stringify(URLTEXT)}));
    if (!urlSpan) return { error: 'url span not found' };
    const ur = urlSpan.getBoundingClientRect();
    const cx = (ur.left+ur.right)/2, cy = (ur.top+ur.bottom)/2;
    // every element stacked at the URL center
    const stack = document.elementsFromPoint(cx, cy).slice(0, 8).map(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, cls: (el.className||'').toString().slice(0,30), border: cs.borderTopWidth+' '+cs.borderTopColor, bg: cs.backgroundColor, rect: {t:r2(r.top),b:r2(r.bottom),l:r2(r.left),w:r2(r.width)} };
    });
    // any fx-mask overlapping the url span?
    const masksOver = [...pv.div.querySelectorAll('.fx-mask > div')].map(m=>m.getBoundingClientRect())
      .filter(m => Math.min(ur.right,m.right)-Math.max(ur.left,m.left) > 0 && Math.min(ur.bottom,m.bottom)-Math.max(ur.top,m.top) > 0)
      .map(m => ({t:r2(m.top),b:r2(m.bottom),l:r2(m.left),w:r2(m.width)}));
    // annotation layer link rects vs their glyph
    const annLinks = [...(pv.div.querySelector('.annotationLayer')?.querySelectorAll('a')||[])].map(a => {
      const r = a.getBoundingClientRect(); return { href:(a.getAttribute('href')||'').slice(0,40), t:r2(r.top), b:r2(r.bottom), h:r2(r.height) };
    }).filter(a => a.href).slice(0,6);
    return { urlSpanRect: {t:r2(ur.top), b:r2(ur.bottom), h:r2(ur.height), fxDone: !!urlSpan.dataset.fxDone, fxKeep: !!urlSpan.dataset.fxKeep}, masksOver, stack, annLinks };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error("url probe error:", e);
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
