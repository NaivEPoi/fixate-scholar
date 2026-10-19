import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loadLineModel, vectorOf, predict, classify } from "../../extension/viewer/typography/line-model.mjs";

// A two-class, one-tree-each model whose leaves are known: feature 0 <= 0.5
// sends a line to the left leaf.
const toy = {
  version: 1, features: ["a", "b"], labels: ["text", "heading"], keep: ["heading"],
  trees: [
    [{ f: [0, -1, -1], t: [0.5, 0, 0], l: [1, -1, -1], r: [2, -1, -1], v: [0, 1.0, -1.0] }],
    [{ f: [0, -1, -1], t: [0.5, 0, 0], l: [1, -1, -1], r: [2, -1, -1], v: [0, -1.0, 1.0] }],
  ],
};

test("line model: trees are walked by feature <= threshold and classes softmaxed", () => {
  const m = loadLineModel(toy);
  assert.ok(m);
  const left = classify(m, { a: 0.2, b: 9 });
  assert.equal(left.label, "text"); assert.ok(left.p > 0.8); assert.equal(left.keep, false);
  const right = classify(m, { a: 0.9 });
  assert.equal(right.label, "heading"); assert.ok(right.p > 0.8); assert.equal(right.keep, true);
  // an absent feature is -1: it goes left
  assert.equal(classify(m, {}).label, "text");
  // a boolean is 0/1
  assert.equal(classify(m, { a: true }).label, "heading");
  const p = predict(m, vectorOf(m, { a: 0.9 }));
  assert.ok(Math.abs(p[0] + p[1] - 1) < 1e-9);
  assert.equal(loadLineModel({ version: 2 }), null);
});

test("line model: the exported model reproduces LightGBM's probabilities on the fixture", { skip: !existsSync("extension/vendor/layout/line-model.fixture.json") || !existsSync("extension/vendor/layout/line-model.json") ? "no exported model" : false }, () => {
  const m = loadLineModel(JSON.parse(readFileSync("extension/vendor/layout/line-model.json", "utf8")));
  const fx = JSON.parse(readFileSync("extension/vendor/layout/line-model.fixture.json", "utf8"));
  assert.deepEqual(fx.features, m.features);
  let worst = 0;
  for (let i = 0; i < fx.rows.length; i++) {
    const v = Float32Array.from(fx.rows[i]);
    const p = predict(m, v);
    for (let c = 0; c < p.length; c++) worst = Math.max(worst, Math.abs(p[c] - fx.probs[i][c]));
  }
  assert.ok(worst < 1e-3, `largest probability difference ${worst}`);
});
