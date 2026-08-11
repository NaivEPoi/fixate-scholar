// Style checks, with a bundled reading face swapped in:
//   (a) dynamic emphasis processes spans and emits .fx-b;
//   (b) spans whose ORIGINAL face is italic still render font-style italic
//       (the face swap must not flatten italics to roman). Conditional: the
//       page must actually contain italic-faced prose, which is established
//       independently from PDF.js's own font objects, NOT from our markup —
//       see italicOracle below. Neither corpus paper has any, so this check
//       usually reports "n/a"; it only gates the run when it applies. Papers
//       that DO exercise it (R17): arxiv.org/pdf/quant-ph/9508027 page 2
//       (Computer Modern CMTI) and arxiv.org/pdf/1207.0580 page 3 (URW Nimbus
//       NimbusRomNo9L-ReguItal).
//   (c) emphasisMode "none" + bundled font = font-only mode: spans processed,
//       zero .fx-b;
//   (d) emphasisMode "none" + original font = fully inert (nothing processed,
//       no masks) — there is nothing left to do, so the engine must no-op.
//
// Usage: node test/stylemodes.mjs [url|template] [page]
// With no arguments it runs the default template below. Passing a bare URL
// with no page argument uses page 1, which on most papers is front matter the
// engine deliberately skips (done=0) — pass a body page.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir } from "./lib/env.mjs";

// Same templates as the sibling harnesses (papers.mjs, diag-drag.mjs).
const PAPERS = {
  "USENIX (code + algorithms)": "https://yilud.me/usenixsecurity24-tu.pdf",
  "NeurIPS": "https://arxiv.org/pdf/1706.03762",
};
const DEFAULT_PAPER = "USENIX (code + algorithms)";
const DEFAULT_PAGE = 14;
const ARG0 = process.argv[2];
const URL0 = !ARG0 ? PAPERS[DEFAULT_PAPER] : (PAPERS[ARG0] ?? ARG0);
const PAGE = parseInt(process.argv[3] ?? (ARG0 ? "1" : String(DEFAULT_PAGE)), 10);
if (!/^https?:|^file:/.test(URL0)) {
  console.error(`stylecheck: not a URL or known template: ${JSON.stringify(ARG0)}`);
  console.error(`  known templates: ${Object.keys(PAPERS).join(", ")}`);
  process.exit(2);
}
const EXT = extensionDir;
const PORT = 9081 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-sc-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result.value; };

// In-page expression for the target page's text layer. Every probe goes through
// this: getPageView() returns undefined until the page view is built, so reading
// `.textLayer.div` straight off it throws a bare
// "Cannot read properties of undefined" that says nothing about the real cause
// (most often a paper that never loaded, e.g. a bad/missing url argument).
const LAYER = `window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1})?.textLayer?.div`;

// Resolve once the page view AND its text layer exist, so the probes below can
// assume both. Returns false on timeout, which the caller turns into a clear
// diagnosis rather than a TypeError.
const waitLayer = async () => {
  for (let i = 0; i < 30; i++) {
    if (await ev(`!!(${LAYER})`).catch(() => false)) return true;
    await sleep(500);
  }
  return false;
};

const waitProcessed = async () => {
  let prev = -1;
  for (let i = 0; i < 30; i++) {
    await sleep(700);
    const n = await ev(`(()=>{const d=${LAYER};return d?d.querySelectorAll('[data-fx-done]').length:0})()`).catch(() => 0);
    if (n > 0 && n === prev) return n;
    prev = n;
  }
  return prev;
};

// Independent oracle for check (b): which of the page's text items are set in
// an italic face, per PDF.js's OWN resolved font objects (pdfPage.commonObjs),
// not per anything the engine wrote. The regex below is a copy of engine.mjs
// ITALIC_FONT and must be kept in sync with it (it is inlined into a page
// expression, so it cannot be imported); test/unit/fontclass.test.mjs asserts
// the engine's own copy against real face names. Without
// this the italic assertion can't tell "the face swap flattened italics" from
// "this page has no italics", so a corpus with no italic prose would make the
// check silently vacuous — which is exactly what it was.
const italicOracle = async () => await ev(`(async () => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
  const div = pv?.textLayer?.div;
  if (!div || !pv.pdfPage) return null;
  const ITALIC = /Italic|italic|Oblique|Slanted|Ital(?![a-z])|CMTI|CMMI|cmti|cmmi|-It(?![a-z])|Libertine\\w*I(?![a-zA-Z])/;
  // Same item<->div pairing engine.mjs #pagePairs uses, so indices line up.
  const divs = pv.textLayer?.highlighter?.textDivs;
  if (!divs?.length) return { zipped: false, why: "no textDivs" };
  const content = await pv.pdfPage.getTextContent({ includeMarkedContent: true, disableNormalization: true });
  const items = content.items.filter((it) => it.str !== undefined);
  if (items.length !== divs.length) return { zipped: false, why: \`\${items.length} items vs \${divs.length} divs\` };
  let italicItems = 0, italicProcessed = 0, italicProcessedRendered = 0;
  for (let i = 0; i < items.length; i++) {
    let name = "";
    try { name = pv.pdfPage.commonObjs.get(items[i].fontName)?.name ?? ""; } catch {}
    if (!ITALIC.test(name)) continue;
    italicItems++;
    if (!divs[i].dataset.fxDone) continue;
    italicProcessed++;
    if (getComputedStyle(divs[i]).fontStyle === "italic") italicProcessedRendered++;
  }
  return { zipped: true, italicItems, italicProcessed, italicProcessedRendered };
})()`).catch((e) => ({ error: String(e.message || e).slice(0, 120) }));

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable"); await sleep(3000);
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true, fontMode: "atkinson", emphasisMode: "dynamic" }, r))`);
  await sleep(1500);
  await ev(`window.PDFViewerApplication.page = ${PAGE}`).catch(() => {});
  if (!(await waitLayer())) {
    const pages = await ev(`window.PDFViewerApplication.pdfViewer?.pagesCount ?? 0`).catch(() => 0);
    throw new Error(
      `page ${PAGE} never produced a text layer (document pagesCount=${pages}). ` +
      (pages ? `Is ${PAGE} within range?` : `The PDF did not load: ${URL0}`),
    );
  }
  let n = await waitProcessed();
  let probe = await ev(`(() => {
    const div = ${LAYER};
    const done = [...div.querySelectorAll("span[data-fx-done]")];
    const italics = done.filter((s) => getComputedStyle(s).fontStyle === "italic").length;
    const bolds = div.querySelectorAll(".fx-b").length;
    const fam = done[0] ? getComputedStyle(done[0]).fontFamily.split(",")[0] : "-";
    return { done: done.length, italics, bolds, fam };
  })()`);
  console.log("dynamic+atkinson:", JSON.stringify(probe));
  const dynOk = probe.bolds > 0 && probe.done > 0 && /FX /.test(probe.fam);
  // (b) Italic preservation, gated on the page actually having italic prose.
  const ital = await italicOracle();
  console.log("italic oracle:   ", JSON.stringify(ital));
  const italApplies = !!ital?.zipped && ital.italicProcessed > 0;
  const italOk = italApplies ? ital.italicProcessedRendered === ital.italicProcessed : null;
  // Font-only mode
  await ev(`new Promise((r) => chrome.storage.sync.set({ emphasisMode: "none" }, r))`);
  await sleep(2500);
  n = await waitProcessed();
  probe = await ev(`(() => {
    const div = ${LAYER};
    const done = div.querySelectorAll("span[data-fx-done]").length;
    const bolds = div.querySelectorAll(".fx-b").length;
    const s = div.querySelector("span[data-fx-done]");
    const fam = s ? getComputedStyle(s).fontFamily.split(",")[0] : "-";
    return { done, bolds, fam };
  })()`);
  console.log("none+atkinson:   ", JSON.stringify(probe));
  const noneOk = probe.done > 0 && probe.bolds === 0 && /FX /.test(probe.fam);
  // Font-only + original = pristine (nothing processed)
  await ev(`new Promise((r) => chrome.storage.sync.set({ fontMode: "original" }, r))`);
  await sleep(2500);
  probe = await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const div = ${LAYER};
    return { done: div.querySelectorAll("span[data-fx-done]").length, masks: pv.div.querySelectorAll(".fx-mask div").length };
  })()`);
  console.log("none+original:   ", JSON.stringify(probe), "(want done=0, masks=0)");
  const inertOk = probe.done === 0 && probe.masks === 0;
  const italLabel = italOk === null
    ? `n/a (page has ${ital?.zipped ? `${ital.italicItems} italic items, ${ital.italicProcessed} processed` : "no usable item↔div mapping"})`
    : String(italOk);
  console.log(`dynOk=${dynOk} italicPreserved=${italLabel} fontOnlyOk=${noneOk} inertOk=${inertOk}`);
  process.exitCode = dynOk && noneOk && inertOk && italOk !== false ? 0 : 1;
} catch (e) { console.error("stylecheck error:", e.message || e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
