// Masked-divider detector. The canvas backing store still holds the ORIGINAL
// page render (masks are DOM, never drawn into the canvas), so per page:
//   1. getImageData over the full canvas → find long, thin dark runs
//      (horizontal + vertical rules: table lines, footnote separators, column
//      dividers, box frames);
//   2. CDP-screenshot the composited page (masks + overlay applied) and decode
//      it in-page (data URL → Image → canvas) — a rule whose pixels are now
//      mostly WHITE was masked by the text mask.
// Reports per page: rules found / rules masked (with y/x position + white%).
// Usage: node test/diag-dividers.mjs <paper> [--headful] [--pages=1-99]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILTER = POS[0] ?? "Two-column B";
const HEADFUL = process.argv.includes("--headful");
const RANGE = (process.argv.slice(2).find((a) => a.startsWith("--pages="))?.slice(8) ?? "").split("-").map((n) => parseInt(n, 10));
const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "Two-column C": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "Two-column D": "https://yilud.me/Proteus-ccs24.pdf",
  "Two-column E": "https://yilud.me/SIB-Auth.pdf",
  "Two-column F": "https://yilud.me/a33-dong%20stamped.pdf",
  "arXiv": "https://arxiv.org/pdf/1706.03762",
  "5GCVerif": "https://yilud.me/5GCVerif-ccs23.pdf",
  "5GShield": "https://yilud.me/5GShield.pdf",
  "AFC-Diss": "https://yilud.me/afc_testing_DISS.pdf",
  "ACL": "https://yilud.me/2026.acl-long.2136.pdf",
  "UC-Scheme": "https://yilud.me/UC_Scheme.pdf",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9771 + (process.pid % 100);
const userDataDir = join(tmpdir(), `fx-div-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, ...(HEADFUL ? [] : ["--headless=new"]), "--no-first-run",
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 300)); return r.result.value; };

// In-page: find long thin dark runs on the page canvas (the pristine render).
const FIND_RULES = (p) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
  const canvas = pv.canvas || pv.div.querySelector("canvas");
  if (!canvas) return { error: "no canvas" };
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  let img; try { img = ctx.getImageData(0, 0, W, H); } catch (e) { return { error: String(e) }; }
  const d = img.data;
  const dark = (i) => d[i + 3] > 40 && (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) < 140;
  const rules = [];
  // Horizontal: rows whose longest dark run is wide (>=15% of W or >=180px).
  const minH = Math.max(180, W * 0.15);
  for (let y = 0; y < H; y++) {
    let run = 0, best = 0, bx0 = 0, bx1 = 0, cur0 = 0;
    for (let x = 0; x <= W; x++) {
      if (x < W && dark((y * W + x) * 4)) { if (!run) cur0 = x; run++; }
      else { if (run > best) { best = run; bx0 = cur0; bx1 = x; } run = 0; }
    }
    if (best >= minH) rules.push({ dir: "h", y, x0: bx0, x1: bx1, len: best });
  }
  // Vertical: columns with tall dark runs (>=12% of H or >=150px).
  const minV = Math.max(150, H * 0.12);
  for (let x = 0; x < W; x += 1) {
    let run = 0, best = 0, by0 = 0, by1 = 0, cur0 = 0;
    for (let y = 0; y <= H; y++) {
      if (y < H && dark((y * W + x) * 4)) { if (!run) cur0 = y; run++; }
      else { if (run > best) { best = run; by0 = cur0; by1 = y; } run = 0; }
    }
    if (best >= minV) rules.push({ dir: "v", x, y0: by0, y1: by1, len: best });
  }
  // Merge adjacent rows/cols of the same rule into bands; keep band centers.
  const bands = [];
  for (const r of rules) {
    const prev = bands.at(-1);
    if (prev && prev.dir === r.dir && r.dir === "h" && Math.abs(r.y - prev.yEnd) <= 2 && Math.abs(r.x0 - prev.x0) < 30) { prev.yEnd = r.y; continue; }
    if (prev && prev.dir === r.dir && r.dir === "v" && Math.abs(r.x - prev.xEnd) <= 2 && Math.abs(r.y0 - prev.y0) < 30) { prev.xEnd = r.x; continue; }
    if (r.dir === "h") bands.push({ dir: "h", y: r.y, yEnd: r.y, x0: r.x0, x1: r.x1, len: r.len });
    else bands.push({ dir: "v", x: r.x, xEnd: r.x, y0: r.y0, y1: r.y1, len: r.len });
  }
  const cr = canvas.getBoundingClientRect();
  return { W, H, cssW: cr.width, cssH: cr.height, left: cr.left, top: cr.top, bands: bands.slice(0, 40) };
})()`;

// In-page: decode the composite screenshot and measure whiteness of each band.
const CHECK_BANDS = `async (payload) => {
  const { dataUrl, bands, meta, clip } = payload;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const fx = img.width / clip.width;   // composite px per CSS px
  const fy = img.height / clip.height;
  const sx = meta.cssW / meta.W;       // CSS px per canvas backing px
  const sy = meta.cssH / meta.H;
  const out = [];
  for (const b of bands) {
    let pts = [];
    if (b.dir === "h") {
      const cssY = meta.top + ((b.y + b.yEnd) / 2) * sy - clip.y;
      const y = Math.round(cssY * fy);
      for (let bx = b.x0; bx < b.x1; bx += 2) {
        const cssX = meta.left + bx * sx - clip.x;
        pts.push([Math.round(cssX * fx), y]);
      }
    } else {
      const cssX = meta.left + ((b.x + b.xEnd) / 2) * sx - clip.x;
      const x = Math.round(cssX * fx);
      for (let by = b.y0; by < b.y1; by += 2) {
        const cssY = meta.top + by * sy - clip.y;
        pts.push([x, Math.round(cssY * fy)]);
      }
    }
    // Sample a 3-px window PERPENDICULAR to the rule and score its darkest
    // pixel: rounding may land the point one composite px off a thin rule,
    // and a rule antialiased across two rows never reaches full black.
    let white = 0, dark = 0, n = 0;
    for (const [x, y] of pts) {
      if (x < 1 || y < 1 || x >= c.width - 1 || y >= c.height - 1) continue;
      let lum = 255;
      for (let o = -1; o <= 1; o++) {
        const p = b.dir === "h" ? ctx.getImageData(x, y + o, 1, 1).data : ctx.getImageData(x + o, y, 1, 1).data;
        lum = Math.min(lum, 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]);
      }
      n++;
      if (lum > 215) white++; else if (lum < 165) dark++;
    }
    out.push({ dir: b.dir, pos: b.dir === "h" ? Math.round((b.y + b.yEnd) / 2) : Math.round((b.x + b.xEnd) / 2), len: b.len, n, whiteFrac: n ? +(white / n).toFixed(2) : null, darkFrac: n ? +(dark / n).toFixed(2) : null });
  }
  return out;
}`;

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  console.log(`Browser: ${version.Browser}  paper: ${FILTER}  headful: ${HEADFUL}`);
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable"); await sleep(2500);
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`).catch(() => {});
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 60) break; }
  await ev(`window.PDFViewerApplication.pdfViewer.currentScaleValue = "page-fit"`).catch(() => {});
  await sleep(1200);
  const pages = await ev(`window.PDFViewerApplication.pagesCount`);
  const from = RANGE[0] || 1, to = Math.min(RANGE[1] || pages, pages);
  let totalRules = 0, totalMasked = 0;
  for (let p = from; p <= to; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`);
    for (let i = 0; i < 20; i++) { await sleep(300); const ok = await ev(`(()=>{const d=window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;return !!(d&&d.childElementCount)})()`).catch(() => false); if (ok) break; }
    await sleep(1400);
    const meta = await ev(FIND_RULES(p));
    if (meta.error || !meta.bands?.length) { if (meta.error) console.log(`p${p}: ${meta.error}`); continue; }
    const clip = await ev(`(()=>{const r=window.PDFViewerApplication.pdfViewer.getPageView(${p - 1}).div.getBoundingClientRect();return {x:Math.max(0,r.left),y:Math.max(0,r.top),width:Math.min(r.width,innerWidth),height:Math.min(r.height,innerHeight)};})()`);
    // Capture at the canvas's own backing scale (the F20 override renders at
    // a minimum of 2×): at scale 1 a 2-backing-px rule downscales to one
    // antialiased ~lum-150 CSS pixel that neither "dark" nor sampling catches.
    const shotScale = Math.min(3, Math.max(1, meta.W / meta.cssW));
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: shotScale } });
    const res = await (async () => {
      const r = await send("Runtime.evaluate", {
        expression: `(${CHECK_BANDS})(${JSON.stringify({ dataUrl: "data:image/png;base64," + shot.data, bands: meta.bands, meta: { W: meta.W, H: meta.H, cssW: meta.cssW, cssH: meta.cssH, left: meta.left, top: meta.top }, clip })})`,
        returnByValue: true, awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 200));
      return r.result.value;
    })();
    const masked = res.filter((b) => b.whiteFrac != null && b.whiteFrac > 0.35);
    totalRules += res.length; totalMasked += masked.length;
    const tag = masked.length ? "  <<< MASKED" : "";
    console.log(`p${p}: rules=${res.length} masked=${masked.length}${tag}`);
    for (const m of masked) console.log(`   ${m.dir === "h" ? "horiz y" : "vert x"}=${m.pos} len=${m.len} white=${Math.round(m.whiteFrac * 100)}% dark=${Math.round(m.darkFrac * 100)}%`);
  }
  console.log(`\nTOTAL: rules=${totalRules} masked=${totalMasked}`);
} catch (e) { console.error("divider diag error:", e.message); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
