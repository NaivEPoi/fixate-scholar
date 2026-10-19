// A gradient-boosted line classifier, exported from LightGBM by
// ml/export_js.py: per class a list of trees, each tree flat arrays of
// split feature, threshold, left and right child, and leaf value. The
// prediction for a feature vector is, per class, the sum of the leaves the
// vector falls into, then a softmax. A split compares feature <= threshold
// (LightGBM's default decision type); an absent feature is fed as -1, which
// is what the training data held for a missing neighbour, so no NaN path
// is needed. Pure arithmetic, no dependencies: it runs in the engine's
// thread in microseconds a line, or anywhere.

/** Load a model object (the parsed JSON). Returns null for a shape that is
 *  not the exporter's. */
export function loadLineModel(json) {
  if (!json || json.version !== 1 || !Array.isArray(json.trees) || !Array.isArray(json.features) || !Array.isArray(json.labels)) return null;
  if (json.trees.length !== json.labels.length) return null;
  const index = new Map(json.features.map((f, i) => [f, i]));
  return { features: json.features, labels: json.labels, keep: new Set(json.keep ?? []), trees: json.trees, index };
}

/** The feature vector of a line from a feature object; names the model does
 *  not know are ignored, names the object lacks are -1 (absent). */
export function vectorOf(model, obj) {
  const v = new Float32Array(model.features.length);
  for (let i = 0; i < model.features.length; i++) {
    const x = obj[model.features[i]];
    v[i] = typeof x === "number" && Number.isFinite(x) ? x : typeof x === "boolean" ? (x ? 1 : 0) : -1;
  }
  return v;
}

function treeValue(tree, v) {
  let n = 0;
  const { f, t, l, r, val } = tree;
  while (f[n] >= 0) n = v[f[n]] <= t[n] ? l[n] : r[n];
  return val[n];
}

/** Class probabilities for a feature vector, in the model's label order. */
export function predict(model, v) {
  const n = model.labels.length;
  const s = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    let acc = 0;
    for (const tree of model.trees[c]) acc += treeValue(tree.val ? tree : (tree.val = tree.v, tree), v);
    s[c] = acc;
  }
  let m = -Infinity;
  for (let c = 0; c < n; c++) if (s[c] > m) m = s[c];
  let z = 0;
  const p = new Float64Array(n);
  for (let c = 0; c < n; c++) { p[c] = Math.exp(s[c] - m); z += p[c]; }
  for (let c = 0; c < n; c++) p[c] /= z;
  return p;
}

/** The best label, its probability, and whether it is a class the engine keeps. */
export function classify(model, obj) {
  const p = predict(model, vectorOf(model, obj));
  let best = 0;
  for (let c = 1; c < p.length; c++) if (p[c] > p[best]) best = c;
  const label = model.labels[best];
  return { label, p: p[best], keep: model.keep.has(label), probs: p };
}
