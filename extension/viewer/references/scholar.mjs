// Fetches a Google Scholar result preview for a reference title. Only runs
// when the user clicks a citation (one search request, like typing the query
// into Scholar manually); results are cached per query for the session.
// Scholar has no public API, so this parses the result page and degrades
// gracefully (returns null) on any change, block, or consent interstitial.

const cache = new Map();
const bibCache = new Map();
const BASE = "https://scholar.google.com";

export function scholarSearchUrl(query) {
  return `${BASE}/scholar?hl=en&q=${encodeURIComponent(query)}`;
}

/**
 * @returns {Promise<{title, url, byline, snippet, citedBy, citedByUrl,
 *           pdfUrl, pdfHost, cid, relatedUrl} | null>} null when no preview.
 */
export function fetchScholarPreview(query) {
  if (!cache.has(query)) {
    const promise = fetchAndParse(query).catch(() => {
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

async function fetchAndParse(query) {
  const res = await fetch(scholarSearchUrl(query), { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  const result = doc.querySelector(".gs_r .gs_ri, .gs_ri");
  if (!result) throw new Error("no parseable result");

  // DOMParser resolves relative hrefs against the extension origin — resolve
  // against Scholar explicitly instead.
  const abs = (a) => (a?.getAttribute("href") ? new URL(a.getAttribute("href"), BASE).href : null);

  const titleA = result.querySelector(".gs_rt a");
  const title = (titleA ?? result.querySelector(".gs_rt"))?.textContent.trim();
  if (!title) throw new Error("no title");
  const cited = [...result.querySelectorAll(".gs_fl a")].find((a) =>
    /^Cited by \d/.test(a.textContent),
  );
  const root = result.closest(".gs_r");
  const pdfA = root?.querySelector(".gs_ggs a") ?? null;
  const pdfUrl = abs(pdfA);
  const related = [...result.querySelectorAll(".gs_fl a")].find((a) =>
    /^Related articles/i.test(a.textContent),
  );
  return {
    title,
    url: abs(titleA),
    byline: result.querySelector(".gs_a")?.textContent.trim() ?? "",
    snippet: result.querySelector(".gs_rs")?.textContent.trim() ?? "",
    citedBy: cited?.textContent.trim() ?? null,
    citedByUrl: abs(cited),
    pdfUrl,
    pdfHost: pdfUrl ? new URL(pdfUrl).hostname.replace(/^www\./, "") : null,
    cid: root?.getAttribute("data-cid") || null,
    relatedUrl: abs(related),
  };
}
