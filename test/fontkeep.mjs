// Invariant guard: a span set in a math, monospace, small-caps or bold-display
// face is NEVER processed. REQUIREMENTS.md states it (the "kept on canvas +
// obstacle" rows); nothing checked it, so "emphasis inside a code span" could
// only ever be argued about from screenshots — and it was, five times in one
// gate, wrongly every time. The tokens carrying emphasis in those papers were
// set in the BODY face, where the engine has no signal that they are code.
//
// Reads the font off the PROCESSED SPAN itself: #fontFamilyFor writes the
// item's own PDF.js fontName as the span's first CSS family, which resolves
// through commonObjs to the real font name — the same string the engine's own
// filter tests. No span<->item index alignment, which is what made an earlier
// version of this check inconclusive on 7 of 31 pages: PDF.js does not always
// emit one span per text item, and a mapping by DOM order degrades silently.
//
// Note the font id is read UNQUOTED: the engine writes it quoted, but CSSOM
// serializes a valid custom ident without quotes, so a pattern anchored on a
// quote matches nothing and every page reports a clean zero.
//
// Fails the run (exit 1) on any violation, and ALSO when it resolved no fonts
// at all — a check that reads zero because it is blind is worse than no check.
//
// Usage: node test/fontkeep.mjs --url=<pdf> [--label=name] [--page=N | --all]
import { spawn } from "node:child_process";
import { appendFileSync, rmSync } from "node:fs";
import { browserPath, extensionDir, profileDir } from "./lib/env.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url"), LABEL = arg("label", "doc"), PAGE = parseInt(arg("page", "6"), 10), ZOOM = arg("zoom", "1.8");
const HEIGHT = arg("height", "2400");
const ALL = process.argv.includes("--all");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 11400 + (process.pid % 300);
const userDataDir = profileDir(`privprobe-${PORT}`);
const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-sync", `--window-size=2600,${HEIGHT}`, `--user-data-dir=${userDataDir}`,
  `--load-extension=${extensionDir}`, `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
let ws, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id !== id) return;
    ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); };
  ws.addEventListener("message", h); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300));
  return r.result.value;
};
try {
  for (let i = 0; i < 60; i++) { try { await http("/json/version"); break; } catch { await sleep(400); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(400);
  }
  const tab = await http(`/json/new?${`chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`}`, "PUT");
  await sleep(2500);
  const live = (await http("/json/list")).find((t) => t.id === tab.id) ?? tab;
  ws = new WebSocket(live.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  for (let i = 0; i < 40; i++) { if (await ev(`!!(window.PDFViewerApplication?.pdfDocument)`).catch(() => false)) break; await sleep(500); }
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  await ev(`(() => { const s = document.createElement("style");
    s.textContent = "#sidebarContainer{display:none!important}#outerContainer.sidebarOpen #viewerContainer{inset-inline-start:0!important}";
    document.head.appendChild(s); return true; })()`);
  await ev(`(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)}; return true; })()`);
  await ev(`(() => { window.PDFViewerApplication.page = ${PAGE}; return true; })()`);
  await sleep(4000);
  // REQUIREMENTS.md lines 47-49: a span in a math, monospace, small-caps or
  // bold-display face is NEVER processed - it stays on the canvas as a mask
  // obstacle. Read the font off the PROCESSED SPAN itself: #fontFamilyFor writes
  // the item's own PDF.js fontName as the first family, so the span carries the
  // id needed to resolve its real name through commonObjs - the same string the
  // engine's own filter tests.
  //
  // No span<->item index alignment, which is what left the earlier version of
  // this check inconclusive on 7 of 31 pages. Note the id is read UNQUOTED:
  // the engine writes it quoted but CSSOM serializes a valid custom ident
  // without quotes, so a regex anchored on a quote matches nothing at all.
  const probe = (page) => ev(`(async () => {
    const mod = await import(chrome.runtime.getURL("viewer/typography/engine.mjs"));
    const SPECIAL = mod.SPECIAL_FONT;
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page} - 1);
    if (!pv || !pv.textLayer) return null;
    const pdfPage = pv.pdfPage;
    const cache = new Map();
    const nameOf = (id) => {
      if (!cache.has(id)) {
        let n = "";
        try { n = pdfPage.commonObjs.get(id)?.name ?? ""; } catch { n = ""; }
        cache.set(id, n);
      }
      return cache.get(id);
    };
    const done = [...pv.textLayer.div.querySelectorAll("span[data-fx-done]")];
    let resolved = 0, unresolved = 0, violations = 0;
    const bad = [];
    for (const span of done) {
      const id = (span.style.fontFamily || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
      const real = id ? nameOf(id) : "";
      if (!real) { unresolved++; continue; }
      resolved++;
      if (SPECIAL.test(real)) {
        violations++;
        if (bad.length < 6) bad.push({ text: (span.textContent || "").trim().slice(0, 22), font: real });
      }
    }
    return { page: ${page}, processedSpans: done.length, resolved, unresolved, violations, bad };
  })()`);

  const settle = async (page) => {
    let last = "";
    let stable = 0;
    for (let i = 0; i < 60; i++) {
      const cur = await ev(`(() => {
        const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page} - 1);
        if (!pv || !pv.textLayer) return "0/0";
        return pv.textLayer.div.querySelectorAll("span[data-fx-done]").length + "/" +
               pv.textLayer.div.querySelectorAll(".fx-b").length;
      })()`).catch(() => "x");
      if (cur === last) { if (++stable >= 5) return; } else { stable = 0; last = cur; }
      await sleep(400);
    }
  };

  const pages = ALL ? await ev(`window.PDFViewerApplication.pdfDocument.numPages`) : null;
  const results = [];
  for (const pg of ALL ? Array.from({ length: pages }, (_, i) => i + 1) : [PAGE]) {
    await ev(`(() => { window.PDFViewerApplication.page = ${pg}; return true; })()`);
    await sleep(700);
    await settle(pg);
    const r = await probe(pg);
    if (r) results.push(r);
  }
  const totals = results.reduce((a, r) => ({
    processedSpans: a.processedSpans + r.processedSpans,
    resolved: a.resolved + r.resolved,
    unresolved: a.unresolved + r.unresolved,
    violations: a.violations + r.violations,
  }), { processedSpans: 0, resolved: 0, unresolved: 0, violations: 0 });
  const offenders = results.filter((r) => r.violations);
  console.log(`TOTALS: ${JSON.stringify({ pages: results.length, ...totals })}`);
  for (const r of offenders) console.log(`  p${r.page} violations=${r.violations} ${JSON.stringify(r.bad)}`);
  if (totals.violations) {
    console.log(`  FAIL ${totals.violations} processed span(s) set in a kept face`);
    process.exitCode = 1;
  } else if (!totals.resolved) {
    // The blind-check guard: no resolved fonts means nothing was compared.
    console.log("  FAIL resolved no font names — the check proved nothing");
    process.exitCode = 1;
  }
  const report = { pages: results.length, ...totals };
  const line = `${LABEL} ${JSON.stringify(report)}`;
  console.log(line);
  appendFileSync("test/out/fontkeep.log", line + String.fromCharCode(10));
} catch (e) { console.error(`${LABEL} probe error: ${e.message || e}`); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} process.exit(process.exitCode ?? 0); }
