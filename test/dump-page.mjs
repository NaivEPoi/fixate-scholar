// What the engine decided for every span of one page, as text: one line per
// text-layer span in reading order of the DOM, with its box, its height against
// the document's body height, and `done` (processed) or the reason it was left
// (`data-fx-why`, recorded under __fxDebug). The mechanism behind a finding is
// read from this before a rule is touched — a capture shows that a line is
// wrong, this shows which stage said so.
//
// Usage: node test/dump-page.mjs --url=<pdf> --page=N [--label=name] [--zoom=1.0]
//        [--find=<regex>]   only spans within --near px (default 40) of a match
//        [--traces]         also the engine's per-page debug records for the page
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { browserPath, extensionDir, profileDir, killBrowser, devtoolsPort } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url");
const LABEL = arg("label", "doc");
const PAGE = parseInt(arg("page", "1"), 10);
const ZOOM = arg("zoom", "1.0");
const FIND = arg("find", "");
const NEAR = parseFloat(arg("near", "40"));
if (!URL0) { console.error("usage: node test/dump-page.mjs --url=<pdf> --page=N [--find=<regex>] [--near=40] [--traces]"); process.exit(2); }

const userDataDir = profileDir("dump");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const launched = Date.now();
const browser = spawn(browserPath("edge"), [
  "--remote-debugging-port=0", "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-sync",
  "--window-size=1400,2000", `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });
let PORT = 0;
const http = async (p, m = "GET") => {
  PORT ||= await devtoolsPort(userDataDir, launched);
  return (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
};
let cdp;
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
  await fetch(`http://127.0.0.1:${PORT}/json/activate/${tab.id}`).catch(() => {});
  cdp = connect(tab.webSocketDebuggerUrl, { where: "viewer", timeoutMs: 60000 });
  await cdp.ready;
  const ev = (e) => cdp.ev(e);
  let ok = false;
  for (let i = 0; i < 80 && !ok; i++) { await sleep(250); ok = await ev(`!!window.PDFViewerApplication?.pdfDocument`).catch(() => false); }
  if (!ok) throw new Error("document never loaded");
  // --probe=<text>: the engine's caption and heading traces for the line whose lead contains it.
  const PROBE = arg("probe", "");
  if (PROBE) await ev(`(() => { globalThis.__fxTitleProbe = ${JSON.stringify(PROBE)}; return true; })()`);
  await ev(`(() => { globalThis.__fxDebug = true;
    const s = document.createElement("style");
    s.textContent = "#sidebarContainer,#viewsManager{display:none!important}#outerContainer.sidebarOpen #viewerContainer,#outerContainer.viewsManagerOpen #viewerContainer{inset-inline-start:0!important}";
    document.head.appendChild(s);
    window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)}; return true; })()`);
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true, lineModel: ${process.argv.includes("--line")} }, r))`);
  for (let i = 0; i < 60; i++) { await sleep(500); if ((await ev(`globalThis.__fxRefCount ?? -1`).catch(() => -1)) >= 0) break; }
  await ev(`(() => { window.PDFViewerApplication.page = ${PAGE}; return true; })()`);
  const sig = `(() => { const d = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1})?.textLayer?.div; if (!d) return "x";
    return d.querySelectorAll("span[data-fx-done]").length + "/" + d.querySelectorAll("[data-fx-why]").length + "/" + d.querySelectorAll(".fx-b").length; })()`;
  let last = "", still = 0;
  for (let i = 0; i < 80 && still < 6; i++) { await sleep(500); const s = await ev(sig).catch(() => "x"); if (s === last && s !== "x") still++; else { still = 0; last = s; } }
  const rows = await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const d = pv?.textLayer?.div; if (!d) return null;
    const pr = d.getBoundingClientRect();
    const out = [];
    for (const s of d.querySelectorAll("span")) {
      if (s.matches(".fx-cite-c, .fx-ref-c, .fx-sp") || s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")) continue;
      const t = s.textContent; if (!t) continue;
      const r = s.getBoundingClientRect();
      const h = s.closest("[data-fx-done], [data-fx-why], [data-fx-keep], [data-fx-table]") || s;
      out.push({ x: Math.round(r.left - pr.left), y: Math.round(r.top - pr.top), w: Math.round(r.width), h: +r.height.toFixed(1),
        st: h.dataset.fxDone ? "done" + (s.querySelectorAll(".fx-b").length ? "" : "(0b)") : (h.dataset.fxWhy || (h.dataset.fxKeep ? "keep" : h.dataset.fxTable ? "table" : "(none)")),
        font: (s.style.fontFamily || "").replace(/"/g, "").slice(0, 14), t });
    }
    return { rows: out, bodyH: globalThis.__fxBodyH ?? null, scale: pv.viewport.scale, w: Math.round(pr.width), hgt: Math.round(pr.height) };
  })()`);
  if (!rows) throw new Error(`page ${PAGE} has no text layer`);
  let list = rows.rows;
  if (FIND) {
    const re = new RegExp(FIND, "i");
    const hits = list.filter((r) => re.test(r.t));
    list = list.filter((r) => hits.some((h) => Math.abs(h.y - r.y) <= NEAR));
  }
  console.log(`${LABEL} p${PAGE} zoom=${ZOOM} page=${rows.w}x${rows.hgt}px body=${rows.bodyH} settle=${last} spans=${rows.rows.length}${FIND ? ` shown=${list.length}` : ""}`);
  list.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const r of list) console.log(`y${String(r.y).padStart(4)} x${String(r.x).padStart(4)} w${String(r.w).padStart(4)} h${String(r.h).padStart(5)} ${r.st.padEnd(22)} ${r.font.padEnd(14)} ${JSON.stringify(r.t.slice(0, 90))}`);
  // --joined=<regex>: the annotator's reading-order text around each match
  // (␀ marks a hard break) — why a reference across a line end was or was
  // not seen as one.
  const JOINED = arg("joined", "");
  if (JOINED) {
    const j = (await ev(`globalThis.__fxJoined?.[${PAGE}] ?? ""`)) || "";
    for (const m of j.matchAll(new RegExp(JOINED, "g"))) {
      console.log(`joined@${m.index}: ${JSON.stringify(j.slice(Math.max(0, m.index - 60), m.index + m[0].length + 140).replace(/\u0000/g, "␀"))}`);
    }
  }
  if (PROBE) {
    for (const r of JSON.parse(await ev(`JSON.stringify([...(globalThis.__fxCapTrace || []), ...(globalThis.__fxTitleTrace || []).filter((r) => JSON.stringify(r).includes(${JSON.stringify(PROBE)}))])`))) console.log("trace " + JSON.stringify(r));
  }
  if (process.argv.includes("--traces")) {
    const tr = await ev(`JSON.stringify({ blk: (globalThis.__fxBlkStats || []).filter?.((b) => b.page === ${PAGE}) ?? null,
      aligned: (globalThis.__fxAligned || []).filter?.((b) => b.page === ${PAGE}) ?? null,
      rules: (globalThis.__fxRules || []).filter((b) => b.page === ${PAGE}).slice(-1),
      baseline: (globalThis.__fxBaseline || []).filter((b) => b.page === ${PAGE}),
      contentStart: globalThis.__fxContentStart ?? null })`);
    console.log(tr);
  }
} catch (e) {
  console.error(`${LABEL} dump-page error: ${e.message || e}`);
  process.exitCode = 1;
} finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(300);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
