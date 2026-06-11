# Processing requirements

The rules below define what FixatePDF must (and must not) do to a document.
They are **template-agnostic**: each rule is stated in terms of document
structure (font sizes, geometry, fonts, text patterns), never in terms of a
specific publisher template. The automated tests enforce them against a corpus
covering USENIX Security/NSDI, ACM CCS/WiSec, EW, and IEEE-format papers (see
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

## 2. Layout fidelity (text stays in its original space)

| Rule | Where enforced |
|---|---|
| Every processed span keeps its exact original rendered width: re-calibrate only PDF.js's `--scale-x` custom property (never overwrite `style.transform`, which would destroy rotation and min-font-size compensation) | `engine.mjs`, `debug-page.mjs widthCheck` (0.0px drift) |
| Toggle-off restores the pristine rendering exactly | `engine.mjs #restorePage`, e2e |
| Masks covering duplicate canvas glyphs must also cover ink overshoot (italics, descenders, accents): ±28% height vertical, ±max(2px, 12% height) horizontal padding | `engine.mjs #processPage` |
| Work happens lazily per rendered page, in idle-time chunks | `engine.mjs`, perf budget in plan |

## 3. What is never processed (left exactly as the author set it)

| Rule | Where enforced |
|---|---|
| Math: spans in TeX math/symbol faces (CMMI, CMSY, CMEX, MSAM, MSBM, …) and, inside prose, any word containing non-Latin letters, digits, or symbols | `engine.mjs SPECIAL_FONT`, `segmenter.mjs`, unit tests |
| Special fonts: monospace/typewriter, small caps, bold display variants | `engine.mjs SPECIAL_FONT` |
| URLs, DOIs, emails — including brace-grouped lists `{a, b}@host` | `segmenter.mjs LINKLIKE`, unit tests, `papers.mjs linkOk` |
| **Tables**: any baseline row forming 3+ cells separated by column-sized gaps (two-column body text yields only 2, so it is safe) | `engine.mjs #tableDivs`, `papers.mjs tableOk` |
| Section titles and the paper title: larger than ~1.15× the page's dominant body size | `engine.mjs`, `papers.mjs headingOk` |
| Smaller-than-body text: footnotes, figure labels, captions (also caption lines by `Figure N`/`Table N` prefix) | `engine.mjs` |
| Running headers/footers and margins: outer 6% vertical bands, left 4% (page numbers, proceedings lines, watermarks) | `engine.mjs`, `papers.mjs footerOk` |
| Front matter: everything before the Abstract heading — branding/cover pages and the title/authors/emails block, on whichever page they sit | `parser.mjs findContentStart` → `engine.setContentStart`, `papers.mjs headerOk` |
| The bibliography: the exact region of the References body (column-aware per-line boxes; right-column entries above the heading baseline included). **Appendices after the references are processed normally** — the body detection stops at the next heading-sized line even when it doesn't say "appendix" | `parser.mjs findReferencesBody` → `engine.setRefsRegion`, `papers.mjs refsOk`/`appendixOk` |

## 4. References & citations feature

| Rule | Where enforced |
|---|---|
| Detect the bibliography (numeric, dotted, and author-year/hanging-indent styles; two-column layouts) and parse entries with label/authors/year/title/DOI | `references/parser.mjs`, unit tests, `papers.mjs refs` count |
| Link in-text citations — numeric `[12]`, ranges `[1-3]`, author-year `(Smith et al., 2020)`, including citations wrapping across text spans — to their entries | `references/citations.mjs`, `papers.mjs cites` count |
| Hover → instant local entry preview; click → pinned card with Google Scholar preview (title/byline/snippet/cited-by/[PDF]), pager for multi-citations, See-in-References, DOI | `references/popup.mjs`, e2e popup check |
| Scholar is queried only on explicit click, one search per reference, cached per session | `references/scholar.mjs` |

## 5. Interception & privacy

| Rule | Where enforced |
|---|---|
| Any top-level PDF navigation opens in the viewer — including `Content-Disposition: attachment`; **nothing is ever saved to disk by navigation**; the toolbar download button is the explicit save path | `service-worker.mjs` DNR rules, e2e interception check |
| Per-site bypass list, per-document "native viewer" escape hatch, context-menu fallback, `file://` support | `service-worker.mjs`, popup |
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
