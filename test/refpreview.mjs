// The hover preview of an in-paper reference (references/preview.mjs),
// end to end: open a paper, find a coloured in-paper reference on a page,
// hover it, and expect the popup to show a clip of the target page with the
// page number — found through the PDF's own link where the paper has one
// (hyperref), through the document's text where it has none.
// Usage: node test/refpreview.mjs [pdf-url] [--page=N] [--expect=link|text] [--find=Figure]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { browserPath, devtoolsPort, extensionDir, killBrowser, profileDir } from "./lib/env.mjs";

const URL0 = process.argv.slice(2).find((a) => !a.startsWith("--")) || "https://yilud.me/usenixsecurity24-tu.pdf";
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const PAGE = parseInt(arg("page", "3"), 10);
const EXPECT = arg("expect", "");
const FIND = arg("find", ""); // hover the first reference whose text contains this
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const udd = profileDir("refpreview");
const since = Date.now();
const browser = spawn(browserPath("edge"), [
  "--remote-debugging-port=0", "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-sync", "--window-size=1200,1600", `--user-data-dir=${udd}`,
  `--load-extension=${extensionDir}`, `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

let failed = false;
try {
  const port = await devtoolsPort(udd, since);
  const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${port}${p}`, { method: m })).json();
  let extId = null;
  for (let i = 0; i < 100 && !extId; i++) { const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result.value; };
  for (let i = 0; i < 80 && !(await ev("!!window.PDFViewerApplication?.pdfDocument").catch(() => false)); i++) await sleep(250);
  await ev("globalThis.__fxDebug = true; 1");
  await ev("new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))");
  // The first page from --page on with a coloured in-paper reference: a
  // page's references are coloured once its spans are done and the
  // annotation pass has run over them, which the document's own extraction
  // must precede.
  // With --expect=link only a reference under one of the PDF's own link
  // elements counts (the annotation layer sits above the text, so that is
  // where a hyperref'd reference's pointer lands), and it is that link the
  // harness hovers; the page scan keeps going until it finds one.
  // A reference is a run of wraps on one line, each starting where the last
  // ends ("Fig" "ure" " " "2": the engine wraps each text node, and the
  // emphasis elements sit between them); hyperref boxes only the number, so
  // the link is looked for under ANY wrap of the run, and the run's text is
  // what --find matches.
  const candidates = (page) => `(() => {
    const ws = [...document.querySelectorAll('.page[data-page-number="${page}"] .textLayer .fx-ref-c')].map((w) => ({ w, r: w.getBoundingClientRect() })).filter((x) => x.r.width > 0);
    const line = (x) => Math.round(x.r.top / Math.max(1, x.r.height * 0.5));
    ws.sort((a, b) => line(a) - line(b) || a.r.left - b.r.left);
    const runs = [];
    for (const x of ws) {
      const last = runs.at(-1)?.at(-1);
      if (last && line(last) === line(x) && x.r.left - last.r.right < x.r.height * 0.8) runs.at(-1).push(x); else runs.push([x]);
    }
    const links = [...document.querySelectorAll('.page[data-page-number="${page}"] .annotationLayer a')].filter((a) => !/^(https?|mailto):/i.test(a.getAttribute("href") || ""));
    const over = (x) => { const b = x.r; return links.find((a) => { const r = a.getBoundingClientRect(); return Math.min(r.right, b.right) - Math.max(r.left, b.left) > 0 && Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 0; }); };
    const out = [];
    for (const run of runs) {
      const text = run.map((x) => x.w.textContent).join("");
      if (!text.includes(${JSON.stringify(FIND)})) continue;
      if (${JSON.stringify(EXPECT)} === "link") { const x = run.find((y) => over(y)); if (x) out.push([text, over(x)]); }
      else out.push([text, run[0].w]);
    }
    return out;
  })()`;
  const numPages = await ev("PDFViewerApplication.pagesCount");
  let page = PAGE, wraps = 0;
  for (; page <= Math.min(numPages, PAGE + 10) && !wraps; page++) {
    await ev(`PDFViewerApplication.page = ${page}; 1`);
    for (let i = 0; i < 24 && !wraps; i++) {
      await sleep(500);
      wraps = await ev(`${candidates(page)}.length`);
    }
    if (wraps) break;
  }
  console.log(`page ${page}: ${wraps} in-paper reference wrap(s)${EXPECT === "link" ? " under a PDF link" : ""}`);
  if (!wraps) throw new Error(`no coloured in-paper reference${EXPECT === "link" ? " under a PDF link" : ""} on pages ${PAGE}-${page - 1}`);
  await sleep(1500);
  // The first reference, hovered at its own centre: what the reader does.
  const at = JSON.parse(await ev(`(() => {
    const [text, el] = ${candidates(page)}[0];
    el.scrollIntoView({ block: "center" });
    const r2 = el.getBoundingClientRect();
    return JSON.stringify({ text, viaLink: el.tagName === "A", x: r2.left + r2.width / 2, y: r2.top + r2.height / 2 });
  })()`));
  console.log(`hovering "${at.text}"${at.viaLink ? " through the PDF's link" : ""}`);
  await sleep(600);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(at.x), y: Math.round(at.y) });
  let shown = null;
  for (let i = 0; i < 30 && !shown; i++) {
    await sleep(200);
    shown = await ev(`(() => { const p = document.querySelector('.fx-cite-popup'); if (!p || p.hidden) return null; const v = p.querySelector('.fx-preview'); if (!v) return null; return JSON.stringify({ page: v.dataset.fxPreviewPage, head: v.querySelector('.fx-preview-head')?.textContent, canvas: !!v.querySelector('canvas'), snippet: (v.querySelector('.fx-preview-snippet')?.textContent || '').slice(0, 60) }); })()`);
  }
  if (!shown) throw new Error("no preview appeared within 6 s of hovering the reference");
  const got = JSON.parse(shown);
  const how = await ev("JSON.stringify((globalThis.__fxPreviews || []).at(-1) || null)");
  console.log(`preview: ${got.head} — canvas=${got.canvas} snippet="${got.snippet}" via ${JSON.parse(how)?.how}`);
  // The card as the reader sees it, for a look (test/out/refpreview-*.png).
  const clip = JSON.parse(await ev("(() => { const r = document.querySelector('.fx-cite-popup').getBoundingClientRect(); return JSON.stringify({ x: r.left - 4, y: r.top - 4, width: r.width + 8, height: r.height + 8 }); })()"));
  if (clip.width > 0 && clip.height > 0) {
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 2 } });
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { outDir } = await import("./lib/env.mjs");
    const file = join(outDir(), `refpreview-${(at.text || "ref").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 20)}-p${page}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(`card: ${file}`);
  }
  if (!got.canvas) throw new Error("the preview has no rendered clip");
  if (!/page \d+/.test(got.head)) throw new Error("the preview names no page");
  if (EXPECT && JSON.parse(how)?.how !== EXPECT) throw new Error(`expected the target found by ${EXPECT}, got ${JSON.parse(how)?.how}`);
  // Moving away hides it.
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: Math.round(at.y) + 120 });
  await sleep(800);
  const hidden = await ev("(() => { const p = document.querySelector('.fx-cite-popup'); return !p || p.hidden; })()");
  console.log(`moved away: popup hidden=${hidden}`);
  if (!hidden) throw new Error("the preview stayed after the pointer left");
  console.log("PASS — the reference's target previewed on hover, and hid after");
  ws.close();
} catch (e) {
  failed = true;
  console.error("refpreview error:", e.message || e);
} finally {
  killBrowser(browser);
  await sleep(500);
  try { rmSync(udd, { recursive: true, force: true }); } catch {}
}
process.exit(failed ? 1 : 0);
