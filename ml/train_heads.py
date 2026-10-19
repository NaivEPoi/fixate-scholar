"""Fine-grained heads on top of the line classifier, from the same lines.parquet.

1. heading level — on lines labelled section/title (and abstract heads):
     title | section-1 | section-2+ | run-in   from numbering depth, size
   rank on the page, position, boldness, whether prose follows on the line.
   Labels come from the line text itself (DocBank has no level), so this is
   a structural head: it learns the paper's conventions from geometry.
2. math tokens — per token inside a line: is this token part of a formula?
   DocBank's token labels say "equation" for inline math tokens inside a
   paragraph line; the head predicts it from the token's font flags, its
   characters and its neighbours, for the engine's symbol-keep decision.

    python train_heads.py --data data/lines-8k.parquet --out models/heads-v1
"""
import argparse, json, os, re, sys
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import classification_report
from sklearn.model_selection import GroupShuffleSplit
from docbank_lines import font_flags, MATHSYM

def heading_level(text, h_rel, bold, n_lower, fills):
    t = text.strip()
    if re.match(r"^\d+\.\d+(\.\d+)*\.?\s", t): return "section-2"
    if re.match(r"^(?:\d+\.?|[IVX]{1,5}\.?|[A-Z]\.)\s+\S", t): return "section-1"
    if fills and n_lower >= 4: return "run-in"
    if h_rel >= 1.6: return "title"
    return "section-1" if bold or h_rel >= 1.15 else "run-in"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True); ap.add_argument("--out", required=True); ap.add_argument("--threads", type=int, default=6)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    df = pd.read_parquet(a.data)
    report = []
    # ---- 1. heading level
    hd = df[df.label.isin(["section", "title"])].copy()
    hd["level"] = [heading_level(t, h, b, nl, f) for t, h, b, nl, f in zip(hd.text, hd.h_rel, hd.f_bold, hd.n_lower, hd.fills_measure)]
    hd["page_rank"] = hd.groupby(["doc", "page"])["h_rel"].rank(ascending=False, method="min")
    feats = ["h_rel", "page_rank", "pos", "line_idx", "x0", "x1", "width", "centred", "fills_measure", "f_bold", "f_italic", "f_sans", "f_smallcaps", "n_words", "n_lower", "title_case", "ends_period", "ends_colon", "num_lead", "p1_gap", "n1_gap", "n1_h_rel", "p1_h_rel", "left_gap", "col"]
    levels = ["title", "section-1", "section-2", "run-in"]
    y = hd.level.map({l: i for i, l in enumerate(levels)}).values
    X = hd[feats].astype(np.float32).values
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=7).split(X, y, hd.doc.values))
    # the text-pattern features (num_lead etc.) are what define the labels; hold them out of
    # the model so it learns the GEOMETRY of each level (what the engine needs on an unnumbered heading)
    geo = [f for f in feats if f not in ("num_lead",)]
    Xg = hd[geo].astype(np.float32).values
    m = lgb.train(dict(objective="multiclass", num_class=4, learning_rate=0.05, num_leaves=31, min_data_in_leaf=20, verbose=-1, num_threads=a.threads, seed=7),
                  lgb.Dataset(Xg[tr], y[tr]), num_boost_round=400)
    p = m.predict(Xg[te]).argmax(1)
    rep = classification_report(y[te], p, target_names=levels, digits=3, zero_division=0)
    m.save_model(os.path.join(a.out, "heading-level.txt"))
    json.dump({"features": geo, "labels": levels}, open(os.path.join(a.out, "heading-level.json"), "w"))
    report += ["## Heading level (geometry only; labels from numbering/size)", f"{len(tr)} train / {len(te)} test heading lines", "```", rep, "```", ""]
    # ---- 2. math tokens: tokens of paragraph/list/caption lines; truth = token label "equ"
    rows = []
    sub = df[df.label.isin(["paragraph", "list", "caption", "abstract"]) & df.tok_labels.str.contains("equ")]
    sub = pd.concat([sub, df[df.label.isin(["paragraph", "list"]) & ~df.tok_labels.str.contains("equ")].sample(min(60000, len(df)), random_state=7)])
    for doc, text, labs, maths in zip(sub.doc, sub.text, sub.tok_labels, sub.tok_math):
        toks = text.split(" "); labs = labs.split(" "); maths = maths.split(" ")
        if len(toks) != len(labs) or len(toks) != len(maths): continue
        for i, (t, l, mf) in enumerate(zip(toks, labs, maths)):
            prev_t = toks[i - 1] if i else ""; next_t = toks[i + 1] if i + 1 < len(toks) else ""
            rows.append(dict(doc=doc, y=int(l == "equ"), mathfont=int(mf), len=len(t), digit=sum(c.isdigit() for c in t) / max(len(t), 1),
                             sym=len(MATHSYM.findall(t)) / max(len(t), 1), alpha=sum(c.isalpha() for c in t) / max(len(t), 1),
                             single=int(len(t) == 1), upper=int(t[:1].isupper()), greek=int(bool(re.search(r"[α-ωΑ-Ω]", t))),
                             prev_sym=len(MATHSYM.findall(prev_t)) / max(len(prev_t), 1), next_sym=len(MATHSYM.findall(next_t)) / max(len(next_t), 1),
                             prev_single=int(len(prev_t) == 1), next_single=int(len(next_t) == 1), paren=int(bool(re.search(r"[()\[\]]", t))),
                             has_eq=int("=" in t), word=int(bool(re.match(r"^[A-Za-z]{3,}$", t))), pos=i / max(len(toks) - 1, 1)))
    td = pd.DataFrame(rows)
    tf = [c for c in td.columns if c not in ("doc", "y")]
    Xt = td[tf].astype(np.float32).values; yt = td.y.values
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=7).split(Xt, yt, td.doc.values))
    mt = lgb.train(dict(objective="binary", learning_rate=0.05, num_leaves=31, min_data_in_leaf=50, verbose=-1, num_threads=a.threads, seed=7), lgb.Dataset(Xt[tr], yt[tr]), num_boost_round=400)
    pt = (mt.predict(Xt[te]) > 0.5).astype(int)
    rep2 = classification_report(yt[te], pt, target_names=["word", "math token"], digits=3, zero_division=0)
    # the font-only baseline the engine uses today: a token is math when its face is a math face
    base = td.mathfont.values[te]
    rep3 = classification_report(yt[te], base, target_names=["word", "math token"], digits=3, zero_division=0)
    mt.save_model(os.path.join(a.out, "math-token.txt"))
    json.dump({"features": tf}, open(os.path.join(a.out, "math-token.json"), "w"))
    report += ["## Math tokens inside text lines", f"{len(tr)} train / {len(te)} test tokens ({yt.mean():.3f} math)", "model:", "```", rep2, "```", "font-face-only baseline (the engine's current rule):", "```", rep3, "```"]
    open(os.path.join(a.out, "report.md"), "w", encoding="utf-8").write("\n".join(report))
    print("\n".join(report))

if __name__ == "__main__":
    main()
