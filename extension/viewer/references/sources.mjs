// Where a citation card's contents come from.
//
// Five sources, asked in order, stopping at the first record that VERIFIES as
// the reference. Nothing here runs on its own: one click by the reader is one
// lookup, and a lookup is at most a handful of requests.
//
//   Google Scholar  scholar.google.com   — the DEFAULT (scholar.mjs). The
//                                          widest index, a citation count for
//                                          everything in it, and the one that
//                                          needs the reader's own cookies.
//   arXiv           export.arxiv.org/api — exact, by the arXiv id in the entry.
//                                          Abstract and PDF for preprints.
//   Crossref        api.crossref.org     — every DOI-registered work, and
//                                          `query.bibliographic` is built for
//                                          exactly this job: match a raw
//                                          citation string to a record.
//   OpenAlex        api.openalex.org     — 250M+ works. Citation counts, an
//                                          open-access PDF, and the abstract
//                                          Scholar does not give.
//   OpenAIRE        api.openaire.eu      — the venues registering no DOI at all
//                                          (USENIX Security, NDSS); its records
//                                          link the conference's own page.
//
// The four after Scholar are the FALLBACK, and a complete lookup on their own:
// they need no cookie, no key and no account, and they answer with structured
// metadata rather than a page to parse. Either half can be turned off in
// Options (`scholarLookup`, `openSources`) — with both off nothing leaves the
// machine and a card shows the document's own entry.
//
// The one thing a reader must be able to know is WHICH of these saw their
// lookup, so the card names it ("via Crossref") and README's Privacy section
// spells out the difference: Scholar sees these searches the way it sees the
// reader's own, because they carry the same cookies; the other four see an
// anonymous request with a title in it.
//
// Order and cost are measured, not guessed — see `lookup`.
//
// Every candidate is still verified against the reference by matching.mjs
// before it is shown. A source answering is not the same as a source being
// right: `query.bibliographic` always returns its best guess, and its best
// guess for a 3GPP specification is some paper about 5G.
//
// Three outcomes, deliberately distinct: a preview, `null` (the sources
// answered and none of it was this reference), or SOURCES_UNAVAILABLE (nothing
// answered at all — offline). The card says which, because "we could not ask"
// must not read as "this paper does not exist".

import { readCached, writeCached } from "./lookup-cache.mjs";
import { ScholarRefused, scholarBibtex, scholarSearchUrl, searchScholar } from "./scholar.mjs";
import {
  bestMatch,
  isSearchable,
  queryText,
  queryVariants,
  referenceQuery,
  scoreResult,
} from "./matching.mjs";

const cache = new Map();
const bibCache = new Map();
const ROWS = 5; // candidates to ask each search for — the verifier reads them all

/** Nothing answered. Returned rather than thrown so the card can say so. */
export const SOURCES_UNAVAILABLE = Object.freeze({ unavailable: "offline" });

/** The card's Scholar pill — a link, no request. Built in scholar.mjs next to
 *  the search it mirrors, and re-exported so the popup has one import. */
export { scholarSearchUrl };

/**
 * @param ref a parsed bibliography entry ({title, surname, year, doi, raw}).
 * @returns {Promise<{title, url, byline, snippet, citedBy, citedByUrl, pdfUrl,
 *           pdfHost, doi, year, authors, source, sourceUrl} | null |
 *           SOURCES_UNAVAILABLE>}
 */
export function lookupReference(ref) {
  const key = referenceQuery(ref);
  if (!key || !isSearchable(ref)) return Promise.resolve(null);
  if (!cache.has(key)) {
    // The Map is per page — it also collapses the three calls one card makes
    // (body, actions, Cite) into one lookup. The stored cache is what makes
    // reopening a paper free.
    const promise = (async () => {
      const remembered = await readCached(key);
      if (remembered !== undefined) return remembered;
      const { result, complete } = await lookup(ref);
      // Only a lookup where every source ANSWERED may be remembered as a
      // no-match. If one timed out or failed, "not found" is a statement about
      // that minute, and storing it would hide the paper for seven days.
      if (!result?.unavailable && complete) await writeCached(key, result);
      return result;
    })()
      .catch(() => {
        cache.delete(key); // allow a retry later
        return null;
      })
      .then((result) => {
        // Being unable to ask is a passing state of the network, not a fact
        // about this reference. A no-match IS a fact, and is kept.
        if (result?.unavailable) cache.delete(key);
        return result;
      });
    cache.set(key, promise);
  }
  return cache.get(key);
}

/**
 * The verified record for `ref`, or null, or SOURCES_UNAVAILABLE.
 *
 * The order:
 *
 *   1. GOOGLE SCHOLAR, when enabled. The widest index of the five, so it
 *      usually ends the ladder in one request — and the only one that can
 *      refuse (a captcha), which is why the rest stay behind it.
 *   2. an IDENTIFIER the entry prints — an arXiv id, then a DOI. One request
 *      names the work; no search can beat that.
 *   3. Crossref `query.bibliographic` — the purpose-built citation matcher,
 *      and the widest DOI coverage. Measured without Scholar in front of it:
 *      28 of 35 matches, first try.
 *   4. OpenAlex and OpenAIRE together — 5 and 3 of that 35, and the second is
 *      how a USENIX or NDSS paper is found at all.
 *
 * Each rung runs only when the ones before it returned nothing that VERIFIES,
 * so a matched reference cost 1.55 requests on average with Scholar off. With
 * both halves off there is no rung, and the card shows the document's own entry.
 */
async function lookup(ref) {
  let asked = 0;
  let answered = 0;
  const rungs = [];
  const { scholarLookup, openSources } = await lookupSettings();
  // Google Scholar first when it is on: the widest index, a citation count for
  // everything it holds, and one search per click. It is also the only source
  // here that can REFUSE (see scholar.mjs), which is why everything below it
  // stays in place as the fallback.
  if (scholarLookup) rungs.push(["scholar", () => searchScholarSource(ref)]);
  if (!openSources) {
    if (!rungs.length) return { result: null, complete: true };
  } else {
    const id = arxivId(ref?.raw ?? ref?.title ?? "");
    if (id) rungs.push(["arxiv-id", () => byArxivId(id)]);
    const doi = cleanDoi(ref?.doi);
    if (doi) rungs.push(["doi", () => byDoi(doi)]);
    rungs.push(
      ["crossref-search", () => searchCrossref(ref)],
      // The tail runs TOGETHER, not one after the other. Crossref answers most
      // references on its own, so reaching here already means waiting;
      // measured, sequential rungs made a miss cost 4.9s because a degraded
      // OpenAlex took nine seconds before OpenAIRE was even asked.
      // Concurrently, a miss costs the SLOWER of the two (capped by TIMEOUT)
      // instead of the sum, for the same two requests.
      ["tail-search", () => searchTail(ref)],
    );
  }
  const trail = [];

  let failed = 0;
  for (const [name, rung] of rungs) {
    asked++;
    let got;
    try {
      got = await rung();
    } catch {
      failed++;
      trail.push(`${name}:error`);
      continue; // this source is having a bad day; the next one may not be
    }
    answered++;
    const candidates = got?.candidates ?? [];
    // An identifier lookup returns THE work, so it is held to a looser test
    // than a search hit: the entry pointed at it by name.
    const match = !candidates.length
      ? null
      : got.exact
        ? acceptExact(candidates[0], ref)
        : bestMatch(candidates, ref);
    trail.push(`${name}:${candidates.length}${match ? ":match" : ""}`);
    if (match) {
      note(trail, "match");
      return { result: match, complete: true };
    }
  }
  const outcome = answered === 0 && asked > 0 ? SOURCES_UNAVAILABLE : null;
  note(trail, outcome ? "unavailable" : "no-match");
  return { result: outcome, complete: failed === 0 };
}

/** Which rungs were tried, what each returned, and how it ended — for
 *  `test/citelookup.mjs`, which reports coverage per source. Only recorded
 *  under __fxDebug, like the parser's introspection hooks. */
function note(trail, outcome) {
  if (!globalThis.__fxDebug) return;
  globalThis.__fxLookupTrail = { trail, outcome }; // test introspection
}

/**
 * An identifier lookup only has to be plausible, not convincing: the entry
 * named this record. It is still checked, because a DOI misread from the text
 * layer points at a real record that is a different paper — but either the
 * title or the author-and-year agreeing is enough.
 */
function acceptExact(candidate, ref) {
  const { dice, authorOk, yearOk } = scoreResult(candidate, ref);
  return dice >= 0.45 || (authorOk && yearOk) ? candidate : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Requests to ONE service, one at a time and never closer together than
 * MIN_GAP. Different services proceed independently.
 *
 * Per host, not global, because that is what a rate limit is: Crossref does
 * not care how often OpenAlex is asked. A global queue also quietly undid the
 * concurrent tail — the two sources went out 359ms apart instead of together,
 * which is exactly the latency the tail exists to avoid.
 *
 * What it still prevents is the burst ONE service can be shown by a person:
 * paging through a multi-citation card, or clicking down a bibliography.
 * Crossref's public pool answers a burst with 429 (measured: ~20 queries in
 * 30 seconds was enough), and a 429 costs the reader a card. Three requests a
 * second to one service buys nothing here; the reader cannot read that fast.
 */
/**
 * A gap between requests to one service — ZERO in the product.
 *
 * A lookup happens because a reader clicked a citation, and their click is
 * already the rate limit: nothing here runs on its own, so there is no burst
 * to smooth out, and a delay would only make the card slower for the person
 * who asked for it. The protections that cost a reader nothing all remain —
 * the cache (a repeat click is free), one lookup per reference however many
 * times the card asks, the ladder stopping at the first verified match, and
 * the single retry when a service says 429.
 *
 * Automated testing is the exception, because a harness DOES burst: it walks a
 * whole bibliography in a loop with no human in it. `__fxRequestGap` (ms) is
 * the knob for that, set by `test/citelookup.mjs`; the harnesses also sleep
 * between references, which is the part that actually simulates a reader.
 */
const testGap = () => {
  const ms = Number(globalThis.__fxRequestGap); // test introspection
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms * (0.85 + Math.random() * 0.5)) : 0;
};
const queues = new Map();

function paced(url, work) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    host = "?";
  }
  const lane = queues.get(host) ?? { chain: Promise.resolve(), lastAt: 0 };
  queues.set(host, lane);
  const run = lane.chain.then(async () => {
    // Requests to ONE service still queue behind each other — that costs no
    // time (they would share the connection anyway) and keeps the ladder's
    // order readable. Different services are never made to wait for each
    // other: that is what kept the concurrent tail concurrent.
    const wait = testGap() - (Date.now() - lane.lastAt);
    if (wait > 0) await sleep(wait);
    try {
      return await work();
    } finally {
      lane.lastAt = Date.now();
    }
  });
  // The lane must survive a failed request, or one bad lookup wedges the rest.
  lane.chain = run.then(
    () => {},
    () => {},
  );
  return run;
}

/**
 * How long any one source gets before the ladder moves on.
 *
 * A citation card is a reader waiting with the popup open, so a sick service
 * must not be able to hold it: measured, OpenAlex spent 8–9 SECONDS per
 * request during an outage (503s that took nine seconds to arrive), which is
 * most of a 4.9s worst-case card. Crossref's p90 is 1.4s and OpenAIRE's 1.4s,
 * so 3.5s is well clear of a healthy answer and well inside a reader's
 * patience.
 */
const TIMEOUT = 3500;

/**
 * A JSON GET, paced, time-boxed, with one retry ONLY for a rate limit.
 *
 * 429 means "you are asking too fast" — it clears in about a second, says so
 * in `Retry-After`, and waiting is how the card gets filled (two of an early
 * audit's four misses were Crossref 429s reported as "not found"). 503 means
 * the service is unwell, and waiting 1.2s to ask it again is 1.2s the NEXT
 * source could have spent answering — so that one fails over immediately.
 *
 * No custom `User-Agent`, and none is possible from a page: the request goes
 * out with the reader's own browser identity, which is exactly what it is —
 * a person looking up a citation they clicked, not a crawler.
 */
const json = (url) =>
  paced(url, async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await withTimeout(url);
      if (res.ok) return res.json();
      if (res.status !== 429 || attempt > 0) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
      const after = parseFloat(res.headers.get("retry-after") ?? "");
      await sleep(Math.min(Number.isFinite(after) ? after * 1000 : 1200, 2000));
    }
  });

/** An AbortSignal that fires at TIMEOUT — the deadline every source shares. */
function deadline() {
  const abort = new AbortController();
  setTimeout(() => abort.abort(), TIMEOUT);
  return abort.signal;
}

function withTimeout(url, headers = { accept: "application/json" }) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT);
  return fetch(url, { credentials: "omit", headers, signal: abort.signal }).finally(() =>
    clearTimeout(timer),
  );
}

// ── arXiv ──────────────────────────────────────────────────────────────────
// Both id forms: modern ("2409.02905", optional version) and the pre-2007
// archive form ("cs.CR/0605035", "quant-ph/9508027").
const ARXIV_ID =
  /\barxiv\s*:\s*((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-zA-Z]{2})?\/\d{7})(?:v\d+)?)/i;

export function arxivId(text) {
  return ARXIV_ID.exec(String(text))?.[1] ?? null;
}

async function byArxivId(id) {
  const arxivUrl =
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`;
  const xml = await paced(arxivUrl, async () => {
    const res = await withTimeout(arxivUrl, { accept: "application/atom+xml" });
    if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
    return res.text();
  });
  return { exact: true, candidates: arxivEntries(xml) };
}

/** arXiv answers in Atom. Exported for the unit tests, which feed it a
 *  hand-written feed rather than reaching the network. */
export function arxivEntries(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const out = [];
  for (const e of doc.querySelectorAll("entry")) {
    const text = (sel) => e.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const title = text("title");
    if (!title) continue;
    const authors = [...e.querySelectorAll("author > name")].map((n) => n.textContent.trim());
    const year = parseInt(text("published").slice(0, 4), 10) || null;
    const pdf = [...e.querySelectorAll("link")].find((l) => l.getAttribute("title") === "pdf");
    const abs = e.querySelector("id")?.textContent?.trim().replace(/^http:/, "https:") ?? null;
    const journal = text("journal_ref");
    out.push(
      preview({
        title,
        authors,
        year,
        venue: journal || "arXiv preprint",
        abstract: text("summary"),
        url: abs,
        pdfUrl: pdf?.getAttribute("href") ?? (abs ? abs.replace("/abs/", "/pdf/") : null),
        doi: text("doi") || null,
        source: "arXiv",
        sourceUrl: abs,
      }),
    );
  }
  return out;
}

// ── OpenAlex, and Crossref, by DOI ─────────────────────────────────────────
/** A DOI as parsed out of an entry, with the punctuation a sentence leaves on
 *  it. Lowercased: DOIs are case-insensitive and both APIs index them so. */
export function cleanDoi(doi) {
  const m = /\b(10\.\d{4,9}\/[^\s"'<>]+)/.exec(String(doi ?? ""));
  return m ? m[1].replace(/[).,;]+$/, "").toLowerCase() : null;
}

async function byDoi(doi) {
  // OpenAlex first: it knows the DOI metadata AND the citation count and any
  // open-access copy, so one request fills the whole card.
  try {
    const work = openAlexWork(await json(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`));
    if (work) return { exact: true, candidates: [work] };
  } catch {
    // fall through to Crossref — a DOI it registered is a DOI it can describe
  }
  const item = (await json(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)).message;
  return { exact: true, candidates: [crossrefWork(item)].filter(Boolean) };
}

// ── Crossref search ────────────────────────────────────────────────────────
/**
 * `query.bibliographic` is Crossref's reference matcher: it takes a whole
 * citation string — authors, title, year, the lot — and is built to find the
 * record it describes. So it gets the entry as parsed, links and venue tail
 * stripped, rather than a bare title.
 */
async function searchCrossref(ref) {
  const q = queryText(ref?.raw || ref?.title || "") || referenceQuery(ref);
  if (!q) return [];
  const url =
    `https://api.crossref.org/works?rows=${ROWS}` +
    `&select=DOI,title,subtitle,author,issued,container-title,abstract,is-referenced-by-count,URL,link,type` +
    `&query.bibliographic=${encodeURIComponent(q)}`;
  return { exact: false, candidates: ((await json(url)).message?.items ?? []).map(crossrefWork).filter(Boolean) };
}

const first = (v) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * One Crossref record → the card shape. Exported for the unit tests.
 *
 * The SUBTITLE has to be put back on: Crossref registers "5GReasoner" and
 * "A Property-Directed Security and Privacy Analysis Framework for 5G
 * Cellular Network Protocol" as two fields, and a card built from `title`
 * alone scores one word against the reference's fifteen — the right record,
 * first hit, rejected. Measured on two of four misses in the first audit.
 */
export function crossrefWork(item) {
  const head = first(item?.title).replace(/\s+/g, " ").trim();
  if (!head) return null;
  const sub = first(item?.subtitle).replace(/\s+/g, " ").trim();
  // Rejoin the way the publisher prints it: a colon, unless one is already there.
  const title = sub && !head.endsWith(":") ? `${head}: ${sub}` : (sub ? `${head} ${sub}` : head);
  const authors = (item.author ?? []).map((a) =>
    [a.given, a.family].filter(Boolean).join(" ").trim() || a.name || "",
  );
  const doi = cleanDoi(item.DOI);
  const pdf = (item.link ?? []).find(
    (l) => l["content-type"] === "application/pdf" || /\.pdf($|\?)/i.test(l.URL ?? ""),
  );
  return preview({
    title,
    authors: authors.filter(Boolean),
    year: item.issued?.["date-parts"]?.[0]?.[0] ?? null,
    venue: first(item["container-title"]),
    abstract: stripJats(item.abstract),
    url: item.URL ?? (doi ? `https://doi.org/${doi}` : null),
    pdfUrl: pdf?.URL ?? null,
    doi,
    citedByCount: item["is-referenced-by-count"] ?? null,
    citedByUrl: null, // Crossref has the count, not a page listing them
    source: "Crossref",
    sourceUrl: doi ? `https://doi.org/${doi}` : (item.URL ?? null),
  });
}

// ── OpenAlex search ────────────────────────────────────────────────────────
// `abstract_inverted_index` is in here because the card shows an abstract when
// the record has one, and OpenAlex is the source most likely to: publishers
// deposit abstracts with Crossref only sometimes (none of the nine Crossref
// matches in a latency run had one), while OpenAlex reconstructs them.
/**
 * The OpenAlex record for a match that has no DOI — a Google Scholar result —
 * found by title and verified against the reference before it is used.
 *
 * Without the verification this would be a way to attach a stranger's abstract
 * and citation count to the right paper's card, which is the same mistake
 * `bestMatch` exists to prevent.
 */
async function openAlexByTitle(ref, record) {
  const head = titleWords(queryText(record.title || ref?.title || "")).slice(0, 4).join(" ");
  if (!head) return null;
  const items = ((
    await json(
      `https://api.openalex.org/works?per-page=${ROWS}` +
        `&select=${OPENALEX_FIELDS}&filter=${encodeURIComponent(`title.search:${head}`)}`,
    )
  ).results ?? []).filter(Boolean);
  const match = bestMatch(items.map(openAlexWork).filter(Boolean), ref);
  if (!match) return null;
  // The scored candidate is the card shape; the raw work is what carries the
  // fields being copied across.
  return items.find((w) => openAlexWork(w)?.title === match.title) ?? null;
}

const OPENALEX_FIELDS =
  "id,doi,display_name,authorships,publication_year,primary_location,best_oa_location," +
  "cited_by_count,abstract_inverted_index";

/**
 * OpenAlex matches titles with AND semantics — every word of the query has to
 * be in the indexed title — and a lot of its titles are the SHORT form:
 * "5GReasoner", "Breaking and Fixing VoLTE", "The Open-Source LearnLib", with
 * the subtitle nowhere. A full-title query therefore misses exactly the
 * records whose title was truncated.
 *
 * So it is asked for the first few words, which is where a title's
 * distinguishing part is ("5GReasoner: …", "BLEDiff: …", "Snipuzz: …"), and
 * the verifier still has to accept whatever comes back. Measured on the four
 * misses of the first audit: the full title found 0 for three of them, the
 * first four words found all three.
 *
 * Second try, only when the first found nothing: `search`, which is
 * relevance-ranked over title, abstract and full text — looser, and the last
 * thing to try before giving up.
 */
async function searchOpenAlex(ref) {
  const title = queryText(ref?.title || ref?.raw || "");
  if (!title) return { exact: false, candidates: [] };
  const head = titleWords(title).slice(0, 4).join(" ");
  const queries = [
    `&filter=${encodeURIComponent(`title.search:${head || title}`)}`,
    `&search=${encodeURIComponent(title)}`,
  ];
  const out = [];
  for (const q of queries) {
    const items =
      ((await json(`https://api.openalex.org/works?per-page=${ROWS}&select=${OPENALEX_FIELDS}${q}`))
        .results ?? []).map(openAlexWork).filter(Boolean);
    out.push(...items);
    if (bestMatch(out, ref)) break; // no need to spend the looser query
  }
  return { exact: false, candidates: out };
}

/** Title words as a search sees them: punctuation gone, and the words that
 *  carry no distinguishing weight dropped so "the open source learnlib" does
 *  not spend three of its four slots on "the", "a", "of". */
const STOP = new Set(["a", "an", "the", "of", "for", "and", "on", "in", "to", "with", "via", "using"]);
function titleWords(title) {
  return title
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()));
}

/** One OpenAlex work → the card shape. Exported for the unit tests. */
export function openAlexWork(work) {
  const title = work?.display_name?.replace(/\s+/g, " ").trim();
  if (!title) return null;
  const authors = (work.authorships ?? []).map(
    (a) => a.author?.display_name || a.raw_author_name || "",
  );
  const oa = work.best_oa_location ?? null;
  const pdfUrl = oa?.pdf_url ?? work.primary_location?.pdf_url ?? null;
  const doi = cleanDoi(work.doi);
  return preview({
    title,
    authors: authors.filter(Boolean),
    year: work.publication_year ?? null,
    venue: work.primary_location?.source?.display_name ?? "",
    abstract: openAlexAbstract(work.abstract_inverted_index),
    url: doi ? `https://doi.org/${doi}` : (work.primary_location?.landing_page_url ?? work.id ?? null),
    pdfUrl,
    doi,
    citedByCount: work.cited_by_count ?? null,
    citedByUrl: work.id ? work.id.replace("https://openalex.org/", "https://openalex.org/works/") : null,
    source: "OpenAlex",
    sourceUrl: work.id ?? null,
  });
}

// ── Google Scholar ─────────────────────────────────────────────────────────
/**
 * The Scholar rung: one search, with the reader's own cookies, for the query
 * matching.mjs builds.
 *
 * `credentials: "include"` is the whole difference between an answer and a
 * captcha — Scholar refuses an anonymous request. It is also the reason this
 * source is disclosed in README's Privacy section and can be turned off: the
 * request carries the reader's Google session, which none of the others do.
 *
 * A refusal is not a failure of the reference — it throws `ScholarRefused` and
 * the ladder falls through to the open databases, which need no cookie.
 */
async function searchScholarSource(ref) {
  // The TITLE ALONE, which is the opposite of what the other sources want and
  // is measured: "Attention is all you need" returns that paper first, while
  // "Attention is all you need Vaswani 2017" returns three unrelated recent
  // papers and not the work at all. Scholar reads the extra terms as more
  // topic rather than as a narrower identity.
  //
  // Safe here for the same reason the R28 ladder was: `bestMatch` verifies
  // every candidate against the reference, so a bare title cannot promote the
  // better-cited paper that merely contains those words (R24-1) — it can only
  // fail to find the right one, and then the ladder moves on.
  const query = queryText(ref?.title || ref?.raw || "") || referenceQuery(ref);
  if (!query) return { exact: false, candidates: [] };
  return searchScholar(query, scholarPage);
}

/** A Scholar page: paced and time-boxed like every other request, but sent
 *  WITH cookies and asking for HTML rather than JSON. */
const scholarPage = (url) =>
  paced(url, async () => {
    const res = await fetch(url, {
      credentials: "include",
      headers: { accept: "text/html,application/xhtml+xml" },
      signal: deadline(),
    });
    if (!res.ok) throw new ScholarRefused(`HTTP ${res.status}`);
    return res.text();
  });

/** The two toggles that decide which sources a lookup may use. Read per
 *  lookup, so turning one off in Options takes effect on the next click. */
async function lookupSettings() {
  try {
    const { scholarLookup = true, openSources = true } = await chrome.storage.sync.get({
      scholarLookup: true,
      openSources: true,
    });
    return { scholarLookup, openSources };
  } catch {
    return { scholarLookup: true, openSources: true }; // no storage: the defaults
  }
}

/**
 * OpenAlex and OpenAIRE at once, their candidates pooled for the verifier.
 *
 * Order still matters inside the pool: OpenAlex first, because when both have
 * the paper its record is the richer one (citation count, open-access PDF,
 * abstract), and `bestMatch` keeps the FIRST of equally-scoring candidates.
 * A source that fails contributes nothing and costs nothing — the other still
 * answers.
 */
async function searchTail(ref) {
  const [openalex, openaire] = await Promise.allSettled([searchOpenAlex(ref), searchOpenAire(ref)]);
  const candidates = [
    ...(openalex.status === "fulfilled" ? openalex.value.candidates : []),
    ...(openaire.status === "fulfilled" ? openaire.value.candidates : []),
  ];
  if (openalex.status === "rejected" && openaire.status === "rejected") {
    throw openalex.reason ?? openaire.reason;
  }
  return { exact: false, candidates };
}

// ── OpenAIRE ───────────────────────────────────────────────────────────────
/**
 * Last rung, and the one that reaches the CONFERENCE PROCEEDINGS: USENIX
 * Security and NDSS register no DOIs, so Crossref cannot have them, and
 * OpenAlex had ingested none of the three such papers a 39-reference audit
 * missed. OpenAIRE had all three — collected from DBLP — and the record it
 * returns links the paper's page ON THE VENUE'S OWN SITE
 * (usenix.org/conference/usenixsecurity22/presentation/…), which is the most
 * authoritative link there is for such a paper.
 *
 * Which is also why the venue sites are not queried directly: usenix.org
 * answers a scripted request with 403 and dblp.org with a bot-check page, and
 * each venue would need its own scraper to break on its own schedule. An
 * aggregator that indexes them all and answers with JSON is the same data
 * without any of that.
 *
 * (Semantic Scholar was measured here first and rejected: it has these papers,
 * but its keyless pool answered 429 to every single request of the audit, and
 * a rung that always fails is two wasted requests per unmatched reference.)
 */
async function searchOpenAire(ref) {
  const q = queryText(ref?.title || ref?.raw || "");
  if (!q) return { exact: false, candidates: [] };
  const url =
    `https://api.openaire.eu/search/publications?format=json&size=${ROWS}` +
    `&title=${encodeURIComponent(q)}`;
  const results = [].concat((await json(url)).response?.results?.result ?? []);
  return { exact: false, candidates: results.map(openAireWork).filter(Boolean) };
}

/** Hosts that INDEX papers rather than publish them: a link to one is a
 *  fallback, not the paper page a reader asked for. */
const AGGREGATOR =
  /^https?:\/\/(?:[\w-]+\.)*(?:dblp\.org|openaire\.eu|core\.ac\.uk|base-search\.net|semanticscholar\.org|scilit\.net)\//i;

/** One OpenAIRE result → the card shape. Exported for the unit tests.
 *  (Its JSON wraps every value as `{$: value}` with attributes alongside.) */
export function openAireWork(result) {
  const meta = result?.metadata?.["oaf:entity"]?.["oaf:result"];
  if (!meta) return null;
  const text = (v) => {
    const one = Array.isArray(v) ? v[0] : v;
    return typeof one === "string" ? one : (one?.$ ?? "");
  };
  // A DBLP-collected title ends in a period; a title does not.
  const title = text(meta.title).replace(/\s+/g, " ").replace(/\.$/, "").trim();
  if (!title) return null;
  const authors = []
    .concat(meta.creator ?? [])
    .sort((a, b) => (parseInt(a?.["@rank"], 10) || 99) - (parseInt(b?.["@rank"], 10) || 99))
    .map((c) => text(c))
    .filter(Boolean);
  const instances = [].concat(meta.children?.instance ?? []);
  const links = instances
    .flatMap((i) => [].concat(i.webresource ?? []).map((w) => text(w?.url)))
    .filter(Boolean);
  // Prefer the venue's own page over an index of it: a DBLP-collected record
  // links usenix.org when DBLP has the paper's `ee`, and its own record page
  // when it does not. Both are useful; only one is where the paper lives.
  const link = links.find((u) => !AGGREGATOR.test(u)) ?? links[0] ?? null;
  const year = parseInt(text(meta.dateofacceptance) || text(instances[0]?.dateofacceptance), 10);
  const doi = cleanDoi([].concat(meta.pid ?? []).map((p) => text(p)).find((p) => /^10\./.test(p)));
  return preview({
    title,
    authors,
    year: Number.isFinite(year) ? year : null,
    venue: "",
    abstract: text(meta.description),
    url: doi ? `https://doi.org/${doi}` : link,
    // Only a link that IS a PDF becomes the [PDF] pill; a venue's paper page
    // is the record's link, not a file.
    pdfUrl: link && /\.pdf($|\?)/i.test(link) ? link : null,
    doi,
    source: "OpenAIRE",
    sourceUrl: link,
  });
}

/** OpenAlex stores an abstract as {word: [positions]}. Put it back in order.
 *  (Absent on most records — the card simply shows no snippet then.) */
export function openAlexAbstract(index) {
  if (!index || typeof index !== "object") return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) words[p] = word;
  }
  return words.filter((w) => w !== undefined).join(" ").trim();
}

/** Crossref abstracts arrive as JATS XML. The card wants a sentence. */
export function stripJats(abstract) {
  if (!abstract) return "";
  return String(abstract)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s*Abstract\s*/i, "")
    .trim();
}

const SNIPPET = 320;

/**
 * Fill in what a matched record arrived without — the abstract, the citation
 * count, an open-access PDF — from OpenAlex BY DOI, which is exact and needs
 * no matching. Returns true when anything was added.
 *
 * All three come from ONE request, because they are three fields of one
 * record: Crossref carries whatever the publisher deposited, which for
 * conference papers is usually no abstract at all (measured: not one of nine
 * Crossref matches had one), and arXiv knows nothing about citations.
 *
 * Deliberately NOT part of `lookup`: it is one more request, and the card
 * should be on screen before it happens. The caller renders the record, then
 * fills these in when this resolves — and the record is updated in place and
 * re-stored, so reopening the paper already has them.
 */
export async function fetchDetails(ref, record) {
  const wantsAbstract = record && !record.unavailable && !record.snippetIsAbstract;
  const wants =
    record && !record.unavailable && (wantsAbstract || !record.citedBy || !record.pdfUrl);
  if (!wants) return false;
  if (!(await lookupSettings()).openSources) return false; // asking OpenAlex is a fallback too
  try {
    const work = record.doi
      ? await json(
          `https://api.openalex.org/works/doi:${encodeURIComponent(record.doi)}` +
            `?select=abstract_inverted_index,cited_by_count,best_oa_location,doi`,
        )
      : // A Google Scholar match has no DOI — its result page never prints one
        // — so the record is found again by title and VERIFIED before anything
        // from it is used. Same rule as everywhere else: a source answering is
        // not a source being right.
        await openAlexByTitle(ref, record);
    if (!work) return false;
    let added = false;
    // A real abstract replaces Scholar's snippet — that snippet is a
    // query-biased fragment with ellipses, and the card should show the paper's
    // own words when they can be had.
    const abstract = record.snippetIsAbstract ? "" : openAlexAbstract(work?.abstract_inverted_index);
    if (abstract) {
      record.snippet = abstract.length > SNIPPET ? abstract.slice(0, SNIPPET).trimEnd() + "…" : abstract;
      record.snippetIsAbstract = true;
      added = true;
    }
    if (!record.doi && work?.doi) {
      record.doi = cleanDoi(work.doi);
      added = added || !!record.doi; // a DOI is a Cite button and a DOI pill
    }
    if (!record.citedBy && Number.isFinite(work?.cited_by_count)) {
      record.citedBy = `Cited by ${work.cited_by_count}`;
      added = true;
    }
    const pdf = work?.best_oa_location?.pdf_url;
    if (!record.pdfUrl && pdf) {
      record.pdfUrl = pdf;
      try {
        record.pdfHost = new URL(pdf).hostname.replace(/^www\./, "");
      } catch {
        record.pdfUrl = null;
      }
      added = !!record.pdfUrl || added;
    }
    if (added) await writeCached(referenceQuery(ref), record);
    return added;
  } catch {
    return false; // these are extras; failing to get them is not a failure
  }
}

/** The one shape the card renders, whichever source produced it. */
function preview({
  title,
  authors = [],
  year = null,
  venue = "",
  abstract = "",
  url = null,
  pdfUrl = null,
  doi = null,
  citedByCount = null,
  citedByUrl = null,
  source,
  sourceUrl = null,
}) {
  // "M D Ryan, B Smyth - Formal Models and Techniques, 2011": the same line a
  // reader expects under a title, and the line the verifier reads for the
  // author and the year when a source gives no structured ones.
  const byline = [authors.slice(0, 6).join(", ") + (authors.length > 6 ? ", et al." : ""), venue, year]
    .filter(Boolean)
    .join(" - ");
  let host = null;
  try {
    host = pdfUrl ? new URL(pdfUrl).hostname.replace(/^www\./, "") : null;
  } catch {
    host = null; // a malformed link is not worth failing a card over
  }
  return {
    title,
    authors,
    year,
    venue,
    byline,
    snippet: abstract.length > SNIPPET ? abstract.slice(0, SNIPPET).trimEnd() + "…" : abstract,
    // These four sources hand over the paper's OWN abstract, so a card built
    // from one needs no second request to get a better snippet. (Scholar sets
    // this false: its `.gs_rs` is a query-biased fragment, not an abstract.)
    snippetIsAbstract: !!abstract,
    citedBy: Number.isFinite(citedByCount) ? `Cited by ${citedByCount}` : null,
    citedByUrl,
    url,
    pdfUrl,
    pdfHost: host,
    doi,
    source,
    sourceUrl,
  };
}

/**
 * BibTeX for a matched record, from the DOI itself: Crossref's content
 * negotiation returns the publisher's own registered metadata as BibTeX. That
 * is better than what this feature used to show (Scholar's cite dialog, keyed
 * by a cluster id, so a wrong match produced a wrong BibTeX), and it needs no
 * second identifier.
 *
 * Null when there is no DOI or the transform fails — the caller falls back to
 * a BibTeX built from the parsed entry, which always yields something copyable.
 */
export function fetchBibtex(doi, record = null) {
  const clean = cleanDoi(doi ?? record?.doi);
  const cid = record?.cid ?? null;
  const key = clean ?? (cid ? `cid:${cid}` : null);
  if (!key) return Promise.resolve(null);
  if (!bibCache.has(key)) {
    const promise = (async () => {
      // The publisher's own registered entry, when there is a DOI to ask about.
      if (clean) {
        const bibUrl = `https://api.crossref.org/works/${encodeURIComponent(clean)}/transform/application/x-bibtex`;
        const text = await paced(bibUrl, async () => {
          const res = await fetch(bibUrl, {
            credentials: "omit",
            headers: { accept: "application/x-bibtex" },
            signal: deadline(),
          });
          if (!res.ok) throw new Error(`bibtex HTTP ${res.status}`);
          return (await res.text()).trim();
        });
        if (text.startsWith("@")) return text;
      }
      // A Google Scholar match has no DOI, and Scholar's own cite dialog does
      // have a BibTeX for it. Only reached when the reader opened "Cite".
      if (cid) return scholarBibtex(cid, scholarPage);
      return null;
    })().catch(() => {
      bibCache.delete(key);
      return null;
    });
    bibCache.set(key, promise);
  }
  return bibCache.get(key);
}
