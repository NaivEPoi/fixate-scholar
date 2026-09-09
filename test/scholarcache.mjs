// Record real Google Scholar pages once; measure the Scholar source against
// them for free, forever.
//
//   record   ask Scholar for each reference of a paper, at a READER'S PACE,
//            and save the pages under local/scholar-cache/ (git-ignored, and
//            never committed — see test/lib/scholar-cache.mjs). Headful,
//            because Scholar answers only a request carrying the profile's
//            cookies, and the run visits scholar.google.com first to get them.
//            Stops at the first refusal rather than pushing through it.
//   replay   run the shipping parse + verification over the recorded pages, in
//            an extension page, with NO network. This is the Scholar rung's hit
//            rate, repeatable and offline.
//   status   what is in the cache.
//
// Usage:
//   node test/scholarcache.mjs record <pdf|url> [--limit=N] [--from=N]
//                                     [--delay=ms] [--wait=minutes]
//   node test/scholarcache.mjs replay <pdf|url> [--limit=N] [--from=N]
//   node test/scholarcache.mjs status
//
// `--wait` polls until Scholar is answering again (it refuses an address for
// hours once it has decided to), then records.

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { extensionBrowserPath, extensionDir, profileDir } from "./lib/env.mjs";
import { loadPdfjs, loadReferenceModules, openPdf, resolveTargets } from "./lib/pdfjs-node.mjs";
import { entries, has, load, save, summary } from "./lib/scholar-cache.mjs";

const args = process.argv.slice(2);
const mode = args[0];
const flag = (name, fallback = null) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const LIMIT = parseInt(flag("limit", "25"), 10);
const FROM = parseInt(flag("from", "1"), 10);
// A reader's pace, jittered — the product spaces Scholar 1.5s apart and never
// twice the same; a recorder that fires every 4.000s is a different animal.
const DELAY = parseInt(flag("delay", "6000"), 10);
const WAIT_MIN = parseInt(flag("wait", "0"), 10);
const targets = args.slice(1).filter((a) => !a.startsWith("--"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => Math.round(ms * (0.7 + Math.random()));

if (mode === "status") {
  console.log(summary());
  for (const e of entries()) {
    console.log(`  ${e.recordedAt?.slice(0, 16)}  ${String(e.bytes).padStart(7)}B  ${JSON.stringify(String(e.query).slice(0, 64))}`);
  }
  process.exit(0);
}
if (mode !== "record" && mode !== "replay") {
  console.error("usage: node test/scholarcache.mjs record|replay|status [pdf|url] [flags]");
  process.exit(2);
}
if (!targets.length) {
  console.error(`${mode} needs a paper: node test/scholarcache.mjs ${mode} <pdf|url>`);
  process.exit(2);
}

// ── the references, offline ────────────────────────────────────────────────
const pdfjs = await loadPdfjs();
const { extractLines, parseReferences } = await loadReferenceModules();
const [{ path, name }] = await resolveTargets(targets.slice(0, 1));
const all = parseReferences(await extractLines(await openPdf(pdfjs, path)));
const refs = all.slice(FROM - 1, FROM - 1 + LIMIT).map((e) => ({
  label: e.label, title: e.title, surname: e.surname, year: e.year, doi: e.doi, raw: e.raw,
}));
console.log(`${name}: ${all.length} entries, using ${refs.length} from #${FROM}`);
console.log(summary());

// ── a browser, for the parse (replay) or the fetch (record) ────────────────
const PORT = 10101 + (process.pid % 40);
const userDataDir = profileDir(`scholarcache-${mode}`);
const headless = mode === "replay"; // replay touches no network at all
const browser = spawn(extensionBrowserPath(flag("browser")), [
  `--remote-debugging-port=${PORT}`, ...(headless ? ["--headless=new"] : []),
  "--no-first-run", "--no-default-browser-check", "--disable-sync",
  "--window-position=-2400,0", "--window-size=1200,900",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

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
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 300));
  }
  return r.result.value;
};

/** The query the Scholar source sends: the title alone (R32-1). */
const queryExpr = (ref) => `(async () => {
  const M = await import("/viewer/references/matching.mjs");
  const ref = ${JSON.stringify(ref)};
  return M.queryText(ref.title || ref.raw) || M.referenceQuery(ref);
})()`;

/** Fetch one Scholar page, exactly as the source does. */
const fetchExpr = (query) => `(async () => {
  const S = await import("/viewer/references/scholar.mjs");
  const res = await fetch(S.scholarSearchUrl(${JSON.stringify(query)}), {
    credentials: "include", headers: { accept: "text/html,application/xhtml+xml" },
  });
  const html = await res.text();
  return { status: res.status, html };
})()`;

/** Parse + verify a page that is already in hand — no network. */
const scoreExpr = (html, ref) => `(async () => {
  const S = await import("/viewer/references/scholar.mjs");
  const M = await import("/viewer/references/matching.mjs");
  const ref = ${JSON.stringify(ref)};
  const html = ${JSON.stringify(html)};
  const refused = /gs_captcha|not a robot|unusual traffic|automated queries/i.test(html);
  const cands = S.readResults(html);
  const best = M.bestMatch(cands, ref);
  return {
    refused, n: cands.length,
    match: best ? { title: best.title, citedBy: best.citedBy, pdf: !!best.pdfUrl } : null,
    top: cands.slice(0, 3).map((c) => ({ t: c.title.slice(0, 54), ...M.scoreResult(c, ref) })),
  };
})()`;

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(400); } }
  let sw = null;
  for (let i = 0; i < 60 && !sw; i++) {
    const t = await http("/json/list");
    sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (!sw) await sleep(400);
  }
  const extId = new URL(sw.url).hostname;

  if (mode === "record") {
    // The cookies Scholar answers to. A reader's browser has them already.
    await http(`/json/new?${encodeURIComponent("https://scholar.google.com/")}`, "PUT");
    await sleep(6000);
  }
  const tab = await http(`/json/new?chrome-extension://${extId}/options/options.html`, "PUT");
  await sleep(2500);
  const live = (await http("/json/list")).find((t) => t.id === tab.id) ?? tab;
  ws = new WebSocket(live.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");

  const REFUSED = /gs_captcha|not a robot|unusual traffic|automated queries/i;

  if (mode === "record") {
    // Wait out an existing block, if asked to.
    if (WAIT_MIN > 0) {
      const until = Date.now() + WAIT_MIN * 60_000;
      let open = false;
      while (!open && Date.now() < until) {
        const probe = await ev(fetchExpr("attention is all you need"));
        open = probe.status === 200 && !REFUSED.test(probe.html);
        console.log(`${new Date().toISOString().slice(11, 19)} scholar ${open ? "ANSWERING" : "still refusing"}`);
        if (!open) await sleep(180_000);
      }
      if (!open) {
        console.log("still refusing at the end of --wait; nothing recorded");
        process.exit(3);
      }
    }

    let saved = 0;
    for (const [i, ref] of refs.entries()) {
      const query = await ev(queryExpr(ref));
      if (!query) continue;
      if (has(query)) { console.log(`  cached   ${JSON.stringify(query.slice(0, 58))}`); continue; }
      if (i) await sleep(jitter(DELAY));
      const { status, html } = await ev(fetchExpr(query));
      if (status !== 200 || REFUSED.test(html)) {
        console.log(`  REFUSED  (status ${status}) — stopping; ${saved} recorded this run`);
        break;
      }
      save(query, html, { label: ref.label, title: ref.title, surname: ref.surname, year: ref.year });
      saved++;
      console.log(`  recorded ${String(html.length).padStart(7)}B  ${JSON.stringify(query.slice(0, 58))}`);
    }
    console.log(`\n${saved} new page(s). ${summary()}`);
  } else {
    let have = 0;
    let matched = 0;
    let refusedPages = 0;
    for (const ref of refs) {
      const query = await ev(queryExpr(ref));
      const html = query && load(query);
      if (!html) continue;
      have++;
      const r = await ev(scoreExpr(html, ref));
      if (r.refused) refusedPages++;
      else if (r.match) matched++;
      console.log(
        `${r.refused ? "REFUSED " : r.match ? "MATCH   " : "no-match"} n=${String(r.n).padStart(2)} ` +
          `${r.match ? (r.match.citedBy ?? "").padEnd(14) : "".padEnd(14)} ${JSON.stringify((ref.title || "").slice(0, 46))}`,
      );
      if (!r.match && !r.refused) {
        for (const t of r.top) {
          console.log(`     ${t.score.toFixed(2)} d=${t.dice.toFixed(2)}${t.authorOk ? " A" : " -"}${t.yearOk ? "Y" : "-"} ${JSON.stringify(t.t)}`);
        }
      }
    }
    console.log(
      `\n${have} recorded page(s) replayed: ${matched} matched` +
        `${refusedPages ? `, ${refusedPages} were captcha pages` : ""}` +
        `${have ? ` (${Math.round((100 * matched) / have)}%)` : ""}.`,
    );
    if (!have) console.log("nothing recorded for these references yet — run `record` first.");
  }
} catch (e) {
  console.error("scholarcache error:", e.message || e);
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(600);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
