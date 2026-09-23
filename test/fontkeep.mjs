// Invariant guard: a span set in a math, monospace, small-caps or bold-display
// face is NEVER processed. REQUIREMENTS.md states it (the "kept on canvas +
// obstacle" rows); nothing checked it, so "emphasis inside a code span" could
// only ever be argued about from screenshots — and it was, five times in one
// gate, wrongly every time. The tokens carrying emphasis in those papers were
// set in the BODY face, where the engine has no signal that they are code.
//
// Reads the font off the PROCESSED SPAN itself: #fontFamilyFor writes the
// item's own PDF.js fontName as the span's first CSS family, which resolves
// through commonObjs to the real font name — the same string the engine's own
// filter tests. No span<->item index alignment, which is what made an earlier
// version of this check inconclusive on 7 of 31 pages: PDF.js does not always
// emit one span per text item, and a mapping by DOM order degrades silently.
//
// Note the font id is read UNQUOTED: the engine writes it quoted, but CSSOM
// serializes a valid custom ident without quotes, so a pattern anchored on a
// quote matches nothing and every page reports a clean zero.
//
// Fails the run (exit 1) on any violation, and ALSO when it resolved no fonts
// at all — a check that reads zero because it is blind is worse than no check.
//
// The probe and the verdict live in test/probes/fontkeep.mjs, shared with the
// combined gate runner (test/allprobes.mjs); this file drives one browser.
// Usage: node test/fontkeep.mjs --url=<pdf> [--label=name] [--page=N | --all]
import { spawn } from "node:child_process";
import { appendFileSync, rmSync } from "node:fs";
import { browserPath, extensionDir, profileDir, killBrowser } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";
import * as fontkeep from "./probes/fontkeep.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url"), LABEL = arg("label", "doc"), PAGE = parseInt(arg("page", "6"), 10), ZOOM = arg("zoom", "1.8");
const HEIGHT = arg("height", "2400");
const ALL = process.argv.includes("--all");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 11400 + (process.pid % 300);
const userDataDir = profileDir(`privprobe-${PORT}`);
const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-sync", `--window-size=2600,${HEIGHT}`, `--user-data-dir=${userDataDir}`,
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
  const tab = await http(`/json/new?${`chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`}`, "PUT");
  await sleep(2500);
  const live = (await http("/json/list")).find((t) => t.id === tab.id) ?? tab;
  cdp = connect(live.webSocketDebuggerUrl, { where: "viewer" });
  await cdp.ready;
  await send("Runtime.enable");
  for (let i = 0; i < 40; i++) { if (await ev(`!!(window.PDFViewerApplication?.pdfDocument)`).catch(() => false)) break; await sleep(500); }
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  await ev(`(() => { const s = document.createElement("style");
    s.textContent = "#sidebarContainer{display:none!important}#outerContainer.sidebarOpen #viewerContainer{inset-inline-start:0!important}";
    document.head.appendChild(s); return true; })()`);
  await ev(`(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)}; return true; })()`);
  await ev(`(() => { window.PDFViewerApplication.page = ${PAGE}; return true; })()`);
  await sleep(4000);

  const settle = async (page) => {
    let last = "";
    let stable = 0;
    for (let i = 0; i < 60; i++) {
      const cur = await ev(`(() => {
        const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page} - 1);
        if (!pv || !pv.textLayer) return "0/0";
        return pv.textLayer.div.querySelectorAll("span[data-fx-done]").length + "/" +
               pv.textLayer.div.querySelectorAll(".fx-b").length;
      })()`).catch(() => "x");
      if (cur === last) { if (++stable >= 5) return; } else { stable = 0; last = cur; }
      await sleep(400);
    }
  };

  const pages = ALL ? await ev(`window.PDFViewerApplication.pdfDocument.numPages`) : null;
  const state = fontkeep.create();
  for (const pg of ALL ? Array.from({ length: pages }, (_, i) => i + 1) : [PAGE]) {
    await ev(`(() => { window.PDFViewerApplication.page = ${pg}; return true; })()`);
    await sleep(700);
    await settle(pg);
    const r = await ev(fontkeep.probe(pg));
    const { out, err } = fontkeep.add(state, pg, r);
    for (const l of out) console.log(l);
    for (const l of err) console.error(l);
  }
  const verdict = fontkeep.summarize(state, { label: LABEL });
  for (const l of verdict.out) console.log(l);
  for (const l of verdict.err) console.error(l);
  if (verdict.logLine) appendFileSync("test/out/fontkeep.log", verdict.logLine + String.fromCharCode(10));
  if (!verdict.ok) process.exitCode = 1;
} catch (e) { console.error(`${LABEL} probe error: ${e.message || e}`); process.exitCode = 1; }
finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
