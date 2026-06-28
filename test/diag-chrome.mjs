// Chrome dev/diagnostic harness. Chrome stable >=137 gates --load-extension
// behind a feature flag, so we re-enable it with
// --disable-features=DisableLoadExtensionCommandLineSwitch. Captures, on a PDF:
//   - CSP violations WITH SOURCE (securitypolicyviolation: directive, sample,
//     sourceFile:line) — pinpoints the blocked inline style.
//   - service-worker console errors / exceptions (the DNR duplicate-id error).
//   - DNR session-rule ids (must be unique).
//   - glyph baseline offset: canvas-pixel glyph top vs overlay span top
//     (overlayHigherBy>0 => overlay sits ABOVE the canvas glyph = misaligned).
// Usage: node test/diag-chrome.mjs [template] [page]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--") && !a.toLowerCase().endsWith(".exe"));
const FILTER = POS.find((a) => !/^\d+$/.test(a)) ?? "arXiv";
const PAGE = parseInt(POS.find((a) => /^\d+$/.test(a)) ?? "10", 10);
const DSF = parseFloat(process.argv.slice(2).find((a) => a.startsWith("--dsf="))?.slice(6) ?? "0"); // device scale factor (high-DPI repro)
const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "Two-column C": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "Two-column D": "https://yilud.me/Proteus-ccs24.pdf",
  "Two-column E": "https://yilud.me/SIB-Auth.pdf",
  "Two-column F": "https://yilud.me/a33-dong%20stamped.pdf",
  "arXiv": "https://arxiv.org/pdf/1706.03762",
};
const USE_EDGE = process.argv.slice(2).includes("--edge");
const CHROME = USE_EDGE
  ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9481 + (process.pid % 120);
const userDataDir = join(tmpdir(), `fx-chrome-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync",
  ...(USE_EDGE ? [] : ["--disable-features=DisableLoadExtensionCommandLineSwitch"]),
  ...(DSF ? [`--force-device-scale-factor=${DSF}`, "--high-dpi-support=1"] : []),
  "--window-size=1400,1800",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const ready = new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };
  return { ws, ready, send, ev };
}

const HELPER = `
window.__canvasGlyphExtent = (pv, x0, x1, yTop, yBot, targetCy) => {
  const canvas = pv.canvas || pv.div.querySelector('canvas');
  if (!canvas) return null;
  const cr = canvas.getBoundingClientRect();
  const sx = canvas.width / cr.width, sy = canvas.height / cr.height;
  const px0 = Math.max(0, Math.floor((x0 - cr.left) * sx)), px1 = Math.min(canvas.width, Math.ceil((x1 - cr.left) * sx));
  const py0 = Math.max(0, Math.floor((yTop - cr.top) * sy)), py1 = Math.min(canvas.height, Math.ceil((yBot - cr.top) * sy));
  if (px1 <= px0 || py1 <= py0) return null;
  const ctx = canvas.getContext('2d'); let img; try { img = ctx.getImageData(px0, py0, px1 - px0, py1 - py0); } catch (e) { return { error: String(e) }; }
  const d = img.data, W = px1 - px0, H = py1 - py0; const darkRow = [];
  for (let r = 0; r < H; r++) { let dark = 0; for (let c = 0; c < W; c++) { const i = (r*W+c)*4; const lum = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; if (d[i+3] > 40 && lum < 140) dark++; } darkRow.push(dark >= 2); }
  const rowToVp = (r) => yTop + (py0 + r - (yTop - cr.top) * sy) / sy;
  const clusters = []; let start = -1, gap = 0;
  for (let r = 0; r <= H; r++) { if (r < H && darkRow[r]) { if (start < 0) start = r; gap = 0; } else { if (start >= 0) { gap++; if (gap > Math.ceil(2*sy) || r === H) { clusters.push([start, r - gap]); start = -1; gap = 0; } } } }
  if (!clusters.length) return null;
  let best = clusters[0], bestD = Infinity;
  for (const [a, b] of clusters) { const cyVp = (rowToVp(a) + rowToVp(b+1)) / 2; const dd = Math.abs(cyVp - targetCy); if (dd < bestD) { bestD = dd; best = [a, b]; } }
  return { top: rowToVp(best[0]), bottom: rowToVp(best[1] + 1) };
};`;

const MEASURE = `(() => {
  const r2 = (n) => Math.round(n*10)/10;
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
  if (!pv?.textLayer?.div) return { error: "no text layer on page ${PAGE}" };
  const div = pv.textLayer.div;
  const glyph = (s) => { const rg=document.createRange(); rg.selectNodeContents(s); const rs=[...rg.getClientRects()].filter(r=>r.width>0&&r.height>0); if(!rs.length) return null; let t=Infinity,b=-Infinity,l=Infinity,r=-Infinity; for(const q of rs){t=Math.min(t,q.top);b=Math.max(b,q.bottom);l=Math.min(l,q.left);r=Math.max(r,q.right);} return {top:t,bottom:b,left:l,right:r}; };
  const done = [...div.querySelectorAll('span[data-fx-done]')].filter(s => /[gjpqy]/.test(s.textContent) && s.textContent.trim().length>3);
  const rows = [];
  for (const s of done.slice(0, 18)) {
    const og = glyph(s); if (!og) continue;
    const cv = window.__canvasGlyphExtent(pv, og.left, og.right, og.top - 10, og.bottom + 12, (og.top + og.bottom)/2);
    if (!cv || cv.error) continue;
    rows.push({ t: s.textContent.trim().slice(0,14), overlayTop: r2(og.top), canvasTop: r2(cv.top), overlayHigherBy: r2(cv.top - og.top), botDiff: r2(cv.bottom - og.bottom), marginTop: getComputedStyle(s).marginTop, fontFamily: getComputedStyle(s).fontFamily.split(',')[0] });
  }
  const avg = (f) => rows.length ? +(rows.reduce((a,x)=>a+(x[f]??0),0)/rows.length).toFixed(2) : null;
  return { page: ${PAGE}, matched: rows.length, avgOverlayHigherBy: avg('overlayHigherBy'), avgBotDiff: avg('botDiff'), worstHigher: rows.reduce((m,x)=>Math.max(m,x.overlayHigherBy),0), sample: rows.slice(0, 10) };
})()`;

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null, swUrl = null, lastList = [];
  for (let i = 0; i < 60 && !extId; i++) {
    lastList = await http("/json/list");
    // Our extension registers a module service worker; match by target type and
    // the chrome-extension origin (the SW url path differs across Chromium
    // builds, so don't depend on "service-worker.mjs"). Skip any component
    // extension that ships only a background_page.
    const sw = lastList.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (sw) { extId = new URL(sw.url).hostname; swUrl = sw.webSocketDebuggerUrl; } else await sleep(300);
  }
  console.log(`Browser: ${version.Browser}\nExtension loaded: ${extId ? "YES (" + extId + ")" : "NO — --load-extension blocked"}\npaper: ${FILTER}  page: ${PAGE}\n`);
  if (!extId) { console.log("targets seen:", JSON.stringify(lastList.map((t) => ({ type: t.type, url: t.url })), null, 1)); throw new Error("extension did not load in Chrome"); }

  // Service-worker errors (DNR duplicate-id) + DNR rule ids.
  const swErrors = [];
  const sw = cdp(swUrl); await sw.ready;
  sw.ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") swErrors.push("EXC: " + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text)); if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") swErrors.push("ERR: " + m.params.args.map((a) => a.value || a.description || "").join(" ")); });
  await sw.send("Runtime.enable");
  await sleep(800);
  let dnrIds = [], dnrDupes = [];
  try {
    dnrIds = (await sw.ev(`(typeof chrome !== "undefined" && chrome.declarativeNetRequest) ? chrome.declarativeNetRequest.getSessionRules() : []`)).map((r) => r.id).sort((a, b) => a - b);
    dnrDupes = dnrIds.filter((v, i) => dnrIds.indexOf(v) !== i);
  } catch (e) { dnrIds = ["(SW eval unavailable: " + e.message.slice(0, 50) + ")"]; }

  // Viewer page: open directly at the viewer URL (navigating a blank tab to a
  // chrome-extension:// page leaves the eval in a stale context). Capture CSP
  // violations via the Log domain (Chrome logs them with source URL + line).
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  const page = cdp(tab.webSocketDebuggerUrl); await page.ready;
  const consoleErrs = [];
  const cspLog = [];
  page.ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Log.entryAdded") {
      const en = m.params.entry;
      if (/Content Security Policy|inline style|style-src/i.test(en.text)) cspLog.push({ text: en.text.replace(/\s+/g, " ").slice(0, 150), src: (en.url || "").split("/").pop(), line: en.lineNumber });
      else if (en.level === "error") consoleErrs.push(en.text.replace(/\s+/g, " ").slice(0, 180));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrs.push(m.params.args.map((a) => a.value || a.description || "").join(" ").replace(/\s+/g, " ").slice(0, 180));
  });
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  // Secondary capture: in-page securitypolicyviolation (catches ongoing
  // violations during typography processing, with sample + source).
  await page.ev(`window.__csp = window.__csp || []; document.addEventListener('securitypolicyviolation', (e) => { window.__csp.push({ directive: e.violatedDirective, sample: (e.sample||'').slice(0,60), src: (e.sourceFile||'').split('/').pop(), line: e.lineNumber, blocked: e.blockedURI }); });`).catch(() => {});
  for (let i = 0; i < 40; i++) { const ok = await page.ev(`!!(window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer)`).catch(() => false); if (ok) break; await sleep(500); }
  let storageOk = false;
  for (let i = 0; i < 25; i++) { storageOk = await page.ev(`!!(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync)`).catch(() => false); if (storageOk) break; await sleep(400); }
  if (storageOk) await page.ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  else console.log("WARN: chrome.storage unavailable in page context");
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await page.ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 80) break; }
  await page.ev(`window.PDFViewerApplication.page = ${PAGE}`); await sleep(2500);
  await page.ev(HELPER);
  const measure = await page.ev(MEASURE);

  // CSP violations: merge Log-domain entries with in-page securitypolicyviolation.
  const cspRaw = await page.ev(`window.__csp || []`);
  const cspMap = new Map();
  for (const v of cspRaw) { const k = `${v.directive}|${v.src}:${v.line}|${v.sample}`; cspMap.set(k, (cspMap.get(k) || 0) + 1); }
  for (const v of cspLog) { const k = `log|${v.src}:${v.line}|${v.text}`; cspMap.set(k, (cspMap.get(k) || 0) + 1); }
  const csp = [...cspMap.entries()].map(([k, n]) => ({ k, n }));

  const fxb = await page.ev(`document.querySelectorAll('.textLayer .fx-b').length`);
  console.log("fx-b spans:", fxb, "(typography ran:", fxb > 50, ")");
  console.log("\nDNR rule ids:", JSON.stringify(dnrIds), "duplicates:", JSON.stringify(dnrDupes));
  console.log("SW errors:", swErrors.length); for (const e of swErrors.slice(0, 6)) console.log("  " + e);
  console.log("\nCSP violations (collapsed):", csp.length);
  for (const c of csp.slice(0, 20)) console.log(`  x${c.n}  ${c.k}`);
  console.log("\nPage console errors:", consoleErrs.length); for (const e of [...new Set(consoleErrs)].slice(0, 8)) console.log("  " + e);
  console.log("\nBaseline alignment p" + PAGE + ":", JSON.stringify(measure, null, 2));

  writeFileSync(join(root, "test", "out", `chrome-${FILTER.replace(/\W+/g, "")}-p${PAGE}.json`), JSON.stringify({ version: version.Browser, extId, dnrIds, dnrDupes, swErrors, csp, consoleErrs: [...new Set(consoleErrs)], measure }, null, 2));
  try { sw.ws.close(); page.ws.close(); } catch {}
} catch (e) { console.error("chrome diag error:", e); }
finally { browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
