// Where does the time go when reading mode is switched on? One document at
// one zoom: the viewer settles with reading mode OFF, then the V8 CPU profiler
// and the page's task metrics record switching it ON until every rendered
// page is processed. Prints wall time, main-thread task/script/layout time
// from Performance.getMetrics, and the functions with the most SELF time —
// so an optimization starts from a measurement, not a guess.
// --cold: instead, every page's FIRST pass: reading mode switched on over a
// viewer that has never processed anything, then --pages pages scrolled at
// 1.2 s each — what a reader pays opening a paper and reading it.
// --dpr=N: the display's device pixel ratio (a real screen is often 1.5-2.5).
// --off (with --cold): the same scroll with reading mode left OFF — the
// stock viewer's cost, so ON minus OFF is what reading mode adds. CPU is also
// reported for EVERY browser process (renderer, GPU, utility), not only the
// page's main thread: "the whole machine slows down" is those processes.
// Usage: node test/diag-perf.mjs --url=<pdf> [--label=name] [--zoom=page-fit] [--top=25]
//        [--cold [--pages=8]] [--dpr=2]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { browserPath, extensionDir, profileDir, killBrowser, devtoolsPort } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url");
const LABEL = arg("label", "doc");
const ZOOM = arg("zoom", "page-fit");
const TOP = parseInt(arg("top", "25"), 10);
const COLD = process.argv.includes("--cold");
const PAGES = parseInt(arg("pages", "8"), 10);
const DPR = arg("dpr", "");
const OFF = process.argv.includes("--off");
// --phases (with --cold): __fxDebug on, and the engine's own per-page phase
// timings printed — which step of a page's pass blocks the main thread.
const PHASES = process.argv.includes("--phases");
// --trace (with --cold): a browser trace of the scroll, and every long task
// (> 50 ms) of the page's main thread broken down by what ran inside it —
// style recalculation, layout, paint, script — to see which one to cut.
const TRACE = process.argv.includes("--trace");
// --css=<rules>: extra CSS injected into the viewer before measuring — for
// asking what one style costs (e.g. the emphasis text-shadow). Never a gate.
const CSS = arg("css", "");
// --font=original|atkinson|inter|literata|lexend|source-serif-4 (with --cold):
// the reading font setting, set before the viewer opens.
const FONT = arg("font", "");
// --click: switch reading mode on with the viewer's own toolbar button, as a
// reader does, instead of writing the setting (the two took different paths).
const CLICK = process.argv.includes("--click");
// --headful: a real window on the real display (its own device pixel ratio and
// GPU) — headless canvases live in CPU memory, so a GPU readback stall, which
// is what a reader feels as the MOUSE slowing down, cannot show there.
const HEADFUL = process.argv.includes("--headful");
// --switch-font=<mode>: with reading mode on and settled, switch the reading
// font and measure the re-process of every rendered page it causes.
const SWITCH = arg("switch-font", "");
const ENABLE = CLICK
  ? `(() => { document.getElementById("fxToggleButton").click(); return true; })()`
  : `new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`;
/** Cumulative CPU seconds per browser process type (browser-level CDP). */
async function processCpu() {
  const v = await http("/json/version");
  const b = connect(v.webSocketDebuggerUrl, { where: "browser" });
  await b.ready;
  const { processInfo } = await b.send("SystemInfo.getProcessInfo");
  b.close();
  const out = {};
  for (const p of processInfo) out[p.type] = (out[p.type] || 0) + p.cpuTime;
  return out;
}
if (!URL0) {
  console.error("usage: node test/diag-perf.mjs --url=<pdf> [--label=name] [--zoom=page-fit] [--top=25]");
  process.exit(2);
}
let PORT = 0; // the free port the browser chose (lib/env.mjs devtoolsPort)
const userDataDir = profileDir("perf");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => {
  PORT ||= await devtoolsPort(userDataDir, launched);
  return (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
};

const launched = Date.now();
const browser = spawn(browserPath("edge"), [
  "--remote-debugging-port=0", ...(HEADFUL ? [] : ["--headless=new"]), "--no-first-run",
  ...(DPR ? [`--force-device-scale-factor=${DPR}`] : []),
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

// Every rendered page processed: each page with a text layer has its prose
// processed or given a reason — and no page is waiting on the engine.
const DONE = `(() => {
  const v = window.PDFViewerApplication.pdfViewer;
  let pages = 0, open = 0;
  for (let i = 0; i < v.pagesCount; i++) {
    const d = v.getPageView(i)?.textLayer?.div;
    if (!d?.childElementCount) continue;
    pages++;
    let prose = 0, handled = 0;
    for (const s of d.querySelectorAll("span")) {
      if (s.matches(".fx-cite-c, .fx-ref-c, .fx-sp") || s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")) continue;
      if (((s.textContent || "").match(/[a-z]{2,}/g) || []).length < 2) continue;
      prose++;
      if (s.closest("[data-fx-done], [data-fx-keep], [data-fx-table]")) handled++;
    }
    if (prose >= 3 && handled === 0) open++;
  }
  return { pages, open, bolded: document.querySelectorAll(".textLayer .fx-b").length };
})()`;

// Frame gaps — the longest interval between animation frames, a stall the
// reader sees and feels as the pointer lagging over the page — and the
// engine's canvas readbacks (__fxDebug) during the measured interval.
const STALLS_START = `(() => { globalThis.__fxGaps = []; let last = performance.now();
  const tick = (t) => { globalThis.__fxGaps.push(t - last); last = t; if (globalThis.__fxGaps.length < 5000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick); globalThis.__fxPerf = true; globalThis.__fxReadbacks = []; return true; })()`;
async function printStalls() {
  const fx = await ev(`(() => { const g = globalThis.__fxGaps || [], r = globalThis.__fxReadbacks || [];
    return { frames: g.length, worst: Math.max(0, ...g), over50: g.filter((x) => x > 50).length, over100: g.filter((x) => x > 100).length,
      readbacks: r.length, readMs: r.reduce((a, b) => a + b.ms, 0), readMax: Math.max(0, ...r.map((b) => b.ms)), readMpx: r.reduce((a, b) => a + b.px, 0) / 1e6,
      dpr: devicePixelRatio, parity: (globalThis.__fxPixelParity || []) }; })()`);
  if (fx.parity.length) console.log(`  worker pixels vs direct readback: ${fx.parity.length} reads, ${fx.parity.filter((n) => n !== 0).length} differing`);
  console.log(`  frames ${fx.frames}, worst gap ${fx.worst.toFixed(0)} ms, gaps > 50 ms: ${fx.over50}, > 100 ms: ${fx.over100}; canvas readbacks ${fx.readbacks}: ${fx.readMs} ms total, worst ${fx.readMax} ms, ${fx.readMpx.toFixed(1)} Mpx; devicePixelRatio ${fx.dpr}`);
}

let cdp;
let onViewerEvent = () => {}; // set once there is something to listen for (--trace)
const ev = (expr, opts) => cdp.ev(expr, opts);
const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
try {
  let extId = null;
  for (let i = 0; i < 80 && !extId; i++) {
    try {
      const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
      if (sw) extId = new URL(sw.url).hostname;
    } catch { /* not up yet */ }
    if (!extId) await sleep(300);
  }
  if (!extId) throw new Error("extension did not load");
  if (COLD) {
    // Reading mode OFF before the viewer exists (set from the extension's own
    // popup page), so switching it on below is every page's FIRST pass —
    // baseline rule renders and all — and the profiler is already running.
    const pop = await http(`/json/new?chrome-extension://${extId}/popup/popup.html`, "PUT");
    const pc = connect(pop.webSocketDebuggerUrl, { where: "popup" });
    await pc.ready;
    for (let i = 0; i < 20; i++) { if (await pc.ev(`typeof chrome !== "undefined" && !!chrome.storage`).catch(() => false)) break; await sleep(250); }
    await pc.ev(`new Promise((r) => chrome.storage.sync.set(${JSON.stringify(FONT ? { enabled: false, fontMode: FONT } : { enabled: false })}, r))`);
    pc.close();
    try { await fetch(`http://127.0.0.1:${PORT}/json/close/${pop.id}`); } catch {}
    const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
    cdp = connect(tab.webSocketDebuggerUrl, { where: "viewer", timeoutMs: 120000, onEvent: (m) => onViewerEvent(m) });
    await cdp.ready;
    await cdp.send("Page.enable");
    let ok = false;
    for (let i = 0; i < 80 && !ok; i++) { await sleep(250); ok = await ev(`!!window.PDFViewerApplication?.pdfDocument`).catch(() => false); }
    if (!ok) throw new Error("viewer never loaded");
    await ev(`window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)}`);
    if (PHASES) await ev(`(() => { globalThis.__fxDebug = true; return true; })()`);
    if (CSS) await ev(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(CSS)}; document.head.appendChild(s); return true; })()`);
    await sleep(6000);
    await cdp.send("Performance.enable");
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    const m0 = await metrics();
    const c0 = await processCpu();
    // Long main-thread tasks (> 50 ms) while scrolling: what the reader feels.
    await ev(`(() => { globalThis.__fxLong = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) globalThis.__fxLong.push(e.duration); }).observe({ type: "longtask" }); return true; })()`);
    const traceEvents = [];
    let traced = null;
    if (TRACE) {
      onViewerEvent = (m) => {
        if (m.method === "Tracing.dataCollected") traceEvents.push(...m.params.value);
        if (m.method === "Tracing.tracingComplete") traced?.();
      };
      await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline", transferMode: "ReportEvents" });
    }
    await ev(STALLS_START);
    await cdp.send("Profiler.start");
    const t0 = Date.now();
    if (!OFF) await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`);
    let firstMs = null;
    const n = Math.min(PAGES, await ev(`window.PDFViewerApplication.pagesCount`));
    for (let p = 1; p <= n; p++) {
      await ev(`window.PDFViewerApplication.page = ${p}`);
      for (let i = 0; i < 12; i++) {
        await sleep(100);
        if (firstMs === null && (await ev(`document.querySelectorAll(".textLayer .fx-b").length`)) > 0) firstMs = Date.now() - t0;
      }
    }
    await sleep(2000);
    const { profile } = await cdp.send("Profiler.stop");
    const m1 = await metrics();
    const c1 = await processCpu();
    if (TRACE) {
      const done = new Promise((r) => (traced = r));
      await cdp.send("Tracing.end");
      await done;
      summarizeTrace(traceEvents);
    }
    const cpu = Object.keys(c1).map((k) => `${k} ${((c1[k] - (c0[k] || 0)) * 1000).toFixed(0)} ms`).join(", ");
    console.log(`  browser CPU by process: ${cpu}`);
    if (PHASES) {
      for (const t of await ev(`globalThis.__fxTiming || []`)) {
        const c = t.chunks;
        console.log(`  p${String(t.page).padStart(2)}: classify ${t.classify} ms, obstacles ${t.obstacles} ms, ${c.length} chunks (max ${Math.max(0, ...c)} ms, sum ${c.reduce((a, b) => a + b, 0)} ms), wall ${t.total} ms`);
      }
    }
    await printStalls();
    const long = await ev(`globalThis.__fxLong`);
    console.log(`  long tasks: ${long.length}, ${long.reduce((a, b) => a + b, 0).toFixed(0)} ms total, longest ${Math.max(0, ...long).toFixed(0)} ms`);
    report(profile, m0, m1, `${LABEL}: COLD${OFF ? " (reading mode OFF)" : ""}${FONT ? `, font ${FONT}` : ""}, zoom ${ZOOM}${DPR ? `, dpr ${DPR}` : ""}, ${n} pages scrolled; first emphasis ${firstMs} ms, wall ${Date.now() - t0} ms`);
    throw null; // done: skip the toggle measurement below
  }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  cdp = connect(tab.webSocketDebuggerUrl, { where: "viewer", timeoutMs: 120000 });
  await cdp.ready;
  await cdp.send("Page.enable");
  await sleep(2500);
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { ok = await ev(`!!window.PDFViewerApplication?.pdfDocument`).catch(() => false); if (!ok) await sleep(500); }
  if (!ok) throw new Error("viewer never loaded");
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:false},r))`);
  await ev(`window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)}`);
  await sleep(6000); // canvases painted, reading mode off
  await cdp.send("Performance.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  const m0 = await metrics();
  await cdp.send("Profiler.start");
  if (SWITCH) {
    // Reading mode on and settled first; what is measured is the font change.
    await ev(ENABLE);
    for (let i = 0; i < 100; i++) { await sleep(100); const d = await ev(DONE); if (d.pages && d.open === 0 && d.bolded > 0) break; }
    await sleep(3000);
  }
  await ev(STALLS_START);
  const t0 = Date.now();
  await ev(SWITCH ? `new Promise((r)=>chrome.storage.sync.set({ fontMode: ${JSON.stringify(SWITCH)} },r))` : ENABLE);
  let st = null, firstMs = null;
  for (let i = 0; i < 600; i++) {
    await sleep(100);
    st = await ev(DONE);
    if (firstMs === null && st.bolded > 0) firstMs = Date.now() - t0;
    if (st.pages && st.open === 0 && st.bolded > 0) break;
  }
  const doneMs = Date.now() - t0;
  // A font switch restores and re-processes pages that already count as
  // handled (skip reasons survive a restore), so give it a fixed window.
  await sleep(SWITCH ? 6000 : 1500); // work queued behind the last page (annotation, detail passes)
  const { profile } = await cdp.send("Profiler.stop");
  const m1 = await metrics();
  await printStalls();
  report(profile, m0, m1, `${LABEL}: zoom ${ZOOM}${DPR ? `, dpr ${DPR}` : ""}, ${st.pages} rendered pages; first emphasis ${firstMs} ms, all rendered pages processed ${doneMs} ms${CLICK ? " (toolbar button)" : ""}${SWITCH ? ` — FONT SWITCH to ${SWITCH}` : ""}`);
} catch (e) {
  if (e !== null) {
    console.error(`${LABEL} diag-perf error: ${e?.message || e}`);
    process.exitCode = 1;
  }
} finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}

/** Wall/metrics summary and the functions with the most self time. */
function report(profile, m0, m1, head) {
  const d = (k) => ((m1[k] ?? 0) - (m0[k] ?? 0)) * 1000;

  // Self time per function, from the sampled profile.
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    const cf = n.callFrame;
    const file = (cf.url || "").split("/").pop() || "(native)";
    const key = `${cf.functionName || "(anonymous)"}  ${file}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log(head);
  console.log(`  main thread: task ${d("TaskDuration").toFixed(0)} ms, script ${d("ScriptDuration").toFixed(0)} ms, layout ${d("LayoutDuration").toFixed(0)} ms, style ${d("RecalcStyleDuration").toFixed(0)} ms (${d("LayoutCount").toFixed(0) / 1000} layouts)`);
  console.log(`  profile: ${total.toFixed(0)} ms sampled; top self time:`);
  for (const [k, ms] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    console.log(`   ${ms.toFixed(0).padStart(6)} ms  ${(100 * ms / total).toFixed(1).padStart(5)}%  ${k}`);
  }
}

/** Long main-thread tasks of the viewer page, split by the work inside them. */
function summarizeTrace(events) {
  const main = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain" &&
    events.some((x) => x.pid === e.pid && x.name === "RunTask" && x.dur > 50000));
  if (!main) { console.log("  trace: no renderer main thread found"); return; }
  const onMain = events.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === "X");
  const tasks = onMain.filter((e) => e.name === "RunTask" && e.dur > 50000);
  const KIND = { UpdateLayoutTree: "style", Layout: "layout", Paint: "paint", PrePaint: "paint", Layerize: "paint",
    FunctionCall: "script", EvaluateScript: "script", TimerFire: "script", FireIdleCallback: "script", FireAnimationFrame: "script",
    "v8.compile": "script", GCEvent: "gc", MinorGC: "gc", MajorGC: "gc", ParseHTML: "parse", HitTest: "hit-test" };
  const total = {};
  for (const t of tasks) {
    const inside = onMain.filter((e) => e !== t && e.ts >= t.ts && e.ts + (e.dur || 0) <= t.ts + t.dur && KIND[e.name]);
    const per = {};
    for (const e of inside) per[KIND[e.name]] = (per[KIND[e.name]] || 0) + (e.dur || 0) / 1000;
    for (const [k, v] of Object.entries(per)) total[k] = (total[k] || 0) + v;
  }
  const sum = tasks.reduce((a, t) => a + t.dur / 1000, 0);
  console.log(`  trace: ${tasks.length} long tasks, ${sum.toFixed(0)} ms; inside them (inclusive, can overlap): ` +
    Object.entries(total).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)} ms`).join(", "));
  const top = [...tasks].sort((a, b) => b.dur - a.dur).slice(0, 5);
  for (const t of top) {
    const inside = onMain.filter((e) => e !== t && e.ts >= t.ts && e.ts + (e.dur || 0) <= t.ts + t.dur);
    const byName = {};
    for (const e of inside) if (e.dur > 2000) byName[e.name] = (byName[e.name] || 0) + e.dur / 1000;
    console.log(`   ${(t.dur / 1000).toFixed(0)} ms: ` + Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", "));
  }
}
