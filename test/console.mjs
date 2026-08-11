// Release-gate step 5: the console must be SILENT — zero errors AND zero
// warnings — on every swept document, for the viewer page AND the extension
// service worker.
//
// Why this exists: diag-chrome / diag-dnr / diag-intercept / diag-csp each
// capture console output but filter to errors, so warnings were captured
// nowhere, and neither corpus sweep checked the console at all. This harness
// captures everything the gate asks for:
//   Runtime.exceptionThrown   uncaught errors / rejections
//   Runtime.consoleAPICalled  every console.* type, not just error
//   Log.entryAdded            browser-level entries (network, CSP, deprecations)
//   securitypolicyviolation   CSP violations, via a page listener
// on BOTH targets: the viewer tab and the extension's service worker (a separate
// CDP target, so it needs its own socket).
//
// Usage: node test/console.mjs <paper|--url=...> [--pages=N] [--all]
//   --pages=N  visit the first N pages (default 6; --all visits every page)
//   --label=X  name for the report line (use an rvNN alias for private docs)
// Exit 1 if anything not on the UPSTREAM allowlist below is reported.

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir } from "./lib/env.mjs";

// Upstream-warning allowlist — deliberately EMPTY.
//
// The vendored PDF.js can warn on real-world files for reasons that are not our
// bug (malformed embedded fonts, rebuilt xref, unsupported features), so the gate
// allows for such a list. It started with ten plausible patterns and every one of
// them excused NOTHING: measured across the whole public corpus, `loud` (the
// error/warning/exception count) is 0 on every document. Speculative entries are
// pre-emptive permission to be noisy, which is precisely what an open "ignore
// warnings" rule would be — so they are gone.
//
// To add one: run the sweep, let it FAIL, then add the narrowest pattern that
// matches the actual text, with a comment saying which document class it came
// from and why it is upstream rather than ours. Re-review the list every release;
// an entry that stops matching should be deleted, not kept "just in case".
//
// NOTE ON ANCHORING: Log.entryAdded messages arrive prefixed with their source
// ("worker: Warning: ..."), so a pattern anchored at ^Warning never matches. The
// first draft of this list was anchored that way and silently covered nothing
// while looking like coverage.
const UPSTREAM_ALLOW = [
  // PDF.js's font parser interpreting a broken TrueType hinting program in the
  // DOCUMENT's embedded font, reported from the worker thread — which our code
  // never touches. Verified upstream by --fxoff: byte-identical with reading
  // mode never enabled. Seen on private-corpus PDFs exported from a word
  // processor rather than built by LaTeX (no public corpus paper triggers it).
  /Warning: TT: (undefined function|invalid function id)/,
];

const ARGV = process.argv.slice(2);
// --selftest: inject a warning and an error into BOTH targets and assert they
// were captured. A capture harness that captures nothing is indistinguishable
// from a silent console, so every real run should be preceded by one of these
// (and a low `captured` count on a document is a reason to re-check, not to
// celebrate).
const SELFTEST = ARGV.includes("--selftest");
// --fxoff: never enable reading mode. The control for "is this warning ours?" —
// anything that still appears is the stock PDF.js viewer talking about the
// document, not a consequence of our overlay.
const FXOFF = ARGV.includes("--fxoff");
const SELF = "fx-console-selftest";
const URL_ARG = ARGV.find((a) => a.startsWith("--url="))?.slice(6);
const PAGES = parseInt(ARGV.find((a) => a.startsWith("--pages="))?.slice(8) ?? "6", 10);
const ALL = ARGV.includes("--all");
const PAPERS = {
  "USENIX (baseline)": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "USENIX (code + algorithms)": "https://yilud.me/usenixsecurity24-tu.pdf",
  "USENIX (no cover page)": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "ACM acmart (full)": "https://yilud.me/Proteus-ccs24.pdf",
  "ACM acmart (short)": "https://yilud.me/SIB-Auth.pdf",
  "IEEE conference (stamped)": "https://yilud.me/a33-dong%20stamped.pdf",
  "IEEE journal": "https://arxiv.org/pdf/2502.04915",
  "NeurIPS": "https://arxiv.org/pdf/1706.03762",
  "LaTeX article (CM)": "https://arxiv.org/pdf/quant-ph/9508027",
  "5GCVerif": "https://yilud.me/5GCVerif-ccs23.pdf",
  "5GShield": "https://yilud.me/5GShield.pdf",
  "AFC-Diss": "https://yilud.me/afc_testing_DISS.pdf",
  "ACL": "https://yilud.me/2026.acl-long.2136.pdf",
  "UC-Scheme": "https://yilud.me/UC_Scheme.pdf",
};
const FILTER = URL_ARG
  ? (ARGV.find((a) => a.startsWith("--label="))?.slice(8) ?? "url")
  : (ARGV.find((a) => !a.startsWith("--") && !a.toLowerCase().endsWith(".exe")) ?? "USENIX (code + algorithms)");
const TARGET = URL_ARG ?? PAPERS[FILTER];
if (!TARGET) {
  console.error(`console: unknown template ${JSON.stringify(FILTER)}`);
  console.error(`  templates: ${Object.keys(PAPERS).join(", ")}`);
  console.error(`  or: --url=<pdf url> [--label=name]`);
  process.exit(2);
}

const EXT = extensionDir;
const PORT = 9821 + (process.pid % 120);
const userDataDir = join(tmpdir(), `fx-con-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,1800",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

/** One CDP connection with console capture wired up. */
function connect(wsUrl, where, sink) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    const p = m.params;
    if (m.method === "Runtime.consoleAPICalled") {
      const text = (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(" ");
      sink({ where, level: p.type, text });
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = p.exceptionDetails ?? {};
      sink({ where, level: "exception", text: d.exception?.description ?? d.text ?? "exception" });
    } else if (m.method === "Log.entryAdded") {
      sink({ where, level: p.entry.level, text: `${p.entry.source}: ${p.entry.text}` });
    }
  };
  // Every CDP call gets a deadline. Without one, a wedged target (Edge's
  // extension service worker going idle, a tab that stops responding) leaves a
  // promise pending forever and node exits 13 "unsettled top-level await" — a
  // hang that reads like a mystery failure instead of naming its cause. Seen on
  // UC-Scheme during the all-pages sweep.
  const send = (method, params = {}, ms = 30000) => new Promise((res, rej) => {
    const i = ++id;
    const timer = setTimeout(() => {
      pending.delete(i);
      rej(new Error(`${where}: ${method} timed out after ${ms}ms`));
    }, ms);
    pending.set(i, (m) => {
      clearTimeout(timer);
      m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result);
    });
    try { ws.send(JSON.stringify({ id: i, method, params })); }
    catch (e) { clearTimeout(timer); pending.delete(i); rej(e); }
  });
  ws.onclose = () => {
    for (const [i, fn] of pending) { pending.delete(i); fn({ error: { message: `${where}: socket closed` } }); }
  };
  return { ws, ready, send };
}

const msgs = [];
const sink = (m) => { if (m.text && m.text.trim()) msgs.push(m); };

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  if (!version) throw new Error("debugger endpoint never came up");

  // The service worker target must be attached BEFORE the document loads, or its
  // startup messages are missed.
  let sw = null;
  for (let i = 0; i < 60 && !sw; i++) {
    const t = await http("/json/list");
    sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (!sw) await sleep(300);
  }
  if (!sw) throw new Error("extension service worker never appeared");
  const extId = new URL(sw.url).hostname;
  const swConn = connect(sw.webSocketDebuggerUrl, "service-worker", sink);
  await swConn.ready;
  await swConn.send("Runtime.enable");
  await swConn.send("Log.enable");

  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(TARGET)}`, "PUT");
  const page = connect(tab.webSocketDebuggerUrl, "viewer", sink);
  await page.ready;
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Page.enable");
  // CSP violations are a DOM event, not a CDP domain: report them via console.
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `addEventListener("securitypolicyviolation", (e) => console.error("securitypolicyviolation: " + e.violatedDirective + " " + e.blockedURI));`,
  });
  await page.send("Page.reload");
  await sleep(3000);

  const ev = async (expr) => {
    const r = await page.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };
  if (!FXOFF) await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
  await sleep(2000);
  const total = (await ev(`window.PDFViewerApplication?.pagesCount ?? 0`)) || 0;
  const last = ALL ? total : Math.min(PAGES, total);
  for (let p = 1; p <= last; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`);
    await sleep(1200);
  }
  // Toggle off and on: restore + re-process is where late errors surface.
  if (!FXOFF) {
    await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: false }, r))`);
    await sleep(1500);
    await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`);
    await sleep(2500);
  }

  if (SELFTEST) {
    await ev(`console.warn("${SELF} page warning"); console.error("${SELF} page error"); 1`);
    await swConn.send("Runtime.evaluate", {
      expression: `console.warn("${SELF} sw warning"); console.error("${SELF} sw error"); 1`,
    });
    await sleep(1200);
    const got = (where, level) => msgs.some((m) => m.text.includes(SELF) && m.where === where && new RegExp(level, "i").test(m.level));
    const results = {
      "viewer/warning": got("viewer", "warning"),
      "viewer/error": got("viewer", "error"),
      "service-worker/warning": got("service-worker", "warning"),
      "service-worker/error": got("service-worker", "error"),
    };
    const missing = Object.entries(results).filter(([, ok]) => !ok).map(([k]) => k);
    console.log(`SELFTEST ${missing.length ? "FAIL — not captured: " + missing.join(", ") : "ok — all four channels capture"}`);
    if (missing.length) process.exitCode = 1;
  }

  const bad = msgs.filter((m) => {
    if (m.text.includes(SELF)) return false; // self-test noise, asserted above
    if (!/error|warning|exception|severe/i.test(m.level)) return false;
    return !UPSTREAM_ALLOW.some((re) => re.test(m.text));
  });
  // Count precisely: "allowed" means an error/warning-level message that an
  // UPSTREAM_ALLOW pattern excused — not info-level chatter and not the
  // self-test's own injections, both of which would inflate it into a
  // reassuring-looking number that means nothing.
  const real = msgs.filter((m) => !m.text.includes(SELF));
  const loud = real.filter((m) => /error|warning|exception|severe/i.test(m.level));
  const allowed = loud.length - bad.length;
  console.log(
    `${FILTER}: pages=${last}/${total} captured=${real.length} loud=${loud.length} allowed-upstream=${allowed} PROBLEMS=${bad.length}`,
  );
  // A very low capture count on a long document is either a genuinely silent
  // console or a half-wired harness, and the two look identical in a summary
  // line — so show what little WAS captured, at any level, rather than leaving
  // "captured=1" to be taken on trust. (--selftest proves the channels work.)
  if (real.length <= 2) {
    for (const m of real) console.log(`  (all captured) [${m.where}/${m.level}] ${m.text.slice(0, 180).replace(/\s+/g, " ")}`);
  }
  const seen = new Set();
  for (const m of bad) {
    const k = `${m.where}|${m.level}|${m.text.slice(0, 120)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  [${m.where}/${m.level}] ${m.text.slice(0, 220).replace(/\s+/g, " ")}`);
  }
  if (bad.length) process.exitCode = 1;
  try { swConn.ws.close(); page.ws.close(); } catch {}
} catch (e) {
  console.error("console harness error:", e.message || e);
  process.exitCode = 1;
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
