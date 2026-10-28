"""Score the line classifier — and, given `--onnx`, a stock detector — on
DocLayNet's scientific test pages, on one coarse class set and on the engine's
keep/process decision.

    python doclaynet_eval.py --model models/lines-v1 --out models/lines-v1/doclaynet.md [--onnx pp-doclayout-s.onnx]

Lines are built from the page's PDF cells split into words (so the features
match DocBank's token distribution); each line's truth is the DocLayNet class
of the box that holds it. The detector, when given, runs on the page image
(1025 px); a line takes the class of the best-scoring region holding its
centre. The extension no longer ships a detector (R61); the option remains
so a candidate can be measured against the classifier the same way.
"""
import argparse, io, json, os, re, sys
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from PIL import Image
from sklearn.metrics import classification_report, f1_score

from docbank_lines import page_rows, LABELS

DOCLAYNET = {1: "Caption", 2: "Footnote", 3: "Formula", 4: "List-item", 5: "Page-footer", 6: "Page-header", 7: "Picture", 8: "Section-header", 9: "Table", 10: "Text", 11: "Title"}
COARSE = ["text", "heading", "caption", "formula", "table", "figure", "furniture"]
DL2C = {"Text": "text", "List-item": "text", "Section-header": "heading", "Title": "heading", "Caption": "caption", "Formula": "formula", "Table": "table", "Picture": "figure", "Footnote": "furniture", "Page-footer": "furniture", "Page-header": "furniture"}
DB2C = {"paragraph": "text", "list": "text", "abstract": "text", "reference": "text", "author": "text", "date": "text", "section": "heading", "title": "heading", "caption": "caption", "equation": "formula", "table": "table", "figure": "figure", "footer": "furniture"}
PP_CLASSES = ["paragraph_title", "image", "text", "number", "abstract", "content", "figure_title", "formula", "table", "table_title", "reference", "doc_title", "footnote", "header", "algorithm", "footer", "seal", "chart_title", "chart", "formula_number", "header_image", "footer_image", "aside_text"]
PP2C = {"paragraph_title": "heading", "doc_title": "heading", "text": "text", "abstract": "text", "content": "text", "reference": "text", "aside_text": "text", "figure_title": "caption", "table_title": "caption", "chart_title": "caption", "formula": "formula", "formula_number": "formula", "algorithm": "formula", "table": "table", "image": "figure", "chart": "figure", "seal": "figure", "header_image": "figure", "footer_image": "figure", "header": "furniture", "footer": "furniture", "number": "furniture", "footnote": "furniture"}
KEEP = {"heading", "caption", "formula", "table", "figure", "furniture"}

def cells_to_tokens(cells, label, W, H):
    """A cell is a text run; split it into words with proportional boxes so the
    line builder sees DocBank-like tokens (boxes to 0..1000 of the page)."""
    out = []
    for c in cells:
        x, y, w, h = c["bbox"]
        text = (c["text"] or "").strip()
        if not text or w <= 0 or h <= 0:
            continue
        words = text.split()
        total = sum(len(wd) for wd in words) + max(len(words) - 1, 0)
        cx = x
        font = (c.get("font") or {}).get("name") or "default"
        col = (c.get("font") or {}).get("color") or [0, 0, 0, 255]
        for wd in words:
            ww = w * (len(wd) / total) if total else w
            x0 = int(cx * 1000 / W); x1 = int((cx + ww) * 1000 / W)
            y0 = int(y * 1000 / H); y1 = int((y + h) * 1000 / H)
            out.append((wd, x0, y0, max(x1, x0 + 1), max(y1, y0 + 1), int(col[0]), int(col[1]), int(col[2]), font.lstrip("/"), label))
            cx += ww + w * (1 / total if total else 0)
    return out

def prepare_image(img, size=480):
    im = img.convert("RGB").resize((size, size), Image.BILINEAR)
    a = np.asarray(im, dtype=np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32); std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    a = (a - mean) / std
    chw = np.transpose(a, (2, 0, 1))[None]
    scale = np.array([[size / img.height, size / img.width]], dtype=np.float32)
    return chw, scale

def detector_regions(sess, names, img):
    chw, scale = prepare_image(img)
    outs = sess.run(None, {names[0]: chw, names[1]: scale})
    boxes = None; count = None
    for o in outs:
        if o.ndim == 2 and o.shape[1] == 6: boxes = o
        elif o.ndim == 1 and o.shape[0] == 1: count = int(o[0])
    if boxes is None: return []
    n = min(count, boxes.shape[0]) if count is not None else boxes.shape[0]
    regs = []
    for i in range(n):
        cls, score, x0, y0, x1, y1 = boxes[i]
        if score < 0.5: continue
        regs.append((PP_CLASSES[int(cls)], float(score), x0, y0, x1, y1))
    return sorted(regs, key=lambda r: -r[1])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True); ap.add_argument("--onnx", default=None); ap.add_argument("--out", required=True)
    ap.add_argument("--data", default="data/doclaynet"); ap.add_argument("--max-pages", type=int, default=100000)
    a = ap.parse_args()
    import lightgbm as lgb
    meta = json.load(open(os.path.join(a.model, "features.json")))
    feats = meta["features"]
    model = lgb.Booster(model_file=os.path.join(a.model, "model.txt"))
    sess = names = None
    if a.onnx:
        import onnxruntime as ort
        ort.set_default_logger_severity(3)  # the graph's "unused initializer" warnings, hundreds per session
        sess = ort.InferenceSession(a.onnx, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
        names = [i.name for i in sess.get_inputs()]
    truth, pred_cls, pred_det = [], [], []
    pages = 0; docs = set()
    dump = open(a.out + ".pages.jsonl", "w", encoding="utf-8")
    for fn in sorted(os.listdir(a.data)):
        if not (fn.startswith("test-") and fn.endswith(".parquet")): continue  # the test split only (train-sci.parquet sits beside it, without images)
        pf = pq.ParquetFile(os.path.join(a.data, fn))
        for rg in range(pf.metadata.num_row_groups):
            t = pf.read_row_group(rg, columns=["metadata", "bboxes", "category_id", "pdf_cells", "image"])
            for r in t.to_pylist():
                m = r["metadata"]
                if m["doc_category"] != "scientific_articles": continue
                W, H = m["coco_width"], m["coco_height"]
                toks = []
                for box, cat, cells in zip(r["bboxes"], r["category_id"], r["pdf_cells"]):
                    toks.extend(cells_to_tokens(cells or [], DOCLAYNET[cat], W, H))
                if len(toks) < 5: continue
                rows = page_rows(m["page_hash"], m["page_no"], toks)
                if not rows: continue
                df = pd.DataFrame(rows)
                for f in feats:
                    if f not in df: df[f] = -1.0
                X = df[feats].astype(np.float32).values
                p = model.predict(X).argmax(1)
                img = Image.open(io.BytesIO(r["image"]["bytes"]))
                regs = detector_regions(sess, names, img) if sess else []
                page_lines = []
                for i, row in df.iterrows():
                    truth.append(DL2C[row["label"]])
                    cls_name = meta["labels"][p[i]]  # DocBank's 13 or the deployment model's 7 coarse labels
                    pred_cls.append(DB2C.get(cls_name, cls_name))
                    # line boxes are 0..1 of the page (docbank_lines divides by 1000); regions are in image px
                    cx = (row["x0"] + row["x1"]) / 2 * img.width; cy = (row["y0"] + row["y1"]) / 2 * img.height
                    hit = next((rg_ for rg_ in regs if rg_[2] <= cx <= rg_[4] and rg_[3] <= cy <= rg_[5]), None)
                    pred_det.append(PP2C[hit[0]] if hit else "text")
                    page_lines.append({"b": [round(float(row["x0"]), 4), round(float(row["y0"]), 4), round(float(row["x1"]), 4), round(float(row["y1"]), 4)], "t": truth[-1], "c": pred_cls[-1], "d": pred_det[-1]})
                dump.write(json.dumps({"hash": m["page_hash"], "doc": m["original_filename"], "page": m["page_no"], "W": W, "H": H,
                                       "ow": m["original_width"], "oh": m["original_height"],
                                       "boxes": [[DL2C[DOCLAYNET[c]], *[round(v, 1) for v in b]] for b, c in zip(r["bboxes"], r["category_id"])],
                                       "regions": [[PP2C[c], round(float(s), 3), round(float(x0), 1), round(float(y0), 1), round(float(x1), 1), round(float(y1), 1)] for c, s, x0, y0, x1, y1 in regs],
                                       "lines": page_lines}) + "\n")
                pages += 1; docs.add(m["original_filename"])
                if pages >= a.max_pages: break
            if pages >= a.max_pages: break
        if pages >= a.max_pages: break
    truth = np.array(truth); pred_cls = np.array(pred_cls); pred_det = np.array(pred_det)
    md = [f"# DocLayNet scientific test pages — {pages} pages, {len(docs)} documents, {len(truth)} lines", ""]
    systems = [("line classifier", pred_cls)] + ([("stock detector", pred_det)] if sess else [])
    for name, pr in systems:
        acc = (pr == truth).mean()
        kf = f1_score(np.isin(truth, list(KEEP)), np.isin(pr, list(KEEP)))
        md += [f"## {name}", f"accuracy {acc:.4f}; keep-vs-process F1 {kf:.4f}; macro F1 {f1_score(truth, pr, average='macro'):.4f}", "```",
               classification_report(truth, pr, labels=COARSE, digits=3, zero_division=0), "```", ""]
    open(a.out, "w", encoding="utf-8").write("\n".join(md))
    print("\n".join(md))

if __name__ == "__main__":
    main()
