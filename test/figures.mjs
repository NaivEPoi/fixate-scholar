// Processed-text-in-FIGURES detector. Figures carry no reliable canvas rules
// (plots, FSM/protocol/architecture diagrams), but in every corpus template
// the caption sits BELOW its figure: the region between a "Figure N:" caption
// line and the nearest full-width running-prose line above it is figure
// interior — axis labels, node names, message text — and must stay on the
// canvas. Flags every span[data-fx-done] centered in such a region.
// Caveats: a figure-internal text box spanning ≥80% of the column reads as
// the prose bound (region truncates — sensitivity loss, never a false flag);
// in-text "Figure N shows…" references don't anchor (caption needs ':' or '.'
// right after the number). Treat new flags as leads; confirm with a capture.
// Usage: node test/figures.mjs <paper> [--pages=A-B]  (exit 1 on offenders)

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILTER = POS[0] ?? "5GShield";
const RANGE = (process.argv.slice(2).find((a) => a.startsWith("--pages="))?.slice(8) ?? "").split("-").map((n) => parseInt(n, 10));
const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "Two-column C": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "Two-column D": "https://yilud.me/Proteus-ccs24.pdf",
  "Two-column E": "https://yilud.me/SIB-Auth.pdf",
  "Two-column F": "https://yilud.me/a33-dong%20stamped.pdf",
  "arXiv": "https://arxiv.org/pdf/2502.04915",
  "5GCVerif": "https://yilud.me/5GCVerif-ccs23.pdf",
  "5GShield": "https://yilud.me/5GShield.pdf",
  "AFC-Diss": "https://yilud.me/afc_testing_DISS.pdf",
  "ACL": "https://yilud.me/2026.acl-long.2136.pdf",
  "UC-Scheme": "https://yilud.me/UC_Scheme.pdf",
};
const EXT = "C:\\misc\\Claude_Workspace\\fixate-scholar\\extension";
const PORT = 9161 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-fig-${process.pid}`);
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 300)); return r.result.value; };

const CHECK = (p) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
  const layer = pv.textLayer && pv.textLayer.div;
  if (!layer) return { error: "no layer" };
  const pr = pv.div.getBoundingClientRect();
  const mid = pr.left + pr.width / 2;
  // Group leaf spans into baseline lines PER COLUMN (a line group mixing the
  // caption with the OTHER column's prose on the same baseline would fake a
  // full-width caption), keyed by vertical CENTER (kept mono/math spans have
  // different tops than their line and would split the group).
  const lineMap = new Map();
  for (const s of layer.querySelectorAll("span")) {
    if (!s.textContent.trim() || s.querySelector("span")) continue;
    const r = s.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const col = r.left < mid - 20 && r.right > mid + 20 ? "f" : (r.left + r.right) / 2 < mid ? "l" : "r";
    const key = col + ":" + Math.round(((r.top + r.bottom) / 2 - pr.top) / 6);
    if (!lineMap.has(key)) lineMap.set(key, []);
    lineMap.get(key).push({ s, r });
  }
  const colBounds = (col) => (col === "f" ? [pr.left, pr.right] : col === "l" ? [pr.left, mid] : [mid, pr.right]);
  const lines = [...lineMap.entries()].map(([key, spans]) => {
    const col = key[0];
    const x0 = Math.min(...spans.map((g) => g.r.left));
    const x1 = Math.max(...spans.map((g) => g.r.right));
    const top = Math.min(...spans.map((g) => g.r.top));
    const bottom = Math.max(...spans.map((g) => g.r.bottom));
    const text = spans.map((g) => g.s.textContent).join(" ").trim();
    const lw = (text.match(/[a-zà-ÿ]{2,}/g) || []).length;
    const [c0, c1] = colBounds(col);
    const isProse = lw >= 4 && x1 - x0 >= (c1 - c0) * 0.72;
    return { col, x0, x1, top, bottom, text, lw, isProse };
  }).sort((a, b) => a.top - b.top);
  // caption anchors: "Figure N:" / "Fig. N." lines (not in-text references)
  const CAP = /^(?:Fig(?:ure)?|FIGURE)\\.?\\s*\\d+[a-z]?\\s*[:.]/;
  const regions = [];
  for (const ln of lines) {
    if (!CAP.test(ln.text)) continue;
    const [colX0, colX1] = colBounds(ln.col);
    const overlaps = (c) => c.col === ln.col || c.col === "f" || ln.col === "f";
    // nearest prose line / caption ABOVE the anchor in an overlapping column
    let bound = null;
    for (const cand of lines) {
      if (cand.bottom >= ln.top - 2) continue; // not above
      if (!overlaps(cand)) continue;
      if ((cand.isProse || CAP.test(cand.text)) && (!bound || cand.bottom > bound.bottom)) bound = cand;
    }
    let top = bound ? bound.bottom + 2 : pr.top + pr.height * 0.05;
    if (bound) {
      // absorb the bound paragraph's short tail lines ("…within each
      // window.") — tight leading, still wordy; the figure starts at the
      // first real gap or non-prose line
      let prevBottom = bound.bottom;
      for (const cand of lines) {
        if (cand.top < prevBottom - 2 || cand.bottom >= ln.top - 2) continue;
        if (!overlaps(cand)) continue;
        const h = Math.max(cand.bottom - cand.top, 8);
        if (cand.top - prevBottom > h * 0.9) break; // leading gap — figure begins
        if (cand.lw < 2) break; // not prose flow
        prevBottom = cand.bottom;
        top = cand.bottom + 2;
      }
    }
    if (ln.top - top < 20) continue; // no room — caption directly under prose
    regions.push({ x0: colX0 + 2, x1: colX1 - 2, yTop: top, yBot: ln.top - 2, cap: ln.text.slice(0, 30) });
  }
  if (!regions.length) return { figures: 0, offenders: [] };
  const offenders = [];
  for (const s of layer.querySelectorAll("span[data-fx-done]")) {
    const r = s.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    for (const g of regions) {
      if (cx >= g.x0 && cx <= g.x1 && cy > g.yTop && cy < g.yBot) {
        offenders.push({ t: s.textContent.trim().slice(0, 44), cap: g.cap, y: Math.round(r.top - pr.top) });
        break;
      }
    }
  }
  return { figures: regions.length, offenders: offenders.slice(0, 20) };
})()`;

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable"); await sleep(2500);
  let appOk = false;
  for (let i = 0; i < 30; i++) { appOk = await ev(`!!(window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer)`).catch(() => false); if (appOk) break; await sleep(500); }
  if (!appOk) throw new Error("viewer never loaded");
  console.log(`Browser: ${version.Browser}  paper: ${FILTER}`);
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`).catch(() => {});
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 60) break; }
  await ev(`window.PDFViewerApplication.pdfViewer.currentScaleValue = "page-fit"`).catch(() => {});
  await sleep(1200);
  const pages = await ev(`window.PDFViewerApplication.pagesCount`);
  const from = RANGE[0] || 1, to = Math.min(RANGE[1] || pages, pages);
  let total = 0;
  for (let p = from; p <= to; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`);
    // stable done-count (probing mid-reprocess reads as unprocessed)
    let prev = -1;
    for (let i = 0; i < 30; i++) {
      await sleep(600);
      const n = await ev(`(()=>{const d=window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;return d?d.querySelectorAll('[data-fx-done]').length:0})()`).catch(() => 0);
      if (n > 0 && n === prev) break;
      prev = n;
    }
    await sleep(600);
    const res = await ev(CHECK(p)).catch((e) => ({ error: String(e).slice(0, 120) }));
    if (res.error) { console.log(`p${p}: ${res.error}`); continue; }
    total += res.offenders.length;
    const tag = res.offenders.length ? "  <<< PROCESSED IN FIGURE" : "";
    console.log(`p${p}: figures=${res.figures} offenders=${res.offenders.length}${tag}`);
    for (const o of res.offenders) console.log(`   [${o.cap}] y${o.y}: "${o.t}"`);
  }
  console.log(`\nTOTAL offenders: ${total}`);
  if (total > 0) process.exitCode = 1;
} catch (e) { console.error("figures test error:", e.message || e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
