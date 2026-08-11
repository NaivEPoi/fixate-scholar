// Capture a page region twice — fx ON (composited, masks applied) and the
// pristine CANVAS content for the same region (drawn to an offscreen canvas,
// exported as PNG) — for side-by-side inspection of masked artwork.
// Usage: node test/shot-region2.mjs <paper> <page> <canvasY0> <canvasY1> [--headful]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { browserPath } from "./lib/env.mjs";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILTER = POS[0] ?? "USENIX (code + algorithms)";
const PAGE = parseInt(POS[1] ?? "11", 10);
const Y0 = parseInt(POS[2] ?? "0", 10);
const Y1 = parseInt(POS[3] ?? "300", 10);
const ZOOM = parseFloat(process.argv.slice(2).find((a) => a.startsWith("--zoom="))?.slice(7) ?? "0");
const FIND = process.argv.slice(2).find((a) => a.startsWith("--find="))?.slice(7); // capture band around this text instead of Y0/Y1
// Extra backing px above and below the --find band. The bare band is one line,
// which is right for judging a single word and too little for a paragraph: the
// defects the release gate looks for (baseline drift, jammed spacing, one span in
// the wrong face, a whited-out word) are only visible against their neighbours.
const PAD = parseInt(process.argv.slice(2).find((a) => a.startsWith("--pad="))?.slice(6) ?? "0", 10);
const PAPERS = {
  "USENIX (code + algorithms)": "https://yilud.me/usenixsecurity24-tu.pdf",
  "ACL": "https://yilud.me/2026.acl-long.2136.pdf",
  "AFC-Diss": "https://yilud.me/afc_testing_DISS.pdf",
  "5GCVerif": "https://yilud.me/5GCVerif-ccs23.pdf",
  "5GShield": "https://yilud.me/5GShield.pdf",
  "UC-Scheme": "https://yilud.me/UC_Scheme.pdf",
  "USENIX (baseline)": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "USENIX (no cover page)": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "ACM acmart (full)": "https://yilud.me/Proteus-ccs24.pdf",
  "ACM acmart (short)": "https://yilud.me/SIB-Auth.pdf",
  "IEEE conference (stamped)": "https://yilud.me/a33-dong%20stamped.pdf",
  "IEEE journal": "https://arxiv.org/pdf/2502.04915",
  "NeurIPS": "https://arxiv.org/pdf/1706.03762",
  "LaTeX article (CM)": "https://arxiv.org/pdf/quant-ph/9508027",
};
// --url= runs any PDF the viewer can fetch (the private corpus is served on
// localhost under neutral aliases); --label= names the output file.
const URL_OVERRIDE = process.argv.slice(2).find((a) => a.startsWith("--url="))?.slice(6);
const LABEL = process.argv.slice(2).find((a) => a.startsWith("--label="))?.slice(8);
const TARGET = URL_OVERRIDE ?? PAPERS[FILTER];
// An unknown template used to sail on and open the viewer with file=undefined.
// Nothing loaded, and the failure surfaced much later as "cannot read properties
// of undefined (reading 'canvas')" - which reads as a page-rendering problem, not
// a missing map entry. Half this map was absent after the corpus was renamed, and
// three wrong diagnoses came out of that before the map was checked.
if (!TARGET) {
  console.error(`shot-region2: unknown template ${JSON.stringify(FILTER)}`);
  console.error(`  templates: ${Object.keys(PAPERS).join(", ")}`);
  console.error(`  or: --url=<pdf url> [--label=name]`);
  process.exit(2);
}
const OUTNAME = (LABEL ?? FILTER).replace(/\W+/g, "_");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9791 + (process.pid % 100);
const userDataDir = join(tmpdir(), `fx-sr2-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1300,1900",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 0;
// Every CDP call is bounded. Without this a wedged target (a page that never
// finishes rendering, a screenshot that never returns) hangs forever with no
// output, and a corpus loop driving this harness simply stops — which reads as
// "still running" rather than "this document failed".
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => reject(new Error(`${method}: timed out after 60s`)), 60000);
  const h = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== id) return;
    clearTimeout(timer);
    ws.removeEventListener("message", h);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result.value; };

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(TARGET)}`, "PUT");
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
      const hit = div && [...div.querySelectorAll("span")].find((s) => !s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c)") && s.textContent.includes(${JSON.stringify(FIND)}));
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
      const hit = [...div.querySelectorAll("span")].find((s) => !s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c)") && s.textContent.includes(find));
      if (!hit) return { error: "text not found post-scroll" };
      const r = hit.getBoundingClientRect();
      const pad = ${PAD};
      return {
        y0: Math.max(0, Math.round((r.top - cr.top - 12) * syb) - pad),
        y1: Math.min(canvas.height, Math.round((r.bottom - cr.top + 16) * syb) + pad),
        x0: Math.max(0, Math.round((r.left - cr.left - 24) * syb)),
        x1: Math.round((r.right - cr.left + 60) * syb),
      };
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
  writeFileSync(join(root, "test", "out", `region-${OUTNAME}-p${PAGE}-fxon.png`), Buffer.from(shotOn.data, "base64"));
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:false},r))`);
  // WAIT for the restore to be observable, do not just sleep. Restoring is
  // idle-chunked, and at a high zoom on a dense page 2.5s was not enough: the
  // "fx off" shot came back byte-identical to the fx-on one, emphasis included.
  // A matched pair that is two copies of the same state shows no difference no
  // matter what is wrong, so every comparison made with it would have "passed".
  let restored = false;
  for (let i = 0; i < 40; i++) {
    restored = await ev(`(() => document.querySelectorAll("[data-fx-done], .fx-b").length === 0 &&
      !document.querySelector("#viewerContainer.fx-on"))()`).catch(() => false);
    if (restored) break;
    await sleep(500);
  }
  if (!restored) throw new Error("reading mode never restored — the fx-off half would be a duplicate of fx-on, not a control");
  await sleep(1200); // let the canvas repaint settle after the restore
  const shotOff = await send("Page.captureScreenshot", { format: "png", clip });
  writeFileSync(join(root, "test", "out", `region-${OUTNAME}-p${PAGE}-fxoff.png`), Buffer.from(shotOff.data, "base64"));
  console.log(`saved region-${OUTNAME}-p${PAGE}-{fxon,fxoff}.png  (canvas y ${band.y0}-${band.y1} x ${band.x0}-${band.x1}${ZOOM ? " zoom " + ZOOM : ""})`);
} catch (e) {
  // A capture that never happened must not read as success: this runs inside
  // corpus sweeps, where exit 0 with no file is indistinguishable from a clean
  // inspection.
  console.error("shot-region2 error:", e.message);
  process.exitCode = 1;
}
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
