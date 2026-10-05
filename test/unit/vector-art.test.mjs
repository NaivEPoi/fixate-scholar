import { test } from "node:test";
import assert from "node:assert/strict";
import { artUnder, barsNear, vectorArt } from "../../extension/viewer/typography/vector-art.mjs";

// The operator ids vector-art.mjs reads; the values only need to be distinct.
const OPS = {
  save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75,
  beginAnnotation: 80, endAnnotation: 81, setFillRGBColor: 59, setStrokeRGBColor: 58, constructPath: 91, clip: 30, eoClip: 31, beginGroup: 76, endGroup: 77,
  stroke: 20, fill: 22, eoFill: 23, endPath: 28, setLineWidth: 2,
};
const list = (...ops) => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) });
const path = (op, box) => [OPS.constructPath, [op, [null], box]];
// A 10 pt line of text at baseline y=100 from x=50 to x=150.
const item = { transform: [10, 0, 0, 10, 50, 100], width: 100, height: 10 };

test("a stroked circle on a line of text is art under it", () => {
  const art = vectorArt(list(path(OPS.stroke, [120, 97, 131, 108])), OPS);
  assert.equal(art.length, 1);
  assert.ok(artUnder(art, item));
});

test("rules, clip paths, white fills and annotations are not art", () => {
  const art = vectorArt(list(
    path(OPS.stroke, [50, 98, 150, 98.4]), // an underline
    path(OPS.endPath, [40, 90, 160, 115]), // a clip
    [OPS.setFillRGBColor, ["#ffffff"]], path(OPS.fill, [60, 97, 90, 108]),
    [OPS.beginAnnotation, []], path(OPS.stroke, [120, 97, 131, 108]), [OPS.endAnnotation, []],
  ), OPS);
  assert.deepEqual(art, []);
});

test("a coloured fill behind a phrase is art; a figure-sized one is not", () => {
  const fills = (box) => vectorArt(list([OPS.setFillRGBColor, ["#ffff00"]], path(OPS.fill, box)), OPS);
  assert.ok(artUnder(fills([60, 97, 110, 109]), item));
  assert.equal(artUnder(fills([0, 0, 300, 400]), item), null);
});

test("the transform and form matrices place the path", () => {
  // Drawn at the origin, moved onto the line by a form matrix and a cm.
  const art = vectorArt(list(
    [OPS.save], [OPS.transform, [1, 0, 0, 1, 100, 0]],
    [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 20, 97], null]],
    path(OPS.stroke, [0, 0, 11, 11]),
    [OPS.paintFormXObjectEnd], [OPS.restore],
    path(OPS.stroke, [0, 0, 11, 11]), // after restore: back at the origin
  ), OPS);
  // Sorted by bottom edge.
  assert.deepEqual(art.map((b) => b.map(Math.round)), [[0, 0, 11, 11], [120, 97, 131, 108]]);
  assert.equal(artUnder([art[0]], item), null);
});

test("art beside the line, or on another line, is not under it", () => {
  assert.equal(artUnder([[160, 97, 171, 108]], item), null);
  assert.equal(artUnder([[120, 120, 131, 131]], item), null);
  assert.equal(artUnder([[120, 97, 131, 108]], { ...item, transform: [0, 10, -10, 0, 50, 100] }), null);
});

test("a path is cut to its clip and to the page", () => {
  // A plot line running far past its figure, clipped to the figure's frame:
  // only the part inside the frame is art, and none of it reaches the text.
  const art = vectorArt(list(
    [OPS.save], [OPS.clip], path(OPS.endPath, [300, 200, 500, 400]),
    path(OPS.stroke, [-20000, 250, 480, 380]),
    [OPS.restore],
    path(OPS.stroke, [-20000, 97, 131, 108]), // unclipped: cut to the page view
  ), OPS, [0, 0, 612, 792]);
  assert.deepEqual(art, [[0, 97, 131, 108], [300, 250, 480, 380]]);
  assert.equal(artUnder([art[1]], item), null);
});

test("a form paints nothing outside its BBox", () => {
  const art = vectorArt(list(
    [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 100, 90], [0, 0, 40, 30]]],
    path(OPS.stroke, [-500, 5, 20, 18]),
    [OPS.paintFormXObjectEnd],
  ), OPS);
  assert.deepEqual(art, [[100, 95, 120, 108]]);
});

test("many boxes: only those near the line are tested, the answer is the same", () => {
  const noise = Array.from({ length: 5000 }, (_, i) => [OPS.stroke, [i % 500, 200 + (i % 300), (i % 500) + 5, 206 + (i % 300)]]);
  const art = vectorArt(list(...noise.map(([op, box]) => path(op, box)), path(OPS.stroke, [120, 97, 131, 108])), OPS);
  assert.ok(artUnder(art, item));
  assert.equal(artUnder(art, { ...item, transform: [10, 0, 0, 10, 50, 150] }), null);
});

test("a group form paints nothing outside its BBox", () => {
  const art = vectorArt(list(
    [OPS.beginGroup, [{ matrix: [1, 0, 0, 1, 100, 90], bbox: [0, 0, 40, 30] }]],
    [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 100, 90], null]],
    path(OPS.stroke, [-500, 5, 20, 18]),
    [OPS.paintFormXObjectEnd], [OPS.endGroup],
    path(OPS.stroke, [-500, 5, 20, 18]), // outside the group: the page view only
  ), OPS, [0, 0, 612, 792]);
  assert.deepEqual(art, [[0, 5, 20, 18], [100, 95, 120, 108]]);
});

// Strike-through: the bar runs through the glyphs between baseline and
// x-height; the engine cuts it out of the masks so struck words stay struck.
test("a stroked strike-out bar is collected at its line width; art is unchanged", () => {
  const bars = [];
  // ulem's \sout: a zero-height stroked line at 0.4 pt, through the x-height.
  const art = vectorArt(list([OPS.setLineWidth, [0.4]], path(OPS.stroke, [50, 102.5, 150, 102.5])), OPS, undefined, bars);
  assert.deepEqual(art, []);
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0].map((v) => +v.toFixed(2)), [50, 102.3, 150, 102.7]);
  assert.equal(barsNear(bars, item).length, 1);
});

test("a white stroked bar inks nothing and is not collected", () => {
  const bars = [];
  vectorArt(list(
    [OPS.save, []], [OPS.setStrokeRGBColor, ["#ffffff"]], path(OPS.stroke, [50, 102.5, 150, 102.5]), [OPS.restore, []],
    path(OPS.stroke, [50, 98, 150, 98]), // back to black after restore
  ), OPS, undefined, bars);
  assert.equal(bars.length, 1);
  assert.equal(bars[0][0], 50);
  assert.ok(bars[0][1] < 98 && bars[0][3] > 98);
});

test("bars through, under and around the line count; a distant one does not", () => {
  const bars = [];
  vectorArt(list(
    path(OPS.fill, [60, 102, 140, 102.4]), // through the x-height: a strike-out
    path(OPS.fill, [70, 98.6, 75, 99.1]), // under the baseline: an underscore drawn as a rule
    path(OPS.fill, [50, 109, 150, 109.4]), // above the glyphs
    path(OPS.fill, [50, 202, 150, 202.4]), // another line, far away
  ), OPS, undefined, bars);
  assert.equal(bars.length, 4);
  assert.deepEqual(barsNear(bars, item), [[70, 98.6, 75, 99.1], [60, 102, 140, 102.4], [50, 109, 150, 109.4]]);
});

test("a bar must run along the text, not just touch it", () => {
  const bars = [];
  vectorArt(list(path(OPS.fill, [148, 102, 160, 102.4])), OPS, undefined, bars);
  assert.deepEqual(barsNear(bars, item), []);
});
