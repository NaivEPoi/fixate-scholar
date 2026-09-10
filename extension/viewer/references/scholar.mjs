// Google Scholar as a reference source: the default one.
//
// Scholar has no API, so this parses its result page. Two things make that
// workable, and both are properties of HOW the request is made:
//
//   1. It is made with the reader's own browser and their own cookies
//      (`credentials: "include"`). Scholar refuses an anonymous request — a
//      cookieless one gets 429 and a captcha page, measured, from Node and
//      from a browser's fresh profile alike — and answers the same request
//      from a browser that has been to scholar.google.com once: 14 of 15
//      queries at a reader's pace, p50 413ms.
//   2. It is made ONE PER CLICK. Nothing here runs on its own: no crawl, no
//      prefetch, no background pass over a bibliography. A reader clicks a
//      citation and one search happens, which is the search they would have
//      typed themselves.
//
// The consequence a reader should know about is in README's Privacy section:
// these requests carry their Google cookies, so Scholar sees the lookups the
// way it sees their own searches. The open databases in sources.mjs are the
// fallback and carry no cookie at all; either can be turned off in Options.
//
// What Scholar gives that the databases do not: a citation count for anything
// it indexes (not just DOI-registered work), theses and technical reports, and
// its own [PDF] links. What it does not give: an abstract — `.gs_rs` is a
// two-line ellipsed snippet — or a DOI, which is why sources.mjs still enriches
// a Scholar match afterwards when it can.
//
// Every candidate is verified against the reference by matching.mjs before it
// is shown, exactly as for every other source: Scholar ranks by citation count,
// so a generic title puts a better-cited paper above the work actually cited
// (R24-1), and being the default source does not make it trusted.

import { bestMatch } from "./matching.mjs";

const BASE = "https://scholar.google.com";
/** Results parsed from the page before scoring. Scholar returns ten. */
const CANDIDATES = 10;

export function scholarSearchUrl(query) {
  return `${BASE}/scholar?hl=en&q=${encodeURIComponent(query)}`;
}

/**
 * Scholar's refusal, in every wording it has been seen to use.
 *
 * It does NOT always come as an HTTP error. The one that matters most is a
 * 200 whose body says "Please show you're not a robot" while the header still
 * reports "About 34 results" — measured, and served to a real tab navigation
 * as readily as to this fetch once an address has searched enough. Parsed
 * naively that page is zero results, which the ladder would read as "Scholar
 * has nothing", cache as a no-match for a week, and never retry.
 *
 * So every one of these is a REFUSAL: fall through to the open databases, and
 * remember nothing.
 */
const REFUSAL =
  /gs_captcha|id="gs_captcha|not a robot|unusual traffic|automated queries|[/]sorry[/]index/i;

export class ScholarRefused extends Error {}

/**
 * Candidates for `ref` from one Scholar search, in page order.
 *
 * `fetchPage` is injected so the caller owns pacing, timeouts and retries (see
 * sources.mjs) and so a test can drive this with a page of its own.
 */
export async function searchScholar(query, fetchPage) {
  const html = await fetchPage(scholarSearchUrl(query));
  if (REFUSAL.test(html)) throw new ScholarRefused("captcha interstitial");
  return { exact: false, candidates: readResults(html) };
}

/**
 * The result blocks of a Scholar search page as card shapes.
 *
 * Exported so the parse can be measured and tested separately from the fetch —
 * "did Scholar answer", "did the page parse" and "did anything verify" are
 * three different failures with three different fixes.
 */
export function readResults(html, limit = CANDIDATES) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const roots = [...doc.querySelectorAll(".gs_r")].filter((r) => r.querySelector(".gs_ri"));
  return (roots.length ? roots : [...doc.querySelectorAll(".gs_ri")])
    .slice(0, limit)
    .map(readResult)
    .filter(Boolean);
}

/** One result block → the card shape, or null when it has no title. */
function readResult(node) {
  // Scholar nests <div class="gs_r" data-cid=…> around <div class="gs_ri">.
  // The cite-cluster id and the [PDF] link live on the OUTER one, the text on
  // the inner — and either may be what the page selector matched.
  const root = node.closest?.(".gs_r") ?? node;
  const result = root.querySelector(".gs_ri") ?? root;
  // DOMParser resolves relative hrefs against the extension origin — resolve
  // against Scholar explicitly instead. Ensure scheme is strictly http or https.
  const abs = (a) => {
    const href = a?.getAttribute("href");
    if (!href) return null;
    try {
      const u = new URL(href, BASE);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch {
      return null;
    }
  };
  const titleA = result.querySelector(".gs_rt a");
  // An entry Scholar has no page for renders as "[CITATION] Title" with no
  // link; the type tag is not part of the title.
  const title = (titleA ?? result.querySelector(".gs_rt"))?.textContent
    .replace(/^\s*\[[A-Z]+\]\s*/, "")
    .trim();
  if (!title) return null;
  const cited = [...result.querySelectorAll(".gs_fl a")].find((a) =>
    /^Cited by \d/.test(a.textContent),
  );
  const pdfA = root.querySelector(".gs_ggs a") ?? null;
  const pdfUrl = abs(pdfA);
  let pdfHost = null;
  try {
    pdfHost = pdfUrl ? new URL(pdfUrl).hostname.replace(/^www\./, "") : null;
  } catch {
    pdfHost = null;
  }
  const byline = result.querySelector(".gs_a")?.textContent.trim() ?? "";
  return {
    title,
    // Scholar prints the authors, venue and year in one line; matching.mjs
    // reads the author and the year out of it, as it did before there were
    // structured sources.
    byline,
    year: parseInt((byline.match(/\b(?:19|20)\d{2}\b/g) ?? []).at(-1), 10) || null,
    url: abs(titleA),
    // `.gs_rs` is a query-biased snippet, NOT the abstract — labelled as what
    // it is so the card never presents it as one.
    snippet: result.querySelector(".gs_rs")?.textContent.trim() ?? "",
    snippetIsAbstract: false,
    citedBy: cited?.textContent.trim() ?? null,
    citedByUrl: abs(cited),
    pdfUrl,
    pdfHost,
    doi: null,
    cid: root.getAttribute("data-cid") || null,
    source: "Google Scholar",
    sourceUrl: abs(titleA),
  };
}

/**
 * BibTeX from Scholar's own cite dialog, for a match that has no DOI to ask
 * Crossref about: the cluster id → the cite popup → the signed .bib link.
 * Two more requests, only when the reader opens "Cite" and only as a last
 * resort before the locally generated entry.
 */
export async function scholarBibtex(cid, fetchPage) {
  if (!cid) return null;
  const citeUrl = `${BASE}/scholar?q=info:${encodeURIComponent(cid)}:scholar.google.com/&output=cite&hl=en`;
  const doc = new DOMParser().parseFromString(await fetchPage(citeUrl), "text/html");
  const links = [...doc.querySelectorAll("a.gs_citi")];
  const bibA = links.find((a) => /bibtex/i.test(a.textContent)) ?? links[0];
  const href = bibA?.getAttribute("href");
  if (!href) return null;
  let targetUrl;
  try {
    targetUrl = new URL(href, BASE);
    if (targetUrl.origin !== new URL(BASE).origin) return null;
  } catch {
    return null;
  }
  const text = (await fetchPage(targetUrl.href)).trim();
  return text.startsWith("@") ? text : null;
}

/** The verified Scholar match for `ref`, or null. Kept here so the scoring
 *  call sits next to the parse it scores. */
export function verifyScholar(candidates, ref) {
  return bestMatch(candidates, ref);
}
