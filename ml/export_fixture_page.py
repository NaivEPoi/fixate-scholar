"""A parity fixture for the JS feature mirror (extension/viewer/typography/
line-features.mjs): the tokens of a few DocBank pages and the feature rows
docbank_lines.py computes from them. The JS test rebuilds the lines from the
same tokens and must produce the same numbers.

    python export_fixture_page.py --zip data/DocBank_500K_txt.zip --out ../test/fixtures/line-features.json
"""
import argparse, json, zipfile
import numpy as np
from docbank_lines import parse_txt, page_rows

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True); ap.add_argument("--out", required=True); ap.add_argument("--pages", type=int, default=4)
    a = ap.parse_args()
    z = zipfile.ZipFile(a.zip)
    names = [n for n in z.namelist() if n.endswith(".txt")]
    rng = np.random.default_rng(3)
    picks = list(rng.choice(names, a.pages * 3, replace=False))
    pages = []
    for n in picks:
        toks = parse_txt(z.read(n).decode("utf-8", "replace"))
        if len(toks) < 80: continue
        rows = page_rows("fx", 0, toks)
        feats = [{k: (float(v) if isinstance(v, (int, float, np.integer, np.floating)) and k not in ("label_id", "page", "line_idx", "n_lines") else v) for k, v in r.items() if k not in ("text", "tok_labels", "tok_math", "doc", "label", "label_id", "page")} for r in rows]
        # DocBank tokens carry no licence concern: boxes, fonts and single words of arXiv pages
        pages.append({"name": n.rsplit("/", 1)[-1], "tokens": [[t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8]] for t in toks], "lines": [[r["x0"], r["y0"], r["x1"], r["y1"]] for r in rows], "features": feats})
        if len(pages) >= a.pages: break
    json.dump({"pages": pages}, open(a.out, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"wrote {a.out}: {len(pages)} pages, {sum(len(p['lines']) for p in pages)} lines")

if __name__ == "__main__":
    main()
