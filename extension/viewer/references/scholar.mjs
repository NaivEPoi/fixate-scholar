// Fetches a Google Scholar result preview for a reference title. Only runs
// when the user clicks a citation (one search request, like typing the query
// into Scholar manually); results are cached per query for the session.
// Scholar has no public API, so this parses the result page and degrades
// gracefully (returns null) on any change, block, or consent interstitial.

const cache = new Map();
const BASE = "https://scholar.google.com";

export function scholarSearchUrl(query) {
  return `${BASE}/scholar?hl=en&q=${encodeURIComponent(query)}`;
}

/**
 * @returns {Promise<{title, url, byline, snippet, citedBy, citedByUrl,
 *           pdfUrl, pdfHost} | null>} null when no preview is available.
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
  const pdfA = result.closest(".gs_r")?.querySelector(".gs_ggs a") ?? null;
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
  };
}
