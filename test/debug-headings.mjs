// Scan pages for section-heading-like lines and report whether their items are
// processed (done), kept, or untouched — to find headings being transformed.
// Usage: node test/debug-headings.mjs <pdf-url> <firstPage> <lastPage>
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2];
const P0 = parseInt(process.argv[3] ?? "4", 10);
const P1 = parseInt(process.argv[4] ?? "12", 10);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9341 + (process.pid % 500);
const userDataDir = join(tmpdir(), `fx-hdg-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [`--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--disable-sync",
   "--window-size=1400,1800", `--user-data-dir=${userDataDir}`,
   `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, "about:blank"],
  { stdio: "ignore" },
);
try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const sw = targets.find((t) => t.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(250);
  }
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PDF_URL)}`;
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${viewerUrl}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); resolve(m.result); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await sleep(1500);
  await send("Runtime.evaluate", { expression: `chrome.storage.sync.set({ enabled: true })`, awaitPromise: true });
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const s = await send("Runtime.evaluate", { returnByValue: true,
      expression: `({ pages: window.PDFViewerApplication?.pagesCount ?? 0, bolded: document.querySelectorAll('.textLayer .fx-b').length })` });
    if (s.result.value?.pages > 0 && s.result.value?.bolded > 50) break;
  }
  for (let p = P0; p <= P1; p++) {
    await send("Runtime.evaluate", { expression: `window.PDFViewerApplication.page = ${p}` });
    await sleep(1200);
    const r = await send("Runtime.evaluate", { returnByValue: true, awaitPromise: true, expression: `(async () => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
      const div = pv?.textLayer?.div; if (!div) return [];
      const content = await pv.pdfPage.getTextContent({ includeMarkedContent: true, disableNormalization: true });
      const divs = pv.textLayer.highlighter?.textDivs ?? [];
      const strItems = content.items.filter(it => it.str !== undefined);
      // group items into lines by transform[5]
      const items = strItems.map((it,i)=>({it,d:divs[i]})).filter(x=>x.it.transform&&x.it.str.trim());
      items.sort((a,b)=> b.it.transform[5]-a.it.transform[5] || a.it.transform[4]-b.it.transform[4]);
      const lines=[]; let cur=null;
      for(const x of items){const y=x.it.transform[5];const h=x.it.height||8;
        if(cur&&Math.abs(y-cur.y)<Math.max(cur.h,h)*0.6){cur.x.push(x);cur.h=Math.max(cur.h,h);}else{cur={y,h,x:[x]};lines.push(cur);}}
      const HEAD=/^(\\d+(?:\\.\\d+)*\\.?|[A-Z]\\d*[.:]|[IVX]+\\.)$/;
      const out=[];
      for(const ln of lines){
        ln.x.sort((a,b)=>a.it.transform[4]-b.it.transform[4]);
        const first=ln.x[0].it.str.trim();
        if(!HEAD.test(first)) continue;
        let fname=''; try{fname=pv.pdfPage.commonObjs.get(ln.x[0].it.fontName)?.name??'';}catch{}
        out.push({ page:${p}, text: ln.x.map(c=>c.it.str).join(' ').slice(0,55),
          done: ln.x.filter(c=>c.d?.dataset.fxDone).length, keep: ln.x.filter(c=>c.d?.dataset.fxKeep).length,
          tbl: ln.x.filter(c=>c.d?.dataset.fxTable).length, n: ln.x.length,
          fs: Math.round((ln.x[0].it.height||0)*10)/10, font: fname });
      }
      return out;
    })()` });
    for (const h of r.result.value ?? []) console.log(JSON.stringify(h));
  }
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
