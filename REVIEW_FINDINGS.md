# Visual review — confirmed issues & proposed fixes

Produced by the per-page audit (`test/review-capture.mjs` overlays +
`test/review-workflow.mjs` review/verify). Each issue is verified against the
screenshot before listing. Rules: `TESTING.md` Section 3.

Status: **review complete; F1-F5 all FIXED & validated. Round 3 (F6/F7) below.**
Latest: **Round 27 (R27) — copy a paragraph, get a paragraph: the page's line
breaks are rejoined and the hyphens they were broken with are repaired.**
Before it: **Round 26 (R26)** — a two-column paper whose citations were never
linked at all: a small-caps heading lost to the next column's baseline, a float
caption truncating the bibliography, and a fallback so a reference section that
exists is always worth processing. **Round 25 (R25)** — PDFs from the internet,
and the browser that cannot load us.

### Round 3 (2026-07-09) — divider-line masking + "upper-left shift" (user report)
Built `test/diag-dividers.mjs`: per page, finds long thin dark runs on the
PRISTINE canvas backing store (table rules, box frames, separators) and checks
whether they turn white in the composited (fx-on) page — i.e. masked by us.
Also `test/dump-stream.mjs` (engine's-eye line/stream geometry dump) and
`test/shot-region2.mjs` (fx-on vs fx-off matched captures, --find/--zoom).

- **F6 (HIGH, user-visible) — prose-cell tables processed → masks white out the
  table rules and ghost the cell text.** The "upper-left shift" is this ghost:
  a processed cell whose mask is clamped by neighbouring cells leaves the canvas
  copy partially visible beside the overlay copy. Reproduced: B p11 Table 1
  (9 rules masked), A p12 D3 row, A p20 MI row, A p21 Table 8 (12 rules),
  A p8 boxed formula (frame erased), small-caps "C" whiteout.
  Fixes (engine.mjs `#classifyBlocks` + mask pass):
  1. `skipAlignedTable` — stream-level aligned-gap-band pass: a table's cell
     boundary keeps a common gap INTERVAL across ≥3 rows (running intersection,
     e.g. NE∩ES∩RI∩MI = [442,447]); justified prose gaps wander. Full cells
     word-breaking at the boundary and wrapped cell lines extend runs as weak
     rows (≤2 past the last strong row); an item CROSSING the band breaks it.
  2. Whole-LINE aligned pass (twoColumn): a cell protruding past the page centre
     sends its row to the `full` stream while neighbours go left/right, hiding
     the table from every stream (A p12 D3). The whole-line pass sees them
     adjacent; the gutter gap is excluded from band candidates and the skip is
     SEGMENT-bounded at the gutter, so merged two-column body baselines and the
     opposite column's body are never swept.
  3. `line-formula` — a line with ZERO lowercase words, ≥3 items and ≥15%
     punctuation density is a displayed formula in a text face; skipped, and its
     divs are PROTECTED: their obstacle rects are expanded ±0.35h vertically so
     adjacent body masks clamp before the formula's box frame.
  4. Mask overlap-clamp: an obstacle OVERLAPPING the span's own glyph rect
     (kerned small-caps "C") previously fell through all clamp branches and got
     whited; now the nearest mask edge pulls back (capped 40-45%) — a small
     canvas peek of our own duplicate beats erasing canvas-only text.
  Validated: B 153 rules / 0 masked (was 9); A 135 rules / 22→2 remaining, both
  verified visually intact-or-minor (p8 = detector rounding artifact, box frame
  fully intact at 2×; p15 = table header row nicks, minor). diagnose B
  whiteout=0; corpus 7/7 PASS.
- **F8 — underlined run-in leads erased (three variants) + canvas line-art
  obstacles (2026-07-11).** The remaining "divider lines" were UNDERLINES under
  run-in paragraph leads: (a) italic "Establishing privacy-preserving mutual
  authentication … under MA+:" (UC-Scheme p6; Libertine italic is named
  `LinLibertineTI` — extended ITALIC_FONT; upright entity names ≤5 chars may
  interleave; run must end at a colon) → `skipItalicLead` skips + protects;
  (b) the same lead behind a label ("P1: Preventing identity exposure:") takes
  the `line-head` path — italic-led line-head lines are now protected too;
  (c) regular-weight underlined leads ("Effectiveness of ConnSentinel.") have
  NO font signal at all → the general fix: **`#detectCanvasRules`** scans the
  painted canvas for long (≥60 CSS px), thin (≤3 px), isolated dark runs —
  table rules, box frames, underlines, separators — and registers them as
  obstacles, so the existing mask clamps avoid ALL canvas line-art
  automatically (the canvas paints before textlayerrendered, so the visible
  pass sees it; off-screen prefetch degrades gracefully to the old behaviour).
  Validated: 5GShield 53 rules / 0 masked, UC-Scheme p2/p6 0 masked.
- **F7 — papers.mjs `appendixOk` heuristic**: "last page must have a processed
  span" is wrong when the last page is entirely a ruled table (A p21 Table 8 —
  processing it is what destroyed its 12 rules). Now also accepted when >50% of
  the page's spans are deliberately table-classified.
- **Alignment re-verified (the actual user question):** fx-on/fx-off captures at
  zoom 2.5 are pixel-identical on skipped bold text; baseline sweep 0.75×–2× at
  DPR 1 and real-DPI 1.75 headful — normalized offsets constant (≈4.1/−2.7 per
  unit zoom). The perceived "shift" was the F6 ghost + PDF.js's low-res base
  canvas upscale at page-fit (a capture/compositor artifact, identical fx-off).

### Round 2 (2026-07-08) — 5 new papers from the updated yilud.me
Corpus grew to 12 papers (5GCVerif, 5GShield, AFC-Diss, ACL, UC-Scheme added;
82 new pages captured & reviewed). New findings, all fixed:
- **F5 (HIGH) — citations silently disabled on narrow-gutter templates.**
  extractor.mjs joined items within 2× font height; ACL/LNCS-style gutters
  (~1.8×h) fit under that, so the left column's last words merged with the right
  column's "References" heading → heading regex never matched → parseReferences
  returned 0 entries → `annotatePage` never ran: **zero citation cards/coloring
  on the whole document** (ACL + 5GShield). Fix: a join that crosses the page
  center is only allowed at word-space scale (<0.8×h) — full-width lines still
  join (word spaces are ~0.3×h), gutters never do. Validated: ACL 0→91 entries
  (author-year citations now colored + carded), 5GShield 0→67; refs pages
  correctly untouched (ACL p13). Bonus: fixed entry parsing on the old corpus
  (F 13→23 refs, arXiv 47→68).
- **F2 residual — 3-row caption+body merged block.** The ≥5-row guard missed a
  caption merged with just 2 body lines (5GCVerif p03 "NF interactions. Figure 2
  shows…"). Lowered to ≥3 rows; genuine ≤4-line captions are still fully skipped
  by the dedicated caption pass. Validated: p03 body freed, captions stay red.
- **REF_PROSE parenthetical.** "Listing 3 (representative of CVE-…, simplified
  for exposition), we place…" — a body sentence — was caption-skipped because "("
  follows the number (ACL p19). REF_PROSE now accepts `(`+lowercase as prose.
  Validated: p19 done 93→98, caption-absorb 0; real "Listing 3:" caption still red.
- Verified correct (no change needed): 5GCVerif p08 Table 4 (prose-filled cells
  correctly red), UC-Scheme p16 + ACL p13 bibliographies untouched, AFC-Diss
  clean, 5GShield table-region fired (p3/p11), ACL long wrapped captions
  correctly absorbed, sequence-diagram labels not damaging figures.
- Regression: npm test 32/32; papers.mjs 7/7 PASS ×3.

### Fix results (2026-06-22)
- **F1 FIXED** — engine tags refs-region spans `data-fx-refs`; `citations.mjs`
  skips annotating them. Validated: A p18 / C p14,p15 / D p15 `cites 31/23/21/53 → 0`.
- **F2 FIXED** — `#classifyBlocks`: a long, prose-dense caption-led block (≥5 rows,
  ≥4 lowercase words/row) is no longer skipped whole (it was a caption merged with
  the body paragraph below); the dedicated caption pass handles just the caption +
  a tighter continuation (cap 6→4 lines, gap 1.5×→1.3×). Validated: A p10 done
  72→170, A p14 67→99, C p08 22→42, C p11 63→70, F p04 71→86 (body now green;
  captions stay red); D p03 caption-absorb 17→2. Visual: A p10 body after the
  Figure 5 caption is green, caption red.
- **F3 FIXED** — table cells with prose (and tall cells' wrapped continuation
  lines) were being processed; their white masks then covered the table RULES and
  made the table unreadable. Fix in `#classifyBlocks`: (a) `line-cells-wide` skips
  a row with ≥4 gaps wider than 2.2× line height (true columns — justification
  never stretches that far) even when a cell holds a phrase; (b) `table-region`
  groups the confirmed table rows into a bounding box and skips EVERY span inside
  it (catching prose cells + wrapped cell continuation lines), so the whole table
  stays on the canvas. Confirmed table rows come only from the `lowerWords<4` cells
  path, so justified prose / prose lists form no region and are untouched.
  Validated on the real case **B p12**: `done 183→91`, table now fully red (no
  masks over the rules), body green. (A p12's earlier "cells" were actually body —
  correctly still green.)
- Regression: `npm test` 32/32, `papers.mjs` 7/7 PASS (proseOk/tableOk/headingClean true).

---
(historical, pre-fix:)
Status: review complete (hybrid: per-page JSON triage across all 99 pages +
targeted visual confirmation of every flagged page). 3 issues found:
**F1** (medium) citation cards on bibliography pages; **F2** (HIGH, systemic)
caption blocks absorb adjacent body paragraphs; **F3** (low/borderline)
table cells with prose-like phrases get processed. Visual-defect dimensions
(baseline/font/mask/idle) are covered by the passing probes (diagnose, baseline,
idle). No other green-on-non-body or missed-body pages found. See `REVIEW_LOG.md`.

## Confirmed issues

### F1 — Citation cards attached to bibliography entries (data-confirmed)
- **Where:** every references page — A p18 (31), C p14/15 (23/21), D p15 (53),
  arXiv p11/12 (20/16): `cites > 0` on pages with `processedDone:0` (the
  bibliography, correctly left unprocessed).
- **What:** `references/citations.mjs` `annotatePage()` runs on all pages and
  `findCitations()` matches each entry's leading `[N]` marker, so it creates a
  hover/click reference-card hit-target over the bibliography's own entry numbers.
  Typography already skips the refs region (`inRefsBox`); citation annotation does
  not. Hovering/clicking a bibliography entry then pops a card for itself.
- **Severity:** medium (intrusive hover popups over the reference list; violates
  "leave the bibliography as the author set it").
- **Proposed fix:** in `citations.mjs`, skip citations whose position falls in the
  references region. Plumb the refs region (already known via
  `ReferencesFeature.onRefsRegion`) into `annotatePage`, and for each candidate
  citation skip creating the hit-target/coloring when the owning span's PDF-y is
  inside `refsBoxes` for that page (mirror the engine's `inRefsBox`). Regression
  guard: `papers.mjs` `refsOk`, and re-capture → cites should be 0 on refs pages.

### F2 — Caption detection over-absorbs body prose (HIGH; SYSTEMIC — confirmed across A,B,C,D,F,arXiv)
- **Status:** confirmed visually on A p10 and C p08 (body paragraph below a figure
  caption tinted red/skipped while the opposite column is green); confirmed by JSON
  triage on the pages below. This is the round-4 "captions absorbing body" class,
  not fully fixed — recurs whenever the caption and the body paragraph land in one
  block (no whitespace gap) so the caption-led block skips the whole thing.
- **Clear `blk-caption`-swallows-body pages** (prose NOT starting "Figure/Table N:"):
  A p10 ("specifications becomes challenging…"), A p14 ("We evaluated each tool…"),
  C p08 ("In addition, we evaluate the feasibility…"), C p11 ("When the server is
  busy serving a burst…"), F p04 ("…culates its location from GPS signals…").
- **`caption-absorb`-swallows-body candidates** (verify each; some are legit caption
  tails): A p15 ("experiment instead of using a new identifier…"), A p16, B p08
  ("Wp-method to find a new CE…"), C p06/p11, D p03/p09, arXiv p04/p09. Plus the
  wrapped body line "Figure 4), and (v) restarting…" (A p15) misread as a caption.
- **Where (origin):** Two-column A p10 and p15 first; now generalized.
- **Evidence (from pNN.json skipByReason):**
  - A p10 `blk-caption ×149` includes body: "specifications becomes challenging. To addre…" — a body paragraph swept into Figure 5's caption block.
  - A p15 `caption`: "Figure 4), and (v) restarting the core netwo…" — a WRAPPED BODY LINE beginning "Figure 4)" misread as a caption leader; `caption-absorb`: "experiment was repeated 10 times, for 24 hou…" — body absorbed as caption continuation.
- **Root causes (engine.mjs `#classifyBlocks`):**
  1. A line starting "Figure N)" / "Figure N," + lowercase matches `CAP_LEAD` but is NOT spared by `REF_PROSE` (its allowed post-number punctuation `[,;.]?` excludes ")"), so it's skipped as a caption. A real caption is "Figure N:" / "Figure N." / "Figure N <Capitalized/standalone>".
  2. The figure-caption block (`blk-caption`) and caption continuation-absorption can extend into adjacent body prose.
- **Proposed fix:**
  - Broaden the running-prose guard so "Figure N)"/"Figure N," followed by lowercase is treated as in-text prose, not a caption (extend `REF_PROSE` punctuation class to include ")" and "," cases, or require captions to be `Figure N[:.]` / `Figure N <Capital>` / standalone).
  - Add a "don't skip as caption if the block/line is long running prose" guard to the caption block + absorption passes (high lowercase-word density ⇒ body), mirroring the existing table running-prose exception.
- **Guard:** `papers.mjs` proseOk + headingClean; re-capture A p10/p15 → the body paragraphs turn green, captions stay red. Check no regression on real captions across the corpus.

### F3 — Table cells with prose-like phrases get processed (LOW/borderline; A p12)
- `sampleDone` on A p12 shows single-word fragments ("Respond","to","protected","messages","before") processed green — a table whose cells contain sentence-like phrases triggers the running-prose exception. May be acceptable (cells with full sentences) or a minor leak. Confirm visually on resume; only fix if it clearly emphasizes tabular data.

### Non-issues noted
- arXiv p14 and p15 captured identical content — a capture-navigation artifact
  (page didn't advance), NOT an extension bug; ignore arXiv p15 in review.

## Unverified candidates from the review workflow (Two-column A) — VERIFY ON RESUME
The workflow flagged these before the session limit aborted its verify pass.
Re-read the screenshots to confirm/refute (the agent's region text was lost when
verify failed; the captured PNG/JSON are on disk):
- A p4  — green-on-nonbody (check: caption/heading/table tinted green?)
- A p8  — green-on-nonbody
- A p12 — green-on-nonbody (two regions)
- A p21 — green-on-nonbody
- A p10 — red-on-body (body paragraph tinted red / wrongly skipped?)
- A p15 — red-on-body
Note: green-on-nonbody flags on heading/caption-heavy pages are often FALSE
positives (a "Figure N shows…" in-text ref sentence IS correctly green; a run-in
heading lead being red with green body is correct). Confirm against TESTING.md §3.

## Candidate observations to check (from capture roll-up, pre-review)

- Two-column C p14/p15 (and similar references pages): `cites` > 0 on pages with
  `done=0` — verify whether citation hit-targets/cards are being attached to the
  **bibliography list entries** themselves (would be unwanted) vs. legitimately 0.
- Pages with `done=0` that are NOT references/figure pages — verify body wasn't
  wholly missed.
- High `blk-caption`/`caption-absorb` counts on some pages — verify caption
  absorption isn't swallowing following body paragraphs.

## Proposed fixes

_(one per confirmed issue: file, rule, change, regression guard)_

## Round 5 — user x-ray report: "overlay in red is not aligned with the glyph" (B p10 §7.3)

The user x-rayed B p10 (DevLyzer §7.3 / Figure 4) and saw doubled red/black text plus black-only
paragraphs. Root causes found and fixed (F9–F12):

### F9 — 30s idle evicts the document FontFaces; overlay drifts silently (overlay.mjs)
- PDF.js `_cleanup` fires 30s after the render queue goes idle and calls
  `pdfDocument.cleanup(false)`, deleting the embedded FontFaces. No font event fires on
  EVICTION, so the engine's `loadingdone → refresh()` never runs; the visible page re-renders
  overlay spans in a substitute face with different metrics — text drifts up-left mid-read and
  stays drifted until something reloads the fonts (scroll to a new page / zoom).
- **Fix:** wrap `pdfDocument.cleanup` on `documentloaded` to always pass `keepLoadedFonts=true`.
  Fonts are tiny next to the canvases (still cleaned); the embedded faces ARE the visible
  document while the overlay is (or later becomes) active.

### F10 — blk-table swallows a paragraph merged with figure labels (engine.mjs)
- B p10 §7.3: the block cutter merged heading + opening paragraph + Figure 4's label rows
  (label heights sit just inside the 0.3 size tolerance). The labels' wide gaps counted as
  table cells (cells=4) and rows=10 pushed the prose-density guard out of reach (lc=32 < 40) →
  whole paragraph skipped as "blk-table".
- **Fix:** `maxCells` now only counts rows with `r.h >= b.h*0.8` — cell gaps must come from
  body-height rows; off-size rows are figure labels / sub- superscript fragments, never cells.

### F11 — caption pass absorbs body after a wrapped "Figure 4." line start (engine.mjs)
- "… as shown in ⏎ Figure 4. To resolve ψ1 …" wraps so "Figure 4." lands at a line start; the
  caption pass took it as a caption lead and absorbed 5 body lines ("caption-absorb").
- **Fix:** veto a caption lead when the line directly above it in the same band is running
  prose at normal leading (≤1.45× pitch), same size (±20%), with ≥3 lowercase words. A real
  caption's upstairs neighbour is figure/table content or a whitespace gap.

### F12 — whole-line aligned pass sweeps opposite-column body rows (engine.mjs)
- In the gutter-split aligned-table pass, `segItems` returned the WHOLE row when the row has no
  gutter-crossing gap — true for a row living entirely in ONE column. A right-column band's run
  extended through left-only §7.1 body lines ("resolve any unresolved deviation…",
  "is considered resolved only if:") and marked them table-aligned.
- **Fix:** when no per-row cut exists, split at `splitX` itself — for an opposite-column row the
  band side is the empty set.

### Also
- `__fxDebug` now records `__fxBlkStats` (blk-table trigger stats) and `__fxAligned` (aligned-run
  seed/band/extent) for future classification debugging.
- The residual fresh-render x-ray fringe is ≤1 css px and exists in the NATIVE PDF.js text layer
  too (extension disabled shows LARGER drift); it is the DOM-text-vs-canvas rasterization floor,
  invisible in normal (masked) reading mode.
- Verified: B p10 done 211→248; §7.3 paragraph + "Figure 4. To resolve…" body processed; real
  caption/figure/tables still skipped. Gates: npm 32/32, papers 7/7, divider sweep 12 papers.

## Round 6 — "fixed in Edge but not Chrome" (F13, real-Chrome verification)

Chrome automation restored: Chrome >=126 exposes CDP `Extensions.loadUnpacked` behind
`--enable-unsafe-extension-debugging` (the replacement for the removed `--load-extension`).
New harness `test/chrome-xray.mjs` launches a side-profile headful Chrome (real display DPI),
loads the unpacked extension over CDP, opens a paper through the DNR redirect, and captures
x-ray / normal / micro-marker shots plus per-span width forensics. (Claude-in-Chrome cannot
script or screenshot another extension's pages — the CDP harness is the way.)

### F13 — Chrome font-load race: stale PDF.js --scale-x compresses every processed span
- In Chrome the text layer lays out BEFORE the embedded FontFace is usable. PDF.js measures
  each span in the css fallback (sans-serif, wider), bakes `--scale-x ~= 0.94`, and never
  re-measures. When the real face applies, the stale scale shrinks its glyphs ~6%: every
  processed word renders compressed, word gaps balloon, canvas ghosts peek around inline
  math ("out" under "out", slivers at line ends) — the user's Chrome-only "text shift".
  Edge has the faces ready at layout time, so identical code never showed it.
- Deceptive part: all DOM rect measurements are self-consistent under the stale scale
  (fallback-rendered pristine box == canvas width by construction), so the engine's width
  pass happily "restored" a width that stuffed the whole stale-scale correction into the
  spaces. Only hidden-clone measurements (same font string, no scale) exposed it.
- **Fix (engine.mjs width pass):** the correction now targets `targetW = item.width ×
  viewport.scale` — the item's true canvas width straight from the PDF geometry, immune to
  any DOM/font race (fallback: pristine rect; skipped on rotated pages). Spans normalize to
  `--scale-x: 1` + em word-spacing against targetW, so glyphs render at natural advances
  (matching the canvas letters) and spaces absorb the justification surplus. Mask horizontal
  extent uses targetW; processing kicks after `document.fonts.ready`.
- Verified in real Chrome 150 at DPR 1.75: forensic sx=1 / ws~0.12em / live==targetW; span
  endpoints pinned to canvas ink (micro-marker capture); normal mode clean; 40s-idle capture
  unchanged (F9 eviction wrapper confirmed working in Chrome). Residual x-ray interior
  wiggle with pinned endpoints = the native justification-distribution floor (same in Edge,
  invisible in masked reading mode).
- Gates re-run after the width/mask change: unit 32/32, papers 7/7, diagnose B whiteout 0
  (peek unchanged), 12-paper divider sweep.

### F14 — negative word-spacing fuses words on tight-glue lines (B p14 §9.6)
- Follow-up to F13 with real-Chrome/Edge side-by-side (chrome-xray now drives BOTH browsers via
  --browser=, --preset enables fx before load, --find= picks the capture anchor): the browsers
  render identically post-F13; the user-visible residue was shared. On a line LaTeX already
  squeezed to minimum inter-word glue ("security policies from specifications. This may,
  however, yield"), the bolding growth made perSpace ~-3px/space and the word-spacing
  correction ate the spaces entirely ("securitypoliciesfromspecifications").
- **Fix:** asymmetric cap — positive perSpace up to 0.45h (justification stretch), negative only
  to -0.1h; bigger shrinks fall through to --scale-x (2-3% narrower glyphs are invisible,
  missing spaces are not).
- Non-bugs confirmed on that page: the serif "5GBaseChecker" in "In contrast, ..." is serif ON
  THE CANVAS (author inconsistency in the PDF, not a classification miss); the stray red
  line-start letters in the user's screenshot did not reproduce at any zoom with current code
  (likely captured pre-reload).
- Gates: unit 32/32, papers 7/7, diagnose B whiteout 0.

### F15 — weight slider dead/empty at most stops in bundled-font modes
- Matrix audit (`test/matrix-fonts.mjs`: 4 font modes x 3 weights x Chrome+Edge; per combo it
  measures width residual vs the PDF item widths, collapsed word-spacing, same-line overlaps,
  and captures a region): geometry was perfect in all 24 combos (residual <= 0.13px, 0 jams,
  0 overlaps), but the bundled faces (Atkinson/Inter/Literata) ship only 400 and 700 weights —
  CSS mapped a 500/600 request onto the 400 face (EMPHASIS VANISHED ENTIRELY) and 800/900 onto
  the plain 700 face (slider dead above bold).
- **Fix (overlay.css + overlay.mjs):** the emphasis ramp uses the nearest real face plus a
  hairline stroke — 500/600 = 400-face + (w-400)/10000em stroke, 700 = true bold,
  800/900 = 700-face + (w-700)/10000em stroke. Stroke is paint-only (no layout impact), and
  original-font mode keeps its existing 400-face + stroke ramp. Verified: computed style per
  combo now ramps monotonically and identically in Chrome and Edge.
- Harness note: Edge's extension service worker sometimes wedges on a fresh profile (no DNR
  redirect); matrix-fonts falls back to navigating the viewer URL directly, which Edge permits.
- Gates: unit 32/32 + naming guard, papers 7/7.

### F16 — align processed text with kept text; keep math sub/superscripts on canvas
User request: processed (overlay) words must sit in the same row as unprocessed (kept)
neighbours, kept glyphs must not be clipped, and math sub/superscripts must not be processed.
- **Sub/superscripts:** candidate filter now rejects spans with item.height < dominant*0.8 AND
  ≤4 trimmed chars — the "out"/"in"/"dev" fragments under γ/S/M stay on the canvas with their
  parent symbol (they become obstacles, so no mask can nick the cluster). Footnote small text
  is unaffected (full-word/line spans). B p10 math clusters are now pixel-crisp canvas.
- **Baseline snap:** at mask-build time (canvas painted; masks are DOM-side so the backing
  store still holds the original glyphs) the engine measures, per font family, the marginTop
  (em) that lands the overlay's predicted ink-top exactly on the canvas ink-top (median of up
  to 10 span samples per family, ±0.15em clamp, families keyed by bare name since the same
  face arrives quoted and unquoted). Off-screen / CSS-stretched / low-res canvases are
  rejected and the old metric formula (ascentRatio − baselineRatio) remains the fallback.
  Residual on B p10: body face 0.41px → 0.07px; f27 0.87 → 0.01. (The old #calibrateBaseline
  attempt failed because it ran at processPage-end where the canvas wasn't readable; running
  at the same point as #detectCanvasRules fixes that.)
- Gates: unit 32/32, papers 7/7, diagnose B whiteout 0 with peek IMPROVED 588 → 467, font
  matrix 12 combos unchanged-perfect, divider sweep.

## Round 7 - footnotes/legal metadata, protect-zone doubling, Libertine baseline (F16-F18)

### F16 - footnotes, copyright/permission blocks, and ACM metadata are now SKIPPED
- New block rules: blk-legal (LEGAL_TEXT markers + smaller-than-body guard), blk-ccs (arrow +
  2 semicolons: the CCS-concepts taxonomy line), blk-footnote (smaller-than-body block in the
  bottom 30% band OPENING with a footnote marker or superscript numeral - all three signals
  required so small-set appendix prose is untouched). Verified on UC-Scheme p1: permission/
  ISBN/DOI block, ACM Reference Format, CCS line, and both author-note footnotes skipped;
  abstract/intro still processed. NOTE: #classifyBlocks now takes vy0 (a missing param threw
  a ReferenceError and silently aborted ALL processing - done=0 pages is the symptom).

### F17 - line above an underlined run-in lead rendered doubled (UC-Scheme P2/P3)
- The protect zone (+-0.35h) around an underlined italic lead overlaps the previous line's
  glyph rect; the mask overlap-clamp cut that line's mask above its own descenders and the
  canvas lower halves peeked out as doubled text. Fix: vertical overlap cuts distinguish THIN
  obstacles (<=5px: canvas rules/underlines - honored exactly, never touched) from TALL ones
  (protect zones/text rects - floored at the span's descender band r2.bottom+0.15h / r2.top-
  0.05h). Doubling gone AND the P2/P3 underlines survive.

### F18 - Libertine-faced papers rendered the whole overlay ~2-4px high
- Two compounding causes: (a) the metric dEm fallback (ascentRatio - baselineRatio) applied to
  SAME-FACE swaps because the family STRINGS differ (quoted vs unquoted) - it is measurement
  noise there (-0.12em on Libertine); now the fallback is 0 unless famKey actually changes.
  (b) the baseline calibration briefly used an in-span marker that returns the span TOP in
  Chrome (all samples rejected); reverted to the pixel-validated prediction
  (r.top + blRatio*rH - actualBoundingBoxAscent). Pixel truth via probe-bl2 (red-vs-black
  column medians): required margin for Libertine f2 is ~0; residual now ~1px (raster floor).
- Gates: unit 32/32, papers 7/7 (bolded counts drop slightly = footnotes no longer bolded),
  dividers A/B/UC/ACL 0 masked, diagnose B whiteout 0.

### F19 - math sub/superscripts kept on canvas
- Candidate filter: a span with height < dominant x 0.8 AND <= 4 trimmed chars ("out"/"in"/
  "dev"/"u" under gamma/S/M/psi) stays on the canvas with its parent symbol (obstacle).
  Verified B p10 x-ray: whole math clusters black. Appendix/footnote prose unaffected.

### F20 - minimum 2x canvas output scale
- overlay.mjs overrides devicePixelRatio (viewer page only) to a minimum of 2: kept-canvas
  tokens rendered coarsely at ~1x zoom on dpr<2 displays (gap/dot artifacts, stray line-end
  dots next to the crisp DOM overlay). Verified B p14 mono tokens crisp at zoom 1.25. The
  sharper canvas also reveals more line-art to #detectCanvasRules (B 153->202 rules,
  masked=0 preserved). Engine reads derive scale from canvas.width/rect.width - unaffected.
- Gates: unit 32/32, papers 7/7, dividers A/B masked=0, diagnose B whiteout=0.

### F21 - the text a sub/superscript attaches to is also kept on canvas
- Candidate filter collects script fragments up front (height < dominant x 0.8, <= 4 chars);
  a candidate with such a fragment adjacent (within 2 PDF units) and vertically offset
  (0.08h..1h) from its own baseline stays on the canvas - the whole expression renders as one.
  Verified on 5GCVerif p4 (NF_C/NF_P) and D p4 Table 1 - not just 5GBaseChecker.
- chrome-xray PAPERS map now covers the full 12-paper corpus.
- HARNESS DEBT: diag-dividers/diagnose false-flag masked/whiteout on D/ACL/5GCVerif since the
  F20 dpr override (their composite sampling assumes the native ratio; the engine derives
  scale from canvas.width/rect.width and is correct). Visual captures contradict the flags.
  TODO: make both samplers scale-derive like the engine, then re-run the 12-paper sweeps.

### F22 - harness debt paid: dividers/diagnose samplers fixed for the 2x canvas
- diag-dividers false-flagged "masked" rules (99% white) because the composite screenshot was
  captured at scale 1 while the F20 override makes the canvas backing 2x CSS: a 2-backing-px
  table rule downscales to ONE antialiased ~lum-150 CSS pixel - too light for the dark
  threshold (140) and often missed entirely by the rounded sample row. Fix: capture the
  composite at the canvas's own backing scale (min(3, W/cssW)) and score each sample as the
  darkest pixel of a 3-px window PERPENDICULAR to the rule (white only if the whole window is
  white). D: was 34 flagged -> rules=109 masked=0. ACL/5GCVerif re-swept clean.
- diagnose whiteout false-flagged kept sub/superscript fragments ("C" of NF_C on 5GCVerif
  p12): a neighbouring word's mask covers most of the tiny RECT while the ink stays intact
  (masks are clamped around kept spans beyond rect arithmetic). Fix: the whiteout probe skips
  fragments (<= 2 chars AND rect < 14px wide). Visual: p12 renders every NF_C cluster whole.

### F23 - front-matter cut ate the other column's first line (5GShield p1)
- The candidate filter skipped everything with y >= contentStart.y - 1 on the Abstract's
  page. In two-column title pages the OTHER column's first body line shares the Abstract
  lead's baseline ("to them. Although 3GPP [18]..." sits level with "Abstract-We present..."),
  so exactly that one line was never processed. Fix: contentStart now carries the Abstract
  line's height and the cut applies only STRICTLY above it (y >= y_abs + 0.6h). The Abstract
  lead line itself stays covered by the run-in/heading classifiers (skip:runin), not by the
  front-matter cut.

### F24 - F21's symmetric window bled onto the NEXT line (UC-Scheme 5.2/5.3)
- The "text a script attaches to" rule used |dy| in (0.08h..1h]: a subscript hanging ~0.3h
  BELOW one line is ~0.9h ABOVE the next line's baseline, so prose lines FOLLOWING a
  subscript-heavy line ("Finally, the user signs all the previous computations..." after a
  List = {H_UID_1, ...} line) lost their processing. Fix: signed asymmetric window - a
  fragment counts as a superscript of the span only 0.08h..0.6h ABOVE its baseline, as a
  subscript only 0.08h..0.45h BELOW it. Real scripts sit ~0.25-0.5h; the next line up/down is
  >= ~1.05h away.

### F25 - table text processed: region tail + neighbour-column swallow (5GShield Table 1)
- Two defects in the table-REGION pass (F3), found from the user's TABLE 1 screenshot:
  (a) TAIL LEAK - a multi-line bottom cell's sub-lines sit BELOW the last gap-qualified row
  and carry only one cell's words, so no row test fires: "Replay protected messages" /
  "Overshadow broadcast messages" rendered processed inside the table. The region bottom now
  CHAINS downward through rows whose in-region slice is not running prose (<4 lowercase
  words, step <= 2.4h); the first prose row ends the chain.
  (b) NEIGHBOUR SWALLOW - region membership tested only the span's START x <= x1+2. Table 1's
  rotated Pre-/Post-conn. edge labels stretch the region to x=313 and the next column's
  wrapped prose lines START at x=315 (inside the +2 slack) - three lines of Sec. 3.2 prose
  lost their processing (the indented first line at x=330 escaped, making it look like a
  "random middle lines" bug). Membership now requires the span's horizontal CENTER inside
  the region; prose running 243 units into the next column is excluded.
- DEBUGGING LESSON: data-fx-why tags are STICKY across re-processing passes (bodyHeight/refs
  arriving re-run classification; dbg does not clear). A why-dump can show a classification
  the FINAL pass never made. Trust a fresh-session DOM probe (data-fx-done + .fx-b count)
  over data-fx-why when they disagree.
- NEW TEST test/tables.mjs - engine-independent oracle: horizontal canvas rules chained
  (>=3 rules, overlap >=70% of the longer, gap <= 15% page height) bound table interiors;
  any span[data-fx-done] centered in a zone fails the run (exit 1). Isolated rule PAIRS are
  ignored - two underlined run-in leads in prose would otherwise flag the paragraph between
  (seen on 5GShield p18). Prose between two STACKED tables can still flag: treat new flags
  as leads, confirm with a capture.

### F25 (cont.) - defense in depth for ruled tables
- Iteration on more corpus leaks (A p20 Table 5, D p10/p11 Tables 5/6) showed per-row TEXT
  heuristics keep losing to ruled tables: rule-separated columns need no whitespace gap
  (blk-table/aligned-gap see 1 cell), wordy cells trip the proseDense veto, and a 2-column
  table's tall-cell sub-lines ("Modify a random byte") have no row structure at all.
- Three layers now cooperate:
  (1) skipAlignedStarts - ruled-GRID tables sign themselves by interior items STARTING at
      the same x across >=4 nearby rows (>=5 when the seed row has only one interior start).
      Bullet/numbered lists (marker rows >=50%) and long-prose-dominated runs are vetoed.
      Feeds tableLines, as does skipAlignedTable now.
  (2) region tail-chain accepts wordy CELL rows: a wordy row ends the chain only when it
      starts at the region's left edge or spans >=75% of the region width (an indented
      paragraph first line under the table still stops it - protecting exactly the
      "first line after a table" class).
  (3) rule-zone guard AT MASK TIME (work(), canvas readable): the tables.mjs oracle applied
      in-engine - horizontal canvas rules chained (>=3, overlap >=0.7 of longer, gap <=15%
      page height) bound zones; any remaining candidate CENTERED in a zone stays pristine on
      the canvas and becomes a mask obstacle (why=table-rules). Full-width lines with >=4
      lowercase words stay processed (prose between stacked framed listings, F p4 / UC p17).
      This is the backstop that makes the invariant hold for table structures we have not
      seen yet.
- ORDERING BUG during the round, worth remembering: a helper (bandExtent) declared AFTER a
  new pass's call site threw "Cannot access before initialization" ONLY on pages where the
  pass found a table - processing aborted (done=0) exactly on table-heavy pages, and the
  0-offender oracle runs on those pages were FALSE GREENS. When a sweep suddenly reports
  clean on pages that should have findings, check done>0 before believing it.

### F26 - body-sized figure labels processed; figure-body sweep + test/figures.mjs
- Figures carry no reliable rules (plots, FSM/protocol/architecture diagrams), and their
  labels can be BODY-SIZED, plain-faced, structureless prose fragments ("Context Encoder",
  "MIB,SIBs", "all traffic" in 5GShield Fig. 2; "Consumer", "producer id" in 5GCVerif
  Fig. 5) - no size/font/row signal, so every existing rule missed them and they rendered
  bolded inside diagrams.
- Engine: FIGURE-BODY SWEEP at classification, line-level (the block-level caption
  absorption cannot cross streams - a full-width figure's caption lives in the full stream,
  its labels in the column streams). In every corpus template the figure sits ABOVE its
  caption: everything between a "Figure N" caption line and the nearest running-prose (or
  caption) line above it, in the caption's column, is figure content (why=fig-body). The
  prose bound absorbs its paragraph's short TAIL lines downward (tight leading, >=2
  lowercase words) so "...within each window." style enders keep their processing; region
  capped at 65% page height. Caption anchors are tested at COLUMN STARTS of the line group
  (a line group merges the caption with the other column's same-baseline text - whole-line
  matching missed 5GShield Fig. 2's caption entirely).
- test/figures.mjs - the same geometry as an engine-independent oracle (exit 1 on a
  processed span centered in a figure region). Lines are grouped PER COLUMN keyed by
  vertical CENTER (kept mono/math spans have different tops and split top-keyed groups,
  which made fragmented prose fail the bound test and flagged whole paragraphs).

## Round 9 (R9) - user-reported issues, verified against a private local corpus
Verification corpus: the public 12-paper set plus a PRIVATE local set served as
file:// URLs with neutral names (rv01..rv28) via the harnesses' generic --url
flag. Nothing about those documents (names, text, provenance) appears in the
repo, per policy.

### R9-1/R9-2 - weight slider 50pt steps (default 650); "None (font only)" emphasis mode
- boldWeight: min 400, max 900, step 50, default 650 (popup + options + DEFAULTS).
  The 400/700-face + hairline-stroke ramp already interpolates any stop.
- emphasisMode "none": emphasizeParts marks nothing bold; spans still process
  (mask + bundled-face swap + width/baseline). With fontMode=original the
  combination is a visual no-op, so #processPage leaves the page PRISTINE
  (no masks, no re-render). Weight row hidden in the popup for mode none.
  Verified: bolds=0 with done>0 in atkinson; done=0 masks=0 in original.

### R9-3 - italic/bold of the ORIGINAL face survives a bundled-font swap
- The bundled faces replaced the embedded one with plain 400 roman: italic
  emphasis flattened. The content pass now checks the original face
  (#isItalicFont/#isBoldFont) when the famKey actually changes and sets
  font-style italic / font-weight 700 (browser synthesizes oblique/bold from
  the 400/700 faces); saved in #pristine, reset on restore. Verified: italic
  processed spans render italic in atkinson mode.

### R9-4 - prose after inline math was left unprocessed
- F21's script-attachment keep dropped the WHOLE span whenever a kept
  sub/superscript fragment hugged its edge. For expression fragments that is
  right ("NF" + "_C"); for a full PROSE span whose first/last token carries
  the script ("...with a batch larger than 2" + "10") it unemphasized entire
  lines after inline math. The keep now applies only to expression-sized
  spans (trimmed length <= 12); prose spans process, their base token is
  redrawn in place by the width correction, and the kept script stays beside
  it as a mask obstacle. Verified on a math-heavy private paper: body pages'
  unprocessed-prose lines went to 0.

### R9-5 - glyph size consistency: white space absorbs the width correction
- The width pass previously sent the ENTIRE correction to --scale-x whenever
  word-spacing wasn't applicable (fewer than 2 spaces, or per-space out of
  caps) - visibly narrower/wider glyphs next to natural ones. Now spaces
  absorb as much as their caps allow (>=1 space qualifies) and only the
  RESIDUAL goes to --scale-x. The negative cap (-0.1h/space) still prevents
  word fusion (B p14 minimum-glue lines).

### R9-6 - "native" button bounced back into the viewer
- file:// PDFs: the button's DNR allow rule cannot suppress the webNavigation
  rewrite that intercepts file: navigations, so the tab bounced straight back
  into FixateScholar. fx-bypass-once now records one-shot bypass URLs in
  chrome.storage.session (survives SW restarts); the webNavigation handler
  consumes them before rewriting.
- http(s): a repeated click within the 30s cleanup window could collide on
  the rule id and throw "does not have a unique ID", silently dropping the
  bypass; removeRuleIds now includes the id being added (safe replace).
- test/native-button.mjs verifies both schemes end-to-end (navigate ->
  intercepted -> bypass -> stays native for 5s).

### R9-7 - ALL-CAPS words are never emphasized
- Acronyms ("NAS", "AMF") read as labels; a bolded prefix is noise. Words of
  >=2 uppercase letters keep uniform weight (unit-tested); Capitalized words
  and single letters keep their emphasis.

### R9-8 - citations lost their coloring after async re-processing
- setRefsRegion/setContentStart/setBodyHeight re-process rendered pages;
  restore wipes the .fx-cite-c coloring wraps with the rest of the span DOM,
  and nothing re-annotated - pages annotated before the async reference
  extraction finished lost citation colors for good ("some citations are not
  colored"). overlay.mjs now chains references.reannotateRendered() after
  each of those engine re-processing entry points. test/citecolor.mjs walks
  a document and asserts every [N] citation inside a processed span carries
  a coloring wrap.

## Round 10 (R10) - full private-corpus sweep (28 papers, 4 oracles + screenshots)
A combined per-page sweep (unprocessed prose, table zones, figure interiors,
citation coloring; screenshot of every flagged page) over the entire private
local corpus. Most flags were intentional keeps (bibliography pages, URL/DOI
lines, title front matter, bold run-in/bullet leads, displayed equations,
form-grid PDFs). Three real defects found and fixed:

### R10-1 - subfigure captions processed (figure-body sweep bound)
- Side-by-side "(a)/(b)/(c)" subcaption rows join into one wide wordy line
  that qualified as the sweep's PROSE BOUND, cutting the figure region short:
  the subcaptions themselves and axis titles above them rendered bolded.
  Their WRAP rows (which don't start with the marker) did the same. Fix: a
  row belonging to a subcaption BLOCK - a tight chain of rows leading up to a
  "(a) "-marker row that is narrower than the region or gap-split - never
  bounds the region. An in-prose "(a)" enumeration line fills the column
  solid and still bounds.

### R10-2 - only the FIRST caption on a merged baseline anchored
- A left-column "Figure N:" and a right-column "Figure M:" caption often
  share one merged line group; the anchor loop broke after the first matching
  column segment, so the second figure never got a region (its axis title
  rendered bolded). Every matching segment now anchors its own region.

### R10-3 - loadingdone refresh was O(pages²): long papers flashed native
- Every newly scrolled-to page loads its own font subsets and fires
  `loadingdone`; the handler restored + reprocessed ALL rendered pages each
  time. Walking a 15-page paper, later pages sat restored (native text, no
  emphasis) for many seconds at a time - the sweep read entire pages as
  unprocessed, and a sequential READER sees the same flicker/jank. Fix:
  engine.refreshFonts(families) re-processes only pages whose processed spans
  USE a newly loaded face (per-page famKey sets recorded at process time);
  the eviction/re-decode repair behavior is preserved (affected pages still
  refresh; unknown face lists fall back to a full refresh).

### R10-4 - fx-on EXPOSED a hidden text layer (invisible render mode / duplicate layer)
- One corpus paper carries a full invisible text layer (spec excerpts) interleaved with and
  overlapping the printed prose. The canvas never paints it, but the TEXT LAYER carries it;
  processing those spans re-rendered them VISIBLY on top of the real content (fx-off page
  clean, fx-on page garbled). Two vetoes at mask-build time (canvas readable):
  (a) INK CHECK - if the canvas has no ink under a candidate's pristine rect (sampled in the
      rect's CORE band, middle 40% of the height, so neighbours' ascenders/descenders don't
      count; threshold 2% dark), the span is invisible in the original: leave it pristine, no
      mask, no obstacle. Disabled when the whole canvas reads blank (unpainted prefetch).
  (b) MUTUAL-OVERLAP VETO - two CANDIDATES covering the same pixels (a hidden line printed ON
      TOP of or STRADDLING visible lines - there IS ink there, so (a) passes) are both left
      on the canvas; threshold 0.3 of the smaller box (a straddler overlaps each neighbour
      ~35-45% of itself; genuinely adjacent lines' boxes overlap <=15% at tight leading).
      Overlapped REAL lines lose emphasis but render exactly as the document does.
- Verified: the affected page now renders identical to fx-off (hidden layer suppressed);
  papers.mjs 7/7, skipline/figures/tables regressions clean.

## Round 11 (R11) - hidden layer must not steal the VISIBLE text's processing (user report)
R10-4's mutual-overlap veto left BOTH spans of an overlapping pair on the
canvas, so on the hidden-layer paper every printed line the invisible layer
overlapped lost its typography ("renders identical to fx-off" was the wrong
goal - the main text layer must still be processed per the rules). The veto
is now a RESOLUTION, plus three defects found while verifying it:

### R11-1 - overlap pairs are resolved by INK FIT, not vetoed wholesale
- The canvas ink belongs to exactly one of the two overlapping spans, and a
  per-rect ink-fit score tells them apart: solid x-height CORE band + quiet
  extreme edge bands (top/bottom 10%) + ink columns spanning the rect
  (extent penalty). A printed line scores ~1; a hidden straddler (hollow or
  half-filled core, neighbours' ink through its edge bands, ink extent short
  of its full-column rect) scores <=0. Decisive winner (>=0.5 and >=loser+0.35)
  is processed normally; the loser is judged hidden: pristine, invisible, and
  NOT an obstacle (its pixels are the winner's, which the winner's mask must
  cover). Ties (exact duplicate runs) keep the conservative both-stay-canvas
  veto. Rule-like rows (near-solid dark runs: underlines, box edges) are
  excluded from the band metrics so an underlined span isn't misread as
  "ink through the bottom edge".

### R11-2 - KEPT spans of the hidden layer shadowed real lines via obstacles
- Hidden math/heading lines never reach the resolver - the candidate filters
  (math faces, no-Latin, size cuts) route them into the KEEP set, whose rects
  become mask obstacles unconditionally. An INVISIBLE obstacle overlapping a
  printed line >=35% silently skipped it (three body lines on the affected
  page, incl. an underlined run-in's line). Kept spans now join the ink-fit
  resolution (pairs vs candidates only; overlap must also cover >=25% of the
  candidate so a tiny inline-math fragment can't judge its own host line):
  a kept span that decisively LOSES has its obstacle suppressed; a candidate
  that loses to a kept span is a hidden duplicate and drops. Line-sized kept
  spans additionally pass a standalone ink-fit gate (lesser-edge-band rule)
  before becoming obstacles at all. SMALL kept spans (script fragments,
  markers - a superscript legitimately fills its tiny rect edge-to-edge) are
  exempt from the fit judgment: without their obstacles the neighbours'
  masks white them out (a footnote marker vanished until exempted).

### R11-3 - ink decisions read a resolution-capped canvas (zoom-dependent misjudgments)
- PDF.js caps large page canvases (maxCanvasPixels / canvas-area limits): at
  higher zooms the BASE canvas's outputScale drops below 1x CSS and a
  full-resolution DETAIL canvas is painted over the visible area only. All
  ink metrics read pageView.canvas - at 0.92x backing, tight leading bleeds
  neighbours' ink into a line's edge rows and the fit scores turn to noise:
  the same page resolved cleanly at one zoom and mass-vetoed lines at
  another. Three-part fix: (a) reads pick the SHARPEST canvas covering each
  rect (detail canvas preferred when finished and >=1.2x sharper); (b) work()
  waits (capped, cancellable) for the page's canvas render - and any detail
  render - to reach FINISHED before reading pixels (a font-settle refresh
  could read a mid-paint canvas); (c) any veto/tie/loss decided from a
  capped-resolution read (csy < 1.5) marks the page, and a `pagerendered`
  event with isDetailView re-processes it ONCE with sharp pixels
  (engine.onDetailRendered, wired in overlay.mjs). Decisions stay
  conservative in the interim (content always correct - at worst a few
  lines transiently unemphasized until the detail render lands).

### R11-4 - slashed word-pair prose swallowed by the URL-continuation rule
- A space-free span containing "/" was always treated as a wrapped URL
  continuation and left whole. A short wrapped line consisting of exactly
  two plain words around one slash ("and/or", "read/write", an
  "input/output."-style line ender) is prose and is now emphasized;
  fragments with digits, multiple slashes, or URL characters keep the null.

- Verified: on the hidden-layer paper's worst page, processed spans went
  117 -> 159 with the hidden layer still fully suppressed (every hidden line
  classified `dup-hidden`/`no-ink`; screenshots show bold leads on all
  printed prose, subcaptions/figures untouched, footnote superscripts
  intact). Full re-sweep of that paper: every remaining flag is the hidden
  layer itself, front matter, refs pages, a URL line, or a display formula;
  citations n/n on all pages. Regression: units 34/34 + naming guard,
  papers.mjs 7/7 PASS, tables (D) and figures (5GShield) oracles 0
  offenders, skipline (B) 0, citecolor 15/15, stylemodes all-green; private
  long-paper walk clean (page-range re-checks show walk-only flags were
  timing artifacts), both R10 figure-fix pages still 0 offenders.
- Debug: `__fxOverlap` (gated on `__fxDebug`) records every judged pair
  {a, b, fa, fb, ra, rb} with per-span fit internals {score, core, edges,
  edgeMin, pen, fc, lc, n, lr}; `data-fx-why` gains `dup-hidden`.

## Round 12 (R12) - review-draft template rendered a whole paper unprocessable (user report)
A private-corpus SUBMISSION DRAFT (margin line numbers on every line, both
sides; diagonal background watermark; anonymized ACM template) processed
NOTHING - done=0 on every page, no errors thrown.

### R12-1 - margin line numbers glued every page into one giant "table"
- The numbering gutters put a tiny pure-digit item on EVERY baseline at a
  constant x in both outer margins. To every table heuristic that is a
  phantom first column: each row gains an extra "cell" (blk-table cells>=3
  fired on 40-row blocks whose lowercase count the figure rows diluted
  below the prose exception), and the body text's constant start-x became
  an aligned-interior-starts band spanning the ENTIRE page (n=33..69 row
  runs in the gutter x-bands), so the table-region pass built one region
  from y=75 to y=700 covering 170 lines - the whole page, every page.
  Diagnostic signature in the debug globals: ALIGNED bands whose x-range
  sits at a page edge with run counts near the page's line count, and a
  REGION whose n ~ all lines on the page, with done=0 and NO exceptions.
- Fix in #classifyBlocks, before line grouping: a column of >=10 pure-digit
  (1-4 chars) items on >=10 distinct baselines, clustered in a narrow
  x-band (2.5% of page width) whose centers sit in the outer 12% of the
  page, is a LINE-NUMBER GUTTER - margin furniture. Those items are
  excluded from classification geometry entirely (lines/blocks/aligned/
  region passes never see them) and stay on the canvas untouched: they are
  already non-candidates via the no-Latin filter, exactly like page
  numbers. Normal papers are unaffected (a page number is one digit item
  on ONE baseline; in-table row-number columns sit in the interior 76%).
- Also observed, working as intended: the draft's diagonal background
  watermark (two large rotated kept spans) loses every ink-fit pair
  against the printed lines it crosses (R11 resolver: ~0.03 vs ~0.99), so
  its obstacles are suppressed and the body processes; the masks of
  processed lines erase the watermark strokes that cross them (the ink
  between lines survives, and fx-off is untouched). The bold horizontal
  draft notice near the page bottom is the DOCUMENT's own rendering,
  identical fx-on/fx-off.
- Verified: worst page 0 -> 127 processed spans; full-paper sweep clean on
  all pages (the only flags are bibliography entries and one kept math
  row), citations n/n on every page incl. 28/28 on the densest refs page;
  front matter, line numbers, and figures untouched in screenshots.
  Regression: units 34/34 + naming guard, papers.mjs 7/7 PASS, tables (D)
  and figures (5GShield) oracles 0 offenders, skipline (B) 0, and the
  R11 hidden-layer page still resolves identically (159 done, no ties).

## Round 13 (R13) - citations jumping to the bibliography / cards missing cited entries (user report)
Two user-visible symptoms, one shared root plus three distinct defects,
found via a new citation-behavior audit (test/citeaudit.mjs) that checks
every numeric citation for (a) an ACTIVE native link overlapping it (a
click would scroll to the bibliography), (b) a missing hit-target, and
(c) cited numbers absent from the parsed bibliography.

### R13-1 - the diagonal watermark TRUNCATED reference extraction
- findReferencesBody stops at any heading-sized line (>= 0.9x the
  References heading, >= 1.15x the entries). A review draft's ROTATED
  watermark line lands mid-bibliography in extraction reading order with
  a giant line height, so the body cut off at the first entry the
  watermark interleaved with: one corpus paper parsed 18 of 62 entries.
  Every citation to [19..62] was unresolved -> colored but NO hit-target
  -> the PDF's own link stayed active and clicking scrolled to the
  bibliography (symptom a); multi-citations showed only their resolved
  subset (symptom b). Fix in extractor.mjs: drop rotated text items
  (|transform skew| > ~5 degrees of the scale) - diagonal/vertical
  watermarks and sideways labels are never reading content. Also drop
  review-draft line-number gutters there (same detection as the
  typography engine's R12 filter): the numbers otherwise prefix entry
  lines ("1394 [1] ...") and pollute grouping. 62/62 entries parse now.

### R13-2 - citations with a LOCATOR never matched: "[9, §5.2.2.1]"
- NUMERIC_CITE only accepted pure number lists, so spec-style citations
  with a pinpoint locator - "[9, §5.2.2.1]", "[24, Section 5.2]",
  "[26, Lemma 1]", "[58, §4.2]" - were not citations at all: no color,
  no card, native link live (jump to bibliography). The regex now
  consumes one trailing locator (starting with §/¶/p./pp. or a capital
  word, so prose brackets like "[9, and beyond]" stay untouched); only
  the leading number list resolves, the whole bracket is the hit-target.

### R13-3 - real but SHORT numbered entries were dropped
- buildEntry's raw.length > 20 gate (meant to kill stray fragments in
  the marker-less indent/year grouping mode) also dropped genuine terse
  numbered entries ("[7] RFC 9110, page 106." is exactly 20 chars after
  the marker) - three entries on one corpus paper, whose citations then
  had no cards. A NUMBERED entry now passes regardless of length; the
  gate still applies to marker-less grouping.

### R13-4 - unresolved keys silently vanished from cards and kept native links live
- resolveCitation dropped unresolved keys, so a multi-citation's card
  paged through fewer entries than the text cites, and a fully
  unresolved citation got no hit-target at all (the native link then
  scrolls to the bibliography - the exact behavior the card exists to
  replace). annotatePage now builds ONE CARD PER CITED KEY in reading
  order: the resolved entry, or a stub for a numeric key the extractor
  missed ("Reference [N] could not be read from this document's
  bibliography", no Scholar fetch, no actions). Every numeric citation
  therefore always has a hit-target and reconcileLinks always
  neutralises the PDF's own link. Genuine papers citing beyond their own
  bibliography (one corpus paper cites [25..30] with only 24 entries -
  confirmed absent from the document text) degrade to honest stubs.
- Verified: on the watermarked review draft, jumpCites 93 -> 0 and
  unresolved 109 -> 0 across all pages; the other two investigated
  papers audit clean (one with 6 stubs for its genuinely-missing
  entries). Public regression: units 36/36 (+2 new parser tests),
  papers.mjs 7/7 PASS (refs/cites counts unchanged), citecolor 82/82,
  109/109, 74/74 on three templates. Corpus-wide citeaudit sweep run
  across all private papers.

### R13 addendum - three more extraction truncations found by the corpus-wide audit
- The corpus-wide citeaudit run exposed the same truncation CLASS beyond
  the watermark: (a) RUNNING FOOTERS and bare PAGE NUMBERS ("Page N of
  M", "13") interleave the bibliography in extraction reading order and
  are heading-sized, tripping the next-section cutoff (worst papers
  parsed 4/58 and 1/35 entries; one recovered from 43 to 125); the
  extractor now drops SHORT (<45 char) lines in the outer 6% vertical
  bands - the engine's margins rule, mirrored - while a real entry line
  landing in the band on a dense page is column-width and survives
  (verified: a public paper's mid-band entry stays, its parse intact);
  (b) a LONE OVERSIZED GLYPH (a quotation mark split onto its own
  extraction line by the font-size line rule) ended one bibliography -
  the size cutoff now also requires >=2 chars including a letter/digit;
  (c) bracketed MATH ("[2, 1, 0]", "[0]") matched the citation pattern -
  bibliographies number from [1], so lists containing 0 are rejected.
- Final corpus state: every paper audits jumpCites=0 and 0 missing
  hit-targets; unresolved remains only where a paper genuinely cites
  beyond its own bibliography (stub cards). Six papers' reference lists
  recovered in full. Public regression re-verified: units 38/38,
  papers.mjs 7/7 (a shifted `bolded` total on one template was chased
  down to the harness's rendered-page snapshot, per-page counts
  identical under both code states - see TESTING "Harness metric
  traps"), citecolor 82/82.

## Round 14 (R14) - highlight annotations: visibility on processed text, save-to-PDF, cross-mode mirroring (user request)
Requested: verify PDF.js text highlights (a) work and save with the file,
(b) show on PROCESSED text the same as on the original, and (c) a
highlight made on processed text also appears on the original. Two real
defects:

### R14-1 - the white mask hid highlights on processed text
- The fx mask layer was a sibling ABOVE the whole .canvasWrapper, so a
  highlight (drawn by PDF.js into an SVG inside .canvasWrapper) rendered
  UNDER the opaque white mask and was invisible in reading mode. Fix:
  insert the mask INSIDE .canvasWrapper, after the page/detail canvases
  and before the highlight draw SVGs (which PDF.js appends at the end).
  Now the highlight's mix-blend-mode:multiply paints over the white mask
  exactly as over paper (overlay text still on top via the text layer),
  while every canvas stays hidden under the mask. canvasWrapper and the
  text layer share the page box, so mask-rect coordinates are unchanged;
  papers.mjs 7/7 and diag-dividers masked=0 confirm masking intact.
- Save + mirroring were already correct once visible: highlights are
  document-level annotations in annotationStorage, untouched by fx
  toggling (which only restores/reprocesses text-layer spans and masks),
  so a highlight made in either mode persists across toggles and mirrors
  onto the original text on fx-off. saveDocument emits /Highlight +
  /QuadPoints and the annotation survives save+reload.

### R14-2 - citation hit-targets blocked starting a highlight over a citation
- The citation hit-target overlay (.fx-cite-hit, inline
  pointer-events:auto) intercepts the pointerdown, so the highlight
  editor - which builds a highlight from a text-layer selection - never
  saw drags that started over a citation (highlighting a line with a
  citation silently did nothing). Fix: overlay.mjs listens for
  annotationeditormodechanged and toggles .fx-editing on #viewerContainer;
  CSS sets .fx-editing .fx-cite-hit { pointer-events: none !important }
  (the !important is required to beat the element's inline style). Plain
  text selection/copy was never blocked (Chromium still selects the text
  beneath the empty overlay); only the editor's own pointerdown listener
  needed the events to pass through.
- Verified by test/highlights.mjs: creates a highlight (retried — synthetic
  drags are ~2/3 reliable, real pointer input is not), asserts the mask
  precedes the highlight SVG in .canvasWrapper, asserts /Highlight +
  /QuadPoints in the saved bytes and one Highlight after reload, and
  asserts .fx-cite-hit computes pointer-events:none while editing.

## Round 16 (R16) - drag-selection stopped at bold prefixes; emphasis vanished inside the selection (user report)

User: "when I try to select the text in fx mode, the bolded and unbolded text
seems in different layer, I can only select the bolded part of a word. Also,
under selection, the bolded text become not bolded."

Two independent root causes; both reproduced live and fixed.

### R16-1 - PDF.js parks its .endOfContent INSIDE a text span, mid-word
- On every selectionchange during a drag, TextLayerBuilder walks the selection
  edge up from its text node and relocates the .endOfContent div - sized to the
  WHOLE text layer and forced to user-select:text - next to that anchor. It
  normalizes exactly ONE level, plus one more for its own
  <span class="highlight"> wrapper: that special case is proof the code requires
  the anchor to be a direct child of the .textLayer.
- Reading mode nests too (<b class="fx-b"> emphasis; .fx-cite-c/.fx-ref-c
  citation wrappers), so an edge inside a bold prefix makes anchor.parentElement
  the text SPAN, and the layer-sized div lands in the middle of a word. Measured
  on arXiv 1706.03762 mid-drag: parent SPAN, previousSibling "prop",
  nextSibling "ose" - spliced into "propose", exactly at the bold boundary.
  A synthetic repro showed it then wins every hit-test over that span
  (x=2..102px returned DIV.endOfContent instead of B.fx-b / SPAN), so the drag
  cannot reach the rest of the line: selection sticks at the bold prefix and the
  copy loses the non-bold tails. Latent upstream PDF.js bug that fx mode makes
  routine; worth reporting to mozilla/pdf.js.
- Fix: patch 5 in scripts/fetch-pdfjs.mjs replaces the .highlight-only hop with
  a loop that climbs out of ANY wrapper until anchor.parentElement is the
  .textLayer (a superset of the stock behaviour, so PDF.js's own find-match case
  still works). extension/vendor/ is gitignored, so the patch script is the only
  thing that ships this - editing the vendored copy alone is NOT enough.
- Defensive: engine.mjs evictEndOfContent() hoists any .endOfContent found
  inside a span back to the layer before the content pass's replaceChildren and
  before #restorePage's `span.innerHTML = orig.html`. Without it, a mislocated
  div would be DESTROYED while PDF.js still held it in its #textLayers map,
  breaking selection on that page even after toggling fx off.

### R16-2 - -webkit-text-stroke emphasis is dropped when Chrome paints selected text
- Default settings emphasize with a hairline -webkit-text-stroke (fontMode
  "original", boldWeight 650), deliberately, because embedded PDF faces rarely
  ship a bold and synthetic bold is one heavy weight that also changes advances.
  But Chrome resolves selected text's paint from the ::selection highlight style
  and falls back to INITIAL values for anything absent there, so
  -webkit-text-stroke-width resolved to 0 and every emphasized prefix rendered
  at plain weight inside a selection.
- Re-declaring the stroke in ::selection does NOT help - verified with both the
  shorthand and the -webkit-text-stroke-width/-color longhands; Blink's
  selection paint path ignores text-stroke outright. Real font-weight:700 does
  survive selection, but it changes glyph advances (would break the width
  calibration and collapse the 500-900 ramp).
- Fix: emphasize with a 4-direction text-shadow at half the old stroke width (a
  centred stroke of width W thickens a glyph by W/2 per side; an axis-aligned
  shadow at offset D thickens by D). text-shadow IS honoured in ::selection and
  is paint-only, so targetW / word-spacing / --scale-x are unaffected.
  overlay.mjs emits --fx-shadow and --fx-stack-shadow from the weight slider;
  overlay.css carries matching .fx-b::selection rules that MUST keep repeating
  the shadow. Do not revert to text-stroke.

### Verification
- npm test 38/38. scripts/fetch-pdfjs.mjs applies all 5 patches against a
  pristine 6.0.227 extract (hash-verified), so patch 5's anchor is valid.
- test/diag-drag.mjs is now a pass/fail guard: it samples endOfContent placement
  MID-DRAG (PDF.js's pointerup reset() puts it back, which hides the bug),
  asserts every fully-covered span's text is in the selection, that the copy
  event carries it, and that emphasis uses a ::selection-honoured property.
  PASS on arXiv + Two-column B; FAILS with patch 5 reverted (negative control),
  reporting the "prop"/"ose" splice above.
- papers.mjs 7/7, search.mjs, highlights.mjs, diag-select-cite.mjs all PASS.
- matrix-fonts.mjs (Two-column B p14, 4 font modes x weights 500/700/900):
  0 jams, 0 overlaps, width residual median 0.01px / max 0.3px, text-stroke now
  0px in every combo - confirming the swap is layout-neutral.
- PRE-EXISTING, unrelated: test/stylemodes.mjs throws
  "Cannot read properties of undefined (reading 'textLayer')" - it reads
  getPageView(PAGE-1).textLayer.div without waiting for the page view. Fails
  identically on unmodified main (verified by stashing). matrix-fonts.mjs covers
  the same font x weight matrix.

## Round 17 (R17) - italic body prose rendered UPRIGHT in the bundled reading fonts

ITALIC_FONT missed the two most common LaTeX italic TEXT faces, so under a
bundled reading font (atkinson/inter/literata) engine.mjs swapped the face
without re-applying `fontStyle: "italic"` - italic prose came out roman.
Original-font mode was never affected (no face change, so that branch is skipped
by design). Two independent gaps, both a case of a face-name spelling the regex
could not reach:
- `cmti` was lowercase-only, but LaTeX Type1 subset names are conventionally
  UPPERCASE (`ABCDEF+CMTI10`). SPECIAL_FONT already listed BOTH cases for its
  math faces, so the hazard was known; ITALIC_FONT never got the uppercase
  forms. Confirmed uppercase in the wild on arXiv quant-ph/9508027 (CMTI8/9/10)
  and math/0211159 (CMTI12, CMR12, CMMI12).
- `-It(?![a-z])` could not match `-Ital` (the lookahead rejects the following
  `a`) - and the real URW Nimbus name has no hyphen there at all:
  `NimbusRomNo9L-ReguItal` / `-MediItal`. URW Nimbus Roman is the standard
  LaTeX Times clone, the same family both corpus papers use for Regu/Medi.
- Fix: `Ital(?![a-z])` (covers `-Ital`, `ReguItal`, `MediItal`) plus `CMTI|CMMI`
  next to the existing `cmti|cmmi`, keeping the dual-case listing style of
  SPECIAL_FONT. `-It(?![a-z])` stays for bare `-It`; an upright face merely
  starting "Ital" (`Italiana-Regular`) still does not match.

### Verification
- Neither corpus paper has an italic TEXT face, so test/stylemodes.mjs reported
  `n/a` on both. Reproduced on a private-corpus paper set in Nimbus
  (`NimbusRomNo9L-ReguItal` body italics): with the oracle corrected and the
  engine unpatched, p4 gave `italicItems=43 italicProcessed=19
  italicProcessedRendered=0` -> `italicPreserved=false`. After the fix: 17/17
  italic (p4) and 13/13 (p6).
- Public repros of both halves: `stylemodes.mjs
  https://arxiv.org/pdf/quant-ph/9508027 2` (CMTI, 3/3) and `stylemodes.mjs
  https://arxiv.org/pdf/1207.0580 3` (NimbusRomNo9L-ReguItal, 1/1).
- Run-in-lead skip path (the other isItalic consumer): papers.mjs 7/7 twice.
  The widening does newly engage `skipItalicLead` on Nimbus-italic papers - on
  a private paper's p4 two spans moved from processed to skipped, both italic
  NUMBERED SUBSECTION LEADS ending in a colon ("N) Title of the subsection:"),
  which is exactly what that rule is for.
- npm test 42/42, including the new test/unit/fontclass.test.mjs face-name
  tables (ITALIC_FONT and SPECIAL_FONT are exported for it). A missed face
  neither throws nor fails a corpus check - it just renders wrong - so the
  tables are the guard against the next case/spelling variant.

### Same class of gap, fixed separately in R18
Two more names, found while building those tables; both would newly EXCLUDE
spans from processing/emphasis - a different behavior change than the italic
fix, so they were validated on their own. See R18.

## Round 18 (R18) - typewriter and small-caps text emphasized as body prose

Follow-up to R17: the same "a face name the alternatives cannot spell" hazard,
this time in SPECIAL_FONT / BOLD_FONT. Faces listed there are meant to be left
on the canvas (intentional special typography); a name that slips through is
emphasized as ordinary body prose.
- `NimbusMonL-Regu` - URW Nimbus Mono, the standard LaTeX Courier clone. The
  monospace alternative was `Mono(?![a-z])`, and "MonL" contains no "Mono", so
  typewriter text (code, identifiers, URLs) in it was body text. Now
  `Mon[oL](?![a-z])`, which also picks up `NimbusMonL-Bold` /
  `NimbusMonL-ReguObli` and still rejects Montserrat / MonaSans /
  Monotype-Corsiva, plus the sibling Nimbus TEXT faces that share the
  short-suffix shape (`NimbusSanL-Regu`, `NimbusRomNo9L-Regu`).
- `CMBX` and `CMCSC` in UPPERCASE Type1 subset names (`ABCDEF+CMBX12`,
  `ABCDEF+CMCSC10`) - the bold and small-caps alternatives listed only
  lowercase `cmbx` / `cmcsc`. BOLD_FONT had the same bold gap, so CM bold was
  invisible to the unlabelled run-in heading detector too. Both cases are now
  listed for every CM alternative, and the two bold lines (SPECIAL_FONT's and
  BOLD_FONT's) must stay identical. `CMTT` needs no entry: `TT(?=[0-9-])`
  already reaches it.
- Finished the same symmetry on the math line while there (`cmbsy`, `msam`,
  `msbm` next to the uppercase forms). Those faces are math-only, so a
  lowercase-naming toolchain was the only way to hit them, and the corpus
  cannot exercise the aliases at all - it names them in uppercase.

### Verification
Both halves were confirmed by NEGATIVE CONTROL - reverting the single
alternation and re-probing the same page, reporting each matching item's
processed flag, .fx-b count and skip reason:
- Monospace, on a private paper that sets protocol identifiers and message names
  in NimbusMonL (typewriter runs inside body prose, table cells and figure
  labels): p3 24 of 55 matching items processed / 19 EMPHASIZED before, 0 / 0
  after; p8 25 processed / 9 emphasized before, 0 / 0 after.
- Small caps, on arXiv quant-ph/9508027 p26 (bibliography author names set in
  CMCSC10): 14 of 54 processed and emphasized before, 0 after - they now take
  the `runin` (skipHeadingRun) path, i.e. BOLD_FONT/SPECIAL_FONT finally see
  them.
- CM bold NUMBERED headings were already skipped before the fix by the
  font-independent `line-head` path (quant-ph/9508027 p5 "2 Quantum
  computation" - identical before and after), so the CMBX win shows up in
  run-in / bibliography contexts rather than in section headings.
- arXiv 1207.0580 EMBEDS NimbusMonL-Regu but no page's text uses it (0 items),
  so despite being a public paper it is not a usable repro for this half.
- papers.mjs 7/7. On the corpus the only CMBX/CMCSC/MonL items are 5 table
  numerals on arXiv 1706.03762 p8, already skipped as `line-cells`, so corpus
  output is unchanged. On the private Nimbus paper p4, processed spans go
  205 -> 184 (the typewriter runs), while stylemodes.mjs still reports
  `italicPreserved=true` 17/17 and 882 emphasized prefixes - body prose is
  untouched.
- npm test 44/44; test/unit/fontclass.test.mjs now asserts the fixed names, a
  near-miss table for `Mon[oL]`, and BOLD_FONT directly (it is exported for
  the test alongside SPECIAL_FONT / ITALIC_FONT).

## Round 19 (R19) - single-column math paper: prose swept as tables, bibliography emphasized (user report)

User, on a Computer Modern journal-template paper added to the corpus (Shor,
arXiv quant-ph/9508027): "some of the references get processed but some of the
main texts are not processed." Two independent causes, both template-shaped:
nothing about them is specific to this paper.

### R19-1 - a paragraph broken by DISPLAYED EQUATIONS read as a table
TeX sets display math in math faces, cuts it into many small items, leaves wide
gaps around relation/operator symbols, aligns a multi-line derivation on that
symbol row after row, and puts the equation TAG at the right margin. That is
exactly what all three table passes look for - a cell gap (`maxCells`), a shared
gap-x (`skipAlignedTable`), aligned interior starts (`skipAlignedStarts`) - so
paragraphs interleaved with equations were classified `blk-table` /
`table-starts` / `table-aligned` / `table-region` and their PROSE lines were
skipped to the canvas. Pages ran 16-43% processed; whole arguments were left
unemphasized ("It would be sufficient to observe solely the value…").
- Fix: `isDisplayMathRow` - a row with no prose word whose characters are ≥25%
  math-faced (new MATH_FONT, the math line of SPECIAL_FONT, exported with it) is
  invisible to the table passes: no cell tally, no gap band, no start seeds.
  This is the same principle already applied to off-size rows ("figure labels
  are never table cells").
- Two traps in "no prose word": `\exp`, `\log`, `\cos` … are set as upright
  lowercase words INSIDE the equation, and LOWER_WORD accepts 2-letter tokens,
  so juxtaposed variables ("rc", "br", "bT" in `T = rc + d − r{c(p−1)}q, (6.8)`)
  counted as prose. Hence MATH_OP plus a 3+-letter PROSE_WORD for this test
  only. Without the first, the (6.7)/(6.8)/(6.9) tag column still formed a run;
  without the second, the derivation rows still did.
- `proseDense` counts its ≥4-lowercase-words-per-row average over the same
  prose-carrying rows: the equation rows spent whole lines on math and dragged
  the average under the bar (p17: 20 rows, lc=78, needed 80 — off by two words).
- `skipAlignedTable` also gained a straddle test: running prose reaching ACROSS
  the band ends the run even when a word gap lands inside it. The band-coverage
  comment already intended this, but `smallHit` took priority, so prose lines
  between a math paragraph's inline-fraction fragments were absorbed. A
  prose-cell table is unaffected - its wordy cell sits INSIDE a column
  (`oneSide`), it does not straddle the boundary.

### R19-2 - the bibliography ended at the first page break
`findReferencesBody` stops at a heading-SIZED line. A journal template prints a
running head and page number on every page - including the bibliography's
continuation pages - at BODY size, while the bibliography is set smaller (here
10 vs 8). The next page's "26" / "P. W. SHOR" therefore read as a new section:
the body stopped after page 25 (26 lines, 9 entries), the refs region covered
only that page, and pages 26-28 of references were emphasized as body prose -
which is exactly what the user saw. Conference templates print no running head,
so the corpus never showed it.
- Fix: `runningHeadTexts` collects page furniture - a bare page number, or a
  short line whose text (page number aside) repeats on ≥3 pages - and the body
  loop steps OVER those lines instead of breaking on them. Result: body 26 →
  150 lines, entries 9 → 64 (the true count), region covers p25-p28.

### Verification
- Prose sweep over every content page (p2-p24), listing unprocessed spans with
  ≥3 lowercase words and their skip reason: **zero body prose lost**. The only
  remaining ones are policy - two table/figure captions, and the section
  headings "Reversible logic and modular exponentiation" / "Comments and open
  problems". Before: 15 on p17, 5 on p18, 2 on p20, 1 on p21, 6 on p22.
- Per-page processed share on the math pages: p17 16→43%, p20 43→52%, p21
  41→48%, p22 43→55%, p14 59→60%, p16 71→74%. The rest of each page is math
  spans (never candidates), formulas and captions.
- References: p26/p27/p28 go from 43/42/49 processed spans to 0, all inside the
  refs region; p25 keeps exactly its 12 spans of closing body prose above the
  References heading.
- papers.mjs 7/7 unchanged, refs counts identical (63/58/67/73/33/23/68), then
  8/8 with the paper added as the "LaTeX article (CM)" template: `untouched`
  probes for two unnumbered bibliography entry titles (the numeric-marker
  refsOk check cannot see an author-year list) and `processedOnPage` probes for
  three prose fragments on p17. Final run: 8/8 PASS, the new template reporting
  refs=64, proseOk, tableOk (412 marked), refsOk, headingClean. npm test 45/45
  with a parser unit test for a bibliography crossing a page break under a
  running head.
- Corpus template labels renamed (test-only, same URLs). The letters said
  nothing about what each paper exercises, so labels now name the TEMPLATE,
  identified by MEASURING the PDFs (page box, body size, leading, column
  extents, faces, boilerplate, heading style). The measurement also corrected
  two wrong assumptions of the first pass:
  - The three "two-column A/B/C" papers are ONE template, not three: all measure
    612x792, 10pt body / 12pt leading, columns 54-296 + 318-560, Nimbus Roman +
    Nimbus Sans, numbered headings. Same for D/E (acmart, 9pt/11,
    Libertine/Biolinum). Labels therefore carry a template name plus a COVERAGE
    VARIANT — `USENIX (baseline)` / `(code + algorithms)` / `(no cover page)`,
    `ACM acmart (full)` / `(short)` — and the docs say plainly that those extra
    papers are kept for CONTENT coverage, not template coverage.
  - "arXiv preprint" is not a template: hosting says nothing about layout. Those
    entries are named by their template — `IEEE journal` and `NeurIPS`, the two
    documents that BOTH used to answer to the key `"arXiv"` (a different paper
    per harness), plus R19's `LaTeX article (CM)`.
  Final coverage: 5 templates over 9 papers — USENIX x3, ACM acmart x2, IEEEtran
  in both its conference and journal modes, NeurIPS, plain LaTeX article.
  TESTING.md carries the old→new mapping and the identifying evidence; earlier
  entries in this file keep the letters they were written with.
- Pre-existing and unrelated to R19, found by adding the template and fixed in
  R20: that paper linked 0 CITATIONS ("⚠ no citations linked" — a warning, not a
  failure), because its in-text citations are NARRATIVE author-year.
- Two-column D reported 0 bolded / 0 masks / 0 cites in ONE intermediate run and
  its normal 1987/369/72 in every run before and after, including with the same
  code — a load flake in that run, not a classification change.
- test/debug-fig.mjs and stylemodes.mjs re-run clean (italic preservation still
  3/3 on the CMTI paper), and skipAlignedStarts now has a `__fxStarts` debug
  hook like its sibling passes - it is what identified the (6.8)/(6.9) seed.

## Round 20 (R20) - narrative author-year citations were never linked (user request)

The R19 paper linked ZERO of its ~90 citations while its 64 references parsed
perfectly, because it cites in the NARRATIVE author-year form (natbib
`\citet`): the authors are running PROSE and only the year is bracketed —
"shown in papers of Church [1936], Turing [1936], and Post [1936]", "which
Vergis et al. [1986] have called", "the Invariance Thesis of van Emde Boas
[1990]", "Benioff [1980, 1982a]". Neither existing pattern can see that form:
NUMERIC_CITE matches 1-3-digit ENTRY NUMBERS (a 4-digit year never matches it,
which is also why `[1936]` was not mistaken for entry 193), and
AUTHOR_YEAR_CITE requires the author INSIDE the parentheses. Any paper written
this way got no cards, no coloring and no hit-targets at all.
- Fix: NARRATIVE_CITE in parser.mjs. The name run accepts initials
  ("L. M. Adleman"), lowercase nobiliary particles ("van Emde Boas"), "et al."
  and "and" — and nothing else, so prose cannot grow into it: any other
  lowercase word ends the run and the year bracket must follow immediately.
  Either bracket style is accepted, plus a year LIST inside one bracket
  ("[1980, 1982a]" → two keys). The surname key is the LAST multi-letter
  capitalized token, so initials are skipped; resolveCitation's
  entry-text fallback handles the particle case ("Boas" → "P. van Emde Boas").
- Two supporting fixes: findCitations now DROPS overlapping ranges (the
  annotator wraps each range in the span markup, so two ranges over the same
  characters would nest and corrupt it), and resolveCitation splits a key on
  its LAST hyphen — "Ben-Or-1994" previously parsed as surname "Ben", year
  "Or". NOT_A_SURNAME (Table/Figure/Section/Theorem/Lemma/…) guards both
  author-year patterns now, not just the parenthetical one.

### Verification
- The paper goes from 0 to 97 citation hit-targets, `citeColored` from null to
  the blue `rgb(11, 87, 208)`, and the "no citations linked" warning is gone.
  A hit-target only exists when a card was built, and an UNRESOLVED author-year
  key builds none — so all 97 resolved.
- Clicked the cards on p2 and read them back: `Church-1936` →
  "A. Church (1936), An unsolvable problem of elementary number theory";
  `Turing-1936` → "A. M. Turing (1936), On computable numbers …";
  `Post-1936` → "E. Post (1936), Finite combinatory processes";
  `Vergis-1986` → "A. Vergis, K. Steiglitz, and B. Dickinson (1986) …";
  `Emde-1990` → "P. van Emde Boas (1990), Machine models and simulations".
- papers.mjs 8/8 with the other seven papers' citation counts UNCHANGED
  (55/75/49/72/151/46/149) — no false positives on numeric or parenthetical
  templates. npm test 49/49, including negative cases: "the Turing machine
  [1936]", "see Table [1990]", "in Section [2020]" and "[1936, and beyond]"
  must not match, while "as Shor [12]" stays a NUMERIC citation.

## Round 21 (R21) - running the release gate: the instruments were the problem

Running CLAUDE.md's release gate over R17-R20 produced 13 corpus sweeps, 6
negative controls and 4 visual inspections. NO defect in any of it was
attributable to R17-R20; R19 measurably IMPROVED prose coverage (skipRun 15 -> 4
on the math paper, skipBody 34 -> 32 on a private document). What the gate
actually found was six defects in the checking apparatus, several of which made
"clean" results meaningless:

1. The leaf-span test in EIGHT harnesses excluded any span containing a nested
   span - intended for PDF.js markedContent wrappers, but it also caught our own
   .fx-cite-c / .fx-ref-c, so every processed prose span mentioning a citation or
   a Figure/Table was invisible. It produced 4 false "processed span in a table
   zone" reports, and left audit's capProse structurally blind to the very spans
   it exists to check.
2. FOUR sweeps could not fail: diagnose only exited non-zero when it CRASHED;
   skipline, diag-dividers and audit had no exit-code logic at all. A private
   sweep of diagnose reported "28/28 PASS" while incapable of reporting a defect.
   Two retracted results came from this.
3. diagnose's selBad counted a document's own hyperref link annotations - painted
   above the text layer by PDF.js - as failures, so it read non-zero forever on
   citation-dense papers (ACL: 7, identical pre-R20).
4. There was no console harness at all. The existing probes filter to errors, so
   warnings were captured nowhere and neither sweep checked the console.
5. shot-region2's PAPERS map was missing half the corpus after the rename, so it
   opened file=undefined and failed 30s later as "cannot read ... 'canvas'".
6. shot-region2 captured the fx-OFF half 2.5s after toggling; restoring is
   idle-chunked, so the pair came back as two identical images - a matched pair
   that shows no difference no matter what is wrong.

Standing defects surfaced, all confirmed PRE-EXISTING by engine.mjs pre-R19
controls, all in the prose-vs-structure boundary family - each deserves its own
round rather than a fix inside a release being verified:
- table-region sweeps 6 spans of real prose (public, one page).
- a table cell is processed inside a 16-zone ruled region (private, one page).
- a line-start in-text reference is left unprocessed (private, one page) - the
  first capProse hit in either corpus, visible only after fix 1.

Behaviour change worth knowing (NOT a regression): wrapRange splits a processed
span at its emphasis boundaries when coloring a citation, so text inside a
citation range is colored but not emphasized. Verified as the product's existing
convention - ACL's parenthetical citations behave identically (260 cite spans,
every one boldInside=0). R20 extends that convention to the narrative form, so
author surnames in narrative-citing papers are now colored rather than
emphasized. The improvement (re-apply emphasis inside the range, as the Find path
already does) would fix both forms and belongs in its own round.

### Gate results
- Step 1: npm test 49/49 + naming guard.
- Step 2 (public, 14 papers): tables/diag-dividers/diagnose/audit/skipline all
  clean. 1026 rules detected, masked=0.
- Step 3 (private, 28 documents): console 28/28; diag-drag 28/28 with sel
  171-304, EXACTLY the v1.0.3 baseline band; tables 27/28; diagnose 28/28 on real
  criteria; diag-dividers 28/28 with 2000+ rules masked=0; audit 27/28.
- Step 4 (look at the renders): TARGETED, not full coverage - 4 pages chosen
  where these changes act. R19 prose/math boundary verified by a working matched
  pair; bibliography page verified untouched with small caps and italics intact.
  A full 42-document fan-out was NOT done.
- Step 5 (console): public 14/14 every page, private 28/28. Allowlist earned one
  entry (upstream TrueType hinting, verified with --fxoff); the other ten
  candidates excused nothing and were deleted.
- Step 6: NOT tagged. Step 4 is partial by choice, and three standing defects are
  open.

### Also fixed here: refsOk could silently pass (guard weakness)
`__fxRefCount` is set when the bibliography is PARSED, but the refs REGION (what
protects it from processing, and what papers.mjs's refsOk reads) is applied a few
async steps later. The wait loop broke on `refs > 0`, raced that gap, and an
empty region made refsOk report `null` — a silent pass — on a DIFFERENT paper
each run (A and C in one run, E in another; all three parse their bibliographies
fine). Same shape as R17's vacuous italic check. papers.mjs now waits for
`refPages > 0` as well, and a paper with a parsed bibliography but no region
scores refsOk=false instead of null; `null` is left only for a document with no
bibliography. All 8 papers now report refsOk=true with refPages 1-4.

## Round 22 (R22) - the reference list must never be emphasized; the three standing prose-vs-structure defects (user request)

User: "do not bold text on references and fix the three pre-existing
prose-versus-structure defects" - the three R21 left open, each confirmed
pre-existing there and deliberately deferred out of a release being verified.

### R22-1 - reference lines that repeat get emphasized (the reference-list ask)
The bibliography is left exactly as the author set it via per-line boxes built
from findReferencesBody's body lines - so a bibliography line that never REACHES
that list gets no box, and is emphasized like body prose. R19-2 introduced
exactly such a hole: furniture (a bare page number, or a short line whose
digit-stripped text repeats on 3+ pages) is stepped over, and repetition alone
also describes lines of the reference list itself. On ACL's five-page
bibliography, "Software Engineering" (an italic journal name ending an entry) and
"pages 1251-1263. IEEE." (digits stripped -> "pages . IEEE.") each appear on
three or more pages: 13 spans across four pages were emphasized inside the
reference list.
- Fix: furniture must live in the MARGINS. A running head or foot is the
  topmost or bottommost line on its page (tolerance half a line height - a full
  line height lets the last entry line of a reference page count as a foot,
  which is the distinction being made). Only margin lines can establish a
  repeated-head text, and only a margin line can be treated as one.
- Result: ACL 13 -> 0 emphasized reference spans, body 440 -> 462 lines, entries
  unchanged at 91. Other bibliographies gained the lines they had been losing
  the same way: USENIX (no cover) 277 -> 280, NeurIPS 114 -> 119, Shor 150 ->
  157, UC-Scheme 215 -> 216 - with entry counts identical (67/40/64/70), i.e.
  the lines were being dropped from a list that had already been grouped.
- The R19-2 case is untouched: those running heads ARE the top line of their
  pages. Unit test added for each direction.

### R22-2 - a full-width table welded both columns into one page-wide region
table-region groups confirmed table rows into a bounding box and skips
everything inside it. Growth was unbounded horizontally: a table SPANNING the
gutter yields a page-wide box, and the box's downward chain then continues
through whatever table rows either column offers. On USENIX (code + algorithms)
p19 that swallowed the page below the full-width Table 8 - the right column's
Table 9 rows and the left column's Algorithm 2 lines kept one region growing from
y710 to y76 (n=244) - and the six lines of appendix prose between them were
skipped as table-region ("extracted by the Wp-method as TCEs (line 19)",
"quently, previously learned CEs are also utilized", "until the termination
condition is reached", "first pass of learning all implementation FSMs", "of
model refinement is performed to ensure", "are utilized for prior implementations
as well").
- Fix: build regions PER COLUMN BAND, each row clipped to the band (a row
  brushing the gutter with under 10% of the band contributes nothing). A
  full-width table stays covered - both bands see its rows - while a single
  column's rows can only ever extend that column's own region.
- Result: p19 skipBody 6 -> 0, paper total 30 -> 24, all four hard audit criteria
  still 0, tables.mjs offenders still 0.

### R22-3 - a numbered RUN-IN heading took its paragraph's first sentence with it
The line-level heading pass skips a whole column band when the line's lead
matches HEAD_LEAD and the band has <= 3 lowercase words. A numbered run-in
heading shares its line with the paragraph it opens - the shape is "2.3.1.
Latency overhead.  Table 5 shows the measured ..." - and a title's last word
carries a trailing period, so it does not count as a lowercase word: the line
squeezed under the bar at exactly 3 and the sentence after the heading lost its
emphasis. (The document is in the private corpus; the example is synthetic, the
geometry is not.) That was the capProse
finding - an in-text reference at a line start left unprocessed - and the only
capProse hit in either corpus.
- Fix: runinHeadRun. Qualify by the line FILLING ITS COLUMN'S MEASURE (a
  standalone heading stops well short of it; the measure counts only items that
  do not cross the gutter, or one full-width figure label would set it to the
  far page edge and no line would ever look full), then cut after the first
  period-terminated item that carries LETTERS - the number alone ("2.3.1.") ends
  in a period too - provided real prose follows on the same line.
- Result: capProse 1 -> 0 on that document, skipBody unchanged at 32.

### R22-4 - a code line inside a framed listing read as prose between frames
The rule-zone backstop leaves everything centered between chained canvas rules
on the canvas, exempting a full-width line of >= 4 lowercase words (a paragraph
between two stacked framed listings) and, within it, spans that are themselves
prose-sized. Both counts used a bare letter-run match, which counts runs INSIDE
identifiers: a query line of the shape `RETURN x.name AS label, y.name AS owner,`
scored 4 and became an exempt "prose" line, and a lone camelCase continuation line
scored 2 (two letter runs inside one identifier) and chained off it as that
paragraph's tail. That span was processed inside a framed listing on a 16-zone
page - the last table leak in either corpus.
- Fix: proseWordCount - whole lowercase WORDS, bounded at both ends. The query
  line's identifiers no longer count as sentence words, a camelCase token scores
  0, and the >= 12-char per-span escape now also requires at least one real word.
  test/tables.mjs's oracle mirrors it, as it did before.
- Result: that page's offenders 1 -> 0; the genuine prose-between-frames case on
  the same page still exempt (a 9-word sentence and its 4-word tail line).

### New harness: test/refbold.mjs
papers.mjs's refsOk only looks for "[18] Name ..." entry OPENERS, so R22-1 was
invisible to the whole gate - continuation lines, unnumbered bibliographies and
missing boxes all pass it. refbold recomputes the bibliography's EXTENT from the
parser (heading + body lines, grouped per page and COLUMN, x bounds from the
5th/95th percentile so one extractor-merged line cannot stretch a box across the
page) and reports every processed span inside it. It checks the OUTCOME, not the
mechanism: a line the box list never received still falls inside its column's
box.
- Per-column matters: a per-page y band called the prose beside a mid-column
  References heading "bibliography" and produced 82/31/100/45/47 false hits on
  five papers. Fixed before any of them was believed.
- Negative control: with the R22-1 fix reverted, the harness reports exactly the
  13 ACL spans again; with it, 0.

### Two harness repairs found while verifying
1. audit's capProse printed no skip reason, so a hit said only "some pass claimed
   this line" - not enough to fix anything. It now reports `data-fx-why`, which
   is how R22-3 was traced to the line-head pass in one run.
2. audit's skipPara excluded the bibliography pages but NOT front matter. The
   title/authors/affiliations block above the Abstract is skipped by design, so
   every paper with a 3-line author block failed this criterion (acmart short: 2
   runs on page 1). Confirmed PRE-EXISTING by control (identical with the engine
   reverted). It is now cut by the engine's own contentStart, like the
   bibliography.

### Verification
- npm test 50/50, including new unit tests in BOTH directions: a phrase repeated
  inside the bibliography stays in the body, while a real running head and a page
  number at the foot stay out.
- papers.mjs 8/8, reference counts unchanged (63/58/67/73/33/23/68/64).
- tables.mjs: 14/14 public papers, 0 offenders. audit: 14/14 public, all four
  hard criteria 0. diag-dividers over seven papers: 695 rules, masked=0.
- refbold: 14/14 public, 28/28 private - and every one of those 28 printed a
  TOTAL line, i.e. a bibliography was found and actually checked (a document
  without one prints "no bibliography found", which would be a SKIP).
- citeaudit on ACL: unresolved=0, refCount=91 - the parser change did not disturb
  citation resolution.
- diagnose on the p19 paper: whiteout/fontBad/selBad 0, peek 438 vs 437 and
  skipRun 15 vs 15 against a reverted control - the six newly processed spans
  cost one unit of mask overhang and nothing else.
- Matched fx-on/fx-off pairs at 2.5-3x (`shot-region2`): the p19 prose shows
  leading syllables ("ex|tracted by| the| Wp-met|hod as| TCEs (line 19), and|
  conse-") at identical glyph positions; the run-in heading's sentence is
  emphasized with the heading's own terminal period left alone; the ACL
  bibliography region is pixel-identical between fx-on and fx-off, and its
  pre-fix control is not.
- Private corpus, all 28 documents, every page: tables 28/28 with 0 offenders
  (R21 was 27/28 - the failure was R22-4's listing cell); audit 28/28 with
  keepFallback/tableLeak/capProse/skipPara all 0 on every document (R21 was 27/28
  - the failure was R22-3's capProse); refbold 28/28.
- Console gate (viewer page AND extension service worker, every page): 5 public
  papers, `PROBLEMS=0`, allowlist unused.
- Step 4 of the gate was completed separately, over both corpora - see R23, which
  is where the two defects it found are written up.

## Round 23 (R23) - step 4 of the gate, done properly: 42 documents looked at

R22 shipped with step 4 TARGETED (5 regions where those changes act). Doing it as
the gate asks - one matched fx-on/fx-off pair per document, at zoom, across the
public corpus AND all 28 private documents - found two defects that every DOM
oracle in this repo passes. Both are PRE-EXISTING (reproduced against 0102b52),
and neither is expressible as a span count: one is a glyph that appears twice,
the other is a weight that is uneven inside a word.

Method: `shot-region2 <doc> <page> --find=" the " --zoom=2 --pad=150`, which
frames a PARAGRAPH rather than a line. The one-line band R21 used cannot show the
defect classes the gate lists (baseline drift, jammed spacing, one span in the
wrong face, a whited-out word) - there are no neighbours to judge against.

### R23-1 - a THREE-LINE running head was emphasized, and peeked
The engine's furniture defence is a margin cut: the outer 6% of the page. That
reaches a one-line running head. One private document repeats a three-line title
block at the top of every odd page, set at 7pt (under body size): the block hangs
well below the 6% band, no per-page rule has anything to go on, and it was
emphasized as body prose. Worse, being processed made a canvas glyph visible past
its mask: at 3x, one hyphenated word of the head rendered with a DOUBLED letter
the document does not contain. The DOM was correct - the emphasis wrapper split
that word exactly where it should - so the extra glyph is canvas ink showing
through a gap between two mask rects, not a text bug.
- Fix: `findFurniture` in parser.mjs, plumbed as `engine.setFurniture` beside the
  refs region and contentStart. Repetition across pages identifies furniture, and
  only a document-wide pass can see it: a line in the page's top/bottom band
  whose text repeats VERBATIM on 3+ pages, or - for lines under 40 characters -
  whose digit-stripped text does (a head carrying its own page number).
- The verbatim/short split is load-bearing. Digit-stripping alone (the rule the
  reference-body loop uses) makes two DIFFERENT body lines look identical when a
  number is all that separates them; the first unit test written for this failed
  in exactly that way.
- Result: the head renders as the author set it, verified at 3x. papers.mjs stays
  8/8 with every count unchanged, INCLUDING the CM paper's bolded count of 1291.
  (The first version of the rule moved that count to 1275, and I first read the
  drop as its running heads no longer being emphasized. It was not: those heads
  are one line at the very top and the 6% margin cut already had them. 1275 was
  the R23-1a false positives - a subscript digit's box swallowing the line beside
  it - and the count returning to 1291 is the evidence they are gone.)

### R23-1a - and then furniture claimed a body line (caught by skipline)
The first version of the rule treated ANY digits-only line inside the band as a
page number. The extractor emits a formula's subscripts as their own lines - "1"
and "2" under a hash-function definition - so each got a furniture box ONE
CHARACTER wide, and the engine's box test carried a 2-unit slack on top of the 2
units findFurniture already pads with. A body line starting 1 unit past such a box
counted as inside it and lost its emphasis (IEEE journal p6). Fixes: a digits-only
line is a page number only when it is the EXTREME line on its page; repeated text
must contain a LETTER (a repeated subscript pair is formula debris); and the
engine's test drops its extra slack. The refs region can afford slack because its
boxes are whole reference lines - a head's box can be one word wide.

This is what `skipline` is for, and it is the one oracle in the set with no
exit-code criterion: the fan-out saw the page and read it as clean, because ONE
missing hairline of emphasis in a paragraph is not visible to the eye at 2x.

### R23-2 - a ruled table's HEADER row was emphasized over the document's bold
The rule-zone backstop exempts a full-width, wordy line inside a rule chain: the
paragraph that legitimately sits between two stacked framed listings. A table
HEADER row is also full-width and wordy, so the exemption claimed it, and its
cells were re-emphasized on top of the template's own bold - uneven weight inside
each word of a ruled table's header.
- Fix: an exempt line must stand CLEAR of the rules bracketing it, by half a line
  height at each end. The numbers separate cleanly: the header row measures
  gapTop 4 / gapBot 4 against a 15px line, while the genuine
  prose-between-frames case on another document measures 22 / 42 against 15.
- A paragraph that hugs a frame loses its emphasis under this rule. That is the
  right way to be wrong here: table structure is the invariant the zone backstop
  exists to hold, and the cost is emphasis on one line.

### Verification
- npm test 53/53 (three new unit tests: a multi-line head IS furniture, unique
  per-page lines are NOT, and a short head carrying its page number still is).
- papers.mjs 8/8; refs and cites counts unchanged.
- Public corpus, all 14 papers, every page: audit hard criteria 0, tables 0
  offenders. Private corpus, all 28: audit 28/28 with the four hard criteria 0 and
  skipBody identical to the pre-R23 baselines, tables 28/28 with 0 offenders.
  refbold unchanged (14/14, 28/28).
- After R23-1a the only measurable movement anywhere in either corpus is one span
  on IEEE conference (skipBody 17 -> 18: a table header cell now left on the
  canvas, which is R23-2 doing its job). Every papers.mjs count, including the CM
  paper's 1291 bolded spans, is identical to the pre-R22 baseline.
- 42 documents seen, one matched pair each (two pages for six of them). The two
  defects above are the only ones found by eye; R23-1a was found by skipline.
- diag-dividers now covers all 14 public papers: 1135 rules, masked=0.
- Console gate: public 5/5 and private 28/28, PROBLEMS=0 on every page of every
  document, viewer page and service worker. The allowlist earned nothing new -
  its one entry (upstream TrueType hinting) accounts for every "loud" line.
- skipline over four papers with the widest table/figure/math surface: no line is
  skipped as `furniture`, and every remaining unprocessed prose line is one of the
  intended classes - bibliography pages, front-matter author/email lines, a URL
  continuation, figure state labels, bullet-led table cells. IEEE journal matches
  its pre-R22 control page for page.

### Harness repairs made while running it
1. shot-region2 had no timeout on its CDP calls: one paper wedged and the corpus
   loop simply stopped, which reads as "still running" rather than "this document
   failed". Every call is now bounded at 60s.
2. A failed capture exited 0, so a sweep reported PASS for a document whose image
   was never written. It exits 1 now - which is how the one document whose page 5
   contains no " the " announced itself instead of vanishing.
3. Its PAPERS map was missing AFC-Diss - the same incomplete-map defect R21 fixed
   for the other entries. The guard added then did its job: exit 2 with the list.
4. shot-region2 gained `--pad`, so a capture can frame a paragraph.

## Round 24 (R24) - the ProVerif manual: seven user reports, one document

Test document: the ProVerif 2.05 manual
(https://bblanche.gitlabpages.inria.fr/proverif/manual.pdf). It is not in the
corpus, and it is unlike everything in it: a 160-page single-column LaTeX book
in Computer Modern, an ALPHA-KEY bibliography ("[AF01]", "[ABB+04]"), TeX accent
composition throughout, and inline math italics inside ordinary words. Every
defect below is pre-existing; each was reproduced with a measurement before it
was touched.

### R24-1 - three citations in one bracket, one wrong card for all three
User: "the thumbnails for all citations here are the same, and the found
reference does not match" - on "[AF01, RS11, ABF17]", whose pager showed the
same unrelated paper on every page.

The three entries parse correctly and distinctly (verified: "Mobile values, new
names, and secure communication" / "Applied pi calculus" / "The applied pi
calculus: Mobile values, new names, and secure communication"). The lookup was
the problem, in two ways:

1. The Scholar query was the TITLE ALONE. "Applied pi calculus" is three words
   that hundreds of papers contain, and Scholar ranks by citations, so the
   book chapter actually cited loses to "Simulation based security in the
   applied pi calculus". Neighbouring citations in the same bracket are about
   the same subject, so they land on that same paper - which is what "all the
   same" was.
2. Whatever came back FIRST was shown, with no check that it was the cited work.

Fix (`references/scholar.mjs`):
- `referenceQuery()` - title + first-author surname + year (each appended only
  when the title does not already carry it). Two extra terms is the difference
  between "a paper about this" and "this paper".
- `bestMatch()` - parse the first 5 results and score each against the
  reference: Dice similarity over title words, +0.25 if the author appears in
  the byline, +0.15 if the year matches within one (Scholar dates a cluster by
  its earliest version). Accept the best only at >= 0.85 with title >= 0.45.
  Dice is used because it is SYMMETRIC: containment scores a SUPERSET title
  ("Simulation based security in the applied pi calculus" over "Applied pi
  calculus") a perfect 1.0, which is exactly how the wrong paper got through.
- No convincing match -> return null, and the card shows the document's own
  bibliography entry under a "From this document's bibliography" label
  (`popup.mjs`, `.fx-cite-source`). An honest local entry beats a confident
  wrong one, and the "Google Scholar" pill now carries the enriched query so
  one click gets the user to the right search.

`parser.mjs` had to supply the author: `surname` was the first capitalized word
of the entry, which is the surname only in APA ("Doe, J. (2019)"). A numeric or
alpha bibliography sets the given name first, so it returned "Martín" - or
"Mart", once the PDF's accent composition splits the name. `guessAuthors()` cuts
the author block exactly where `guessTitle()` cuts the title, and
`firstAuthorSurname()` reads either convention with one rule.

### R24-2 - a bundled reading font fused the words
User: "for some fonts, there are not enough spaces between the words."
Reproduced on p10 in Literata and Inter: "Thismanual providesan introductory".

The width pass spends any width correction on word-spacing first and gives only
the residual to `--scale-x`. That is right for a POSITIVE correction (it is
justification surplus, and opening the spaces is what the canvas itself did),
and wrong for a NEGATIVE one, which is the systematic case for a bundled reading
face: Inter and Literata run 5-8% wider than Computer Modern at the same size.
At the -0.1x-height cap a typical space fell from ~0.26em to ~0.15em.

Measured on p10, median word-spacing / median `--scale-x` / narrowest rendered
gap:

| mode      | before          | after           |
|---|---|---|
| original  | +0.058 / 1.000 / -      | +0.051 / 1.000 / 0.296em |
| atkinson  | +0.060 / 1.000 / -      | +0.026 / 1.000 / 0.260em |
| inter     | -0.100 / 0.961 / ~0.10em | -0.020 / 0.951 / 0.243em |
| literata  | -0.100 / 0.973 / ~0.10em | -0.020 / 0.949 / 0.173em |

Fix (`engine.mjs`): `MAX_SPACE_TRIM` = 0.02x height (was 0.1). The negative side
is now a sub-pixel trim and the real shrink goes to `--scale-x`, which
compresses glyphs and spaces ALIKE and so preserves the face's own word gap.
Width residual is unchanged (median 0.02px, p90 0.04px) and overlaps stay 0.

The `jams` metric in `matrix-fonts.mjs` reported 0 throughout, because it tested
whether word-spacing was more negative than -0.11em - a value the engine's own
clamp made unreachable. It now measures the RENDERED gap, after word-spacing and
`--scale-x`, and also reports `gapMin`.

### R24-3 - an alpha marker whose "+" is a superscript was never a marker
"[ABB+04]" sets the "+" as a raised, smaller glyph. The extractor splits a line
at every font-size change, so the marker arrived as three fragments - "[ABB",
"+", "04] William Aiello..." - and the "+" sorted FIRST (higher baseline).
`ALPHA_MARKER` matched none of them: entry [ABB+04] never existed, the previous
entry [Aba00] swallowed its text (its title became "+ [ABB 04] William Aiello,
Steven M"), and every "[ABB+04]" in the body resolved to no card at all.

Fix (`extractor.mjs`): a size change set FLUSH against its neighbour (gap under
0.15x height - no room for even a word space) is a superscript INSIDE a word,
not a separate block, and joins the line. ProVerif entries 73 -> 75.

Also `citations.mjs`: the stub card for an unparsed entry was restricted to
`/^\d+$/` keys, so an alpha-keyed citation the parse missed got no hit-target,
`reconcileLinks` never saw it, and a click fell through to the PDF's own link -
scrolling to the bibliography, which REQUIREMENTS forbids. Any BRACKETED key
gets a stub now.

### R24-4 - two bibliography styles whose titles were never found
The generic sentence split reads these WRONG rather than merely failing, so both
sent Scholar a query for the whole entry:

- Comma-punctuated author-year, older LaTeX article style: "L. M. Adleman
  (1994), Algorithmic number theory, in Proceedings of..." - no sentence period
  anywhere. Shor quant-ph/9508027: 54 of 64 entries.
- LNCS: "Surname, I., Surname, I.: Title. In: Venue" - the period before "In:"
  is read as the title boundary, so the VENUE came back as the title. And an
  entry ending in a DOI ("... (2005). https://doi.org/10.1007/x") satisfies the
  APA pattern, whose answer was the title "https://doi".

Fix (`parser.mjs`): `APA_COMMA` and `LNCS` branches, LNCS tried before APA. Two
guards found by running the corpus sweep against them:

- A parenthesised year is not always the author-year delimiter. The ACM
  Reference Format ends with one ("... Applications 32, 2 (2009), 315-323."), so
  `APA_COMMA` returned the PAGE RANGE as the title of an entry the sentence split
  had been reading correctly. `TITLE_SHAPED` (the capture must contain a word)
  hands that form back to the split.
- An LNCS author list may end in "et al.", which the surname+initials guard
  rejected; those entries fell to the split and returned the venue.

`guessTitle` and `guessAuthors` had begun to duplicate this decision, and drifted
on the ACM case (the title was right and the author block was not), so both are
now views on one `splitEntry(raw)`.

Suspicious-title counts on the corpus: LaTeX-CM 54 -> 1, UC-Scheme 31 -> 7
(the remainder are entries with no title at all: URLs, standards, tools),
ProVerif 1 -> 0. Every other paper unchanged.

### R24-5 - the vendored PDF.js was missing patch 5, and nothing said so
User: "when I start drag over the word, the shadow stops on the bolded part. i
thought this have been fixed previously." It was - in R16-1. Reproduced with a
real mouse drag: dragging across "Processes" selected "Proc", and the selection
focus was (SPAN, 1), i.e. immediately after the `</b>`.

`extension/vendor/` is git-ignored. The working tree's vendored viewer had
patches 1-4 and NOT 5, so PDF.js was again parking its layer-sized
`.endOfContent` inside a text span, exactly as R16-1 describes. Every automated
check was green: nothing verifies a vendored tree.

Fix:
- `scripts/pdfjs-patches.mjs` - the five edits, extracted from
  `fetch-pdfjs.mjs`, which now loops over them.
- `scripts/check-vendor.mjs` - verifies every marker is present; `--fix`
  re-applies the missing ones IN PLACE, no download. Wired into `npm test`.
- Applied patch 5. The same drag now selects "Processes are equipped", and the
  emphasis survives inside the selection band.

R16-1's own note said "editing the vendored copy alone is NOT enough". The
reverse turned out to be just as true: shipping the script alone is not enough
either, because nothing checked the result.

### R24-6 - a one-glyph math span got no obstacle, and the mask above clipped it
User: "the i in ith is partially masked" (p19, "compute the ith element").

`inkCheck` decides whether there is canvas ink under a rect, and a skipped span
with no ink gets NO obstacle rect (there would be nothing to protect). It
sampled every other pixel and required at least 6 hits. The canvas snapshot is
capped in resolution (csx ~0.63 here), so the italic i's rect is 7 canvas pixels
wide holding one antialiased stem: 2 hits, verdict "no ink". Without an obstacle,
the mask of the line ABOVE - padded 28% of its height - reached 3.9px into the
i's box and whited out its dot. Measured coverage of the i, by zoom: 1.0 full,
1.25 none, 1.5 none, 2.0 full, 3.0 full. The same drop hit every single-glyph
math span on the page ("n", "t", ".", ":", ",").

Fix (`engine.mjs`): step 1 instead of 2 on a small rect, the 6-hit floor scales
with the sample count below ~40 samples, and a rect under 10 CANVAS pixels wide
is not judged at all - the veto this gate feeds (hidden OCR/invisible text
layers) is a line-wide phenomenon, so declining to judge one glyph gives nothing
up. Coverage of the i is now 0 at every zoom.

### R24-7 - a word split across spans got one bold prefix per piece
User: "special words like naive here is not processed correctly" (p20, "A naïve
handshake protocol").

PDF.js opens a new span at every font change, and TeX composes an accented
letter from two glyphs, so "naïve" arrives as "A na¨" + "ıve handshake...".
Each span is emphasized independently, so the markup was
`<b>A</b> <b>n</b>a¨` + `<b>ıv</b>e` - two bold runs inside one word. The same
thing happens around an inline math italic: "ith" is math "i" + "th", and "th"
was emphasized as a word of its own.

Fix, in two parts:
- `segmenter.mjs` welds an accent-only token back into its word (so "na", "¨",
  "ıve" is one word), extends the plain-word test to accept accent glyphs, and
  never ends a bold prefix ON an accent (the accent paints over the next letter,
  which is not bolded).
- `engine.mjs` `joinRuns()` finds span pairs that carry one word between them -
  same baseline, no room for a space, word characters facing each other across
  the break - and `emphasizeParts(text, opts, wordIndex, join)` uses it: the
  piece that STARTS the word sizes its prefix against the whole word, the pieces
  that continue it get none and do not advance the saccade counter. Computed over
  allPairs, not candidates, because the piece next door is often the math glyph
  deliberately left on the canvas.

Verified in the viewer: `<b>A</b> <b>na</b>¨` + `ıve <b>han</b>dshake`, and
"th <b>elem</b>ent".

### Also fixed here
- The "Cite" BibTeX for a card was Scholar's, keyed by the cluster id of the
  result shown - so a wrong match produced a wrong BibTeX. With R24-1 the id
  belongs to a verified result, and the LOCAL fallback (now the normal answer
  whenever Scholar has nothing convincing) carries a real author list:
  `parser.mjs bibAuthors()` splits either convention without cutting a
  surname-first name in half.
- `readResult()` reads the cite-cluster id and the [PDF] link from the OUTER
  `.gs_r`, so they survive when the page selector matches `.gs_ri`.

### Verification
- `npm test`: naming guard + vendored patch check (5/5) + 79 unit tests
  (was 45; new coverage for `referenceQuery`/`titleScore`/`bestMatch`,
  `guessAuthors`/`firstAuthorSurname`/`bibAuthors`, and the two new title
  styles).
- The "Reference ↓" jump was measured, not assumed: it lands the cited entry's
  own baseline 31px below the container top on both a single-column (ProVerif)
  and a two-column (USENIX code+algorithms) bibliography, on the entry the card
  names. It was NOT a defect.
- Reference-parse sweep over the 15-document corpus, before and after: entry
  counts identical everywhere except ProVerif (73 -> 75, R24-3). One ACL
  citation key moved from resolved to unresolved - "Since-2021", a
  false-positive narrative citation that used to match an entry by accident
  through the old surname heuristic.
- `papers.mjs`: ALL 8 PAPERS PASSED (bolded/masks/refs/cites counts unchanged
  from the R23 baseline, e.g. LaTeX article CM still 1291 bolded / 64 refs).
- `diag-drag.mjs` on the ProVerif manual: PASS - the drag selects a full
  multi-line run, `.endOfContent` stays in the `.textLayer` mid-drag, and the
  emphasis is painted with a `::selection`-honoured property.
- `matrix-fonts.mjs`'s own measurement, run over USENIX (code + algorithms) p14
  in all four font modes: 0 jams, 0 overlaps, width residual median 0.02-0.05px
  / p90 <= 0.11px, narrowest rendered word gap 0.212em (inter) and 0.147em
  (literata). Negative control - restore `MAX_SPACE_TRIM` to 0.1 and the same
  metric reports 450 jams and a 0.083em gap on literata, where the OLD metric
  reported 0. The measurement can fail now.

### A note for whoever edits this file next
Do NOT round-trip it through PowerShell (`Get-Content -Raw` + `Set-Content`, or
`Out-File`): 5.1 reads it as ANSI and writes back mojibake for every em dash, and
a backtick in a here-string becomes a control character (`` `f `` really does emit
a form feed). This warning was already here for Set-Content, and it happened again
anyway. Use an editor that writes UTF-8, and check with
`node -e "..."` for control characters before committing.

## Round 25 (R25) - PDFs from the internet, and the browser that cannot load us

User report, with a screenshot: the toolbar reads "0 of 0" and the viewer shows
"FixateScholar couldn't load this document. Open in the browser's native
viewer." The document was reached by clicking a link on the web.

### R25-1 - the redirect hands PDF.js a URL it re-parses into a different URL

The service worker redirects a PDF navigation with a declarativeNetRequest rule
whose action is `redirect: { regexSubstitution: "<viewer>?file=\1" }`. DNR has
no way to percent-encode `\1`, so the target URL lands in the viewer's query
string exactly as it appeared in the address bar - and `web/viewer.mjs` parses
that query with `URLSearchParams`, which reads three characters as its own
syntax:

| in the URL | what URLSearchParams does | what gets fetched |
| --- | --- | --- |
| `&` | starts the next parameter | `…/get.pdf?a=1&b=2` -> `…/get.pdf?a=1` |
| `+` | decodes to a space | `…/a+b.pdf` -> `…/a b.pdf` |
| `%xx` | decodes one level | `…/a%26b.pdf` -> `…/a&b.pdf` |

The first is the everyday case: **any PDF link with more than one query
parameter**. Presigned S3/CloudFront links, download endpoints
(`?download=true&type=pdf`), library-proxy URLs. The server is asked for a URL
the user never clicked, answers 400/404/403, and the viewer reports a document
it "couldn't load" - while the same link opens fine in the browser's own viewer,
which is what makes it read as "can't open PDFs from the internet".

Measured, not assumed. A local server that serves the PDF only for the exact
query `?a=1&b=2` and 400s otherwise; navigate to it through the extension:

```
FAIL  query with & (strict)    pages=0 banner=true
      rawSearch : ?file=http://127.0.0.1:8788/q.pdf%3Fa%3D1%26b%3D2
      app.url   : http://127.0.0.1:8788/q.pdf?a=1
      srv GET /q.pdf?a=1
```

`app.url` is the truncation, and the server log is the proof it left the
browser that way.

**Why `normalizeFileParam()` in overlay.mjs did not already prevent this.** It
existed, with a comment naming this exact hazard - and it has never once run in
time. `viewer.mjs` is a module script, so it evaluates only after the parser has
finished, when `document.readyState` is already `"interactive"`; PDF.js
therefore calls `run()` (which reads `location.search`) *during its own
evaluation*, not on `DOMContentLoaded`. Module scripts run in document order and
patch 2 appends `overlay.mjs` after `viewer.mjs`, so the rewrite always landed
after PDF.js had read - and truncated - the URL. Traced:

```
TRACE docstart          search= ?file=http://127.0.0.1:8790/q.pdf?a=1&b=2
TRACE webviewerloaded   search= ?file=http://127.0.0.1:8790/q.pdf?a=1&b=2
TRACE app.open          url= http://127.0.0.1:8790/q.pdf?a=1      <- already lost
TRACE replaceState      -> …?file=http%3A%2F%2F…%3Fa%3D1%26b%3D2  <- too late
```

**Fix.** `extension/viewer/file-param.mjs`, loaded by a new vendored patch 6 in
the one position that works - ahead of `viewer.mjs`:

```html
<script src="../../../viewer/file-param.mjs" type="module"></script><!-- patch 6 -->
<script src="viewer.mjs" type="module"></script>
```

The rewrite is deliberately *minimal*: escape only `%`, `&` and `+`, the three
characters `URLSearchParams` treats as syntax. The obvious
decode-then-`encodeURIComponent` round trip also fixes the common cases, but it
destroys escapes that belong to the address - `…/a%26b.pdf`, an object key whose
name really does contain `&`, decodes to a query separator and can never be
put back. An already-encoded parameter (the context-menu and `file://` paths
encode at the source) is detected by
`encodeURIComponent(decodeURIComponent(raw)) === raw` and left alone, so the
rewrite is idempotent.

The fragment now stays on `location` instead of being folded into the parameter:
it is the PDF open parameter (`#page=7`) that PDF.js reads from
`document.location.hash`. `currentFileUrl()` - shared by the "native" button and
the error banner, which each had their own copy of the decode - returns the URL
*without* it, because the service worker matches that string against a DNR
`urlFilter` and a webNavigation URL, and neither ever carries a fragment.

### Not a defect: the 403s

Two publisher PDFs in the spot-check (a Cloudflare-fronted preprint server and a
paper repository) failed with `fetch 403` on the viewer's re-fetch, which looks
exactly like a hotlink block on our request. It is not: with the extension
removed entirely, a plain navigation to the same URLs from the same automation
profile gets the same 403 from the same Cloudflare edge. It is the headless
profile being blocked, not the viewer's fetch. Recorded here because it is the
sort of thing that reads as a product bug on a screenshot.

A real hotlink guard - a server that requires `Sec-Fetch-Dest: document` - does
still fail, and inherently so: the viewer re-fetches the document as a
subresource, and `Sec-Fetch-*` cannot be forged from the page or by DNR. That
case is what the error banner's "Open in the browser's native viewer" exists
for, and `test/native-button.mjs` confirms the escape hatch still lands on the
original URL and stays there.

### Verification
- `npm test`: naming guard, vendored patch check now **6/6**, 103 unit tests
  (was 81). `test/unit/fileparam.test.mjs` asserts the round-trip property the
  way PDF.js actually reads it (`new URLSearchParams(search).get("file")`) over
  nine URL shapes, plus idempotency, the fragment, `blob:`, and a stray `%`.
- Browser matrix, real navigations through the DNR redirect, before -> after:
  `query with & (strict)` FAIL -> PASS, `plus in path` PASS, `escaped & in
  filename` PASS; `plain .pdf`, `fragment`, no-extension + `Content-Type`,
  `application/octet-stream`, `Content-Disposition: attachment`, cookie-gated,
  single-use URL and `302` redirect all still PASS.
- `#page=5` still opens page 5 - both alone and combined with `?a=1&b=2`, which
  before this change could not open at all.
- `papers.mjs`: ALL 8 PAPERS PASSED, every bolded/masks/refs/cites count
  identical to the R24 baseline (LaTeX article CM still 1291 bolded / 64 refs).
- `test/e2e.mjs`: ALL CHECKS PASSED under Edge. Under Chrome 152 it failed at
  "extension service worker running - not found" **on a clean tree as well**
  (verified by stashing this change), so nothing here caused it - that is
  R25-2 below, fixed in the same pass.
- `test/console.mjs` on the IEEE stamped paper, whose corpus URL carries a
  `%20`: `PROBLEMS=0`.
- Not run: the private corpus and the full release gate. This change is not
  tagged or version-bumped.

### R25-2 - Google Chrome will not load the unpacked extension, and the harness blamed the extension

`test/e2e.mjs` failed at `FAIL extension service worker running - not found`,
which reads as a broken extension or a slow machine. It is neither. Branded
Google Chrome refuses the switch:

```
WARNING:chrome/browser/extensions/extension_service.cc:423]
  --load-extension is not allowed in Google Chrome, ignoring.
WARNING:chrome/browser/extensions/extension_service.cc:445]
  --disable-extensions-except is not allowed in Google Chrome, ignoring.
```

The extension is then simply not installed - `chrome-extension://<id>/manifest.json`
comes back ERR_BLOCKED_BY_CLIENT - so no service-worker target ever appears and
the harness waits out its timeout. Measured on Chrome 152.0.7977.76; Edge
152.0.4191.66, the same Chromium, installs it from the same command line.

Nothing on the command line brings it back. All three proposals were run
(`test/chrome-load-check.mjs`, which exists for exactly this question):
`--disable-features=DisableLoadExtensionCommandLineSwitch`,
`--enable-unsafe-extension-debugging`, and that flag together with
`--remote-debugging-pipe`. Headless and headful. Our extension loaded in none of
them. The same five variants on Edge: loaded in all but the pipe one, where the
HTTP debugging endpoint is off by design and the harness cannot look.

**Fix.** `extensionBrowserPath()` in `test/lib/env.mjs` - the browser to use
when a run needs the unpacked extension. It prefers Chrome for Testing (the
puppeteer cache), then Chromium, then Edge, and never picks branded Chrome on
its own, because with it the run cannot succeed. Explicit paths and
FX_BROWSER / FX_CHROME / FX_EDGE still win, so anything can still be pointed at
a specific binary. The five harnesses that defaulted to `browserPath("chrome")`
now use it: `e2e`, `chrome-page-check`, `live-chrome`, `diag-chrome` (whose
header claimed the feature flag re-enabled loading - it does not), and
`chrome-load-check`, which keeps branded Chrome as its default because
interrogating it is its job.

And when a browser does refuse, the harness now says so: `extensionLoadRefusal()`
reads the browser's own stderr - which is why `e2e` pipes it and passes
`--enable-logging=stderr` - and turns the timeout into

```
FAIL  extension service worker running — this browser refuses command-line
      extension loading: --disable-extensions-except is not allowed in Google
      Chrome, ignoring. — run it on Edge, Chromium, or Chrome for Testing
```

It matches either warning on purpose: with both switches present Chrome
complains about `--disable-extensions-except` and never reaches the
`--load-extension` check, so matching only the obvious one would print nothing
in the case everybody actually runs.

**Two harness bugs found while confirming this.** `chrome-load-check` ended its
wait as soon as ANY `chrome-extension://` target appeared - and every browser
ships component extensions of its own, which show up within a second. It
therefore reported "not loaded" for Edge, which does load it, a second later. It
now waits for `background/service-worker.mjs` specifically and prints
`OUR extension loaded: YES/no` rather than a target count that is never zero.
`chrome-page-check` picked its extension id the same way and printed a component
extension's. Both were finding the browser's furniture and calling it ours.

### Verification (R25-2)
- `test/e2e.mjs` with no arguments: **ALL CHECKS PASSED** (Edge 152).
- `test/e2e.mjs "C:/Program Files/Google/Chrome/Application/chrome.exe"`: still
  fails - it must - but now names the reason in the FAIL line.
- `chrome-load-check`: 5/5 variants "no" on Chrome, 4/5 "YES" on Edge (the fifth
  is the pipe variant, where there is no endpoint to ask). The check can tell the
  two apart, which is what makes the Chrome result mean something.
- `chrome-page-check` and `diag-chrome NeurIPS 3`: both run again, and
  `diag-chrome` reports `Extension loaded: YES`, 1795 fx-b spans, DNR ids
  [201,202,203], 0 SW errors, 0 CSP violations, 0 page console errors.
- `live-chrome` is headful and interactive; syntax-checked only, not run.

### The full release gate, run for R25 — and it does NOT pass

Steps 1-3 and 5 pass. Step 4 does not: looking at 42 documents turned up three
render defects, none of them caused by this round's change (each was A/B'd
against the pre-change tree, or reproduced from the engine's own code, and
`git diff` shows `extension/viewer/typography/` untouched by R25). They are
recorded here as found, because the gate's rule is that a defect seen is a
defect fixed before the version moves.

**Method.** One matched fx-on/fx-off pair per document, page 5,
`shot-region2 --find=" the " --zoom=2 --pad=150`, the R23 method - 14 public
papers and all 28 private documents. Six of the 42 pairs came back BYTE-IDENTICAL
(the page-5 band on those documents is a table, a figure or a form box, so
nothing was emphasized and nothing was proven); they were re-captured on page 8
and inspected there. That check is worth keeping: identical bytes cannot
distinguish "correctly skipped" from "reading mode never engaged", and one of the
two worst defects below was hiding on exactly such a document.

**G1 - every inter-word space renders as a .notdef box.** On one private
document, reading mode turns a whole body paragraph into words separated by tofu
(the missing-glyph box) instead of spaces. The caption above it, which is not
processed, is unaffected; fx-off is a normal paragraph. The overlay renders its
text in the span's own embedded face, and in this document's body face the space
character has no glyph - so every space our DOM text emits paints as .notdef,
while the original canvas rendering never asked that font for a space at all.
Nothing in the repo's oracles sees this: the document PASSES `diag-drag`, and
`console.mjs` reports PROBLEMS=0 on all of its pages. It is glaringly obvious in
a picture. A/B: the fx-on capture is byte-identical on the pre-change tree, so
this predates R25.

**G2 - a word containing a typographic ligature gets no emphasis at all.**
`PLAIN_WORD` in `segmenter.mjs` is `^[A-Za-z<accents>'-]+$`, and the ligature
codepoints (U+FB00-FB04: ff fi fl ffi ffl) live in Alphabetic Presentation Forms,
outside that range. Any word carrying one is rejected as "not a plain Latin word"
and left unemphasized. Reproduced with no browser at all:

```
"efficient"   => [effic]ient        "eﬃcient"     => eﬃcient
"different"   => [dif]ferent        "diﬀerent"    => diﬀerent
"workflow"    => [wor]kflow         "workﬂow"     => workﬂow
```

Quantified on the PUBLIC corpus, over the first six pages of the LaTeX/CM paper:
63 rendered words carry a ligature glyph and exactly 1 of them is emphasized,
against 2259/2262 for words without one. Three private documents showed the same
class by eye. Whether a document is affected depends on how its producer encoded
the ligature, which is why the two arXiv/USENIX papers measured 0 ligature words
and looked perfect.

**G3 - emphasis lands inside math.** TESTING.md is explicit - "Figure labels,
axis labels, displayed equations" are skip classes, and "Green over a figure /
table / caption / heading / equation / code -> BUG". On NeurIPS page 5 the
display equation is processed: `Mul` in MultiHead, `Con` in Concat, `whe` in
where and `Atten` in Attention all carry the prefix, while fx-off shows the
equation in a uniform math face. Two private documents show the inline form of
the same thing: a bold prefix on a math operator name inside `deg(φ)`, and on
sans-serif procedure names inside an inline expression.

**Also seen, needs an intent ruling rather than a fix.** The PDF's own link
annotation borders (the dotted/green boxes hyperref draws around citations) are
present in fx-off and gone in fx-on, on the LaTeX/CM paper and on 5GShield. No
glyph moves and no word changes - our citation layer recolors the text instead -
so it is not a render defect, but it IS a difference outside the
emphasis-and-color envelope that step 4 is supposed to hold to.

### Verification actually performed for R25
- `npm test`: naming guard, vendored patch check 6/6, 103 unit tests, 0 failures.
- Public corpus, all 14 papers, `diag-drag`: 14/14 PASS, selection 186-322 chars.
- Private corpus, all 28, `diag-drag`: 28/28 PASS. One document selects 79 chars
  where the rest sit at 171+; measured 79 on the pre-change tree too, so it is
  that document's short drag line, not a regression.
- Console gate, every page of every document: public 197/197 pages and private
  447/447 pages, PROBLEMS=0, viewer page and service worker. One public paper
  first failed with a 30s CDP timeout while two sweeps ran concurrently; re-run
  alone it reports 25/25 pages PROBLEMS=0. The allowlist earned nothing new.
- `papers.mjs`: ALL 8 PAPERS PASSED, every count identical to the R24 baseline.
- Step 4: 48 inspections over 42 documents, listed above.
- Clean-room patch application (`npm run fetch-pdfjs` from scratch) was NOT run
  yet; `check-vendor` verifies all six markers against the current tree.

**The version was therefore NOT bumped and no tag was pushed.** G1 in particular
should not ship: it makes a real paper unreadable in the mode the extension
exists to provide.

### The four defects the gate found, fixed

**G1 - a space that paints as a .notdef box.** Measured, not inferred: the
document's embedded body face returns a filled box for U+0020 (486-1194 dark
pixels at 48px, against 0 for the fallback), and U+00A0 inks too, so no fallback
escape exists - the face claims coverage and the browser never moves on to the
next family in the stack. The canvas rendering never asks the font for a space;
our overlay does, once per gap.

`#spacePaintsInk()` probes the face the span will actually render in, cached per
family and invalidated in `refreshFonts` (a probe run before the face has loaded
measures the fallback and would cache a false negative for the life of the
document). When it inks, whitespace is wrapped in a `span.fx-sp`, which
overlay.css paints transparent: the glyph keeps its exact advance, so every
measurement, mask and width correction downstream is untouched, and the space
stays in `textContent`, so selection and copy still yield real spaces.

Two things went wrong on the way, both worth recording:

- The first version left `.fx-sp` at PDF.js's `display: block`. Every hidden
  space then contributed NO inline advance and the paragraph rendered with its
  words jammed together - the boxes gone and the gaps with them. It is the same
  trap the citation wraps already carry a comment about. Caught by eye, then
  measured: 550px for the span against 710px for the same text with the wrappers
  stripped.
- The wrapper is a nested element inside a text span, and ELEVEN selectors across
  EIGHT harnesses assumed the only nested spans were the citation wraps. Left
  alone, those harnesses go blind on exactly the documents this fixes -
  `shot-region2` could not even find a band to capture. All eleven now exclude
  `.fx-sp`.

`test/wrapcheck.mjs` is the regression guard, and it is why this is believable:
it re-probes every processed span on every page, asserts that a face which inks a
space has all of its whitespace wrapped, and re-measures each wrapped span
against a clone with the wrappers stripped. On the affected document that is 1360
spans over 15 pages, 3869 wrappers, unwrapped=0, maxWidthDelta=0px; across both
corpora, 43 documents and ~41000 spans, no unwrapped whitespace and no stray
wrapper anywhere.

**G2 - a ligature word losing its emphasis.** `PLAIN_WORD` now admits
U+FB00-FB06, and the prefix is measured on the LETTERS rather than the
characters: a ligature is one character standing for two or three, so sizing
against the raw string shorted every word containing one. A ligature straddling
the target is taken only if that lands nearer the asked-for length than stopping
short does - always taking it emphasized four letters of "office" where the
plain spelling gets two. The public Computer Modern paper went from 1 of 63
ligature words emphasized to 63 of 63, with words carrying no ligature unchanged
at 2259/2262, and papers.mjs moved exactly one number: that paper's 1291 -> 1314
bolded spans. Every other paper is identical to the R24 baseline.
`test/unit/ligature.test.mjs` pins ten pairs - the ligature form must be
emphasized, and its prefix must match the plain spelling's to within one letter.

**G3 - emphasis inside a displayed equation.** The rule that should have caught
these (`blk-figlabel`) is gated on fewer than two lowercase words, and TeX sets
operator names and connectives as ordinary lowercase text INSIDE the equation -
so the NeurIPS MultiHead/Concat/where/Attention display counted as prose. The new
`isDisplayEquation` test uses the signal a lowercase count cannot see: a short
block whose every row is inset from BOTH of the column's text edges, carrying a
math face or a relation glyph. Body prose is never inset from both margins, a
paragraph's last line only on the right, a heading on neither. Equation TAGS are
excluded from the row measurement, or every numbered equation would look
flush-right. Deliberately not caught: equations set flush-left (the fleqn class
option), which present no centering signal at all.

**G4 - a body paragraph skipped as CCS boilerplate.** Found on the 29th private
document, which arrived mid-sweep (below). The CCS-concepts rule fired on "an
arrow plus two semicolons", and that paper's prose contains a numeric arrow and
two clause semicolons in one block - so two body paragraphs rendered with no
emphasis at all. The arrow must now sit between LETTERS: prose uses one for a
numeric change, while a real CCS line always joins terms. Verified both ways -
the paragraphs are emphasized now, and the ACM paper's CCS block is still
skipped.

### Still open (recorded, not fixed)

- **A text-face NAME inside an inline formula keeps its prefix.** Two private
  papers: a bold prefix on the operator name in an inline `deg(...)` while the
  `nrd(...)` beside it stays clean, and on sans-serif procedure names inside an
  inline expression. Unlike G3 this is not a rule violation - TESTING.md's skip
  list covers math/symbol/monospace/small-caps/bold faces, and an upright roman
  or sans identifier inside a formula is none of them. Fixing it means deciding
  what "a name in a formula" is, which is a policy change rather than a bug fix,
  and the failing item could not be located from the DOM to validate a rule
  against. Left for its own round.
- **A run-in section heading emphasized on one private paper**, where the same
  construct on another is correctly skipped. Pre-existing; the lead-run detector
  does not recognize that paper's heading shape.
- **A caption-vs-prose false positive in the AUDIT HARNESS**, not the product: it
  counted a ten-character figure-internal annotation as an in-text reference. The
  criterion now requires four lowercase words, the same prose threshold skipPara
  uses two rules down. Measured identical on the pre-change tree.

### The private corpus is 29 documents, not 28

It grew during this session: a paper added at 03:26 sorts second, so every
positional alias from rv02 on shifted by one, and the same document is rv18 in
one log and rv19 in the next. That cost real time here - a diagnostic aimed at
"rv18" measured a different paper and appeared to show the space fix failing.
The aliases are positional by design, so this will recur: read the count in the
sweep header ("N documents on 127.0.0.1:PORT as rv01..rvNN") before trusting a
label across runs. CLAUDE.md still says 28.

### Verification for the fixes

- `npm test`: naming guard, vendored patch check 6/6, 125 unit tests (was 103;
  new: ten ligature pairs plus a guard that words without one are untouched).
- Clean-room vendoring: `npm run fetch-pdfjs` from scratch applies all six
  patches to a pristine extract - what CI does on the tag.
- `papers.mjs`: ALL 8 PASSED, every count identical to the R24 baseline except
  the ligature paper's 1291 -> 1314.
- Public corpus, all 14: `diag-drag` 14/14 (selection 186-322 chars), `audit`
  14/14 with the four hard criteria 0, `console` 14/14 over every page,
  `wrapcheck` 14/14.
- Private corpus, all 29: `diag-drag` 29/29, `audit` 29/29 with the four hard
  criteria 0, `console` 29/29 over 453/453 pages, `wrapcheck` 29/29.
- Step 4 by eye, after the fixes: 42 documents as matched fx-on/fx-off pairs,
  plus the 29th re-inspected after G4. Six documents whose page-5 band is a table
  or a form box were re-captured on page 8 - a byte-identical pair proves
  nothing, and the worst of these defects was hiding on one of them.
- Two false alarms from that pass, both chased to the end rather than waved off:
  a "ligature at word start is still skipped" report on a page whose text layer
  holds no ligature codepoint at all (that word gets the ordinary two-of-four
  letter prefix, exactly like its plain spelling), and the alias shift above.
- G4 landed after the 42-document pass. It can only ever un-skip prose - a
  taxonomy arrow is never digit-flanked - and papers.mjs plus both audit sweeps
  are unchanged, so the one document it altered is the one re-inspected by eye.

## Round 26 (R26) - a two-column paper whose citations were never linked at all

User: "no reference in this paper have been processed. for the unlinked
reference, still try to process, if the reference section exists." The report was
on a private-corpus paper, so everything below is reproduced and verified on
PUBLIC papers instead - a 20-paper arXiv sweep of the same family (two-column
IEEEtran-style, numeric bibliography, no link annotations on the citations).

The sweep ran the extractor and parser offline over each PDF and counted, per
paper, parsed entries and in-text citations that resolve to one:

| | before | after |
|---|---|---|
| papers with a bibliography but ZERO parsed entries | 3 | 1 |
| papers with entries but resolving under 60% of their citations | 2 | 0 |
| papers resolving EVERY citation | 12/20 | 16/20 |

The ZERO left is a Chinese-language paper whose heading is "参考文献:" - the
heading vocabulary is English-only, which is a separate (and much larger) piece
of work, not this defect. The other three that are not at 100% miss ONE citation
each (59/60, 42/43, 88/89) for reasons predating this round and unchanged by it.
Reproduce the whole table with `node test/refparse.mjs <dir-of-pdfs>` (new here -
see the harness table in TESTING.md).

### R26-1 - the small-caps heading was eaten by the other column's baseline
`extractor.mjs` bands text items into baseline rows before splitting each row at
column-sized x gaps, and the band was `0.6 x the TALLER of the two items`.

IEEEtran sets `\section*{References}` in small caps, which the text layer emits
as TWO items: a 9.96pt "R" and a 7.97pt "EFERENCES". In a two-column paper the
other column's lines sit a few points off this column's baselines - on
arXiv:2603.06158 p13, the right column's previous entry line is 5.35pt above the
heading. Banding by the taller item made the tolerance `0.6 x 9.96 = 5.98pt`, so
the "R" joined THAT row, 250pt away in x; the column split then made it a line of
its own and left the heading as "EFERENCES". `HEADING` matched neither,
`findHeadingIndex` returned -1, `parseReferences` returned `[]`, and the document
got no citation coloring, no cards and no link reconciliation - the exact report.
The 7.97pt "EFERENCES" could not reach that row (`0.6 x 7.97 = 4.78pt`), which is
why only the first letter went missing.

Fix: band by the SHORTER of the two items. What legitimately sits off a shared
baseline is small text - a subscript, a superscript, an inline fragment - and
0.6x ITS height still admits it; a tall glyph's own height is no reason to reach
a line away. The new band is strictly narrower, so it can only reduce
cross-column bleed, never add it.

Measured (offline entry/citation counts, before -> after):
- arXiv:2510.27394 - 0 entries, 0/180 citations -> 47 entries, 180/180
- arXiv:2603.06158 - 0 entries, 0/112 citations -> 40 entries, 112/112
- arXiv:2511.09227 - the same bleed truncated the BODY rather than the heading:
  20 entries, 44/178 -> 65 entries, 178/178

### R26-2 - a float caption truncated a two-column bibliography
`findReferencesBody` ends the body at the first heading-SIZED line (at least as
large as the References heading, clearly larger than the entries), because an
appendix heading may not say "appendix".

A two-column reference list is routinely interrupted by a float: a figure or
table pinned to the top of the next column, whose caption is set at BODY size -
larger than the 8pt entries and as large as the 10pt heading. On
arXiv:2511.00919 the bibliography starts at the foot of the left column, so the
FIRST thing after two entry lines is "Fig. 9: Empirical CDFs of SNR ..." at the
top of the right column: body = 2 lines, 1 entry, 3 of 104 citations resolved.

Fix: a heading-sized line is only a boundary when the bibliography does not
plainly resume after it. `resumesAfter()` scans up to 15 lines ahead for an entry
MARKER at entry size, stopping at any real section heading; when it finds one the
interrupting line is skipped instead of ending the body, which also skips the
caption's continuation lines (they are body-sized too) rather than folding them
into the previous entry. arXiv:2511.00919: 1 entry / 3 of 104 -> 39 entries /
104 of 104.

### R26-3 - zero parsed entries meant zero citation processing (the ask)
This is the user's instruction taken literally, and it is the honest fallback for
whatever else the parser may still fail on. `ReferencesFeature` gated the whole
annotation pass on `#entries.length`, so a document whose bibliography could not
be grouped into entries got nothing - and "nothing" is the worst of the three
possible outcomes, because `reconcileLinks` only neutralises a native link that
one of OUR hit-targets covers: on a paper that DOES carry link annotations, a
click then scrolled the reader away to the bibliography, the one thing this
feature exists to prevent.

Fix (`citations.mjs`): `#shouldAnnotate()` - entries, OR the document has a
reference section at all (`findReferencesBody` returned a heading and body
lines). In the fallback every BRACKETED citation still gets its hit-target and a
stub card that says plainly that the entry could not be read; author-year
parentheticals are still skipped, because without entries to resolve against that
pattern cannot be told from ordinary prose in parentheses (`#buildCards` already
declines to stub them).

Verified with a synthetic two-page PDF whose reference section parses to zero
entries (`refCount=0`): `citeaudit` reports `noHit=4` before the change and
`noHit=0, jumpCites=0` after, with all four citations honestly UNRESOLVED.

### Verification
- `npm test`: three new tests - two in a new `test/unit/extractor.test.mjs`
  covering the row band in both directions, one in `parser.test.mjs` for the
  interrupting float. (Measured 84/84 on this round's branch; 143/143 once R25's
  suite merged in.)
- `papers.mjs`: **ALL 8 PAPERS PASSED**, every count identical to the R24
  baseline (LaTeX article CM still 1291 bolded / 64 refs; IEEE journal 1997 / 68;
  ACM acmart full 2353 / 73).
- `refbold.mjs` over the 14-paper sweep list: 0 emphasized bibliography spans
  everywhere. `diag-dividers.mjs` over the 13-paper sweep list: 1026 canvas
  rules seen, `masked=0` on every page of every paper. `diagnose.mjs` over the
  same 14 papers, 222 pages: `whiteout=0`, `fontBad=0`, `selBad=0` throughout.
  (All three matter here because the extractor feeds the boxes the engine leaves
  alone - the row band changed what counts as a line.)
- `citeaudit.mjs https://arxiv.org/pdf/2510.27394`: all 13 pages
  `jumpCites=0 noHit=0 unresolved=0`, refCount=47 (before: no citation layer at
  all). arXiv:2603.06158 the same on every page - its first pass showed noHit on
  pages 1-3 only because that PDF is 45MB and the audit measured before extraction
  finished; with a longer settle it is clean, and `reannotateRendered` covers
  those pages in the product.
- Offline reference-parse sweep over the 20-paper arXiv set, before and after: no
  paper lost entries, four gained them (the table above).

## Round 27 (R27) - copying a paragraph gave back the page's line breaks

User: "When I copy the paragraph, it breaks into several lines as rendered in
pdf. Instead of that, I want to copy a single line if within 1 paragraph. Also
the '-' shouldn't be there, unless it is used between 2 words."

Not a defect in anything we had written - it is PDF.js's behavior, and PDF.js is
being faithful. A PDF has no paragraphs, only typeset lines; the text layer gets
a `<br>` after every item that ends one, and `TextLayerBuilder`'s own `copy`
listener puts `selection.toString()` on the clipboard. So a copied paragraph
pastes as the shape of the PAGE:

    Existing CSI-based indoor localization approaches fall
    largely into three categories: channel charting, which
    learns geometry-preserving latent representations sub-
    sequently aligned to physical coordinates …

Re-wrapped anywhere else that is ragged nonsense, and "sub- sequently" is not a
word. New module `viewer/copytext.mjs` rebuilds the paragraph.

### R27-1 - where one paragraph ends
Only geometry can say, and no single signal covers every template, so five do,
in order of how much they can be trusted:

1. A line ending in a hyphen is NEVER a paragraph's last line - the word itself
   continues. This one outranks the rest, and it is what carries a word across a
   column or page break.
2. A running head or foot (the outer 4.5%/5% band of the page) belongs to no
   paragraph. Without this the page number welded itself onto the last line of a
   right column whose paragraph happened to end at the margin.
3. A list marker (bullet, enumerator, or a bibliography's `[12]`) opens a block.
   Its continuation lines are INDENTED, which is the exact opposite of the
   first-line-indent rule below - read the wrong way it shreds a contributions
   list into one fragment per line, which is what the first version did.
4. An indented first line, or a gap wider than 1.6x the usual leading.
5. In JUSTIFIED text only, a line that stops short of the right margin. The
   justification test is a vote over the selection: ragged-right text ends lines
   short all the time and the signal means nothing there.

Two groupings feed those, and they answer different questions. Reading order
(`block`) starts a new run wherever the text jumps back UP the page - which IS a
column break - rather than from an x threshold: a copy is a handful of lines, and
extractor.mjs's page-wide "is this two-column?" vote has nothing to count when the
selection is one paragraph straddling one break. Margins (`col`) come from
clustering lines by where they START, so the two columns get their own and the
same column on consecutive pages shares one; they are percentiles, not min/max,
or a single full-width caption would define the margin and make every ordinary
line look short. A column too sparse to measure (a paragraph ending two lines
into the next one) borrows the width of the densest column, since every column of
a document is the same width.

### R27-2 - the hyphen, and why shape alone cannot decide it
"sub-/sequently" is one word broken in two; "state-of-/the-art" is three words a
compound joined, broken at its own hyphen. TeX writes the same glyph in the same
place for both. Shape gets most of them - the piece before the hyphen ends
lowercase, the next line starts lowercase, and that piece is not itself already
hyphenated - but "well-/known" satisfies all three and must keep its hyphen.

The document is the tiebreaker. A paper that hyphenates "infor- mation" writes
"information" somewhere else; one that breaks "well-known" writes it intact
somewhere else. `HyphenVocabulary` learns every whole word in the document and
answers which of the two readings it has seen; unknown falls back to joining,
which is the common case by a wide margin. It costs no extra work: the lines come
from the pass `references/citations.mjs` already runs (new `onLines` hook), and
line-final fragments are excluded from the vocabulary - "well-" is the question,
not evidence.

Also here: a soft hyphen always goes, and a URL or DOI broken across lines is
rejoined with no space at all ("https://github." + "com/..." was being copied
with a space in the middle of it).

### R27-2a - and a dictionary for the words a paper uses exactly once
The document is silent whenever the word in question appears ONCE, broken, and
never again - which is exactly when "wellknown" gets produced. Measured over the
20-paper arXiv set: 1315 line-final hyphens that the shape rules cannot settle,
of which the document's own vocabulary settles 959 and 356 fall through to the
default (join).

So `WordList`: SCOWL, vendored by `scripts/fetch-pdfjs.mjs` beside the fonts,
consulted after the document and before the default. Its rule is the user's,
literally - the hyphen stays when it sits BETWEEN TWO WORDS - with one
precedence: a closed compound the list knows wins over its two halves, which are
also words ("throughput" beats "through" + "put").

Which SCOWL band to ship is a size question. Measured:

| band | words | unpacked | in the .zip | settles (of 356) |
|---|---|---|---|---|
| 20 | 10.9k | 89 KB | 29 KB | 203 |
| 35 | 39k | 340 KB | 100 KB | 255 |
| 50 | 61k | 559 KB | 160 KB | 268 |
| 60 | 77k | 712 KB | 200 KB | 275 |
| **70** | **111k** | **1.04 MB** | **302 KB** | **285** |

Shipped: all of them. Compressed it is ~300 KB of a ~7 MB package, and the extra
bands buy more than the 17 decisions the last column shows. The list says "keep
the hyphen" when both pieces are words AND it does not know the closed compound,
so every closed compound it learns REMOVES a wrong keep: at 50 the corpus
produced "sub-sequences", at 70 it produces "subsequences". The three keeps
added on the way up are "non-trainable", "cross-covariance" (both right) and
"xi-will" (a math variable meeting a verb - wrong, and harmless).

70 is also the top of SCOWL's sane range: the 80 and 95 tiers are explicitly
"questionable", carrying misspellings and scannos that would make the
both-pieces-are-words test fire on nonsense.

What no general English dictionary carries at any size is the technical compound
- "baseband", "hyperparameter", "dataset" - and those are exactly what the
document's own vocabulary knows. The two witnesses fail in opposite directions,
which is why both are worth having.

Measured cost: **+306 KB on a 6.82 MB packaged zip (+4.6%), 1.05 MB on disk**,
and 1.04 MB of heap - the list is held as ONE newline-delimited string and
membership is `includes("
" + word + "
")`, because a Set of 111k short
strings costs several megabytes and a handful of scans per copy costs nothing
anyone can feel.

Of the 285 it settles, 105 are KEEP decisions over 95 distinct word pairs - the
visible change. Eyeballing all of them: "machine-learning", "closed-form",
"high-frequency", "non-stationary", "free-space", "second-order", "time-varying",
"right-hand", "self-supervised", "space-time" and so on, with two questionable
("down-link", "xi-will"). The failure it trades away - "wellknown", a non-word -
is worse than the one it introduces.

### R27-3 - the seam
PDF.js binds its copy listener to each text-layer div and ends with
`stopEvent` - preventDefault + stopPropagation, NOT stopImmediatePropagation. So
a listener added to the SAME element afterwards still runs and can replace the
`text/plain` flavour it wrote. That is the hook: no patch to the vendored
viewer, and PDF.js's own select-all-and-copy path (a document-level listener,
reached only when the selection includes its hidden copy element, and never
reached from a text layer because of that same stopPropagation) is untouched.
`flowCopy` (default on) turns the whole thing off; it is independent of
`enabled`, because the reflow is about the text, not the typography.

### Verification
- `npm test`: 15 new in `test/unit/copytext.test.mjs` - the hyphen rules under
  each witness and none, the document outranking the word list, an unvendored
  list staying silent, indent vs hanging indent, both sides of a column break,
  running heads, ragged-right text. (99/99 on this round's branch; 143/143
  merged.)
- New harness `test/copytext.mjs`. It selects a page's whole text layer and
  dispatches a synthetic `ClipboardEvent` carrying its own `DataTransfer`, so it
  reads back exactly what the handler wrote with no OS clipboard in the loop.
  The check that matters is LOSSLESS: strip whitespace and hyphens from the
  browser's own serialization and from ours and the strings must be IDENTICAL -
  reflowing may change only whitespace and delete hyphens, so a dropped or
  duplicated word cannot hide behind a nicer-looking paragraph.
- 12 papers x pages 2-6, 60 pages before the word list and 55 (11 papers) after
  it, `word list: loaded` on every run: every page LOSSLESS, no compound hyphen
  lost, no word-hyphen left dangling before a lowercase continuation, and the
  line count roughly a third of the raw (USENIX code+algorithms p3: 109 lines ->
  15, one per paragraph plus one per bullet; IEEE journal p3: 103 -> 47).
  Two pages flagged a "word- " inside a line until the harness learned to
  subtract what the RAW text already contained - both papers set a spaced hyphen
  themselves, and copying that verbatim is not this feature's doing.
- `papers.mjs`: ALL 8 PAPERS PASSED, counts unchanged (the copy handler shares
  `overlay.mjs`'s textlayerrendered hook with the engine, so the gate has to say
  the typography is untouched).


## Round 28 (R28) - two bibliographies in one PDF (user report)

Reported on a private-corpus paper: citations were not linked, and the
reference list was emphasized as body prose. Both symptoms, one cause.

### R28-1 (HIGH) - only the LAST reference list was ever found

`findHeadingIndex` searched from the END of the document for a "References"
heading, skipping y-clustered running heads (R19), and returned ONE index. That
is right for a paper, and wrong for a PDF that holds a document plus an
appended one - an article followed by its supplementary material, a technical
report followed by its system card, a thesis's collected chapters. Each part
carries its own "References" and its own `[1]…[n]`, and the search locked onto
the LAST, shortest list. Consequences, in order of how badly they mislead:

- The article's own bibliography - the long one - was outside the refs region,
  so the engine treated pages of dense entries as body prose and emphasized
  them. That is the visible half of the report.
- Its in-text `[3]` resolved against the SUPPLEMENT's third entry. Not an
  error, not a stub: a citation card for a different paper, with the confident
  layout of a resolved one. The quiet half, and the worse one.
- Numbers with no counterpart in the short list resolved to nothing and fell
  back to stub cards, which is what "citations not linked" looked like.

Offline, on the reported document: heading found, body 19 lines, **5 entries**,
126 citations, **26 resolved**.

Fix (`parser.mjs`): `findHeadingIndexes` returns EVERY genuine heading, and
`findReferenceSections` walks each one's body with the existing per-section
scan (page furniture stepped over, floats that interrupt a column list
tolerated, next section ends it). `parseReferenceSections` parses each body on
its own, so per-section numbering stays separate.
`findReferencesBody` keeps its signature - it now returns the LONGEST section,
which is the article's whenever a supplement's shorter list follows - for
callers and tests that can act on only one bibliography.
`citations.mjs` uses the sections: the region handed to the engine is the union
of them all (nothing is left emphasized), and `#entriesForPage` narrows the
entry pool to the section that governs the citing page - the first section at
or after it, since a part's citations precede its own list, falling back to the
last. With one bibliography, which is every ordinary paper, that is all the
entries and nothing changes.

Same document after: **47 entries** (42 + 5), **125 of 126** citations resolved,
`citeaudit` jumpCites=0 noHit=0 unresolved=0 on all 20 pages, `refbold` 0
emphasized bibliography spans, and a per-page probe showing the reference pages
fully tagged `data-fx-refs` with 0 processed spans in either list.

**Public repro** (the reported file is private; this one shows the same defect):
`node test/refparse.mjs https://arxiv.org/pdf/2303.08774` - the GPT-4 technical
report, whose System Card appendix carries a second "References" (p71) after the
paper's own (p18). Before: 105 entries, i.e. only the appendix's list, so the
paper's `[1]` (Brown et al., *Language models are few-shot learners*) showed the
System Card's `[1]` (Tamkin et al.) instead. After: 190 entries, both lists.

### Regression
- `npm test` 146/146 (3 new unit tests: every section found, the primary is the
  longest, entries tagged and ordered so a bare `[1]` means the article's).
- 12-paper offline sweep, before vs after: identical on 11 (entries, resolved,
  mode all unchanged) and 105 -> 190 on the two-bibliography one. No paper lost
  an entry or a resolution.
- `papers.mjs` corpus gate, `test/highlights.mjs`.

## Round 29 (R29) - a highlight you can say something about (user request)

Requested: highlights and COMMENTS, with the saved PDF readable by other tools.

PDF.js 6.0.227 already ships the entire comment feature - a note attached to a
highlight, a standalone sticky note, the comments sidebar, the writer that puts
it in the file - behind `enableComment`, which defaults to false. So the
toolbar button stayed hidden and `PDFViewerApplication` built no
`CommentManager` at all. **Patch 7** flips the default in the vendored build
(rather than storing a preference, so every profile the extension is loaded
into - including the throwaway ones the harnesses spawn - has it).

What that produces in the saved file is already standard: `/Contents` on the
`/Highlight` plus a child `/Popup` whose `/Parent` points back at it, `/F 4` so
it prints, and an `/AP` appearance stream for readers that do not synthesize
one. One field is missing: the AUTHOR. The worker writes `/T` from the
serialized editor's `user`, and nothing in the viewer ever sets it, so every
note PDF.js saves opens authorless. Fine for a private highlight, wrong for a
review comment, which is read by someone who needs to know whose it is.
**Patch 8** carries `globalThis.fxAnnotationAuthor` into the base editor's
`serialize()`; `overlay.mjs` publishes it from a new options-page field
(**Your name on annotations**) and republishes it on change. Empty leaves the
field undefined - PDF.js's own behavior, unchanged.

### Verification (`test/comments.mjs`, new)
Runs against the live extension: the comment control is shown; a highlight is
made by drag; the note is attached through the REAL UI (the highlight's comment
button → the dialog → save); the save is inspected for each of the six things
another reader needs; the bytes are re-parsed (text and author round-trip, the
`/Popup` resolves its `/Parent`); and then the SAVED bytes are reopened in the
viewer with reading mode on, where the note's button must be hit-testable -
`.fx-cite-layer` sits above the page and would otherwise swallow the click -
and must open the note. `COMMENTS: PASS`, with reading mode confirmed live
(3063 emphasized spans on the reopened page) and the button, not the overlay,
answering `elementFromPoint`.
`test/highlights.mjs` still passes with patch 8 applied.
