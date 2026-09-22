import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCards, intersecting } from "../../extension/viewer/references/citations.mjs";

// The page's text-layer segments: contiguous and sorted, the way annotatePage
// builds them (each segment's end is the next one's start).
function segments(lengths) {
  const out = [];
  let pos = 0;
  for (const [i, len] of lengths.entries()) {
    out.push({ span: `span${i}`, start: pos, end: pos + len });
    pos += len;
  }
  return out;
}

// The predicate annotatePage used before the binary search replaced the scan.
const linear = (segs, start, end) =>
  segs.filter((seg) => !(seg.end <= start || seg.start >= end));

test("intersecting matches the linear scan it replaced", () => {
  const segs = segments([5, 1, 12, 3, 40, 2, 7, 1, 1, 20]);
  const total = segs.at(-1).end;
  for (let start = 0; start <= total; start++) {
    for (let end = start; end <= total; end++) {
      assert.deepEqual(
        [...intersecting(segs, start, end)],
        linear(segs, start, end),
        `range [${start}, ${end})`,
      );
    }
  }
});

test("intersecting matches the linear scan on random segment layouts", () => {
  let seed = 12345;
  const rand = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let trial = 0; trial < 200; trial++) {
    const lengths = Array.from({ length: 1 + rand(30) }, () => 1 + rand(15));
    const segs = segments(lengths);
    const total = segs.at(-1).end;
    for (let k = 0; k < 20; k++) {
      const start = rand(total + 1);
      const end = start + rand(total + 1 - start);
      assert.deepEqual(
        [...intersecting(segs, start, end)],
        linear(segs, start, end),
        `trial ${trial} range [${start}, ${end})`,
      );
    }
  }
});

test("intersecting handles the empty page and out-of-range matches", () => {
  assert.deepEqual([...intersecting([], 0, 5)], []);
  const segs = segments([4, 4]);
  assert.deepEqual([...intersecting(segs, 8, 12)], []); // past the last segment
  assert.deepEqual([...intersecting(segs, 0, 0)], []); // empty range
});

// A citation's card list, and which card each key points at. The index is what
// decides the reference a hover opens: "[4, 12]" pointed at the 12 has to open
// [12], and a key's place in the card list is not its place in the key list.
const entry = (number) => ({ number, label: null, raw: `entry ${number}`, title: `Paper ${number}` });

test("buildCards maps each key to the card it produced", () => {
  const entries = [entry(4), entry(12), entry(30)];
  const { cards, indexOf } = buildCards(["4", "12"], true, entries);
  assert.deepEqual(cards.map((c) => c.number), [4, 12]);
  assert.equal(indexOf.get("4"), 0);
  assert.equal(indexOf.get("12"), 1);
});

test("buildCards keeps the mapping right when cards are de-duplicated", () => {
  const entries = [entry(4), entry(12)];
  // The same reference cited twice in one bracket collapses to one card, so
  // the third key's card is index 1 — not index 2, which does not exist.
  const { cards, indexOf } = buildCards(["4", "4", "12"], true, entries);
  assert.deepEqual(cards.map((c) => c.number), [4, 12]);
  assert.equal(indexOf.get("4"), 0);
  assert.equal(indexOf.get("12"), 1);
  for (const [, i] of indexOf) assert.ok(i < cards.length);
});

test("buildCards indexes stub cards for keys the bibliography lost", () => {
  // Only [4] parsed; [12] still gets a stub card, and still its own index.
  const { cards, indexOf } = buildCards(["4", "12"], true, [entry(4)]);
  assert.deepEqual(cards.map((c) => c.number), [4, 12]);
  assert.equal(cards[1].unresolved, true);
  assert.equal(indexOf.get("12"), 1);
});

test("buildCards gives an unresolved author-year citation no cards at all", () => {
  const { cards, indexOf } = buildCards(["Smith-2020"], false, [entry(4)]);
  assert.deepEqual(cards, []);
  assert.equal(indexOf.size, 0);
});
