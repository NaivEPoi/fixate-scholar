// Smoke test: loads the unpacked extension into headless Chrome (CDP, no
// dependencies), opens a real arXiv paper in the viewer, verifies the
// typography engine and citation layer ran, verifies DNR interception, and
// saves screenshots to test/out/.
//
// Usage: node test/e2e.mjs [path-to-chrome]

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "test", "out");
mkdirSync(outDir, { recursive: true });

const CHROME =
  process.argv[2] || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EXT = join(root, "extension");
const PORT = 9333;
const PDF_URL = "https://arxiv.org/pdf/1706.03762";
const userDataDir = join(tmpdir(), `fx-e2e-${process.pid}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(path, method = "GET") {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
  return res.json();
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (msg) =>
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result),
      );
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  }
  close() {
    this.ws.close();
  }
}

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
  "--window-size=1400,1800",
  `--user-data-dir=${userDataDir}`,
  `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`,
  "about:blank",
], { stdio: "ignore" });

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

try {
  // Wait for the debugger endpoint.
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    try {
      version = await http("/json/version");
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("Chrome debugger endpoint never came up");
  console.log(`Chrome: ${version.Browser}`);

  // Find the extension id via its service worker target.
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const targets = await http("/json/list");
    const sw = targets.find(
      (t) => t.url.startsWith("chrome-extension://") && t.url.includes("service-worker"),
    );
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(250);
  }
  check("extension service worker running", !!extId, extId ?? "not found");
  if (!extId) throw new Error("extension did not load");

  // --- Test 1: viewer renders a real PDF with fixation typography ---
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PDF_URL)}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");

  // Known-good settings regardless of anything synced into the profile.
  await sleep(2000);
  await cdp.eval(`chrome.storage.sync.set({ enabled: true })`);

  // Wait for the document and first text layer + engine output.
  let state = null;
  for (let i = 0; i < 60; i++) {
    state = await cdp.eval(`(() => ({
      pages: window.PDFViewerApplication?.pagesCount ?? 0,
      textSpans: document.querySelectorAll('.textLayer span').length,
      bolded: document.querySelectorAll('.textLayer .fx-b').length,
      masks: document.querySelectorAll('.fx-mask > div').length,
      fxOn: !!document.querySelector('#viewerContainer.fx-on'),
      toggle: !!document.getElementById('fxToggleButton'),
      cites: document.querySelectorAll('.fx-cite-hit').length,
    }))()`);
    if (state.bolded > 100 && state.cites > 0) break;
    await sleep(1000);
  }
  console.log("viewer state:", JSON.stringify(state));
  check("PDF loaded", state.pages > 0, `${state.pages} pages`);
  check("text layer rendered", state.textSpans > 50, `${state.textSpans} spans`);
  check("fixation mode on", state.fxOn);
  check("toolbar toggle present", state.toggle);
  check("words emboldened", state.bolded > 100, `${state.bolded} <b> nodes`);
  check("canvas masks placed", state.masks > 50, `${state.masks} masks`);
  check("citation hit-targets", state.cites > 0, `${state.cites} targets`);

  const shot1 = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, "viewer-page1.png"), Buffer.from(shot1.data, "base64"));

  // Citation popup: click a hit-target, expect the pinned Scholar-reader-style
  // card with the Scholar search action and a Cite (BibTeX) action — and NO
  // jump-to-references action. Then open Cite and confirm BibTeX is produced
  // (Scholar's own, or the locally generated fallback). (The rich Scholar
  // preview itself depends on live scholar.google.com, so only the card's
  // shell + the BibTeX it always yields are asserted.)
  const popupState = await cdp.eval(`(async () => {
    const hit = document.querySelector('.fx-cite-hit');
    if (!hit) return { clicked: false };
    hit.click();
    await new Promise(r => setTimeout(r, 4000)); // allow the Scholar fetch
    const popup = document.querySelector('.fx-cite-popup');
    const link = popup?.querySelector('a[href^="https://scholar.google.com/scholar?"]');
    const citeBtn = [...(popup?.querySelectorAll('button') ?? [])].find(b => b.textContent === 'Cite');
    citeBtn?.click();
    await new Promise(r => setTimeout(r, 4000)); // allow the BibTeX fetch/fallback
    const bib = popup?.querySelector('.fx-cite-bib textarea')?.value ?? '';
    return {
      clicked: true,
      visible: !!popup && !popup.hidden,
      scholarHref: link?.href ?? null,
      hasCiteAction: !!citeBtn,
      noJumpAction: ![...(popup?.querySelectorAll('a,button') ?? [])].some(a => a.textContent === 'See in References'),
      bibtexOk: /^@\\w+\\{/.test(bib.trim()),
      hasClose: !!popup?.querySelector('.fx-cite-close'),
      body: popup?.querySelector('.fx-cite-body')?.textContent.slice(0, 80) ?? null,
    };
  })()`);
  console.log("popup:", JSON.stringify(popupState));
  check(
    "citation card: Scholar action + Cite/BibTeX, no PDF-jump",
    popupState.visible && !!popupState.scholarHref && popupState.hasCiteAction &&
      popupState.noJumpAction && popupState.bibtexOk && popupState.hasClose,
    JSON.stringify(popupState),
  );
  const shotPopup = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, "citation-popup.png"), Buffer.from(shotPopup.data, "base64"));
  await cdp.eval(`(() => { document.querySelector('.fx-cite-popup .fx-cite-close')?.click(); return 1; })()`);

  // Cross-span citations: scan pages for a regex match in the concatenated
  // text that straddles a span boundary, and confirm those pages' matches all
  // received hit-targets. Not every document has one; skip if none exist.
  const pageProbe = `(pageIndex) => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(pageIndex);
    const div = pv?.textLayer?.div;
    if (!div || !div.childElementCount) return null;
    const spans = [...div.querySelectorAll('span')].filter(s => !s.querySelector('span'));
    let joined = '';
    const bounds = [];
    for (const s of spans) {
      joined += s.textContent;
      bounds.push(joined.length);
    }
    let total = 0, crossing = 0;
    for (const m of joined.matchAll(/\\[(\\d{1,3}(?:\\s*[,;\\u2013\\u2014-]\\s*\\d{1,3})*)\\]/g)) {
      total++;
      if (bounds.some(b => b > m.index && b < m.index + m[0].length)) crossing++;
    }
    return { total, crossing, hits: pv.div.querySelectorAll('.fx-cite-hit').length };
  }`;
  let crossResult = null;
  for (let p = 1; p <= state.pages && !crossResult; p++) {
    await cdp.eval(`(() => { window.PDFViewerApplication.page = ${p}; return 1; })()`);
    await sleep(2000);
    const probe = await cdp.eval(`(${pageProbe})(${p - 1})`);
    if (probe?.crossing > 0) crossResult = { page: p, ...probe };
  }
  if (crossResult) {
    check(
      "cross-span citations annotated",
      crossResult.hits >= crossResult.total,
      JSON.stringify(crossResult),
    );
  } else {
    console.log("SKIP  cross-span citations — none straddle a span boundary in this document");
  }
  await cdp.eval(`(() => { window.PDFViewerApplication.page = 1; return 1; })()`);
  await sleep(2000);

  // Toggle off → pristine restore.
  await cdp.eval(`(() => { document.getElementById('fxToggleButton').click(); return true; })()`);
  await sleep(1500);
  const off = await cdp.eval(`(() => ({
    bolded: document.querySelectorAll('.textLayer .fx-b').length,
    fxOn: !!document.querySelector('#viewerContainer.fx-on'),
  }))()`);
  check("toggle-off restores spans", off.bolded === 0 && !off.fxOn, JSON.stringify(off));
  const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, "viewer-toggled-off.png"), Buffer.from(shot2.data, "base64"));
  // Leave the default behind, in case the profile syncs anywhere.
  await cdp.eval(`chrome.storage.sync.set({ enabled: true })`);
  cdp.close();

  // --- Test 2: DNR interception of a direct PDF navigation ---
  const tab2 = await http(`/json/new?about:blank`, "PUT");
  const cdp2 = new CDP(tab2.webSocketDebuggerUrl);
  await cdp2.ready;
  await cdp2.send("Page.enable");
  await cdp2.send("Page.navigate", { url: PDF_URL });
  let finalUrl = "";
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    finalUrl = await cdp2.eval("window.location.href");
    if (finalUrl.startsWith("chrome-extension://")) break;
  }
  check(
    "PDF navigation intercepted",
    finalUrl.startsWith(`chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=`),
    finalUrl,
  );
  cdp2.close();
} catch (e) {
  failures++;
  console.error("E2E error:", e);
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
