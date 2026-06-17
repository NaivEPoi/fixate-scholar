// One-off: dump PDF-coordinate geometry + classification for items on a page,
// to ground figure-region detection. Reports each item's x/y (PDF coords),
// width, height, special-font flag, and current done/keep/table state.
// Usage: node test/debug-fig.mjs <pdf-url> <pageNumber> [yMinPdfFrac] [yMaxPdfFrac]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://yilud.me/usenixsecurity24-tu.pdf";
const PAGE = parseInt(process.argv[3] ?? "9", 10);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9341 + (process.pid % 500);
const userDataDir = join(tmpdir(), `fx-figdbg-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
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
      expression: `(window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1})?.textLayer?.div?.querySelectorAll('span').length ?? 0)`,
    });
    if (s.result.value > 0) break;
  }
  await sleep(1200);
  const yMin = process.argv[4] ? parseFloat(process.argv[4]) : 0;
  const yMax = process.argv[5] ? parseFloat(process.argv[5]) : 1;
  const r = await send("Runtime.evaluate", {
    returnByValue: true,
    awaitPromise: true,
    expression: `(async () => {
      const app = window.PDFViewerApplication;
      const pv = app.pdfViewer.getPageView(${PAGE - 1});
      const div = pv?.textLayer?.div;
      if (!div) return { error: 'page not rendered' };
      const [vx0, vy0, vx1, vy1] = pv.pdfPage.view;
      const pageW = vx1 - vx0, pageH = vy1 - vy0;
      const content = await pv.pdfPage.getTextContent({ includeMarkedContent: true, disableNormalization: true });
      const divs = pv.textLayer.highlighter?.textDivs ?? [];
      const strItems = content.items.filter(it => it.str !== undefined);
      const fontSpecial = {};
      const SPECIAL = ${JSON.stringify("CMMI|CMSY|CMEX|CMBSY|MSAM|MSBM|Math|Symbol|cmmi|cmsy|cmex|stmary|rsfs|eufm|eusm|wasy|esint|MnSymbol|AMSa|AMSb|cmtt|Typewriter|Courier|Consol|Menlo|LMTT")};
      const re = new RegExp(SPECIAL);
      const out = [];
      strItems.forEach((it, i) => {
        if (!it.transform || !it.str.trim()) return;
        const x = it.transform[4], y = it.transform[5];
        const yFrac = (vy1 - y) / pageH;
        if (yFrac < ${yMin} || yFrac > ${yMax}) return;
        let fname = '';
        try { fname = pv.pdfPage.commonObjs.get(it.fontName)?.name ?? ''; } catch {}
        const d = divs[i];
        out.push({
          str: it.str, x: Math.round(x - vx0), y: Math.round(y - vy0),
          w: Math.round(it.width ?? 0), h: Math.round((it.height ?? 0) * 10) / 10,
          col: (x - vx0) < pageW * 0.5 ? 'L' : 'R',
          spc: re.test(fname) ? 1 : 0, font: fname.replace(/^[A-Z]+\\+/, '').slice(0, 16),
          done: d?.dataset.fxDone ? 1 : 0, keep: d?.dataset.fxKeep ? 1 : 0, tbl: d?.dataset.fxTable ? 1 : 0,
        });
      });
      out.sort((a, b) => b.y - a.y || a.x - b.x);
      return { page: ${PAGE}, pageW: Math.round(pageW), pageH: Math.round(pageH), centerX: Math.round(pageW * 0.5), n: out.length, items: out };
    })()`,
  });
  console.log(JSON.stringify(r.result.value ?? r.result, null, 1));
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
