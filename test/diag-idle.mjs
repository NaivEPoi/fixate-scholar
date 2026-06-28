// Reproduce the "after ~30s idle the overlay drifts" bug. PDF.js runs an idle
// cleanup (CLEANUP_TIMEOUT=30000) → _cleanup → pdfDocument.cleanup(), which can
// drop the embedded fonts our overlay spans are styled with. Load, enable fx,
// sit idle 33s, and diff overlay geometry + font presence + events.
// Usage: node test/diag-idle.mjs [template] [page] [--headful]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--") && !a.toLowerCase().endsWith(".exe"));
const FILTER = POS.find((a) => !/^\d+$/.test(a)) ?? "Two-column B";
const PAGE = parseInt(POS.find((a) => /^\d+$/.test(a)) ?? "3", 10);
const HEADFUL = process.argv.includes("--headful");
const PAPERS = { "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf", "arXiv": "https://arxiv.org/pdf/1706.03762" };
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9631 + (process.pid % 120);
const userDataDir = join(tmpdir(), `fx-idle-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, ...(HEADFUL ? [] : ["--headless=new"]), "--no-first-run",
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };

const SNAP = `(() => {
  const r2 = (n) => Math.round(n * 10) / 10;
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
  const div = pv.textLayer.div;
  const sp = [...div.querySelectorAll("span[data-fx-done]")].slice(0, 8);
  const fams = new Set();
  for (const s of div.querySelectorAll("span[data-fx-done]")) fams.add((s.style.fontFamily || "").split(",")[0].replace(/["']/g, "").trim());
  const fontLoaded = {};
  for (const f of fams) { if (f) try { fontLoaded[f] = document.fonts.check("10px " + JSON.stringify(f).slice(1, -1)); } catch { fontLoaded[f] = "err"; } }
  // mask alignment: for each sample span, does a mask still cover it?
  const masks = [...pv.div.querySelectorAll(".fx-mask > div")].map((m) => m.getBoundingClientRect());
  const ov = (a, b) => { const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return w > 0 && h > 0 ? w * h : 0; };
  const rows = sp.map((s) => { const r = s.getBoundingClientRect(); let best = 0; for (const m of masks) best = Math.max(best, ov(r, m) / Math.max(1, r.width * r.height)); return { t: s.textContent.trim().slice(0, 12), left: r2(r.left), top: r2(r.top), w: r2(r.width), maskCov: +best.toFixed(2), fam: (s.style.fontFamily || "").split(",")[0] }; });
  return { fontsSize: document.fonts.size, fontLoaded, masks: masks.length, rows };
})()`;

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  console.log(`Browser: ${version.Browser}  paper: ${FILTER}  page: ${PAGE}  headful: ${HEADFUL}\n`);
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable"); await sleep(2500);
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`).catch(() => {});
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 80) break; }
  await ev(`window.PDFViewerApplication.page = ${PAGE}`); await sleep(2800);
  // instrument events
  await ev(`globalThis.__ev = []; const bus = window.PDFViewerApplication.eventBus;
    document.fonts.addEventListener('loadingdone', () => globalThis.__ev.push('loadingdone@' + Math.round(performance.now())));
    document.fonts.addEventListener('loading', () => globalThis.__ev.push('loading@' + Math.round(performance.now())));
    bus.on('textlayerrendered', (e) => globalThis.__ev.push('textlayerrendered:p' + e.pageNumber + '@' + Math.round(performance.now())));
    bus.on('pagerendered', (e) => globalThis.__ev.push('pagerendered:p' + e.pageNumber + '@' + Math.round(performance.now())));
    true`);
  const before = await ev(SNAP);
  console.log("BEFORE idle:", JSON.stringify(before, null, 1));
  console.log("\n...sitting idle 33s (no interaction)...\n");
  await sleep(33000);
  const after = await ev(SNAP);
  const events = await ev(`globalThis.__ev`);
  console.log("AFTER 33s idle:", JSON.stringify(after, null, 1));
  console.log("\nevents during idle:", JSON.stringify(events));
  // quick diff
  const drift = before.rows.map((b, i) => { const a = after.rows[i] || {}; return { t: b.t, dLeft: +((a.left ?? 0) - b.left).toFixed(1), dW: +((a.w ?? 0) - b.w).toFixed(1), maskCovBefore: b.maskCov, maskCovAfter: a.maskCov, famBefore: b.fam, famAfter: a.fam }; });
  console.log("\nDIFF (per span):", JSON.stringify(drift, null, 1));
} catch (e) { console.error("idle diag error:", e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
