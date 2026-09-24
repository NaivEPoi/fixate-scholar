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
//        [--url=<pdf>] [--why] [--noexempt] [--dump=<file>] [--rule-ppu=N]
// --rule-ppu: the resolution of the engine's baseline rule render (bitmap px
// per page px; RULE_PPU in the engine) — for choosing that constant by
// comparing two --dump runs, never for a gate.

import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir, killBrowser, devtoolsPort } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";
import * as tables from "./probes/tables.mjs";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILTER = POS[0] ?? "5GShield";
const WHY = process.argv.slice(2).includes("--why"); // dump the prose-exemption inputs per offender
const NOEXEMPT = process.argv.slice(2).includes("--noexempt"); // control: disable the prose exemption
const URL_OVERRIDE = process.argv.slice(2).find((a) => a.startsWith("--url="))?.slice(6); // any PDF URL, e.g. a local test server
// --dump=<file>: every zoom's per-span rows as JSON, for comparing two builds
// of the engine span by span (same paper, same zooms).
const DUMP = process.argv.slice(2).find((a) => a.startsWith("--dump="))?.slice(7);
const RULE_PPU = parseFloat(process.argv.slice(2).find((a) => a.startsWith("--rule-ppu="))?.slice(11) ?? "");
const RANGE = (process.argv.slice(2).find((a) => a.startsWith("--pages="))?.slice(8) ?? "").split("-").map((n) => parseInt(n, 10));
// Default sweep: the page-fit this check always ran at, plus 100% and the 180%
// the fontkeep/whyskip stages use — the two zooms R47 measured apart.
const ZOOMS = (process.argv.slice(2).find((a) => a.startsWith("--zooms="))?.slice(8) ?? "page-fit,1.0,1.8")
  .split(",").map((z) => z.trim()).filter(Boolean);
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
let PORT = 0; // the free port the browser chose (lib/env.mjs devtoolsPort)
const userDataDir = join(tmpdir(), `fx-tab-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => {
  PORT ||= await devtoolsPort(userDataDir, launched);
  return (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
};

const launched = Date.now();
const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=0`, "--headless=new", "--no-first-run",
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
// How much of page p's prose the engine has HANDLED: a prose span is handled
// once it is processed or carries the reason it was left (__fxDebug is on;
// every prose span of both corpora ends up one or the other). Settling on
// counts alone accepted a page the engine had not reached, or was half-way
// through, and every span it had not got to yet became a "zoom flip" (925 on
// one paper, 0 when re-run alone). LEAF spans, not the layer's children: a
// tagged PDF nests its text spans in marked-content spans, and reading only
// direct children saw no prose at all on one such document.
const HANDLED = (p) => `(() => {
  const d = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;
  if (!d) return null;
  let prose = 0, handled = 0;
  for (const s of d.querySelectorAll("span")) {
    if (s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")) continue;
    if (s.matches(".fx-cite-c, .fx-ref-c, .fx-sp")) continue; // the engine's own runs inside a span
    if (((s.textContent || "").match(/[a-z]{2,}/g) || []).length < 2) continue;
    prose++;
    const h = s.closest("[data-fx-done], [data-fx-why], [data-fx-keep], [data-fx-table]");
    if (h) handled++;
  }
  return { prose, handled, hidden: document.hidden };
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
    if (RULE_PPU > 0) await ev(`globalThis.__fxRulePPU = ${RULE_PPU}`);
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
    const run = { zoom, scale, spans: new Map(), processed: 0, emphasized: 0, offenders: 0, check: tables.create({ why: WHY }) };
    for (let p = from; p <= to; p++) {
      await ev(`window.PDFViewerApplication.page = ${p}`);
      await settle(p);
      // Wait until the engine has handled ALL of the page's prose, then read.
      // Bounded: after 30 s a page with nothing handled at all is no verdict;
      // one partly handled is read as it stands (a span the engine truly never
      // marks cannot hold the run hostage).
      // ...or until it stops changing (five unchanged settled reads outlast
      // the engine's longest own wait): undecided prose is then the engine's.
      let st = null, still = 0, lastHandled = -1;
      for (let i = 0; i < 30; i++) {
        st = await ev(HANDLED(p)).catch(soft(null));
        if (st && (st.prose < 3 || st.handled === st.prose || st.hidden)) break;
        if (st && st.handled === lastHandled) { if (++still >= 5) break; } else { still = 0; lastHandled = st?.handled ?? -1; }
        await sleep(1000);
        await settle(p);
      }
      // A page the engine left alone however long it waited is the engine's
      // output and is measured as such — except one it never touched at all.
      // (A guard that also called "processed nothing, some prose undecided" no
      // verdict turned a real whyskip-class failure into UNVERIFIED: the
      // engine leaving a page restored and unprocessed IS what a reader sees.)
      // The engine pauses while its tab is hidden; a hidden tab is the harness's
      // doing (another tab in front: lib/env.mjs devtoolsPort).
      if (st?.hidden) throw new Error(`p${p}: the viewer tab reported hidden at zoom ${zoom} — the engine pauses there; no verdict`);
      if (!st || (st.prose >= 3 && st.handled === 0)) {
        throw new Error(`p${p} was never processed by the engine at zoom ${zoom} — no verdict`);
      }
      const res = await ev(tables.probe(p, { noexempt: NOEXEMPT })).catch((e) => ({ error: String(e).slice(0, 120) }));
      const rows = await ev(SPANS(p)).catch(() => null);
      if (rows) {
        run.spans.set(p, rows);
        for (const r of rows) { run.processed += r[2]; if (r[1] > 0) run.emphasized++; }
      }
      if (res.error) { console.log(`p${p}: ${res.error}`); continue; }
      run.offenders += res.offenders.length;
      for (const l of tables.add(run.check, p, res).out) console.log(l);
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
