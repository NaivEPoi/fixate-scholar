// Which reference does the pointer open? For every MULTI-KEY citation bracket
// on a page ("[4, 12]", "[3, 7, 9]"), each printed number is clicked at its own
// centre and the card that opens must be THAT number's.
//
// The bug this exists for: one citation used to be one hit-target carrying the
// whole card list, so pointing anywhere in "[4, 12]" — including at the 12 —
// opened [4]. Nothing in the DOM was wrong, every other citation check passed,
// and the card simply showed the wrong paper.
//
// Also checked, because both are ways for the fix to be present but useless:
//  - WRONG-TARGET: the topmost element at the number's centre is not a
//    citation hit-target at all (the per-key target is there but something
//    sits over it, so the click never reaches it).
//  - Nothing annotated WHERE SOMETHING SHOULD BE: a page whose text contains
//    bracketed citations but carries no hit-target at all is a failure, the way
//    citeaudit fails on zero brackets (R41) — it is the shape a blind run
//    takes, and it is also a real defect if the annotation pass never ran.
//    Two neighbouring cases are NOT failures, and conflating them with it cost
//    a corpus sweep two false reds:
//      * the document is annotated but cites one work at a time, so there is no
//        multi-key bracket to measure — SKIP;
//      * the document contains no bracketed citation at all (a two-page memo,
//        a cover letter, a review form with no bibliography) — SKIP, because
//        zero hit-targets is the correct answer there. `citeaudit` fails such a
//        document on the same guard; this one asks whether a citation was
//        PRESENT before demanding that one was annotated.
//    Every SKIP prints what it saw, so a sweep of nothing but SKIPs is visible
//    rather than silent, and corpus-wide coverage stays the sweep's job.
//
// Usage: node test/citepoint.mjs <url|--url=...> [--pages=A-B] [--max=N]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir, killBrowser } from "./lib/env.mjs";

const ARGS = process.argv.slice(2);
const URL0 = ARGS.find((a) => a.startsWith("--url="))?.slice(6) ?? ARGS.find((a) => !a.startsWith("--"));
if (!URL0) {
  console.error("usage: node test/citepoint.mjs <url|--url=...> [--pages=A-B] [--max=N]");
  process.exit(2);
}
const RANGE = (ARGS.find((a) => a.startsWith("--pages="))?.slice(8) ?? "").split("-").map((n) => parseInt(n, 10));
// Each click fires the card's lookup, so a citation-dense paper is capped
// rather than made to hammer the reference sources for hundreds of cards.
const MAX = parseInt(ARGS.find((a) => a.startsWith("--max="))?.slice(6) ?? "40", 10);
const EXT = extensionDir;
const PORT = 9411 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-cp-${process.pid}`);
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
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 400));
  return r.result.value;
};

let examined = 0;
let wrongCard = 0;
let wrongTarget = 0;
let annotated = 0; // citation hit-targets seen, over every page visited
let bracketed = 0; // bracketed citations PRESENT in the text of those pages

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  if (!extId) throw new Error("extension did not load");
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(3000);
  for (let i = 0; i < 25; i++) { const ok = await ev(`!!(typeof chrome!=='undefined' && chrome.storage && chrome.storage.sync)`).catch(() => false); if (ok) break; await sleep(400); }
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  for (let i = 0; i < 40; i++) { await sleep(700); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 80) break; }
  const nPages = await ev(`window.PDFViewerApplication.pdfViewer.pagesCount`);
  const p0 = RANGE[0] || 1;
  const p1 = RANGE[1] || nPages;

  for (let p = p0; p <= p1 && examined < MAX; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`).catch(() => {});
    await sleep(2200);
    // Settle on this page's own annotation, not a document-wide count: a page
    // photographed mid-annotation has no hit-targets yet and would report
    // every citation as WRONG-TARGET.
    for (let i = 0; i < 20; i++) {
      const n = await ev(`(() => { const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1}); return pv && pv.textLayer ? pv.div.querySelectorAll('.fx-cite-hit').length : 0; })()`).catch(() => 0);
      if (n > 0) break;
      await sleep(600);
    }
    await sleep(600);

    const res = await ev(`(async () => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
      if (!pv || !pv.textLayer) return null;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = { checked: 0, hits: pv.div.querySelectorAll('.fx-cite-hit').length, brackets: 0, wrongCard: [], wrongTarget: [] };

      // Page text exactly as the annotator assembles it, or the offsets below
      // address different characters than the hit-targets were built from.
      let joined = '';
      const spans = [];
      for (const s of pv.textLayer.div.querySelectorAll('span')) {
        if (s.closest('.fx-cite-c, .fx-ref-c, .fx-sp')) continue;
        if (s.querySelector('span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)')) continue;
        const t = s.textContent;
        if (!t) continue;
        spans.push({ s, start: joined.length, end: joined.length + t.length });
        joined += t + '\\n';
      }
      const rangeRects = (span, start, end) => {
        const range = document.createRange();
        let pos = 0, startSet = false;
        const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const len = node.data.length;
          if (!startSet && start < pos + len) { range.setStart(node, start - pos); startSet = true; }
          if (startSet && end <= pos + len) { range.setEnd(node, end - pos); return [...range.getClientRects()].filter((r) => r.width > 0); }
          pos += len;
        }
        return [];
      };
      const rectsFor = (a, b) => {
        const rs = [];
        for (const sg of spans) {
          if (sg.end <= a || sg.start >= b) continue;
          const ls = Math.max(0, a - sg.start), le = Math.min(sg.end - sg.start, b - sg.start);
          rs.push(...rangeRects(sg.s, ls, le));
        }
        return rs;
      };

      // Any bracketed citation, single or multi-key, counted OUTSIDE the
      // bibliography's own entry markers. This is what separates "the
      // annotation pass never ran" from "this document has nothing to cite":
      // only the first is a defect, and only the first may fail the run.
      const ANY_CITE = /\\[\\d{1,3}(?:\\s*[,;\\u2013\\u2014-]\\s*\\d{1,3})*\\]/g;
      for (const m of joined.matchAll(ANY_CITE)) {
        if (spans.some((sg) => sg.end > m.index && sg.start < m.index + m[0].length && sg.s.dataset.fxRefs)) continue;
        out.brackets++;
      }

      // Plain comma lists only: every number in one is printed AND cited, so
      // the expected card is unambiguous without re-deriving the parser's
      // range expansion here. Ranges are covered by citeaudit's coverage check.
      const LIST = /\\[(\\d{1,3}(?:\\s*,\\s*\\d{1,3})+)\\]/g;
      for (const m of joined.matchAll(LIST)) {
        if (${MAX} - ${examined} - out.checked <= 0) break;
        const listAt = m.index + m[0].indexOf(m[1]);
        if (spans.some((sg) => sg.end > m.index && sg.start < m.index + m[0].length && sg.s.dataset.fxRefs)) continue;
        const keys = [...m[1].matchAll(/\\d{1,3}/g)].map((k) => ({ key: k[0], at: listAt + k.index }));
        if (keys.some((k) => k.key === '0')) continue; // a vector, not a citation
        // The citation must be annotated at all — an unannotated bracket is
        // citeaudit's finding, not this one.
        const anyHit = rectsFor(m.index, m.index + m[0].length).some((r) => {
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!el?.classList.contains('fx-cite-hit');
        });
        if (!anyHit) continue;
        out.checked++;
        for (const k of keys) {
          const rs = rectsFor(k.at, k.at + k.key.length);
          if (!rs.length) continue;
          const r = rs[0];
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          const el = document.elementFromPoint(x, y);
          if (!el || !el.classList.contains('fx-cite-hit')) {
            out.wrongTarget.push({ cite: m[0].slice(0, 24), key: k.key, got: el ? (el.className || el.tagName) : 'null' });
            continue;
          }
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          await sleep(60);
          const label = document.querySelector('.fx-cite-popup .fx-cite-label')?.textContent ?? '(no card)';
          if (label !== '[' + k.key + ']') {
            out.wrongCard.push({ cite: m[0].slice(0, 24), key: k.key, label });
          }
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          await sleep(30);
        }
      }
      return out;
    })()`);

    if (!res) { console.log(`p${p}: no textLayer`); continue; }
    examined += res.checked;
    annotated += res.hits;
    bracketed += res.brackets;
    for (const w of res.wrongTarget) { wrongTarget++; console.log(`  FAIL p${p} WRONG-TARGET "${w.cite}" key ${w.key} → ${w.got}`); }
    for (const w of res.wrongCard) { wrongCard++; console.log(`  FAIL p${p} WRONG-CARD "${w.cite}" key ${w.key} opened ${w.label}`); }
    if (res.checked) console.log(`p${p}: multi-key cites=${res.checked} wrongTarget=${res.wrongTarget.length} wrongCard=${res.wrongCard.length}`);
  }

  console.log(
    `TOTAL multi-key cites=${examined} wrongTarget=${wrongTarget} wrongCard=${wrongCard} ` +
    `hitTargets=${annotated} bracketsInText=${bracketed}`,
  );
  if (!annotated && bracketed) {
    console.error(`  FAIL ${bracketed} bracketed citation(s) in the text and not one hit-target — the annotation pass did not run`);
    process.exitCode = 1;
  } else if (!examined && !annotated) {
    console.log("  SKIP this document has no bracketed citation at all — zero hit-targets is the right answer");
  } else if (!examined) {
    console.log(`  SKIP this document cites one work at a time — ${annotated} hit-targets, no multi-key bracket`);
  }
  if (wrongTarget || wrongCard) process.exitCode = 1;
} catch (e) { console.error("citepoint error:", e.message || e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} killBrowser(browser); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} process.exit(process.exitCode ?? 0); }
