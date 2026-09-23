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
//
// ZOOM SWEEP (R47). The engine finds rules by reading the PAINTED canvas, and
// that canvas changes with the viewer zoom — its resolution, its anti-aliasing,
// and above ~1.5x PDF.js's maxCanvasPixels CAP, which drops the base render
// below one device pixel per CSS pixel. So a page is checked at every zoom in
// --zooms, each in a FRESH viewer tab (zoom set before the engine is enabled —
// a standalone run, as R47 measured it), and two things are reported:
//   1. offenders, per zoom, as above. The oracle's rules come from its OWN
//      render of the page at a fixed ORACLE_SCALE, not from the viewer canvas,
//      so the oracle's zones are the same at every zoom and only the engine's
//      decisions move;
//   2. EMPHASIS FLIPS: the same span (text + occurrence index on its page)
//      carrying a different number of .fx-b runs at two zooms. Counted from the
//      .fx-b runs actually present, not from data-fx-done, which can be set on
//      a span that produced no emphasis. A changed processed-span TOTAL is
//      printed for reference but is never a pass/fail on its own.
// Both exit 1. One zoom (e.g. --zooms=page-fit) is the pre-R47 behaviour.
// Usage: node test/tables.mjs <paper> [--pages=A-B] [--zooms=page-fit,1.0,1.8]
//        [--url=<pdf>] [--why] [--noexempt] [--dump=<file>]

import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir, killBrowser } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILTER = POS[0] ?? "5GShield";
const WHY = process.argv.slice(2).includes("--why"); // dump the prose-exemption inputs per offender
const NOEXEMPT = process.argv.slice(2).includes("--noexempt"); // control: disable the prose exemption
const URL_OVERRIDE = process.argv.slice(2).find((a) => a.startsWith("--url="))?.slice(6); // any PDF URL, e.g. a local test server
// --dump=<file>: every zoom's per-span rows as JSON, for comparing two builds
// of the engine span by span (same paper, same zooms).
const DUMP = process.argv.slice(2).find((a) => a.startsWith("--dump="))?.slice(7);
const RANGE = (process.argv.slice(2).find((a) => a.startsWith("--pages="))?.slice(8) ?? "").split("-").map((n) => parseInt(n, 10));
// Default sweep: the page-fit this check always ran at, plus 100% and the 180%
// the fontkeep/whyskip stages use — the two zooms R47 measured apart.
const ZOOMS = (process.argv.slice(2).find((a) => a.startsWith("--zooms="))?.slice(8) ?? "page-fit,1.0,1.8")
  .split(",").map((z) => z.trim()).filter(Boolean);
// The oracle's own render, in device px per PDF point. ~4 is what the
// page-fit canvas at devicePixelRatio 2 used to give it, so the rule-length and
// merge constants below keep the meaning they were validated with.
const ORACLE_SCALE = 4;
const PAPERS = {
  "USENIX (baseline)": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "USENIX (code + algorithms)": "https://yilud.me/usenixsecurity24-tu.pdf",
  "USENIX (no cover page)": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "ACM acmart (full)": "https://yilud.me/Proteus-ccs24.pdf",
  "ACM acmart (short)": "https://yilud.me/SIB-Auth.pdf",
  "IEEE conference (stamped)": "https://yilud.me/a33-dong%20stamped.pdf",
  "IEEE journal": "https://arxiv.org/pdf/2502.04915",
  "NeurIPS": "https://arxiv.org/pdf/1706.03762",
  "LaTeX article (CM)": "https://arxiv.org/pdf/quant-ph/9508027",
  "5GCVerif": "https://yilud.me/5GCVerif-ccs23.pdf",
  "5GShield": "https://yilud.me/5GShield.pdf",
  "AFC-Diss": "https://yilud.me/afc_testing_DISS.pdf",
  "ACL": "https://yilud.me/2026.acl-long.2136.pdf",
  "UC-Scheme": "https://yilud.me/UC_Scheme.pdf",
};
const EXT = extensionDir;
const PORT = 9251 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-tab-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1300,1900",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

// test/lib/cdp.mjs: every call has a deadline and a closed socket rejects what
// is waiting on it, so a viewer that goes away fails the run instead of
// leaving it pending until Node exits 13.
let cdp;
const send = (method, params) => cdp.send(method, params);
const ev = (expr) => cdp.ev(expr);
// A deadline or a closed socket is fatal for the run, not one more poll.
const soft = (d) => (e) => { if (/timed out after|socket closed/.test(e?.message ?? "")) throw e; return d; };

// In-page: rules from the oracle's own render, zones from rule pairs, offenders
// from processed-span centers inside zones (span rects mapped through the
// viewer canvas rect, which covers exactly the page).
//
// The render is the oracle's, at ORACLE_SCALE px/pt whatever the viewer zoom:
// reading the viewer's canvas made the oracle exactly as zoom-dependent as the
// engine it checks (at 1.8 that canvas is capped to ~0.7 device px per CSS px
// and a 0.4pt frame edge reads light), so a zoom sweep would have compared two
// moving things. Line grouping is likewise in page units (LINE_Q zoom-1 px per
// bucket, ~5 CSS px at the page-fit it used to run at).
const CHECK = (p) => `(async () => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
  const canvas = pv.canvas || pv.div.querySelector("canvas");
  const layer = pv.textLayer && pv.textLayer.div;
  if (!canvas || !layer || !pv.pdfPage) return { error: "no canvas/layer" };
  const own = document.createElement("canvas");
  const vp = pv.pdfPage.getViewport({ scale: ${ORACLE_SCALE}, rotation: pv.viewport.rotation });
  own.width = Math.round(vp.width); own.height = Math.round(vp.height);
  const ctx = own.getContext("2d", { willReadFrequently: true });
  try { await pv.pdfPage.render({ canvasContext: ctx, viewport: vp }).promise; } catch (e) { return { error: "oracle render: " + e }; }
  const W = own.width, H = own.height;
  let img; try { img = ctx.getImageData(0, 0, W, H); } catch (e) { return { error: String(e) }; }
  own.width = own.height = 0; // release the buffer; the pixels are copied out
  const d = img.data;
  const LINE_Q = 3; // zoom-1 CSS px per line bucket
  const zs = pv.scale || 1; // viewer zoom: CSS px per zoom-1 CSS px
  const lineKeyOf = (r, top) => Math.round((r.top - top) / zs / LINE_Q);
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
  // The leaf test must ignore OUR OWN inline wrappers: the citation and
  // in-paper-reference coloring inserts <span class="fx-cite-c|fx-ref-c"> inside
  // a processed span, so a plain "has a nested span" test dropped exactly the
  // prose lines that mention a Figure/Table/Listing — the lines most likely to
  // sit beside a ruled block — out of the prose map, and every one of them then
  // reported as an offender (all four false positives were of this shape:
  // "Listing 2 provides…", "…shown in Figure 8a", "as shown in Figure 8b.",
  // "Figure 11 shows…"). Only PDF.js's markedContent wrappers should be skipped.
  const lineMap = new Map();
  for (const s of layer.querySelectorAll("span")) {
    if (!s.textContent.trim() || s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")) continue;
    const r = s.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const key = lineKeyOf(r, cr.top);
    if (!lineMap.has(key)) lineMap.set(key, []);
    lineMap.get(key).push(s);
  }
  // Prose lines (≥4 lowercase words spanning ≥55% of some zone's width) and
  // their PARAGRAPH CONTINUATIONS: a short last line ("as shown in Figure
  // 8b.") directly under a prose line is the same paragraph, not a cell.
  // Whole lowercase words, not letter runs inside identifiers — mirrors the
  // engine's proseWordCount. Counting runs made a code line of the shape
  // "RETURN x.name AS label, ..." look as wordy as a sentence, which is how a
  // framed listing's interior came to be treated as prose between frames on
  // both sides. (No backticks in here - this whole block is a template literal.)
  const words = (s) => (s.match(/(?:^|[\\s(“"'])[a-zà-ÿ]{2,}(?=[\\s.,;:)\\]”"']|$)/g) || []).length;
  const proseKeys = new Set();
  const keys = [...lineMap.keys()].sort((a, b) => a - b);
  for (const key of keys) {
    const line = lineMap.get(key);
    const text = line.map((el) => el.textContent).join(" ");
    const lw = words(text);
    const xs = line.map((el) => el.getBoundingClientRect());
    const w = (Math.max(...xs.map((q) => q.right)) - Math.min(...xs.map((q) => q.left))) * sx;
    const wideProse = lw >= 4 && zones.some((z) => w >= (z.x1 - z.x0) * 0.55);
    // Continuation: a prose line 6-21 page px above (2-7 buckets). The old
    // 3-5 buckets (9-15 px) was narrower than 12pt leading (~16 px), so
    // whether the previous line counted came down to rounding — at 180% a
    // processed line's few-px shift dropped IEEE p4's "the response from"
    // (prose between two framed listings) out of the window and it read as
    // an offender. 21 px mirrors the engine's own window (ZONE_CONT_LINES).
    let contPrev = false;
    for (let k = 2; k <= 7 && !contPrev; k++) contPrev = lw >= 2 && proseKeys.has(key - k);
    if (wideProse || contPrev) proseKeys.add(key);
  }
  // --noexempt: drop the prose exemption entirely. A control for the exemption
  // itself — with it off, every processed span inside a zone is reported, which
  // shows the zone/offender machinery is alive and that a change in offender
  // count came from the EXEMPTION and nothing else. (Neutering the engine's
  // table skipping does not work as a control: table text is typically set
  // smaller than body, so those spans are not processing candidates at all and
  // no amount of un-skipping makes them offenders.)
  if (${JSON.stringify(false)} || ${NOEXEMPT}) proseKeys.clear();
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
      if (proseKeys.has(lineKeyOf(r, cr.top))) {
        const t = s.textContent.trim();
        const slw = words(t);
        if (slw >= 2 || (slw >= 1 && t.length >= 12)) break; // part of the prose flow
      }
      // --why: the inputs the prose exemption above judged, so a FALSE POSITIVE
      // can be diagnosed instead of guessed at. lineW/zoneW are canvas px; the
      // exemption needs lineW >= zoneW * 0.55 on a line of >= 4 lowercase words.
      const key = lineKeyOf(r, cr.top);
      const line = lineMap.get(key) ?? [];
      const lxs = line.map((el) => el.getBoundingClientRect());
      const lineW = lxs.length ? (Math.max(...lxs.map((q) => q.right)) - Math.min(...lxs.map((q) => q.left))) * sx : 0;
      const lineText = line.map((el) => el.textContent).join(" ");
      offenders.push({
        t: s.textContent.trim().slice(0, 44),
        zone: [Math.round(z.yTop / sy), Math.round(z.yBot / sy)],
        why: {
          key, spansOnLine: line.length,
          lineWords: words(lineText),
          lineW: Math.round(lineW), zoneW: Math.round(z.x1 - z.x0),
          ratio: +(lineW / Math.max(1, z.x1 - z.x0)).toFixed(2),
          inProseKeys: proseKeys.has(key),
        },
      });
      break;
    }
  }
  return { zones: zones.length, offenders: offenders.slice(0, 20) };
})()`;

// In-page: every text-layer leaf span of page p as [key, fx-b runs, processed,
// reason]. The key is the span's text plus its occurrence index among spans
// with the same text on that page — the text layer's order comes from
// getTextContent and does not depend on the zoom, while any geometric key
// would (a processed span's rect moves with its re-rendered face). Our own
// inline wrappers are not leaves; PDF.js's markedContent containers are not
// either.
const SPANS = (p) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
  const layer = pv && pv.textLayer && pv.textLayer.div;
  if (!layer) return null;
  const OURS = ".fx-cite-c,.fx-ref-c,.fx-sp";
  const nth = new Map();
  const out = [];
  for (const s of layer.querySelectorAll("span")) {
    if (s.matches(OURS) || s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")) continue;
    const t = s.textContent.replace(/\\s+/g, " ").trim();
    if (!t) continue;
    const n = (nth.get(t) || 0) + 1;
    nth.set(t, n);
    out.push([t + "#" + n, s.querySelectorAll(".fx-b").length, s.hasAttribute("data-fx-done") ? 1 : 0,
      s.dataset.fxWhy || (s.dataset.fxTable ? "table" : "")]);
  }
  return out;
})()`;

// Processed/emphasis counts of page p, for the settle loop.
// Has the engine HANDLED page p yet? A page with prose on it is handled once
// any prose span is processed or carries the reason it was left (__fxDebug is
// on). Settling on counts alone accepted a page that had not been processed
// YET: under a loaded gate a whole zoom read that way, and every emphasized
// span of it became a "zoom flip" (925 on one paper, 0 when re-run alone).
const HANDLED = (p) => `(() => {
  const d = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;
  if (!d) return false;
  let prose = 0;
  for (const s of d.querySelectorAll(":scope > span")) {
    if (((s.textContent || "").match(/[a-z]{2,}/g) || []).length < 2) continue;
    prose++;
    if (s.hasAttribute("data-fx-done") || s.dataset.fxWhy || s.hasAttribute("data-fx-keep") || s.hasAttribute("data-fx-table")) return true;
  }
  return prose < 3;
})()`;
const COUNTS = (p) => `(() => { const d = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;
  return d ? d.querySelectorAll("span[data-fx-done]").length + "/" + d.querySelectorAll(".fx-b").length : "-"; })()`;

// Wait until page p's engine output stops changing. A capped base canvas is
// re-processed once its DETAIL canvas lands (engine.onDetailRendered), so the
// first non-empty state is not necessarily the final one.
async function settle(p) {
  let last = "", stable = 0;
  for (let i = 0; i < 45; i++) {
    await sleep(400);
    const st = await ev(COUNTS(p)).catch(soft("-"));
    if (st === last && st !== "-") {
      // An empty page (figure-only, blank) settles too, just not in a hurry.
      if (++stable >= (st.startsWith("0/") ? 10 : 5)) return st;
    } else { stable = 0; last = st; }
  }
  return last;
}

let tabId = null;
async function openViewer(extId, url) {
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(url)}`, "PUT");
  tabId = tab.id;
  // 90 s per call, not 30: the oracle renders the page itself at ORACLE_SCALE
  // inside ONE evaluation. Bounded is what matters; a hang still fails.
  cdp = connect(tab.webSocketDebuggerUrl, { where: "viewer", timeoutMs: 90000 });
  await cdp.ready;
  await send("Page.enable"); await sleep(2500);
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { ok = await ev(`!!(window.PDFViewerApplication?.pdfDocument && window.PDFViewerApplication.pdfViewer)`).catch(soft(false)); if (!ok) await sleep(500); }
  if (!ok) throw new Error("viewer never loaded");
}
async function closeViewer() {
  cdp?.close();
  cdp = null;
  if (tabId) { try { await fetch(`http://127.0.0.1:${PORT}/json/close/${tabId}`); } catch {} tabId = null; }
  await sleep(500);
}

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  if (!extId) throw new Error("extension did not load");
  console.log(`Browser: ${version.Browser}  paper: ${FILTER}  zooms: ${ZOOMS.join(", ")}`);
  const url = URL_OVERRIDE ?? PAPERS[FILTER];
  const runs = []; // {zoom, scale, spans: Map(page -> rows), processed, emphasized, offenders}
  for (const zoom of ZOOMS) {
    await openViewer(extId, url);
    // Engine OFF while the zoom is set — the profile remembers `enabled` from
    // the previous pass, and a pass that starts at the restored zoom and then
    // re-processes is not the standalone run R47 measured.
    await ev(`globalThis.__fxDebug = true`);
    await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:false},r))`).catch(() => {});
    await ev(`window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(zoom)}`);
    await sleep(1500);
    // Enabling must SUCCEED: its failure used to be swallowed, and under a
    // loaded gate a whole zoom was then measured with the engine off.
    await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`);
    const scale = await ev(`window.PDFViewerApplication.pdfViewer.currentScale`);
    const pages = await ev(`window.PDFViewerApplication.pagesCount`);
    const from = RANGE[0] || 1, to = Math.min(RANGE[1] || pages, pages);
    console.log(`\n== zoom ${zoom} (scale ${(+scale).toFixed(3)})`);
    const run = { zoom, scale, spans: new Map(), processed: 0, emphasized: 0, offenders: 0 };
    for (let p = from; p <= to; p++) {
      await ev(`window.PDFViewerApplication.page = ${p}`);
      await settle(p);
      let handled = false;
      for (let i = 0; i < 30 && !handled; i++) { handled = await ev(HANDLED(p)).catch(soft(false)); if (!handled) { await sleep(1000); await settle(p); } }
      if (!handled) throw new Error(`p${p} was never processed by the engine at zoom ${zoom} — no verdict`);
      const res = await ev(CHECK(p)).catch((e) => ({ error: String(e).slice(0, 120) }));
      const rows = await ev(SPANS(p)).catch(() => null);
      if (rows) {
        run.spans.set(p, rows);
        for (const r of rows) { run.processed += r[2]; if (r[1] > 0) run.emphasized++; }
      }
      if (res.error) { console.log(`p${p}: ${res.error}`); continue; }
      run.offenders += res.offenders.length;
      const tag = res.offenders.length ? "  <<< PROCESSED IN TABLE" : "";
      if (res.offenders.length || res.zones) console.log(`p${p}: zones=${res.zones} offenders=${res.offenders.length}${tag}`);
      for (const o of res.offenders) {
        console.log(`   y${o.zone[0]}-${o.zone[1]}: "${o.t}"`);
        if (WHY && o.why) console.log(`      why: ${JSON.stringify(o.why)}`);
      }
    }
    await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:false},r))`).catch(() => {});
    await closeViewer();
    runs.push(run);
  }

  // Cross-zoom: the same span must carry the same emphasis at every zoom.
  let flips = 0, unmatched = 0;
  if (runs.length > 1) {
    console.log(`\n== emphasis per span across zooms (${runs.map((r) => r.zoom).join(" / ")})`);
    const allPages = [...new Set(runs.flatMap((r) => [...r.spans.keys()]))].sort((a, b) => a - b);
    for (const p of allPages) {
      const maps = runs.map((r) => new Map((r.spans.get(p) ?? []).map((row) => [row[0], row])));
      if (maps.some((m) => !m.size)) { console.log(`p${p}: text layer missing at some zoom — not compared`); continue; }
      const lines = [];
      for (const key of maps[0].keys()) {
        const rows = maps.map((m) => m.get(key));
        if (rows.some((r) => !r)) { unmatched++; continue; }
        if (rows.every((r) => r[1] === rows[0][1])) continue;
        flips++;
        const states = rows.map((r, i) => `${runs[i].zoom}:${r[1]}${r[3] ? "(" + r[3] + ")" : ""}`).join("  ");
        lines.push(`   "${key.replace(/#1$/, "").slice(0, 44)}"  ${states}`);
      }
      for (const m of maps.slice(1)) for (const key of m.keys()) if (!maps[0].has(key)) unmatched++;
      if (lines.length) {
        console.log(`p${p}: ${lines.length} span(s) change emphasis with the zoom  <<< ZOOM-DEPENDENT`);
        for (const l of lines.slice(0, 15)) console.log(l);
        if (lines.length > 15) console.log(`   ... ${lines.length - 15} more`);
      }
    }
  }

  if (DUMP) writeFileSync(DUMP, JSON.stringify(runs.map((r) => ({ zoom: r.zoom, scale: r.scale, spans: Object.fromEntries(r.spans) }))));
  console.log(`\n== summary`);
  for (const r of runs) console.log(`zoom ${r.zoom.padEnd(8)} processed=${r.processed} emphasized=${r.emphasized} offenders=${r.offenders}`);
  console.log(`(processed/emphasized totals are for reference only; they are not the pass/fail)`);
  const offenders = runs.reduce((n, r) => n + r.offenders, 0);
  console.log(`\nTOTAL offenders: ${offenders}`);
  if (runs.length > 1) console.log(`TOTAL zoom flips: ${flips}${unmatched ? `  (${unmatched} span key(s) present at only some zooms, not compared)` : ""}`);
  if (offenders > 0 || flips > 0) process.exitCode = 1;
} catch (e) { console.error("tables test error:", e.message || e); process.exitCode = 1; }
finally {
  await closeViewer();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
