// Run a folder of (single-page) PDFs through the extension's viewer and record
// every text-layer span's box, reason and emphasis, for the rules-vs-model
// comparison (ml). One headless browser, one tab per PDF.
//
//   node ml/dump-reasons.mjs --dir=ml/data/doclaynet/pdf --out=ml/data/doclaynet/reasons.jsonl [--max=N]
//
// Each output line: { pdf, pageW, pageH, spans: [{ t, x, y, w, h, done, why, b }] }
// with x/y/w/h in CSS px of the page div at the viewer's zoom and pageW/pageH
// the page div's size, so a span maps to PDF points by pageW / original width.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, readdirSync, rmSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const REPO = "C:/WorkFiles/Claude_workspace/fixate-scholar";
const { browserPath, extensionDir, devtoolsPort, killBrowser } = await import(`file:///${REPO}/test/lib/env.mjs`);
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const DIR = arg("dir"), OUT = arg("out"), MAX = parseInt(arg("max", "100000"), 10);
if (!DIR || !OUT) { console.error("need --dir= and --out="); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = readdirSync(DIR).filter((f) => f.endsWith(".pdf")).sort();
const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).pdf) : []);
const todo = files.filter((f) => !done.has(f)).slice(0, MAX);
console.error(`${files.length} PDFs, ${done.size} done, ${todo.length} to do`);
const server = createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1));
  if (!files.includes(name)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": "application/pdf" }); res.end(readFileSync(join(DIR, name)));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const udd = join(tmpdir(), `fx-dumpreasons-${process.pid}`);
const since = Date.now();
const browser = spawn(browserPath("edge"), [
  "--remote-debugging-port=0", "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-sync",
  "--window-size=1400,2000", `--user-data-dir=${udd}`, `--load-extension=${extensionDir}`, `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });
try {
  const port = await devtoolsPort(udd, since);
  const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${port}${p}`, { method: m })).json();
  let extId = null;
  for (let i = 0; i < 100 && !extId; i++) { const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  if (!extId) throw new Error("extension did not load");
  let k = 0;
  for (const f of todo) {
    const t0 = Date.now();
    // A blank tab first, the debug flag armed for every document it loads,
    // THEN the viewer: the engine writes each span's reason to the DOM only
    // under globalThis.__fxDebug, and a flag set after the load misses the
    // pages that processed meanwhile (233 pages came back with no reason).
    const tab = await http("/json/new?about:blank", "PUT");
    await fetch(`http://127.0.0.1:${port}/json/activate/${tab.id}`).catch(() => {});
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let n = 0;
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id, method, params })); });
    const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result.value; };
    let rec = { pdf: f, error: null };
    try {
      await send("Page.enable");
      await send("Page.addScriptToEvaluateOnNewDocument", { source: "globalThis.__fxDebug = true;" });
      await send("Page.navigate", { url: `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(`${base}/${f}`)}#zoom=100` });
      let loaded = false;
      for (let i = 0; i < 80 && !loaded; i++) { loaded = await ev("!!window.PDFViewerApplication?.pdfDocument").catch(() => false); if (!loaded) await sleep(250); }
      if (!loaded) throw new Error("document did not load");
      // --line: the line classifier on, so the dump holds the engine's model-<class> reasons too
      await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true, lineModel: ${process.argv.includes("--line")} }, r))`);
      for (let i = 0; i < 40 && !(await ev("!!PDFViewerApplication.pdfViewer.getPageView(0)?.textLayer?.div").catch(() => false)); i++) await sleep(250);
      let last = -1, stable = 0;
      for (let i = 0; i < 60 && stable < 4; i++) { await sleep(400); const c = await ev("document.querySelectorAll('.page[data-page-number=\"1\"] span[data-fx-done]').length"); stable = c === last ? stable + 1 : 0; last = c; }
      await sleep(800);
      const got = await ev(`(() => {
        const pv = PDFViewerApplication.pdfViewer.getPageView(0);
        const pr = pv.div.getBoundingClientRect();
        const spans = [...pv.textLayer.div.querySelectorAll(':scope > span')].map((s) => {
          const r = s.getBoundingClientRect();
          return { t: s.textContent.trim().slice(0, 60), x: +(r.left - pr.left).toFixed(1), y: +(r.top - pr.top).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), done: !!s.dataset.fxDone, why: s.dataset.fxWhy || "", b: !!s.querySelector('.fx-b') };
        }).filter((s) => s.t);
        return { pageW: pr.width, pageH: pr.height, spans };
      })()`);
      Object.assign(rec, got);
    } catch (e) { rec.error = String(e.message || e).slice(0, 200); }
    ws.close();
    await http(`/json/close/${tab.id}`).catch(() => {});
    appendFileSync(OUT, JSON.stringify(rec) + "\n");
    if (++k % 25 === 0) console.error(`  ${k}/${todo.length} (${((Date.now() - t0) / 1000).toFixed(1)} s last)`);
  }
  console.error(`done: ${k} PDFs`);
} finally { killBrowser(browser); server.close(); await sleep(500); try { rmSync(udd, { recursive: true, force: true }); } catch {} }
