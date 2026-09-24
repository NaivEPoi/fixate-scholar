// Invariant guard: no emphasis inside a DISPLAYED EQUATION.
//
// REQUIREMENTS.md and TESTING.md §3 both put displayed equations on the
// canvas, and nothing checked it. The defect that prompted this was invisible
// to every existing probe: `fontkeep` asks whether a processed span is set in
// a math FACE, and the offending token is not — LaTeX sets \exp, \cos, \min,
// \max, \log and \mod in upright ROMAN, the same face as body text, so the
// equation's operator name was emphasized while the symbols around it were
// left alone. `whyskip` was clean too, because nothing was wrongly SKIPPED.
//
// The criterion here is deliberately INDEPENDENT of the rule the engine uses
// to decide the same question. The engine classifies a row by the proportion
// of its items that look like symbols; if this harness asked the same
// question it could only ever agree with it, which is a test that cannot
// fail. So it keys on something the engine does not consult at all: a row
// carrying a trailing EQUATION NUMBER — "(5.6)", "(12)", "(A.3)" — hard
// against the column's right edge, with no running prose on it. That is a
// numbered displayed equation by the typesetting convention itself, and no
// span on such a row may be processed.
//
// Unnumbered equations are not examined: they have no such mark, and guessing
// at them is what the engine already does. This measures the subset it can be
// held to exactly.
//
// The probe and the verdict live in test/probes/eqkeep.mjs, shared with the
// combined gate runner (test/allprobes.mjs); this file drives one browser.
// Usage: node test/eqkeep.mjs --url=<pdf> [--label=name] [--page=N | --all] [--zoom=Z]
import { spawn } from "node:child_process";
import { appendFileSync, rmSync } from "node:fs";

import { browserPath, extensionDir, outDir, profileDir, killBrowser, devtoolsPort } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";
import * as eqkeep from "./probes/eqkeep.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const ZOOM = arg("zoom", null);
const URL0 = arg("url");
const LABEL = arg("label", "doc");
const PAGE = parseInt(arg("page", "6"), 10);
const ALL = process.argv.includes("--all");
if (!URL0) {
  console.error("usage: node test/eqkeep.mjs --url=<pdf> [--label=name] [--page=N | --all]");
  process.exit(2);
}
let PORT = 0; // the free port the browser chose (lib/env.mjs devtoolsPort)
const userDataDir = profileDir("eqkeep");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => {
  PORT ||= await devtoolsPort(userDataDir, launched);
  return (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
};

const launched = Date.now();
const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=0`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1500,2400",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

let cdp;
const send = (method, params) => cdp.send(method, params);
const ev = (expr) => cdp.ev(expr);

const settle = async (page) => {
  let last = "";
  let stable = 0;
  for (let i = 0; i < 60; i++) {
    const cur = await ev(`(() => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page} - 1);
      if (!pv || !pv.textLayer) return "x";
      return pv.textLayer.div.querySelectorAll("span[data-fx-done]").length + "/" +
             pv.textLayer.div.querySelectorAll(".fx-b").length;
    })()`).catch(() => "x");
    if (cur === last && cur !== "x") { if (++stable >= 5) return; } else { stable = 0; last = cur; }
    await sleep(400);
  }
};

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
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
  for (let i = 0; i < 40; i++) { if (await ev(`!!window.PDFViewerApplication?.pdfDocument`).catch(() => false)) break; await sleep(500); }
  // --zoom: the gate runs every check at one zoom; without it, the viewer's
  // default — what this check was validated at. Set before the engine runs.
  if (ZOOM) await ev(`(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)}; return true; })()`);
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);

  const pages = ALL ? await ev(`window.PDFViewerApplication.pdfDocument.numPages`) : null;
  const state = eqkeep.create();
  for (const pg of ALL ? Array.from({ length: pages }, (_, i) => i + 1) : [PAGE]) {
    await ev(`(() => { window.PDFViewerApplication.page = ${pg}; return true; })()`);
    await sleep(700);
    await settle(pg);
    const r = await ev(eqkeep.probe(pg));
    const { out, err } = eqkeep.add(state, pg, r);
    for (const l of out) console.log(l);
    for (const l of err) console.error(l);
  }

  const verdict = eqkeep.summarize(state, { label: LABEL });
  for (const l of verdict.out) console.log(l);
  for (const l of verdict.err) console.error(l);
  if (verdict.logLine) appendFileSync(`${outDir()}/eqkeep.log`, verdict.logLine + String.fromCharCode(10));
  if (!verdict.ok) process.exitCode = 1;
} catch (e) { console.error(`${LABEL} probe error: ${e.message || e}`); process.exitCode = 1; }
finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
