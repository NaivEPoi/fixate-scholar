// Reference-lookup audit: for every entry in a paper's bibliography, what does
// the citation card actually get back, and from which source?
//
// Per entry, one of four outcomes — they used to be one indistinguishable
// `null`, and the fix for each is different:
//
//   MATCH        a record verified against the reference. Reported with the
//                source that answered (arXiv / OpenAlex / Crossref) and the
//                rung trail, so "who covers this corpus" is measurable.
//   NO-MATCH     the sources answered and nothing they returned IS this
//                reference. Expected for specifications, tools, web pages;
//                a paper here is a matching or a query defect.
//   SKIPPED      an entry that is a name and a link — never looked up.
//   UNAVAILABLE  nothing answered at all (offline, or every service down).
//
// Runs the shipping code in its real environment: entries from the vendored
// pdf.js + `references/{extractor,parser}.mjs` in Node, the lookup itself from
// `references/sources.mjs` inside an extension page (which is where DOMParser
// and chrome.storage live).
//
// HEADFUL by default, because Google Scholar is the default source and it
// answers only a request carrying the profile cookies: the run visits
// scholar.google.com once before it starts, the way a reader browser already
// has. --headless skips the window (and Scholar will then refuse, so the run
// measures the open databases alone); --no-scholar-warmup skips the visit. It
// waits between lookups (--delay, default 3s): the product looks a reference up
// when a reader CLICKS it, so a run that fires them all at once is not the
// traffic the product makes, and measures the services burst limits instead of
// our coverage.
//
// Usage:
//   node test/citelookup.mjs <pdf|url> [more…] [--limit=N] [--from=N]
//                            [--delay=ms] [--json=path] [--quiet]
//   node test/citelookup.mjs --replay=test/out/citelookup-foo.json

import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { extensionBrowserPath, extensionDir, extensionLoadRefusal, outDir, profileDir } from "./lib/env.mjs";
import { loadPdfjs, loadReferenceModules, openPdf, resolveTargets } from "./lib/pdfjs-node.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback = null) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const LIMIT = parseInt(flag("limit", "1000"), 10);
const FROM = parseInt(flag("from", "1"), 10);
// A READER'S PACE, on purpose. The product makes one lookup per citation
// CLICKED, so the traffic it generates is a person reading — seconds apart,
// and never a whole bibliography at once. A harness that fires 60 lookups in
// twelve seconds measures something the product never does, and it measures
// the services' burst limits instead of our coverage: Crossref's public pool
// answered 429 to ~20 queries in 30 seconds during the first audit, and two
// papers were reported as "not found" because of it.
//
// 3s between lookups is close to the fastest a person clicks through
// citations. --delay changes it; keep it in that region.
const DELAY = parseInt(flag("delay", "3000"), 10);
const QUIET = args.includes("--quiet");
// The product adds NO gap between the requests of one lookup — a reader clicked,
// and their click is the rate limit. A harness is the exception it exists for:
// this walks a bibliography in a loop with no human in it, so it can ask the
// module to space its requests too (0 = behave exactly like the product).
const GAP = parseInt(flag("gap", "0"), 10);
const REPLAY = flag("replay");
const targets = args.filter((a) => !a.startsWith("--"));
if (!REPLAY && !targets.length) {
  console.error("usage: node test/citelookup.mjs <pdf|url> [more…] [--limit=N] [--json=path]");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function report(runs) {
  const totals = { MATCH: 0, "NO-MATCH": 0, SKIPPED: 0, UNAVAILABLE: 0 };
  const sources = {};
  const rungs = {};
  for (const run of runs) {
    const counts = { MATCH: 0, "NO-MATCH": 0, SKIPPED: 0, UNAVAILABLE: 0 };
    for (const row of run.rows) {
      counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;
      totals[row.outcome] = (totals[row.outcome] ?? 0) + 1;
      if (row.source) sources[row.source] = (sources[row.source] ?? 0) + 1;
      for (const step of row.trail ?? []) {
        if (step.endsWith(":match")) rungs[step.slice(0, -6)] = (rungs[step.slice(0, -6)] ?? 0) + 1;
      }
      if (QUIET) continue;
      console.log(
        `[${String(row.label ?? row.n).padStart(4)}] ${row.outcome.padEnd(11)} ` +
          `${(row.source ?? "-").padEnd(9)} ${JSON.stringify((row.title ?? row.ref?.title ?? "").slice(0, 64))}`,
      );
      if (row.outcome === "NO-MATCH") {
        console.log(`         ref ${JSON.stringify((row.ref?.title ?? "").slice(0, 78))} [${(row.trail ?? []).join(" ")}]`);
      }
    }
    const n = run.rows.length || 1;
    console.log(
      `\n${run.paper}: ${run.rows.length} entries — ` +
        Object.entries(counts)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}=${v} (${Math.round((100 * v) / n)}%)`)
          .join(" "),
    );
  }
  if (runs.length > 1) {
    const n = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
    console.log(
      `\nALL ${runs.length} papers, ${n} entries — ` +
        Object.entries(totals)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}=${v} (${Math.round((100 * v) / n)}%)`)
          .join(" "),
    );
  }
  console.log(`sources: ${JSON.stringify(sources)}`);
  console.log(`answered by rung: ${JSON.stringify(rungs)}`);
}

if (REPLAY) {
  const saved = JSON.parse(readFileSync(REPLAY, "utf8"));
  console.log(`replay ${REPLAY} — ${saved.when}\n`);
  report(saved.runs);
  process.exit(0);
}

// ── entries, offline ───────────────────────────────────────────────────────
const pdfjs = await loadPdfjs();
const { extractLines, parseReferences } = await loadReferenceModules();
const papers = [];
for (const { path, name } of await resolveTargets(targets)) {
  const entries = parseReferences(await extractLines(await openPdf(pdfjs, path)));
  if (!entries.length) {
    console.log(`ZERO ${name} — no bibliography entries parsed, nothing to look up`);
    continue;
  }
  papers.push({ name, entries: entries.slice(FROM - 1, FROM - 1 + LIMIT) });
  console.log(`${name}: ${entries.length} entries parsed, auditing ${papers.at(-1).entries.length} from #${FROM}`);
}
if (!papers.length) process.exit(1);

// ── the lookup, in an extension page ───────────────────────────────────────
const PORT = 9411 + (process.pid % 140);
const userDataDir = profileDir("citelookup");
let log = "";
const browser = spawn(extensionBrowserPath(flag("browser")), [
  `--remote-debugging-port=${PORT}`, ...(args.includes("--headless") ? ["--headless=new"] : []),
  "--no-first-run", "--window-position=-2400,0", "--window-size=1200,900",
  "--no-default-browser-check", "--disable-sync", "--enable-logging=stderr",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });
browser.stdout.on("data", (d) => (log += d));
browser.stderr.on("data", (d) => (log += d));

let ws;
let nextId = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", h);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
const http = async (p, m = "GET") =>
  (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 400));
  }
  return r.result.value;
};

/** One reference through the shipping lookup, plus the rung trail and the
 *  request count — which the product does not need and a measurement does. */
const lookupExpr = (ref) => `(async (ref) => {
  globalThis.__fxDebug = true;
  globalThis.__fxRequestGap = ${GAP};
  globalThis.__fxLookupTrail = null;
  const S = await import("/viewer/references/sources.mjs");
  const M = await import("/viewer/references/matching.mjs");
  if (!window.__counted) {
    const real = window.fetch;
    window.__requests = [];
    window.fetch = (u, o) => { window.__requests.push(String(u)); return real(u, o); };
    window.__counted = true;
  }
  const before = window.__requests.length;
  const searchable = M.isSearchable(ref);
  const result = await S.lookupReference(ref);
  const trail = globalThis.__fxLookupTrail;
  return {
    searchable,
    unavailable: !!(result && result.unavailable),
    match: result && !result.unavailable ? {
      title: result.title, source: result.source, year: result.year,
      doi: result.doi, hasPdf: !!result.pdfUrl, citedBy: result.citedBy,
      snippet: (result.snippet || "").slice(0, 60),
    } : null,
    trail: trail ? trail.trail : [],
    requests: window.__requests.length - before,
    hosts: window.__requests.slice(before).map((u) => { try { return new URL(u).host; } catch { return "?"; } }),
  };
})(${JSON.stringify(ref)})`;

const runs = [];
try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try { version = await http("/json/version"); } catch { await sleep(300); }
  }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const refusal = extensionLoadRefusal(log);
    if (refusal) throw new Error(refusal);
    const t = await http("/json/list");
    const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(300);
  }
  if (!extId) throw new Error("no service-worker target — extension never loaded");
  // Any extension page will do: the lookup needs the origin (for the module
  // import and chrome.storage), not the viewer.
  // One visit to Scholar, so the profile has the cookies it answers to. A
  // reader browser has them already; a fresh automation profile does not, and
  // without them every Scholar rung reads as a refusal.
  if (!args.includes("--no-scholar-warmup")) {
    await http(`/json/new?${encodeURIComponent("https://scholar.google.com/")}`, "PUT");
    await sleep(6000);
  }
  const tab = await http(`/json/new?chrome-extension://${extId}/options/options.html`, "PUT");
  await sleep(2000);
  const live = (await http("/json/list")).find((t) => t.id === tab.id) ?? tab;
  ws = new WebSocket(live.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");

  for (const paper of papers) {
    const rows = [];
    for (const [i, entry] of paper.entries.entries()) {
      if (i) await sleep(DELAY);
      const ref = {
        label: entry.label,
        title: entry.title,
        surname: entry.surname,
        year: entry.year,
        doi: entry.doi,
        raw: entry.raw,
      };
      let out;
      try {
        out = await ev(lookupExpr(ref));
      } catch (e) {
        out = { error: e.message, trail: [], requests: 0 };
      }
      const outcome = out.error
        ? "UNAVAILABLE"
        : !out.searchable
          ? "SKIPPED"
          : out.unavailable
            ? "UNAVAILABLE"
            : out.match
              ? "MATCH"
              : "NO-MATCH";
      rows.push({
        n: FROM + i,
        label: entry.label,
        ref,
        outcome,
        source: out.match?.source ?? null,
        title: out.match?.title ?? null,
        doi: out.match?.doi ?? null,
        hasPdf: out.match?.hasPdf ?? false,
        citedBy: out.match?.citedBy ?? null,
        trail: out.trail,
        requests: out.requests,
        error: out.error ?? null,
      });
    }
    runs.push({ paper: paper.name, rows });
  }
} catch (e) {
  console.error("citelookup error:", e.message || e);
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

report(runs);
const jsonPath =
  flag("json") ??
  join(outDir(), `citelookup-${basename(papers[0]?.name ?? "run").replace(/[^\w.-]+/g, "_")}.json`);
writeFileSync(jsonPath, JSON.stringify({ when: new Date().toISOString(), runs }, null, 1));
console.log(`\nrun written to ${jsonPath} — re-read it with --replay=<path>`);
process.exit(0);
