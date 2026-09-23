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
// EXIT 1 when it isn't — and when `unreasoned` isn't either. Until R41 this
// script exited non-zero only on an exception, so a sweep of it reported
// "31/31 PASS" while proving nothing about the criterion stated right here, and
// its numbers had to be dug out of the per-document output. Both counts are now
// the pass criterion, and a run that examined no prose at all fails too, so it
// cannot pass blind the way the checks in R36 did.
//
// `unreasoned` is fatal because "every skip path records a reason" is an
// invariant the engine can hold: the reason is what makes the NEXT bug of the
// R35 class findable instead of silent. Closing the last three gaps (link-annot,
// url-or-math, overlaps-skipped) is what made it 0 across both corpora.
//
// The probe and the verdict live in test/probes/whyskip.mjs, shared with the
// combined gate runner (test/allprobes.mjs); this file drives one browser.
// Usage: node test/whyskip.mjs --url=<pdf> [--label=name] [--page=N | --all]
import { spawn } from "node:child_process";
import { appendFileSync, rmSync } from "node:fs";
import { browserPath, extensionDir, profileDir, killBrowser } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";
import * as whyskip from "./probes/whyskip.mjs";

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

let cdp;
const send = (method, params) => cdp.send(method, params);
const ev = (expr) => cdp.ev(expr);

try {
  for (let i = 0; i < 60; i++) { try { await http("/json/version"); break; } catch { await sleep(400); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(400);
  }
  if (!extId) throw new Error("extension did not load");
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  await sleep(2500);
  const live = (await http("/json/list")).find((t) => t.id === tab.id) ?? tab;
  cdp = connect(live.webSocketDebuggerUrl, { where: "viewer" });
  await cdp.ready;
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

  const state = whyskip.create();
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
      const r = await ev(whyskip.probe(p));
      const { out, err } = whyskip.add(state, p, r);
      for (const l of out) console.log(l);
      for (const l of err) console.error(l);
    }
  } else {
    const r = await ev(whyskip.probe(PAGE));
    const { out, err } = whyskip.add(state, PAGE, r);
    for (const l of out) console.log(l);
    for (const l of err) console.error(l);
  }
  const verdict = whyskip.summarize(state, { label: LABEL });
  for (const l of verdict.out) console.log(l);
  for (const l of verdict.err) console.error(l);
  if (verdict.logLine) appendFileSync("test/out/whyskip.log", verdict.logLine + String.fromCharCode(10));
  if (!verdict.ok) process.exitCode = 1;
} catch (e) { console.error(`${LABEL} why-probe error: ${e.message || e}`); process.exitCode = 1; }
finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
