// Fetches a Google Scholar result preview for a parsed reference. Only runs
// when the user clicks a citation (one search request, like typing the query
// into Scholar manually); results are cached per query for the session.
// Scholar has no public API, so this parses the result page and degrades
// gracefully (returns null) on any change, block, or consent interstitial.
//
// The lookup is TITLE + FIRST AUTHOR + YEAR, and the result is VERIFIED against
// the reference before it is shown. Searching the bare title and trusting hit
// #1 is what made three different citations show the same card: a short or
// generic title ("Applied pi calculus") ranks a longer, better-cited paper that
// merely contains those words ("Simulation based security in the applied pi
// calculus") above the work actually cited, and neighbouring citations in the
// same bracket landed on that same paper. When nothing on the page matches the
// reference well enough, this returns null and the caller shows the
// document's own bibliography entry instead of a confidently wrong one.

const cache = new Map();
const bibCache = new Map();
const BASE = "https://scholar.google.com";
/** Results parsed from the search page before scoring. Scholar returns ten. */
const CANDIDATES = 5;

export function scholarSearchUrl(query) {
  return `${BASE}/scholar?hl=en&q=${encodeURIComponent(query)}`;
}

/**
 * The search query for a parsed reference: its title, plus the first author's
 * surname and the year when the title does not already carry them. The extra
 * two terms are what separate a work from the better-cited papers that quote
 * its subject in their own titles.
 *
 * @param ref a parsed entry ({title, surname, year, raw}) or a plain string.
 */
export function referenceQuery(ref) {
  if (typeof ref === "string") return ref.trim();
  const title = queryText(ref?.title || ref?.raw || "");
  const terms = [title];
  const lower = title.toLowerCase();
  const surname = queryText(ref?.surname || "");
  if (surname.length >= 2 && !lower.includes(surname.toLowerCase())) terms.push(surname);
  if (ref?.year && !title.includes(ref.year)) terms.push(String(ref.year).slice(0, 4));
  return terms.join(" ").trim();
}

/** A PDF text layer leaves TeX accent composition behind as loose spacing
 *  accents ("Mart´ın", "C´edric"); they are noise in a search query. */
function queryText(s) {
  return String(s)
    .replace(/[´`ˆ˜¨˚ˇ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

/**
 * @param ref parsed entry (or a bare title string, for callers with nothing
 *        else to go on).
 * @returns {Promise<{title, url, byline, snippet, citedBy, citedByUrl,
 *           pdfUrl, pdfHost, cid, relatedUrl} | null>} null when no result on
 *          the page is a convincing match for `ref`.
 */
export function fetchScholarPreview(ref) {
  const query = referenceQuery(ref);
  if (!query) return Promise.resolve(null);
  if (!cache.has(query)) {
    const promise = fetchAndParse(query, ref).catch(() => {
      cache.delete(query); // allow a retry later
      return null;
    });
    cache.set(query, promise);
  }
  return cache.get(query);
}

/**
 * BibTeX for a result, via Scholar's cite dialog (the same path the "Cite"
 * link uses): the cluster id → cite popup → the signed .bib link → its text.
 * One extra fetch pair, only when the user opens "Cite". Null on any failure
 * (the caller falls back to a locally generated BibTeX).
 */
export function fetchScholarBibtex(cid) {
  if (!cid) return Promise.resolve(null);
  if (!bibCache.has(cid)) {
    const promise = fetchBibtex(cid).catch(() => {
      bibCache.delete(cid);
      return null;
    });
    bibCache.set(cid, promise);
  }
  return bibCache.get(cid);
}

async function fetchBibtex(cid) {
  const citeUrl = `${BASE}/scholar?q=info:${encodeURIComponent(cid)}:scholar.google.com/&output=cite&hl=en`;
  const res = await fetch(citeUrl, { credentials: "omit" });
  if (!res.ok) throw new Error(`cite HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  const links = [...doc.querySelectorAll("a.gs_citi")];
  const bibA = links.find((a) => /bibtex/i.test(a.textContent)) ?? links[0];
  const href = bibA?.getAttribute("href");
  if (!href) throw new Error("no bibtex link");
  const bibRes = await fetch(new URL(href, BASE).href, { credentials: "omit" });
  if (!bibRes.ok) throw new Error(`bib HTTP ${bibRes.status}`);
  const text = (await bibRes.text()).trim();
  if (!text.startsWith("@")) throw new Error("not bibtex");
  return text;
}

async function fetchAndParse(query, ref) {
  const res = await fetch(scholarSearchUrl(query), { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  const roots = [...doc.querySelectorAll(".gs_r")].filter((r) => r.querySelector(".gs_ri"));
  const results = (roots.length ? roots : [...doc.querySelectorAll(".gs_ri")])
    .slice(0, CANDIDATES)
    .map(readResult)
    .filter(Boolean);
  if (!results.length) throw new Error("no parseable result");
  return bestMatch(results, ref);
}

/** One result block → the preview shape, or null when it has no title. */
function readResult(node) {
  // Scholar nests <div class="gs_r" data-cid=...> around <div class="gs_ri">.
  // The cite-cluster id and the [PDF] link live on the OUTER one, the text on
  // the inner — and either may be what the page selector matched.
  const root = node.closest?.(".gs_r") ?? node;
  const result = root.querySelector(".gs_ri") ?? root;
  // DOMParser resolves relative hrefs against the extension origin — resolve
  // against Scholar explicitly instead.
  const abs = (a) => (a?.getAttribute("href") ? new URL(a.getAttribute("href"), BASE).href : null);
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
  const related = [...result.querySelectorAll(".gs_fl a")].find((a) =>
    /^Related articles/i.test(a.textContent),
  );
  const pdfA = root.querySelector(".gs_ggs a") ?? null;
  const pdfUrl = abs(pdfA);
  return {
    title,
    url: abs(titleA),
    byline: result.querySelector(".gs_a")?.textContent.trim() ?? "",
    snippet: result.querySelector(".gs_rs")?.textContent.trim() ?? "",
    citedBy: cited?.textContent.trim() ?? null,
    citedByUrl: abs(cited),
    pdfUrl,
    pdfHost: pdfUrl ? new URL(pdfUrl).hostname.replace(/^www\./, "") : null,
    cid: root.getAttribute("data-cid") || null,
    relatedUrl: abs(related),
  };
}

/** Diacritics dropped, punctuation to spaces, case-folded — so "Martín" and
 *  the text layer's "Mart´ın" compare equal, as do "TLS 1.3" and "TLS 1·3". */
export function fold(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const tokens = (s) => new Set(fold(s).split(" ").filter(Boolean));

/** Dice coefficient over word sets: 1 = same words, 0 = disjoint. Symmetric,
 *  unlike containment — which scores a SUPERSET title ("Simulation based
 *  security in the applied pi calculus" over "Applied pi calculus") a perfect
 *  1.0 and is exactly how the wrong paper got through. */
export function titleScore(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return (2 * hit) / (A.size + B.size);
}

const TITLE_FLOOR = 0.45; // below this the titles are simply different works
const ACCEPT = 0.85; // title score plus the author/year bonuses

/**
 * The best-scoring result that is convincingly the cited work, or null.
 *
 * Score = title similarity + 0.25 if the first author appears in the byline
 * + 0.15 if the year matches within a year (Scholar dates a cluster by its
 * earliest version, so a journal reprint is often a year or two off).
 * A title match alone has to be near-exact; a middling one needs corroboration.
 */
export function bestMatch(results, ref) {
  const wanted = typeof ref === "string" ? { title: ref } : ref || {};
  const refTitle = wanted.title || wanted.raw || "";
  // A hyphenated surname folds to two words ("Ben-Or" -> "ben or"), so the
  // byline test is per word, not on the joined string.
  const surnameWords = fold(wanted.surname || "").split(" ").filter((w) => w.length >= 2);
  const year = parseInt(wanted.year, 10);
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    const dice = titleScore(refTitle, r.title);
    if (dice < TITLE_FLOOR) continue;
    const bylineWords = tokens(r.byline);
    const authorOk =
      surnameWords.length > 0 && surnameWords.every((w) => bylineWords.has(w));
    const resultYear = parseInt((fold(r.byline).match(/\b(?:19|20)\d{2}\b/g) ?? []).at(-1), 10);
    const yearOk =
      Number.isFinite(year) && Number.isFinite(resultYear) && Math.abs(year - resultYear) <= 1;
    const score = dice + (authorOk ? 0.25 : 0) + (yearOk ? 0.15 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= ACCEPT ? best : null;
}
