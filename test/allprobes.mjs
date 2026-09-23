// Several gate checks over ONE render of a document instead of one render each.
//
// The checks are read-only probes over the same settled page: each enables the
// extension, walks the document a page at a time and evaluates an expression
// against the rendered DOM, and the render is almost the whole cost. But they
// cannot all share one, because ZOOM IS NOT COSMETIC: it changes layout, layout
// changes classification, and classification is what they measure (R47 — the
// same paper processes 1819 spans at 1.0 and 1831 at 1.8). So the checks are
// grouped by the render they were validated on, and a group is a PASS:
//
//   A  fontkeep, whyskip           zoom 1.8, 2600x2400 window, sidebar hidden,
//                                  __fxDebug on before the engine runs
//   B  eqkeep, refcolor, citepoint the viewer's default zoom, 1400x2000 window
//
// tables (page-fit) and console (reloads, toggles reading mode) cannot share
// one and stay standalone stages. Each check's probe and verdict come from its
// module in test/probes/, the same code its standalone harness runs, and every
// check prints exactly the lines its harness prints, under a `--- <check> ---`
// header, so a combined log and a standalone log can be compared line for line
// (local/gate-compare.mjs does).
//
// Exit 0 all checks pass; 1 a check FAILED; 75 no check failed but some page
// was never measured (probe error, or no text layer however long it waited) —
// a harness outcome, not a verdict about the product, and the sweep retries it.
// A check that was asked for and measured nothing is a FAIL: a combined run
// that silently drops a check is worse than a slow one.
//
// Usage: node test/allprobes.mjs --url=<pdf> --pass=A|B [--label=name]
//        [--all | --page=N] [--max=N] [--checks=a,b]
import { spawn } from "node:child_process";
import { appendFileSync, rmSync } from "node:fs";

import { browserPath, extensionDir, outDir, profileDir, killBrowser } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";
import * as fontkeep from "./probes/fontkeep.mjs";
import * as whyskip from "./probes/whyskip.mjs";
import * as eqkeep from "./probes/eqkeep.mjs";
import * as refcolor from "./probes/refcolor.mjs";
import * as citepoint from "./probes/citepoint.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url");
const LABEL = arg("label", "doc");
const PASS = arg("pass");
const ALL = process.argv.includes("--all");
const PAGE = parseInt(arg("page", "1"), 10);
// citepoint clicks every multi-key citation and each click fires a lookup, so a
// citation-dense paper is capped — the same cap and default as its harness.
const MAX = parseInt(arg("max", "40"), 10);

const PASSES = {
  A: { checks: ["fontkeep", "whyskip"], window: "2600,2400", zoom: "1.8", debug: true, hideSidebar: true },
  B: { checks: ["eqkeep", "refcolor", "citepoint"], window: "1400,2000", zoom: null, debug: false, hideSidebar: false },
};
const MODULES = { fontkeep, whyskip, eqkeep, refcolor, citepoint };
const cfg = PASSES[PASS];
const CHECKS = arg("checks", cfg?.checks.join(","))?.split(",").filter(Boolean) ?? [];
if (!URL0 || !cfg || !CHECKS.length || CHECKS.some((c) => !cfg.checks.includes(c))) {
  console.error("usage: node test/allprobes.mjs --url=<pdf> --pass=A|B [--label=name] [--all|--page=N] [--max=N] [--checks=a,b]");
  console.error(`  pass A: ${PASSES.A.checks.join(", ")}   pass B: ${PASSES.B.checks.join(", ")}`);
  process.exit(2);
}

const PORT = 17200 + (process.pid % 300);
const userDataDir = profileDir(`allprobes-${PORT}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", `--window-size=${cfg.window}`,
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

let cdp;
const ev = (expr, opts) => cdp.ev(expr, opts);

// One page's settle, shared by every check in the pass — so it has to be at
// least as patient as the most patient of them, and it watches the UNION of
// what they wait for. Annotation runs after emphasis: a settle on the
// typography counts alone returns while references are still being coloured,
// and refcolor sharing it once measured 0 references on a page with 8.
const signature = (page) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page} - 1);
  if (!pv || !pv.textLayer) return "x";
  const d = pv.textLayer.div;
  return d.querySelectorAll("span[data-fx-done]").length + "/" + d.querySelectorAll(".fx-b").length + "/" +
         d.querySelectorAll(".fx-ref-c").length + "/" + d.querySelectorAll(".fx-cite-c").length + "/" +
         pv.div.querySelectorAll(".fx-cite-hit").length;
})()`;
const settle = async (page) => {
  let last = "", stable = 0;
  for (let i = 0; i < 60; i++) {
    const cur = await ev(signature(page)).catch(() => "x");
    // Five reads 500 ms apart: at least as patient as every harness it
    // replaces (fontkeep and eqkeep take 5 at 400, whyskip 5 at 500).
    if (cur === last && cur !== "x") { if (++stable >= 5) return true; } else { stable = 0; last = cur; }
    await sleep(500);
  }
  return false;
};

const state = Object.fromEntries(CHECKS.map((c) => [c, MODULES[c].create()]));
const lines = Object.fromEntries(CHECKS.map((c) => [c, []]));
const measured = Object.fromEntries(CHECKS.map((c) => [c, 0]));
const unmeasured = Object.fromEntries(CHECKS.map((c) => [c, []]));
const emit = (c, { out = [], err = [] }) => { lines[c].push(...out, ...err); };

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  if (!version) throw new Error("debugger endpoint never came up");
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(400);
  }
  if (!extId) throw new Error("extension did not load");
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  await sleep(2500);
  const live = (await http("/json/list")).find((t) => t.id === tab.id) ?? tab;
  cdp = connect(live.webSocketDebuggerUrl, { where: "viewer" });
  await cdp.ready;
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  let loaded = false;
  for (let i = 0; i < 40 && !loaded; i++) { loaded = await ev(`!!window.PDFViewerApplication?.pdfDocument`).catch(() => false); if (!loaded) await sleep(500); }
  if (!loaded) throw new Error("document never loaded");
  // Before any page is processed, as whyskip does it, so the engine records
  // its skip reasons from the first pass rather than from a re-process.
  if (cfg.debug) await ev(`(() => { globalThis.__fxDebug = true; return true; })()`);
  if (cfg.hideSidebar) {
    await ev(`(() => { const s = document.createElement("style");
      s.textContent = "#sidebarContainer{display:none!important}#outerContainer.sidebarOpen #viewerContainer{inset-inline-start:0!important}";
      document.head.appendChild(s); return true; })()`);
  }
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  if (cfg.zoom) await ev(`(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(cfg.zoom)}; return true; })()`);
  if (PASS === "B") {
    // The document-wide warm-up refcolor and citepoint wait for: enough
    // emphasis to know the engine is running, and the reference index built.
    for (let i = 0; i < 40; i++) {
      await sleep(800);
      const w = await ev(`({ b: document.querySelectorAll('.textLayer .fx-b').length, refs: globalThis.__fxRefCount ?? -1 })`).catch(() => null);
      if (w && w.b > 80 && w.refs >= 0) break;
    }
  } else {
    await sleep(4000); // fontkeep's first-render wait; each page then settles on its own counts
  }

  const numPages = await ev(`window.PDFViewerApplication.pdfDocument.numPages`);
  const pages = ALL ? Array.from({ length: numPages }, (_, i) => i + 1) : [PAGE];
  for (const pg of pages) {
    const citing = CHECKS.includes("citepoint") && state.citepoint.examined < MAX;
    await ev(`(() => { window.PDFViewerApplication.page = ${pg}; return true; })()`);
    await sleep(citing ? 2200 : 1200);
    await settle(pg);
    if (citing) {
      // citepoint's own wait: this page's hit-targets, not a document count —
      // a page read mid-annotation reports every citation as WRONG-TARGET.
      for (let i = 0; i < 20; i++) {
        const n = await ev(`(() => { const pv = window.PDFViewerApplication.pdfViewer.getPageView(${pg - 1}); return pv && pv.textLayer ? pv.div.querySelectorAll('.fx-cite-hit').length : 0; })()`).catch(() => 0);
        if (n > 0) break;
        await sleep(600);
      }
      await sleep(600);
    }
    // citepoint last: it CLICKS, and every other probe reads an untouched page.
    for (const c of CHECKS) {
      if (c === "citepoint" && state.citepoint.examined >= MAX) continue;
      const expr = c === "citepoint" ? citepoint.probe(pg, { max: MAX, examined: state.citepoint.examined }) : MODULES[c].probe(pg);
      let r = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          r = await ev(expr, { ms: c === "citepoint" ? 120000 : 30000 });
        } catch (e) {
          r = { error: `probe threw: ${(e.message || String(e)).slice(0, 160)}` };
        }
        if (r && !r.error) break;
        // No text layer yet, or the probe threw: give the page longer and read
        // it again, then call it unmeasured. A null used to be skipped in
        // silence, which is how a document could "pass" on 9 of its 16 pages.
        await sleep(1500);
        await settle(pg);
      }
      if (!r || r.error) {
        unmeasured[c].push(pg);
        emit(c, { out: [`p${pg}: NOT MEASURED — ${r?.error ?? "no text layer"}`] });
        continue;
      }
      measured[c]++;
      emit(c, MODULES[c].add(state[c], pg, r));
    }
  }

  let failed = 0, blind = 0;
  const verdicts = [];
  for (const c of CHECKS) {
    const v = MODULES[c].summarize(state[c], { label: LABEL });
    emit(c, v);
    if (v.logLine) appendFileSync(`${outDir()}/${c}.log`, v.logLine + String.fromCharCode(10));
    let ok = v.ok;
    if (!measured[c]) { ok = false; lines[c].push(`  FAIL ${c} measured no page at all — the check proved nothing`); }
    if (!ok) failed++;
    if (unmeasured[c].length) {
      blind++;
      lines[c].push(`  NO VERDICT on ${unmeasured[c].length} page(s): p${unmeasured[c].join(",p")} — not measured, so not a pass`);
    }
    verdicts.push(`${c}=${!ok ? "FAIL" : unmeasured[c].length ? "UNMEASURED" : "ok"}`);
  }
  for (const c of CHECKS) {
    console.log(`--- ${c} ---`);
    for (const l of lines[c]) console.log(l);
  }
  const line = `${LABEL} pass=${PASS} pages=${pages.length} ${verdicts.join(" ")}`;
  console.log(line);
  appendFileSync(`${outDir()}/allprobes.log`, line + String.fromCharCode(10));
  process.exitCode = failed ? 1 : blind ? 75 : 0;
} catch (e) {
  console.error(`${LABEL} allprobes error: ${e.message || e}`);
  process.exitCode = 1;
} finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
