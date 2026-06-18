// Sensitive rendering-fidelity diagnostic for the reported visual defects.
// Unlike papers.mjs (structural rules), this probes pixel/geometry fidelity:
//   - whiteout : a mask covers on-canvas content (heading/figure/table) that is
//                NOT re-rendered on top → it disappears        (issues 1, 3)
//   - peek     : a processed span's mask is too small to cover the canvas glyph
//                + ink overshoot → original ink peeks out       (issue 9)
//   - font     : a processed span's font is not the embedded face actually
//                loaded → renders in a fallback (wrong) font    (issues 1, 3, 7)
//   - skipPara : a contiguous run of body-prose lines left unprocessed (issue 6)
//   - citeGap  : citation hit-target drifts from its colored [X] text (issue 5)
//   - refNav   : colored Figure/Table refs with no working jump link (issue 4)
//   - select   : a processed glyph is not the top hit-test target (issue 8)
//
// Usage: node test/diagnose.mjs [template-filter] [--shots] [browser]
//   default filter "Two-column B" (5GBaseChecker — the user's repro paper)

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ARGS = process.argv.slice(2); // skip node binary + script path
const FILTER = ARGS.find((a) => !a.startsWith("--") && !a.toLowerCase().endsWith(".exe")) ?? "Two-column B";
const SHOTS = ARGS.includes("--shots");
const BROWSER = ARGS.find((a) => a.toLowerCase().endsWith(".exe")) ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "Two-column C": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "Two-column D": "https://yilud.me/Proteus-ccs24.pdf",
  "Two-column E": "https://yilud.me/SIB-Auth.pdf",
  "Two-column F": "https://yilud.me/a33-dong%20stamped.pdf",
  "arXiv": "https://arxiv.org/pdf/2502.04915",
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9341;
const userDataDir = join(tmpdir(), `fx-diag-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

// ---- in-page probe: runs against whatever pages are currently rendered ----
// Returns per-rendered-page fidelity findings. Pure DOM/geometry, no captures.
const PROBE = `(() => {
  const within = (r, R, t = 0) => r.left >= R.left - t && r.right <= R.right + t && r.top >= R.top - t && r.bottom <= R.bottom + t;
  const overlapArea = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const LOWER = /^[a-zà-ÿ]{2,}$/;
  const out = [];
  const viewer = window.PDFViewerApplication.pdfViewer;
  for (let i = 0; i < viewer.pagesCount; i++) {
    const pv = viewer.getPageView(i);
    const div = pv?.textLayer?.div;
    if (!div || !div.childElementCount) continue;
    const page = pv.id;
    const leaves = [...div.querySelectorAll("span")].filter((s) => !s.querySelector("span") && s.textContent.trim());
    const masks = [...pv.div.querySelectorAll(".fx-mask > div")].map((m) => m.getBoundingClientRect()).filter((r) => r.width > 0);
    const done = leaves.filter((s) => s.dataset.fxDone);
    const fxRect = pv.div.getBoundingClientRect();

    // --- whiteout: on-canvas span (left for canvas: heading/figure/table/caption)
    //     mostly covered by a mask, AND no rendered span (fx-done/fx-keep, incl.
    //     wrapped ones) redraws that area. The second clause excludes masked
    //     DUPLICATE spans (some PDFs carry the same glyphs twice) whose text is
    //     still shown by the overlapping rendered copy — not a true whiteout. ---
    const renderedRects = [...div.querySelectorAll("span")]
      .filter((s) => s.dataset.fxDone || s.dataset.fxKeep)
      .map((s) => s.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    const whiteout = [];
    for (const s of leaves) {
      if (s.dataset.fxDone || s.dataset.fxKeep) continue;
      const r = s.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (!/[A-Za-zÀ-ÿ]/.test(s.textContent)) continue;
      const area = r.width * r.height;
      let cov = 0;
      for (const m of masks) cov += overlapArea(r, m);
      if (cov / area <= 0.55) continue;
      let redrawn = 0;
      for (const rr of renderedRects) redrawn += overlapArea(r, rr);
      if (redrawn / area > 0.3) continue; // a rendered copy shows this text
      whiteout.push({ t: s.textContent.trim().slice(0, 40), cov: +(cov / area).toFixed(2) });
    }

    // --- peek: processed span whose canvas glyph + overshoot is NOT covered by
    //     any single mask (masks are per-run rectangles; a span sits in one). ---
    let peek = 0, peekMax = 0;
    const peekSamples = [];
    for (const s of done) {
      const r = s.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const vOver = r.height * 0.28, hOver = Math.max(2, r.height * 0.12);
      const need = { left: r.left - hOver, right: r.right + hOver, top: r.top - vOver, bottom: r.bottom + vOver };
      // best vertical-overlapping mask
      let best = null, bestOv = 0;
      for (const m of masks) {
        const ov = Math.min(r.bottom, m.bottom) - Math.max(r.top, m.top);
        if (ov > bestOv && Math.min(r.right, m.right) - Math.max(r.left, m.left) > 0) { bestOv = ov; best = m; }
      }
      if (!best) { peek++; peekMax = Math.max(peekMax, r.height); if (peekSamples.length < 4) peekSamples.push({ t: s.textContent.trim().slice(0, 24), d: "nomask" }); continue; }
      const dTop = best.top - need.top, dBot = need.bottom - best.bottom;
      const dLeft = best.left - need.left, dRight = need.right - best.right;
      const deficit = Math.max(dTop, dBot, dLeft, dRight);
      if (deficit > 0.75) { peek++; peekMax = Math.max(peekMax, deficit); if (peekSamples.length < 4) peekSamples.push({ t: s.textContent.trim().slice(0, 24), d: +deficit.toFixed(1) }); }
    }

    // --- font: processed span's first font-family not actually loaded → fallback. ---
    let fontBad = 0;
    const fontSamples = [];
    for (const s of done) {
      const ff = getComputedStyle(s).fontFamily.split(",")[0].replace(/["']/g, "").trim();
      const fs = Math.ceil(parseFloat(getComputedStyle(s).fontSize)) || 10;
      let loaded = true;
      try { loaded = document.fonts.check(fs + 'px "' + ff + '"'); } catch { loaded = true; }
      const embedded = /^g_/.test(ff) || /^FX /.test(ff);
      if (!embedded || !loaded) { fontBad++; if (fontSamples.length < 4) fontSamples.push({ t: s.textContent.trim().slice(0, 20), ff, loaded }); }
    }

    // --- skipPara: contiguous body-region prose lines that are unprocessed. ---
    //     Group leaves into baseline lines; a "prose" line has >=4 lowercase
    //     words. Count runs of >=2 consecutive prose lines with zero fx-done.
    const body = leaves.filter((s) => {
      const r = s.getBoundingClientRect();
      const ry = (r.top + r.bottom) / 2 - fxRect.top;
      return ry > fxRect.height * 0.07 && ry < fxRect.height * 0.93;
    });
    const byLine = new Map();
    for (const s of body) {
      const r = s.getBoundingClientRect();
      const key = Math.round((r.top - fxRect.top) / 4);
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(s);
    }
    const lineKeys = [...byLine.keys()].sort((a, b) => a - b);
    let skipRun = 0, curRun = 0, skipSample = null;
    for (const k of lineKeys) {
      const spans = byLine.get(k);
      const text = spans.map((s) => s.textContent).join(" ");
      const lw = (text.match(/[a-zà-ÿ]{2,}/g) || []).filter((w) => LOWER.test(w)).length;
      const anyDone = spans.some((s) => s.dataset.fxDone);
      const anyKeep = spans.some((s) => s.dataset.fxKeep || s.dataset.fxTable);
      if (lw >= 4 && !anyDone && !anyKeep) {
        curRun++;
        if (curRun >= 3 && !skipSample) skipSample = text.slice(0, 60);
      } else {
        if (curRun >= 3) skipRun++;
        curRun = 0;
      }
    }
    if (curRun >= 3) skipRun++;

    // --- citeGap: hit-target <a> vs its colored [X] text position. ---
    const hits = [...pv.div.querySelectorAll(".fx-cite-hit")].map((a) => a.getBoundingClientRect());
    const citeC = [...div.querySelectorAll(".fx-cite-c")].map((c) => c.getBoundingClientRect());
    let citeGapMax = 0, citeGapN = 0;
    for (const h of hits) {
      let best = Infinity;
      for (const c of citeC) {
        const dx = (h.left + h.right) / 2 - (c.left + c.right) / 2;
        const dy = (h.top + h.bottom) / 2 - (c.top + c.bottom) / 2;
        best = Math.min(best, Math.hypot(dx, dy));
      }
      if (best !== Infinity) { citeGapMax = Math.max(citeGapMax, best); if (best > 3) citeGapN++; }
    }

    // --- refNav: colored internal refs vs clickable internal-ref targets. ---
    const refColored = div.querySelectorAll(".fx-ref-c").length;
    const refHits = pv.div.querySelectorAll(".fx-ref-hit").length;

    // --- select: is a processed glyph the top hit-target? sample up to 8. ---
    let selOk = 0, selBad = 0;
    const selSamples = [];
    for (const s of done.slice(0, 30)) {
      const b = s.querySelector(".fx-b") || s;
      const r = b.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const el = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      if (!el) continue;
      if (el.closest(".textLayer")) selOk++;
      else { selBad++; if (selSamples.length < 4) selSamples.push({ t: s.textContent.trim().slice(0, 16), el: el.className || el.tagName }); }
      if (selOk >= 8) break;
    }

    out.push({ page, leaves: leaves.length, done: done.length, masks: masks.length,
      whiteout: whiteout.length, whiteoutSamples: whiteout.slice(0, 5),
      peek, peekMax: +peekMax.toFixed(1), peekSamples,
      fontBad, fontSamples,
      skipRun, skipSample,
      citeGapMax: +citeGapMax.toFixed(1), citeGapN, hits: hits.length, citeC: citeC.length,
      refColored, refHits,
      selOk, selBad, selSamples });
  }
  return out;
})()`;

const browser = spawn(BROWSER, [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
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
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  if (!version) throw new Error("debugger never came up");
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const t = await http("/json/list");
    const sw = t.find((x) => x.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(250);
  }
  if (!extId) throw new Error("extension did not load");
  console.log(`Browser: ${version.Browser}  paper: ${FILTER}\n`);

  const url = PAPERS[FILTER];
  if (!url) throw new Error(`unknown paper ${FILTER}`);
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(url)}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(2500);
  await ev(`chrome.storage.sync.set({ enabled: true })`);
  // wait for first-pass processing
  for (let i = 0; i < 40; i++) {
    await sleep(800);
    const st = await ev(`({ b: document.querySelectorAll('.textLayer .fx-b').length, refs: globalThis.__fxRefCount ?? 0 })`).catch(() => null);
    if (st && st.b > 100 && st.refs > 0) break;
  }
  const pages = await ev(`window.PDFViewerApplication.pagesCount`);

  // Walk every page so each renders + processes, then probe.
  const perPage = [];
  for (let p = 1; p <= pages; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`);
    await sleep(1600);
    const res = await ev(PROBE).catch((e) => ({ error: String(e) }));
    if (Array.isArray(res)) {
      const cur = res.find((r) => r.page === p);
      if (cur) perPage.push(cur);
    }
  }

  // Aggregate.
  const sum = (k) => perPage.reduce((a, r) => a + (r[k] || 0), 0);
  const totals = {
    pages: perPage.length,
    whiteout: sum("whiteout"), peek: sum("peek"), fontBad: sum("fontBad"),
    skipRun: sum("skipRun"), citeGapN: sum("citeGapN"), selBad: sum("selBad"),
    refColoredTotal: sum("refColored"), refHitsTotal: sum("refHits"),
    citeGapMax: Math.max(0, ...perPage.map((r) => r.citeGapMax || 0)),
    peekMax: Math.max(0, ...perPage.map((r) => r.peekMax || 0)),
  };

  console.log("page | done | mask | whiteout | peek(max) | fontBad | skipRun | citeGap(n,max) | refC/refHit | selBad");
  for (const r of perPage) {
    const flag = (r.whiteout || r.peek || r.fontBad || r.skipRun || r.citeGapN || r.selBad || (r.refColored && !r.refHits)) ? " *" : "";
    console.log(`${String(r.page).padStart(4)} | ${String(r.done).padStart(4)} | ${String(r.masks).padStart(4)} | ${String(r.whiteout).padStart(8)} | ${String(r.peek).padStart(3)}(${String(r.peekMax).padStart(4)}) | ${String(r.fontBad).padStart(7)} | ${String(r.skipRun).padStart(7)} | ${String(r.citeGapN).padStart(3)},${String(r.citeGapMax).padStart(5)} | ${String(r.refColored).padStart(3)}/${String(r.refHits).padStart(3)} | ${String(r.selBad).padStart(6)}${flag}`);
  }
  console.log("\nTOTALS:", JSON.stringify(totals));
  // Show a few concrete samples for the worst pages.
  for (const r of perPage) {
    if (r.whiteout) console.log(`  p${r.page} whiteout:`, JSON.stringify(r.whiteoutSamples));
    if (r.peek) console.log(`  p${r.page} peek:`, JSON.stringify(r.peekSamples));
    if (r.fontBad) console.log(`  p${r.page} font:`, JSON.stringify(r.fontSamples));
    if (r.skipRun) console.log(`  p${r.page} skipPara:`, JSON.stringify(r.skipSample));
    if (r.selBad) console.log(`  p${r.page} select:`, JSON.stringify(r.selSamples));
  }
  writeFileSync(join(root, "test", "out", `diag-${FILTER.replace(/\W+/g, "")}.json`), JSON.stringify({ totals, perPage }, null, 2));
  console.log(`\nsaved test/out/diag-${FILTER.replace(/\W+/g, "")}.json`);
} catch (e) {
  console.error("diagnose error:", e);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
