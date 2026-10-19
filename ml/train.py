"""Train the line classifier on lines.parquet (docbank_lines.py), held out by document.

    python train.py --data data/lines.parquet --out models/lines-v1

Writes models/lines-v1/model.txt (LightGBM), features.json, report.md.
"""
import argparse, json, os, sys, time
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import classification_report, f1_score, confusion_matrix
from sklearn.model_selection import GroupShuffleSplit

from docbank_lines import LABELS

# The engine's decision: which classes are KEPT on the canvas (not emphasised)
KEEP = {"caption", "equation", "figure", "footer", "section", "table", "title", "author", "date"}
NON_FEATURES = {"text", "label", "label_id", "tok_labels", "tok_math", "doc", "page"}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--rounds", type=int, default=2000); ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--leaves", type=int, default=63); ap.add_argument("--lr", type=float, default=0.05)
    ap.add_argument("--threads", type=int, default=6)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    df = pd.read_parquet(a.data)
    feats = [c for c in df.columns if c not in NON_FEATURES]
    X = df[feats].astype(np.float32).values
    y = df["label_id"].values
    groups = df["doc"].values
    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=a.seed)
    tr, rest = next(gss.split(X, y, groups))
    gss2 = GroupShuffleSplit(n_splits=1, test_size=0.5, random_state=a.seed)
    va_i, te_i = next(gss2.split(X[rest], y[rest], groups[rest]))
    va, te = rest[va_i], rest[te_i]
    print(f"lines: train {len(tr)}, val {len(va)}, test {len(te)}; docs: {len(set(groups[tr]))}/{len(set(groups[va]))}/{len(set(groups[te]))}; features {len(feats)}", file=sys.stderr)
    params = dict(objective="multiclass", num_class=len(LABELS), learning_rate=a.lr, num_leaves=a.leaves,
                  min_data_in_leaf=40, feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1,
                  lambda_l2=1.0, num_threads=a.threads, verbose=-1, seed=a.seed)
    dtr = lgb.Dataset(X[tr], y[tr]); dva = lgb.Dataset(X[va], y[va], reference=dtr)
    t0 = time.time()
    model = lgb.train(params, dtr, num_boost_round=a.rounds, valid_sets=[dva],
                      callbacks=[lgb.early_stopping(60, verbose=False), lgb.log_evaluation(100)])
    print(f"trained {model.best_iteration} rounds in {time.time() - t0:.0f} s", file=sys.stderr)
    model.save_model(os.path.join(a.out, "model.txt"), num_iteration=model.best_iteration)
    json.dump({"features": feats, "labels": LABELS, "keep": sorted(KEEP), "best_iteration": model.best_iteration}, open(os.path.join(a.out, "features.json"), "w"), indent=1)
    pred = model.predict(X[te], num_iteration=model.best_iteration).argmax(1)
    rep = classification_report(y[te], pred, labels=list(range(len(LABELS))), target_names=LABELS, digits=3, zero_division=0)
    keep_t = np.array([LABELS[i] in KEEP for i in y[te]]); keep_p = np.array([LABELS[i] in KEEP for i in pred])
    keep_f1 = f1_score(keep_t, keep_p)
    acc = (pred == y[te]).mean()
    cm = confusion_matrix(y[te], pred, labels=list(range(len(LABELS))))
    imp = sorted(zip(feats, model.feature_importance("gain")), key=lambda x: -x[1])[:30]
    md = [f"# Line classifier — {a.out}", "", f"Lines: train {len(tr)}, val {len(va)}, test {len(te)} (split by document; test documents {len(set(groups[te]))}).",
          f"Features: {len(feats)}. Rounds: {model.best_iteration}.", "",
          f"Test accuracy {acc:.4f}; keep-vs-process F1 {keep_f1:.4f}.", "", "```", rep, "```", "",
          "Confusion (rows true, cols predicted):", "```", " ".join(f"{l[:5]:>6}" for l in LABELS)]
    for i, row in enumerate(cm):
        md.append(f"{LABELS[i][:5]:>6} " + " ".join(f"{v:6d}" for v in row))
    md += ["```", "", "Top features by gain:", "```"] + [f"{f:28s} {g:12.0f}" for f, g in imp] + ["```"]
    open(os.path.join(a.out, "report.md"), "w", encoding="utf-8").write("\n".join(md))
    print("\n".join(md[:12]), file=sys.stderr)

if __name__ == "__main__":
    main()
