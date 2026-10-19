"""Pull only the scientific test pages' PDFs out of DocLayNet_extra.zip (7.5 GiB)
with HTTP range reads: the zip's central directory, then each wanted member.

    python fetch_doclaynet_pdfs.py --out data/doclaynet/pdf

The page hashes come from the test parquets' metadata (doc_category ==
scientific_articles). Members are PDF/<page_hash>.pdf, one page each.
"""
import argparse, io, os, struct, sys, urllib.request, zipfile, zlib
import pyarrow.parquet as pq

URL = "https://codait-cos-dax.s3.us.cloud-object-storage.appdomain.cloud/dax-doclaynet/1.0.0/DocLayNet_extra.zip"

class RangeFile(io.RawIOBase):
    """A seekable, read-only file over HTTP range requests, with a small cache."""
    def __init__(self, url):
        self.url = url; self.pos = 0
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req) as r:
            self.size = int(r.headers["Content-Length"])
        self.cache = {}
    def seekable(self): return True
    def readable(self): return True
    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]; return self.pos
    def tell(self): return self.pos
    def _fetch(self, start, end):
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end - 1}"})
        with urllib.request.urlopen(req) as r:
            return r.read()
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        if n == 0 or self.pos >= self.size: return b""
        start = self.pos; end = min(self.size, start + n)
        # fetch in 1 MiB-aligned chunks and cache them
        out = b""
        p = start
        while p < end:
            chunk = p // (1 << 20)
            if chunk not in self.cache:
                cs = chunk << 20; ce = min(self.size, cs + (1 << 20))
                self.cache[chunk] = self._fetch(cs, ce)
                if len(self.cache) > 64: self.cache.pop(next(iter(self.cache)))
            buf = self.cache[chunk]
            off = p - (chunk << 20)
            take = min(end - p, len(buf) - off)
            out += buf[off:off + take]; p += take
        self.pos = end
        return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/doclaynet"); ap.add_argument("--out", default="data/doclaynet/pdf")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    wanted = {}
    for fn in sorted(os.listdir(a.data)):
        if not fn.endswith(".parquet"): continue
        pf = pq.ParquetFile(os.path.join(a.data, fn))
        for rg in range(pf.metadata.num_row_groups):
            for m in pf.read_row_group(rg, columns=["metadata"]).column("metadata").to_pylist():
                if m["doc_category"] == "scientific_articles":
                    wanted[m["page_hash"]] = m
    print(f"{len(wanted)} scientific test pages", file=sys.stderr)
    rf = RangeFile(URL)
    print(f"zip size {rf.size / 2**30:.2f} GiB", file=sys.stderr)
    z = zipfile.ZipFile(rf)
    names = {n.rsplit("/", 1)[-1][:-4]: n for n in z.namelist() if n.endswith(".pdf")}
    print(f"{len(names)} PDFs in the zip", file=sys.stderr)
    got = 0
    for h, m in wanted.items():
        n = names.get(h)
        if not n: continue
        dest = os.path.join(a.out, f"{h}.pdf")
        if os.path.exists(dest): got += 1; continue
        with z.open(n) as src, open(dest, "wb") as dst:
            dst.write(src.read())
        got += 1
        if got % 50 == 0: print(f"  {got}", file=sys.stderr)
    import json
    json.dump({h: {"doc": m["original_filename"], "page": m["page_no"], "w": m["original_width"], "h": m["original_height"]} for h, m in wanted.items()}, open(os.path.join(a.out, "pages.json"), "w"), indent=0)
    print(f"{got} PDFs in {a.out}", file=sys.stderr)

if __name__ == "__main__":
    main()
