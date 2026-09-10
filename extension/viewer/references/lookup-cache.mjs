// A lookup result that outlives the page.
//
// Scholar's budget is the scarce resource in this feature: a few dozen
// searches in a few minutes and it answers 429 + a captcha page for a while,
// which costs the NEXT citation the reader clicks its card. The session Map in
// scholar.mjs spends that budget again from zero every time the document is
// reopened — and rereading a paper is the normal case, not the exception.
//
// So results are also kept in chrome.storage.local, keyed by the query:
//   - a MATCH is remembered for 30 days (a published paper's Scholar record
//     does not move),
//   - a MISS for 7 days (shorter: a preprint indexed next week should get
//     another chance),
//   - a REFUSAL is never stored at all — that is a fact about Scholar's mood,
//     not about the reference.
//
// When a paper has a DOI, the canonical storage key is `doi:${cleanDoi}`.
// If DOI is missing, another field (such as paper name + author or cid) is used
// as the key. When multiple queries target the same paper, missing fields are
// filled in the cached record, and queries are aliased to the canonical record
// so there are no duplicated entries in storage.
//
// Local only: chrome.storage.local does not sync, so the record of what was
// looked up stays on the machine it happened on, and ages out on its own.

const PREFIX = "fx.cite.";
const INDEX = "fx.cite.index";
const HIT_TTL = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL = 7 * 24 * 60 * 60 * 1000;
/** Entries kept before the oldest are dropped. ~500 covers several papers'
 *  bibliographies; storage.local has room to spare and this keeps it tidy. */
const CAP = 500;

const area = () =>
  (typeof chrome !== "undefined" && chrome.storage?.local) || null;

export function cleanDoi(doi) {
  const m = /\b(10\.\d{4,9}\/[^\s"'<>]+)/.exec(String(doi ?? ""));
  return m ? m[1].replace(/[).,;]+$/, "").toLowerCase() : null;
}

/** Determine paper-author key if both title and first author are present. */
export function paperAuthorKey(record) {
  if (!record || typeof record !== "object") return null;
  const title = (record.title || "").trim().toLowerCase().replace(/[^\w\s]/g, "");
  let author = "";
  if (record.surname) {
    author = record.surname;
  } else if (Array.isArray(record.authors) && record.authors.length > 0) {
    author = record.authors[0];
  } else if (typeof record.authors === "string" && record.authors.trim()) {
    author = record.authors.split(/[,;]/)[0];
  } else if (typeof record.byline === "string" && record.byline.trim()) {
    author = record.byline.split(/[-–—,;]/)[0];
  }
  author = author.trim().toLowerCase().replace(/[^\w\s]/g, "");

  if (title && author && title.length >= 3 && author.length >= 2) {
    return `paper:${title}:${author}`;
  }
  return null;
}

/** Determine the canonical lookup key for a paper record.
 *  Uses cid before Canonical Key:
 *  - If CID is present, `cid:${cid}` is used first.
 *  - If CID is missing and DOI is present, `doi:${clean}` is used.
 *  - If CID and DOI are missing, paper identity is derived from title + first author (`paper:${title}:${author}`).
 *  - Falls back to `query`. */
export function canonicalKeyFor(query, record) {
  if (!record || typeof record !== "object") return query;
  if (record.cid) return `cid:${record.cid}`;
  const doi = cleanDoi(record.doi);
  if (doi) return `doi:${doi}`;

  const pKey = paperAuthorKey(record);
  if (pKey) return pKey;
  return query;
}

/** Merge an incoming record into an existing cached record, filling any missing fields. */
export function mergeRecords(existing, incoming) {
  if (!existing || typeof existing !== "object") return incoming ?? null;
  if (!incoming || typeof incoming !== "object") return existing ?? null;
  const merged = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null || v === undefined || v === "") continue;
    if (k === "snippet" && incoming.snippetIsAbstract && !merged.snippetIsAbstract) {
      merged.snippet = v;
      merged.snippetIsAbstract = true;
    } else if (merged[k] === null || merged[k] === undefined || merged[k] === "") {
      merged[k] = v;
      if (k === "pdfUrl" && incoming.pdfHost && !merged.pdfHost) {
        merged.pdfHost = incoming.pdfHost;
      }
    }
  }
  return merged;
}

/** A storage key for a query — stable, and short whatever the title's length.
 *  (A 32-bit FNV-1a: this is a cache key, not a checksum. A collision would
 *  show one reference's card on another, so the stored record keeps the query
 *  and is only used when it matches exactly.) */
export function cacheKey(query) {
  let h = 0x811c9dc5;
  for (let i = 0; i < query.length; i++) {
    h ^= query.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return PREFIX + h.toString(36) + "." + query.length.toString(36);
}

/** Is a stored record still usable for `query`? */
export function isFresh(record, query, now = Date.now()) {
  if (!record || record.v !== 1 || record.q !== query) return false;
  return now - record.at < (record.r ? HIT_TTL : MISS_TTL);
}

/**
 * The remembered result for `query`: the preview, `null` for a remembered
 * miss, or `undefined` when nothing usable is stored (so a caller can tell
 * "we know there is no match" from "we have never asked").
 *
 * Automatically resolves alias pointers to retrieve the canonical record.
 */
export async function readCached(query) {
  const store = area();
  if (!store) return undefined;
  try {
    const key = cacheKey(query);
    const got = await store.get(key);
    const entry = got?.[key];
    if (!entry || entry.v !== 1) return undefined;

    // If this entry is an alias pointer, follow it to the canonical record
    if (entry.alias) {
      let currentAlias = entry.alias;
      const visited = new Set([query]);
      while (currentAlias && !visited.has(currentAlias)) {
        visited.add(currentAlias);
        const canonKey = cacheKey(currentAlias);
        const canonGot = await store.get(canonKey);
        const canonEntry = canonGot?.[canonKey];
        if (!canonEntry || canonEntry.v !== 1) return undefined;
        if (canonEntry.alias) {
          currentAlias = canonEntry.alias;
          continue;
        }
        return isFresh(canonEntry, currentAlias) ? canonEntry.r : undefined;
      }
      return undefined;
    }

    return isFresh(entry, query) ? entry.r : undefined;
  } catch {
    return undefined; // a cache that cannot be read is just a cold cache
  }
}

/**
 * Store a result in cache.
 * Uses cid before Canonical Key:
 * If CID is present, canonical key is `cid:${cid}`.
 * If CID is missing and DOI is present, canonical key is `doi:${clean}`.
 * If both CID and DOI are missing, canonical key is `paper:${title}:${author}`.
 * If multiple queries are performed for the same paper, fills missing fields in the existing entry.
 * If query differs from canonical key, stores an alias so no duplicated entry exists.
 */
export async function writeCached(query, result) {
  const store = area();
  if (!store) return;
  try {
    if (!result || typeof result !== "object") {
      // If a BibTeX string is being stored and an existing paper record exists, update its bibtex property
      if (typeof result === "string" && result.startsWith("@")) {
        const qKey = cacheKey(query);
        const existing = await store.get(qKey);
        let targetKey = qKey;
        let prev = existing?.[qKey]?.r;
        if (existing?.[qKey]?.alias) {
          targetKey = cacheKey(existing[qKey].alias);
          const aliasGot = await store.get(targetKey);
          prev = aliasGot?.[targetKey]?.r;
        }
        if (prev && typeof prev === "object") {
          prev.bibtex = result;
          await store.set({ [targetKey]: { v: 1, at: Date.now(), q: existing?.[targetKey]?.q || query, r: prev } });
          await touchIndex(store, targetKey);
          return;
        }
      }
      const qKey = cacheKey(query);
      await store.set({ [qKey]: { v: 1, at: Date.now(), q: query, r: result ?? null } });
      await touchIndex(store, qKey);
      return;
    }

    // Collect candidate lookup keys associated with this query and result
    const candidateQueries = new Set();
    if (query) candidateQueries.add(query);
    const initialCanon = canonicalKeyFor(query, result);
    if (initialCanon) candidateQueries.add(initialCanon);
    if (result.cid) candidateQueries.add(`cid:${result.cid}`);
    const rDoi = cleanDoi(result.doi);
    if (rDoi) candidateQueries.add(`doi:${rDoi}`);
    const rPaper = paperAuthorKey(result);
    if (rPaper) candidateQueries.add(rPaper);

    const keysToGet = Array.from(candidateQueries).map(cacheKey);
    const existing = (await store.get(keysToGet)) || {};

    // Collect alias targets if any
    const aliasTargets = new Set();
    for (const k of keysToGet) {
      if (existing[k]?.alias) {
        aliasTargets.add(existing[k].alias);
      }
    }
    const missingAliasKeys = Array.from(aliasTargets).map(cacheKey).filter((k) => !existing[k]);
    if (missingAliasKeys.length > 0) {
      const gotAliases = await store.get(missingAliasKeys);
      Object.assign(existing, gotAliases);
    }

    // Find any previously stored record across all candidate keys and alias targets
    let prev = null;
    for (const entry of Object.values(existing)) {
      if (entry?.r && typeof entry.r === "object") {
        prev = prev ? mergeRecords(prev, entry.r) : entry.r;
      }
    }

    // Merge incoming into existing to fill missing fields in the cache
    const finalResult = prev ? mergeRecords(prev, result) : result;

    // Determine the canonical key for the merged record (cid before Canonical Key: cid > doi > paper > query)
    const canonQuery = canonicalKeyFor(query, finalResult);
    const canonKey = cacheKey(canonQuery);

    // Save canonical record
    await store.set({ [canonKey]: { v: 1, at: Date.now(), q: canonQuery, r: finalResult } });
    await touchIndex(store, canonKey);

    // Set alias pointers for all related queries that differ from canonical key
    const aliasesToSet = new Set(candidateQueries);
    for (const t of aliasTargets) aliasesToSet.add(t);
    if (finalResult.cid) aliasesToSet.add(`cid:${finalResult.cid}`);
    const finalDoi = cleanDoi(finalResult.doi);
    if (finalDoi) aliasesToSet.add(`doi:${finalDoi}`);
    const finalPaper = paperAuthorKey(finalResult);
    if (finalPaper) aliasesToSet.add(finalPaper);

    for (const q of aliasesToSet) {
      if (q && q !== canonQuery) {
        const aKey = cacheKey(q);
        await store.set({ [aKey]: { v: 1, at: Date.now(), q, alias: canonQuery } });
        await touchIndex(store, aKey);
      }
    }
  } catch {
    // Out of quota, or storage gone
  }
}

/** Insertion order for eviction, in one small key of its own — cheaper than
 *  enumerating every stored entry to find the oldest. */
async function touchIndex(store, key) {
  const got = await store.get(INDEX);
  const keys = (got?.[INDEX] ?? []).filter((k) => k !== key);
  keys.push(key);
  const excess = keys.length - CAP;
  if (excess > 0) {
    const dropped = keys.splice(0, excess);
    await store.remove(dropped);
  }
  await store.set({ [INDEX]: keys });
}

/** Forget everything (the options page's "clear cached lookups"). */
export async function clearCached() {
  const store = area();
  if (!store) return;
  try {
    const all = await store.get(null);
    const keysToRemove = Object.keys(all || {}).filter(
      (k) => k.startsWith(PREFIX) || k === INDEX,
    );
    if (keysToRemove.length) await store.remove(keysToRemove);
  } catch {
    const got = await store.get(INDEX);
    await store.remove([...(got?.[INDEX] ?? []), INDEX]);
  }
}
