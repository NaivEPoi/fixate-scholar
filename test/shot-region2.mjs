// Capture a page region twice — fx ON (composited, masks applied) and the
// pristine CANVAS content for the same region (drawn to an offscreen canvas,
// exported as PNG) — for side-by-side inspection of masked artwork.
// Usage: node test/shot-region2.mjs <paper> <page> <canvasY0> <canvasY1> [--headful]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILTER = POS[0] ?? "Two-column B";
const PAGE = parseInt(POS[1] ?? "11", 10);
const Y0 = parseInt(POS[2] ?? "0", 10);
const Y1 = parseInt(POS[3] ?? "300", 10);
const ZOOM = parseFloat(process.argv.slice(2).find((a) => a.startsWith("--zoom="))?.slice(7) ?? "0");
const FIND = process.argv.slice(2).find((a) => a.startsWith("--find="))?.slice(7); // capture band around this text instead of Y0/Y1
const PAPERS = {
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "ACL": "https://yilud.me/2026.acl-long.2136.pdf",
  "5GCVerif": "https://yilud.me/5GCVerif-ccs23.pdf",
  "5GShield": "https://yilud.me/5GShield.pdf",
  "UC-Scheme": "https://yilud.me/UC_Scheme.pdf",
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column C": "https://yilud.me/AFC_Attacks_NSDI.pdf",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9791 + (process.pid % 100);
const userDataDir = join(tmpdir(), `fx-sr2-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1300,1900",
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result.value; };

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable"); await sleep(2500);
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`).catch(() => {});
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 60) break; }
  await ev(ZOOM ? `window.PDFViewerApplication.pdfViewer.currentScale = ${ZOOM}` : `window.PDFViewerApplication.pdfViewer.currentScaleValue = "page-fit"`).catch(() => {});
  await sleep(1200);
  await ev(`window.PDFViewerApplication.page = ${PAGE}`); await sleep(3000);

  // Region: either canvas-backing y range, or a band around --find text.
  if (FIND) {
    const found = await ev(`(() => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
      const div = pv.textLayer && pv.textLayer.div;
      const hit = div && [...div.querySelectorAll("span")].find((s) => !s.querySelector("span") && s.textContent.includes(${JSON.stringify(FIND)}));
      if (!hit) return false;
      hit.scrollIntoView({ block: "center" });
      return true;
    })()`);
    if (!found) throw new Error("text not found: " + FIND);
    await sleep(2500); // canvas re-render after scroll settles
  }
  const band = await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const canvas = pv.canvas || pv.div.querySelector("canvas");
    const cr = canvas.getBoundingClientRect();
    const syb = canvas.height / cr.height; // backing per CSS
    const find = ${JSON.stringify(FIND ?? null)};
    if (find) {
      const div = pv.textLayer && pv.textLayer.div;
      const hit = [...div.querySelectorAll("span")].find((s) => !s.querySelector("span") && s.textContent.includes(find));
      if (!hit) return { error: "text not found post-scroll" };
      const r = hit.getBoundingClientRect();
      return { y0: Math.max(0, Math.round((r.top - cr.top - 12) * syb)), y1: Math.round((r.bottom - cr.top + 16) * syb), x0: Math.max(0, Math.round((r.left - cr.left - 24) * syb)), x1: Math.round((r.right - cr.left + 60) * syb) };
    }
    return { y0: ${Y0}, y1: ${Y1}, x0: 0, x1: canvas.width };
  })()`);
  if (band.error) throw new Error(band.error);

  // Same CSS clip captured twice — fx ON, then fx OFF (native rendering) —
  // the exact user-visible compositing in both states, pixel-comparable.
  const clip = await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const canvas = pv.canvas || pv.div.querySelector("canvas");
    const cr = canvas.getBoundingClientRect();
    const s = cr.height / canvas.height; // CSS per backing
    return { x: cr.left + ${band.x0} * s, y: cr.top + ${band.y0} * s, width: (${band.x1} - ${band.x0}) * s, height: (${band.y1} - ${band.y0}) * s, scale: 2 };
  })()`);
  const shotOn = await send("Page.captureScreenshot", { format: "png", clip });
  writeFileSync(join(root, "test", "out", `region-${FILTER.replace(/\W+/g, "")}-p${PAGE}-fxon.png`), Buffer.from(shotOn.data, "base64"));
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:false},r))`);
  await sleep(2500);
  const shotOff = await send("Page.captureScreenshot", { format: "png", clip });
  writeFileSync(join(root, "test", "out", `region-${FILTER.replace(/\W+/g, "")}-p${PAGE}-fxoff.png`), Buffer.from(shotOff.data, "base64"));
  console.log(`saved region-${FILTER.replace(/\W+/g, "")}-p${PAGE}-{fxon,fxoff}.png  (canvas y ${band.y0}-${band.y1} x ${band.x0}-${band.x1}${ZOOM ? " zoom " + ZOOM : ""})`);
} catch (e) { console.error("shot-region2 error:", e.message); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
