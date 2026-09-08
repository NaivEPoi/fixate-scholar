// Copy behavior: a paragraph selected in the viewer must reach the clipboard as
// ONE line, with the line-break hyphens gone and the real compound hyphens kept.
//
// PDF.js appends a <br> after every text item that ends a PDF line, so the
// browser's own serialization of a selection is the page's line breaks verbatim
// — "infor-\nmation" and all. overlay's copy handler rewrites the text/plain
// flavour; this measures what it writes.
//
// The selection is made programmatically over the page's whole text layer and
// the copy is a synthetic ClipboardEvent carrying its own DataTransfer, so the
// run needs no OS clipboard and reads back exactly what the handler set.
//
// Checks, per page:
//   LOSSLESS  — stripping whitespace and hyphens from raw and from flowed text
//               gives IDENTICAL strings. Joining may only change whitespace and
//               delete hyphens; if a word is ever dropped or duplicated, this
//               is what catches it.
//   JOINED    — the flowed text has fewer lines than the raw text (paragraphs
//               were actually reflowed), and more than one (the page was not
//               collapsed into a single blob).
//   NOHYPHEN  — no flowed line ends in a word-hyphen (an unjoined break), and
//               no "word- " survives inside a line.
//   KEPTCOMPOUND — every compound hyphen present in the raw text is still in
//               the flowed text ("state-of-the-art" is not welded shut).
//
// Usage: node test/copytext.mjs <url> [--pages=A-B]   (exit 1 on failure)

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir } from "./lib/env.mjs";

const URL0 = process.argv[2];
if (!URL0) {
  console.error("usage: node test/copytext.mjs <url> [--pages=A-B]");
  process.exit(2);
}
const RANGE = (process.argv.slice(3).find((a) => a.startsWith("--pages="))?.slice(8) ?? "")
  .split("-")
  .map((n) => parseInt(n, 10));
const EXT = extensionDir;
const PORT = 9611 + (process.pid % 140);
const userDataDir = join(tmpdir(), `fx-copy-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") =>
  (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(
  browserPath("edge"),
  [
    `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
    "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
    `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`, "about:blank",
  ],
  { stdio: "ignore" },
);

let ws;
let nextId = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", h);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(
      (r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 400),
    );
  }
  return r.result.value;
};

let failures = 0;
try {
  for (let i = 0; i < 50; i++) {
    try { await http("/json/version"); break; } catch { await sleep(300); }
  }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const targets = await http("/json/list");
    const sw = targets.find((t) => t.type === "service_worker" && t.url.includes("service-worker.mjs"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(300);
  }
  const tab = await http(
    `/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`,
    "PUT",
  );
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(3000);
  for (let i = 0; i < 25; i++) {
    const ok = await ev(`!!(typeof chrome!=='undefined' && chrome.storage && chrome.storage.sync)`).catch(() => false);
    if (ok) break;
    await sleep(400);
  }
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  for (let i = 0; i < 40; i++) {
    await sleep(700);
    const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0);
    if (b > 80) break;
  }
  const nPages = await ev(`window.PDFViewerApplication.pdfViewer.pagesCount`);
  // The hyphen decisions lean on the vendored word list; say so, because a tree
  // that never ran `npm run fetch-pdfjs` still passes every check below on the
  // shape rules alone and would quietly be testing less.
  const wordsReady = await ev(`globalThis.__fxWordsReady === true`).catch(() => false);
  console.log(`word list: ${wordsReady ? "loaded" : "MISSING (extension/vendor/words) — hyphen checks are weaker"}`);
  const p0 = RANGE[0] || 1;
  const p1 = RANGE[1] || Math.min(nPages, 4);

  for (let p = p0; p <= p1; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`).catch(() => {});
    await sleep(2000);
    for (let i = 0; i < 20; i++) {
      const n = await ev(
        `(() => { const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1}); return pv && pv.textLayer ? pv.textLayer.div.querySelectorAll('span').length : 0; })()`,
      ).catch(() => 0);
      if (n > 0) break;
      await sleep(600);
    }
    const res = await ev(`(() => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
      const layer = pv && pv.textLayer && pv.textLayer.div;
      if (!layer) return null;
      const sel = window.getSelection();
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(layer);
      sel.addRange(r);
      // PDF.js normalizes the text it puts on the clipboard (ligatures and
      // friends), and so do we — so the comparison baseline has to be the
      // normalized selection, not the raw DOM text.
      const norm = window.pdfjsLib?.normalizeUnicode ?? ((s) => s);
      const raw = norm(sel.toString());
      const dt = new DataTransfer();
      const e = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
      layer.dispatchEvent(e);
      const written = dt.getData('text/plain');
      sel.removeAllRanges();
      // A handler that cancels the event but writes nothing would silently
      // empty the clipboard — report both facts rather than papering over it.
      return { raw, flow: written || raw, wrote: written.length > 0, prevented: e.defaultPrevented };
    })()`);
    if (!res) { console.log(`p${p}: no text layer`); continue; }
    const { raw, flow, wrote, prevented } = res;
    const handled = wrote && prevented;
    const bare = (s) => s.replace(/[\s­]+/g, "").replace(/[-‐]/g, "");
    const rawLines = raw.split("\n").filter((l) => l.trim());
    const flowLines = flow.split("\n").filter((l) => l.trim());
    const lossless = bare(raw) === bare(flow);
    const joined = flowLines.length < rawLines.length && flowLines.length > 0;
    // A word-hyphen at the end of a flowed line is only a DEFECT when the line
    // after it continues that word — a lowercase start. A page's own last line
    // may legitimately end mid-word (the rest is on the next page, outside this
    // selection), and so may a line interrupted by a running foot or a float's
    // caption, which start with a digit or a capital.
    const dangling = flowLines.filter(
      (l, i) => /\p{Ll}[-‐]$/u.test(l.trim()) && /^\p{Ll}/u.test(flowLines[i + 1] ?? ""),
    ).length;
    // "word- " inside a line, but only when the reflow INTRODUCED it: a few
    // papers set a spaced hyphen in their own text layer, and copying that
    // verbatim is not this feature's doing.
    const spacedHyphen = (s) => (s.match(/\p{Ll}[-‐][^\S\n]/gu) ?? []).length;
    const midDangling = Math.max(0, spacedHyphen(flow) - spacedHyphen(raw));
    // Compound hyphens: "word-word" runs entirely inside one raw line must
    // survive the reflow.
    const compounds = new Set(
      rawLines.flatMap((l) => l.match(/\p{L}+[-‐]\p{L}+/gu) ?? []),
    );
    const lostCompounds = [...compounds].filter((c) => !flow.includes(c));
    const ok = handled && lossless && joined && !dangling && !midDangling && !lostCompounds.length;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} p${p}: wrote=${wrote} prevented=${prevented} rawLines=${rawLines.length} ` +
        `flowLines=${flowLines.length} lossless=${lossless} danglingHyphens=${dangling}/${midDangling} ` +
        `lostCompounds=${lostCompounds.length}`,
    );
    if (!lossless) {
      // Show where they diverge — the first 60 chars around the mismatch.
      const a = bare(raw);
      const b = bare(flow);
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      console.log(`      raw : …${a.slice(Math.max(0, i - 30), i + 30)}…`);
      console.log(`      flow: …${b.slice(Math.max(0, i - 30), i + 30)}…`);
    }
    if (lostCompounds.length) console.log(`      lost: ${lostCompounds.slice(0, 5).join(", ")}`);
    if (process.env.FX_SHOW) {
      console.log("      --- flowed ---");
      for (const l of flowLines) console.log(`      | ${l.slice(0, 260)}`);
    }
  }
  console.log(failures ? `\n${failures} page(s) FAILED` : "\nCOPY TEXT: PASS");
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(400);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
process.exit(failures ? 1 : 0);
