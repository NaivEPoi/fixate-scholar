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
 */
export async function readCached(query) {
  const store = area();
  if (!store) return undefined;
  try {
    const key = cacheKey(query);
    const got = await store.get(key);
    const record = got?.[key];
    return isFresh(record, query) ? record.r : undefined;
  } catch {
    return undefined; // a cache that cannot be read is just a cold cache
  }
}

export async function writeCached(query, result) {
  const store = area();
  if (!store) return;
  try {
    const key = cacheKey(query);
    await store.set({ [key]: { v: 1, at: Date.now(), q: query, r: result ?? null } });
    await touchIndex(store, key);
  } catch {
    // Out of quota, or storage gone. The lookup already succeeded; losing the
    // cache write is not worth failing it for.
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
  const got = await store.get(INDEX);
  await store.remove([...(got?.[INDEX] ?? []), INDEX]);
}
