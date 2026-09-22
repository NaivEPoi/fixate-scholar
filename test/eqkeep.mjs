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
// Usage: node test/eqkeep.mjs --url=<pdf> [--label=name] [--page=N | --all]
import { spawn } from "node:child_process";
import { appendFileSync, rmSync } from "node:fs";

import { browserPath, extensionDir, outDir, profileDir, killBrowser } from "./lib/env.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL0 = arg("url");
const LABEL = arg("label", "doc");
const PAGE = parseInt(arg("page", "6"), 10);
const ALL = process.argv.includes("--all");
if (!URL0) {
  console.error("usage: node test/eqkeep.mjs --url=<pdf> [--label=name] [--page=N | --all]");
  process.exit(2);
}
const PORT = 12400 + (process.pid % 300);
const userDataDir = profileDir(`eqkeep-${PORT}`);
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

const probe = (page) => ev(`(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page} - 1);
  if (!pv || !pv.textLayer) return null;
  const spans = [...pv.textLayer.div.querySelectorAll("span")]
    .filter((s) => s.textContent.trim() && !s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)"));
  if (!spans.length) return { page: ${page}, rows: 0, eqRows: 0, violations: 0, bad: [] };

  // Group into visual rows by baseline.
  const rows = new Map();
  for (const s of spans) {
    const r = s.getBoundingClientRect();
    if (!r.width) continue;
    const key = Math.round(r.bottom / 3);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ s, r });
  }

  // The column's right edge, from the widest right extent on the page — an
  // equation number sits hard against it.
  const rights = [...rows.values()].flat().map((x) => x.r.right).sort((a, b) => a - b);
  const pageRight = rights[Math.floor(rights.length * 0.97)] ?? 0;

  let eqRows = 0, violations = 0;
  const bad = [];
  for (const arr of rows.values()) {
    arr.sort((a, b) => a.r.left - b.r.left);
    const text = arr.map((x) => x.s.textContent).join(" ").trim();
    // A trailing equation number, hard against the column's right edge.
    if (!/\\(\\s*(?:[A-Z]\\s*[.-]\\s*)?\\d+(?:\\.\\d+)*\\s*\\)\\s*$/.test(text)) continue;
    const last = arr[arr.length - 1];
    if (last.r.right < pageRight - 40) continue;
    // No running prose: three or more ordinary lowercase words means a
    // sentence that merely ends in a parenthesised number, not an equation.
    const words = (text.match(/\\b[a-z]{3,}\\b/g) || [])
      .filter((w) => !/^(?:exp|log|ln|cos|sin|tan|max|min|sup|inf|lim|det|dim|deg|gcd|mod|arg|where|and|for|the)$/.test(w));
    if (words.length >= 3) continue;
    eqRows++;
    for (const x of arr) {
      if (!x.s.dataset.fxDone) continue;
      violations++;
      if (bad.length < 6) bad.push({ text: x.s.textContent.trim().slice(0, 24), row: text.slice(0, 60) });
    }
  }
  return { page: ${page}, rows: rows.size, eqRows, violations, bad };
})()`);

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
  ws = new WebSocket(live.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  for (let i = 0; i < 40; i++) { if (await ev(`!!window.PDFViewerApplication?.pdfDocument`).catch(() => false)) break; await sleep(500); }
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);

  const pages = ALL ? await ev(`window.PDFViewerApplication.pdfDocument.numPages`) : null;
  const results = [];
  for (const pg of ALL ? Array.from({ length: pages }, (_, i) => i + 1) : [PAGE]) {
    await ev(`(() => { window.PDFViewerApplication.page = ${pg}; return true; })()`);
    await sleep(700);
    await settle(pg);
    const r = await probe(pg);
    if (r) results.push(r);
  }

  const totals = results.reduce((a, r) => ({
    eqRows: a.eqRows + r.eqRows,
    violations: a.violations + r.violations,
  }), { eqRows: 0, violations: 0 });
  console.log(`TOTALS: ${JSON.stringify({ pages: results.length, ...totals })}`);
  for (const r of results.filter((x) => x.violations)) {
    console.log(`  FAIL p${r.page} ${r.violations} emphasized span(s) in a numbered equation ${JSON.stringify(r.bad)}`);
  }
  if (totals.violations) {
    console.log(`  FAIL ${totals.violations} processed span(s) inside a numbered displayed equation`);
    process.exitCode = 1;
  }
  // Unlike fontkeep this one does NOT fail on zero rows examined: plenty of
  // real papers number no equations at all, and a document with none is
  // legitimately inapplicable. The sweep reports the count so a run that
  // examined nothing anywhere is visible rather than silent.
  const line = `${LABEL} ${JSON.stringify({ pages: results.length, ...totals })}`;
  console.log(line);
  appendFileSync(`${outDir()}/eqkeep.log`, line + String.fromCharCode(10));
} catch (e) { console.error(`${LABEL} probe error: ${e.message || e}`); process.exitCode = 1; }
finally {
  try { ws?.close(); } catch {}
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
