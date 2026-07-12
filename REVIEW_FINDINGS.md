# Visual review — confirmed issues & proposed fixes

Produced by the per-page audit (`test/review-capture.mjs` overlays +
`test/review-workflow.mjs` review/verify). Each issue is verified against the
screenshot before listing. Rules: `TESTING.md` Section 3.

Status: **review complete; F1-F5 all FIXED & validated. Round 3 (F6/F7) below.**

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
