import { test } from "node:test";
import assert from "node:assert/strict";
import { artUnder, barsNear, vectorArt } from "../../extension/viewer/typography/vector-art.mjs";

// The operator ids vector-art.mjs reads; the values only need to be distinct.
const OPS = {
  save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75,
  beginAnnotation: 80, endAnnotation: 81, setFillRGBColor: 59, setStrokeRGBColor: 58, constructPath: 91, clip: 30, eoClip: 31, beginGroup: 76, endGroup: 77,
  stroke: 20, closeStroke: 21, fill: 22, fillStroke: 24, eoFill: 23, endPath: 28, setLineWidth: 2,
};
const list = (...ops) => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) });
const path = (op, box) => [OPS.constructPath, [op, [null], box]];
// A 10 pt line of text at baseline y=100 from x=50 to x=150.
const item = { transform: [10, 0, 0, 10, 50, 100], width: 100, height: 10 };

test("vectorArt reports a scan: invisible text over a page-sized image (R55)", () => {
  const O = { ...OPS, setTextRenderingMode: 38, showText: 44, showSpacedText: 45, paintImageXObject: 85, paintImageXObjectRepeat: 88, paintJpegXObject: 82, paintInlineImageXObject: 86 };
  const view = [0, 0, 612, 792];
  const scan = { hiddenText: 0, visibleText: 0, imageArea: 0 };
  vectorArt(list([O.transform, [612, 0, 0, 792, 0, 0]], [O.paintImageXObject, ["img1"]], [O.setTextRenderingMode, [3]], [O.showText, [[]]], [O.showText, [[]]]), O, view, null, scan);
  assert.deepEqual(scan, { hiddenText: 2, visibleText: 0, imageArea: 1 });
  const born = { hiddenText: 0, visibleText: 0, imageArea: 0 };
  vectorArt(list([O.transform, [200, 0, 0, 150, 50, 500]], [O.paintImageXObject, ["fig"]], [O.showText, [[]]]), O, view, null, born);
  assert.equal(born.visibleText, 1);
  assert.equal(born.hiddenText, 0);
  assert.ok(born.imageArea > 0.05 && born.imageArea < 0.1, "a figure's image is a small part of the page");
  // Mode 3 set inside a figure's q…Q does not outlive the Q: the body text
  // after the figure is visible text (a private paper was taken for a scan).
  const figure = { hiddenText: 0, visibleText: 0, imageArea: 0 };
  vectorArt(list([O.save, []], [O.setTextRenderingMode, [3]], [O.showText, [[]]], [O.restore, []], [O.showText, [[]]], [O.showText, [[]]]), O, view, null, figure);
  assert.deepEqual([figure.hiddenText, figure.visibleText], [1, 2]);
});

test("a stroked circle on a line of text is art under it", () => {
  const art = vectorArt(list(path(OPS.stroke, [120, 97, 131, 108])), OPS);
  assert.equal(art.length, 1);
  assert.ok(artUnder(art, item));
});

test("vectorArt collects the coloured fills a line of text can sit on as shades (R55)", () => {
  const meta = { hiddenText: 0, visibleText: 0, imageArea: 0 };
  vectorArt(list(
    [OPS.setFillRGBColor, ["#e6e6e6"]], path(OPS.fill, [40, 80, 300, 200]), // a grey callout box
    path(OPS.fill, [40, 80, 300, 80.3]), // its top rule: a bar, not a shade
    path(OPS.fill, [40, 90, 45, 110]), // a sliver: too narrow to carry text
    [OPS.setFillRGBColor, ["#ffffff"]], path(OPS.fill, [60, 100, 280, 190]), // a white patch INSIDE the box: a shade of its own, so its text gets white masks
    [OPS.setFillRGBColor, ["#ffffff"]], path(OPS.fill, [400, 500, 500, 600]), // a white patch on paper: nothing
    [OPS.setFillRGBColor, ["#336699"]], path(OPS.fillStroke, [100, 300, 220, 340]), // a filled-and-stroked box
    [OPS.setStrokeRGBColor, ["#000000"]], path(OPS.stroke, [100, 400, 220, 440]), // a frame alone
  ), OPS, [0, 0, 612, 792], null, meta);
  assert.deepEqual(meta.shades, [[40, 80, 300, 200, "#e6e6e6"], [60, 100, 280, 190, "#ffffff"], [100, 300, 220, 340, "#336699"]]);
  // Nothing is collected without `meta`, and a bar chart's hundreds of small
  // fills are cut to the largest 48.
  assert.equal(vectorArt(list([OPS.setFillRGBColor, ["#e6e6e6"]], path(OPS.fill, [40, 80, 300, 200])), OPS).length, 1);
  const many = { hiddenText: 0, visibleText: 0, imageArea: 0 };
  const ops = [[OPS.setFillRGBColor, ["#808080"]]];
  for (let i = 0; i < 60; i++) ops.push(path(OPS.fill, [10 + i * 8, 100, 24 + i * 8, 110 + i]));
  vectorArt(list(...ops), OPS, [0, 0, 612, 792], null, many);
  assert.equal(many.shades.length, 48);
  assert.equal(many.shades[0][3], 169, "the tallest, largest fill comes first");
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

test("a path in paper colour is not art; a white-filled black outline is", () => {
  const box = [120, 97, 131, 108];
  assert.equal(vectorArt(list([OPS.setStrokeRGBColor, ["#ffffff"]], path(OPS.stroke, box)), OPS).length, 0);
  assert.equal(vectorArt(list([OPS.setStrokeRGBColor, ["#ffffff"]], [OPS.setFillRGBColor, ["#ffffff"]], path(OPS.fillStroke, box)), OPS).length, 0);
  assert.equal(vectorArt(list([OPS.setFillRGBColor, ["#ffffff"]], path(OPS.fillStroke, box)), OPS).length, 1);
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
