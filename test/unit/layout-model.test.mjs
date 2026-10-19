import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEP_CLASSES, LAYOUT_CLASSES, MODEL_INPUT, decodeOutput, prepareInput } from "../../extension/viewer/typography/layout-model.mjs";

test("the class list is the model's own, 23 long, and every kept class names an engine reason", () => {
  assert.equal(LAYOUT_CLASSES.length, 23);
  assert.equal(LAYOUT_CLASSES[2], "text");
  assert.equal(LAYOUT_CLASSES[6], "figure_title");
  assert.equal(LAYOUT_CLASSES[12], "footnote");
  for (const k of Object.keys(KEEP_CLASSES)) assert.ok(LAYOUT_CLASSES.includes(k), k);
  assert.ok(!("text" in KEEP_CLASSES) && !("abstract" in KEEP_CLASSES) && !("reference" in KEEP_CLASSES), "prose classes keep nothing");
});

test("prepareInput normalises per channel in CHW and gives the model the source's scale", () => {
  const size = 2;
  // Two pixels white, two black, RGBA.
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const { image, scale, dims } = prepareInput(rgba, 1200, 1600, size);
  assert.deepEqual(dims, { image: [1, 3, 2, 2], scale: [1, 2] });
  assert.equal(image.length, 12);
  // Red channel first: white -> (1 - 0.485) / 0.229, black -> (0 - 0.485) / 0.229.
  assert.ok(Math.abs(image[0] - (1 - 0.485) / 0.229) < 1e-5);
  assert.ok(Math.abs(image[2] - (0 - 0.485) / 0.229) < 1e-5);
  // Blue channel last: white -> (1 - 0.406) / 0.225.
  assert.ok(Math.abs(image[8] - (1 - 0.406) / 0.225) < 1e-5);
  assert.ok(Math.abs(scale[0] - size / 1600) < 1e-7 && Math.abs(scale[1] - size / 1200) < 1e-7, "[height scale, width scale], in float32");
  assert.equal(MODEL_INPUT, 480);
});

test("decodeOutput finds the [N,6] boxes by shape, keeps the engine's classes above the score, in page px", () => {
  const rows = [
    [8, 0.91, 100, 200, 500, 400], // table
    [2, 0.99, 100, 50, 500, 190], // text: not a kept class
    [6, 0.45, 100, 410, 500, 430], // figure_title below the score
    [12, 0.7, 100, 900, 500, 960], // footnote
    [1, 0.8, 300, 300, 300, 300], // degenerate
    [99, 0.9, 0, 0, 10, 10], // no such class
  ];
  const data = new Float32Array(rows.flat());
  const outputs = {
    "multiclass_nms3_0.tmp_0": { dims: [rows.length, 6], data },
    "multiclass_nms3_0.tmp_2": { dims: [1], data: new Int32Array([rows.length]) },
  };
  const regions = decodeOutput(outputs, { kx: 2, ky: 2 });
  assert.deepEqual(regions.map((r) => [r.cls, r.kind, r.x0, r.y0, r.x1, r.y1]), [
    ["table", "table", 50, 100, 250, 200],
    ["footnote", "footnote", 50, 450, 250, 480],
  ]);
  assert.ok(regions[0].score > regions[1].score, "sorted by score");
  // The count output trims the rows the model did not fill.
  const trimmed = decodeOutput({ a: { dims: [rows.length, 6], data }, b: { dims: [1], data: new Int32Array([1]) } });
  assert.equal(trimmed.length, 1);
  assert.deepEqual(decodeOutput({ only: { dims: [1, 3, 4, 4], data: new Float32Array(48) } }), [], "no box tensor: nothing");
});
