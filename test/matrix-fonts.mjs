// Font-mode × bold-weight matrix check. For each (fontMode, boldWeight)
// combination: apply the settings live (storage change → engine restore +
// re-process), then measure page-wide health — width residual vs the PDF's
// own item widths, collapsed word-spacing, same-line span overlaps — and
// capture a region screenshot per combo.
// Usage: node test/matrix-fonts.mjs [paper] [page] [--browser=chrome|edge] [--zoom=N] [--find="text"]
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILTER = POS[0] ?? "Two-column B";
const PAGE = parseInt(POS[1] ?? "14", 10);
const ZOOMV = parseFloat(process.argv.slice(2).find((a) => a.startsWith("--zoom="))?.slice(7) ?? "1.25");
const BROWSER = process.argv.slice(2).find((a) => a.startsWith("--browser="))?.slice(10) ?? "chrome";
const NEEDLE = JSON.stringify(process.argv.slice(2).find((a) => a.startsWith("--find="))?.slice(7) ?? "We address");
const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
};
const MATRIX = [];
for (const fontMode of ["original", "atkinson", "inter", "literata"])
  for (const boldWeight of [500, 700, 900]) MATRIX.push({ fontMode, boldWeight });

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out", "matrix"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9226;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const EXE = BROWSER === "edge"
  ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = spawn(EXE, [
  `--remote-debugging-port=${PORT}`,
  ...(BROWSER === "edge" ? [`--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`] : ["--enable-unsafe-extension-debugging"]),
  `--user-data-dir=C:\\misc\\Claude_Workspace\\.chrome-fx-matrix-${BROWSER}`,
  "--no-first-run", "--no-default-browser-check", "--disable-sync",
  "--window-size=1500,1100", "--window-position=40,40", "about:blank",
], { stdio: "ignore" });

const wsReq = (ws, pending) => (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++pending.n;
  pending.map.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const connect = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  const pending = { n: 0, map: new Map() };
  ws.onopen = () => resolve({ ws, send: wsReq(ws, pending) });
  ws.onerror = () => reject(new Error("ws error"));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.map.has(m.id)) {
      const { resolve, reject } = pending.map.get(m.id);
      pending.map.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
});

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(400); } }
  console.log("Browser:", version.Browser);
  let extId = null;
  if (BROWSER !== "edge") {
    const b = await connect(version.webSocketDebuggerUrl);
    extId = (await b.send("Extensions.loadUnpacked", { path: EXT })).id;
  }
  let swTarget = null;
  for (let i = 0; i < 50 && !swTarget; i++) {
    const t = await http("/json/list");
    swTarget = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs") && (!extId || x.url.includes(extId)));
    if (!swTarget) await sleep(300);
  }
  let presetOk = false;
  try {
    const sw = await connect(swTarget.webSocketDebuggerUrl);
    await Promise.race([
      sw.send("Runtime.evaluate", { expression: `new Promise((r) => chrome.storage.sync.set({ enabled: true, fontMode: "original", boldWeight: 600 }, r))`, awaitPromise: true }),
      sleep(5000).then(() => { throw new Error("sw eval timeout"); }),
    ]);
    presetOk = true;
  } catch (e) { console.log("sw preset failed (" + e.message + ") — will enable from the page"); }

  const tab = await http(`/json/new?about:blank`, "PUT");
  const p = await connect(tab.webSocketDebuggerUrl);
  await p.send("Page.enable");
  await p.send("Page.navigate", { url: PAPERS[FILTER] });
  await sleep(5000);
  const ev = async (expr) => {
    const r = await p.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300));
    return r.result.value;
  };
  for (let i = 0; i < 4; i++) {
    const where = await ev("location.href.slice(0, 60)").catch(() => "?");
    if (where.startsWith("chrome-extension://")) break;
    console.log("not on viewer yet (", where, ") — renavigating");
    if (i >= 1) {
      // The DNR redirect needs a live service worker; when it is wedged
      // (flaky Edge SW startup), go to the viewer directly — Edge permits
      // top-level navigation to the web-accessible viewer.html.
      const id = extId ?? new URL(swTarget.url).hostname;
      await p.send("Page.navigate", { url: `chrome-extension://${id}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}` });
    } else {
      await p.send("Page.navigate", { url: PAPERS[FILTER] });
    }
    await sleep(4000);
    if (i === 3) throw new Error("viewer never loaded");
  }
  if (!presetOk) {
    for (let i = 0; i < 25; i++) { const ok = await ev(`!!(typeof chrome!=='undefined' && chrome.storage && chrome.storage.sync)`).catch(() => false); if (ok) break; await sleep(400); }
    await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true, fontMode: "original", boldWeight: 600 }, r))`).catch(() => {});
  }
  for (let i = 0; i < 40; i++) { await sleep(600); const n = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (n > 80) break; }
  if (ZOOMV) await ev(`window.PDFViewerApplication.pdfViewer.currentScale = ${ZOOMV}`).catch(() => {});
  await sleep(1500);
  await ev(`window.PDFViewerApplication.page = ${PAGE}`).catch(() => {});
  await sleep(3000);

  const waitProcessed = async () => {
    let last = -1;
    for (let i = 0; i < 40; i++) {
      const n = await ev(`(() => { const v = window.PDFViewerApplication.pdfViewer; const pv = v.getPageView(${PAGE - 1}); return pv && pv.textLayer ? pv.textLayer.div.querySelectorAll('span[data-fx-done]').length : 0; })()`).catch(() => 0);
      if (n > 50 && n === last) return n;
      last = n;
      await sleep(600);
    }
    return last;
  };
  await waitProcessed();

  const measureExpr = `(async () => {
    const v = window.PDFViewerApplication.pdfViewer;
    const pv = v.getPageView(${PAGE - 1});
    const div = pv.textLayer.div;
    const page = await window.PDFViewerApplication.pdfDocument.getPage(${PAGE});
    const tc = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
    const scale = pv.viewport.scale;
    const widthOf = new Map();
    for (const it of tc.items) {
      if (!it.str || it.str.trim().length < 16) continue;
      if (widthOf.has(it.str)) widthOf.set(it.str, null); // ambiguous
      else widthOf.set(it.str, it.width * scale);
    }
    const res = [];
    let jams = 0;
    const rows = new Map();
    for (const s of div.querySelectorAll('span[data-fx-done]')) {
      const r = s.getBoundingClientRect();
      const ws = parseFloat(s.style.wordSpacing || "0");
      if (s.style.wordSpacing.endsWith("em") && ws < -0.11) jams++;
      const w = widthOf.get(s.textContent);
      if (w) res.push(Math.abs(r.width - w));
      const key = Math.round(r.top / 4);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(r);
    }
    let overlaps = 0;
    for (const list of rows.values()) {
      list.sort((a, b) => a.left - b.left);
      for (let k = 1; k < list.length; k++) if (list[k - 1].right > list[k].left + 2) overlaps++;
    }
    res.sort((a, b) => a - b);
    const q = (f) => res.length ? Math.round(res[Math.min(res.length - 1, Math.floor(res.length * f))] * 100) / 100 : null;
    return { n: res.length, med: q(0.5), p90: q(0.9), max: q(1), jams, overlaps };
  })()`;

  console.log("mode      weight  n   med    p90    max   jams overlaps done");
  const setCombo = async (combo) => {
    const expr = `new Promise((r) => chrome.storage.sync.set({ enabled: true, fontMode: ${JSON.stringify(combo.fontMode)}, boldWeight: ${combo.boldWeight} }, () => r("ok")))`;
    for (let i = 0; i < 20; i++) {
      const ok = await ev(`!!(typeof chrome!=='undefined' && chrome.storage && chrome.storage.sync)`).catch(() => false);
      if (ok) return ev(expr);
      await sleep(500);
    }
    // page storage unavailable — poke the (possibly suspended) service worker
    const t = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (!t) throw new Error("no storage access anywhere");
    const sw2 = await connect(t.webSocketDebuggerUrl);
    return Promise.race([
      sw2.send("Runtime.evaluate", { expression: expr, awaitPromise: true }),
      sleep(6000).then(() => { throw new Error("sw eval timeout"); }),
    ]);
  };
  for (const combo of MATRIX) {
    await setCombo(combo);
    await sleep(2500);
    const done = await waitProcessed();
    const m = await ev(measureExpr);
    m.fxb = await ev(`(() => { const b = document.querySelector('#viewerContainer.fx-on .textLayer span[data-fx-done] .fx-b'); if (!b) return null; const cs = getComputedStyle(b); return cs.fontWeight + "/" + cs.webkitTextStrokeWidth + "/" + cs.fontFamily.split(",")[0]; })()`).catch(() => "err");
    console.log(
      combo.fontMode.padEnd(9),
      String(combo.boldWeight).padEnd(7),
      String(m.n).padEnd(3),
      String(m.med).padEnd(6),
      String(m.p90).padEnd(6),
      String(m.max).padEnd(5),
      String(m.jams).padEnd(4),
      String(m.overlaps).padEnd(8),
      String(done).padEnd(5),
      m.fxb,
    );
    const clip = await ev(`(async () => {
      const v = window.PDFViewerApplication.pdfViewer;
      const div = v.getPageView(${PAGE - 1}).textLayer.div;
      const t = [...div.querySelectorAll('span')].find(s => s.textContent.includes(${NEEDLE}));
      if (t) { t.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 1200)); }
      const r = t ? t.getBoundingClientRect() : div.getBoundingClientRect();
      return { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 12), width: 560, height: 300 };
    })()`);
    const shot = await p.send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 2 } });
    writeFileSync(join(root, "test", "out", "matrix", `${BROWSER}-${combo.fontMode}-${combo.boldWeight}.png`), Buffer.from(shot.data, "base64"));
  }
  console.log("DONE");
} catch (e) { console.error("matrix error:", e.message || e); }
finally { try { browser.kill(); } catch {} await sleep(300); }
