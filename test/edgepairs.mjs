// Targeted visual review: only the lines where the overlay usually goes wrong,
// as matched fx-on / fx-off strips on a few contact sheets per document.
//
// A whole-page review (pagepairs.mjs) costs a vision pass over every band of
// every page, and almost all of it is plain body text that has never been
// where a defect was. The defects live at the EDGES of what the engine
// decided: the first and last line of a section — the prose next to a
// heading — and of a caption, and the prose next to a table or equation (the
// block pass drew a boundary there), and every line kept on the canvas for
// the vector art on it. --column-edges adds each column's first
// and last line. This finds those lines from the
// engine's own classification (__fxDebug reasons), captures each as a strip
// with reading mode on and then off — pagepairs' settle and restore rules
// apply unchanged — and lays the pairs side by side, on | off, on sheets
// small enough to read at full resolution.
//
// Output: test/out/edges/<label>/sheet-NN.png and sheet-NN.txt (one row per
// strip: page, why it was picked, the words it must contain).
// Usage: node test/edgepairs.mjs --url=<pdf> --label=<name> [--zoom=1.0]
//        [--pages=A-B] [--rows=14] [--column-edges]
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { browserPath, extensionDir, outDir, profileDir, killBrowser, devtoolsPort } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url");
const LABEL = arg("label");
const ZOOM = parseFloat(arg("zoom", "1.0"));
const ROWS = Math.max(1, parseInt(arg("rows", "14"), 10));
const RANGE = arg("pages", "").split("-").map((n) => parseInt(n, 10));
// Also each column's first and last prose line (a column break mid-paragraph).
const COLUMN_EDGES = process.argv.includes("--column-edges");
if (!URL0 || !LABEL || !/^[A-Za-z0-9_-]+$/.test(LABEL)) {
  console.error("usage: node test/edgepairs.mjs --url=<pdf> --label=<name: letters, digits, _ or -> [--zoom=1.0] [--pages=A-B] [--rows=14]");
  process.exit(2);
}
const OUT = outDir(join("edges", LABEL));
let PORT = 0; // the free port the browser chose (lib/env.mjs devtoolsPort)
const userDataDir = profileDir("edges");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => {
  PORT ||= await devtoolsPort(userDataDir, launched);
  return (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
};

const launched = Date.now();
const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=0`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1600,2000",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

let cdp;
const ev = (expr, opts) => cdp.ev(expr, opts);

const counts = (page) => ev(`(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page - 1});
  if (!pv || !pv.textLayer || !pv.canvas) return "x";
  return pv.textLayer.div.querySelectorAll("span[data-fx-done]").length + "/" +
         pv.textLayer.div.querySelectorAll(".fx-b").length;
})()`).catch(() => "x");

/** This page's processed-span and emphasis counts, holding still (pagepairs.mjs). */
async function settleOn(page) {
  let last = "", stable = 0;
  for (let i = 0; i < 90; i++) {
    const cur = await counts(page);
    if (cur === last && cur !== "x") { if (++stable >= 8) return cur; } else { stable = 0; last = cur; }
    await sleep(500);
  }
  return `unsettled:${last}`;
}

// The page's edge strips, in page-relative CSS px, from the engine's reasons.
const STRIPS = (page) => `(() => {
  const COLUMN_EDGES = ${COLUMN_EDGES};
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page - 1});
  if (!pv?.textLayer) return null;
  const pr = pv.div.getBoundingClientRect();
  const W = pr.width;
  const kindOf = (s) => {
    const why = s.closest("[data-fx-why]")?.dataset.fxWhy || "";
    if (/^caption/.test(why)) return "caption";
    if (/^(line-head|runin|leadrun)/.test(why)) return "heading";
    if (s.closest("[data-fx-done]")) return "prose";
    if (/^(table|line-|row-eqn|fig-body)/.test(why)) return "block";
    return "other";
  };
  const lines = [];
  for (const s of pv.textLayer.div.querySelectorAll("span")) {
    if (s.classList.contains("endOfContent") || s.matches(".fx-cite-c, .fx-ref-c, .fx-sp, .fx-b")) continue;
    if (s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp):not(.fx-b)")) continue;
    const text = (s.textContent || "").trim();
    if (!text) continue;
    const r = s.getBoundingClientRect();
    const x0 = r.left - pr.left, x1 = r.right - pr.left, y0 = r.top - pr.top, y1 = r.bottom - pr.top;
    if (y1 < 0 || y0 > pr.height || r.height < 2) continue;
    // By the span's centre: a column's line can reach past the page middle.
    const col = x1 - x0 > W * 0.6 ? -1 : (x0 + x1) / 2 < W / 2 ? 0 : 1;
    const mid = (y0 + y1) / 2, h = y1 - y0;
    let line = lines.find((l) => l.col === col && Math.abs(l.mid - mid) < 0.5 * Math.min(h, l.h));
    if (!line) lines.push(line = { col, mid, h, x0, x1, y0, y1, kinds: {}, text: [] });
    line.x0 = Math.min(line.x0, x0); line.x1 = Math.max(line.x1, x1);
    line.y0 = Math.min(line.y0, y0); line.y1 = Math.max(line.y1, y1);
    const k = kindOf(s);
    line.kinds[k] = (line.kinds[k] || 0) + text.length;
    if (s.closest("[data-fx-why]")?.dataset.fxWhy === "vector-art") line.art = true;
    line.text.push(text);
  }
  for (const l of lines) {
    const k = l.kinds;
    l.kind = k.caption ? "caption" : k.heading ? "heading" :
      (k.prose || 0) >= Math.max(k.block || 0, k.other || 0) ? "prose" : (k.block ? "block" : "other");
  }
  const picked = [];
  for (const col of [0, 1, -1]) {
    const ls = lines.filter((l) => l.col === col).sort((a, b) => a.y0 - b.y0);
    if (!ls.length) continue;
    // The column's extent from its prose lines, so a stray wide line (a
    // heading number, a figure label) cannot widen every strip.
    const body = ls.filter((l) => l.kind === "prose");
    const edge = (v, q) => v.sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(q * v.length))];
    const cx0 = body.length ? edge(body.map((l) => l.x0), 0.1) : Math.min(...ls.map((l) => l.x0));
    const cx1 = body.length ? edge(body.map((l) => l.x1), 0.9) : Math.max(...ls.map((l) => l.x1));
    const mark = (l, why) => picked.push({ col, why, x0: cx0, x1: cx1, y0: l.y0 - 0.6 * l.h, y1: l.y1 + 0.6 * l.h, text: l.text.join(" ") });
    const prose = ls.filter((l) => l.kind === "prose");
    if (COLUMN_EDGES && prose.length) { mark(prose[0], "column-first"); mark(prose.at(-1), "column-last"); }
    // Every line the vector-art keep touched: the art must survive, and the
    // rest of the line must not look torn.
    for (const l of ls) if (l.art) mark(l, "vector-art");
    for (let i = 1; i < ls.length; i++) {
      const a = ls[i - 1], b = ls[i];
      // A line of kept inline spans ("other": small caps, math, a circled
      // number) is not a boundary the block pass drew.
      if (a.kind === b.kind || a.kind === "other" || b.kind === "other") continue;
      if (a.kind === "prose") mark(a, "before-" + b.kind);
      if (b.kind === "prose") mark(b, "after-" + a.kind);
      if (b.kind === "caption") mark(b, "caption-first");
      if (a.kind === "caption") mark(a, "caption-last");
    }
  }
  // Overlapping strips of one column become one.
  picked.sort((a, b) => a.col - b.col || a.y0 - b.y0);
  const out = [];
  for (const s of picked) {
    const last = out.at(-1);
    if (last && last.col === s.col && s.y0 <= last.y1) {
      last.y1 = Math.max(last.y1, s.y1);
      if (!last.why.includes(s.why)) last.why += "," + s.why;
      if (!last.text.includes(s.text)) last.text += " / " + s.text;
    } else out.push({ ...s });
  }
  return out.map((s) => ({ ...s, y0: Math.max(0, s.y0), y1: Math.min(pr.height, s.y1),
    x0: Math.max(0, s.x0 - 4), x1: Math.min(W, s.x1 + 4) }));
})()`;

/** Scroll the strip into view; its viewport clip at a 2x capture. */
const stripClip = (page, s) => ev(`(async () => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page - 1});
  const container = document.getElementById("viewerContainer");
  const c = container.getBoundingClientRect();
  const box = pv.div.getBoundingClientRect();
  container.scrollTop += box.top + ${s.y0} - c.top - 40;
  await new Promise((r) => setTimeout(r, 300));
  const b = pv.div.getBoundingClientRect();
  return { x: b.left + ${s.x0}, y: b.top + ${s.y0}, width: ${s.x1 - s.x0}, height: ${s.y1 - s.y0}, scale: 2 };
})()`);

const shoot = async (clip) => (await cdp.send("Page.captureScreenshot", { format: "png", clip }, 60000)).data;

// Rows of [label | on | off] onto one PNG, drawn in the page itself (no image
// library needed here).
const SHEET = (rows) => `(async () => {
  const load = (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: "image/png" }));
  const rows = ${JSON.stringify(rows)};
  const imgs = [];
  for (const r of rows) imgs.push([await load(r.on), await load(r.off)]);
  const LABEL_H = 22, GAP = 10, MID = 16;
  const w = Math.max(...imgs.map(([a, b]) => a.width + MID + b.width));
  const h = imgs.reduce((n, [a, b]) => n + LABEL_H + Math.max(a.height, b.height) + GAP, 0);
  const cv = new OffscreenCanvas(w, h);
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  let y = 0;
  rows.forEach((r, i) => {
    const [a, b] = imgs[i];
    g.fillStyle = "#06c"; g.font = "bold 16px sans-serif";
    g.fillText(r.tag + "   (left: fx-on, right: fx-off)", 4, y + 16);
    y += LABEL_H;
    g.drawImage(a, 0, y);
    g.fillStyle = "#f0a"; g.fillRect(a.width + MID / 2 - 1, y, 2, Math.max(a.height, b.height));
    g.drawImage(b, a.width + MID, y);
    y += Math.max(a.height, b.height) + GAP;
  });
  const blob = await cv.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
})()`;

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
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  await sleep(2500);
  const live = (await http("/json/list")).find((t) => t.id === tab.id) ?? tab;
  cdp = connect(live.webSocketDebuggerUrl, { where: "viewer", timeoutMs: 60000 });
  await cdp.ready;
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  let loaded = false;
  for (let i = 0; i < 40 && !loaded; i++) { loaded = await ev(`!!window.PDFViewerApplication?.pdfDocument`).catch(() => false); if (!loaded) await sleep(500); }
  if (!loaded) throw new Error("document never loaded");
  await ev(`(() => { const s = document.createElement("style");
    s.textContent = "#sidebarContainer{display:none!important}#outerContainer.sidebarOpen #viewerContainer{inset-inline-start:0!important}";
    document.head.appendChild(s); return true; })()`);
  // The reasons the strips are picked by exist only under __fxDebug; set it
  // before reading mode comes on so the first pass records them.
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: false }, r))`);
  await ev(`globalThis.__fxDebug = true`);
  await ev(`window.PDFViewerApplication.pdfViewer.currentScale = ${ZOOM}`);
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  await sleep(3000);

  const numPages = await ev(`window.PDFViewerApplication.pdfDocument.numPages`);
  const from = RANGE[0] || 1, to = Math.min(RANGE[1] || numPages, numPages);
  const rows = [];
  const unsettled = [];
  for (let p = from; p <= to; p++) {
    await ev(`(() => { window.PDFViewerApplication.page = ${p}; return true; })()`);
    await sleep(1200);
    const settled = await settleOn(p);
    if (settled.startsWith("unsettled")) unsettled.push(p);
    const strips = (await ev(STRIPS(p))) ?? [];
    for (const s of strips) {
      const clip = await stripClip(p, s);
      // Scrolling can bring a re-render into view: settle again only if the
      // page's counts moved (a full settle per strip took hours per corpus).
      if ((await counts(p)) !== settled) await settleOn(p);
      rows.push({ p, s, tag: `p${p} ${s.why}`, on: await shoot(clip) });
    }
    console.log(`p${p}: ${strips.length} strips, on ${settled}`);
  }

  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: false }, r))`);
  let restored = false;
  for (let i = 0; i < 60 && !restored; i++) {
    restored = await ev(`(() => document.querySelectorAll("[data-fx-done], .fx-b").length === 0 &&
      !document.querySelector("#viewerContainer.fx-on"))()`).catch(() => false);
    if (!restored) await sleep(500);
  }
  if (!restored) throw new Error("reading mode never restored — an fx-off half would be a copy of fx-on, not a control");
  let at = 0;
  for (const r of rows) {
    if (r.p !== at) {
      await ev(`(() => { window.PDFViewerApplication.page = ${r.p}; return true; })()`);
      await sleep(1200);
      at = r.p;
    }
    const clip = await stripClip(r.p, r.s);
    await sleep(700); // canvas repaint after scroll
    r.off = await shoot(clip);
  }

  mkdirSync(OUT, { recursive: true });
  let sheets = 0;
  for (let i = 0; i < rows.length; i += ROWS) {
    const chunk = rows.slice(i, i + ROWS);
    const name = `sheet-${String(++sheets).padStart(2, "0")}`;
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(await ev(SHEET(chunk), { ms: 120000 }), "base64"));
    writeFileSync(join(OUT, `${name}.txt`), chunk.map((r) => `${r.tag}: ${r.s.text.slice(0, 300)}`).join("\n") + "\n");
  }
  console.log(`${LABEL}: ${rows.length} strips on ${sheets} sheet(s), pages ${from}-${to}, zoom ${ZOOM}` +
    (unsettled.length ? ` — UNSETTLED p${unsettled.join(",p")}: do not judge those strips` : ""));
  if (unsettled.length) process.exitCode = 75;
  // Nothing captured is not a clean review: a document always has captions or
  // headings, so zero strips means the reasons were never recorded.
  if (!rows.length) throw new Error("no edge strip found — nothing was captured");
} catch (e) {
  // A capture that never happened must not read as success.
  console.error(`${LABEL} edgepairs error: ${e.message || e}`);
  process.exitCode = 1;
} finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
