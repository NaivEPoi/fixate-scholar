"""Export a LightGBM multiclass model to a compact JSON the extension can run:
trees as flat arrays (feature index, threshold, left, right, leaf value),
one list per class, plus the feature names in order.

    python export_js.py --model models/lines-v1 --out ../extension/vendor/layout/line-model.json

The JS predictor (extension/viewer/typography/line-model.mjs) sums each
tree's leaf per class and applies softmax; a fixture test checks it against
LightGBM's own predictions on sampled rows (fixture.json written here).
"""
import argparse, json, os
import numpy as np
import pandas as pd
import lightgbm as lgb

def flatten(tree):
    """Depth-first flatten into parallel arrays."""
    F, T, L, R, V = [], [], [], [], []
    def walk(n):
        i = len(F)
        if "leaf_value" in n:
            F.append(-1); T.append(0.0); L.append(-1); R.append(-1); V.append(float(n["leaf_value"]))
            return i
        F.append(int(n["split_feature"])); T.append(float(n["threshold"])); L.append(-1); R.append(-1); V.append(0.0)
        # LightGBM: default_left decides the missing path; we feed -1 for "absent", never NaN
        l = walk(n["left_child"]); r = walk(n["right_child"])
        L[i] = l; R[i] = r
        return i
    walk(tree["tree_structure"])
    return {"f": F, "t": T, "l": L, "r": R, "v": V}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True); ap.add_argument("--out", required=True); ap.add_argument("--data", default="data/lines-8k.parquet")
    a = ap.parse_args()
    meta = json.load(open(os.path.join(a.model, "features.json")))
    booster = lgb.Booster(model_file=os.path.join(a.model, "model.txt"))
    dump = booster.dump_model()
    n_class = len(meta["labels"])
    trees = [[] for _ in range(n_class)]
    for ti, tree in enumerate(dump["tree_info"]):
        trees[ti % n_class].append(flatten(tree))
    out = {"version": 1, "features": meta["features"], "labels": meta["labels"], "keep": meta["keep"], "trees": trees,
           "decision_type": "<=", "note": "value = sum of leaf values per class; p = softmax(values)"}
    json.dump(out, open(a.out, "w"), separators=(",", ":"))
    size = os.path.getsize(a.out)
    print(f"wrote {a.out}: {sum(len(t) for t in trees)} trees, {size / 1e6:.2f} MB")
    # fixture: 200 random rows with LightGBM's probabilities, for the JS test
    df = pd.read_parquet(a.data, columns=meta["features"]).sample(200, random_state=11)
    X = df.astype(np.float32).values
    P = booster.predict(X)
    fx = {"features": meta["features"], "rows": [[float(v) for v in r] for r in X], "probs": [[round(float(p), 6) for p in row] for row in P]}
    fixture = a.out[:-5] + ".fixture.json" if a.out.endswith(".json") else a.out + ".fixture.json"
    json.dump(fx, open(fixture, "w"))
    print("fixture:", fixture)

if __name__ == "__main__":
    main()
