// Dump per-line structure of a page: text, font size, x/y, and for each line
// whether its spans are processed (data-fx-done) and/or marked table
// (data-fx-table). Grounds caption / table / heading detection decisions.
// Usage: node test/debug-lines.mjs <pdf-url> <pageNumber> [yMin] [yMax] [browser]

import { spawn } from "node:child_process";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://arxiv.org/pdf/1706.03762";
const PAGE = parseInt(process.argv[3] ?? "4", 10);
const Y_MIN = process.argv[4] ? parseFloat(process.argv[4]) : null; // % of page from top
const Y_MAX = process.argv[5] ? parseFloat(process.argv[5]) : null;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9341 + (process.pid % 500); // unique per run — avoid zombie collisions
const userDataDir = join(tmpdir(), `fx-linedbg-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(
  process.argv[6] || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    `--remote-debugging-port=${PORT}`,
    "--headless=new",
    "--no-first-run",
    "--disable-sync",
    "--window-size=1400,1800",
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      await sleep(250);
    }
  }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const sw = targets.find((t) => t.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(250);
  }
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PDF_URL)}#page=${PAGE}`;
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${viewerUrl}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 0;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === id) {
          ws.removeEventListener("message", h);
          resolve(m.result);
        }
      };
      ws.addEventListener("message", h);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await sleep(1500);
  await send("Runtime.evaluate", { expression: `chrome.storage.sync.set({ enabled: true })`, awaitPromise: true });
  // Poll until the viewer is up and emphasis has run, then show the page.
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const s = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `({ pages: window.PDFViewerApplication?.pagesCount ?? 0, bolded: document.querySelectorAll('.textLayer .fx-b').length })`,
    });
    if (s.result.value?.pages > 0 && s.result.value?.bolded > 50) break;
  }
  await send("Runtime.evaluate", { expression: `window.PDFViewerApplication.page = ${PAGE}` });
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    const s = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1})?.textLayer?.div?.querySelectorAll('span[data-fx-done]').length ?? 0)`,
    });
    if (s.result.value > 0) break;
  }
  await sleep(1500);
  const r = await send("Runtime.evaluate", {
    returnByValue: true,
    awaitPromise: true,
    expression: `(() => {
      const app = window.PDFViewerApplication;
      const pv = app.pdfViewer.getPageView(${PAGE - 1});
      const div = pv?.textLayer?.div;
      if (!div) return { error: 'page not rendered' };
      const layerRect = div.getBoundingClientRect();
      const yMin = ${Y_MIN === null ? "null" : Y_MIN};
      const yMax = ${Y_MAX === null ? "null" : Y_MAX};
      const spans = [...div.querySelectorAll('span')].filter(s => !s.querySelector('span') && s.textContent.trim());
      // Group into lines by rounded top (within 4px).
      const items = spans.map(s => {
        const r = s.getBoundingClientRect();
        return {
          s, top: r.top - layerRect.top, left: r.left - layerRect.left,
          relTopPct: ((r.top - layerRect.top) / layerRect.height) * 100,
          fs: Math.round(parseFloat(getComputedStyle(s).fontSize) * 10) / 10,
          done: !!s.dataset.fxDone, table: !!s.dataset.fxTable, keep: !!s.dataset.fxKeep,
          text: s.textContent,
        };
      }).sort((a,b) => a.top - b.top || a.left - b.left);
      const lines = [];
      for (const it of items) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(it.top - last.top) < 5) {
          last.cells.push(it);
        } else {
          lines.push({ top: it.top, relTopPct: it.relTopPct, cells: [it] });
        }
      }
      const out = [];
      for (const ln of lines) {
        if (yMin !== null && ln.relTopPct < yMin) continue;
        if (yMax !== null && ln.relTopPct > yMax) continue;
        const text = ln.cells.map(c => c.text).join(' ');
        out.push({
          y: Math.round(ln.relTopPct * 10) / 10,
          fs: ln.cells.map(c => c.fs).sort((a,b)=>b-a)[0],
          done: ln.cells.filter(c => c.done).length,
          keep: ln.cells.filter(c => c.keep).length,
          tbl: ln.cells.filter(c => c.table).length,
          n: ln.cells.length,
          text: text.slice(0, 90),
        });
      }
      const findTerm = ${JSON.stringify(process.argv.find((a) => a.startsWith("--find="))?.slice(7) ?? null)};
      let found = undefined;
      if (findTerm) {
        found = [...div.querySelectorAll('span')]
          .filter(s => s.textContent.includes(findTerm))
          .slice(0, 6)
          .map(s => ({
            done: !!s.dataset.fxDone, keep: !!s.dataset.fxKeep, table: !!s.dataset.fxTable,
            bold: s.querySelectorAll('b.fx-b').length,
            html: s.innerHTML.slice(0, 140),
          }));
      }
      return { page: ${PAGE}, lineCount: out.length, found, lines: out };
    })()`,
  });
  console.log(JSON.stringify(r.result.value ?? r.result, null, 2));
  if (process.argv.includes("--shot")) {
    mkdirSync(join(root, "test", "out"), { recursive: true });
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const out = join(root, "test", "out", `page-${PAGE}.png`);
    writeFileSync(out, Buffer.from(shot.data, "base64"));
    console.log(`saved ${out}`);
  }
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
