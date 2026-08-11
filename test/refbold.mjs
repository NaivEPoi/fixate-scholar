// Bibliography-emphasis detector. The reference list is left exactly as the
// author set it (overlay.mjs: setRefsRegion) — an entry's authors, title and
// venue are a citation, not reading matter, and emphasizing them makes a dense
// small-type block noisier without helping anyone read it.
//
// The engine excludes a span when it falls inside one of the per-LINE boxes the
// references extractor produced. This harness checks the outcome instead of the
// mechanism: it recomputes the bibliography's EXTENT from the parser
// (heading line → last body line, per page) and reports every processed span
// whose baseline sits inside it. A span the box list missed — a line the
// extractor never emitted, a continuation page, an entry after a heading the
// parser could not find — shows up here even though `refsOk` in papers.mjs
// (which only looks for "[18] Name …" entry openers) reads clean.
//
// Usage: node test/refbold.mjs [paper] [--url=…] [--label=…]   (exit 1 on offenders)

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir } from "./lib/env.mjs";

const ARGS = process.argv.slice(2);
const POS = ARGS.filter((a) => !a.startsWith("--"));
const URL_OVERRIDE = ARGS.find((a) => a.startsWith("--url="))?.slice(6);
const LABEL = ARGS.find((a) => a.startsWith("--label="))?.slice(8);
const PAPERS = {
  "USENIX (baseline)": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "USENIX (code + algorithms)": "https://yilud.me/usenixsecurity24-tu.pdf",
  "USENIX (no cover page)": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "ACM acmart (full)": "https://yilud.me/Proteus-ccs24.pdf",
  "ACM acmart (short)": "https://yilud.me/SIB-Auth.pdf",
  "IEEE conference (stamped)": "https://yilud.me/a33-dong%20stamped.pdf",
  "IEEE journal": "https://arxiv.org/pdf/2502.04915",
  "NeurIPS": "https://arxiv.org/pdf/1706.03762",
  "LaTeX article (CM)": "https://arxiv.org/pdf/quant-ph/9508027",
  "5GCVerif": "https://yilud.me/5GCVerif-ccs23.pdf",
  "5GShield": "https://yilud.me/5GShield.pdf",
  "AFC-Diss": "https://yilud.me/afc_testing_DISS.pdf",
  "ACL": "https://yilud.me/2026.acl-long.2136.pdf",
  "UC-Scheme": "https://yilud.me/UC_Scheme.pdf",
};
const FILTER = POS[0] ?? "USENIX (code + algorithms)";
const url = URL_OVERRIDE ?? PAPERS[FILTER];
if (!url) {
  console.error(`unknown paper "${FILTER}". Known: ${Object.keys(PAPERS).join(", ")}`);
  process.exit(2);
}
const NAME = LABEL ?? FILTER;

const PORT = 9411 + (process.pid % 140);
const userDataDir = join(tmpdir(), `fx-refbold-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,1800",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => reject(new Error(`${method}: timed out`)), 60000);
  const h = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== id) return;
    clearTimeout(timer);
    ws.removeEventListener("message", h);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 300));
  return r.result.value;
};

// The bibliography extent, straight from the parser: one box per page and
// COLUMN, spanning that column's own reference lines. Per-column matters in a
// two-column layout — the heading often sits mid-column, so the prose beside it
// is lower in y but earlier in reading order, and a per-page y band would call
// the whole left column "bibliography". Each box fills the vertical gaps
// BETWEEN the lines it covers, which is the point: a line the extractor never
// emitted still falls inside its column's box. PDF y grows upward.
const EXTENT = `(async () => {
  const { extractLines } = await import('/viewer/references/extractor.mjs');
  const { findReferencesBody, parseReferences } = await import('/viewer/references/parser.mjs');
  const lines = await extractLines(window.PDFViewerApplication.pdfDocument);
  const { heading, body } = findReferencesBody(lines);
  if (!heading || !body.length) return { heading: null, boxes: [], entries: 0, bodyLines: 0 };
  const groups = new Map();
  for (const l of [heading, ...body]) {
    const key = l.page + ":" + (l.column ?? 0);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { page: l.page, lines: [], yMin: Infinity, yMax: -Infinity }));
    g.lines.push(l);
    g.yMin = Math.min(g.yMin, l.y - l.h * 0.6);
    g.yMax = Math.max(g.yMax, l.y + l.h * 0.6);
  }
  for (const g of groups.values()) {
    // The column's x range, from PERCENTILES rather than extremes. Every real
    // entry line shares the column's margins, so the 5th/95th percentile equals
    // the true edges — while a stray line (the extractor can merge the other
    // column's body line with an entry when the gutter gap stays under its
    // threshold) no longer stretches the box across the page and puts that
    // column's prose "inside the bibliography".
    const q = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
    g.n = g.lines.length;
    g.x0 = q(g.lines.map((l) => l.x), 0.05) - 2;
    g.x1 = q(g.lines.map((l) => l.endX ?? l.x), 0.95) + 2;
    delete g.lines;
  }
  return {
    heading: { page: heading.page, text: heading.text.slice(0, 40) },
    boxes: [...groups.values()].map((g) => ({ ...g, x0: Math.round(g.x0), x1: Math.round(g.x1), yMin: Math.round(g.yMin), yMax: Math.round(g.yMax) })),
    bodyLines: body.length,
    entries: parseReferences(lines).length,
    boxPages: (globalThis.__fxRefPages ?? []).slice(),
  };
})()`;

// Processed spans inside the extent, on one page. Span rects are converted back
// to PDF user space through PDF.js's own viewport, so the comparison happens in
// the coordinates the parser reported and no CSS scale is involved.
const OFFENDERS = (page, boxes) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page - 1});
  const div = pv && pv.textLayer && pv.textLayer.div;
  if (!div || !div.childElementCount) return { rendered: false };
  const vp = pv.viewport;
  const boxes = ${JSON.stringify(boxes)};
  const lr = div.getBoundingClientRect();
  const out = [];
  let done = 0;
  for (const s of div.querySelectorAll("span[data-fx-done]")) {
    done++;
    const t = s.textContent.trim();
    if (!t) continue;
    const r = s.getBoundingClientRect();
    const [x, y] = vp.convertToPdfPoint(r.left - lr.left, r.bottom - lr.top);
    if (boxes.some((b) => y >= b.yMin && y <= b.yMax && x >= b.x0 && x <= b.x1))
      out.push({ t: t.slice(0, 46), x: Math.round(x), y: Math.round(y), why: s.dataset.fxWhy || null });
  }
  return { rendered: true, done, offenders: out };
})()`;

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  if (!version) throw new Error("debugger endpoint never came up");
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const t = await http("/json/list");
    const sw = t.find((x) => x.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(300);
  }
  if (!extId) throw new Error("extension did not load");
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(url)}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await sleep(2500);
  let appOk = false;
  for (let i = 0; i < 30; i++) {
    appOk = await ev(`!!(window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer)`).catch(() => false);
    if (appOk) break;
    await sleep(500);
  }
  if (!appOk) throw new Error("viewer never loaded");
  console.log(`Browser: ${version.Browser}  paper: ${NAME}`);
  await ev(`globalThis.__fxDebug = true`);
  await ev(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 40; i++) {
    await sleep(800);
    const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0);
    if (b > 100) break;
  }
  const ext = await ev(EXTENT);
  if (!ext.heading) {
    console.log("no bibliography found — nothing to check");
    process.exitCode = 0;
  } else {
    const pages = [...new Set(ext.boxes.map((b) => b.page))].sort((a, b) => a - b);
    console.log(
      `bibliography: "${ext.heading.text}" p${ext.heading.page}, ${ext.bodyLines} body lines, ` +
      `${ext.entries} entries, extent p${pages[0]}-${pages.at(-1)} in ${ext.boxes.length} column(s), ` +
      `boxes on ${ext.boxPages.length} page(s)`,
    );
    let total = 0;
    for (const page of pages) {
      const boxes = ext.boxes.filter((b) => b.page === page);
      await ev(`window.PDFViewerApplication.page = ${page}`);
      let res = { rendered: false };
      for (let i = 0; i < 20; i++) {
        await sleep(400);
        res = await ev(OFFENDERS(page, boxes)).catch((e) => ({ rendered: false, err: String(e).slice(0, 80) }));
        if (res.rendered) break;
      }
      if (!res.rendered) { console.log(`p${page}: never rendered${res.err ? " (" + res.err + ")" : ""}`); continue; }
      await sleep(900);
      res = await ev(OFFENDERS(page, boxes));
      total += res.offenders.length;
      console.log(`p${page}: processed=${res.done} inBibliography=${res.offenders.length}${res.offenders.length ? "  <<< EMPHASIZED REFERENCES" : ""}`);
      // The boxes a flagged span was judged against — a wrong box is the first
      // thing to rule out before believing a finding.
      if (res.offenders.length) {
        for (const b of boxes) console.log(`   box: x${b.x0}-${b.x1} y${b.yMin}-${b.yMax} (${b.n} lines)`);
      }
      for (const o of res.offenders.slice(0, 8)) console.log(`   x${o.x} y${o.y}: "${o.t}"${o.why ? ` (${o.why})` : ""}`);
    }
    console.log(`\nTOTAL emphasized bibliography spans: ${total}`);
    if (total > 0) process.exitCode = 1;
  }
} catch (e) {
  console.error("refbold error:", e.message || e);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
