// Why did the aligned-gap table rule claim these lines?
//
// `skipAlignedTable` (engine.mjs) reads a table's column boundary as a vertical
// band that consecutive rows share a gap across. When it is right, a prose-celled
// table is left alone; when it over-reaches, the run walks off the bottom of the
// table and takes the body paragraphs under it — the page renders with no
// emphasis at all and the only visible trace is `data-fx-why="table-aligned"`.
//
// The engine records every run it seeds in `__fxAligned` under `__fxDebug`. This
// prints them for one page next to the lines each run actually skipped, which is
// what tells a legitimate wide table from a run that escaped one.
//
// Usage: node test/diag-aligned.mjs --url=<pdf> --page=N [browser.exe]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { browserPath, extensionDir, profileDir } from "./lib/env.mjs";

const ARGS = process.argv.slice(2);
const URL0 = ARGS.find((a) => a.startsWith("--url="))?.slice(6);
const PAGE = parseInt(ARGS.find((a) => a.startsWith("--page="))?.slice(7) ?? "1", 10);
if (!URL0) {
  console.error("usage: node test/diag-aligned.mjs --url=<pdf> --page=N");
  process.exit(2);
}

const PORT = 9411 + (process.pid % 140);
const userDataDir = profileDir("aligned");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") =>
  (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(
  browserPath("edge", ARGS.find((a) => a.toLowerCase().endsWith(".exe"))),
  [
    `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
    "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
    `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`, "about:blank",
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
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try { version = await http("/json/version"); } catch { await sleep(250); }
  }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const tabs = await http("/json/list");
    const sw = tabs.find((t) => t.type === "service_worker" && t.url.includes("service-worker.mjs"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(300);
  }
  const viewer = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`;
  const tab = await http(`/json/new?${viewer}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(2500);
  // __fxDebug must be set before the page is classified, or the engine records
  // nothing and this prints an empty list that looks like "no runs".
  await ev(`globalThis.__fxDebug = true`);
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`).catch(() => {});
  await sleep(2000);
  await ev(`window.PDFViewerApplication.page = ${PAGE}`);
  await sleep(6000);

  const out = await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const div = pv?.textLayer?.div;
    const spans = div ? [...div.querySelectorAll("span")] : [];
    const byWhy = {};
    for (const s of spans) {
      const why = s.dataset.fxWhy;
      if (!why) continue;
      (byWhy[why] ??= []).push(s.textContent.trim().slice(0, 52));
    }
    return {
      runs: (globalThis.__fxAligned ?? []),
      aligned: (byWhy["table-aligned"] ?? []),
      counts: Object.fromEntries(Object.entries(byWhy).map(([k, v]) => [k, v.length])),
      done: div ? div.querySelectorAll("[data-fx-done]").length : -1,
    };
  })()`);

  console.log(`page ${PAGE}  processed=${out.done}`);
  console.log(`skip reasons: ${JSON.stringify(out.counts)}\n`);
  console.log(`aligned runs seeded (${out.runs.length}):`);
  for (const r of out.runs) {
    console.log(`  y=${String(r.y).padStart(4)} h=${String(r.h).padEnd(5)} rows=${String(r.n).padStart(3)} band=[${r.band}] split=${r.split}`);
    console.log(`      seed: ${JSON.stringify(r.seed)}`);
    console.log(`      raw : ${JSON.stringify(r)}`);
  }
  console.log(`\nlines skipped as table-aligned (${out.aligned.length}), first 30:`);
  for (const t of out.aligned.slice(0, 30)) console.log(`  ${JSON.stringify(t)}`);
} catch (e) {
  console.error("diag-aligned error:", e.message);
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(600);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
