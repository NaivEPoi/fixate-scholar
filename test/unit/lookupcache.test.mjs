import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, isFresh } from "../../extension/viewer/references/lookup-cache.mjs";

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
