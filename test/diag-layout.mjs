// The layout model option, measured: open a paper with the option ON, let
// the engine process the first pages, and print per page the model's time,
// the execution provider it ran on, and the regions it found (class, score,
// box in page px), plus the spans those regions kept (reason `region-*`).
// A run with the runtime or model missing prints `model: unavailable` for
// every page and exits 2, so an "all clear" cannot come from an absent model.
// Usage: node test/diag-layout.mjs --url=<pdf> [--pages=N] [--label=name]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { browserPath, devtoolsPort, extensionDir, killBrowser, profileDir } from "./lib/env.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url", "");
const PAGES = parseInt(arg("pages", "6"), 10);
const LABEL = arg("label", "doc");
if (!URL0) { console.error("need --url="); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const udd = profileDir("diaglayout");
const since = Date.now();
const browser = spawn(browserPath("edge"), [
  "--remote-debugging-port=0", "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-sync", "--window-size=1400,2000", `--user-data-dir=${udd}`,
  `--load-extension=${extensionDir}`, `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

let code = 0;
try {
  const port = await devtoolsPort(udd, since);
  const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${port}${p}`, { method: m })).json();
  let extId = null;
  for (let i = 0; i < 100 && !extId; i++) { const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  // The front tab: a target opened here sits behind about:blank, hidden,
  // and the overlay applies a settings change only once the page is visible
  // — the option set below never reached the engine (R55).
  await fetch(`http://127.0.0.1:${port}/json/activate/${tab.id}`).catch(() => {});
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result.value; };
  const docLoaded = async () => { for (let i = 0; i < 80 && !(await ev("!!window.PDFViewerApplication?.pdfDocument").catch(() => false)); i++) await sleep(250); };
  await docLoaded();
  // The option and the debug flag must be in place BEFORE a page's first
  // baseline render, which records the model's result only under the
  // flag: set both, arm the flag for the next document, and reload.
  await ev("new Promise((r) => chrome.storage.sync.set({ enabled: true, layoutModel: true }, r))");
  await send("Page.enable");
  // --provider=wasm|webgpu|webnn forces one execution provider (layout-model.mjs).
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__fxDebug = true; globalThis.__fxLayoutProvider = ${JSON.stringify(arg("provider", null))};` });
  await send("Page.reload", { ignoreCache: false });
  await sleep(1000);
  await docLoaded();
  await ev("globalThis.__fxDebug = true; 1");
  const numPages = Math.min(PAGES, await ev("PDFViewerApplication.pagesCount"));
  let unavailable = 0;
  for (let page = 1; page <= numPages; page++) {
    await ev(`PDFViewerApplication.page = ${page}; 1`);
    let last = -1, stable = 0;
    for (let i = 0; i < 80 && stable < 4; i++) { await sleep(500); const c = await ev(`document.querySelectorAll('.page[data-page-number="${page}"] span[data-fx-done]').length`); stable = c === last && c > 0 ? stable + 1 : 0; last = c; }
    const rec = JSON.parse(await ev(`JSON.stringify((globalThis.__fxLayout || []).find((r) => r.page === ${page}) || null)`));
    const kept = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.page[data-page-number="${page}"] .textLayer span[data-fx-why^="region-"]')].reduce((m, s) => { m[s.dataset.fxWhy] = (m[s.dataset.fxWhy] || 0) + 1; return m; }, {}))`));
    if (!rec || rec.regions === null) { unavailable++; console.log(`${LABEL} p${page}: model: unavailable${rec?.error ? ` — ${rec.error}` : ""}`); continue; }
    console.log(`${LABEL} p${page}: ${rec.ms?.toFixed(0)} ms on ${rec.provider}, ${rec.regions.length} region(s) kept ${JSON.stringify(kept)}`);
    for (const r of rec.regions) console.log(`   ${r.cls.padEnd(14)} ${r.score.toFixed(2)}  [${Math.round(r.x0)}, ${Math.round(r.y0)}, ${Math.round(r.x1)}, ${Math.round(r.y1)}]`);
  }
  if (unavailable === numPages) {
    // Say why: the baseline outcomes (the worker's reply or its failure), the
    // layout entries as they are, and the settings the page holds.
    await sleep(6000);
    const state = await ev(`(async () => JSON.stringify({ layout: globalThis.__fxLayout ?? null, baseline: (globalThis.__fxBaseline ?? []).map((b) => [b.page, b.outcome, b.rules]), settings: await new Promise((r) => chrome.storage.sync.get(null, r)) }))()`).catch((e) => `state unavailable: ${e.message}`);
    console.error(`state: ${String(state).slice(0, 1500)}`);
    console.error("the model was unavailable on every page — nothing measured (npm run fetch-layout)"); code = 2;
  }
  ws.close();
} catch (e) {
  console.error("diag-layout error:", e.message || e);
  code = 1;
} finally {
  killBrowser(browser);
  await sleep(500);
  try { rmSync(udd, { recursive: true, force: true }); } catch {}
}
process.exit(code);
