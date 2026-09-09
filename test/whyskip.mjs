// Why did the engine leave this prose alone?
//
// Turns on `globalThis.__fxDebug` BEFORE reading mode is enabled, so every skip
// records its reason in `data-fx-why`, then lists the unprocessed PROSE spans
// with that reason and their position down the page.
//
// Reasons come from two places: #classifyBlocks (caption, line-head, runin,
// blk-table, fig-body, …) and the candidate filter (margin-band, over-body,
// special-or-short, script-attach, left-margin). The filter used to record
// nothing at all, so an unprocessed line read as "(none)" — indistinguishable
// from a line the engine never saw. That ambiguity hid a real bug: a fixed 6%
// footer band was swallowing the last line of body text on papers with a tight
// bottom margin, on 12 of one document's 20 pages, in complete silence.
//
// `trailing` counts unreasoned prose sitting at or below everything the engine
// processed — the "last line of the column left alone" shape. It should be 0.
//
// Usage: node test/whyskip.mjs --url=<pdf> [--label=name] [--page=N | --all]
import { spawn } from "node:child_process";
import { appendFileSync, rmSync } from "node:fs";
import { browserPath, extensionDir, profileDir } from "./lib/env.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const ALL = process.argv.includes("--all");
const URL0 = arg("url"), LABEL = arg("label", "doc"), PAGE = parseInt(arg("page", "4"), 10), ZOOM = arg("zoom", "1.8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 13100 + (process.pid % 300);
const userDataDir = profileDir(`whyprobe-${PORT}`);
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
  await send("Runtime.enable");
  for (let i = 0; i < 40; i++) { if (await ev(`!!(window.PDFViewerApplication?.pdfDocument)`).catch(() => false)) break; await sleep(500); }
  // __fxDebug must be set BEFORE the engine runs, or the reasons are never recorded.
  await ev(`(() => { globalThis.__fxDebug = true; return true; })()`);
  await ev(`(() => { const s = document.createElement("style");
    s.textContent = "#sidebarContainer{display:none!important}#outerContainer.sidebarOpen #viewerContainer{inset-inline-start:0!important}";
    document.head.appendChild(s); return true; })()`);
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
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
  const probe = (page) => ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page - 1});
    if (!pv || !pv.textLayer) return null;
    const pr = pv.div.getBoundingClientRect();
    const spans = [...pv.textLayer.div.querySelectorAll(":scope > span")]
      .filter((s) => !s.classList.contains("endOfContent"));
    const prose = (t) => ((t || "").match(/[a-z]{2,}/g) || []).length >= 2;
    const rows = [];
    for (const s of spans) {
      const t = (s.textContent || "").trim();
      if (!prose(t) || s.hasAttribute("data-fx-done")) continue;
      const r = s.getBoundingClientRect();
      if (r.top - pr.top < 0 || r.bottom - pr.top > pr.height) continue; // page stamps
      rows.push({ y: Math.round(r.top - pr.top),
                  why: s.dataset.fxWhy || (s.hasAttribute("data-fx-keep") ? "(keep)" :
                        s.hasAttribute("data-fx-table") ? "(table)" : "(none)"),
                  text: t.slice(0, 30) });
    }
    const done = [...pv.textLayer.div.querySelectorAll("span[data-fx-done]")]
      .map((s) => Math.round(s.getBoundingClientRect().bottom - pr.top));
    const lowest = done.length ? Math.max(...done) : null;
    const unreasoned = rows.filter((r) => r.why === "(none)");
    // Is an unreasoned prose span BELOW everything the engine processed? That is
    // the "last line of the column left alone" shape.
    const belowAll = lowest === null ? [] : unreasoned.filter((r) => r.y >= lowest - 4);
    const byWhy = {};
    for (const r of rows) byWhy[r.why] = (byWhy[r.why] || 0) + 1;
    return { page: ${page}, unprocessedProse: rows.length, unreasoned: unreasoned.length,
             trailing: belowAll.length, byWhy,
             sample: unreasoned.slice(0, 3).map((r) => r.text) };
  })()`);

  const report = [];
  if (ALL) {
    const n = await ev(`window.PDFViewerApplication.pdfDocument.numPages`);
    for (let p = 1; p <= n; p++) {
      await ev(`(() => { window.PDFViewerApplication.page = ${p}; return true; })()`);
      await sleep(1200);
      let st = "", stab = 0;
      for (let i = 0; i < 40; i++) {
        const cur = await ev(`(() => { const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
          if (!pv || !pv.textLayer) return "0/0";
          return pv.textLayer.div.querySelectorAll("span[data-fx-done]").length + "/" +
                 pv.textLayer.div.querySelectorAll(".fx-b").length; })()`).catch(() => "x");
        if (cur === st) { if (++stab >= 5) break; } else { stab = 0; st = cur; }
        await sleep(500);
      }
      const r = await probe(p);
      if (r) report.push(r);
    }
  } else {
    report.push(await probe(PAGE));
  }
  const line = `${LABEL} ${JSON.stringify(report)}`;
  console.log(line);
  appendFileSync("test/out/whyskip.log", line + String.fromCharCode(10));
} catch (e) { console.error(`${LABEL} why-probe error: ${e.message || e}`); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} process.exit(process.exitCode ?? 0); }
