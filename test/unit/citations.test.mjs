import { test } from "node:test";
import assert from "node:assert/strict";
import { intersecting } from "../../extension/viewer/references/citations.mjs";

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
