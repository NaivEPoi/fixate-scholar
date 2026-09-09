// Capture ONE named word, zoomed, with the engine's own verdict beside it.
//
// The gate requires a claimed defect to name the exact word and be re-verified
// before anyone acts on it. Hunting for that word by guessing crop coordinates
// is how a downsampling artifact gets promoted to a defect, so this finds the
// word in the text layer, reports what the engine did to it, and clips the
// screenshot to its own rect plus padding.
//
// Read the reported state before believing an eye:
//   processed=false keep=true   the engine deliberately left it on the canvas,
//                               so ABSENT emphasis there is correct
//   emph=0                      no emphasis runs exist in that span, which
//                               falsifies "emphasis applied here" outright
//   processed=true, emph=[...]   emphasis is applied; the list is the exact
//                               character runs, so a mid-word run is visible
//
// During the v1.0.8 gate about twenty claimed defects went through this and
// every one turned out to be a downsampling artifact, by-design behaviour, or
// the manuscript's own typo.
//
// Usage: --url= --label= --page=N --find="word" [--pad=60] [--zoom=2.6] [--nth=1]
import { spawn } from "node:child_process";
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { browserPath, extensionDir, outDir, profileDir } from "./lib/env.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url"), LABEL = arg("label", "doc"), PAGE = parseInt(arg("page", "1"), 10);
const FIND = arg("find"), PAD = parseInt(arg("pad", "60"), 10), ZOOM = arg("zoom", "2.6");
const NTH = parseInt(arg("nth", "1"), 10);
if (!URL0 || !FIND) { console.error('usage: --url= --page=N --find="word"'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 12600 + (process.pid % 300);
const userDataDir = profileDir(`wordshot-${PORT}`);
const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-sync", "--window-size=2600,2400", `--user-data-dir=${userDataDir}`,
  `--load-extension=${extensionDir}`, `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
let ws, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id !== id) return;
    ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); };
  ws.addEventListener("message", h); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300));
  return r.result.value;
};
try {
  for (let i = 0; i < 60; i++) { try { await http("/json/version"); break; } catch { await sleep(400); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(400);
  }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  await sleep(2500);
  const live = (await http("/json/list")).find((t) => t.id === tab.id) ?? tab;
  ws = new WebSocket(live.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable"); await send("Page.enable");
  for (let i = 0; i < 40; i++) { if (await ev(`!!(window.PDFViewerApplication?.pdfDocument)`).catch(() => false)) break; await sleep(500); }
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  await ev(`(() => { const s = document.createElement("style");
    s.textContent = "#sidebarContainer{display:none!important}#outerContainer.sidebarOpen #viewerContainer{inset-inline-start:0!important}";
    document.head.appendChild(s); return true; })()`);
  await ev(`(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)};
    window.PDFViewerApplication.page = ${PAGE}; return true; })()`);
  await sleep(3000);
  let stable = 0, last = "";
  for (let i = 0; i < 60; i++) {
    const st = await ev(`(() => { const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
      if (!pv || !pv.textLayer) return "0/0";
      return pv.textLayer.div.querySelectorAll("span[data-fx-done]").length + "/" +
             pv.textLayer.div.querySelectorAll(".fx-b").length; })()`).catch(() => "x");
    if (st === last && !st.startsWith("0/")) { if (++stable >= 8) break; } else { stable = 0; last = st; }
    await sleep(600);
  }
  // Scroll the word into view BEFORE measuring. A word near the page bottom sits
  // outside the rendered viewport, and the clip then captures blank space that
  // reads as a whited-out region - which is a defect report manufactured by the
  // tool. Scroll first, settle, then measure.
  await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const needle = ${JSON.stringify(FIND)};
    const tops = [...pv.textLayer.div.querySelectorAll(":scope > span")]
      .filter((s) => (s.textContent || "").includes(needle));
    if (!tops.length) return false;
    tops[Math.min(${NTH} - 1, tops.length - 1)].scrollIntoView({ block: "center" });
    const vc = document.getElementById("viewerContainer");
    if (vc) vc.scrollTop = Math.round(vc.scrollTop);
    return true;
  })()`);
  await sleep(1800);
  const hit = await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const needle = ${JSON.stringify(FIND)};
    const tops = [...pv.textLayer.div.querySelectorAll(":scope > span")]
      .filter((s) => (s.textContent || "").includes(needle));
    if (!tops.length) return { found: 0 };
    const s = tops[Math.min(${NTH} - 1, tops.length - 1)];
    const r = s.getBoundingClientRect();
    const pr = pv.div.getBoundingClientRect();
    const emph = [...s.querySelectorAll(".fx-b")].map((b) => b.textContent);
    return { found: tops.length, text: (s.textContent || "").slice(0, 90),
             processed: s.hasAttribute("data-fx-done"),
             keep: s.hasAttribute("data-fx-keep") || s.hasAttribute("data-fx-table"),
             emphasized: emph.slice(0, 8), emphCount: emph.length,
             rect: { x: Math.round(r.x - pr.x), y: Math.round(r.y - pr.y),
                     w: Math.round(r.width), h: Math.round(r.height) },
             page: { x: Math.max(0, Math.round(pr.x)), y: Math.max(0, Math.round(pr.y)),
                     w: Math.round(pr.width), h: Math.round(pr.height) },
             // Clip from the span's OWN viewport rect. Deriving it as
             // page.y + rect.y breaks the moment the page top scrolls above the
             // viewport: page.y is clamped at 0 while rect.y is measured from
             // the true (negative) page top, so the sum lands far below the
             // word and the capture comes back blank.
             view: { x: Math.round(r.x), y: Math.round(r.y),
                     w: Math.round(r.width), h: Math.round(r.height) },
             offscreen: r.bottom <= 0 || r.top >= window.innerHeight };
  })()`);
  if (!hit.found) { console.log(`${LABEL} p${PAGE} find=${JSON.stringify(FIND)} NOT FOUND in the text layer`); }
  else {
    const cx = Math.max(0, hit.view.x - PAD);
    const cy = Math.max(0, hit.view.y - PAD);
    if (hit.offscreen) console.log(`${LABEL} p${PAGE} WARNING: word still outside the viewport after scrolling`);
    const shot = await send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: cx, y: cy, width: Math.min(hit.view.w + PAD * 2, hit.page.w),
              height: hit.view.h + PAD * 2, scale: 1 },
    });
    const file = `${outDir()}/word-${LABEL}-p${PAGE}-${FIND.replace(/\W+/g, "").slice(0, 14)}.png`;
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    const line = `${LABEL} p${PAGE} ${JSON.stringify(FIND)} found=${hit.found} processed=${hit.processed} keep=${hit.keep} emph=${hit.emphCount} ${JSON.stringify(hit.emphasized)} -> ${file}`;
    console.log(line);
    appendFileSync("test/out/wordshot.log", line + String.fromCharCode(10));
  }
} catch (e) { console.error(`${LABEL} word-shot error: ${e.message || e}`); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} process.exit(process.exitCode ?? 0); }
