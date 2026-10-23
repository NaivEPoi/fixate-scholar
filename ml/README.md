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

### The three systems on the same spans

The rules were run through the extension's own viewer on the 943 single-page
PDFs (dump-reasons.mjs, one headless browser, four seconds a page, the
engine's debug flag armed before the first page so each span's reason is
recorded); every text-layer span whose centre lies in an annotated box is
scored for all three systems, weighted by its characters (a one-glyph
fragment counts as one character, a sentence as its length), the rules'
keep decision being what the engine did to the span. 940 pages, 204,016
spans, 1.89 million characters:

| system | accuracy | keep-vs-process F1 | macro F1 |
|---|---|---|---|
| rules (the engine's reasons) | 0.808 | 0.611 | 0.497 |
| line classifier (shipped) | **0.965** | **0.884** | **0.885** |
| stock PP-DocLayout-S | 0.958 | 0.863 | 0.755 |

Per class (F1, classifier / detector / rules): text 0.98 / 0.98 / 0.90;
headings 0.92 / 0.72 / 0.29; captions 0.87 / 0.93 / 0.82; formulas 0.87 /
0.90 / 0.49; table rows 0.90 / 0.62 / 0.14; figure text 0.82 / 0.83 /
0.38; headers and footers 0.85 / 0.31 / 0.45. The classifier wins where
the engine's own errors live — headings, table rows, headers and footers —
and the detector keeps a small edge on captions, formulas and figure text,
which argues for using both as evidence (the engine does: either may keep
a line, neither un-keeps).

Caveats, so the rules' row is read as a floor rather than a verdict:
DocLayNet's conventions differ from the engine's design in places — it
labels bibliography entries as text while the engine keeps a bibliography
on purpose (`refs-region`), and the single glyphs the engine keeps for
rendering reasons (`special-or-short`, 16k spans) count as misses on a
"text" box even when nothing a reader would emphasise was lost. The
engine's genuine weaknesses on these pages are plain all the same: on some
journal layouts whole columns of prose went to `table-aligned` or
`line-head`, and pages exist where it kept all of their text. On the 49
papers of this project's own corpora the same engine leaves no span
unreasoned; DocLayNet's scientific pages are a wider world (publisher
PDFs, non-LaTeX journals, single pages without their document), which is
exactly where a learned classifier adds to hand-written rules.

## In the engine (2026-10-19)

The model runs behind the `lineModel` option as keep-only evidence
(engine `model-<class>` reasons). What it did on the project's own corpora
(14 public, 35 private papers, through the release gate with `--line`)
decided how much of it acts:

- First policy, any kept class at 0.75 or better: the option gate passed
  (49/49, 36.0 min); the skip-reason diff against the plain gate on the
  same tree showed 44 pages changed, all of them new keeps (94 caption, 7
  furniture, 3 heading, 3 table, 2 figure, 1 formula by reason), nothing
  un-kept. Reading all 190 spans those keeps covered: about twenty real
  gains (sub-figure captions, table cells, a small-caps table title, a
  legend, a lettered sub-heading, table notes), about 170 losses — body
  prose under or beside a figure, at the foot of a page, or a sentence
  tail, named caption or furniture. A base-rate effect, not a contradiction
  of the DocLayNet numbers: where the rules already catch nearly every
  caption, the model's additional caption calls are almost all its errors.
- Second policy (shipped): `LINE_MODEL_KEEP = { table: 0.75, heading: 0.9 }`.
  The same 44 pages re-dumped: 8 keeps remain, all right (7 table cells /
  a table title across three papers, one continuation line of a lettered
  sub-heading), 0 losses. The lettered sub-headings scored 0.60–0.78 and a
  prose line elsewhere 0.78, so no heading threshold separates them; 0.9
  takes the certain one and leaves the rest to the rules. Option gate with
  this policy: PASS, 49/49 in 34.7 min, no retries; the skip-reason diff against the plain gate on the same tree is exactly those four pages (773/773 pages compared), four new keeps — three table, one heading — and nothing else changed.
- The useful edge the measurements found — the rules over-keeping prose as
  `table-aligned` or `line-head` on publisher layouts — needs un-keeping,
  which a keep-only integration cannot do. That is the follow-up, to be
  judged on the extra corpus (`local/corpus-extra`), where those over-keeps
  occur, rather than on the gate corpora, where they do not.
- The release (2026-10-22): the un-keeping the previous point asked for,
  measured first on the extra corpus and then on the gate corpora, and
  narrowed by both readings. Shipped: `LINE_MODEL_RELEASE = { "line-head":
  { p: 0.95, lower: 4, long: 8 } }` — a span the block pass kept as
  `line-head` goes back to processing when the model names its line
  `text` at 0.95 or better AND the span has the shape of prose
  (`releasesKeep`, line-model.mjs; `textShape`, line-features.mjs): no
  number or list marker at the head of its line, of itself, or of its row
  (the first item on its baseline, since a run-in heading's "8.1.2" and a
  reference's "2." are spans of their own); four lowercase words or more
  of its own; and either eight of them (a line inside a paragraph) or a
  sentence's end (a paragraph's last line). The release lifts only the
  block pass's veto, before the candidate filter, so every other check
  still applies (the margin band, the refs region, a region, the art, the
  mask pass) and a rendering reason is never released. A released span
  that is emphasised carries `model-text-over-line-head`; one another
  check kept after all keeps its block reason, so the skip-reason diff
  lists behaviour changes only (the first version re-reasoned every
  bibliography page). `__fxLineModel[page]` carries every line's verdict,
  every candidate with its shape and row lead, and every release with the
  check that kept it after all.
- How the readings narrowed it. Extra corpus (23 papers; allprobes with and
  without `--line`, the skip-reason diff, every changed page dumped with
  the option on, every released span read):
  - The verdict alone (`text` at 0.95, over `table-aligned` and
    `line-head`) changed 48 pages, 22 of them in what was emphasised: 31
    lines of body prose released — a PLOS abstract and introduction whose
    `table-aligned` band was the gutter between the side column and the
    body (18), lines of prose between inline formulas kept as `line-head`
    (6), paragraphs' last lines under outline anchors (7) — against 68
    lines that were not prose: author and affiliation lines of five front
    pages (19), the numbered entries of a bibliography the rules had not
    found as a refs region (38), cells and stub labels of two tables (7),
    box, panel and sub-heading titles (4). The model names every one of
    these text at 0.95–0.999 (DocLayNet labels bibliographies and
    affiliations as text), so no threshold separates them from prose. The
    line's shape does — and it has to be read off the span: the model's
    line builder (`buildLines`, DocBank's clustering) joins a page's
    columns wherever the gutter is narrower than two line heights, so a
    table row joined to its side note, or an affiliation joined to a
    footnote, reads as prose at the line level. A "prose beside it"
    test (a text verdict on a neighbouring line) and a fills-the-measure
    test were tried and dropped: the first caught nothing and cost a
    gain, the second fails on ragged-right and two-column pages.
  - With the shape test, both reasons: 23 releases, all body prose (the
    18 PLOS lines, one line of prose between formulas, four paragraph
    tails), no loss; 8 of the 31 given up (fragments of a prose line
    between formulas — "as a", "and" — and two-word tails such as "10% for
    testing."). Option sweep 22/23 PASS as the plain one (ex05 is
    UNVERIFIED either way).
  - Gate corpora with the same policy (option gate PASS, 50/50 — the
    private directory had gained a paper, so the positional aliases after
    it were realigned for the diff; 773/773 pages compared, 23 changed):
    `line-head` released 10 lines, 9 of them prose (paragraph tails,
    a line of prose between formulas, a definition's description) and one
    an italic numbered run-in heading whose number was a span of its own,
    hidden from the line test by the column join — hence the row-lead
    test. `table-aligned` released 8 lines of prose (two lines beside
    tables; the list lines of a line-numbered page) against 37 emphasised
    cells of three private papers' tables whose cells are sentences — a
    label column beside a column of one-sentence descriptions — and 17
    more such cells that the
    mask pass's rule-bounded zones then kept. A sentence-shaped cell IS a
    sentence to the model and to any shape test, so `table-aligned` is not
    released; the PLOS case stays what it is, a gutter the aligned-run
    rule took for a column boundary.
  - Final policy (`line-head` alone, with the row lead): extra corpus 3
    releases (a line of prose between formulas, two paragraph tails), gate
    corpora 8 (paragraph tails and mid-sentence lines on two public and
    five private papers), no loss on either; the numbered heading and a
    numbered list's line are vetoed by their row lead. Option gate: PASS, 50/50 (14 public, 36 private) in 36.0 min, one infra retry.
    Skip-reason diff against the plain gate on the same tree: 773/773 pages compared, 12 pages changed — the 8 releases, one line each, on two public and six private pages, and the four pages of the keep policy's model-table and model-heading keeps; nothing else.
