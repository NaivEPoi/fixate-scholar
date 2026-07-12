// Processed-text-in-tables detector. Tables (and framed algorithm/figure
// boxes) are bounded by horizontal rules drawn on the CANVAS; the text between
// two stacked, x-overlapping rules is table interior and must stay on the
// canvas — a span[data-fx-done] whose center lies in such a zone was processed
// inside a table (the masks then also threaten the rules). Engine-independent
// oracle:
//   1. scan the pristine canvas backing for long horizontal dark runs → rules;
//   2. pair vertically adjacent rules whose x-ranges overlap ≥70% of the
//      longer one and whose gap is ≤15% of the page height → interior zones;
//   3. report every processed span centered inside a zone.
// Some prose CAN legally sit between two nearby unrelated rules (stacked
// tables with a paragraph between) — treat new flags as leads and confirm
// with a capture before "fixing" the engine (TESTING.md §6).
// Usage: node test/tables.mjs <paper> [--pages=A-B]  (exit 1 on offenders)

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
const PORT = 9251 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-tab-${process.pid}`);
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

// In-page: rules from the canvas backing, zones from rule pairs, offenders
// from processed-span centers inside zones (all in CSS px via the canvas rect).
const CHECK = (p) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
  const canvas = pv.canvas || pv.div.querySelector("canvas");
  const layer = pv.textLayer && pv.textLayer.div;
  if (!canvas || !layer) return { error: "no canvas/layer" };
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  let img; try { img = ctx.getImageData(0, 0, W, H); } catch (e) { return { error: String(e) }; }
  const d = img.data;
  const dark = (i) => d[i + 3] > 40 && (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) < 165;
  const minLen = Math.max(180, W * 0.15);
  const rows = [];
  for (let y = 0; y < H; y++) {
    let run = 0, best = 0, bx0 = 0, cur0 = 0, bx1 = 0;
    for (let x = 0; x <= W; x++) {
      if (x < W && dark((y * W + x) * 4)) { if (!run) cur0 = x; run++; }
      else { if (run > best) { best = run; bx0 = cur0; bx1 = x; } run = 0; }
    }
    if (best >= minLen) rows.push({ y, x0: bx0, x1: bx1 });
  }
  // merge adjacent rows into rules
  const rules = [];
  for (const r of rows) {
    const prev = rules.at(-1);
    if (prev && r.y - prev.yEnd <= 2 && Math.abs(r.x0 - prev.x0) < 40) { prev.yEnd = r.y; prev.x0 = Math.min(prev.x0, r.x0); prev.x1 = Math.max(prev.x1, r.x1); continue; }
    rules.push({ y0: r.y, yEnd: r.y, x0: r.x0, x1: r.x1 });
  }
  // Chain vertically adjacent overlapping rules; a real table shows ≥3 rules
  // (top/mid/bottom or row separators). An isolated PAIR is usually two
  // underlined run-in leads in a column of prose — no zone for those.
  const pairs = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i], b = rules[j];
      if (b.y0 - a.yEnd <= 2) continue; // same merged band
      if (b.y0 - a.yEnd > H * 0.15) break; // too far — rules sorted by y
      const lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1);
      const longer = Math.max(a.x1 - a.x0, b.x1 - b.x0);
      if (hi - lo < longer * 0.7) continue;
      pairs.push({ i, j, x0: lo, x1: hi, yTop: a.yEnd, yBot: b.y0 });
      break; // pair each rule with the NEAREST qualifying rule below
    }
  }
  // chain membership per rule index
  const chain = new Map(); // rule idx -> chain id
  let cid = 0;
  for (const p of pairs) {
    const c = chain.get(p.i) ?? ++cid;
    chain.set(p.i, c);
    chain.set(p.j, c);
  }
  const chainSize = new Map();
  for (const c of chain.values()) chainSize.set(c, (chainSize.get(c) || 0) + 1);
  const zones = pairs.filter((p) => (chainSize.get(chain.get(p.i)) || 0) >= 3);
  if (!zones.length) return { zones: 0, offenders: [] };
  const cr = canvas.getBoundingClientRect();
  const sx = W / cr.width, sy = H / cr.height;
  // Group ALL text-layer spans into baseline lines (for the prose exemption).
  const lineMap = new Map();
  for (const s of layer.querySelectorAll("span")) {
    if (!s.textContent.trim() || s.querySelector("span")) continue;
    const r = s.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const key = Math.round((r.top - cr.top) / 5);
    if (!lineMap.has(key)) lineMap.set(key, []);
    lineMap.get(key).push(s);
  }
  // Prose lines (≥4 lowercase words spanning ≥55% of some zone's width) and
  // their PARAGRAPH CONTINUATIONS: a short last line ("as shown in Figure
  // 8b.") directly under a prose line is the same paragraph, not a cell.
  const proseKeys = new Set();
  const keys = [...lineMap.keys()].sort((a, b) => a - b);
  for (const key of keys) {
    const line = lineMap.get(key);
    const text = line.map((el) => el.textContent).join(" ");
    const lw = (text.match(/[a-zà-ÿ]{2,}/g) || []).length;
    const xs = line.map((el) => el.getBoundingClientRect());
    const w = (Math.max(...xs.map((q) => q.right)) - Math.min(...xs.map((q) => q.left))) * sx;
    const wideProse = lw >= 4 && zones.some((z) => w >= (z.x1 - z.x0) * 0.55);
    const contPrev = lw >= 2 && (proseKeys.has(key - 3) || proseKeys.has(key - 4) || proseKeys.has(key - 5));
    if (wideProse || contPrev) proseKeys.add(key);
  }
  const offenders = [];
  for (const s of layer.querySelectorAll("span[data-fx-done]")) {
    const r = s.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cx = ((r.left + r.right) / 2 - cr.left) * sx;
    const cy = ((r.top + r.bottom) / 2 - cr.top) * sy;
    for (const z of zones) {
      if (!(cx >= z.x0 && cx <= z.x1 && cy > z.yTop + 1 && cy < z.yBot - 1)) continue;
      // Prose exemption: a rule chain can bracket a PROSE gap (text between
      // two stacked framed listings/tables). Exemption is per-SPAN within
      // the prose line (mirrors the engine): a short label sharing a
      // baseline with a wordy cell is still an offender if processed.
      if (proseKeys.has(Math.round((r.top - cr.top) / 5))) {
        const t = s.textContent.trim();
        const slw = (t.match(/[a-zà-ÿ]{2,}/g) || []).length;
        if (slw >= 2 || t.length >= 12) break; // part of the prose flow
      }
      offenders.push({ t: s.textContent.trim().slice(0, 44), zone: [Math.round(z.yTop / sy), Math.round(z.yBot / sy)] });
      break;
    }
  }
  return { zones: zones.length, offenders: offenders.slice(0, 20) };
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
    for (let i = 0; i < 20; i++) { await sleep(300); const ok = await ev(`(()=>{const d=window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;return !!(d&&d.querySelector('[data-fx-done]'))})()`).catch(() => false); if (ok) break; }
    await sleep(1400);
    const res = await ev(CHECK(p)).catch((e) => ({ error: String(e).slice(0, 120) }));
    if (res.error) { console.log(`p${p}: ${res.error}`); continue; }
    total += res.offenders.length;
    const tag = res.offenders.length ? "  <<< PROCESSED IN TABLE" : "";
    console.log(`p${p}: zones=${res.zones} offenders=${res.offenders.length}${tag}`);
    for (const o of res.offenders) console.log(`   y${o.zone[0]}-${o.zone[1]}: "${o.t}"`);
  }
  console.log(`\nTOTAL offenders: ${total}`);
  if (total > 0) process.exitCode = 1;
} catch (e) { console.error("tables test error:", e.message || e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
