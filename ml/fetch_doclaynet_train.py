"""DocLayNet v1.1 train+val, scientific pages only, WITHOUT images: read the
metadata, bboxes, category_id and pdf_cells columns of each parquet through
Hugging Face's filesystem (range reads), keep doc_category ==
scientific_articles, and write data/doclaynet/train-sci.parquet.

    python fetch_doclaynet_train.py
"""
import sys, time
import pyarrow as pa, pyarrow.parquet as pq
from huggingface_hub import HfFileSystem

REPO = "datasets/docling-project/DocLayNet-v1.1/data"
COLS = ["metadata", "bboxes", "category_id", "pdf_cells"]

def main():
    fs = HfFileSystem()
    files = sorted(p for p in fs.ls(REPO, detail=False) if p.endswith(".parquet") and ("train-" in p or "val-" in p))
    print(f"{len(files)} files", file=sys.stderr)
    tables = []; rows = 0; t0 = time.time()
    for i, path in enumerate(files):
        with fs.open(path, "rb", block_size=4 << 20) as f:
            pf = pq.ParquetFile(f)
            n = 0
            for rg in range(pf.metadata.num_row_groups):
                t = pf.read_row_group(rg, columns=COLS)
                cats = [m["doc_category"] for m in t.column("metadata").to_pylist()]
                keep = [j for j, c in enumerate(cats) if c == "scientific_articles"]
                if keep:
                    sub = t.take(pa.array(keep))
                    sub = sub.append_column("split", pa.array(["val" if "/val-" in path else "train"] * len(keep)))
                    tables.append(sub); n += len(keep)
            rows += n
            print(f"  {i + 1}/{len(files)} {path.rsplit('/', 1)[-1][:22]}: {n} scientific rows ({rows} total, {time.time() - t0:.0f} s)", file=sys.stderr)
    out = pa.concat_tables(tables)
    pq.write_table(out, "data/doclaynet/train-sci.parquet")
    print(f"wrote {out.num_rows} rows", file=sys.stderr)

if __name__ == "__main__":
    main()
