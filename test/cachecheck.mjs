// One lookup per reference, ever — verified by counting requests, not by
// reading the code.
//
// No service is contacted: `fetch` is replaced in the page with a counter that
// serves synthetic payloads (written here, in the shape each API documents).
// That makes the test deterministic, offline, and fast, and it is the only
// harness that can assert what the ladder does REQUEST BY REQUEST.
//
// What it pins down:
//   1. a click on a reference costs ONE request, even though the card calls the
//      lookup three times (body, actions, Cite),
//   2. the SECOND page load costs ZERO — the stored cache, not the page's Map,
//      is what makes reopening a paper free,
//   3. a DOI in the entry goes straight to the record: one request, no search,
//   4. a first source that answers with the wrong papers falls through to the
//      tail, whose two sources are then asked CONCURRENTLY,
//   5. every source failing is reported as UNAVAILABLE, is not stored, and is
//      retried on a later load,
//   6. a name-plus-link entry spends no request at all.
//
// Usage: node test/cachecheck.mjs [path-to-browser]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { extensionBrowserPath, extensionDir, extensionLoadRefusal, profileDir } from "./lib/env.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9531 + (process.pid % 90);
const userDataDir = profileDir("cachecheck");
let log = "";
const browser = spawn(extensionBrowserPath(process.argv[2]), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--enable-logging=stderr",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });
browser.stdout.on("data", (d) => (log += d));
browser.stderr.on("data", (d) => (log += d));

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
    throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 400));
  }
  return r.result.value;
};

let failed = false;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

// The reference under test, and records that verify against it: same title,
// first author present, same year.
const REF = {
  label: "1",
  title: "Applied pi calculus",
  surname: "Ryan",
  year: "2011",
  raw: "Mark D. Ryan and Ben Smyth. Applied pi calculus. In Formal Models and Techniques for Analyzing Security Protocols, 2011.",
};
const CROSSREF_HIT = {
  message: {
    items: [
      {
        DOI: "10.3233/978-1-60750-714-7-112",
        title: ["Applied pi calculus"],
        author: [{ given: "Mark D.", family: "Ryan" }, { given: "Ben", family: "Smyth" }],
        issued: { "date-parts": [[2011]] },
        "container-title": ["Formal Models and Techniques for Analyzing Security Protocols"],
        "is-referenced-by-count": 400,
        URL: "https://doi.org/10.3233/978-1-60750-714-7-112",
      },
    ],
  },
};
// Plausible neighbours, none of them the cited work — the R24-1 trap.
const CROSSREF_WRONG = {
  message: {
    items: [
      {
        DOI: "10.1/other",
        title: ["Simulation based security in the applied pi calculus"],
        author: [{ given: "Stéphanie", family: "Delaune" }],
        issued: { "date-parts": [[2009]] },
      },
    ],
  },
};
const OPENALEX_HIT = {
  results: [
    {
      id: "https://openalex.org/W123",
      doi: "https://doi.org/10.3233/978-1-60750-714-7-112",
      display_name: "Applied pi calculus",
      authorships: [{ author: { display_name: "Mark D. Ryan" } }],
      publication_year: 2011,
      primary_location: { source: { display_name: "Formal Models and Techniques" } },
      best_oa_location: { pdf_url: "https://example.org/applied-pi.pdf" },
      cited_by_count: 412,
      abstract_inverted_index: { Authentication: [0], is: [1], essential: [2] },
    },
  ],
};
const OPENALEX_WORK = { ...OPENALEX_HIT.results[0] }; // the by-DOI shape: one work, not a list
// A Google Scholar result page, in the markup its parser reads.
const SCHOLAR_HIT = `<html><body>
<div class="gs_r gs_or gs_scl" data-cid="CID123">
  <div class="gs_ggs gs_fl"><a href="/x.pdf">[PDF] example.org</a></div>
  <div class="gs_ri">
    <h3 class="gs_rt"><a href="/citations?x=1">Applied pi calculus</a></h3>
    <div class="gs_a">MD Ryan, B Smyth - Formal Models and Techniques…, 2011</div>
    <div class="gs_rs">A calculus for studying security protocols …</div>
    <div class="gs_fl"><a href="/scholar?cites=1">Cited by 412</a></div>
  </div>
</div></body></html>`;
// The refusal it serves with a 200 while the header still claims results.
const SCHOLAR_CAPTCHA =
  "<html><body>About 34 results Please show you are not a robot</body></html>";

/**
 * Replace fetch with a counter that answers per host. `plan` maps a substring
 * of the URL to [status, body]; anything unmatched is a 500, so an unexpected
 * request shows up as a failure rather than passing silently.
 */
const stubFetch = (plan) => `(() => {
  window.__requests = [];
  window.__startedAt = [];
  const plan = ${JSON.stringify(plan)};
  window.fetch = (url) => {
    const u = String(url);
    window.__requests.push(u);
    window.__startedAt.push(Math.round(performance.now()));
    for (const [needle, pair] of plan) {
      if (u.includes(needle)) {
        return Promise.resolve(new Response(typeof pair[1] === "string" ? pair[1] : JSON.stringify(pair[1]), {
          status: pair[0], headers: { "content-type": "application/json" },
        }));
      }
    }
    return Promise.resolve(new Response("{}", { status: 500 }));
  };
  return true;
})()`;

/** What the card does: three lookups for one reference (body, actions, Cite). */
const lookupThrice = (ref = REF) => `(async () => {
  const S = await import("/viewer/references/sources.mjs");
  const ref = ${JSON.stringify(ref)};
  const [a, b, c] = await Promise.all([
    S.lookupReference(ref),
    S.lookupReference(ref),
    S.lookupReference(ref),
  ]);
  return {
    title: a && a.title, source: a && a.source, pdf: !!(a && a.pdfUrl),
    same: a === b && b === c,
    unavailable: !!(a && a.unavailable),
    requests: window.__requests.length,
    hosts: window.__requests.map((u) => { try { return new URL(u).host; } catch { return "?"; } }),
    startedAt: window.__startedAt.slice(),
  };
})()`;

const clearStore = `(async () => {
  const c = await import("/viewer/references/lookup-cache.mjs");
  await c.clearCached();
  return true;
})()`;

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(400); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const refusal = extensionLoadRefusal(log);
    if (refusal) throw new Error(refusal);
    const t = await http("/json/list");
    const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(400);
  }
  if (!extId) throw new Error("no service-worker target — extension never loaded");
  const tab = await http(`/json/new?chrome-extension://${extId}/options/options.html`, "PUT");
  await sleep(1800);
  const live = (await http("/json/list")).find((t) => t.id === tab.id) ?? tab;
  ws = new WebSocket(live.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  await send("Page.enable");

  const reload = async () => {
    await send("Page.reload");
    await sleep(1800);
  };

  // ── load 1: a cold cache, the default path — Google Scholar answers. ──
  await ev(stubFetch([["scholar.google.com", [200, SCHOLAR_HIT]]]));
  const cold = await ev(lookupThrice());
  check(cold.title === "Applied pi calculus", "cold lookup returns the verified record", JSON.stringify(cold.title));
  check(cold.source === "Google Scholar", "…from the default source", String(cold.source));
  check(cold.requests === 1, "three lookups, ONE request", `requests=${cold.requests}`);
  check(cold.same, "the three callers share one promise");

  // ── load 2: same profile, fresh page. The Map is gone; the store is not. ──
  await reload();
  await ev(stubFetch([]));
  const warm = await ev(lookupThrice());
  check(warm.title === "Applied pi calculus", "reopening the paper returns the same record", JSON.stringify(warm.title));
  check(warm.requests === 0, "reopening the paper costs ZERO requests", `requests=${warm.requests}`);

  // ── a reader waits for nothing we added. ──
  // The lookup path must insert NO artificial gap: the click is the rate
  // limit. Four sources, all stubbed to answer instantly, must therefore all
  // start within a few ms of the call — if a floor ever comes back, this is
  // the check that fails.
  await ev(clearStore);
  await reload();
  await ev(stubFetch([["api", [500, "{}"]], ["scholar.google.com", [500, "x"]]]));
  const paced = await ev(lookupThrice());
  const spread = Math.max(...paced.startedAt) - Math.min(...paced.startedAt);
  check(
    paced.requests >= 3 && spread <= 60,
    "a lookup adds no delay of its own",
    `${paced.requests} requests spread over ${spread}ms`,
  );

  // ── Google Scholar is asked FIRST, and its captcha is not a no-match. ──
  // Scholar refuses with a 200 whose body is a captcha while the header still
  // claims results; read naively that is "Scholar has nothing", which would be
  // cached for a week. It has to fall through instead.
  await ev(clearStore);
  await reload();
  await ev(stubFetch([
    ["scholar.google.com", [200, "<html><body>About 34 results Please show you are not a robot</body></html>"]],
    ["api.crossref.org/works?", [200, CROSSREF_HIT]],
  ]));
  const refused = await ev(lookupThrice());
  check(
    refused.hosts[0] === "scholar.google.com",
    "Google Scholar is the first source asked",
    JSON.stringify(refused.hosts),
  );
  check(
    refused.title === "Applied pi calculus" && refused.source === "Crossref",
    "…and its captcha falls through to the open databases",
    `${refused.source}: ${JSON.stringify(refused.title)}`,
  );

  // ── a Scholar match gets a REAL abstract, though Scholar has none. ──
  // Scholar's `.gs_rs` is a query-biased snippet with ellipses, and its result
  // page carries no DOI to ask anyone about. So the record is found again in
  // OpenAlex BY TITLE — verified against the reference first — and the
  // abstract, the DOI and the citation count land after the card is up.
  await ev(clearStore);
  await reload();
  await ev(stubFetch([
    ["scholar.google.com", [200, SCHOLAR_HIT]],
    ["api.openalex.org/works?", [200, OPENALEX_HIT]],
  ]));
  const enriched = await ev(`(async () => {
    const S = await import("/viewer/references/sources.mjs");
    const ref = ${JSON.stringify(REF)};
    const r = await S.lookupReference(ref);
    const before = { snippet: r.snippet, isAbstract: !!r.snippetIsAbstract, doi: r.doi };
    const added = await S.fetchDetails(ref, r);
    return { added, before, after: { snippet: r.snippet, isAbstract: !!r.snippetIsAbstract, doi: r.doi },
             source: r.source, requests: window.__requests.length };
  })()`);
  check(
    enriched.source === "Google Scholar" && !enriched.before.isAbstract,
    "a Scholar match arrives with a snippet, not an abstract",
    JSON.stringify(enriched.before),
  );
  check(
    enriched.added && enriched.after.isAbstract && enriched.after.snippet.startsWith("Authentication is"),
    "…and the real abstract is filled in afterwards, by title",
    JSON.stringify(enriched.after.snippet.slice(0, 40)),
  );
  check(
    enriched.after.doi === "10.3233/978-1-60750-714-7-112",
    "…along with the DOI Scholar never gave",
    String(enriched.after.doi),
  );

  // …and the converse: a record that already carries its paper's abstract,
  // citation count and PDF asks for nothing more. Without this the enrichment
  // would fire on every card ever shown.
  await ev(clearStore);
  await reload();
  await ev(stubFetch([["api.openalex.org/works?", [200, OPENALEX_HIT]]]));
  const complete = await ev(`(async () => {
    const S = await import("/viewer/references/sources.mjs");
    const ref = ${JSON.stringify(REF)};
    // Scholar off for this one: the point is a complete record from a database.
    await new Promise((r) => chrome.storage.sync.set({ scholarLookup: false }, r));
    const rec = await S.lookupReference(ref);
    const before = window.__requests.length;
    const added = await S.fetchDetails(ref, rec);
    await new Promise((r) => chrome.storage.sync.set({ scholarLookup: true }, r));
    return { source: rec.source, isAbstract: !!rec.snippetIsAbstract, added, extra: window.__requests.length - before };
  })()`);
  check(
    complete.isAbstract && complete.added === false && complete.extra === 0,
    "a record that already has its abstract asks for nothing more",
    JSON.stringify(complete),
  );

  // ── a DOI in the entry names the record: no SEARCH is spent on it. ──
  // Scholar is stubbed as refusing, so this measures the fallback ladder: the
  // by-DOI request comes next and ends it, with no Crossref/OpenAlex search.
  await ev(clearStore);
  await reload();
  await ev(stubFetch([
    ["scholar.google.com", [200, SCHOLAR_CAPTCHA]],
    ["api.openalex.org/works/doi:", [200, OPENALEX_WORK]],
  ]));
  const byDoi = await ev(lookupThrice({ ...REF, doi: "10.3233/978-1-60750-714-7-112" }));
  check(byDoi.source === "OpenAlex", "a DOI resolves against the record itself", String(byDoi.source));
  check(
    byDoi.requests === 2 && byDoi.hosts[1] === "api.openalex.org",
    "…in one request after Scholar, skipping every search",
    JSON.stringify(byDoi.hosts),
  );
  check(byDoi.pdf, "…and brings the open-access PDF with it");

  // ── the ladder: a source that answers with the WRONG papers is not the end ──
  await ev(clearStore);
  await reload();
  await ev(stubFetch([
    ["scholar.google.com", [200, SCHOLAR_CAPTCHA]],
    ["api.crossref.org/works?", [200, CROSSREF_WRONG]],
    ["api.openalex.org/works?", [200, OPENALEX_HIT]],
  ]));
  const laddered = await ev(lookupThrice());
  check(
    laddered.title === "Applied pi calculus" && laddered.source === "OpenAlex",
    "a first source with only near-misses falls through to the next",
    `${laddered.source}: ${JSON.stringify(laddered.title)}`,
  );
  // The tail is CONCURRENT: OpenAlex and OpenAIRE go out together, so a miss
  // costs the SLOWER of the two rather than their sum. That is the whole
  // reason the rung has this shape — measured, a degraded OpenAlex took nine
  // seconds, and sequentially that was nine seconds before OpenAIRE was asked.
  check(laddered.requests === 4, "…having asked both tail sources", `requests=${laddered.requests}`);
  const gap = Math.abs((laddered.startedAt?.[3] ?? 0) - (laddered.startedAt?.[2] ?? 0));
  check(gap <= 60, "…and the two tail requests went out TOGETHER", `${gap}ms apart`);

  // ── every source down: UNAVAILABLE, not stored, retried later. ──
  await ev(clearStore);
  await reload();
  await ev(stubFetch([["api", [500, "{}"]]]));
  const down = await ev(lookupThrice());
  check(down.unavailable, "every source failing reports as unavailable, not as 'no match'", JSON.stringify(down));
  const stored = await ev(
    `(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith("fx.cite.") && k !== "fx.cite.index").length)()`,
  );
  check(stored === 0, "…is not stored", `records=${stored}`);
  await reload();
  await ev(stubFetch([["api.crossref.org/works?", [200, CROSSREF_HIT]]]));
  const retry = await ev(lookupThrice());
  check(retry.title === "Applied pi calculus", "…and a later load tries again and succeeds", JSON.stringify(retry.title));

  // ── a source that FAILED must not turn into a remembered "no match". ──
  await ev(clearStore);
  await reload();
  await ev(stubFetch([["api.crossref.org/works?", [200, CROSSREF_WRONG]], ["api.openalex.org", [500, "{}"]], ["api.openaire.eu", [500, "{}"]]]));
  const partial = await ev(lookupThrice());
  check(!partial.title, "a lookup whose tail failed finds nothing", JSON.stringify(partial.title ?? null));
  const storedPartial = await ev(
    `(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith("fx.cite.") && k !== "fx.cite.index").length)()`,
  );
  check(storedPartial === 0, "…and is NOT remembered as one — a timeout is not a fact about the paper", `records=${storedPartial}`);

  // ── an entry that is a name and a link never reaches the network. ──
  await ev(stubFetch([]));
  const skipped = await ev(`(async () => {
    const S = await import("/viewer/references/sources.mjs");
    const r = await S.lookupReference({ title: "Amarisoft. https://www.amarisoft.com/.", raw: "Amarisoft. https://www.amarisoft.com/." });
    return { result: r, requests: window.__requests.length };
  })()`);
  check(skipped.result === null && skipped.requests === 0, "a name-plus-link entry spends no request", JSON.stringify(skipped));
} catch (e) {
  check(false, "cache check", e.message || String(e));
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  console.log(failed ? "\nFAILURES" : "\nALL CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
