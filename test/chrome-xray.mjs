// REAL-CHROME diagnostic: Chrome ≥126 removed --load-extension but exposes
// CDP `Extensions.loadUnpacked` when started with
// --enable-unsafe-extension-debugging. This harness launches a side-profile
// HEADFUL Chrome (real display DPI), loads the unpacked extension via CDP,
// opens a paper through the DNR redirect, enables fx, and captures x-ray
// screenshots (fresh + after idle) plus baseline drift stats.
// Usage: node test/chrome-xray.mjs [paper] [page] [--zoom=N] [--idle=S] [--keep]
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILTER = POS[0] ?? "Two-column B";
const PAGE = parseInt(POS[1] ?? "10", 10);
const ZOOMV = parseFloat(process.argv.slice(2).find((a) => a.startsWith("--zoom="))?.slice(7) ?? "1.25");
const IDLE = parseInt(process.argv.slice(2).find((a) => a.startsWith("--idle="))?.slice(7) ?? "0", 10);
const KEEP = process.argv.includes("--keep");
const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9223;
const userDataDir = "C:\\misc\\Claude_Workspace\\.chrome-fx-debug";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  `--remote-debugging-port=${PORT}`,
  "--enable-unsafe-extension-debugging",
  ...(process.argv.includes("--nofontations") ? ["--disable-features=FontationsFontBackend,FontationsForSystemFonts"] : []),
  `--user-data-dir=${userDataDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-sync",
  "--window-size=1500,1100", "--window-position=40,40",
  "about:blank",
], { stdio: "ignore", detached: KEEP });

const wsReq = (ws, pending) => (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
  const id = ++pending.n;
  pending.map.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const connect = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  const pending = { n: 0, map: new Map() };
  ws.onopen = () => resolve({ ws, send: wsReq(ws, pending), pending });
  ws.onerror = (e) => reject(new Error("ws error"));
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
  if (!version) throw new Error("Chrome debug port never came up");
  console.log("Browser:", version.Browser);

  // Load the unpacked extension over CDP (browser-level session).
  const b = await connect(version.webSocketDebuggerUrl);
  let extId = null;
  try {
    const r = await b.send("Extensions.loadUnpacked", { path: EXT });
    extId = r.id;
    console.log("Extensions.loadUnpacked OK — id:", extId);
  } catch (e) {
    console.error("Extensions.loadUnpacked FAILED:", e.message);
    throw e;
  }
  // Wait for the service worker to register (DNR rules install).
  for (let i = 0; i < 50; i++) {
    const t = await http("/json/list");
    if (t.some((x) => x.type === "service_worker" && x.url.includes(extId))) break;
    await sleep(300);
  }
  await sleep(1200);

  // Open the paper — the extension's DNR rule redirects the .pdf URL to the viewer.
  const tab = await http(`/json/new?about:blank`, "PUT");
  const p = await connect(tab.webSocketDebuggerUrl);
  await p.send("Page.enable");
  await p.send("Page.navigate", { url: PAPERS[FILTER] });
  await sleep(4500);
  const ev = async (expr) => {
    const r = await p.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 400));
    return r.result.value;
  };
  const where = await ev("location.href.slice(0, 90)");
  console.log("tab is at:", where);
  if (!where.startsWith("chrome-extension://")) throw new Error("DNR redirect did not fire — viewer not loaded");
  console.log("devicePixelRatio:", await ev("devicePixelRatio"));

  // Enable fx.
  let storageOk = false;
  for (let i = 0; i < 25; i++) { storageOk = await ev(`!!(typeof chrome!=='undefined' && chrome.storage && chrome.storage.sync)`).catch(() => false); if (storageOk) break; await sleep(400); }
  if (storageOk) await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  for (let i = 0; i < 40; i++) { await sleep(700); const n = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (n > 80) break; }
  console.log("fx-b spans:", await ev(`document.querySelectorAll('.textLayer .fx-b').length`));
  console.log("cleanup wrapped (post-fix code?):", await ev(`!!window.PDFViewerApplication?.pdfDocument?.__fxCleanupWrapped`));

  await ev(`window.PDFViewerApplication.pdfViewer.currentScale = ${ZOOMV}`).catch(() => {});
  await sleep(2000);
  await ev(`window.PDFViewerApplication.page = ${PAGE}`).catch(() => {});
  await sleep(3500);
  for (let i = 0; i < 30; i++) {
    const n = await ev(`(() => { const v = window.PDFViewerApplication.pdfViewer; const pv = v.getPageView(${PAGE - 1}); return pv && pv.textLayer ? pv.textLayer.div.querySelectorAll('span[data-fx-done]').length : 0; })()`).catch(() => 0);
    if (n > 50) break;
    await sleep(700);
  }
  console.log("page", PAGE, "processed spans:", await ev(`(() => { const v = window.PDFViewerApplication.pdfViewer; const pv = v.getPageView(${PAGE - 1}); return pv && pv.textLayer ? pv.textLayer.div.querySelectorAll('span[data-fx-done]').length : 0; })()`));

  const SHOTONLY = process.argv.includes("--shotonly");
  if (!SHOTONLY) {
  // Per-span width diagnostics: is the embedded face loaded, what did the
  // width pass set, and does the DOM width match the canvas glyph width?
  const metrics = await ev(`(() => {
    const v = window.PDFViewerApplication.pdfViewer;
    const pv = v.getPageView(${PAGE - 1});
    const div = pv.textLayer.div;
    const mctx = document.createElement('canvas').getContext('2d');
    const out = { fonts: {}, spans: [] };
    const spans = [...div.querySelectorAll('span[data-fx-done]')].filter(s => s.getBoundingClientRect().width > 80).slice(0, 10);
    for (const s of spans) {
      const cs = getComputedStyle(s);
      const r = s.getBoundingClientRect();
      const fam = cs.fontFamily;
      const famKey = fam.split(',')[0].trim();
      if (!(famKey in out.fonts)) { try { out.fonts[famKey] = document.fonts.check('12px ' + famKey); } catch { out.fonts[famKey] = 'err'; } }
      mctx.font = cs.fontSize + ' ' + fam;
      out.spans.push({
        t: s.textContent.slice(0, 22),
        rectW: Math.round(r.width * 10) / 10,
        natural: Math.round(mctx.measureText(s.textContent).width * 10) / 10,
        scaleX: s.style.getPropertyValue('--scale-x') || '-',
        ws: s.style.wordSpacing || '-',
        mt: s.style.marginTop || '-',
        fam: famKey,
      });
    }
    return out;
  })()`);
  console.log("fonts.check:", JSON.stringify(metrics.fonts));
  for (const s of metrics.spans) console.log("  ", JSON.stringify(s));

  // Ground truth: overlay span rect vs canvas ink extents (css px) for the
  // §7.3 region spans, fx ON then fx OFF (native text layer).
  const probeExpr = (label) => `(() => {
    const v = window.PDFViewerApplication.pdfViewer;
    const pv = v.getPageView(${PAGE - 1});
    const div = pv.textLayer.div;
    const canvas = pv.canvas;
    const cr = canvas.getBoundingClientRect();
    const sx = canvas.width / cr.width, sy = canvas.height / cr.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const NEEDLES = ["Consider two deviations", ", as shown in", ", the input sequence is", "two deviating output", ", and it has", ", we have"];
    const rows = [];
    for (const n of NEEDLES) {
      const s = [...div.querySelectorAll('span')].find(el => el.textContent.includes(n));
      if (!s) { rows.push({ n, missing: true }); continue; }
      const r = s.getBoundingClientRect();
      const x0 = Math.max(0, Math.round((r.left - cr.left) * sx) - 12), x1 = Math.min(canvas.width, Math.round((r.right - cr.left) * sx) + 30);
      const y0 = Math.max(0, Math.round((r.top - cr.top) * sy) + 2), y1 = Math.min(canvas.height, Math.round((r.bottom - cr.top) * sy) - 2);
      if (x1 <= x0 || y1 <= y0) { rows.push({ n, offCanvas: true }); continue; }
      const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
      let lft = -1, rgt = -1;
      for (let x = 0; x < img.width; x++) for (let y = 0; y < img.height; y++) {
        const i = (y * img.width + x) * 4;
        if (img.data[i] < 120 && img.data[i + 1] < 120 && img.data[i + 2] < 120) { if (lft < 0) lft = x; rgt = x; break; }
      }
      if (lft < 0) { rows.push({ n, noInk: true }); continue; }
      const inkL = (x0 + lft) / sx + cr.left;
      const inkR = (x0 + rgt + 1) / sx + cr.left;
      rows.push({ n: n.slice(0, 20), dL: Math.round((r.left - inkL) * 10) / 10, dR: Math.round((r.right - inkR) * 10) / 10, w: Math.round(r.width * 10) / 10 });
    }
    return rows;
  })()`;
  console.log("--- fx ON: span rect vs canvas ink (dL/dR: +ve = rect right of ink) ---");
  for (const r of await ev(probeExpr("on"))) console.log("  ", JSON.stringify(r));
  // Every span on the first lines of the §7.3 paragraph, with rects.
  const lineDump = await ev(`(() => {
    const v = window.PDFViewerApplication.pdfViewer;
    const div = v.getPageView(${PAGE - 1}).textLayer.div;
    const anchor = [...div.querySelectorAll('span')].find(s => s.textContent.includes("Consider two deviations"));
    if (!anchor) return null;
    const ar = anchor.getBoundingClientRect();
    const out = [];
    for (const s of div.querySelectorAll('span')) {
      const r = s.getBoundingClientRect();
      if (r.top > ar.top - 8 && r.top < ar.top + 60 && r.width > 0) out.push({ t: s.textContent.slice(0, 26), x: Math.round((r.left - ar.left) * 10) / 10, r: Math.round((r.right - ar.left) * 10) / 10, y: Math.round(r.top - ar.top), done: !!s.dataset.fxDone, sx: s.style.getPropertyValue('--scale-x') || '-', ws: s.style.wordSpacing || '-' });
    }
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    return out;
  })()`);
  if (lineDump) for (const r of lineDump) console.log("  LINE:", JSON.stringify(r));
  // Forensics on one span: measure clones of its content in every relevant form.
  const forensic = await ev(`(() => {
    const v = window.PDFViewerApplication.pdfViewer;
    const div = v.getPageView(${PAGE - 1}).textLayer.div;
    const s = [...div.querySelectorAll('span')].find(el => el.textContent.includes("Consider two deviations"));
    if (!s) return null;
    const cs = getComputedStyle(s);
    const mk = (html, fam, extra) => {
      const el = document.createElement('span');
      el.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0;line-height:1;' + (extra || '');
      el.style.fontSize = cs.fontSize;
      el.style.fontFamily = fam || cs.fontFamily;
      el.innerHTML = html;
      document.body.append(el);
      const w = el.getBoundingClientRect().width;
      el.remove();
      return Math.round(w * 10) / 10;
    };
    const t = s.textContent;
    const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return {
      text: t,
      live: Math.round(s.getBoundingClientRect().width * 10) / 10,
      sx: s.style.getPropertyValue('--scale-x'),
      ws: s.style.wordSpacing,
      fontPx: cs.fontSize,
      fam: cs.fontFamily,
      plain: mk(esc),
      rewritten: mk(s.innerHTML),
      rewrittenWs: mk(s.innerHTML, null, 'word-spacing:' + s.style.wordSpacing),
      plainSerif: mk(esc, 'serif'),
      plainTimes: mk(esc, '"Times New Roman"'),
    };
  })()`);
  console.log("FORENSIC:", JSON.stringify(forensic, null, 1));
  // Where does the LAST character actually paint, vs the span box?
  const lastChar = await ev(`(() => {
    const v = window.PDFViewerApplication.pdfViewer;
    const div = v.getPageView(${PAGE - 1}).textLayer.div;
    const s = [...div.querySelectorAll('span')].find(el => el.textContent.includes("Consider two deviations"));
    if (!s) return null;
    const r = s.getBoundingClientRect();
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    let lastText = null;
    while (walker.nextNode()) lastText = walker.currentNode;
    const range = document.createRange();
    range.setStart(lastText, lastText.length - 1);
    range.setEnd(lastText, lastText.length);
    const cr = range.getBoundingClientRect();
    // marker lines at span left/right for the zoomed capture
    for (const [x, c] of [[r.left, 'blue'], [r.right, 'lime']]) {
      const m = document.createElement('div');
      m.style.cssText = 'position:fixed;top:' + (r.top - 6) + 'px;height:' + (r.height + 12) + 'px;width:1.5px;background:' + c + ';left:' + x + 'px;z-index:99999';
      document.body.append(m);
    }
    return { spanL: Math.round(r.left * 10) / 10, spanR: Math.round(r.right * 10) / 10, lastCharR: Math.round(cr.right * 10) / 10, lastCharRect: [Math.round(cr.left), Math.round(cr.top)] };
  })()`);
  console.log("LASTCHAR:", JSON.stringify(lastChar));
  {
    const clip2 = await ev(`(() => {
      const v = window.PDFViewerApplication.pdfViewer;
      const div = v.getPageView(${PAGE - 1}).textLayer.div;
      const s = [...div.querySelectorAll('span')].find(el => el.textContent.includes("Consider two deviations"));
      const r = s.getBoundingClientRect();
      return { x: Math.max(0, r.left - 10), y: Math.max(0, r.top - 14), width: Math.min(300, innerWidth - r.left), height: 46 };
    })()`);
    const shot2 = await p.send("Page.captureScreenshot", { format: "png", clip: { ...clip2, scale: 5 } });
    writeFileSync(join(root, "test", "out", `chrome-micro-${FILTER.replace(/\W+/g, "")}-p${PAGE}.png`), Buffer.from(shot2.data, "base64"));
    console.log("saved micro capture");
  }
  if (storageOk) {
    await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: false }, r))`);
    await sleep(3000);
    console.log("--- fx OFF (native layer): same probe ---");
    for (const r of await ev(probeExpr("off"))) console.log("  ", JSON.stringify(r));
    await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
    for (let i = 0; i < 30; i++) { await sleep(700); const n = await ev(`(() => { const v = window.PDFViewerApplication.pdfViewer; const pv = v.getPageView(${PAGE - 1}); return pv && pv.textLayer ? pv.textLayer.div.querySelectorAll('span[data-fx-done]').length : 0; })()`).catch(() => 0); if (n > 50) break; }
  }
  } // end !SHOTONLY

  const OUTLINE = process.argv.includes("--outline");
  const shoot = async (tag, xray) => {
    if (xray) await ev(`(() => { if (document.getElementById('fx-xray')) return; const s = document.createElement('style'); s.id='fx-xray'; s.textContent = '.fx-mask{display:none!important} #viewerContainer.fx-on .textLayer span[data-fx-done], #viewerContainer.fx-on .textLayer span[data-fx-done] .fx-b{color:rgba(220,0,0,.7)!important;-webkit-text-stroke:0!important}${OUTLINE ? " .textLayer span{outline:1px solid rgba(0,140,255,.9)}" : ""}'; document.head.append(s); })()`);
    else await ev(`document.getElementById('fx-xray')?.remove()`);
    await sleep(400);
    const clip = await ev(`(async () => {
      const v = window.PDFViewerApplication.pdfViewer;
      const div = v.getPageView(${PAGE - 1}).textLayer.div;
      const t = [...div.querySelectorAll('span')].find(s => s.textContent.includes("Consider two deviations")) ||
                [...div.querySelectorAll('span[data-fx-done]')].find(s => s.getBoundingClientRect().width > 100);
      if (t) { t.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 1800)); }
      const r = t ? t.getBoundingClientRect() : div.getBoundingClientRect();
      return { x: Math.max(0, r.left - 20), y: Math.max(0, r.top - 40), width: 520, height: 340 };
    })()`);
    const shot = await p.send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 2.5 } });
    const fn = join(root, "test", "out", `chrome-${tag}-${FILTER.replace(/\W+/g, "")}-p${PAGE}.png`);
    writeFileSync(fn, Buffer.from(shot.data, "base64"));
    console.log("saved", fn);
  };

  await shoot("fresh", false);
  await shoot("fresh-xray", true);
  // micro x-ray of one line with span-edge markers
  {
    const clip3 = await ev(`(() => {
      const v = window.PDFViewerApplication.pdfViewer;
      const div = v.getPageView(${PAGE - 1}).textLayer.div;
      const s = [...div.querySelectorAll('span')].find(el => el.textContent.includes("Consider two deviations"));
      if (!s) return null;
      const r = s.getBoundingClientRect();
      for (const [x, c] of [[r.left, 'blue'], [r.right, 'lime']]) {
        const m = document.createElement('div');
        m.style.cssText = 'position:fixed;top:' + (r.top - 8) + 'px;height:' + (r.height + 16) + 'px;width:1.2px;background:' + c + ';left:' + x + 'px;z-index:99999';
        document.body.append(m);
      }
      return { x: Math.max(0, r.left - 10), y: Math.max(0, r.top - 12), width: Math.min(320, innerWidth - r.left), height: 44 };
    })()`);
    if (clip3) {
      const shot3 = await p.send("Page.captureScreenshot", { format: "png", clip: { ...clip3, scale: 5 } });
      writeFileSync(join(root, "test", "out", `chrome-microxray-${FILTER.replace(/\W+/g, "")}-p${PAGE}.png`), Buffer.from(shot3.data, "base64"));
      console.log("saved micro-xray capture");
    }
  }
  if (IDLE) {
    await ev(`document.getElementById('fx-xray')?.remove()`);
    console.log(`idling ${IDLE}s (font-eviction window)...`);
    await sleep(IDLE * 1000);
    await shoot("idle", false);
    await shoot("idle-xray", true);
    // width drift check: fx spans vs their pristine width
    const drift = await ev(`(() => {
      const v = window.PDFViewerApplication.pdfViewer;
      const pv = v.getPageView(${PAGE - 1});
      if (!pv?.textLayer) return null;
      let n = 0, over = 0;
      for (const s of pv.textLayer.div.querySelectorAll('span[data-fx-done]')) { n++; }
      return { spans: n };
    })()`);
    console.log("post-idle:", JSON.stringify(drift));
  }
  console.log("DONE");
} catch (e) { console.error("chrome-xray error:", e.message || e); }
finally { if (!KEEP) { try { browser.kill(); } catch {} } await sleep(300); }
