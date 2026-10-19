import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCards, intersecting, readingOrder, continuesLine } from "../../extension/viewer/references/citations.mjs";

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

test("buildCards makes no stub for a numeric key in an author-year bibliography (R55)", () => {
  // "[512, 256, 1]" is a list of layer sizes where no entry carries a number;
  // with no bibliography parsed at all the stub fallback still applies.
  const authorYear = [{ number: null, label: "Zhou-2023", raw: "Zhou et al. 2023", title: "Uni-Mol" }];
  assert.equal(buildCards(["512", "256", "1"], true, authorYear).cards.length, 0);
  assert.equal(buildCards(["512", "256", "1"], true, []).cards.length, 3);
  assert.equal(buildCards(["12"], true, [entry(4)]).cards.length, 1, "a numbered bibliography keeps its stubs");
  // An alphabetic label ("[A]" — a matrix in prose as often as a citation)
  // never gets a stub: it colours only when an entry carries the label.
  assert.equal(buildCards(["A"], true, []).cards.length, 0);
  assert.equal(buildCards(["RY"], true, [{ number: null, label: "RY", raw: "[RY] Reichstein and Youssin.", title: "" }]).cards.length, 1);
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

const box = (text, left, top, w = 100, h = 10) => ({ text, r: { left, right: left + w, top, bottom: top + h, height: h } });

test("readingOrder puts a two-column page's left column first, rows top to bottom", () => {
  const items = [];
  for (let r = 0; r < 8; r++) {
    items.push(box(`R${r}`, 320, 100 + r * 14, 240));
    items.push(box(`L${r}`, 50, 100 + r * 14, 240));
  }
  const order = readingOrder(items, { left: 0, width: 612 }).map((i) => i.text);
  assert.deepEqual(order, ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7"]);
});

test("readingOrder on one column is rows top to bottom, left to right, whatever the DOM order", () => {
  const items = [box("line 2", 50, 114, 400), box("end of line 1", 300, 100, 150), box("start of line 1", 50, 100, 240)];
  const order = readingOrder(items, { left: 0, width: 612 }).map((i) => i.text);
  assert.deepEqual(order, ["start of line 1", "end of line 1", "line 2"]);
});

test("continuesLine: the same line to the right or the next line down, not further", () => {
  const a = box("a", 150, 100).r;
  assert.equal(continuesLine(a, box("b", 260, 100).r), true, "same line, to the right");
  assert.equal(continuesLine(a, box("b", 50, 114).r), true, "the next line down");
  assert.equal(continuesLine(a, box("b", 50, 121).r), true, "the next line of a double-spaced manuscript (2.1 heights)");
  assert.equal(continuesLine(a, box("b", 50, 130).r), false, "three heights down: not the next line");
  assert.equal(continuesLine(a, box("b", 50, 86).r), false, "the line above");
  assert.equal(continuesLine(a, box("b", 400, 114).r), false, "far to the right on the next line: another column");
});

test("readingOrder: a margin line number goes last, and the right column's first item is marked (R55)", () => {
  // Eight two-column rows; each left line has its line number 30 px clear of it in the margin.
  const items = [];
  for (let r = 0; r < 8; r++) {
    items.push(box(`${800 + r}`, 10, 100 + r * 14, 16));
    items.push(box(`L${r}`, 56, 100 + r * 14, 240));
    items.push(box(`R${r}`, 320, 100 + r * 14, 240));
  }
  const order = readingOrder(items, { left: 0, width: 612 });
  assert.deepEqual(order.map((i) => i.text).slice(0, 16), ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7"]);
  assert.deepEqual(order.map((i) => i.text).slice(16), ["800", "801", "802", "803", "804", "805", "806", "807"], "the numbers come after both columns");
  assert.equal(order.find((i) => i.text === "R0").colStart, true, "the column break is a line break for the join");
  assert.equal(order.find((i) => i.text === "L1").colStart, undefined);
});

test("readingOrder: a subscript rides with its line, and a tall operator does not chain the rows (R55)", () => {
  // Line 1 ends "(Al-" with subscripts hanging below two of its words; line
  // 2 starts "gorithm 1)". A big operator (40 px) mid-line 1 must not widen
  // the row to swallow line 2.
  const l1 = [box("ID", 100, 100, 20), box("PKG", 108, 106, 16, 7), box("∑", 140, 90, 20, 40), box("(Al-", 300, 100, 30)];
  const l2 = [box("gorithm 1), which", 50, 118, 200), box("sk", 60, 124, 12, 7)];
  const l3 = [box("the next line", 50, 136, 200)];
  const order = readingOrder([...l3, ...l2, ...l1], { left: 0, width: 400 }).map((i) => i.text);
  assert.deepEqual(order, ["ID", "PKG", "∑", "(Al-", "gorithm 1), which", "sk", "the next line"]);
});

test("readingOrder: a wide figure on a two-column page does not interleave the columns, and right-margin numbers go last (R55)", () => {
  // Six figure rows span the page's middle; eight body rows below them are
  // two columns, each right-column line numbered in the right margin.
  const items = [];
  for (let r = 0; r < 6; r++) items.push(box(`FIG${r}`, 150, 60 + r * 14, 320));
  for (let r = 0; r < 8; r++) {
    items.push(box(`L${r}`, 50, 200 + r * 14, 240));
    items.push(box(`R${r}`, 320, 200 + r * 14, 240));
    items.push(box(`${40 + r}`, 566, 203 + r * 14, 12, 7)); // close to the text, its own baseline
  }
  const order = readingOrder(items, { left: 0, width: 612 }).map((i) => i.text);
  const left = order.filter((t) => /^L/.test(t)), right = order.filter((t) => /^R/.test(t)), nums = order.filter((t) => /^\d/.test(t));
  assert.deepEqual(left, ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7"]);
  assert.deepEqual(right, ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7"]);
  assert.ok(order.indexOf("L7") < order.indexOf("R0"), "the left column before the right");
  assert.ok(order.indexOf("R7") < order.indexOf(nums[0]), "the margin numbers after both columns");
  assert.ok(order.indexOf("FIG5") < order.indexOf("L0"), "the figure's rows ride above the left column");
});

test("readingOrder: a tall rotated label does not merge the lines around it into one row (R55)", () => {
  // Two columns of eight lines; a rotated axis title 250 px high stands in the
  // right column beside a centred caption. The right column's "Fig-" line must
  // stay in the right sequence, directly before its continuation.
  const items = [];
  for (let r = 0; r < 8; r++) { items.push(box(`L${r}`, 50, 100 + r * 14, 240)); items.push(box(`R${r}`, 320, 100 + r * 14, 240)); }
  items.push({ text: "SBI Payload Size", r: { left: 330, right: 342, top: 40, bottom: 290, height: 250 } });
  items.push(box("Figure 11: centred caption", 200, 160, 220));
  const order = readingOrder(items, { left: 0, width: 612 }).map((i) => i.text);
  assert.deepEqual(order.filter((t) => /^R/.test(t)), ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7"]);
  assert.ok(order.indexOf("L7") < order.indexOf("R0"), "the left column, the caption and the title come before the right column");
  assert.equal(order.indexOf("R5") + 1, order.indexOf("R6"), "a right-column line is followed by the next");
});

test("readingOrder: a page whose rows cross the centre is one column, top to bottom (R55)", () => {
  // A wide figure's labels cross the centre on half the rows: still read by height.
  const items = [];
  for (let r = 0; r < 8; r++) items.push(box(`W${r}`, 100, 100 + r * 14, 400));
  const order = readingOrder(items.reverse(), { left: 0, width: 612 }).map((i) => i.text);
  assert.deepEqual(order, ["W0", "W1", "W2", "W3", "W4", "W5", "W6", "W7"]);
});

test("readingOrder keeps a line together when a math fragment's deeper box ends lower", () => {
  // Same baseline: words 10 px tall, a math fragment 14 px tall reaching 3 px below them.
  const words = { text: "2, for every", r: { left: 50, right: 130, top: 100, bottom: 110, height: 10 } };
  const math = { text: "3, ∆(Γ", r: { left: 140, right: 190, top: 99, bottom: 113, height: 14 } };
  const next = { text: "the proof", r: { left: 50, right: 110, top: 114, bottom: 124, height: 10 } };
  const order = readingOrder([math, next, words], { left: 0, width: 612 }).map((i) => i.text);
  assert.deepEqual(order, ["2, for every", "3, ∆(Γ", "the proof"]);
});
