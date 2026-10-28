"""DocBank token files -> one row per text LINE with features and labels.

Reads the txt files straight out of DocBank_500K_txt.zip (no extraction):
each line of a txt file is one token:
    token x0 y0 x1 y1 R G B fontname label        (boxes 0..1000 of the page)
Tokens are clustered into lines by vertical overlap, split at wide
horizontal gaps (two columns share a baseline), and each line gets the
features the extension can compute from PDF.js text items (no pixels), its
majority label, and the labels of its tokens (for the math-token head).

    python docbank_lines.py --zip data/DocBank_500K_txt.zip --out data/lines.parquet --max-docs 20000

Documents are sampled by prefix (one arXiv page set per prefix) so that a
held-out split by document is possible downstream.
"""
import argparse, io, re, sys, zipfile, hashlib
from collections import Counter, defaultdict
import numpy as np
import pandas as pd

LABELS = ["abstract", "author", "caption", "date", "equation", "figure", "footer", "list",
          "paragraph", "reference", "section", "table", "title"]
LABEL_ID = {l: i for i, l in enumerate(LABELS)}

# ASCII semantics throughout (re.ASCII): JavaScript's \b, \d and \s are ASCII
# without the u flag, and the extension's mirror (line-features.mjs) must
# compute the same numbers — a ligature "ﬂ" split "inﬂationary" differently
# under Unicode word boundaries.
CAP_LEAD = re.compile(r"^(?:Fig(?:ure)?\.?|FIG\.?|Tab(?:le)?\.?|TABLE|FIGURE|Algorithm|Listing)\s*(?:\d|[IVXLCDM]+\b|[A-Z]\.?\d)", re.A)
# An in-text reference opening a sentence ("Figure 5 shows", "Fig. 3(b) compares"):
# the engine's running-prose guard (engine.mjs REF_PROSE), the same expression
# as line-features.mjs. A caption lead that is NOT one of these is a caption's.
REF_PROSE = re.compile(r"^(?:Fig(?:ure)?|Figs?|FIG|Tab(?:le)?|TAB|TABLE|FIGURE|Algorithm|Alg|Listing|Section|Sec)\.?\s*(?:\d+(?:\.\d+)*(?:[.\-]?[a-zA-Z])?|[IVXLCDM]+\b|[A-Z]\.?\d+(?:\.\d+)*(?:[.\-]?[a-zA-Z])?)(?:\s*\(\s*[a-zA-Z]\s*\)(?:\s*[-–]\s*\(\s*[a-zA-Z]\s*\))?)?\s*(?:[)\],;.]*\s+[a-zà-ÿ]|\(\s*[a-zà-ÿ]{2,})", re.A)
NUM_LEAD = re.compile(r"^(?:\d+(?:\.\d+)*\.?|[A-Z]\d*[.:]|[A-Z](?:\.\d+)+\.?|[IVX]{1,5}\.|(?:[a-zA-Z]|\d+)\))(?:$|\s)", re.A)
LIST_MARK = re.compile(r"^(?:[•·▪–—\-\*]|\(?\d{1,2}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}[.)])(?:\s|$)", re.A)
DANGLING = re.compile(r"\b(?:a|an|and|as|at|between|by|for|from|in|into|of|on|or|over|than|the|to|under|via|with)\s*$", re.I | re.A)
WORD = re.compile(r"[A-Za-z][a-z]+", re.A)
LOWER_WORD = re.compile(r"\b[a-z][a-z]+\b", re.A)
MATHSYM = re.compile(r"[=+\-±×÷<>≤≥≠∞∑∏∫√∂∇αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ^_{}\\|]")

def font_flags(name):
    n = name or ""
    u = n.upper()
    return dict(
        f_bold=int(bool(re.search(r"BOLD|CMBX|-B(?:[^A-Z]|$)|BX\d|SFBX|BLACK|HEAVY|SEMIBOLD", u))),
        f_italic=int(bool(re.search(r"ITALIC|OBLIQUE|CMTI|CMMI|-I(?:[^A-Z]|$)|SFTI|SLANT|CMSL", u))),
        f_mono=int(bool(re.search(r"MONO|CMTT|COURIER|SFTT|TYPEWRITER|CONSOLAS|INCONSOLATA", u))),
        # math faces only: CMMI (math italic), CMSY/CMEX (symbols), AMS fonts, calligraphic/fraktur, STIX Math.
        # NOT CMR — Computer Modern's roman TEXT face (the first version matched it and flagged two thirds of all words).
        f_math=int(bool(re.search(r"CMMI|CMSY|CMEX|MSBM|MSAM|MATHEMATICAL|[-_ ]MATH|SYMBOL|RSFS|EUFM|EUSM|STIXMATH|STIX.*MATH|WASY|AMSB|AMSA|LMMI|LMSY|LMEX|TXMI|TXSY|PXMI|PXSY|MTMI|MTSY|MTEX|CMBSY|CMMIB|EURM|EUSB|BBOLD", u))),
        f_smallcaps=int(bool(re.search(r"CMCSC|SMALLCAPS|-SC(?:[^A-Z]|$)|CAPS", u))),
        f_sans=int(bool(re.search(r"HELVETICA|ARIAL|SFSS|CMSS|SANS|VERDANA|CALIBRI|DEJAVUSANS|LMSANS", u))),
    )

def parse_txt(data):
    toks = []
    for raw in data.splitlines():
        p = raw.split()
        if len(p) < 10:
            continue
        try:
            x0, y0, x1, y1 = int(p[1]), int(p[2]), int(p[3]), int(p[4])
            r, g, b = int(p[5]), int(p[6]), int(p[7])
        except ValueError:
            continue
        label = p[-1]
        font = p[-2]
        text = " ".join(p[:-9]) if len(p) > 10 else p[0]
        if text.startswith("##LT"):  # ##LTLine##, ##LTFigure## placeholders
            continue
        if label not in LABEL_ID:
            continue
        toks.append((text, x0, y0, x1, y1, r, g, b, font, label))
    return toks

def build_lines(toks):
    """Cluster tokens into lines: sorted by y centre; a token joins the current
    line when its vertical centre lies within the line's band; a line splits at
    a horizontal gap wider than 2 line heights (columns)."""
    if not toks:
        return []
    heights = np.array([t[4] - t[2] for t in toks], dtype=float)
    heights = heights[heights > 0]
    med_h = float(np.median(heights)) if len(heights) else 10.0
    toks = sorted(toks, key=lambda t: ((t[2] + t[4]) / 2, t[1]))
    bands = []
    for t in toks:
        cy = (t[2] + t[4]) / 2
        h = max(t[4] - t[2], 1)
        placed = False
        for band in bands[-6:]:  # recent bands only; tokens arrive by y
            by0, by1 = band["y0"], band["y1"]
            bh = max(by1 - by0, 1)
            if cy >= by0 - 0.25 * bh and cy <= by1 + 0.25 * bh and abs(h - bh) <= 0.6 * max(h, bh):
                band["toks"].append(t)
                band["y0"] = min(by0, t[2]); band["y1"] = max(by1, t[4])
                placed = True
                break
        if not placed:
            bands.append({"y0": t[2], "y1": t[4], "toks": [t]})
    lines = []
    for band in bands:
        ts = sorted(band["toks"], key=lambda t: t[1])
        cur = [ts[0]]
        for a, b in zip(ts, ts[1:]):
            gap = b[1] - a[3]
            lh = max(band["y1"] - band["y0"], 1)
            if gap > 2.0 * lh:
                lines.append(cur); cur = [b]
            else:
                cur.append(b)
        lines.append(cur)
    lines.sort(key=lambda L: (min(t[2] for t in L), min(t[1] for t in L)))
    return lines

def line_record(L, page_stats):
    text = " ".join(t[0] for t in L)
    x0 = min(t[1] for t in L); x1 = max(t[3] for t in L)
    y0 = min(t[2] for t in L); y1 = max(t[4] for t in L)
    hs = [t[4] - t[2] for t in L if t[4] > t[2]]
    h = float(np.median(hs)) if hs else float(y1 - y0)
    fonts = Counter(t[8] for t in L)
    font = fonts.most_common(1)[0][0]
    labels = Counter(t[9] for t in L)
    label = labels.most_common(1)[0][0]
    n = len(L)
    math_fonts = sum(font_flags(t[8])["f_math"] for t in L)
    nonblack = sum(1 for t in L if (t[5], t[6], t[7]) != (0, 0, 0))
    words = WORD.findall(text)
    lower = LOWER_WORD.findall(text)
    caps_words = [w for w in text.split() if re.match(r"^[A-Z][a-z]", w)]
    rec = dict(
        text=text[:200], label=label, label_id=LABEL_ID.get(label, -1),
        tok_labels=" ".join(t[9][:3] for t in L),
        tok_math=" ".join(str(font_flags(t[8])["f_math"]) for t in L),
        x0=x0 / 1000, x1=x1 / 1000, width=(x1 - x0) / 1000, y0=y0 / 1000, y1=y1 / 1000,
        h=h / 1000, h_rel=h / page_stats["body_h"] if page_stats["body_h"] else 1.0,
        n_tok=n, n_chars=len(text), n_words=len(words), n_lower=len(lower),
        frac_digit=sum("0" <= c <= "9" for c in text) / max(len(text), 1),  # ASCII digits, as JS \d
        frac_upper=sum(c != c.lower() and c == c.upper() for c in text) / max(len(text), 1),  # as the JS mirror
        frac_punct=sum((not c.isalnum()) and (not c.isspace()) for c in text) / max(len(text), 1),
        frac_mathsym=len(MATHSYM.findall(text)) / max(len(text), 1),
        frac_mathfont=math_fonts / n, frac_nonblack=nonblack / n, n_fonts=len(fonts),
        title_case=len(caps_words) / max(len(text.split()), 1),
        ends_period=int(bool(re.search(r"[.!?]\s*$", text))), ends_comma=int(text.rstrip().endswith(",")),
        ends_colon=int(text.rstrip().endswith(":")), dangling=int(bool(DANGLING.search(text))),
        cap_lead=int(bool(CAP_LEAD.match(text))), ref_prose=int(bool(REF_PROSE.match(text))), num_lead=int(bool(NUM_LEAD.match(text))),
        list_mark=int(bool(LIST_MARK.match(text))), has_at=int("@" in text), has_url=int("http" in text or "www." in text),
        has_cid=int("(cid:" in text), bracket_ref=int(bool(re.search(r"\[\d{1,3}\]", text))),
        year=int(bool(re.search(r"\b(?:19|20)\d{2}\b", text))),
    )
    rec.update(font_flags(font))
    # position against the page's column structure
    rec["left_gap"] = (x0 - page_stats["left"]) / 1000
    rec["right_gap"] = (page_stats["right"] - x1) / 1000
    rec["centred"] = int(abs((x0 - page_stats["left"]) - (page_stats["right"] - x1)) < 0.04 * 1000 and (x0 - page_stats["left"]) > 0.03 * 1000)
    rec["fills_measure"] = int((page_stats["right"] - x1) < 0.012 * 1000)
    rec["col"] = 0 if x1 <= page_stats["mid"] + 10 else (1 if x0 >= page_stats["mid"] - 10 else 2)
    return rec

def page_statistics(lines):
    hs = []
    for L in lines:
        for t in L:
            if t[4] > t[2]:
                hs.append(t[4] - t[2])
    hs = np.array(hs) if hs else np.array([10.0])
    # body height: the mode of token heights (rounded)
    vals, counts = np.unique(np.round(hs), return_counts=True)
    body_h = float(vals[np.argmax(counts)])
    lefts = np.array([min(t[1] for t in L) for L in lines]); rights = np.array([max(t[3] for t in L) for L in lines])
    return dict(body_h=body_h, left=float(np.percentile(lefts, 5)), right=float(np.percentile(rights, 95)), mid=500.0)

NEIGHBOUR_KEYS = ["h_rel", "x0", "x1", "f_bold", "f_italic", "f_math", "f_mono", "n_lower", "ends_period", "dangling", "cap_lead", "ref_prose", "num_lead", "centred", "fills_measure", "frac_mathfont"]

def page_rows(doc, page, toks):
    lines = build_lines(toks)
    if not lines:
        return []
    st = page_statistics(lines)
    recs = [line_record(L, st) for L in lines]
    nL = len(recs)
    # Blocks: a new block starts at a gap wider than 1.35 line heights, a size
    # change of more than 15%, or a column change. A caption's second line
    # looks like prose on its own; its block's first line carries the lead.
    blocks = []
    for i, r in enumerate(recs):
        if i == 0:
            blocks.append([i]); continue
        p = recs[i - 1]
        gap = abs(r["y0"] - p["y1"]) / max(r["h"], 1e-4)
        new = gap > 1.35 or abs(r["h_rel"] - p["h_rel"]) > 0.15 or r["col"] != p["col"] or r["y0"] < p["y0"]
        (blocks.append([i]) if new else blocks[-1].append(i))
    for b in blocks:
        first, last = recs[b[0]], recs[b[-1]]
        mean_math = float(np.mean([recs[j]["frac_mathfont"] for j in b]))
        mean_lower = float(np.mean([recs[j]["n_lower"] for j in b]))
        mean_hrel = float(np.mean([recs[j]["h_rel"] for j in b]))
        for k, j in enumerate(b):
            r = recs[j]
            r["blk_len"] = len(b); r["blk_pos"] = k / max(len(b) - 1, 1); r["blk_first"] = int(k == 0); r["blk_last"] = int(k == len(b) - 1)
            r["blk_cap_lead"] = first["cap_lead"]; r["blk_ref_prose"] = first["ref_prose"]; r["blk_num_lead"] = first["num_lead"]; r["blk_list_mark"] = first["list_mark"]
            r["blk_first_centred"] = first["centred"]; r["blk_first_x0"] = first["x0"]; r["blk_first_bold"] = first["f_bold"]
            r["blk_last_fills"] = last["fills_measure"]; r["blk_last_period"] = last["ends_period"]
            r["blk_mean_math"] = mean_math; r["blk_mean_lower"] = mean_lower; r["blk_mean_hrel"] = mean_hrel
            r["blk_width"] = max(recs[j2]["x1"] for j2 in b) - min(recs[j2]["x0"] for j2 in b)
    for i, r in enumerate(recs):
        r["doc"] = doc; r["page"] = page; r["line_idx"] = i; r["n_lines"] = nL; r["pos"] = i / max(nL - 1, 1)
        r["body_h"] = st["body_h"] / 1000
        for off, tag in ((-2, "p2"), (-1, "p1"), (1, "n1"), (2, "n2")):
            j = i + off
            if 0 <= j < nL:
                o = recs[j]
                r[f"{tag}_gap"] = abs(o["y0"] - r["y0"]) / max(r["h"], 1e-4)
                for k in NEIGHBOUR_KEYS:
                    r[f"{tag}_{k}"] = o[k]
                r[f"{tag}_same_font"] = int(o["f_bold"] == r["f_bold"] and o["f_italic"] == r["f_italic"] and abs(o["h_rel"] - r["h_rel"]) < 0.12)
            else:
                r[f"{tag}_gap"] = -1.0
                for k in NEIGHBOUR_KEYS:
                    r[f"{tag}_{k}"] = -1.0
                r[f"{tag}_same_font"] = -1
    return recs

def doc_of(name):
    base = name.rsplit("/", 1)[-1]
    m = re.match(r"^(.*)_(\d+)\.txt$", base)
    return (m.group(1), int(m.group(2))) if m else (base, 0)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--max-docs", type=int, default=20000); ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    z = zipfile.ZipFile(a.zip)
    names = [n for n in z.namelist() if n.endswith(".txt")]
    by_doc = defaultdict(list)
    for n in names:
        d, p = doc_of(n); by_doc[d].append((p, n))
    docs = sorted(by_doc)
    rng = np.random.default_rng(a.seed)
    if len(docs) > a.max_docs:
        docs = list(rng.choice(docs, a.max_docs, replace=False))
    print(f"{len(names)} pages in {len(by_doc)} documents; using {len(docs)} documents", file=sys.stderr)
    rows = []
    for i, d in enumerate(docs):
        for p, n in sorted(by_doc[d]):
            toks = parse_txt(z.read(n).decode("utf-8", "replace"))
            rows.extend(page_rows(d, p, toks))
        if i % 500 == 0:
            print(f"  {i} docs, {len(rows)} lines", file=sys.stderr)
    df = pd.DataFrame(rows)
    df.to_parquet(a.out, index=False)
    print(f"wrote {len(df)} lines to {a.out}; labels: {df.label.value_counts().to_dict()}", file=sys.stderr)

if __name__ == "__main__":
    main()
