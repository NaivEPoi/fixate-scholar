import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loadLineModel, vectorOf, predict, classify, releasesKeep } from "../../extension/viewer/typography/line-model.mjs";
import { textShape } from "../../extension/viewer/typography/line-features.mjs";

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

test("line model: the release lifts a weak keep only for a confident text verdict on a prose-shaped span", () => {
  // a policy with two weak reasons (the engine ships `line-head` alone): the decision is per reason
  const policy = { "table-aligned": { p: 0.95, lower: 4, long: 8 }, "line-head": { p: 0.95, lower: 4, long: 8 } };
  const text = (p) => ({ label: "text", p });
  const line = { num_lead: 0, list_mark: 0 }; // the model's line: no number or marker at its head
  const inside = textShape("resources associated with older papers were slightly less likely to be"); // a line inside a paragraph
  const tail = textShape("tion of this ratio."); // a paragraph's last line
  assert.deepEqual(inside, { n_lower: 11, num_lead: 0, list_mark: 0, ends_sentence: 0 });
  assert.deepEqual(tail, { n_lower: 4, num_lead: 0, list_mark: 0, ends_sentence: 1 });
  // each reason releases at or above its confidence, not below it
  assert.equal(releasesKeep("table-aligned", text(0.95), policy, line, inside), true);
  assert.equal(releasesKeep("line-head", text(0.99), policy, line, tail), true);
  assert.equal(releasesKeep("table-aligned", text(0.949), policy, line, inside), false);
  // only the text class releases, however confident
  assert.equal(releasesKeep("table-aligned", { label: "table", p: 0.99 }, policy, line, inside), false);
  assert.equal(releasesKeep("line-head", { label: "heading", p: 0.99 }, policy, line, inside), false);
  // a reason the policy does not name — a block or rendering reason — never releases
  for (const why of ["blk-table", "caption", "special-or-short", "vector-art", "rotated", "mojibake", "ocr-layer", "refs-region", "region-table", undefined, ""]) {
    assert.equal(releasesKeep(why, text(1), policy, line, inside), false, why);
  }
  // no verdict (an item the line builder did not place), no policy, no line record, no span shape: no release
  assert.equal(releasesKeep("table-aligned", undefined, policy, line, inside), false);
  assert.equal(releasesKeep("table-aligned", { label: "text" }, policy, line, inside), false);
  assert.equal(releasesKeep("table-aligned", text(1), null, line, inside), false);
  assert.equal(releasesKeep("table-aligned", text(1), {}, line, inside), false);
  assert.equal(releasesKeep("table-aligned", text(1), policy, null, inside), false);
  assert.equal(releasesKeep("table-aligned", text(1), policy, line, null), false);
  // the span's shape, each read on the extra corpus: an affiliation or a box title
  // (few lowercase words), a table stub (some, but no sentence's end), a numbered
  // reference entry or heading (a number at the head of its line or of itself), a
  // list item — none released; a paragraph's last line and a line inside one are
  for (const s of ["Human Genetics, Jena University Hospital, Friedrich Schiller", "Example Prompt for ALFWorld Agents (with RAG)", "Thomas Liehr",
                   "Round trip commute time in hours", "All data and code are", "1(Lives with children under 14)"]) {
    assert.equal(releasesKeep("line-head", text(0.99), policy, line, textShape(s)), false, s);
  }
  assert.equal(releasesKeep("line-head", text(0.99), policy, { num_lead: 1, list_mark: 1 }, textShape("H. Torii for the PHENIX Collaboration, these proceedings.")), false);
  assert.equal(releasesKeep("line-head", text(0.99), policy, line, textShape("14. I. Vitev and M. Gyulassy, these proceedings, hep-ph/0208108")), false);
  assert.equal(releasesKeep("line-head", text(0.99), policy, line, textShape("2) Slightly Harder Way: Using a scanner as above, save")), false);
  assert.equal(releasesKeep("line-head", text(0.99), policy, line, textShape("2.1 Diffusion models for image restoration")), false);
  for (const s of ["that is not shown.", "transport-based pseudo label generation.", "OT-based pseudo-labeling boosts prediction performance.",
                   ". Therefore, we conclude that the sets in the r.h.s. of", "tested, with 78% and 98% of resources, respectively, successfully retrieved"]) {
    assert.equal(releasesKeep("table-aligned", text(0.99), policy, line, textShape(s)), true, s);
  }
  // a sentence's end counts through a closing quote or bracket
  assert.equal(textShape("reproducibility of research\u201d [3].").ends_sentence, 1);
  assert.equal(textShape("(see the appendix.)").ends_sentence, 1);
  // the policy's own thresholds are what decide, per reason
  assert.equal(releasesKeep("line-head", text(0.8), { "line-head": { p: 0.8, lower: 1, long: 1 } }, line, textShape("Danielle Li and")), true);
  assert.equal(releasesKeep("table-aligned", text(0.8), { "line-head": { p: 0.8 } }, line, inside), false);
});
