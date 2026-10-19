"""Score the RULES, the line CLASSIFIER and the stock DETECTOR on the same
text-layer spans of DocLayNet's scientific test pages.

    python compare.py --pages models/lines-v1/doclaynet.md.pages.jsonl --reasons data/doclaynet/reasons.jsonl --out models/lines-v1/compare.md

Truth per span: the DocLayNet box holding the span's centre (coarse class).
Rules: the span's reason mapped to the coarse class (processed = text).
Classifier: the predicted line holding the span's centre. Detector: the
best-scoring region holding it. All in the page's 1025 px frame.
"""
import argparse, json, sys
import numpy as np
from sklearn.metrics import classification_report, f1_score

COARSE = ["text", "heading", "caption", "formula", "table", "figure", "furniture"]
KEEP = {"heading", "caption", "formula", "table", "figure", "furniture"}
# The engine's reasons → coarse classes. Processed spans (no reason) are text.
WHY2C = {
    "line-head": "heading", "blk-heading": "heading", "head-wrap": "heading", "runin": "heading", "runin-ital": "heading", "runin-short": "heading",
    "blk-offsize": "heading", "front-matter": "heading", "region-heading": "heading",
    "caption": "caption", "caption-absorb": "caption", "blk-caption": "caption", "blk-capprev": "caption", "region-caption": "caption",
    "blk-footnote": "furniture", "furniture": "furniture", "margin-band": "furniture", "margin-num": "furniture", "region-footer": "furniture", "region-header": "furniture", "region-footnote": "furniture", "region-aside": "furniture",
    "line-formula": "formula", "blk-eqn": "formula", "row-eqn": "formula", "special-or-short": "formula", "script-size": "formula", "script-attach": "formula", "line-algo": "formula", "region-formula": "formula", "region-algorithm": "formula",
    "line-cells": "table", "table-starts": "table", "table-aligned": "table", "table-region": "table", "table-rules": "table", "blk-table": "table", "region-table": "table",
    "fig-body": "figure", "figure-text": "figure", "blk-figlabel": "figure", "region-figure": "figure", "vector-art": "figure", "rotated": "figure", "over-body": "figure",
    "refs-region": "text", "ocr-layer": "text", "mojibake": "text", "dup-hidden": "text", "overlaps-skipped": "text", "split-word": "text", "smallcaps-tail": "text", "smallcaps-head": "text", "leadrun": "text",
    # the line classifier's own reasons, when the dump ran with the option on (engine `model-<class>`)
    "model-heading": "heading", "model-caption": "caption", "model-formula": "formula", "model-table": "table", "model-figure": "figure", "model-furniture": "furniture",
    "line-cells-wide": "table", "blk-ccs": "table", "url-or-math": "text", "link-annot": "text",
}

def inside(cx, cy, b):
    return b[0] <= cx <= b[2] and b[1] <= cy <= b[3]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", required=True); ap.add_argument("--reasons", required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    pages = {}
    for l in open(a.pages, encoding="utf-8"):
        p = json.loads(l); pages[p["hash"]] = p
    T, R, C, D, Wt, RK = [], [], [], [], [], []
    unmapped = {}
    unmatched = [0, 0]  # spans (and their characters) no classifier line holds or neighbours
    n_pages = 0; n_err = 0
    for l in open(a.reasons, encoding="utf-8"):
        rec = json.loads(l)
        h = rec["pdf"][:-4]
        p = pages.get(h)
        if not p or rec.get("error") or not rec.get("spans"):
            n_err += 1; continue
        sx = p["W"] / rec["pageW"]; sy = p["H"] / rec["pageH"]  # viewer px → 1025 frame
        n_pages += 1
        for s in rec["spans"]:
            cx = (s["x"] + s["w"] / 2) * sx; cy = (s["y"] + s["h"] / 2) * sy
            box = next((b for b in p["boxes"] if b[1] <= cx <= b[1] + b[3] and b[2] <= cy <= b[2] + b[4]), None)
            if not box: continue  # a span no annotator boxed
            T.append(box[0])
            # Weight by characters: the rules' side holds every one-glyph
            # fragment as a span (16k "special-or-short" on 314 pages), which
            # would count each as much as a sentence.
            Wt.append(max(len(s["t"]), 1))
            # The rules' keep decision is what the engine DID (the span was not
            # processed), not a class map; the class is the reason's.
            RK.append(not s["done"])
            if s["why"]:
                c = WHY2C.get(s["why"])
                if c is None: unmapped[s["why"]] = unmapped.get(s["why"], 0) + 1; c = "text"
                R.append(c)
            else:
                R.append("text")
            # classifier line holding the centre (line boxes are 0..1 of the page);
            # a centre no line holds — a scattered figure label, a glyph between
            # lines — takes the nearest line within one line height, else text
            lx, ly = cx / p["W"], cy / p["H"]
            line = next((q for q in p["lines"] if q["b"][0] - 0.005 <= lx <= q["b"][2] + 0.005 and q["b"][1] - 0.002 <= ly <= q["b"][3] + 0.002), None)
            if line is None:
                best = None; bd = 1e9
                for q in p["lines"]:
                    if lx < q["b"][0] - 0.02 or lx > q["b"][2] + 0.02: continue
                    h = max(q["b"][3] - q["b"][1], 1e-3)
                    d = abs((q["b"][1] + q["b"][3]) / 2 - ly) / h
                    if d < bd: bd = d; best = q
                if best is not None and bd <= 1.0: line = best
                else: unmatched[0] += 1; unmatched[1] += max(len(s["t"]), 1)
            C.append(line["c"] if line else "text")
            reg = next((r for r in p["regions"] if inside(cx, cy, r[2:6])), None)
            D.append(reg[0] if reg else "text")
    T, R, C, D = map(np.array, (T, R, C, D)); Wt = np.array(Wt, dtype=float); RK = np.array(RK)
    keep_t = np.isin(T, list(KEEP))
    md = [f"# Rules vs classifier vs detector — {n_pages} DocLayNet scientific test pages ({n_err} pages without a dump), {len(T)} spans, {int(Wt.sum())} characters", "",
          "Every number is weighted by the span's characters (a one-glyph fragment counts as one character, a sentence as its length). The rules' keep decision is what the engine did to the span; the class is its reason's.", ""]
    if unmapped: md += [f"Reasons not in the map (scored as text): {unmapped}", ""]
    md += [f"Spans no classifier line holds or neighbours (scored as text): {unmatched[0]} spans, {unmatched[1]} characters.", ""]
    md += ["| system | accuracy | keep/process F1 | macro F1 |", "|---|---|---|---|"]
    rows = []
    for name, P, keep_p in (("rules (engine reasons)", R, RK), ("line classifier", C, np.isin(C, list(KEEP))), ("stock PP-DocLayout-S", D, np.isin(D, list(KEEP)))):
        acc = np.average(P == T, weights=Wt); kf = f1_score(keep_t, keep_p, sample_weight=Wt); mf = f1_score(T, P, average="macro", sample_weight=Wt)
        md.append(f"| {name} | {acc:.4f} | {kf:.4f} | {mf:.4f} |")
        rows.append((name, classification_report(T, P, labels=COARSE, digits=3, zero_division=0, sample_weight=Wt)))
    md.append("")
    for name, rep in rows: md += [f"## {name}", "```", rep, "```", ""]
    open(a.out, "w", encoding="utf-8").write("\n".join(md))
    print("\n".join(md[:8]))

if __name__ == "__main__":
    main()
