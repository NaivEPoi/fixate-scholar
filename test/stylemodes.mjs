// Style checks: (a) font-only mode (emphasisMode none + bundled font) renders
// zero .fx-b while spans are processed in the bundled face; (b) with dynamic
// emphasis + bundled font, spans whose ORIGINAL face is italic render
// font-style italic. Usage: node stylecheck.mjs <url> <page>
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const URL0 = process.argv[2];
const PAGE = parseInt(process.argv[3] ?? "1", 10);
const EXT = "C:\\misc\\Claude_Workspace\\fixate-scholar\\extension";
const PORT = 9081 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-sc-${process.pid}`);
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

const waitProcessed = async () => {
  let prev = -1;
  for (let i = 0; i < 30; i++) {
    await sleep(700);
    const n = await ev(`(()=>{const d=window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1})?.textLayer?.div;return d?d.querySelectorAll('[data-fx-done]').length:0})()`).catch(() => 0);
    if (n > 0 && n === prev) return n;
    prev = n;
  }
  return prev;
};

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
  let n = await waitProcessed();
  let probe = await ev(`(() => {
    const div = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1}).textLayer.div;
    const done = [...div.querySelectorAll("span[data-fx-done]")];
    const italics = done.filter((s) => getComputedStyle(s).fontStyle === "italic").length;
    const bolds = div.querySelectorAll(".fx-b").length;
    const fam = done[0] ? getComputedStyle(done[0]).fontFamily.split(",")[0] : "-";
    return { done: done.length, italics, bolds, fam };
  })()`);
  console.log("dynamic+atkinson:", JSON.stringify(probe));
  const dynOk = probe.bolds > 0 && probe.done > 0;
  const italOk = probe.italics > 0;
  // Font-only mode
  await ev(`new Promise((r) => chrome.storage.sync.set({ emphasisMode: "none" }, r))`);
  await sleep(2500);
  n = await waitProcessed();
  probe = await ev(`(() => {
    const div = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1}).textLayer.div;
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
    const div = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1}).textLayer.div;
    return { done: div.querySelectorAll("span[data-fx-done]").length, masks: window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1}).div.querySelectorAll(".fx-mask div").length };
  })()`);
  console.log("none+original:   ", JSON.stringify(probe), "(want done=0, masks=0)");
  const inertOk = probe.done === 0 && probe.masks === 0;
  console.log(`dynOk=${dynOk} italicPreserved=${italOk} fontOnlyOk=${noneOk} inertOk=${inertOk}`);
  process.exitCode = dynOk && noneOk && inertOk ? 0 : 1;
} catch (e) { console.error("stylecheck error:", e.message || e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
