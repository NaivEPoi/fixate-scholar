// Audit a paper for the round-3 issue classes, walking every page:
//  - keepFont : data-fx-keep (math/special) spans rendered in a FALLBACK family
//               (not an embedded g_* face) — math symbols lose their font.
//  - tableProc: data-fx-table spans that are ALSO processed/kept (table leak).
//  - skipPara : contiguous body-prose lines (>=4 lowercase words) left
//               unprocessed, EXCLUDING the bibliography pages and caption blocks
//               — catches paragraphs the classifier wrongly skips. Reports the
//               text so "Figure N shows ..." prose refs are visible.
//  - capProse : spans starting "Figure/Table N <lowercase>" (an in-text ref at a
//               line start, i.e. running prose) that are NOT processed — the
//               caption-vs-prose false positive.
// Usage: node test/audit.mjs [template]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const FILTER = process.argv.slice(2).find((a) => !a.toLowerCase().endsWith(".exe")) ?? "Two-column B";
const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "Two-column C": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "Two-column D": "https://yilud.me/Proteus-ccs24.pdf",
  "Two-column E": "https://yilud.me/SIB-Auth.pdf",
  "Two-column F": "https://yilud.me/a33-dong%20stamped.pdf",
  "arXiv": "https://arxiv.org/pdf/1706.03762",
  "arXiv2": "https://arxiv.org/pdf/2502.04915",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9361 + (process.pid % 200);
const userDataDir = join(tmpdir(), `fx-audit-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,1800",
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};

const PROBE = `(() => {
  const out = [];
  const refPages = new Set(globalThis.__fxRefPages ?? []);
  const viewer = window.PDFViewerApplication.pdfViewer;
  const LOWER = /^[a-zà-ÿ]{2,}$/;
  for (let i = 0; i < viewer.pagesCount; i++) {
    const pv = viewer.getPageView(i);
    const div = pv?.textLayer?.div;
    if (!div || !div.childElementCount) continue;
    const page = pv.id;
    const fxRect = pv.div.getBoundingClientRect();
    const leaves = [...div.querySelectorAll("span")].filter((s) => !s.querySelector("span") && s.textContent.trim());

    // keepFont: keep spans whose first font-family isn't an embedded g_* face.
    const keepBad = [];
    for (const s of div.querySelectorAll("span[data-fx-keep]")) {
      const ff = getComputedStyle(s).fontFamily.split(",")[0].replace(/["']/g, "").trim();
      if (!/^g_/.test(ff) && !/^FX /.test(ff)) keepBad.push({ t: s.textContent.trim().slice(0, 12), ff });
    }

    // tableProc: data-fx-table spans also processed/kept.
    const tableLeak = [...div.querySelectorAll("span[data-fx-table]")].filter((s) => s.dataset.fxDone || s.dataset.fxKeep).length;

    // capProse: "Figure/Table N <lowercase>" at a leaf-span start, NOT processed.
    const capProse = [];
    for (const s of leaves) {
      const t = s.textContent.trim();
      if (/^(?:Figure|Fig\\.?|Table|Tab\\.?|Algorithm|Section)\\s*\\d+[a-z]?\\s+[a-zà-ÿ]/.test(t)) {
        if (!s.dataset.fxDone) capProse.push({ t: t.slice(0, 40), done: !!s.dataset.fxDone, table: !!s.dataset.fxTable });
      }
    }

    // skipBody: data-fx-table (skipSet) leaf spans that are clearly BODY prose
    // (>=6 lowercase words, low special-char ratio) — a paragraph the block
    // classifier wrongly skipped. Reports the skip reason (data-fx-why).
    const skipBody = [];
    for (const s of div.querySelectorAll("span[data-fx-table]")) {
      const txt = s.textContent.trim();
      const lw = (txt.match(/[a-zà-ÿ]{2,}/g) || []).filter((w) => LOWER.test(w)).length;
      if (lw < 6) continue;
      const sp = (txt.match(/[^\x00-\x7F]|[=+*/^<>|\\{}]/g) || []).length;
      if (sp / Math.max(1, txt.length) > 0.25) continue; // mostly math → real
      skipBody.push({ t: txt.slice(0, 46), why: s.dataset.fxWhy || null, lw });
    }

    // skipPara: contiguous unprocessed body-prose lines (exclude refs pages).
    let skipRun = 0, skipSamples = [];
    if (!refPages.has(page)) {
      const body = leaves.filter((s) => { const r = s.getBoundingClientRect(); const ry = (r.top + r.bottom) / 2 - fxRect.top; return ry > fxRect.height * 0.07 && ry < fxRect.height * 0.93; });
      const byLine = new Map();
      for (const s of body) { const r = s.getBoundingClientRect(); const key = Math.round((r.top - fxRect.top) / 4); if (!byLine.has(key)) byLine.set(key, []); byLine.get(key).push(s); }
      let cur = 0, sample = null;
      for (const k of [...byLine.keys()].sort((a, b) => a - b)) {
        const spans = byLine.get(k);
        const text = spans.map((s) => s.textContent).join(" ");
        const lw = (text.match(/[a-zà-ÿ]{2,}/g) || []).filter((w) => LOWER.test(w)).length;
        const anyDone = spans.some((s) => s.dataset.fxDone);
        const anyKeepTab = spans.some((s) => s.dataset.fxKeep || s.dataset.fxTable);
        if (lw >= 5 && !anyDone && !anyKeepTab) { cur++; if (cur >= 3 && !sample) sample = text.slice(0, 70); }
        else { if (cur >= 3) { skipRun++; if (sample && skipSamples.length < 3) skipSamples.push(sample); } cur = 0; sample = null; }
      }
      if (cur >= 3 && sample) { skipRun++; if (skipSamples.length < 3) skipSamples.push(sample); }
    }

    if (keepBad.length || tableLeak || capProse.length || skipRun || skipBody.length)
      out.push({ page, keepBad: keepBad.length, keepSample: keepBad.slice(0, 4), tableLeak, capProse: capProse.slice(0, 4), skipRun, skipSamples, skipBody: skipBody.slice(0, 6) });
  }
  return out;
})()`;

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.url.includes("service-worker")); if (sw) extId = new URL(sw.url).hostname; else await sleep(250); }
  console.log(`Browser: ${version.Browser}  paper: ${FILTER}\n`);
  const url = PAPERS[FILTER];
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(url)}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await sleep(2500);
  await ev(`globalThis.__fxDebug = true`);
  await ev(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 100) break; }
  const pages = await ev(`window.PDFViewerApplication.pagesCount`);
  for (let p = 1; p <= pages; p++) { await ev(`window.PDFViewerApplication.page = ${p}`); await sleep(1500); }
  const res = await ev(PROBE);
  let kb = 0, tl = 0, cp = 0, sk = 0, sb = 0;
  for (const r of res) { kb += r.keepBad; tl += r.tableLeak; cp += r.capProse.length; sk += r.skipRun; sb += r.skipBody.length; }
  console.log(`TOTALS keepFallback=${kb} tableLeak=${tl} capProse=${cp} skipPara=${sk} skipBody=${sb}\n`);
  for (const r of res) {
    console.log(`p${r.page}: keepBad=${r.keepBad} tableLeak=${r.tableLeak} capProse=${r.capProse.length} skipRun=${r.skipRun} skipBody=${r.skipBody.length}`);
    if (r.keepBad) console.log(`   keep:`, JSON.stringify(r.keepSample));
    if (r.capProse.length) console.log(`   capProse:`, JSON.stringify(r.capProse));
    if (r.skipRun) console.log(`   skip:`, JSON.stringify(r.skipSamples));
    if (r.skipBody.length) console.log(`   skipBody:`, JSON.stringify(r.skipBody));
  }
  writeFileSync(join(root, "test", "out", `audit-${FILTER.replace(/\W+/g, "")}.json`), JSON.stringify(res, null, 2));
} catch (e) { console.error("audit error:", e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
