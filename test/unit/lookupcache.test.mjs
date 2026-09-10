import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, clearCached, isFresh } from "../../extension/viewer/references/lookup-cache.mjs";

const DAY = 24 * 60 * 60 * 1000;
const record = (q, r, ageDays) => ({ v: 1, at: Date.now() - ageDays * DAY, q, r });

test("a cache key is stable, short, and distinct per query", () => {
  assert.equal(cacheKey("Applied pi calculus Ryan 2011"), cacheKey("Applied pi calculus Ryan 2011"));
  assert.notEqual(cacheKey("Applied pi calculus Ryan 2011"), cacheKey("Applied pi calculus Ryan 2012"));
  assert.ok(cacheKey("x".repeat(220)).length < 32);
});

test("a remembered match lasts 30 days, a remembered miss 7", () => {
  const q = "Applied pi calculus Ryan 2011";
  assert.equal(isFresh(record(q, { title: "Applied pi calculus" }, 20), q), true);
  assert.equal(isFresh(record(q, { title: "Applied pi calculus" }, 40), q), false);
  // A miss expires sooner: a preprint indexed next week deserves another ask.
  assert.equal(isFresh(record(q, null, 3), q), true);
  assert.equal(isFresh(record(q, null, 10), q), false);
});

test("a record is only used for the query it was stored under", () => {
  // The key is a 32-bit hash; the stored query is what makes a collision safe.
  const r = record("Applied pi calculus Ryan 2011", { title: "x" }, 1);
  assert.equal(isFresh(r, "Something else entirely"), false);
  assert.equal(isFresh(undefined, "q"), false);
  assert.equal(isFresh({ v: 2, at: Date.now(), q: "q", r: null }, "q"), false);
});

test("clearCached removes all fx.cite.* entries and the index from storage", async () => {
  const map = new Map([
    ["fx.cite.abc.10", { v: 1, q: "q1" }],
    ["fx.cite.def.20", { v: 1, q: "q2" }],
    ["fx.cite.index", ["fx.cite.abc.10", "fx.cite.def.20"]],
    ["other_setting", "value"],
  ]);
  const origChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === null) {
            return Object.fromEntries(map.entries());
          }
          if (typeof keys === "string") {
            return { [keys]: map.get(keys) };
          }
          return {};
        },
        async remove(keys) {
          for (const k of Array.isArray(keys) ? keys : [keys]) {
            map.delete(k);
          }
        },
      },
    },
  };

  try {
    await clearCached();
    assert.equal(map.has("fx.cite.abc.10"), false);
    assert.equal(map.has("fx.cite.def.20"), false);
    assert.equal(map.has("fx.cite.index"), false);
    assert.equal(map.get("other_setting"), "value");
  } finally {
    globalThis.chrome = origChrome;
  }
});

test("mergeRecords fills missing fields without overwriting existing data", async () => {
  const { mergeRecords } = await import("../../extension/viewer/references/lookup-cache.mjs");
  const existing = {
    title: "Attention is All You Need",
    authors: ["Vaswani"],
    cid: "12345",
    snippet: "short fragment...",
    snippetIsAbstract: false,
    doi: null,
  };
  const incoming = {
    snippet: "Real abstract text...",
    snippetIsAbstract: true,
    doi: "10.5555/3295222.3295349",
    pdfUrl: "https://arxiv.org/pdf/1706.03762",
    citedBy: "Cited by 1000",
  };

  const merged = mergeRecords(existing, incoming);
  assert.equal(merged.title, "Attention is All You Need");
  assert.equal(merged.cid, "12345");
  assert.equal(merged.doi, "10.5555/3295222.3295349");
  assert.equal(merged.snippet, "Real abstract text...");
  assert.equal(merged.snippetIsAbstract, true);
  assert.equal(merged.pdfUrl, "https://arxiv.org/pdf/1706.03762");
  assert.equal(merged.citedBy, "Cited by 1000");

  // Prototype pollution attempt
  const malicious = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"polluted": true}}');
  const safeMerged = mergeRecords(existing, malicious);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(safeMerged.polluted, undefined);
});

test("writeCached aliases queries to canonical DOI and avoids duplicate records", async () => {
  const { readCached, writeCached, cacheKey } = await import("../../extension/viewer/references/lookup-cache.mjs");
  const map = new Map();
  const origChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === null) return Object.fromEntries(map.entries());
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) {
              if (map.has(k)) out[k] = map.get(k);
            }
            return out;
          }
          if (typeof keys === "string") return { [keys]: map.get(keys) };
          return {};
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) map.set(k, v);
        },
        async remove(keys) {
          for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
        },
      },
    },
  };

  try {
    const query = "Attention is All You Need Vaswani 2017";
    const initialRecord = {
      title: "Attention is All You Need",
      doi: "10.5555/3295222.3295349",
      cid: "12345",
      snippet: "Initial snippet",
      snippetIsAbstract: false,
    };

    await writeCached(query, initialRecord);

    const canonKey = cacheKey("cid:12345");
    const doiKey = cacheKey("doi:10.5555/3295222.3295349");
    const queryKey = cacheKey(query);

    // CID is canonical key (cid before Canonical Key); query and DOI are alias pointers
    assert.ok(map.has(canonKey), "canonical CID record exists");
    assert.ok(map.has(doiKey), "DOI alias exists");
    assert.equal(map.get(doiKey).alias, "cid:12345");
    assert.ok(map.has(queryKey), "query alias exists");
    assert.equal(map.get(queryKey).alias, "cid:12345");
    assert.equal(map.get(queryKey).r, undefined, "query key does not duplicate record payload");

    // Reading by query follows the alias
    const readBack = await readCached(query);
    assert.equal(readBack.title, "Attention is All You Need");
    assert.equal(readBack.doi, "10.5555/3295222.3295349");
    assert.equal(readBack.cid, "12345");

    // Second write fills missing fields (e.g. abstract and pdfUrl)
    await writeCached(query, {
      snippet: "Full abstract",
      snippetIsAbstract: true,
      pdfUrl: "https://arxiv.org/pdf/1706.03762",
    });

    const updated = await readCached(query);
    assert.equal(updated.snippet, "Full abstract");
    assert.equal(updated.snippetIsAbstract, true);
    assert.equal(updated.pdfUrl, "https://arxiv.org/pdf/1706.03762");
    assert.equal(updated.cid, "12345", "preserved existing field");

    // Direct DOI read follows alias to see the updated merged record
    const byDoi = await readCached("doi:10.5555/3295222.3295349");
    assert.equal(byDoi.snippet, "Full abstract");
    assert.equal(byDoi.cid, "12345");

    // Direct CID read sees the updated merged record
    const byCid = await readCached("cid:12345");
    assert.equal(byCid.snippet, "Full abstract");
    assert.equal(byCid.doi, "10.5555/3295222.3295349");
  } finally {
    globalThis.chrome = origChrome;
  }
});

test("the cache does not require a DOI to work and deduplicates papers by title and author", async () => {
  const { readCached, writeCached, cacheKey } = await import("../../extension/viewer/references/lookup-cache.mjs");
  const map = new Map();
  const origChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === null) return Object.fromEntries(map.entries());
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) {
              if (map.has(k)) out[k] = map.get(k);
            }
            return out;
          }
          if (typeof keys === "string") return { [keys]: map.get(keys) };
          return {};
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) map.set(k, v);
        },
        async remove(keys) {
          for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
        },
      },
    },
  };

  try {
    const refQuery = "Ryan 2011 Applied pi calculus";
    // Paper without any DOI (doi is explicitly null)
    const paperRecord = {
      title: "Applied pi calculus",
      surname: "Ryan",
      year: 2011,
      doi: null,
      cid: "998877",
      snippet: "Draft snippet",
    };

    await writeCached(refQuery, paperRecord);

    // Read back without DOI
    const initial = await readCached(refQuery);
    assert.ok(initial, "record read back successfully without DOI");
    assert.equal(initial.title, "Applied pi calculus");
    assert.equal(initial.doi, null);

    // Another query writes a real abstract and cited count for the same paper (still without DOI)
    await writeCached(refQuery, {
      title: "Applied pi calculus",
      surname: "Ryan",
      snippet: "An abstract without DOI",
      snippetIsAbstract: true,
      citedBy: "Cited by 120",
    });

    const merged = await readCached(refQuery);
    assert.equal(merged.snippet, "An abstract without DOI");
    assert.equal(merged.snippetIsAbstract, true);
    assert.equal(merged.citedBy, "Cited by 120");
    assert.equal(merged.cid, "998877", "preserved existing CID without DOI");
  } finally {
    globalThis.chrome = origChrome;
  }
});



