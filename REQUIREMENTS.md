# Processing requirements

The rules below define what FixateScholar must (and must not) do to a document.
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
| Masks covering duplicate canvas glyphs must also cover ink overshoot (italics, descenders, accents): ±28% height vertical, ±max(2px, 12% height) horizontal padding; the horizontal extent derives from the item's true canvas width | `engine.mjs #processPage` |
| **Width targets come from the PDF geometry, never the DOM**: the width correction aims at `item.width × viewport.scale`. In Chrome the text layer can lay out before the embedded FontFace is usable — PDF.js bakes a stale `--scale-x` against the css fallback, and every DOM rect stays self-consistently wrong (glyphs render ~6% compressed) | `engine.mjs` width pass (targetW), `test/chrome-xray.mjs` forensics |
| **Word-spacing may stretch, never fuse**: positive per-space correction ≤0.45×h (justification surplus), negative capped at −0.1×h; larger shrinks go to `--scale-x` (2–3% narrower glyphs are invisible; missing spaces are not) | `engine.mjs` width pass |
| **Overlay baselines are measured, not assumed**: at mask-build time the engine samples the canvas ink per font family and applies the median em-margin that lands overlay ink on canvas ink (±0.15em clamp; metric ascent/baseline-ratio fallback when the canvas is unreadable/low-res) — processed words sit in the same row as kept neighbours | `engine.mjs` baseline calibration, `test/chrome-xray.mjs` |
| **Embedded fonts are never evicted while the viewer lives**: PDF.js's 30 s idle cleanup would delete the FontFaces with NO event fired, silently re-rendering the overlay in a substitute face; `pdfDocument.cleanup` is wrapped to keep loaded fonts (canvases still get cleaned) | `overlay.mjs` documentloaded hook |
| **Every bold-weight slider stop renders visibly in every font mode**: bundled faces ship only 400+700, so emphasis ramps nearest-real-face + hairline stroke (500/600 = 400-face+stroke, 700 = true bold, 800/900 = 700-face+stroke); original mode uses the 400-face+stroke ramp | `overlay.css`/`overlay.mjs`, `test/matrix-fonts.mjs` |
| Work happens lazily per rendered page, in idle-time chunks, gated on `document.fonts.ready` and paused while `document.hidden` | `engine.mjs`, perf budget in plan |

## 3. What is never processed (left exactly as the author set it)

| Rule | Where enforced |
|---|---|
| Math: spans in TeX math/symbol faces (CMMI, CMSY, CMEX, MSAM, MSBM, …), any span with no Latin letter (operators, bracketed numbers, version strings), and any single-character span — never processed. They stay **on the canvas** in the document's own face and become mask **obstacles**, so a neighbouring processed span's mask clamps around them and can never white them out. (The old `data-fx-keep` re-draw-on-top path is REMOVED — re-drawing used PDF.js's substitute face and changed the math's font.) | `engine.mjs` candidate filter + `obstacleDivs` |
| **Sub/superscripts of math symbols** — Latin fragments like the "out"/"in"/"dev" under γ/S/M: any span BOTH well below body size (`height < dominant×0.8`) AND ≤4 trimmed chars stays on the canvas with its parent symbol (processing a fragment ghosts it off its glyph; its mask nicks the symbol). Footnote small text is unaffected (full words/lines) | `engine.mjs` candidate filter |
| Special fonts: monospace/typewriter, small caps, bold display variants — same kept-on-canvas + obstacle handling | `engine.mjs SPECIAL_FONT` |
| URLs, DOIs, emails — including brace-grouped lists `{a, b}@host`, URL continuation lines wrapped without a scheme (`com/Foo/Bar`), and any text under the PDF's own **external-link annotations** (the authoritative metadata — text there stays canvas-rendered in its original color and clickable through the native annotation layer) | `segmenter.mjs LINKLIKE` + continuation rule, `engine.mjs` urlRects, unit tests, `papers.mjs linkOk` + `untouchedEarly` probes |
| **Tables**: a baseline (sub-)row is tabular when it has 3+ gap-separated cells, OR special-font items holding ≥55% of the characters (label columns that fill their width). Tabular rows are clustered per column and the band filled (x-bounded) so interior rows with one or two cells can't leak — **except** running-prose items (≥4 lowercase words), which are spared, so body text that merely shares a PDF baseline with a figure label or table cell is still emphasized (genuine pseudocode is filled wholesale because its rows match `ALGO_LEAD`). The page-center split is applied **only on genuinely two-column pages**, detected by counting lines with an item that *crosses the center line* (left/right-column items reaching toward the gutter do not count; only full-width prose, full-width tables, or a figure straddling the gutter cross): a low ratio ⇒ two-column ⇒ split, so a wide single-column table isn't shredded into sub-3-cell fragments and a table in one column never swallows prose in the other. A **full-width table embedded on a two-column page** (a run of 3+ rows that each have ≥2 cells on *both* sides of the center — distinguishing a real wide table from a two-column line that merely abuts a prose block) is kept whole and marked across its full width, so the column split doesn't shred it | `engine.mjs #skipRegions`/`#lineGroups`/`isFullWidthRow`, `papers.mjs tableOk` + `untouched` probes, `debug-lines.mjs` |
| **Algorithm/pseudocode listings**: rows starting with a line number (`10:`) or `Require:`/`Ensure:`/`Input:`/`Output:`/`Algorithm N` | `engine.mjs #skipRegions ALGO_LEAD`, `untouched` probes |
| The dominant body size is estimated from actual prose only — bibliography and table text are excluded, so appendix prose on references-heavy pages is still processed | `engine.mjs`, `papers.mjs processed` probes |
| Section titles and the paper title: larger than ~1.15× the page's dominant body size | `engine.mjs`, `papers.mjs headingOk` |
| Smaller-than-body text: footnotes and figure/axis labels. **Figure/table captions are SKIPPED** (this REVERSES an earlier "bold the captions" behaviour): a `Figure N:`/`Table N.` leader plus its tight multi-line continuation stays on the canvas as part of its figure/table — but a wrapped BODY line that merely starts with "Figure 4." is NOT a caption (vetoed when the line above it in the same band is running prose at normal leading), and an in-text "Figure N shows …" sentence is prose (`REF_PROSE`) | `engine.mjs` caption pass + `isCaptionLead`, `papers.mjs headingClean` |
| **Tables with prose-like cells** (aligned-gap detection, stream + whole-line): cell boundaries keep a common gap INTERVAL across ≥3 rows (running intersection); justified prose gaps wander so it never forms a band. Wrapped/full cells extend a run ≤2 rows past the last strong row; on two-column pages the gutter is never a band and skips are segment-bounded at the gutter; cell gaps are counted only on body-height rows (`r.h ≥ block.h×0.8`) so figure-label rows merged into a paragraph block can't fake a table | `engine.mjs skipAlignedTable` + block pass, `test/diag-dividers.mjs` |
| **Canvas line-art is sacred**: table rules, box frames, underlines, and separators found by scanning the painted canvas for long/thin/isolated dark runs (horizontal + vertical) become mask obstacles — a mask must NEVER white out a rule ( `diag-dividers` asserts masked=0 corpus-wide) | `engine.mjs #detectCanvasRules` |
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
| **Interception is governed by a master `intercept` switch (default on).** When off, `applyRules()` registers **no** redirect rules and the `file://` rewrite is skipped, so every PDF reaches the browser's native viewer — letting its built-in PDF tools (incl. Gemini's "ask about this PDF") and other PDF extensions handle it. Our redirect sends the PDF to a `chrome-extension://` viewer page those tools can't read into, so deferring (globally or per-site) is the way to coexist. The reader stays available on demand: the popup's **Open this PDF in FixateScholar** button on a native-viewer PDF tab, and the right-click **Open in FixateScholar** menu, both work regardless of the switch. `intercept` is distinct from `enabled` (which only toggles typography inside the viewer) | `settings-client.mjs DEFAULTS.intercept`, `service-worker.mjs applyRules`/`storage.onChanged`/`webNavigation` gate, popup + options UI, `test/diag-intercept.mjs` |
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
