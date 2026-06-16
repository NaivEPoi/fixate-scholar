# Processing requirements

The rules below define what ScholarLens must (and must not) do to a document.
They are **template-agnostic**: each rule is stated in terms of document
structure (font sizes, geometry, fonts, text patterns), never in terms of a
specific publisher template, so they apply to academic paper PDFs in general.
The automated tests enforce them against a corpus of real papers spanning
single- and two-column layouts and a range of common templates (see
`test/fixtures/urls.md`); template-specific tuning may be layered on later for
better processing, but must never replace a general rule with a
paper-specific hack.

## 1. Emphasis (what bolding looks like)

| Rule | Where enforced |
|---|---|
| Default mode **dynamic syllables**: bold whole leading syllables, as many as fit within half the word length (rounded up); longer words get several syllables, never more than half | `segmenter.mjs emphasisLength`, unit tests |
| **First syllable only** remains available as an option; **fixed fraction** (configurable slider) as another | settings `emphasisMode`, popup/options UI |
| Never bold an entire multi-character word | `emphasisLength`, unit tests |
| Emphasis must not change font size or color: text renders in the document's own embedded fonts at original size/color by default; bundled open-source reading fonts (Atkinson Hyperlegible, Inter, Literata — all SIL OFL) are opt-in replacements | `engine.mjs #fontFamilyFor`, `papers.mjs fontOk` |
| Light emphasis weight: embedded fonts rarely have a bold variant, so original-font mode uses a hairline text-stroke scaled by the weight slider instead of the browser's all-or-nothing synthetic bold | `overlay.css`, `overlay.mjs applyStyleVars` |
| **Figure/table captions are emphasized like body text**, including multi-line captions — the `Figure N`/`Table N` leader plus its same-size, tight-spacing continuation block. They bypass the smaller-than-body size filter; the figure/table contents themselves are never emphasized | `engine.mjs #skipRegions` caption block + size-filter bypass |

## 2. Layout fidelity (text stays in its original space)

| Rule | Where enforced |
|---|---|
| Every processed span keeps its exact original rendered width. Preferred correction is **word-spacing** (glyphs keep their natural shapes — the line reads naturally); spans with too few spaces fall back to re-calibrating PDF.js's `--scale-x` custom property (never overwrite `style.transform`, which would destroy rotation and min-font-size compensation) | `engine.mjs`, `debug-page.mjs widthCheck` |
| Toggle-off restores the pristine rendering exactly | `engine.mjs #restorePage`, e2e |
| A viewport change (zoom) must never leave the canvas glyphs and our text both visible. PDF.js re-lays out the *same* text-layer DOM in place on zoom (overwriting `--scale-x`) while our pixel-unit masks and word-spacing go stale; so each page is restored to pristine and reprocessed at the new scale on every `textlayerrendered` (the dimensionless pristine `--scale-x` is valid at any scale) | `engine.mjs #processPage` (restore-then-reprocess), `debug-zoom.mjs` (masks match done spans, zero overlaps after zoom) |
| Masks covering duplicate canvas glyphs must also cover ink overshoot (italics, descenders, accents): ±28% height vertical, ±max(2px, 12% height) horizontal padding | `engine.mjs #processPage` |
| Work happens lazily per rendered page, in idle-time chunks | `engine.mjs`, perf budget in plan |

## 3. What is never processed (left exactly as the author set it)

| Rule | Where enforced |
|---|---|
| Math: spans in TeX math/symbol faces (CMMI, CMSY, CMEX, MSAM, MSBM, …) and, inside prose, any word containing non-Latin letters, digits, or symbols — never bolded. To avoid a neighbouring bolded span's mask whiting it out, an inline math/special-font run inside body text is re-rendered from the text layer (its original face, unbolded) on **top** of the masks rather than left only on the canvas. Math/symbol glyphs **bypass the length<2 and smaller/larger-than-body size filters**, so even a single subscript digit or single italic variable becomes a kept glyph (otherwise it is dropped and a neighbour's mask erases it) | `engine.mjs SPECIAL_FONT`/`mathGlyph` + `data-fx-keep`, `overlay.css`, `segmenter.mjs`, unit tests |
| Special fonts: monospace/typewriter, small caps, bold display variants — same `data-fx-keep` on-top handling | `engine.mjs SPECIAL_FONT` |
| URLs, DOIs, emails — including brace-grouped lists `{a, b}@host`, URL continuation lines wrapped without a scheme (`com/Foo/Bar`), and any text under the PDF's own **external-link annotations** (the authoritative metadata — text there stays canvas-rendered in its original color and clickable through the native annotation layer) | `segmenter.mjs LINKLIKE` + continuation rule, `engine.mjs` urlRects, unit tests, `papers.mjs linkOk` + `untouchedEarly` probes |
| **Tables**: a baseline (sub-)row is tabular when it has 3+ gap-separated cells, OR special-font items holding ≥55% of the characters (label columns that fill their width). Tabular rows are clustered per column and the band filled (x-bounded) so interior rows with one or two cells can't leak — **except** running-prose items (≥4 lowercase words), which are spared, so body text that merely shares a PDF baseline with a figure label or table cell is still emphasized (genuine pseudocode is filled wholesale because its rows match `ALGO_LEAD`). The page-center split is applied **only on genuinely two-column pages**, detected by counting lines with an item that *crosses the center line* (left/right-column items reaching toward the gutter do not count; only full-width prose, full-width tables, or a figure straddling the gutter cross): a low ratio ⇒ two-column ⇒ split, so a wide single-column table isn't shredded into sub-3-cell fragments and a table in one column never swallows prose in the other. A **full-width table embedded on a two-column page** (a run of 3+ rows that each have ≥2 cells on *both* sides of the center — distinguishing a real wide table from a two-column line that merely abuts a prose block) is kept whole and marked across its full width, so the column split doesn't shred it | `engine.mjs #skipRegions`/`#lineGroups`/`isFullWidthRow`, `papers.mjs tableOk` + `untouched` probes, `debug-lines.mjs` |
| **Algorithm/pseudocode listings**: rows starting with a line number (`10:`) or `Require:`/`Ensure:`/`Input:`/`Output:`/`Algorithm N` | `engine.mjs #skipRegions ALGO_LEAD`, `untouched` probes |
| The dominant body size is estimated from actual prose only — bibliography and table text are excluded, so appendix prose on references-heavy pages is still processed | `engine.mjs`, `papers.mjs processed` probes |
| Section titles and the paper title: larger than ~1.15× the page's dominant body size | `engine.mjs`, `papers.mjs headingOk` |
| Smaller-than-body text: footnotes and figure/axis labels. **Figure/table captions are the exception — they ARE emphasized** (see §1): a `Figure N`/`Table N` leader and its multi-line continuation block bypass the size filter, while the table/figure *cells* stay on the canvas | `engine.mjs` size filter + `captionSet` |
| Running headers/footers and margins: outer 6% vertical bands, left 4% (page numbers, proceedings lines, watermarks) | `engine.mjs`, `papers.mjs footerOk` |
| Front matter: everything before the Abstract heading — branding/cover pages and the title/authors/emails block, on whichever page they sit | `parser.mjs findContentStart` → `engine.setContentStart`, `papers.mjs headerOk` |
| The bibliography: the exact region of the References body (column-aware per-line boxes; right-column entries above the heading baseline included). **Appendices after the references are processed normally** — the body detection stops at the next heading-sized line even when it doesn't say "appendix" | `parser.mjs findReferencesBody` → `engine.setRefsRegion`, `papers.mjs refsOk`/`appendixOk` |

## 4. References & citations feature

| Rule | Where enforced |
|---|---|
| Detect the bibliography (numeric, dotted, and author-year/hanging-indent styles; two-column layouts) and parse entries with label/authors/year/title/DOI | `references/parser.mjs`, unit tests, `papers.mjs refs` count |
| Link in-text citations — numeric `[12]`, ranges `[1-3]`, author-year `(Smith et al., 2020)`, including citations wrapping across text spans — to their entries | `references/citations.mjs`, `papers.mjs cites` count |
| Hover → instant local entry preview. Click → a pinned Google-Scholar-reader-style card; it **never scrolls the PDF to the bibliography**. The card shows the title (linking to the paper), byline, abstract snippet, cited-by, and actions: **[PDF]**, **Cite** (BibTeX — fetched from Scholar's cite endpoint via the result's cluster id, falling back to a BibTeX generated from the locally parsed entry so a copyable result is always available), **Related articles**, **Google Scholar**, **DOI**; a pager handles multi-citations | `references/popup.mjs`, `references/scholar.mjs fetchScholarBibtex`, e2e popup check |
| Citations and in-paper references (Figure/Table/Section/Algorithm/… N) are colored distinctly with **fixed high-contrast colors** — citations a strong blue (`#0b57d0`), in-paper references a strong red (`#b91c1c`) — chosen for readability on the page rather than sampled from the document (whose own link color is often a low-contrast pastel). Color wrappers are inline (`position: static`) — PDF.js's absolute-positioning of text-layer spans must never apply to them, or line flow collapses | `references/citations.mjs wrapRange`, `overlay.css`, `papers.mjs colorOk` |
| Scholar is queried only on explicit click, one search per reference, cached per session | `references/scholar.mjs` |

## 5. Interception & privacy

| Rule | Where enforced |
|---|---|
| Any top-level PDF navigation opens in the viewer — including `Content-Disposition: attachment`; **nothing is ever saved to disk by navigation**; the toolbar download button is the explicit save path. A `*.pdf` URL is redirected at the **request stage** (before any response exists), so a browser-integrated download manager (IDM, FDM, …) never receives a PDF response on the tab to grab; extension-less PDF URLs (e.g. `arxiv.org/pdf/1706.03762`) are still caught at the header stage by `Content-Type` | `service-worker.mjs` DNR rules (`RULE_REDIRECT_PDF_URL` request-stage + `RULE_REDIRECT_PDF`/`_OCTET` header-stage), e2e interception check |
| Per-site bypass list, per-document "native viewer" escape hatch, context-menu fallback. **Local `file://` PDFs**: a `file://*.pdf` navigation is rewritten to the viewer (when the user has enabled *Allow access to file URLs*), and the viewer's CSP `connect-src` includes `file:` so the viewer can fetch the local file; the toolbar **Open File** button (FileReader) works regardless of that toggle | `service-worker.mjs` webNavigation handler, `viewer.html` CSP (fetch-pdfjs patch 3), README |
| All rendering is local; the only network requests are the PDF fetch and user-initiated Scholar lookups | architecture; README |
| The trademarked two-word brand name appears nowhere in the repo | `scripts/check-naming.mjs` (runs in `npm test`) |

## Test entry points

```sh
npm test                                  # naming guard + unit tests
node test/e2e.mjs <browser>               # full pipeline on a live arXiv paper
node test/papers.mjs [browser]            # 7-template corpus, all rules above
node test/debug-refs.mjs <pdf-url>        # diagnose bibliography detection
node test/debug-page.mjs <pdf-url> <page> # per-page mapping/overlap/width probe
node test/shot-region.mjs <url> <page> …  # screenshot a region for visual checks
```
