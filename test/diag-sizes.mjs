// How small is the text the engine processes, relative to body text? Every
// page of one document, with __fxDebug on (the engine then records each
// candidate's height / document body height as data-fx-h). Prints the
// distribution of PROCESSED spans by that ratio, and every processed span
// below --below, so a size cut can be chosen from what papers actually set
// instead of guessed — and checked for prose it would take with it.
// Usage: node test/diag-sizes.mjs --url=<pdf> [--label=name] [--below=0.7] [--zoom=1.0]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { browserPath, extensionDir, profileDir, killBrowser, devtoolsPort } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url");
const LABEL = arg("label", "doc");
const BELOW = parseFloat(arg("below", "0.7"));
const ZOOM = arg("zoom", "1.0");
if (!URL0) {
  console.error("usage: node test/diag-sizes.mjs --url=<pdf> [--label=name] [--below=0.7] [--zoom=1.0]");
  process.exit(2);
}
let PORT = 0; // the free port the browser chose (lib/env.mjs devtoolsPort)
const userDataDir = profileDir("sizes");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => {
  PORT ||= await devtoolsPort(userDataDir, launched);
  return (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
};

const launched = Date.now();
const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=0`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1300,1900",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

// tables.mjs's "handled": every prose leaf span processed or given a reason.
const HANDLED = (p) => `(() => {
  const d = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;
  if (!d) return null;
  let prose = 0, handled = 0;
  for (const s of d.querySelectorAll("span")) {
    if (s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")) continue;
    if (s.matches(".fx-cite-c, .fx-ref-c, .fx-sp")) continue;
    if (((s.textContent || "").match(/[a-z]{2,}/g) || []).length < 2) continue;
    prose++;
    if (s.closest("[data-fx-done], [data-fx-why], [data-fx-keep], [data-fx-table]")) handled++;
  }
  return { prose, handled };
})()`;
const READ = (p) => `(() => {
  const d = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;
  if (!d) return [];
  return [...d.querySelectorAll("span[data-fx-done][data-fx-h]")].map((s) => [+s.dataset.fxH, s.textContent.trim().length, s.textContent.trim().slice(0, 48)]);
})()`;

let cdp;
const ev = (expr) => cdp.ev(expr);
try {
  let extId = null;
  for (let i = 0; i < 80 && !extId; i++) {
    try {
      const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
      if (sw) extId = new URL(sw.url).hostname;
    } catch { /* not up yet */ }
    if (!extId) await sleep(300);
  }
  if (!extId) throw new Error("extension did not load");
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  cdp = connect(tab.webSocketDebuggerUrl, { where: "viewer", timeoutMs: 90000 });
  await cdp.ready;
  await cdp.send("Page.enable");
  await sleep(2500);
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { ok = await ev(`!!window.PDFViewerApplication?.pdfDocument`).catch(() => false); if (!ok) await sleep(500); }
  if (!ok) throw new Error("viewer never loaded");
  await ev(`globalThis.__fxDebug = true`);
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:false},r))`);
  await ev(`window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)}`);
  await sleep(1500);
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true},r))`);
  const pages = await ev(`window.PDFViewerApplication.pagesCount`);
  const bins = new Map(); // ratio bin (0.05) -> chars processed
  const small = [];
  let unhandled = 0;
  for (let p = 1; p <= pages; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`);
    let st = null;
    for (let i = 0; i < 40; i++) {
      await sleep(700);
      st = await ev(HANDLED(p));
      if (st && (st.prose < 3 || st.handled === st.prose)) break;
    }
    if (!st || (st.prose >= 3 && st.handled < st.prose)) unhandled++;
    for (const [h, n, t] of await ev(READ(p))) {
      const b = Math.floor(h * 20) / 20;
      bins.set(b, (bins.get(b) || 0) + n);
      if (h < BELOW) small.push(`p${p} ${h.toFixed(2)} "${t}"`);
    }
  }
  const total = [...bins.values()].reduce((a, b) => a + b, 0);
  const dist = [...bins.entries()].sort((a, b) => a[0] - b[0]).filter(([b]) => b < 0.9)
    .map(([b, n]) => `${b.toFixed(2)}:${n}`).join(" ");
  console.log(`${LABEL}: pages=${pages} processed-chars=${total} below-0.9 by ratio: ${dist || "(none)"}${unhandled ? `  (${unhandled} page(s) not fully handled)` : ""}`);
  for (const l of small.slice(0, 40)) console.log(`   ${l}`);
  if (small.length > 40) console.log(`   ... ${small.length - 40} more`);
} catch (e) {
  console.error(`${LABEL} diag-sizes error: ${e.message || e}`);
  process.exitCode = 1;
} finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
