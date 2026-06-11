// Inspect engine behavior on a specific page of a paper.
// Usage: node test/debug-page.mjs <pdf-url> <pageNumber> [browser]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://arxiv.org/pdf/1706.03762";
const PAGE = parseInt(process.argv[3] ?? "4", 10);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9339;
const userDataDir = join(tmpdir(), `fx-pagedbg-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(
  process.argv[4] || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
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
  await sleep(10000);
  await send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `(async () => { window.PDFViewerApplication.page = ${PAGE}; })()`,
  });
  await sleep(6000);
  const r = await send("Runtime.evaluate", {
    returnByValue: true,
    awaitPromise: true,
    expression: `(async () => {
      const app = window.PDFViewerApplication;
      const pv = app.pdfViewer.getPageView(${PAGE - 1});
      const div = pv?.textLayer?.div;
      if (!div) return { error: 'page not rendered' };
      const divs = pv.textLayer.highlighter?.textDivs;
      const tc = await pv.pdfPage.getTextContent({ includeMarkedContent: true, disableNormalization: true });
      const strItems = tc.items.filter(it => it.str !== undefined);
      const done = [...div.querySelectorAll('span[data-fx-done]')];
      const sizes = done.map(s => parseFloat(getComputedStyle(s).fontSize)).sort((a,b)=>a-b);
      const median = sizes[Math.floor(sizes.length/2)];
      const samples = done.slice(0, 200).map(s => {
        const r = s.getBoundingClientRect();
        return {
          t: s.textContent.slice(0, 28),
          ff: s.style.fontFamily.slice(0, 14),
          fs: Math.round(parseFloat(getComputedStyle(s).fontSize) * 10) / 10,
          w: Math.round(r.width),
          sx: s.style.getPropertyValue('--scale-x'),
        };
      });

      // Width preservation: toggle off, record pristine geometry, toggle
      // back on, and compare the same spans' widths.
      const sleep2 = (ms) => new Promise(r => setTimeout(r, ms));
      const toggle = document.getElementById('fxToggleButton');
      toggle.click(); // off
      await sleep2(2500);
      const pristine = [...div.querySelectorAll('span')]
        .filter(s => !s.querySelector('span'))
        .map(s => ({ s, w: s.getBoundingClientRect().width }));
      toggle.click(); // on
      await sleep2(4000);
      let widthDrift = 0;
      let maxDrift = 0;
      for (const { s, w } of pristine) {
        if (!s.dataset.fxDone) continue;
        const w2 = s.getBoundingClientRect().width;
        const d = Math.abs(w2 - w);
        if (d > 1.5) widthDrift++;
        maxDrift = Math.max(maxDrift, d);
      }
      const widthCheck = { widthDrift, maxDrift: Math.round(maxDrift * 10) / 10 };
      // overlap detection: done spans whose rect intersects a NON-done span rect on the same line
      const all = [...div.querySelectorAll('span')].filter(s => !s.querySelector('span'));
      let overlaps = 0;
      const overlapSamples = [];
      for (const s of done) {
        const r1 = s.getBoundingClientRect();
        for (const o of all) {
          if (o === s || o.dataset.fxDone) continue;
          const r2 = o.getBoundingClientRect();
          const yOverlap = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
          const xOverlap = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
          if (yOverlap > r1.height * 0.5 && xOverlap > 3) {
            overlaps++;
            if (overlapSamples.length < 6) overlapSamples.push({ a: s.textContent.slice(0, 25), b: o.textContent.slice(0, 25), xOverlap: Math.round(xOverlap) });
            break;
          }
        }
      }
      return {
        mappingOk: divs?.length === strItems.length,
        divs: divs?.length, strItems: strItems.length,
        doneCount: done.length,
        medianSize: median,
        smallProcessed: sizes.filter(s => s < median * 0.88).length,
        overlaps, overlapSamples,
        widthCheck,
        samples: samples.slice(0, 12),
      };
    })()`,
  });
  console.log(JSON.stringify(r.result.value ?? r.result, null, 2));
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
