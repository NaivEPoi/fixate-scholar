// Highlight-annotation regression. Verifies the PDF.js highlight editor works
// alongside the typography overlay:
//  1. a text highlight can be created (retried — synthetic drags are flaky);
//  2. in reading mode the fx mask sits BELOW the highlight draw layer inside
//     .canvasWrapper, so highlights show over PROCESSED text (mix-blend multiply
//     over the white mask, overlay text on top);
//  3. the highlight saves into the PDF (saveDocument emits /Highlight +
//     /QuadPoints) and survives a reload (getAnnotations finds it) — so it is
//     stored with the file and mirrors onto the original text on fx-off;
//  4. while the highlight editor is active, citation hit-targets are
//     pointer-events:none so a selection can start over a citation.
// Usage: node test/highlights.mjs [url] [page]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const URL0 = process.argv[2] ?? "https://yilud.me/Proteus-ccs24.pdf";
const PAGE = parseInt(process.argv[3] ?? "2", 10);
const EXT = "C:\\misc\\Claude_Workspace\\fixate-scholar\\extension";
const PORT = 9911 + (process.pid % 120);
const userDataDir = join(tmpdir(), `fx-hlt-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank"], { stdio: "ignore" });
let ws, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  ws.addEventListener("message", h); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text||"").slice(0,500)); return r.result.value; };
const drag = async (x0, x1, y) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 8; i++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / 8, y, button: "left", buttons: 1 }); await sleep(45); }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, button: "left", clickCount: 1 });
};
const fail = (m) => { console.error("FAIL:", m); failed = true; };
let failed = false;
try {
  let v=null; for (let i=0;i<50&&!v;i++){try{v=await http("/json/version");}catch{await sleep(300);}}
  let extId=null; for (let i=0;i<60&&!extId;i++){const t=await http("/json/list");const sw=t.find((x)=>x.type==="service_worker"&&x.url.includes("service-worker.mjs"));if(sw)extId=new URL(sw.url).hostname;else await sleep(300);}
  const tab=await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`,"PUT");
  ws=new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r)=>(ws.onopen=r));
  await send("Page.enable"); await send("Runtime.enable"); await send("Input.enable").catch(()=>{});
  await sleep(3000);
  for (let i=0;i<25;i++){const ok=await ev("!!(chrome&&chrome.storage&&chrome.storage.sync)").catch(()=>false);if(ok)break;await sleep(400);}
  await ev("new Promise((r)=>chrome.storage.sync.set({enabled:true},r))"); await sleep(3500);
  for (let i=0;i<30;i++){await sleep(700);const b=await ev("document.querySelectorAll('.textLayer .fx-b').length").catch(()=>0);if(b>80)break;}
  await ev(`window.PDFViewerApplication.page = ${PAGE}`); await sleep(4000);

  await ev(`document.getElementById('editorHighlightButton').click()`); await sleep(800);

  // (4) citation hit-targets drop pointer-events while editing.
  const pe = await ev(`(() => { const a = document.querySelector('.fx-cite-hit'); return a ? getComputedStyle(a).pointerEvents : 'no-hit'; })()`);
  console.log("citation hit-target pointer-events while editing:", pe);
  if (pe === "auto") fail("citation hit-target still intercepts pointer events while editing (blocks selection)");

  // (1) create a highlight — retry the flaky synthetic drag.
  let made = null;
  for (let attempt = 0; attempt < 5 && !(made && made.storage > 0); attempt++) {
    const t = await ev(`(() => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
      const spans = [...pv.textLayer.div.querySelectorAll('span')].filter((s) => {
        const r = s.getBoundingClientRect();
        return (s.textContent||'').trim().split(/\\s+/).length >= 6 && r.width > 200 && r.top > 150 && r.bottom < innerHeight - 120;
      });
      const s = spans[Math.floor(spans.length * (0.3 + 0.1 * ${'${attempt}'}))] || spans[0];
      if (!s) return null; const r = s.getBoundingClientRect();
      return { x0: r.left + 6, x1: r.right - 6, y: (r.top + r.bottom) / 2 };
    })()`.replace('${attempt}', attempt));
    if (!t) { fail("no target span"); break; }
    await ev(`getSelection().removeAllRanges()`);
    await drag(t.x0, t.x1, t.y);
    await sleep(1300);
    made = await ev(`(() => { const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1}); return { editors: pv.div.querySelectorAll('.highlightEditor').length, storage: window.PDFViewerApplication.pdfDocument.annotationStorage.size }; })()`);
  }
  console.log("highlight created:", JSON.stringify(made));
  if (!made || made.storage < 1) fail("could not create a highlight after retries");

  // (2) stacking: inside canvasWrapper the fx-mask must precede the highlight svg.
  const order = await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const kids = [...pv.div.querySelector('.canvasWrapper').children];
    const maskIdx = kids.findIndex((c) => c.classList.contains('fx-mask'));
    const svgIdx = kids.findIndex((c) => c.tagName === 'svg' || c.querySelector?.('svg.highlight'));
    return { maskIdx, svgIdx, tags: kids.map((c) => c.tagName.toLowerCase() + (c.className ? '.' + String(c.className).split(' ')[0] : '')) };
  })()`);
  console.log("canvasWrapper order:", JSON.stringify(order.tags));
  if (order.maskIdx < 0) fail("fx-mask not found in canvasWrapper (reading mode not active?)");
  else if (order.svgIdx >= 0 && order.maskIdx > order.svgIdx) fail("fx-mask paints OVER the highlight draw layer — highlights would be hidden on processed text");

  // (3) save + round-trip.
  const saved = await ev(`(async () => {
    const bytes = await window.PDFViewerApplication.pdfDocument.saveDocument();
    globalThis.__saved = bytes;
    const s = new TextDecoder('latin1').decode(bytes);
    return { hasHighlight: /\\/Highlight/.test(s), hasQuadPoints: /\\/QuadPoints/.test(s) };
  })()`);
  console.log("saved:", JSON.stringify(saved));
  if (!saved.hasHighlight || !saved.hasQuadPoints) fail("saved PDF has no /Highlight annotation");
  const rt = await ev(`(async () => {
    const doc = await window.pdfjsLib.getDocument({ data: globalThis.__saved.slice() }).promise;
    const annots = await (await doc.getPage(${PAGE})).getAnnotations();
    return annots.filter((a) => a.subtype === 'Highlight').length;
  })()`);
  console.log("highlights after reload:", rt);
  if (rt < 1) fail("highlight did not survive save+reload");

  console.log(failed ? "HIGHLIGHTS: FAIL" : "HIGHLIGHTS: PASS");
} catch (e) { console.error("highlights error:", e.message || e); failed = true; }
finally { try{ws?.close();}catch{} browser.kill(); await sleep(500); try{rmSync(userDataDir,{recursive:true,force:true});}catch{} process.exit(failed ? 1 : 0); }
