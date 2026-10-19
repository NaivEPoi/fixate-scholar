# Line-level layout classifier — training notes (local, git-ignored)

Goal: classify every text line of an academic PDF page into the layout
classes the engine keeps or processes, better than (a) the rule engine's
own reasons and (b) the stock PP-DocLayout-S detector, on held-out documents
of public datasets; then export it for the extension.

## Why a line classifier, not a fine-tuned detector

The engine already has what a detector must recover from pixels: each
line's text, font name, size against the body size, position against the
column measure, neighbours above and below, canvas rules and now the
detector's regions. A gradient-boosted model over those features trains on a
CPU in minutes, predicts in microseconds a line, is zoom-independent and
needs no WebAssembly. The failure classes this round found (caption
continuation, box titles, headings in the body face, formulas, footnotes)
are line-level decisions.

## Data

- DocBank (arXiv pages, token-level labels from LaTeX source: abstract,
  author, caption, date, equation, figure, footer, list, paragraph,
  reference, section, table, title). Token lines carry text, bbox, colour,
  font name. Lines are rebuilt from tokens by baseline clustering.
- DocLayNet (CC-BY 4.0): PDFs + per-page text cells with bbox and 11 region
  classes (Caption, Footnote, Formula, List-item, Page-footer, Page-header,
  Picture, Section-header, Table, Text, Title); category "scientific
  articles" selects the academic pages. Cells are labelled by the region
  that contains them.

Label mapping to the engine's vocabulary:

| model class | engine reason(s) |
|---|---|
| text | processed (prose) |
| heading | line-head, blk-heading, head-wrap |
| caption | caption, caption-absorb, blk-caption |
| footnote | blk-footnote |
| formula | line-formula, blk-eqn, row-eqn |
| table | line-cells, table-*, blk-table |
| figure | fig-body, figure-text, blk-figlabel |
| header/footer | furniture, margin-band, margin-num |
| list | processed (prose with a marker) |
| reference | refs-region |
| title/author/abstract | front-matter / blk-heading / processed |

## Features (per line, no pixels)

Geometry: x0, x1, width, height, y, each normalised by the page and by the
column band; left/right gap to the column edges; distance to the previous
and next line (in line heights); line index on page; column (left/right/
spanning). Typography: font size / body size; font name class (serif, sans,
mono, math, symbol, italic, bold flags from the name); fraction of
characters in digits, uppercase, punctuation, math symbols; word count;
lowercase-word count; Title-Case ratio; ends with [.?!]; ends dangling;
starts with a caption lead / numbered lead / list marker. Context: the same
for the previous and next lines (a window of ±2), and the page's
statistics (body size, measure, column count). Everything the engine can
compute from PDF.js text items without a canvas.

## Evaluation

Held-out by DOCUMENT, never by page. Metrics: per-class precision/recall/
F1 and the weighted F1 on the "keep" vs "process" decision the engine
needs. Three systems on the same scientific pages:

1. rules: the engine's reasons dumped from the viewer (local/dump-page.mjs
   DONE=1) over the dataset's PDFs, mapped by the table above;
2. stock detector: PP-DocLayout-S (ONNX, the file the extension uses) on
   the rendered page; a line takes the class of the region holding its
   centre; "text" when none;
3. this classifier.

## Fine-grained heads

- heading level: title / section / subsection / run-in, from font size
  rank, numbering depth, and position (multi-class head on heading lines).
- math tokens: within a line, tokens in math faces or with math symbols
  (DocBank's equation tokens inside paragraph lines) — a token-level
  model, for the engine's symbol-keep decisions.

## Export

LightGBM trees → JSON → a small JS predictor (sum of leaf values per tree,
softmax), loaded by the engine behind the `lineModel` option; the feature
code is shared between the Python extractor and the JS one by a fixture
test (the same lines must give the same feature vectors).

## Recipe (2026-10-19)

```
python -m venv .venv && .venv/Scripts/pip install numpy pandas pyarrow scikit-learn lightgbm pymupdf huggingface_hub onnxruntime-gpu pillow
# data: DocBank_500K_txt.zip (3.17 GB, Apache-2.0) into data/; DocLayNet v1.1 test parquets into data/doclaynet/
python docbank_lines.py --zip data/DocBank_500K_txt.zip --out data/lines-8k.parquet --max-docs 8000     # 1.42M lines, 6 min
python fetch_doclaynet_train.py && python doclaynet_lines.py --in data/doclaynet/train-sci.parquet --out data/lines-dln.parquet   # 628k lines, 918 papers, no images
python train_deploy.py --data data/lines-8k.parquet --extra data/lines-dln.parquet --out models/deploy --rounds 260 --leaves 23 --lr 0.1
python doclaynet_eval.py --model models/deploy --onnx ../extension/vendor/layout/pp-doclayout-s.onnx --out models/deploy/doclaynet.md
python export_js.py --model models/deploy --out ../extension/vendor/layout/line-model.json --data data/lines-8k.parquet
python export_fixture_page.py --zip data/DocBank_500K_txt.zip --out data/line-features.fixture.json   # the JS parity test's fixture
python fetch_doclaynet_pdfs.py && node dump-reasons.mjs --dir=data/doclaynet/pdf --out=data/doclaynet/reasons.jsonl   # the rules, through the viewer
python compare.py --pages models/deploy/doclaynet.md.pages.jsonl --reasons data/doclaynet/reasons.jsonl --out models/deploy/compare.md
```

## Results (held out by paper)

DocBank only, 13 classes (v1 → v2 with block features): accuracy 0.876 →
0.879, keep-vs-process F1 0.758 → 0.765. Two lessons on the way: a font
flag that counted CMR (Computer Modern's roman text face) as a math face
fired on two thirds of all words; and the Python and JS extractors must
share ASCII word boundaries, or a ligature splits a word differently.

DocLayNet scientific test pages (940 pages, 65 papers, 45,423 lines,
coarse classes text / heading / caption / formula / table / figure /
furniture):

| system | accuracy | keep-vs-process F1 | macro F1 |
|---|---|---|---|
| stock PP-DocLayout-S (regions ≥ 0.5, line by its centre) | 0.895 | 0.884 | 0.803 |
| classifier, DocBank only | 0.746 | 0.594 | 0.582 |
| classifier, DocBank + DocLayNet train, 507 trees × 7, 7.3 MB | 0.949 | 0.947 | 0.933 |
| classifier, same data, 260 trees × 7 of 23 leaves (shipped) | 0.944 | 0.942 | 0.926 |

Per class, the shipped model against the detector: headings 0.95 vs 0.78
F1, tables 0.93 vs 0.66, headers/footers 0.93 vs 0.57, captions 0.91 vs
0.89, formulas 0.95 vs 0.89; figure text 0.90 vs 0.91 (the detector's one
edge). The DocBank-only model lacked figure-text and header classes
entirely, which is what the DocLayNet rows add. The detector was given a
fair input: its scores on DocLayNet's PNGs and on a crisp PyMuPDF render
of the same pages are the same (mean max score 0.80 either way).

Heads: heading level from geometry alone (title / section / subsection /
run-in) 0.89 accuracy on held-out papers; the math-token head is weak
(recall 0.12 against DocBank's noisy inline-math labels) and is not shipped.

The rules comparison on the same spans needs the viewer dump with the
engine's debug flag armed before the first page processes (a dump taken
without it holds no reasons) — see compare.md once the dump has run.
