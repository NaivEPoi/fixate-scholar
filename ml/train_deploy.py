"""The deployment model: the seven coarse classes the engine acts on, small
trees, early stopping — a few hundred trees that fit the extension.

    python train_deploy.py --data data/lines-8k-blk.parquet --out models/deploy-v1

Same artefacts as train.py (model.txt, features.json with the coarse labels,
report.md), so export_js.py and doclaynet_eval.py run on it unchanged
(doclaynet_eval maps a DocBank label through DB2C; a coarse label maps to
itself, which the identity entries below provide).
"""
import argparse, json, os, sys, time
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import GroupShuffleSplit

COARSE = ["text", "heading", "caption", "formula", "table", "figure", "furniture"]
DB2C = {"paragraph": "text", "list": "text", "abstract": "text", "reference": "text", "author": "text", "date": "text",
        "section": "heading", "title": "heading", "caption": "caption", "equation": "formula", "table": "table", "figure": "figure", "footer": "furniture"}
KEEP = ["heading", "caption", "formula", "table", "figure", "furniture"]
NON_FEATURES = {"text", "label", "label_id", "tok_labels", "tok_math", "doc", "page"}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--extra", default=None, help="a second line parquet with a 'coarse' column (DocLayNet scientific pages), held out by document like the first")
    ap.add_argument("--extra-weight", type=float, default=3.0, help="sample weight of the extra rows (they are fewer and carry the classes DocBank lacks)")
    ap.add_argument("--rounds", type=int, default=600); ap.add_argument("--leaves", type=int, default=31); ap.add_argument("--lr", type=float, default=0.08)
    ap.add_argument("--threads", type=int, default=8); ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    df = pd.read_parquet(a.data)
    df["coarse"] = df.label.map(DB2C)
    df["w"] = 1.0
    if a.extra:
        ex = pd.read_parquet(a.extra)
        ex["w"] = a.extra_weight
        print(f"extra rows {len(ex)} from {ex.doc.nunique()} documents, coarse {ex.coarse.value_counts().to_dict()}", file=sys.stderr)
        df = pd.concat([df, ex], ignore_index=True, sort=False)
    feats = [c for c in df.columns if c not in NON_FEATURES and c not in ("coarse", "w", "split")]
    df[feats] = df[feats].fillna(-1.0)
    X = df[feats].astype(np.float32).values
    y = df.coarse.map({c: i for i, c in enumerate(COARSE)}).values
    g = df.doc.values
    w = df.w.values
    tr, rest = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=a.seed).split(X, y, g))
    va_i, te_i = next(GroupShuffleSplit(n_splits=1, test_size=0.5, random_state=a.seed).split(X[rest], y[rest], g[rest]))
    va, te = rest[va_i], rest[te_i]
    params = dict(objective="multiclass", num_class=len(COARSE), learning_rate=a.lr, num_leaves=a.leaves, min_data_in_leaf=80,
                  feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=2.0, max_bin=63, num_threads=a.threads, verbose=-1, seed=a.seed)
    t0 = time.time()
    m = lgb.train(params, lgb.Dataset(X[tr], y[tr], weight=w[tr]), num_boost_round=a.rounds, valid_sets=[lgb.Dataset(X[va], y[va], weight=w[va])],
                  callbacks=[lgb.early_stopping(40, verbose=False), lgb.log_evaluation(100)])
    print(f"trained {m.best_iteration} rounds in {time.time() - t0:.0f} s", file=sys.stderr)
    m.save_model(os.path.join(a.out, "model.txt"), num_iteration=m.best_iteration)
    json.dump({"features": feats, "labels": COARSE, "keep": KEEP, "best_iteration": m.best_iteration}, open(os.path.join(a.out, "features.json"), "w"), indent=1)
    p = m.predict(X[te], num_iteration=m.best_iteration).argmax(1)
    kf = f1_score(np.isin(y[te], [COARSE.index(k) for k in KEEP]), np.isin(p, [COARSE.index(k) for k in KEEP]))
    rep = classification_report(y[te], p, labels=list(range(len(COARSE))), target_names=COARSE, digits=3, zero_division=0)
    md = [f"# Deployment line classifier — {a.out}", f"train {len(tr)} / val {len(va)} / test {len(te)} lines (held out by document); {len(feats)} features; {m.best_iteration} rounds × {len(COARSE)} classes",
          f"Test accuracy {(p == y[te]).mean():.4f}; keep-vs-process F1 {kf:.4f}", "```", rep, "```"]
    open(os.path.join(a.out, "report.md"), "w", encoding="utf-8").write("\n".join(md))
    print("\n".join(md), file=sys.stderr)

if __name__ == "__main__":
    main()
