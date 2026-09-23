// Release-gate step 4's captures: EVERY page of a document as matched fx-on /
// fx-off pairs, for inspection by eye (Claude vision — never OCR).
//
// shot-region2.mjs is the matched-pair harness for one region; a full-document
// sweep with it would toggle reading mode per region, and turning it off is a
// document-wide restore. So this walks the document twice at one fixed zoom —
// every page with reading mode ON, then every page with it OFF — and captures
// the same page bands both times. Nothing about the layout depends on reading
// mode, so a band's two images differ only by what the overlay did to it.
//
// What makes a pair trustworthy, each learned the hard way (CLAUDE.md, step 4):
//  - the fx-on shot is taken only after THIS page's `data-fx-done` and `.fx-b`
//    counts hold still — a half-processed frame invents "missing emphasis";
//  - the fx-off half is taken only after the restore is OBSERVABLE (no
//    processed span, no emphasis run, no fx-on class) — otherwise it is a copy
//    of the fx-on half and every comparison passes;
//  - the outline sidebar is forced hidden and each band is clipped to the page
//    rect, or part of the page never reaches the image;
//  - high zoom and a 2x capture, because emphasis is a hairline at 100%.
// Each band also gets the words it must contain, from the text layer, so a
// reviewer can tell a missing word from a hyphenated one.
//
// Output: test/out/pairs/<label>/pNN-bK-{on,off}.png, pNN-bK.txt, index.json.
// Usage: node test/pagepairs.mjs --url=<pdf> --label=<name> [--zoom=1.5]
//        [--bands=3] [--pages=A-B]
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { browserPath, extensionDir, outDir, profileDir, killBrowser } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url");
const LABEL = arg("label");
const ZOOM = parseFloat(arg("zoom", "1.5"));
const BANDS = Math.max(1, parseInt(arg("bands", "3"), 10));
const RANGE = arg("pages", "").split("-").map((n) => parseInt(n, 10));
if (!URL0 || !LABEL || !/^[A-Za-z0-9_-]+$/.test(LABEL)) {
  console.error("usage: node test/pagepairs.mjs --url=<pdf> --label=<name: letters, digits, _ or -> [--zoom=1.5] [--bands=3] [--pages=A-B]");
  process.exit(2);
}
const OUT = outDir(join("pairs", LABEL));
const PORT = 18300 + (process.pid % 300);
const userDataDir = profileDir(`pairs-${PORT}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1600,2000",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

let cdp;
const ev = (expr, opts) => cdp.ev(expr, opts);

/** This page's processed-span and emphasis counts, holding still. */
async function settleOn(page) {
  let last = "", stable = 0;
  for (let i = 0; i < 90; i++) {
    const cur = await ev(`(() => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page - 1});
      if (!pv || !pv.textLayer || !pv.canvas) return "x";
      return pv.textLayer.div.querySelectorAll("span[data-fx-done]").length + "/" +
             pv.textLayer.div.querySelectorAll(".fx-b").length;
    })()`).catch(() => "x");
    if (cur === last && cur !== "x") { if (++stable >= 8) return cur; } else { stable = 0; last = cur; }
    await sleep(500);
  }
  return `unsettled:${last}`;
}

/** Scroll band `k` of `page` into view and return its viewport clip (CSS px). */
async function bandClip(page, k) {
  return ev(`(async () => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page - 1});
    const box = pv.div.getBoundingClientRect();
    const h = box.height / ${BANDS};
    const container = document.getElementById("viewerContainer");
    // Relative to the CONTAINER's top, not the window's: the toolbar sits
    // above the container, and scrolling a band to window y=8 put its top
    // strip under the toolbar, so the capture photographed toolbar, not page.
    const c = container.getBoundingClientRect();
    container.scrollTop += box.top + ${k} * h - c.top - 8;
    await new Promise((r) => setTimeout(r, 400));
    const b = pv.div.getBoundingClientRect();
    const y = b.top + ${k} * h;
    return { x: b.left, y, width: b.width, height: Math.min(h, b.bottom - y, c.bottom - y), scale: 2 };
  })()`);
}

/** The words band `k` of `page` must contain, in reading order of the text layer. */
const bandText = (page, k) => ev(`(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page - 1});
  const box = pv.div.getBoundingClientRect();
  const h = box.height / ${BANDS}, y0 = box.top + ${k} * h, y1 = y0 + h;
  const out = [];
  for (const s of pv.textLayer.div.querySelectorAll("span")) {
    if (s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")) continue;
    const r = s.getBoundingClientRect();
    const mid = (r.top + r.bottom) / 2;
    if (mid >= y0 && mid < y1 && s.textContent.trim()) out.push(s.textContent);
  }
  return out.join(" | ");
})()`);

const index = { label: LABEL, zoom: ZOOM, bands: BANDS, pages: [] };
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
  await ev(`window.PDFViewerApplication.pdfViewer.currentScale = ${ZOOM}`);
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  await sleep(3000);

  const numPages = await ev(`window.PDFViewerApplication.pdfDocument.numPages`);
  const from = RANGE[0] || 1, to = Math.min(RANGE[1] || numPages, numPages);
  const clips = {};

  for (let p = from; p <= to; p++) {
    await ev(`(() => { window.PDFViewerApplication.page = ${p}; return true; })()`);
    await sleep(1200);
    const settled = await settleOn(p);
    const entry = { page: p, settled, bands: [] };
    for (let k = 0; k < BANDS; k++) {
      const clip = await bandClip(p, k);
      await sleep(300);
      await settleOn(p); // scrolling can bring a re-render or unprocessed lines into view
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", clip }, 60000);
      const name = `p${String(p).padStart(2, "0")}-b${k}`;
      writeFileSync(join(OUT, `${name}-on.png`), Buffer.from(shot.data, "base64"));
      writeFileSync(join(OUT, `${name}.txt`), await bandText(p, k));
      clips[name] = { p, k };
      entry.bands.push(name);
    }
    index.pages.push(entry);
    console.log(`p${p}: on ${settled}`);
  }

  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: false }, r))`);
  let restored = false;
  for (let i = 0; i < 60 && !restored; i++) {
    restored = await ev(`(() => document.querySelectorAll("[data-fx-done], .fx-b").length === 0 &&
      !document.querySelector("#viewerContainer.fx-on"))()`).catch(() => false);
    if (!restored) await sleep(500);
  }
  if (!restored) throw new Error("reading mode never restored — an fx-off half would be a copy of fx-on, not a control");

  for (const [name, { p, k }] of Object.entries(clips)) {
    if (k === 0) {
      await ev(`(() => { window.PDFViewerApplication.page = ${p}; return true; })()`);
      await sleep(1200);
    }
    const clip = await bandClip(p, k);
    await sleep(900); // canvas repaint after scroll
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", clip }, 60000);
    writeFileSync(join(OUT, `${name}-off.png`), Buffer.from(shot.data, "base64"));
  }
  writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2));
  const unsettled = index.pages.filter((e) => e.settled.startsWith("unsettled")).map((e) => e.page);
  console.log(`${LABEL}: ${index.pages.length} pages x ${BANDS} bands captured at zoom ${ZOOM}` +
    (unsettled.length ? ` — UNSETTLED p${unsettled.join(",p")}: do not judge those pairs` : ""));
  if (unsettled.length) process.exitCode = 75;
} catch (e) {
  // A capture that never happened must not read as success: exit 0 with no
  // file is indistinguishable from a clean inspection.
  console.error(`${LABEL} pagepairs error: ${e.message || e}`);
  process.exitCode = 1;
} finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
