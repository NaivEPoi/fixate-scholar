# Testing FixateScholar — guide for humans and future LLMs

FixateScholar makes academic-PDF **body text** easier to read by emphasizing the
leading syllables of words ("guided reading"), rendered from PDF.js's text layer
in the document's own embedded font, with the duplicate canvas glyphs masked.
Everything that is **not** running body text (titles, headings, figures, tables,
captions, equations, code, math, front matter, the bibliography) must be left on
the canvas untouched. Citations and in-paper references get clickable/colored
affordances but no typography.

Testing therefore has two halves:
1. **Automated checks** — fast, run after every change (Section 2).
2. **Visual review** — per page, per figure/table, verify the engine processed
   exactly what it should (Sections 4–5). Resumable; logged in `REVIEW_LOG.md`.

The **implementation rules** in Section 3 are the source of truth for "should
this be processed?" — review everything against them.

---

## 0. Environment & gotchas (READ FIRST — most "it didn't work" is here)

- **Both browsers are automatable — and rendering bugs CAN be browser-specific,
  so verify fixes in BOTH.**
  - **Edge** still honours `--load-extension` + `--disable-extensions-except`
    and allows direct `/json/new?<viewerUrl>` navigation. Path:
    `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
  - **Chrome ≥149** removed the `--load-extension` CLI path, but Chrome ≥126
    exposes the CDP command `Extensions.loadUnpacked` when started with
    `--enable-unsafe-extension-debugging` (+ a throwaway `--user-data-dir`).
    Connect a WebSocket to the BROWSER target (`/json/version`
    → `webSocketDebuggerUrl`), call `Extensions.loadUnpacked {path}`, then
    navigate a tab to a `.pdf` URL and let the DNR redirect open the viewer
    (Chrome still blocks DIRECT top-level navigation to viewer.html; Edge
    permits it). `test/chrome-xray.mjs` and `test/matrix-fonts.mjs` implement
    both browsers behind `--browser=chrome|edge`.
  - **Claude-in-Chrome / chrome.debugger-based tooling CANNOT drive the
    viewer** — another extension's `chrome-extension://` pages are off-limits
    to it (no scripting, no screenshots). Use the CDP harnesses instead.
  - **Edge's extension service worker sometimes wedges on a fresh profile**
    (SW evaluate hangs, DNR redirect never fires). Fall back to navigating the
    viewer URL directly, or wipe the throwaway profile dir and relaunch.
- **Kill zombie Edge between runs:** PowerShell
  `Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force`.
  Leftover instances cause "extension did not load" / port conflicts. (The user
  browses in Chrome, so killing Edge is safe — but never kill the user's Chrome.)
- **Real-DPI / zoom reproduction needs a HEADFUL window on the real display.**
  `--force-device-scale-factor=N` in headless does NOT reproduce the
  canvas-vs-DirectWrite-text baseline divergence; only a real headful window at
  the OS scaling (e.g. 175% → devicePixelRatio 1.75) does. Probes that support
  `--headful` open a real Edge window for this.
- **The user sees the FIRST processing pass.** Normal scroll-into-view = one
  `textlayerrendered` → one `processPage`, no re-process. Reproduce bugs in the
  first pass; a later scroll/zoom re-process can mask a transient differently.
- **Bash tool resets cwd between calls** — always
  `cd /c/misc/Claude_Workspace/fixate-scholar && …`.
- Each probe uses a per-pid debug port to avoid collisions; temp profiles in
  `%TEMP%\fx-*`; `rmSync` cleanup is wrapped in try/catch (Edge holds a lock).
- Screenshots/JSON go to `test/out/` (gitignored).

---

## 1. After EVERY change — the quick gate

```bash
cd /c/misc/Claude_Workspace/fixate-scholar
npm test                 # naming guard + 32 unit tests (segmenter/parser). MUST be 32/32.
node test/papers.mjs     # 7-paper corpus smoke test. MUST be 7/7 PASS, all checks true.
```

`papers.mjs` per-paper checks (all must be `true`):
`fontOk` (no fallback faces in processed text), `headingOk`/`headingClean`
(no heading is processed), `headerOk`/`footerOk` (running head/foot untouched),
`tableOk` (table probe spans untouched), `proseOk` (known body prose IS
processed), `refsOk`/`appendixOk` (bibliography untouched, appendix processed),
`linkOk` (figure/table jump links still clickable), `colorOk`
(citations blue `rgb(11,87,208)`, in-paper refs red `rgb(185,28,28)`).

If you touched links/CSP/DNR/rendering, also run the matching probe in Section 4.

**If you touched `#classifyBlocks`, masks, or the width/baseline passes, also
run the corpus-wide sweeps** (each loops all 12 papers; kill `msedge` between
papers):
```bash
node test/diag-dividers.mjs "<paper>"   # canvas rules/underlines/frames vs masks — masked MUST be 0 on every page
node test/audit.mjs "<paper>"           # classification issue classes — keepFallback/tableLeak/capProse ≈ 0
node test/diagnose.mjs "<paper>"        # whiteout MUST be 0; watch the peek total for regressions
```

---

## 2. Automated test inventory

| Command | What it verifies | Pass criteria |
|---|---|---|
| `npm test` | naming guard (trademarked 2-word brand absent) + unit tests | `Naming guard passed`, 32/32 |
| `node test/papers.mjs` | full corpus classification + color + links | 7/7 PASS |
| `node test/verify-links.mjs` | hyperref borders suppressed in fx-on, links still clickable, masks track glyphs | `ALL LINK CHECKS PASSED` |
| `node test/diagnose.mjs <paper>` | rendering fidelity: true whiteout, mask peek, font fallback, skipped paragraphs, citation alignment, selectability | whiteout 0; peek low; fontBad 0; selBad 0 |
| `node test/audit.mjs <paper>` | classification issue classes | keepFallback 0; tableLeak 0; capProse 0; skipBody ≈ 0 |

| `node test/diag-dividers.mjs <paper>` | table rules / box frames / underlines / separators vs masks (canvas dark-run scan + composite whiteness) | `masked=0` on every page |
| `node test/chrome-xray.mjs <paper> <page> [--browser=chrome\|edge] [--preset] [--zoom=N] [--find="text"] [--idle=S] [--shotonly] [--outline]` | REAL-Chrome/Edge captures: normal + x-ray + micro-marker shots, per-span width forensics, idle drift | visual; forensic `sx≈1`, `live == item.width×scale` |
| `node test/matrix-fonts.mjs <paper> <page> [--browser=…]` | every fontMode × boldWeight combo live: width residual vs PDF item widths, jams, overlaps, computed `.fx-b` style | residual ≤ ~0.2px; jams 0; overlaps 0; weight/stroke ramps monotonically |
| `node test/dump-stream.mjs <paper> <page> <left\|right\|full> [filter]` | the engine's-eye line/stream geometry (debug `#classifyBlocks`) | inspection |
| `node test/shot-region2.mjs <paper> <page> [--zoom=] [--find=]` | fx-on vs fx-off matched captures of one region | images should differ only by emphasis |

Paper templates (the `<paper>` arg): the full 12-paper corpus —
`"Two-column A"`..`"Two-column F"`, `"arXiv"`, `"5GCVerif"`, `"5GShield"`,
`"AFC-Diss"`, `"ACL"`, `"UC-Scheme"` (the `PAPERS` map at the top of each
probe; all but arXiv are on yilud.me — enumerate new ones via
`https://yilud.me/sitemap.xml`).

Classification debug: set `globalThis.__fxDebug = true` in the page BEFORE
processing → every skipped span gets `data-fx-why`, and the engine records
`globalThis.__fxBlkStats` (block-table triggers), `__fxAligned` (aligned-table
runs: seed/band/rows), and `__fxCal` (per-page baseline-calibration samples
and applied margins).

---

## 3. Implementation rules — the source of truth for review

### PROCESS (emphasize: bold leading syllables, show text-layer span in the
embedded font at original size, mask the canvas duplicate):
- Running **body text / prose paragraphs** at the dominant body font size.
- **In-text references that open prose** ("Figure 5 shows…", "Table 8 lists…",
  "Algorithm 1 in Appendix A.") — these are sentences, not captions (`REF_PROSE`).
- **Appendix prose** after the bibliography region.
- Dense **prose lists** (bulleted/numbered) — ≥4 lowercase words/line.
- A body paragraph with a **run-in heading** ("Minimizing duplicate states. We…")
  → process the body, skip only the leading bold/heading run.

### DO NOT PROCESS (leave on the canvas, original font, no mask):
- **Paper title, authors, affiliations, emails** — all front matter before the
  Abstract heading.
- **Section / subsection headings** — numbered ("3.1 …", "IV. …", "9.2.3 …"),
  label-led, bold, or larger-than-body; in any font (incl. italic/regular IEEE).
- **Figure/table captions** ("Figure N:", "Table N.", "Algorithm N …") plus their
  multi-line continuation, AND the figure/table body in the block above.
- **Table cells** — rows with ≥3 wide column gaps (but NOT justified prose, which
  is spared by the ≥4-lowercase-words-per-line rule).
- **Figure labels, axis labels, displayed equations.**
- **Pseudocode / algorithm listings** (line-number/`Require:`/keyword leads).
- **Math / symbol / monospace / small-caps / bold-display fonts**; any span with
  no Latin letter (subscripts, operators, bracketed numbers, version strings);
  any single-character span. These stay on the canvas in the document's own face.
- **Sub/superscripts of math symbols** — Latin-letter fragments like the
  "out"/"in"/"dev" under γ/S/M: any span BOTH well below body size
  (`height < dominant×0.8`) AND ≤4 trimmed characters. The whole math cluster
  stays on the canvas (processing a fragment ghosts it off its glyph and its
  mask nicks the parent symbol). Footnote/appendix small text is unaffected —
  its spans are full words/lines.
- **Tables with prose-like cells** (aligned-gap detection): cell boundaries keep
  a common gap INTERVAL across ≥3 rows (running intersection — cells fill to
  different widths); justified prose stretches spaces at VARYING positions and
  never forms such a band. Wrapped cell lines / full cells extend a run at most
  2 rows past the last strong row; on two-column pages the gutter gap is never
  a band and skips are segment-bounded at the gutter.
- **Bibliography / references region** (appendices after it ARE processed).
- **Running headers/footers, page numbers, left/right margins, arXiv watermarks.**
- **Off-size text** (smaller or larger than body) with little prose (footnotes,
  sub/superscript rows).

### ANNOTATE (overlay affordance, NOT typography):
- **Citations** `[N]` / `(Author Year)` → text colored strong **blue**
  (`#0b57d0`); the WHOLE `[N]` (brackets + number) is one clickable hit-target
  that opens the reference card; the PDF's native scroll-to-bibliography link is
  neutralized (its wrapping `section.linkAnnotation` gets `pointer-events:none`).
- **In-paper references** "Figure 3", "Table 9", "Section 5", "Eq. 2" → colored
  strong **red** (`#b91c1c`); the native in-document jump link is PRESERVED.

### RENDER QUALITY (verify visually + with probes):
- Overlay glyphs sit on the **canvas baseline**: the engine MEASURES the
  per-font margin against the page canvas at mask-build time (median of ≤10
  span samples, ±0.15em clamp) and falls back to the metric formula
  (ascentRatio − baselineRatio) when the canvas is unreadable. Processed words
  must sit in the SAME ROW as kept neighbours (inline math, mono identifiers).
- **Width targets come from the PDF, never the DOM**: the width correction aims
  at `item.width × viewport.scale`. The pristine DOM rect is NOT trustworthy —
  in Chrome the text layer can lay out before the embedded FontFace is usable,
  so PDF.js bakes a stale `--scale-x` measured against the css fallback.
- **Word-spacing may stretch but must never fuse words**: positive per-space
  correction up to 0.45×h (justification surplus); negative capped at −0.1×h —
  beyond that, `--scale-x` absorbs the shrink (2–3% narrower glyphs are
  invisible; missing spaces are not).
- **Per-span masks** cover each redrawn glyph + ink overshoot, never white out a
  skipped neighbour (clamp around "obstacles" — including canvas LINE-ART:
  rules, box frames, underlines found by scanning the painted canvas);
  duplicate text-layer spans of skipped content are left on canvas.
- **Emphasis weight must be visible at every slider stop in every font mode**:
  bundled faces ship only 400+700, so the ramp is nearest-real-face + hairline
  stroke (500/600 = 400-face + stroke; 700 = true bold; 800/900 = 700-face +
  stroke). Verify with `matrix-fonts.mjs` (computed `.fx-b` style per combo).
- **Selection** shows a native translucent-blue highlight; **copy** works.
- **No fallback fonts** in processed/kept text (math/special render in the
  original face on the canvas).
- **Stable when idle / zoomed / backgrounded**: must NOT drift after the PDF.js
  30 s idle cleanup (fonts are KEPT: `pdfDocument.cleanup` is wrapped to pass
  `keepLoadedFonts=true` — eviction fires NO font event, so a drift would
  persist silently), on window switch, or on zoom/DPI change.

---

## 4. Targeted diagnostic probes (run the one matching your change)

All write to `test/out/`. Add `--headful` (where supported) for real-DPI.

- **Classification** (did we process the right blocks?):
  `node test/audit.mjs <paper>` → keepFallback / tableLeak / capProse / skipPara /
  skipBody (each should be ~0; skipBody prints `data-fx-why` reasons).
  Per-page deep dive: `node test/probe.mjs <paper> <page> <query> [--shot]`.
- **Baseline alignment**:
  `node test/diag-baseline.mjs <paper> <page> [--headful] [--zoom=1.25] [--dsf=1.75]`
  → `medBotErr` in the aligned range (~−2 to −3); per-span `topErr/botErr`.
  NOTE: this metric is FONT-SPECIFIC — compare within a font, or use the x-ray.
- **Baseline x-ray (visual)**:
  `node test/diag-csp.mjs <paper> --headful --zoom=1.25 --page=N --xray [--idle=33]`
  → forces overlay glyphs RED over the BLACK canvas glyphs (masks hidden); they
  must overlap. `--idle=33` sits 33 s first to catch the idle-drift regression.
- **Idle drift (the 30 s bug)**:
  `node test/diag-idle.mjs <paper> <page>` → after 33 s idle, per-span width delta
  `dW` MUST be 0 and `maskCov` stay 1.0 (was +30–46px / 0.9 before the fix).
- **Citation click**: `node test/diag-hittest.mjs <paper>` (digit's top element
  must be `a.fx-cite-hit`, not `section.linkAnnotation`); `node test/diag-click.mjs`
  (real click on the number opens the card).
- **Selection + copy**: `node test/diag-drag.mjs <paper>` (drag selects text,
  highlight visible, copy event fires with full text).
- **CSP**: `node test/diag-csp.mjs <paper>` (CSP violations must be 0).
- **DNR ids**: `node test/diag-dnr.mjs` (hammers concurrent registrations →
  0 duplicate-id errors, ids `[201,202,203]`).
- **Full Chrome/Edge harness**: `node test/diag-chrome.mjs [--edge] <paper> <page>`
  (CSP + DNR + baseline in one run).

---

## 5. Manual visual review — per page, per figure/table

Goal: confirm the engine's decisions match Section 3 on **every page** of every
paper. Use the classification-overlay capture so the engine's decision is visible
as color, then check each region.

### Capture
```bash
node test/review-capture.mjs "<paper>"     # all pages of one paper
# or omit the arg to capture every paper
```
For each page it writes to `test/out/review/<paper>/`:
- `pNN.png` — fx-on render with a **classification overlay**: processed body =
  **green** tint, skipped/left-on-canvas = **red** tint, kept math/special =
  **blue** tint. (Untinted = canvas text with no text-layer flag.)
- `pNN.json` — per-page summary: counts per category, sample texts, and the
  `data-fx-why` skip reason for each skipped block.
- `<paper>.json` — paper-level roll-up.

### Review each page against the rules
For every page, scan the overlay and flag any mismatch:
- **Green over a figure / table / caption / heading / equation / code** → BUG
  (wrongly processed). Note the page, the text, and the `data-fx-why` (should
  have been a skip reason but wasn't, or a line-pass missed it).
- **Red over a body paragraph** → BUG (wrongly skipped). Note the
  `data-fx-why` so the fix targets the right rule (e.g. `blk-table` on justified
  prose → running-prose exception; `blk-caption` on "Figure N shows…" →
  `REF_PROSE`).
- **No tint over body text that should be green** → not even a candidate (check
  size filter / front-matter cut / refs region).
- **Visual defects** on the fx-on render: fallback font (wrong typeface), glyphs
  higher/lower than neighbours (baseline drift), canvas ghosting around words
  (mask miss), citations not blue / refs not red.
- **Figures/tables specifically**: caption skipped? labels/cells on canvas? the
  figure body not bolded? a "Figure N shows…" sentence in the body IS bolded?

Record findings in `REVIEW_LOG.md` (template there) as you go, with
`paper / page / region / expected / actual / data-fx-why / proposed fix`. Logging
per page makes the review resumable if the session ends.

### After fixes
Re-run the quick gate (Section 1) + the probe for the area you changed, then
re-capture the affected pages and confirm the overlay colors are now correct.
Never fix one paper into a regression on another — `papers.mjs` is the guard.

---

## 6. Hard-won debugging rules (read before chasing a rendering bug)

Lessons from the F1–F16 investigations. Each of these cost hours; don't re-pay.

### Interpreting the x-ray (red overlay over black canvas)
- **Black-only paragraphs in an fx x-ray = CLASSIFICATION skips, not drift.**
  The x-ray colors only `span[data-fx-done]`; an unprocessed block stays
  invisible and you see pure canvas. Dump `data-fx-why` before theorizing.
- **The NATIVE PDF.js text layer is MORE misaligned than our overlay.** Color
  ALL spans red with fx OFF for the control: mid-line red/black wiggle with
  pinned span endpoints is the native justification-distribution floor
  (canvas justifies at spaces; DOM lays out glyph advances) — invisible in
  masked reading mode, NOT a bug to chase.
- **Don't trust page-fit / low-zoom screenshots for ghosting**: PDF.js keeps a
  low-res base canvas that upscales blurry (kept mono tokens grow gap/dot
  artifacts at zoom ≈1.25 that vanish at 1.5+). Confirm at zoom ≥2, and check
  fx-on vs fx-off pixel-equality before blaming the engine.
- **Sub-pixel disagreements between measurement formulas are undecidable** —
  the ink-top predictor (regular-weight measureText) and a bold-weight
  predictor disagree by ~1px on decorative faces. Below ~1px, arbitrate with a
  high-zoom capture, not with either number.

### DOM measurement traps
- **A stale PDF.js `--scale-x` makes ALL rect-based checks self-consistent and
  wrong.** When the FontFace wasn't usable at text-layer layout, PDF.js
  measures the fallback face and the pristine box still equals the canvas
  width — every getBoundingClientRect check passes while glyphs render 6%
  compressed. Expose it with HIDDEN CLONES (same font string, no transform) or
  trust only `item.width × viewport.scale`.
- **Geometry reads while `document.hidden` are stale/0** — the work loop pauses
  on hidden; keep it that way.
- **The canvas backing store always holds the original glyphs** (masks are
  DOM-side). It IS readable inside `work()` at mask-build time — that is where
  `#detectCanvasRules` and the baseline calibration run. It is NOT reliably
  painted at `processPage`-end for off-screen pages, and it may be CSS-stretched
  right after a zoom (guard: `canvas.height/rect.height > dpr×0.85`).
- **Font eviction fires NO event.** PDF.js's 30s idle cleanup deletes
  FontFaces silently; `loadingdone` only fires on RE-load. Anything that
  depends on "fonts are loaded" must either keep them loaded or gate on
  `document.fonts.ready` before measuring.
- **The same face reaches spans under different family strings** —
  `'"g_d0_f12", sans-serif'` (our swap) vs `'g_d0_f12, sans-serif'` (PDF.js).
  Key any per-family cache by the bare leading name.

### Environment traps
- **Edge auto-syncs `chrome.storage.sync` through the OS account even in fresh
  profiles** — tests pass `--disable-sync` and always SET the settings they
  need instead of assuming defaults.
- **Kill `msedge`/`chrome` between harness runs** and use per-pid debug ports;
  zombies cause "pagesCount undefined" / empty storage / silent hangs.
- **git commit -m with a multi-line message dies in PowerShell** (inner quotes
  split into pathspecs). Write the message to a file and `git commit -F`.
- **NEVER round-trip source files through PowerShell `Get-Content`/`Set-Content`**:
  Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI, so every non-ASCII char
  (`→ ≥ — à-ÿ`) becomes mojibake — which can silently corrupt regex character
  classes and in-page probe code (a diagnose probe once returned pages:0 with
  no error). Edit `.mjs`/`.md` with a proper editor/tool or a node script.
- **/tmp resolves to C:\tmp in node on Windows**; use a real temp dir.

### Classification pitfalls (worth remembering before adding a rule)
- Block grouping can MERGE a paragraph with figure-label rows (size tolerance
  0.3): count table-cell gaps only on body-height rows (`r.h ≥ b.h×0.8`).
- A wrapped body line can START with "Figure 4." — a caption lead is vetoed
  when the line above it in the same band is running prose at normal leading.
- In gutter-split passes, a row with NO gutter gap may live entirely in the
  OTHER column — splitting at `splitX` itself must be the fallback, or the
  band's run sweeps the opposite column's body.
- The PDF itself lies sometimes: B p14's "In contrast, 5GBaseChecker" is
  SERIF in the document (author inconsistency). Check the canvas (fx off /
  x-ray black) before "fixing" the classifier.
- A "processed table cells" review flag can be a false positive — body prose
  naming implementations looks tabular in text dumps; confirm with the
  screenshot before chasing.

### Verification discipline
- Rendering bugs can be BROWSER-SPECIFIC (Chrome font-load race; Edge was
  clean with identical code). Verify overlay geometry fixes in both browsers
  via `chrome-xray.mjs --browser=chrome|edge` before concluding.
- The user sees the FIRST processing pass at THEIR zoom/DPI with fx enabled
  BEFORE the document loads — reproduce with `--preset` and headful when a
  report doesn't reproduce headless.
- After ANY engine change, the full gate is: `npm test` → `papers.mjs` (7/7) →
  `diagnose` whiteout 0 → 12-paper `diag-dividers` sweep masked 0 → and, if
  fonts/weights were touched, `matrix-fonts` in both browsers.
