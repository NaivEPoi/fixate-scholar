// Definitive CSP-violation + visual-baseline probe (Edge; same Chromium engine
// and same viewer.html CSP as Chrome). Closes the load-time capture gap: it
// installs the securitypolicyviolation listener via addScriptToEvaluateOnNewDocument
// (persists across reloads), then RELOADS so the listener is present from the
// very first byte. Then enables fx, scrolls, opens a citation popup, and dumps
// every CSP violation with full source/sample/line. Also screenshots body text.
// Usage: node test/diag-csp.mjs [template]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const FILTER = process.argv.slice(2).find((a) => !a.startsWith("--") && !a.toLowerCase().endsWith(".exe")) ?? "arXiv";
const DSF = parseFloat(process.argv.slice(2).find((a) => a.startsWith("--dsf="))?.slice(6) ?? "0");
const HEADFUL = process.argv.includes("--headful");
const ZOOMV = parseFloat(process.argv.slice(2).find((a) => a.startsWith("--zoom="))?.slice(7) ?? "0");
const PG = parseInt(process.argv.slice(2).find((a) => a.startsWith("--page="))?.slice(7) ?? "1", 10);
const IDLE = parseInt(process.argv.slice(2).find((a) => a.startsWith("--idle="))?.slice(7) ?? "0", 10);
const PAPERS = {
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "arXiv": "https://arxiv.org/pdf/1706.03762",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9521 + (process.pid % 120);
const userDataDir = join(tmpdir(), `fx-csp-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, ...(HEADFUL ? [] : ["--headless=new"]), "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,1800",
  ...(DSF ? [`--force-device-scale-factor=${DSF}`, "--high-dpi-support=1"] : []),
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 0;
const cspLog = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  console.log(`Browser: ${version.Browser}  ext: ${extId}  paper: ${FILTER}\n`);
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Log.entryAdded") { const en = m.params.entry; if (/Content Security Policy|inline style|style-src|violates/i.test(en.text)) cspLog.push(`LOG ${en.source}: ${en.text.replace(/\s+/g, " ").slice(0, 160)} @${(en.url || "").split("/").pop()}:${en.lineNumber}`); }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  // Listener persists across reload, so it sees load-time violations.
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__csp = []; addEventListener('securitypolicyviolation', (e) => window.__csp.push({ d: e.violatedDirective, sample: (e.sample||'').slice(0,80), src: (e.sourceFile||'').split('/').pop(), line: e.lineNumber, col: e.columnNumber, blocked: e.blockedURI }));` });
  await sleep(1500);
  await send("Page.reload");
  await sleep(3500);
  // enable fx
  let storageOk = false;
  for (let i = 0; i < 25; i++) { storageOk = await ev(`!!(typeof chrome!=='undefined' && chrome.storage && chrome.storage.sync)`).catch(() => false); if (storageOk) break; await sleep(400); }
  if (storageOk) await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 80) break; }
  if (ZOOMV) { await ev(`window.PDFViewerApplication.pdfViewer.currentScale = ${ZOOMV}`).catch(() => {}); await sleep(2500); }
  if (PG > 1) { await ev(`window.PDFViewerApplication.page = ${PG}`).catch(() => {}); await sleep(2800); }
  // Open a citation popup (exercise popup.mjs DOM building).
  await ev(`(() => { const a = document.querySelector('.fx-cite-hit'); if (a) { a.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); a.dispatchEvent(new MouseEvent('click', { bubbles: true })); } return !!a; })()`).catch(() => {});
  await sleep(1500);
  const popupShown = await ev(`!!document.querySelector('.fx-cite-popup')`).catch(() => false);

  const inPage = await ev(`window.__csp || []`);
  // Collapse duplicates.
  const map = new Map();
  for (const v of inPage) { const k = `${v.d} | ${v.src}:${v.line}:${v.col} | sample="${v.sample}" | blocked=${v.blocked}`; map.set(k, (map.get(k) || 0) + 1); }
  console.log("CSP via securitypolicyviolation:", inPage.length, "events,", map.size, "unique");
  for (const [k, n] of map) console.log(`  x${n}  ${k}`);
  console.log("\nCSP via Log domain:", cspLog.length);
  for (const l of [...new Set(cspLog)].slice(0, 20)) console.log("  " + l);
  console.log("\npopup opened (popup.mjs exercised):", popupShown);

  // X-ray mode: hide the white masks and paint the processed overlay glyphs
  // semi-transparent red, so any overlay-vs-canvas (black ink) vertical offset
  // is directly visible. The overlay should sit exactly on the canvas glyphs.
  if (IDLE) { console.log(`...sitting idle ${IDLE}s (triggers PDF.js 30s cleanup)...`); await sleep(IDLE * 1000); }
  const XRAY = process.argv.includes("--xray");
  if (XRAY) await ev(`(() => { const s = document.createElement('style'); s.textContent = '.fx-mask{display:none!important} #viewerContainer.fx-on .textLayer span[data-fx-done], #viewerContainer.fx-on .textLayer span[data-fx-done] .fx-b{color:rgba(220,0,0,.7)!important;-webkit-text-stroke:0!important}'; document.head.append(s); })()`).catch(() => {});
  // Screenshot a tight body region for visual baseline inspection.
  const clip = await ev(`(() => {
    const v = window.PDFViewerApplication.pdfViewer;
    const div = v.getPageView(v.currentPageNumber - 1).textLayer.div;
    const done = [...div.querySelectorAll('span[data-fx-done]')].filter(s => { const r = s.getBoundingClientRect(); return r.top > 60 && r.bottom < window.innerHeight - 60 && r.width > 20; });
    if (done.length < 2) return null;
    const a = done[Math.min(2, done.length - 1)].getBoundingClientRect();
    return ${process.argv.includes("--xray")} ? { x: Math.max(0, a.left - 10), y: Math.max(0, a.top - 10), width: 420, height: 76 } : { x: Math.max(0, a.left - 20), y: Math.max(0, a.top - 16), width: 760, height: 120 };
  })()`).catch(() => null);
  const fn = `csp-baseline-${FILTER.replace(/\W+/g, "")}${DSF ? "-dsf" + DSF : ""}${HEADFUL ? "-hf" : ""}${ZOOMV ? "-z" + ZOOMV : ""}-p${PG}${XRAY ? "-xray" : ""}.png`;
  const shotParams = clip ? { format: "png", clip: { ...clip, scale: XRAY ? 4 : DSF ? 1.5 : 2 } } : { format: "png" };
  const shot = await send("Page.captureScreenshot", shotParams);
  writeFileSync(join(root, "test", "out", fn), Buffer.from(shot.data, "base64"));
  console.log("\nsaved", fn, clip ? "(tight)" : "(full viewport — sparse page)");
} catch (e) { console.error("csp probe error:", e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
