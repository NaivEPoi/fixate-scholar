// Four gate checks over ONE page render instead of four.
//
// fontkeep, eqkeep, refcolor and tables are all read-only probes over the same
// settled page: each enables the extension, walks the document a page at a
// time, and evaluates an expression against the rendered DOM. Run as separate
// stages they render every page of every document four times over, and the
// render is almost the whole cost.
//
// The probe bodies are READ OUT OF THE HARNESSES rather than copied, so each
// harness stays the single source of truth for what its check means. Copying
// them would reintroduce exactly the failure this project already shipped once:
// refcolor.mjs kept its own copy of the parser's pattern, the copy carried the
// same bug as the product, and the harness could not report the thing it
// existed to check.
//
// A check whose probe cannot be extracted is REPORTED AS SKIPPED and must be
// run standalone. A combined run that silently drops a check is worse than a
// slow one, and this file must never be the reason a check stops failing.
//
// Usage: node test/allprobes.mjs --url=<pdf> [--label=name] [--all|--page=N]
import { spawn } from "node:child_process";
import { appendFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { browserPath, extensionDir, outDir, profileDir, killBrowser } from "./lib/env.mjs";
import { loadProbes } from "./lib/extract-probe.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url");
const LABEL = arg("label", "doc");
const PAGE = parseInt(arg("page", "1"), 10);
const ALL = process.argv.includes("--all");
const ZOOM = arg("zoom", "");
if (!URL0) {
  console.error("usage: node test/allprobes.mjs --url=<pdf> [--label=name] [--all|--page=N]");
  process.exit(2);
}

const { probes, errors } = loadProbes(TEST_DIR);
for (const [name, msg] of Object.entries(errors)) {
  console.log(`SKIPPED ${name}: probe could not be extracted (${msg}) — run it standalone`);
}

const PORT = 17200 + (process.pid % 300);
const userDataDir = profileDir(`allprobes-${PORT}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1500,2400",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 300));
  return r.result.value;
};

// The same settle the standalone harnesses use: the page's own processed-span
// and emphasis counts holding still. Photographing a page mid-emphasis is what
// manufactures "missing emphasis" findings, and it is the one thing four
// checks sharing a render must get right, because they all inherit it.
const settle = async (page) => {
  let last = "";
  let stable = 0;
  for (let i = 0; i < 60; i++) {
    const cur = await ev(`(() => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page} - 1);
      if (!pv || !pv.textLayer) return "x";
      // The reference and citation WRAPS are in the signature too, not just the
      // typography counts. Annotation runs after emphasis, so a settle that
      // watches only data-fx-done and .fx-b returns while the colouring is
      // still being applied — and refcolor, sharing that settle, measured a
      // page with no references on it at all and passed. Measured: 0 refs
      // combined against 8 refs standalone on the same document. A shared
      // settle has to be the UNION of what the sharers each wait for.
      return pv.textLayer.div.querySelectorAll("span[data-fx-done]").length + "/" +
             pv.textLayer.div.querySelectorAll(".fx-b").length + "/" +
             pv.textLayer.div.querySelectorAll(".fx-ref-c").length + "/" +
             pv.textLayer.div.querySelectorAll(".fx-cite-c").length + "/" +
             (pv.div.querySelectorAll(".fx-cite-hit").length);
    })()`).catch(() => "x");
    // Eight stable reads, not five. Sharing one render means every check
    // inherits this settle, so an early return does not cost one measurement
    // but all of them at once — and it is invisible, because a partial page
    // yields a smaller count rather than an error. Measured on a 25-page
    // paper: five reads gave 1819 processed spans where the standalone
    // harness, run twice, gives 1831 exactly.
    if (cur === last && cur !== "x") { if (++stable >= 8) return; } else { stable = 0; last = cur; }
    await sleep(400);
  }
};

// One builder per check: `page -> expression`, compiled from the harness's own
// template so escapes and interpolation behave exactly as they do in the
// harness. A builder that cannot be compiled (a probe closing over harness
// state) is dropped here and reported as skipped.
const probeFns = {};
for (const [name, { body, param }] of Object.entries(probes)) {
  try {
    probeFns[name] = new Function(param, "return `" + body + "`");
    probeFns[name](1); // prove it builds before the run depends on it
  } catch (e) {
    delete probeFns[name];
    delete probes[name];
    errors[name] = `template will not compile: ${e.message}`;
    console.log(`SKIPPED ${name}: ${errors[name]} — run it standalone`);
  }
}

/** Pages whose probe threw, per check — a check with any is NOT a pass. */
const probeErrors = {};
const firstError = {};
const totals = {
  fontkeep: { processedSpans: 0, resolved: 0, unresolved: 0, violations: 0, bad: [] },
  eqkeep: { eqRows: 0, violations: 0, bad: [] },
  refcolor: { total: 0, colored: 0, misses: [] },
  tables: { zones: 0, offenders: 0 },
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
  ws = new WebSocket(live.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  for (let i = 0; i < 40; i++) { if (await ev(`!!window.PDFViewerApplication?.pdfDocument`).catch(() => false)) break; await sleep(500); }
  // Before any page is processed, exactly as whyskip does it, so the engine
  // records its skip reasons from the first pass rather than a re-process.
  await ev(`(() => { globalThis.__fxDebug = true; return true; })()`);
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  // The zoom the sharing checks agree on. It is NOT cosmetic: zoom changes
  // layout, layout changes classification, and classification is what these
  // checks measure. fontkeep and whyskip run at 1.8; eqkeep, refcolor and
  // citepoint take the viewer default; tables uses page-fit. Only checks that
  // agree on a zoom can share a render, and running them at the wrong one
  // quietly changes the answer rather than failing.
  if (ZOOM) {
    await ev(`(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)}; return true; })()`).catch(() => {});
    await sleep(800);
  }

  const pages = ALL ? await ev(`window.PDFViewerApplication.pdfDocument.numPages`) : null;
  const list = ALL ? Array.from({ length: pages }, (_, i) => i + 1) : [PAGE];
  let seen = 0;
  for (const pg of list) {
    await ev(`(() => { window.PDFViewerApplication.page = ${pg}; return true; })()`);
    await sleep(700);
    await settle(pg);
    seen++;
    for (const [name, { body, param }] of Object.entries(probes)) {
      // Built as a TEMPLATE LITERAL, not by string substitution. The harness
      // source contains the probe inside a template, so its backslashes are
      // escaped for that context — `\\\\.` in the file means `\\.` in the
      // regex. Substituting `${p}` textually and evaluating the raw source
      // skips that unescaping, and a backslash-heavy probe silently becomes a
      // different regex: refcolor matched NOTHING and reported 0 references on
      // a page with 8. Letting JS build the template applies exactly the
      // escaping the harness gets.
      let expr;
      try {
        expr = probeFns[name](pg);
      } catch (e) {
        probeErrors[name] = (probeErrors[name] ?? 0) + 1;
        if (!firstError[name]) firstError[name] = `p${pg}: template build failed: ${(e.message || e).slice(0, 80)}`;
        continue;
      }
      let r = null;
      try {
        r = await ev(expr);
      } catch (e) {
        // A probe that THREW has measured nothing, and a check with no
        // measurements reads as clean. Record it as a hard error so the run
        // cannot come back green on a check that never executed.
        probeErrors[name] = (probeErrors[name] ?? 0) + 1;
        if (!firstError[name]) firstError[name] = `p${pg}: ${(e.message || e).slice(0, 120)}`;
        continue;
      }
      if (!r) { probeErrors[name] = (probeErrors[name] ?? 0) + 1; continue; }
      if (r.error) {
        probeErrors[name] = (probeErrors[name] ?? 0) + 1;
        if (!firstError[name]) firstError[name] = `p${pg}: ${r.error}`;
        continue;
      }
      const t = totals[name];
      if (name === "fontkeep") {
        t.processedSpans += r.processedSpans || 0; t.resolved += r.resolved || 0;
        t.unresolved += r.unresolved || 0; t.violations += r.violations || 0;
        for (const b of r.bad ?? []) if (t.bad.length < 6) t.bad.push({ ...b, page: pg });
      } else if (name === "eqkeep") {
        t.eqRows += r.eqRows || 0; t.violations += r.violations || 0;
        for (const b of r.bad ?? []) if (t.bad.length < 6) t.bad.push({ ...b, page: pg });
      } else if (name === "refcolor") {
        t.total += r.total || 0; t.colored += r.colored || 0;
        for (const m of r.misses ?? []) if (t.misses.length < 6) t.misses.push({ ...m, page: pg });
      } else if (name === "tables") {
        t.zones += r.zones || 0; t.offenders += (r.offenders ?? r.total ?? 0);
      }
    }
  }

  // Each check's OWN pass criteria, unchanged from its harness.
  const verdicts = [];
  if (probes.fontkeep) {
    const ok = totals.fontkeep.violations === 0 && totals.fontkeep.resolved > 0;
    verdicts.push([`fontkeep`, ok, JSON.stringify({ pages: seen, ...totals.fontkeep, bad: undefined })]);
    if (totals.fontkeep.resolved === 0) console.log("  FAIL fontkeep resolved no font names — the check proved nothing");
  }
  if (probes.eqkeep) {
    verdicts.push([`eqkeep`, totals.eqkeep.violations === 0, JSON.stringify({ eqRows: totals.eqkeep.eqRows, violations: totals.eqkeep.violations })]);
  }
  if (probes.refcolor) {
    verdicts.push([`refcolor`, totals.refcolor.total <= totals.refcolor.colored, JSON.stringify({ refs: totals.refcolor.total, colored: totals.refcolor.colored })]);
  }
  if (probes.tables) {
    verdicts.push([`tables`, totals.tables.offenders === 0, JSON.stringify({ zones: totals.tables.zones, offenders: totals.tables.offenders })]);
  }

  let bad = 0;
  for (const [name, ok, detail] of verdicts) {
    const errs = probeErrors[name] ?? 0;
    const clean = ok && errs === 0;
    const note = errs ? ` — ${errs} page(s) ERRORED (${firstError[name]})` : "";
    console.log(`  ${clean ? "ok  " : "FAIL"} ${name.padEnd(9)} ${detail}${note}`);
    if (!clean) bad++;
  }
  // A check that could not be lifted out of its harness is NOT covered here.
  // Naming it in the result line is what stops a combined run being mistaken
  // for a full one.
  for (const name of Object.keys(errors)) console.log(`  SKIP ${name.padEnd(9)} run standalone`);
  const skipped = Object.keys(errors);
  const line = `${LABEL} pages=${seen} ` +
    verdicts.map(([n, ok]) => `${n}=${ok && !(probeErrors[n] ?? 0) ? "ok" : "FAIL"}`).join(" ") +
    (skipped.length ? ` skipped=${skipped.join(",")}` : "");
  console.log(line);
  appendFileSync(`${outDir()}/allprobes.log`, line + String.fromCharCode(10));
  if (bad) process.exitCode = 1;
} catch (e) { console.error(`${LABEL} allprobes error: ${e.message || e}`); process.exitCode = 1; }
finally {
  try { ws?.close(); } catch {}
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
