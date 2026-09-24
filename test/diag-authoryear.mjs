// Which AUTHOR-YEAR citations does the page annotate, and do any of them look
// like prose? R46 widened the author-year grammar: a parenthetical with a year
// reaches the scanner whatever else it holds ("(we used ImageNet 2012 for
// pretraining)"), and only one that RESOLVES to a bibliography entry is
// user-visible — coloured, with a card. citepoint cannot see these (it examines
// numeric brackets only), so this lists every annotated author-year citation of
// one document, and marks SUSPECT any whose words are mostly lowercase prose
// rather than names. A suspect is a lead to look at, not a verdict.
// Usage: node test/diag-authoryear.mjs --url=<pdf> [--label=name] [--zoom=1.0]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { browserPath, extensionDir, profileDir, killBrowser, devtoolsPort } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url");
const LABEL = arg("label", "doc");
const ZOOM = arg("zoom", "1.0");
if (!URL0) {
  console.error("usage: node test/diag-authoryear.mjs --url=<pdf> [--label=name] [--zoom=1.0]");
  process.exit(2);
}
let PORT = 0; // the free port the browser chose (lib/env.mjs devtoolsPort)
const userDataDir = profileDir("authoryear");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => {
  PORT ||= await devtoolsPort(userDataDir, launched);
  return (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
};

const launched = Date.now();
const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=0`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1300,1900",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

// tables.mjs's "handled": every prose leaf span processed or given a reason.
const HANDLED = (p) => `(() => {
  const d = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;
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
// Each citation's coloured text: consecutive text nodes under a .fx-cite-c
// joined, in reading order (the colour wrap is split wherever an emphasis run
// or a nested wrap cuts it). Bracketed ones are the numeric kind: not these.
const READ = (p) => `(() => {
  const d = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;
  if (!d) return [];
  const out = [];
  for (const span of d.querySelectorAll("span[data-fx-done]")) {
    let cur = "";
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest(".fx-cite-c")) { cur += n.data; continue; }
      if (cur) { out.push(cur); cur = ""; }
    }
    if (cur) out.push(cur);
  }
  return out.filter((t) => !/[\\[\\]]/.test(t));
})()`;

let cdp;
const ev = (expr) => cdp.ev(expr);
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
  cdp = connect(tab.webSocketDebuggerUrl, { where: "viewer", timeoutMs: 90000 });
  await cdp.ready;
  await cdp.send("Page.enable");
  await sleep(2500);
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { ok = await ev(`!!window.PDFViewerApplication?.pdfDocument`).catch(() => false); if (!ok) await sleep(500); }
  if (!ok) throw new Error("viewer never loaded");
  await ev(`globalThis.__fxDebug = true`);
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:false},r))`);
  await ev(`window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)}`);
  await sleep(1500);
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`);
  const pages = await ev(`window.PDFViewerApplication.pagesCount`);
  const cites = [];
  let unhandled = 0;
  for (let p = 1; p <= pages; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`);
    let st = null;
    for (let i = 0; i < 40; i++) {
      await sleep(700);
      st = await ev(HANDLED(p));
      if (st && (st.prose < 3 || st.handled === st.prose)) break;
    }
    if (!st || (st.prose >= 3 && st.handled < st.prose)) unhandled++;
    for (const t of await ev(READ(p))) cites.push({ p, t });
  }
  // Names are capitalised; prose is not. Words that belong in a citation's
  // own apparatus do not count as prose.
  const APPARATUS = new Set(["et", "al", "and", "or", "see", "eg", "cf", "ie", "also", "in", "for", "a", "the",
    "of", "von", "van", "der", "den", "de", "la", "le", "du", "di", "da", "pp", "p", "ch", "sec", "chap", "forthcoming",
    "press", "nd", "fig", "table", "appendix"]);
  const suspect = (t) => {
    const words = t.match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*/g) ?? [];
    const prose = words.filter((w) => /^[a-zà-ÿ]/.test(w) && !APPARATUS.has(w.toLowerCase()));
    return prose.length >= 2 && prose.length >= words.length / 2;
  };
  const sus = cites.filter((c) => suspect(c.t));
  console.log(`${LABEL}: pages=${pages} author-year citations=${cites.length} suspect=${sus.length}${unhandled ? `  (${unhandled} page(s) not fully handled)` : ""}`);
  for (const c of sus.slice(0, 30)) console.log(`   SUSPECT p${c.p} "${c.t.slice(0, 70)}"`);
  if (process.argv.includes("--list")) for (const c of cites) console.log(`   p${c.p} "${c.t.slice(0, 70)}"`);
} catch (e) {
  console.error(`${LABEL} diag-authoryear error: ${e.message || e}`);
  process.exitCode = 1;
} finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
