"""DocLayNet scientific pages (train-sci.parquet from fetch_doclaynet_train.py)
-> the same line rows as docbank_lines.py, with COARSE labels from the
region class holding each cell, for the combined deployment model.

    python doclaynet_lines.py --in data/doclaynet/train-sci.parquet --out data/lines-dln.parquet
"""
import argparse, sys
import pandas as pd
import pyarrow.parquet as pq
from docbank_lines import page_rows
from doclaynet_eval import cells_to_tokens, DOCLAYNET, DL2C

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    t = pq.read_table(a.inp)
    rows = []; pages = 0
    for r in t.to_pylist():
        m = r["metadata"]; W, H = m["coco_width"], m["coco_height"]
        toks = []
        for box, cat, cells in zip(r["bboxes"], r["category_id"], r["pdf_cells"]):
            toks.extend(cells_to_tokens(cells or [], DOCLAYNET[cat], W, H))
        if len(toks) < 5: continue
        recs = page_rows("dln:" + m["original_filename"], m["page_no"], toks)
        for x in recs:
            x["coarse"] = DL2C[x["label"]]; x["split"] = r["split"]
        rows.extend(recs); pages += 1
        if pages % 500 == 0: print(f"  {pages} pages, {len(rows)} lines", file=sys.stderr)
    df = pd.DataFrame(rows)
    df.to_parquet(a.out, index=False)
    print(f"wrote {len(df)} lines from {pages} pages, {df.doc.nunique()} documents; coarse: {df.coarse.value_counts().to_dict()}", file=sys.stderr)

if __name__ == "__main__":
    main()
