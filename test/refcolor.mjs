// In-paper reference coloring check: per page, find in-paper references
// (Figure, Table, Section, Algorithm, Equation, ...) inside PROCESSED spans
// that have no .fx-ref-c coloring wrap. Reports totals plus samples.
// Usage: node test/refcolor.mjs <url> [--pages=A-B]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir } from "./lib/env.mjs";

const URL0 =
  process.argv.slice(2).find((a) => a.startsWith("--url="))?.slice(6) ??
  process.argv.slice(2).find((a) => !a.startsWith("--"));
const RANGE = (process.argv.slice(2).find((a) => a.startsWith("--pages="))?.slice(8) ?? "").split("-").map((n) => parseInt(n, 10));
const EXT = extensionDir;
const PORT = 9071 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-rc-${process.pid}`);
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

const CHECK = (p) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
  const div = pv?.textLayer?.div;
  if (!div) return { error: "no layer" };

  const REF_LEADER = "(?:[Ff]igures?|[Ff]igs?\\\\.?|[Tt]ables?|[Tt]abs?\\\\.?|[Aa]lgorithms?|[Aa]lgs?\\\\.?|[Ll]istings?|[Ss]ections?|[Ss]ecs?\\\\.?|§{1,2}|[Aa]ppendices|[Aa]ppendix|[Aa]pps?\\\\.?|[Ee]quations?|[Ee]qs?\\\\.?|[Cc]hapters?|[Tt]heorems?|[Ll]emmas?|[Dd]efinitions?|[Cc]laims?)";
  const REF_ROMAN = "(?:(?<=[a-zA-Z~])|\\\\b)(?=[IVXLCDM])M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{1,3})(?:-[A-Za-z\\\\d]+)?\\\\b";
  const REF_NUM = "\\\\d+(?:\\\\.\\\\d+)*(?:-[A-Za-z\\\\d]+)?(?:\\\\([a-z\\\\d]+\\\\)|[a-z](?![a-zA-Z]))?";
  const REF_PAREN_NUM = "\\\\(\\\\d+(?:\\\\.\\\\d+)*[a-z]?\\\\)";
  const REF_ALPHA = "(?:(?<=[a-zA-Z~])|\\\\b)[A-Z]\\\\b(?:\\\\.\\\\d+)?";
  const REF_ITEM = "(?:" + REF_PAREN_NUM + "|" + REF_NUM + "|" + REF_ROMAN + "|" + REF_ALPHA + ")";
  const REF_SEP = "(?:\\\\s*(?:[–—\\\\u2212\\\\u2015-]|--|to)\\\\s*|\\\\s*,\\\\s*(?:and\\\\s+|&\\\\s*)?|\\\\s+and\\\\s+|\\\\s*&\\\\s*)";
  const INTERNAL_REF = new RegExp("(?:\\\\b|(?<=[a-z])(?=[A-Z]))" + REF_LEADER + "\\\\s*~?\\\\s*" + REF_ITEM + "(?:" + REF_SEP + REF_ITEM + ")*", "g");

  let total = 0, colored = 0;
  const misses = [];
  for (const s of div.querySelectorAll("span[data-fx-done]")) {
    if (s.dataset.fxRefs) continue;
    const text = s.textContent;
    for (const m of text.matchAll(INTERNAL_REF)) {
      total++;
      let pos = 0, hit = false;
      const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const len = node.data.length;
        const a = Math.max(m.index, pos), b = Math.min(m.index + m[0].length, pos + len);
        if (a < b && node.parentElement.closest(".fx-ref-c")) { hit = true; break; }
        pos += len;
      }
      if (hit) colored++;
      else if (misses.length < 6) misses.push({ m: m[0], ctx: text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 6) });
    }
  }
  return { total, colored, misses };
})()`;

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable"); await sleep(2500);
  let appOk = false;
  for (let i = 0; i < 30; i++) { appOk = await ev(`!!(window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer)`).catch(() => false); if (appOk) break; await sleep(500); }
  if (!appOk) throw new Error("viewer never loaded");
  for (let i = 0; i < 40; i++) {
    await sleep(800);
    const ready = await ev(`({
      bolded: document.querySelectorAll('.textLayer .fx-b').length,
      refs: globalThis.__fxRefCount ?? -1,
      refPages: (globalThis.__fxRefPages ?? []).length
    })`).catch(() => null);
    if (ready && ready.bolded > 60 && ready.refs >= 0) break;
  }
  const pages = await ev(`window.PDFViewerApplication.pagesCount`);
  const from = RANGE[0] || 1, to = Math.min(RANGE[1] || pages, pages);
  let T = 0, C = 0;
  for (let p = from; p <= to; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`);
    let prev = -1;
    for (let i = 0; i < 30; i++) {
      await sleep(600);
      const n = await ev(`(()=>{const d=window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;return d?d.querySelectorAll('[data-fx-done]').length:0})()`).catch(() => 0);
      if (n > 0 && n === prev) break;
      prev = n;
    }
    await sleep(800);
    const r = await ev(CHECK(p)).catch((e) => ({ error: String(e).slice(0, 100) }));
    if (r.error) { console.log(`p${p}: ${r.error}`); continue; }
    T += r.total; C += r.colored;
    const tag = r.total > r.colored ? "  <<< UNCOLORED" : "";
    console.log(`p${p}: refs=${r.total} colored=${r.colored}${tag}`);
    if (r.misses?.length) {
      for (const m of r.misses) console.log(`   miss: ${m.m} in "${m.ctx}"`);
    }
  }
  console.log(`\nTOTAL refs=${T} colored=${C}`);
  if (T > C) process.exitCode = 1;
} catch (e) {
  console.error("refcolor error:", e);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
