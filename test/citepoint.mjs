// Which reference does the pointer open? For every MULTI-KEY citation bracket
// on a page ("[4, 12]", "[3, 7, 9]"), each printed number is clicked at its own
// centre and the card that opens must be THAT number's.
//
// The bug this exists for: one citation used to be one hit-target carrying the
// whole card list, so pointing anywhere in "[4, 12]" — including at the 12 —
// opened [4]. Nothing in the DOM was wrong, every other citation check passed,
// and the card simply showed the wrong paper.
//
// Also checked, because both are ways for the fix to be present but useless:
//  - WRONG-TARGET: the topmost element at the number's centre is not a
//    citation hit-target at all (the per-key target is there but something
//    sits over it, so the click never reaches it).
//  - Nothing annotated WHERE SOMETHING SHOULD BE: a page whose text contains
//    bracketed citations but carries no hit-target at all is a failure, the way
//    citeaudit fails on zero brackets (R41) — it is the shape a blind run
//    takes, and it is also a real defect if the annotation pass never ran.
//    Two neighbouring cases are NOT failures, and conflating them with it cost
//    a corpus sweep two false reds:
//      * the document is annotated but cites one work at a time, so there is no
//        multi-key bracket to measure — SKIP;
//      * the document contains no bracketed citation at all (a two-page memo,
//        a cover letter, a review form with no bibliography) — SKIP, because
//        zero hit-targets is the correct answer there. `citeaudit` fails such a
//        document on the same guard; this one asks whether a citation was
//        PRESENT before demanding that one was annotated.
//    Every SKIP prints what it saw, so a sweep of nothing but SKIPs is visible
//    rather than silent, and corpus-wide coverage stays the sweep's job.
//
// The probe and the verdict live in test/probes/citepoint.mjs, shared with the
// combined gate runner (test/allprobes.mjs); this file drives one browser.
// Usage: node test/citepoint.mjs <url|--url=...> [--pages=A-B] [--max=N] [--zoom=Z]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir, killBrowser } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";
import * as citepoint from "./probes/citepoint.mjs";

const ARGS = process.argv.slice(2);
const URL0 = ARGS.find((a) => a.startsWith("--url="))?.slice(6) ?? ARGS.find((a) => !a.startsWith("--"));
if (!URL0) {
  console.error("usage: node test/citepoint.mjs <url|--url=...> [--pages=A-B] [--max=N]");
  process.exit(2);
}
const ZOOM = ARGS.find((a) => a.startsWith("--zoom="))?.slice(7) ?? null;
const RANGE = (ARGS.find((a) => a.startsWith("--pages="))?.slice(8) ?? "").split("-").map((n) => parseInt(n, 10));
// Each click fires the card's lookup, so a citation-dense paper is capped
// rather than made to hammer the reference sources for hundreds of cards.
const MAX = parseInt(ARGS.find((a) => a.startsWith("--max="))?.slice(6) ?? "40", 10);
const EXT = extensionDir;
const PORT = 9411 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-cp-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

let cdp;
const send = (method, params) => cdp.send(method, params);
const ev = (expr) => cdp.ev(expr);

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  if (!extId) throw new Error("extension did not load");
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  cdp = connect(tab.webSocketDebuggerUrl, { where: "viewer" });
  await cdp.ready;
  await send("Page.enable");
  await sleep(3000);
  for (let i = 0; i < 25; i++) { const ok = await ev(`!!(typeof chrome!=='undefined' && chrome.storage && chrome.storage.sync)`).catch(() => false); if (ok) break; await sleep(400); }
  // --zoom: the gate runs every check at one zoom; without it, the viewer's
  // default — what this check was validated at. Set before the engine runs.
  if (ZOOM) await ev(`(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)}; return true; })()`);
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  for (let i = 0; i < 40; i++) { await sleep(700); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 80) break; }
  const nPages = await ev(`window.PDFViewerApplication.pdfViewer.pagesCount`);
  const p0 = RANGE[0] || 1;
  const p1 = RANGE[1] || nPages;

  const state = citepoint.create();
  for (let p = p0; p <= p1 && state.examined < MAX; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`).catch(() => {});
    await sleep(2200);
    // Settle on this page's own annotation, not a document-wide count: a page
    // photographed mid-annotation has no hit-targets yet and would report
    // every citation as WRONG-TARGET.
    for (let i = 0; i < 20; i++) {
      const n = await ev(`(() => { const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1}); return pv && pv.textLayer ? pv.div.querySelectorAll('.fx-cite-hit').length : 0; })()`).catch(() => 0);
      if (n > 0) break;
      await sleep(600);
    }
    await sleep(600);

    const { examined } = state;
    const res = await cdp.ev(citepoint.probe(p, { max: MAX, examined }), { ms: 120000 });
    const { out, err } = citepoint.add(state, p, res);
    for (const l of out) console.log(l);
    for (const l of err) console.error(l);
  }

  const verdict = citepoint.summarize(state);
  for (const l of verdict.out) console.log(l);
  for (const l of verdict.err) console.error(l);
  if (!verdict.ok) process.exitCode = 1;
} catch (e) { console.error("citepoint error:", e.message || e); process.exitCode = 1; }
finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
