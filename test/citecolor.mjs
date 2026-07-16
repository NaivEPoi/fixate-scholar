// Citation-coloring check: per page, find [N]-style citation text inside
// PROCESSED spans that has no .fx-cite-c coloring wrap. Reports totals plus
// samples. Usage: node citecheck.mjs <url> [--pages=A-B]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const URL0 = process.argv[2];
const RANGE = (process.argv.slice(3).find((a) => a.startsWith("--pages="))?.slice(8) ?? "").split("-").map((n) => parseInt(n, 10));
const EXT = "C:\\misc\\Claude_Workspace\\fixate-scholar\\extension";
const PORT = 9061 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-cc-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
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
  const CITE = /\\[(\\d{1,3}(?:\\s*[,;\\u2013\\u2014-]\\s*\\d{1,3})*)\\]/g;
  let total = 0, colored = 0;
  const misses = [];
  for (const s of div.querySelectorAll("span[data-fx-done]")) {
    if (s.dataset.fxRefs) continue;
    const text = s.textContent;
    for (const m of text.matchAll(CITE)) {
      total++;
      // colored when SOME part of the match sits inside a .fx-cite-c wrap
      let pos = 0, hit = false;
      const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const len = node.data.length;
        const a = Math.max(m.index, pos), b = Math.min(m.index + m[0].length, pos + len);
        if (a < b && node.parentElement.closest(".fx-cite-c")) { hit = true; break; }
        pos += len;
      }
      if (hit) colored++;
      else if (misses.length < 6) misses.push({ m: m[0], ctx: text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 6) });
    }
  }
  const hits = pv.div.querySelectorAll(".fx-cite-hit").length;
  return { total, colored, hits, misses };
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
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`).catch(() => {});
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 60) break; }
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
    console.log(`p${p}: cites=${r.total} colored=${r.colored} hits=${r.hits}${tag}`);
    for (const s of r.misses) console.log(`   miss ${s.m} in "...${s.ctx}"`);
  }
  console.log(`\nTOTAL cites=${T} colored=${C}`);
} catch (e) { console.error("citecheck error:", e.message || e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
