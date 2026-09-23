// Why does a span's table-zone decision change with the zoom? tables.mjs
// reports THAT a span flips; this prints the inputs of the decision at each
// zoom, in page units (CSS px at 100%), so two zooms line up:
//   - the canvas rules the engine detected on the page (__fxRules), and which
//     of them the other zooms did not find;
//   - the zone lines the prose exemption judged (__fxZoneLines);
//   - every span containing --find: its rect, emphasis runs and skip reason.
// Each zoom is a fresh viewer tab with the zoom set before the engine is
// enabled — the standalone run tables.mjs measures.
// Usage: node test/diag-zones.mjs --url=<pdf> --page=N [--find=text] [--zooms=page-fit,1.0,1.8]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { browserPath, extensionDir, profileDir, killBrowser } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url");
const PAGE = parseInt(arg("page", "1"), 10);
const FIND = arg("find", "");
// --probe=x,y0,y1 (page units): the base canvas's ink (255 - luminance) down
// that column, per device row — what the rule scanner thresholds.
const PROBE = arg("probe", "").split(",").map(Number);
const ZOOMS = arg("zooms", "page-fit,1.0,1.8").split(",").map((z) => z.trim()).filter(Boolean);
if (!URL0 || !(PAGE >= 1)) {
  console.error("usage: node test/diag-zones.mjs --url=<pdf> --page=N [--find=text] [--zooms=page-fit,1.0,1.8]");
  process.exit(2);
}
const PORT = 18700 + (process.pid % 200);
const userDataDir = profileDir(`zones-${PORT}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1300,1900",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

// Same "handled" test as tables.mjs: every prose leaf span processed or given
// a reason — read before that and the decision is not final.
const HANDLED = `(() => {
  const d = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1})?.textLayer?.div;
  if (!d) return null;
  let prose = 0, handled = 0;
  for (const s of d.querySelectorAll("span")) {
    if (s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")) continue;
    if (s.matches(".fx-cite-c, .fx-ref-c, .fx-sp")) continue;
    if (((s.textContent || "").match(/[a-z]{2,}/g) || []).length < 2) continue;
    prose++;
    if (s.closest("[data-fx-done], [data-fx-why], [data-fx-keep], [data-fx-table]")) handled++;
  }
  return { prose, handled };
})()`;

const READ = `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
  // The text layer's box, not the page div's (it carries a border), and its
  // real scale: the page is laid out to whole CSS px, not exactly at the zoom.
  const box = pv.textLayer.div.getBoundingClientRect(), z = box.width / (pv.viewport.width / (pv.scale || 1));
  const pu = (v, o) => Math.round(((v - o) / z) * 10) / 10;
  const passes = (globalThis.__fxRules || []).filter((e) => e.page === ${PAGE});
  const rules = passes.at(-1) ?? null;
  const history = passes.map((e) => e.rules.length + "@" + e.source).join(" ");
  const zl = (globalThis.__fxZoneLines || []).filter((e) => e.page === ${PAGE});
  const find = ${JSON.stringify(FIND)};
  const spans = [];
  if (find) for (const s of pv.textLayer.div.querySelectorAll("span")) {
    if (s.matches(".fx-cite-c,.fx-ref-c,.fx-sp") || s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")) continue;
    if (!s.textContent.includes(find)) continue;
    const r = s.getBoundingClientRect();
    // What overlaps it: leaf spans (with their own decision) and rules, as a
    // fraction of this span's area — the overlaps-skipped guard's input.
    const area = r.width * r.height, over = [];
    const frac = (o) => { const w = Math.min(r.right, o.right) - Math.max(r.left, o.left), h = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top); return w > 0 && h > 0 && area > 0 ? +(w * h / area).toFixed(2) : 0; };
    for (const o of pv.textLayer.div.querySelectorAll("span")) {
      if (o === s || o.contains(s) || s.contains(o) || o.matches(".fx-cite-c,.fx-ref-c,.fx-sp")) continue;
      const f = frac(o.getBoundingClientRect());
      if (f > 0.05) over.push("span " + JSON.stringify(o.textContent.slice(0, 12)) + " " + f + " " + (o.dataset.fxWhy || (o.hasAttribute("data-fx-done") ? "done" : "-")));
    }
    for (const q of rules?.rules ?? []) {
      const f = frac({ left: box.left + q[0] * z, top: box.top + q[1] * z, right: box.left + q[2] * z, bottom: box.top + q[3] * z });
      if (f > 0.05) over.push("rule " + q.join(",") + " " + f);
    }
    spans.push({ over, t: s.textContent.slice(0, 50), rect: [pu(r.left, box.left), pu(r.top, box.top), pu(r.right, box.left), pu(r.bottom, box.top)],
      fxb: s.querySelectorAll(".fx-b").length, done: s.hasAttribute("data-fx-done"), why: s.dataset.fxWhy || "" });
  }
  let probe = null;
  const P = ${JSON.stringify(PROBE)};
  if (P.length === 3 && P.every((v) => v >= 0)) {
    const c = pv.canvas, cr = c.getBoundingClientRect();
    const k = c.width / cr.width;
    const x = Math.round(P[0] * z * k), y0 = Math.floor(P[1] * z * k), y1 = Math.ceil(P[2] * z * k);
    const g = c.getContext("2d").getImageData(x, y0, 1, y1 - y0).data;
    probe = [];
    for (let i = 0; i < g.length; i += 4) probe.push(g[i + 3] > 40 ? Math.round(255 - (0.299 * g[i] + 0.587 * g[i + 1] + 0.114 * g[i + 2])) : 0);
    probe = { devPxPerPageUnit: +(k * z).toFixed(2), y0dev: y0, ink: probe.join(" ") };
  }
  const cr0 = pv.canvas.getBoundingClientRect();
  const tl = pv.textLayer.div.getBoundingClientRect();
  const dims = { textLayer: [+(tl.left - cr0.left).toFixed(1), +tl.width.toFixed(1), +tl.height.toFixed(1)], canvasH: +cr0.height.toFixed(1), canvasCss: +cr0.width.toFixed(1), divCss: +box.width.toFixed(1), viewport: +pv.viewport.width.toFixed(1), canvasPx: pv.canvas.width };
  return { dims, scale: z, rules, history, zoneLines: zl, spans, probe };
})()`;

let cdp;
const ev = (expr) => cdp.ev(expr);
const results = [];
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
  for (const zoom of ZOOMS) {
    const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
    cdp = connect(tab.webSocketDebuggerUrl, { where: "viewer", timeoutMs: 90000 });
    await cdp.ready;
    await cdp.send("Page.enable");
    await sleep(2500);
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { ok = await ev(`!!window.PDFViewerApplication?.pdfDocument`).catch(() => false); if (!ok) await sleep(500); }
    if (!ok) throw new Error("viewer never loaded");
    await ev(`globalThis.__fxDebug = true`);
    await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:false},r))`);
    await ev(`window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(zoom)}`);
    await sleep(1500);
    await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`);
    await ev(`window.PDFViewerApplication.page = ${PAGE}`);
    let st = null;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      st = await ev(HANDLED);
      if (st && (st.prose < 3 || st.handled === st.prose)) break;
    }
    await sleep(3000); // a detail-canvas re-process can still follow
    const r = await ev(READ);
    results.push({ zoom, ...r, handled: st });
    await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:false},r))`).catch(() => {});
    cdp.close();
    try { await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); } catch {}
    await sleep(500);
  }

  const key = (q) => q.map((v) => Math.round(v)).join(",");
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
  for (const r of results) {
    console.log(`\n== zoom ${r.zoom} (scale ${(+r.scale).toFixed(3)}, rules from ${r.rules?.source ?? "?"}) handled ${JSON.stringify(r.handled)}`);
    console.log(`rule passes (rules@source): ${r.history}  dims ${JSON.stringify(r.dims)}`);
    if (r.probe) console.log(`probe (dev px/page px ${r.probe.devPxPerPageUnit}, from dev y ${r.probe.y0dev}): ${r.probe.ink}`);
    const mine = r.rules?.rules ?? [];
    const others = results.filter((o) => o !== r).map((o) => o.rules?.rules ?? []);
    if (process.argv.includes("--all")) for (const q of mine) console.log(`   rule [${key(q)}]`);
    const only = mine.filter((q) => others.some((o) => !o.some((p) => near(p, q))));
    console.log(`rules: ${mine.length}; missing at some other zoom: ${only.length}`);
    for (const q of only.slice(0, 30)) console.log(`   [${key(q)}]  w=${Math.round(q[2] - q[0])} h=${(q[3] - q[1]).toFixed(1)}`);
    for (const s of r.spans) console.log(`span "${s.t}" rect=[${key(s.rect)}] fx-b=${s.fxb} done=${s.done} why=${s.why}`);
    for (const s of r.spans) for (const o of s.over) console.log(`   overlaps ${o}`);
    if (FIND) {
      for (const l of r.zoneLines.filter((l) => process.argv.includes("--all") || l.t.includes(FIND)).slice(-40)) console.log(`   zoneLine z${l.zi} k${l.lineKey} lw=${l.lw} exempt=${l.exempt} clear=${l.clear} w=${l.w}/${l.zw} gaps=${l.gapTop}/${l.gapBot} h=${l.lineH} "${l.t}"`);
    }
  }
} catch (e) {
  console.error(`diag-zones error: ${e.message || e}`);
  process.exitCode = 1;
} finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
