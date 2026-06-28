// Launch a HEADFUL Chrome on the real display (so devicePixelRatio = the user's
// actual scaling, e.g. 1.75), load the current extension, drive it to a PDF via
// the DNR redirect, enable fx + debug, set zoom, and measure the overlay-vs-canvas
// baseline + report the per-page calibration that fired. Fresh profile so remote
// debugging is allowed and the user's profile is untouched.
// Usage: node test/live-chrome.mjs [zoom]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ZOOM = parseFloat(process.argv[2] ?? "1.25");
const PDF = "https://yilud.me/usenixsecurity24-tu.pdf"; // .pdf → request-stage DNR rule (most reliable redirect)
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9222;
const userDataDir = join(tmpdir(), `fx-live-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, "--no-first-run", "--no-default-browser-check",
  "--disable-sync", "--disable-features=DisableLoadExtensionCommandLineSwitch",
  `--user-data-dir=${userDataDir}`,
  `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };

const HELPER = `window.__inkBottom = (pv, x0, x1, yc, half) => {
  const canvas = pv.canvas || pv.div.querySelector('canvas'); if (!canvas) return null;
  const cr = canvas.getBoundingClientRect(), sx = canvas.width/cr.width, sy = canvas.height/cr.height;
  const px0=Math.max(0,Math.floor((x0-cr.left)*sx)),px1=Math.min(canvas.width,Math.ceil((x1-cr.left)*sx)),py0=Math.max(0,Math.floor((yc-half-cr.top)*sy)),py1=Math.min(canvas.height,Math.ceil((yc+half-cr.top)*sy));
  if(px1<=px0||py1<=py0)return null; let d; try{d=canvas.getContext('2d').getImageData(px0,py0,px1-px0,py1-py0).data}catch(e){return null}
  const W=px1-px0,H=py1-py0,k=[]; for(let r=0;r<H;r++){let n=0;for(let c=0;c<W;c++){const i=(r*W+c)*4,l=.299*d[i]+.587*d[i+1]+.114*d[i+2];if(d[i+3]>40&&l<140)n++}k.push(n>=2)}
  const yv=r=>(py0+r)/sy+cr.top,cl=[];let s=-1,g=0;for(let r=0;r<=H;r++){if(r<H&&k[r]){if(s<0)s=r;g=0}else if(s>=0){g++;if(g>Math.ceil(2*sy)||r===H){cl.push([yv(s),yv(r-g)]);s=-1;g=0}}}
  const yd=yc; let bb=null,bo=0; for(const[a,b]of cl){const ov=Math.min(yc+half,b)-Math.max(yc-half,a);if(ov>bo&&a-half<=yd&&b+half>=yd){bo=ov;bb=b}} return bb;
};`;

const MEASURE = `(() => {
  const r2=n=>Math.round(n*100)/100, v=window.PDFViewerApplication.pdfViewer, pv=v.getPageView(v.currentPageNumber-1), div=pv&&pv.textLayer&&pv.textLayer.div;
  if(!div) return {error:'no text layer'};
  const gl=s=>{const rg=document.createRange();rg.selectNodeContents(s);const rs=[...rg.getClientRects()].filter(r=>r.width>0);if(!rs.length)return null;let t=1e9,b=-1e9,l=1e9,r=-1e9;for(const q of rs){t=Math.min(t,q.top);b=Math.max(b,q.bottom);l=Math.min(l,q.left);r=Math.max(r,q.right)}return{top:t,bottom:b,left:l,right:r}};
  const dn=[...div.querySelectorAll('span[data-fx-done]')].filter(s=>s.textContent.trim().length>4&&!/[gjpqy,]/.test(s.textContent)),bt=[],tp=[];
  for(const s of dn.slice(0,40)){const o=gl(s);if(!o)continue;const lh=o.bottom-o.top,bb=window.__inkBottom(pv,o.left,o.right,(o.top+o.bottom)/2,lh*0.8);if(bb==null)continue;bt.push(bb-o.bottom)}
  const md=a=>{if(!a.length)return null;const x=[...a].sort((p,q)=>p-q);return r2((x[Math.floor((x.length-1)/2)]+x[Math.ceil((x.length-1)/2)])/2)};
  return {dpr:window.devicePixelRatio, pdfZoom:r2(v.currentScale), page:v.currentPageNumber, samples:bt.length, medBotErr:md(bt), calib:globalThis.__fxBaselineCalib||null};
})()`;

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  if (!version) throw new Error("Chrome debug port never came up");
  console.log("Browser:", version.Browser);
  let extId = null, lastList = [];
  for (let i = 0; i < 80 && !extId; i++) {
    lastList = await http("/json/list");
    const sw = lastList.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"))
      || lastList.find((x) => x.url.includes("chrome-extension://") && x.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(400);
  }
  console.log("extension:", extId || "NOT LOADED");
  if (!extId) { console.log("targets:", JSON.stringify(lastList.map((t) => ({ type: t.type, url: (t.url || "").slice(0, 70) })))); throw new Error("extension SW not found"); }
  await sleep(2000); // let the SW register DNR rules
  const tab = await http(`/json/new?${PDF}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable"); await send("Runtime.enable");
  // Wait for the DNR redirect into the viewer.
  let href = "";
  for (let i = 0; i < 40; i++) { await sleep(700); href = await ev(`location.href`).catch(() => ""); if (/viewer\.html/.test(href)) break; }
  if (!/viewer\.html/.test(href)) { console.log("DNR did NOT redirect; stuck at:", href.slice(0, 80)); throw new Error("redirect failed"); }
  console.log("redirected into viewer ✓");
  for (let i = 0; i < 40; i++) { const ok = await ev(`!!(window.PDFViewerApplication&&window.PDFViewerApplication.pdfViewer)`).catch(() => false); if (ok) break; await sleep(400); }
  await ev(`globalThis.__fxDebug = true`);
  let ok = false; for (let i = 0; i < 25; i++) { ok = await ev(`!!(chrome&&chrome.storage&&chrome.storage.sync)`).catch(() => false); if (ok) break; await sleep(400); }
  if (ok) await ev(`new Promise(r=>chrome.storage.sync.set({enabled:true},r))`);
  for (let i = 0; i < 40; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 60) break; }
  await ev(`window.PDFViewerApplication.pdfViewer.currentScale = ${ZOOM}`); await sleep(2500);
  await ev(`window.PDFViewerApplication.page = 3`); await sleep(2800);
  await ev(HELPER);
  const out = await ev(MEASURE);
  console.log("RESULT:", JSON.stringify(out, null, 1));
} catch (e) { console.error("live error:", e.message); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(800); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
