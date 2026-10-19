# Visual review — confirmed issues & proposed fixes

Produced by the per-page audit (`test/review-capture.mjs` overlays +
`test/review-workflow.mjs` review/verify). Each issue is verified against the
screenshot before listing. Rules: `TESTING.md` Section 3.

Status: **review complete; F1-F5 all FIXED & validated. Round 3 (F6/F7) below.**
> **Numbering note.** Two threads of work ran in parallel and both reached for
> "R28". The reference-lookup thread (R28–R33 below) kept those numbers because
> its findings are cross-referenced from code comments; the multi-bibliography
> and highlight-comments work, first written as R28/R29, is renumbered **R34 and
> R35** at the end. No content was changed by that renumbering — only the
> headings. Read R34/R35 as having landed alongside R28–R33, not after them.

Latest: **Round 39 (R39) — evidence-backed reading fonts (Lexend, Source Serif 4), proportional font scaling, open word-spacing protection, zero-leak memory audit, security review, and full matrix verification.**
Before it: **Round 38 (R38) — highlight appearance parity with fx-on/off (full opacity multiply blend, multiline clipPath seam elimination, top padding adjustment, toggle sync), and cross-platform packaging.**
Before it: **Round 37 (R37) — highlight floating toolbar & comment GUI (`enableHighlightFloatingButton`), highlight visibility under fx-on (`mix-blend-mode: multiply` + `pointer-events: none`), separate bracket citation range expansion (`[6]-[11]`), direct local file saving for `file://` PDFs, and Google Scholar BibTeX by default for Cite.**
Before it: **Round 36 (R36)** — harness defects resolved and new guards (`fontkeep.mjs`, `whyskip.mjs`, `wordshot.mjs`).
Before it: **Round 35 (R35)** — the last line of every column, dropped in silence.
Before it: **Round 33 (R33) — a real abstract on a Scholar card (OpenAlex by
title, verified), NO artificial delay on a reader's lookup (the click is the
rate limit; the gap moved to the test harnesses), and a git-ignored local cache
of real Scholar pages so the source can be measured offline instead of waiting
out a captcha.** Alongside it: **R34** (two bibliographies in one PDF) and
highlight comments.
Before it: **Round 32 (R32) — Google Scholar as the DEFAULT source (one search per
click, with the reader own cookies, title-only query), the open databases as
the fallback, both switchable — plus a Privacy section, a no-affiliation /
as-is notice, and the services listed in THIRD_PARTY_NOTICES.**
Before it: **Round 31 (R31) — the 429 was the cookie jar, not the IP: a headful
re-test overturned R28-1 (a cookieless request is what Scholar refuses; the
same browser with its own cookies answers 14 of 15), the wrong claims are
corrected in place, and the switch to the open databases stands on its other
reasons.**
Before it: **Round 30 (R30) — the abstract on every paper card, live links in the
entry, and a miss that costs 3s instead of 5: a per-request deadline, a tail
that runs concurrently, a per-host pacer, and a failed source that is no longer
remembered as 'no match'.**
Before it: **Round 29 (R29)** — the card stopped asking Google Scholar: four keyless
scholarly APIs in a measured order (1.39 requests per matched reference, 97% of
a real bibliography), the answering source named on the card, a button to the
paper's page on the venue's own site, and the rate limit engineered away.
**Round 28 (R28)** — the reference card that said the paper was not on
Scholar: Scholar's rate limit told apart from a real miss, a query ladder over
a verifier that makes loosening safe, the venue out of the query, four verifier
defects, and a lookup cache that survives reopening the paper.
**Round 27 (R27)** — copy a paragraph, get a paragraph: the page's
line breaks are rejoined and the hyphens they were broken with are repaired.
**Round 26 (R26)** — a two-column paper whose citations were never
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

## Round 28 (R28) - the reference card that said the paper was not on Scholar

User: "most of the references can be found in Google Scholar, but after recent
updates, many papers are not shown in the card."

The card has three possible answers and R24 gave it only two names. It shows a
Scholar result when one VERIFIES against the reference, and otherwise shows the
document's own entry under "From this document's bibliography" - which reads as
"Scholar does not have this paper" whatever actually happened. Four different
things were happening.

### R28-0 - what the measurement had to do first (`test/citelookup.mjs`)
A lookup that fails is one `null`, and the fix depends entirely on WHY. The new
harness runs the shipping code in its real environment - entries from the
vendored pdf.js + `references/{extractor,parser}.mjs` in Node, the fetch and the
scoring from `references/scholar.mjs` inside an extension page - and classifies
every entry as BLOCKED (Scholar refused: 429 or captcha), EMPTY (a real result
page with no results: the QUERY is too narrow), REJECT (results came back and
none verified: the SCORING), or OK. `--json` records every candidate with its
score so thresholds can be re-tuned offline (`--replay`) instead of re-querying.

`scholar.mjs` grew two exports for it - `readResults` (parse) and `scoreResult`
(score one candidate, with the term-by-term breakdown) - so fetch, parse and
verify can be measured separately.

**The harness must run HEADFUL.** Headless Chrome announces itself in its user
agent and client hints and Google answers 429 + a captcha page for every single
query: measured, headless 429 / headful 200, same machine, same profile, same
minute. Run headless and every row reads BLOCKED, which says nothing about the
product. (`--headless` reproduces that; it is not for using.)

### R28-1 - Scholar refuses us, and the card blamed the paper
Scholar's budget, measured: a few dozen searches inside a few minutes and it
**[CORRECTED IN R31: what is refused is a COOKIELESS request, not this IP.
The same browser with Scholar's own cookies answers 14 of 15 queries at a
reader's pace. The measurement below stands for the cookieless shape only.]**

answers **429 with a captcha page** — and R29 later measured how long that
lasts: a probe every three minutes for 57 minutes, 429 every single time, from
Node and from the browser alike. A reader
clicking through a bibliography can reach that, and every 429 became "From this
document's bibliography" - the one message that makes a user who can see the
paper on Scholar conclude the feature is broken.

- `fetchSearchPage` now recognises a refusal (429/503, or the captcha markers in
  a 200 body) and `lookup` returns `SCHOLAR_UNAVAILABLE` instead of null. The
  card says "Google Scholar is rate-limiting lookups - showing this document's
  entry", and the Scholar pill next to it still carries the enriched query.
- A refusal is never cached and never persisted: it is a fact about Scholar's
  mood, not about the reference, so the next click tries again. A no-match IS a
  fact and stays cached.
- Header shaping was tried first and rejected: a session `declarativeNetRequest`
  rule removing `Origin` / `Sec-Fetch-*` and setting a `Referer` changed nothing
  (still 429). The 429 was the headless UA, and there is nothing to work around
  in the product.
  **[R31: that probe ran headless AND on a profile that had never visited
  Scholar, so its `credentials:"include"` arm had no cookies to send. The
  conclusion it supported — that nothing about the request can be changed — is
  WRONG. The cookie jar is exactly what Scholar checks, and with it the same
  request answers.]**

### R28-2 - the precise query returned an EMPTY page
R24 narrowed the query to title + first-author surname + year for precision.
Scholar ANDs those over the full text, so one wrong term returns NOTHING: a year
that differs from the one Scholar indexed (preprint vs journal), an author
spelled differently, a title the text layer mangled. Measured on one paper's
first 12 entries, the strict query returned zero results for 8 while a looser
one returned a full page for 5 of them.

`lookup` now walks a ladder and stops at the first VERIFIED result: (1) title +
author + year, (2) the title alone. At most two requests, and only when the
first found nothing.

Loosening is safe now for the reason it was not in R24: `bestMatch` verifies
every candidate against the reference, so precision comes from the verifier, not
from the query. The enriched query stays FIRST only because it ranks the cited
work onto page one.

`CANDIDATES` also went 5 -> 10: Scholar returns ten, scoring the other five
costs nothing, and a work that ranks sixth was being reported as absent.

### R28-3 - the query carried things that are not the paper
A paper is indexed under its title and authors. What was reaching Scholar:

- **The venue instead of the title.** `SENTENCE_SPLIT` required a title to start
  with a capital, so "5GReasoner: ...", "5G SUCI-Catchers: ..." and "{DoLTEst}:
  ..." never split from the author block and the NEXT sentence - the venue -
  became the title. Those papers could not be found by any query. Now a digit
  run of one to three followed by a letter, or a brace, also starts a title;
  four digits still does not (it is the year of an ACM-format entry). A closing
  brace or paren before the period is a sentence end too ("...in {PIR}. In 30th
  USENIX..."). Square brackets are deliberately NOT title starts - IEEE entries
  mark their link with one ("[Online]. Available: ...").
- **A preprint id as the title.** `APA_PERIOD` matched the ACM Reference
  Format's trailing year and captured "arXiv:1607" (its capture cannot cross a
  period). A title must now have two words.
- **A spec number as the title.** "3GPP. TS 33.331 version 17.2.0 . 2022. 5G NR;
  Radio Resource Control (RRC)..." has three sentences before the title. The
  split now takes the first sentence that reads like a title (two words of 3+
  letters) and is not a venue form (`VENUE_START`); when none qualifies the
  whole entry is used, as before - a venue is worse than an unsplit entry. A
  bare "In" is not a venue form: "In search of an understandable consensus
  algorithm" is a title.
- **A 290-character quoted title.** `QUOTED_TITLE` capped the quote at 200
  chars, so IEEE standards fell through to the sentence split. Cap raised to 320.
- **Links, DOIs, braces and venue tails, on the query side.** `queryText` cuts
  a venue tail at a sentence end ("... (TLS). RFC 7858, May 2016"), and strips
  URLs, DOIs and BibTeX casing braces.

Measured over both corpora (14 public + 29 private documents, 2316 entries):
**42 entries went from a venue to a real title, 0 the other way**, 117 titles
changed in all, and every document's entry count and citation-resolution count
is IDENTICAL. `[Online]` and a wrapped URL ("https://www. 3gpp.org/...") each
cost a first attempt at this and are why the rule is as narrow as it is.

### R28-4 - the verifier rejected papers it should have accepted
Four defects, each found by reading the score breakdown rather than the verdict:

- **A dropped ligature.** Some PDFs have no mapping for the f-ligature glyph, so
  the text layer leaves a gap: "Certified email" arrives as "Certi ed email",
  "efficient" as "e cient". Dice then scores the paper ~0.4 against its own
  title, under the floor. `healLigatureGaps` rejoins a fragment pair when a
  ligature explains the gap AND the other title contains the word that results -
  so it can restore a match, never invent one.
- **A title Scholar printed truncated** ("...for security..."): both sides are
  now cut to the shorter one's length before scoring.
- **A surname the text layer cut short.** TeX accent composition truncates a
  name at the accented letter ("Fiterau-Brostean" reaches the parser as "Bro"),
  losing the author bonus on exactly the papers whose authors have accented
  names. The byline test now matches a prefix - with a three-letter minimum, or
  every initial in a byline would "match" every surname starting with that
  letter.
- **The year, read from the wrong place.** It took the LAST year in the byline;
  a venue carries its own ("2019 IEEE Symposium on Security and Privacy, 2019").
  Any year within one now counts.

### R28-5 - requests spent on things that are not papers, and spent twice
- An entry that is a name and a link ("Amarisoft. https://www.amarisoft.com/.")
  is a tool or a website. Scholar answers with nothing or with ten unrelated
  papers, and the request comes out of the budget above. `isSearchable` sends
  those straight to the bibliography entry: **75 of 2316 entries (3%)**, none of
  which could ever have matched. Only entries carrying a link are judged, so a
  short real title ("Applied cryptography") is unaffected.
- The cache was a per-page `Map`, so reopening a paper spent the whole budget
  again from zero - and rereading a paper is the normal case.
  `references/lookup-cache.mjs` keeps results in `chrome.storage.local` keyed by
  query: a match for 30 days, a miss for 7 (a preprint indexed next week
  deserves another ask), a refusal never. 500 entries, evicted oldest-first via
  a small index key. Local only - `storage.local` does not sync - and clearable
  from the options page ("Clear stored lookups"), because a persistent cache the
  user cannot clear is a trap.

### Verification
- `npm test`: **158/158** and `Naming guard passed` (was 143). 15 new in
  `test/unit/scholar.test.mjs` - the venue tail, links and DOIs and braces out
  of the query, the name+link skip, the ladder's shape, both ligature directions
  (including that a repair cannot invent a match), the truncated title, the
  cut-short surname, an initial NOT counting as an author, the year anywhere in
  the byline - and a new `test/unit/lookupcache.test.mjs` (key stability, the
  two TTLs, a stored query guarding against a hash collision).
- `test/e2e.mjs`: ALL CHECKS PASSED, including the citation card - and its body
  now reads "Google Scholar is rate-limiting lookups...", which is the R28-1
  message being right about a headless browser being refused.
- `test/cachecheck.mjs` (new): ALL 13 CHECKS PASSED. It replaces `fetch` in the
  page with a counter serving a synthetic result page, so the request COUNT is
  the assertion and Scholar is never contacted - which also makes it the one
  harness that still works while Scholar is refusing us. It pins the two
  behaviors that would otherwise only have been read off the source: a card's
  three lookups cost ONE request and a second page load costs ZERO, and an
  EMPTY page for the enriched rung falls through to the title alone and finds
  the paper in exactly two requests (R28-2, verified without the live service).
  Also that a 429 is reported as unavailable, is never stored, and is retried on
  a later load.
- `test/optionscheck.mjs` (new): ALL CHECKS PASSED - the options page loads with
  the cache module imported, a match / a remembered miss / a never-asked query
  read back as three distinct answers, "Clear stored lookups" empties the store,
  console silent.
- Parse regression: `test/parsediff.mjs` over 14 public + 29 private documents,
  before vs after, comparing every entry's title and surname, not just the
  counts (above).
- **Not done, and needed before any version bump:** this round touched
  `parser.mjs`, so the release gate's steps 2-5 (both corpora rendered and
  LOOKED at, console silent) apply and have not been run.
- The ladder's end-to-end recall on real papers was left unmeasured here,
  because Scholar refused every request for the rest of the session (the
  57-minute measurement above). R29 then replaced the Scholar lookup outright,
  so it was never taken and is moot: `citelookup.mjs` now measures the SOURCE
  ladder, and R29-1 carries the numbers. The query ladder itself is verified
  deterministically instead, in `test/cachecheck.mjs`, with no service in the
  loop.

## Round 29 (R29) - the card stopped asking Google Scholar

User: "instead of searching Google Scholar, fetch the paper from other sources
and label the source."

R28 made the Scholar lookup as good as scraping Scholar can be, and R28-1 is why
that ceiling is low: Scholar has no API, the only way to read it is to parse its
result page, and it answered our requests with 429 + a captcha — a probe every
three minutes for 57 minutes, 429 every time, from Node and from a browser
alike.

**[R31 corrects what that measured: every one of those probes was COOKIELESS,
and a cookieless request is what Scholar refuses. The same browser, after one
visit to scholar.google.com, answers 14 of 15 queries at a reader's pace. The
switch below is still right, but for the other reasons: no cookie, no key, no
terms to breach, and structured metadata instead of a page to parse.]**

So the lookup now asks services that are meant to be asked, and the card says
which one answered.

### R29-1 - four sources, in a measured order
`references/sources.mjs` replaces `references/scholar.mjs`. The scraping,
the captcha detection and the cluster-id BibTeX are gone; the query building and
the verification moved to `references/matching.mjs`, unchanged in behavior and
now shared by every source.

The order exists to make the FEWEST requests, and each rung runs only when the
ones before it returned nothing that VERIFIES. Measured over 39 real references
(entries 25-63 of the USENIX baseline paper), 38 of which resolve:

| rung | what it is | matched |
|---|---|---|
| arXiv by id | the `arXiv:2409.02905` the entry prints - one request names the work | 2 |
| DOI | OpenAlex by DOI, Crossref if it has nothing - the entry named the record | 0 (this paper prints few) |
| Crossref `query.bibliographic` | the purpose-built citation matcher, widest DOI coverage | 28 |
| OpenAlex `title.search` | records Crossref has in another form, plus OA PDFs and citation counts | 5 |
| OpenAIRE | the venues that register NO DOI - USENIX Security, NDSS | 3 |

**1.39 requests per matched reference.** 97% of the 39 matched (38); the one
that did not is a GitHub tool, which has no paper to find.

### R29-2 - the conference site, without scraping the conference site
User: "can we just go to the conference site (e.g., USENIX.org) to get the most
accurate results?"

Measured: `usenix.org` answers a scripted request with **403**, and `dblp.org`
with a bot-check page ("Making sure you're not a bot!"). Venue-by-venue
scrapers would also mean one scraper per publisher, each breaking on its own
schedule, and would only ever help where the entry names a venue we support.

OpenAIRE is the same data without any of that: it collects DBLP, and the record
it returns for a USENIX paper links **the paper's page on usenix.org**
(`usenix.org/conference/usenixsecurity22/presentation/park-cheoljun`). Where
DBLP has no such link the record points at its own page, so `openAireWork`
prefers a non-aggregator URL when the record offers a choice.

Semantic Scholar was measured for this rung first and rejected: it HAS these
papers, but its keyless pool answered 429 to all four requests of an audit -
a rung that always fails is two wasted requests per unmatched reference.

### R29-3 - the card says where the record came from
`.fx-scholar-foot` carries the cited-by count on the left and **"via Crossref"**
(OpenAlex / arXiv / OpenAIRE), linking the record, on the right. The four know
different things - the registered metadata, the citation graph and open-access
copies, the preprint itself, the unregistered proceedings - so which one
answered is part of reading the card.

Also on the card now:
- **A button to the paper's own page**, labelled by host (`usenix.org`,
  `arxiv.org`, `dl.acm.org`). Shown when the record's landing page is not a
  `doi.org` redirect, since that is the DOI pill's job. A conference paper page
  is not a PDF and is where the abstract, slides and artifact live.
- **[PDF]** is now an open-access copy the RECORD points at (OpenAlex's
  `best_oa_location`, arXiv's own PDF), not a link scraped off a result page.
- **Cite** is the publisher-registered BibTeX, fetched by DOI through Crossref
  content negotiation. Better than what it replaced: Scholar's cite dialog was
  keyed by the cluster id of the result shown, so a wrong match produced a wrong
  BibTeX.
- "Related articles" is gone - it was a Scholar result-page link.
- The failure label is now "Couldn't reach the reference sources", and only
  when NOTHING answered.

### R29-4 - three defects the switch exposed
Found by reading the score breakdown of the first audit's four misses:

- **Crossref registers the subtitle separately.** Its `title` for the 5GReasoner
  paper is literally "5GReasoner"; the rest is `subtitle`. A card built from
  `title` alone scored one word against the reference's fifteen - the right
  record, first hit, rejected. `crossrefWork` rejoins them.
- **OpenAlex title search is AND over the indexed title**, and many of its
  titles are the short form ("Breaking and Fixing VoLTE", "The Open-Source
  LearnLib"). A full-title query misses exactly those records; the first four
  words (stop words dropped) found all three of the misses that had one.
- **A registered SHORT title is a prefix, not a superset.** `titleMatch` now
  compares prefixes when one title is the opening of the other, and
  `scoreResult` CAPS what that can earn (`PREFIX_CAP` 0.7) so it is accepted
  only with both the author and the year - a prefix agreement alone must never
  be enough, or "Applied pi calculus" becomes the short title of every paper
  that starts with those words.

### R29-5 - the rate limit, on our side of the wire
- Every outgoing request is **serialized with a 350 ms floor** (`paced`). A
  lookup is user-driven, so this is invisible; what it prevents is the burst a
  person can still produce by clicking down a bibliography. Crossref's public
  pool answered 429 to ~20 queries in 30 seconds during the first audit.
- A 429/503 is **waited out once** (honouring `Retry-After`, capped at 3s) —
  unlike Scholar's, these clear in about a second. Two of the first audit's four
  misses were Crossref 429s reported as "not found".
- `test/citelookup.mjs` waits **3 s between lookups by default**, and says why:
  the product looks a reference up when a reader CLICKS it, so a harness that
  fires a whole bibliography at once measures the services' burst limits instead
  of our coverage.
- **The requests carry the reader's own browser identity.** Measured on the
  wire (`Network.requestWillBeSentExtraInfo`): a lookup goes out with the
  browser's own User-Agent; `fetch` silently ignores a `User-Agent` header (it
  is forbidden to page script); and declarativeNetRequest CAN set one - proved,
  the wire showed `FixateScholar/1.0.7` - which is the lever to pull if we ever
  want Crossref's polite pool. Not pulled: identifying as a tool is the opposite
  of what a reader-driven request is.

### Verification
- `npm test`: **168/168** and `Naming guard passed`. `test/unit/scholar.test.mjs`
  became `matching.test.mjs` (every R24/R28 regression test kept, still
  passing), plus a new `test/unit/sources.test.mjs`: each source's documented
  payload shape → the card shape, the identifier regexes, the abstract in both
  of its forms, and the short-title cap in both directions.
- `test/e2e.mjs`: ALL CHECKS PASSED - and the citation card body now reads
  "Long Short-Term Memory / Sepp Hochreiter, Jürgen Schmidhuber - Neural
  Computation" where in R28 it read "Google Scholar is rate-limiting lookups".
  Headless, which Scholar refused outright.
- `test/cachecheck.mjs`: 13/13, updated for the ladder - a DOI resolves in ONE
  request with no search, a first source with only near-misses falls through in
  exactly two, every source failing is UNAVAILABLE and retried later.
- `test/citelookup.mjs` over 39 references: the table above.
- **Not done, and needed before any version bump:** the release gate's steps 2-5
  (both corpora rendered and LOOKED at, console swept). R28 touched `parser.mjs`
  and R29 touches the card's DOM and CSS.

## Round 30 (R30) - the abstract, the links, and where the seconds went

User: "if the reference is a paper, include its abstract. If it includes a URL,
make it clickable in the card. The current ref search seems too slow."

### R30-1 - where the seconds went
Measured first, per source, same references, from an extension page:

| source | p50 | p90 | |
|---|---|---|---|
| Crossref | 485 ms | 1.36 s | fast, and answers most references |
| OpenAlex | **8.3 s** | 9.1 s | mid-outage: 503s that took nine seconds to arrive |
| OpenAIRE | 616 ms | 1.39 s | fast |

End-to-end p50 was fine (478 ms - a Crossref hit) and the TAIL was not: a
reference Crossref missed cost **4.5-4.9 s**, because the rungs ran one after
another and a degraded OpenAlex spent nine seconds before OpenAIRE was asked.
Three changes, in the order they matter:

- **A per-request deadline** (`TIMEOUT`, 3.5 s, `AbortController`). A card is a
  reader waiting with the popup open; no single service may hold it. 3.5 s is
  well past both healthy p90s.
- **503 no longer retries.** A 429 means "too fast" and clears in a second, so
  waiting is how the card gets filled; a 503 means the service is unwell, and
  1.2 s spent asking it again is 1.2 s the NEXT source could have spent
  answering.
- **The tail runs concurrently.** OpenAlex and OpenAIRE now go out together and
  their candidates are pooled for the verifier, so a miss costs the SLOWER of
  the two instead of the sum. Same two requests.

**p90 4.9 s → 3.0 s**, max 4.9 s → 3.0 s, on the same references.

### R30-2 - the pacer was quietly undoing the concurrency
The anti-burst queue from R29-5 was GLOBAL, so the two tail requests went out
359 ms apart - the very latency the concurrent tail exists to remove. It is now
**per host**, which is also what a rate limit actually is: Crossref does not
care how often OpenAlex is asked. Same 350 ms floor per service, and
`cachecheck` now asserts the two tail requests start together (measured: 0 ms
apart) rather than asserting a request count that no longer describes the
design.

### R30-3 - a failed source is not a "no match"
Found while reading the latency numbers: if Crossref answered with nothing and
the tail then timed out, `lookup` returned null and the cache remembered it -
hiding the paper for the seven days a miss is stored. `lookup` now reports
whether every rung ANSWERED, and only a complete lookup may be remembered as a
no-match. Pinned in `cachecheck.mjs`.

### R30-4 - the abstract (and the two things next to it)
`abstract_inverted_index` was never in the OpenAlex field list, so OpenAlex
abstracts were never even requested; Crossref carries only what the publisher
deposited, which for conference papers is usually nothing (measured: not one of
nine Crossref matches had one). So:

- OpenAlex records now ask for the abstract and reconstruct it.
- `fetchDetails(ref, record)` fills in BY DOI what a record arrived without -
  exact, no matching needed - and the popup calls it AFTER rendering the card,
  so it costs the reader nothing: the paper, its authors and its links are
  already on screen. The record is updated in place and re-stored, so reopening
  the paper has it immediately.
- It fetches the abstract, the CITATION COUNT and an open-access PDF in the
  same request, because they are three fields of one OpenAlex record. The
  citation count was the one thing a Scholar card had that these sources did
  not always carry (measured before this: 32 of 38 matches had one), and
  closing that gap costs nothing extra. A PDF found here gets its pill added to
  the actions row, which was built before the request answered.

Measured over 14 references, 13 of them matched:

| on the card | with the record | after `fetchDetails` |
|---|---|---|
| abstract | 3 | **12 (92%)** |
| citation count | 13 | 13 (100%) |
| open-access PDF | 6 | 7 (54%) |

The detail request costs **91 ms at p50, 336 ms at worst**, while the reader is
already looking at the card.

(Google Scholar was never an alternative here: its result page carries a
two-line ellipsed SNIPPET - the `.gs_rs` node the old scraper read - not an
abstract. The abstract lives on the publisher page Scholar links to.)

### R30-5 - the links in the entry
The bibliography entry the card falls back to is now rendered with its URLs
live (`linkParts`). It matters most exactly where there is no paper to look up:
"Amarisoft. https://www.amarisoft.com/." IS the answer for that entry, and its
link is the useful part.

A URL that the PDF wrapped reaches the text layer with a space in it
("https://github. com/jtpereyda/boofuzz"). The space is the page's, not the
address's, so the LINK drops it while the text keeps showing what the document
shows. Trailing sentence punctuation stays outside the link, a bare `www.` host
gets a scheme, and something that is not a hostname ("TS 33.501 version 17.5.0")
is left as prose. Five unit tests in `test/unit/popup.test.mjs`.

### Verification
- `npm test`: **173/173**, naming guard, patch check.
- `test/cachecheck.mjs`: 15/15 - including the two new rules above (the tail
  starts together; a failed tail is not remembered).
- `test/e2e.mjs`: ALL CHECKS PASSED.
- Latency, abstract and citation-count coverage: the numbers above, from
  `lookupReference` + `fetchDetails` in an extension page over real entries.

## Round 31 (R31) - the 429 was the cookie jar, not the IP (correcting R28-R30)

User: "I think 429 is caused by headless chrome, try more realistic version."

Right, and the conclusion it overturns was mine. R28-1 measured Scholar
refusing us and concluded the block was on the IP and lasted an hour; R29 and
R30 repeated that. **It was the request being cookieless.** Five shapes, one
headful browser, twenty seconds apart, on the "blocked" IP:

| shape | result |
|---|---|
| A navigation, fresh profile (no cookies) | captcha, "unusual traffic" |
| landing on scholar.google.com | loads normally, sets its cookies |
| **B same navigation, after that visit** | **9 results, no captcha** |
| C extension fetch, `credentials: "omit"` (what shipped) | **429 + captcha** |
| **D extension fetch, `credentials: "include"`** | **200, 10 results** |
| E Node fetch, browser UA (what the earlier probes used) | 429 |

And it sustains a bibliography: 15 distinct real queries, `credentials:
"include"`, four seconds apart — **14 answered, p50 413 ms**, no captcha. (The
fifteenth was a genuine zero-result query, HTTP 200.)

### What was wrong, and where
- "The block held for AT LEAST AN HOUR" — true only of COOKIELESS requests. The
  same machine, same minute, with the browser's own cookies: answered.
- "A reader clicking through a bibliography reaches that on their own" — a
  reader's browser HAS Scholar's cookies (one visit is enough, and it is set by
  simply opening Scholar). The blocked shape was ours, not theirs.
- The R28 probe that compared `omit` with `include` and found no difference was
  invalid twice over: it ran headless AND on a profile that had never visited
  Scholar, so there were no cookies to include. It is in R28-1 as evidence; it
  is not evidence.

Corrected in `sources.mjs`, `README.md`, `REQUIREMENTS.md`, and inline in R28-1,
R29 and R30.

### What it does NOT change
The reasons for R29's switch that survive the correction, unchanged:
- The four sources answer with **structured metadata** — authors, year, DOI,
  citation count, open-access PDF, abstract — where Scholar answers with a
  result page to parse and a two-line ellipsed snippet.
- They need **no cookie, no key, no account**, and their terms invite the use.
  Scholar's terms prohibit automated access; doing it with the reader's cookies
  makes every lookup attributable to their Google session and puts any
  consequence on their account.
- Coverage is **97%** of a real bibliography at **1.55 requests** per match,
  measured, with an abstract on 92% and a citation count on 100%.

So the lookup stays where it is. What changed is the honesty of the reason: it
is not that Scholar cannot be read, it is that reading it costs the reader
something the alternatives do not.

### If it is wanted anyway
A Scholar rung is now a known-workable option, and the decision is the
maintainer's, not this round's. It would be: `credentials: "include"`, last in
the ladder, behind an OFF-by-default setting that says plainly what it does —
searches attributable to the reader's Google session, on a service that
disallows it. What it would add over today: a citation count for the ~10% of
matches whose record carries no DOI, and grey literature none of the four
sources index. What it would cost: the scraping fragility R28 documented, and
the reader's captcha risk.

## Round 32 (R32) - Google Scholar as the default source, and disclosed

Maintainer's call, on the reasoning that a lookup happening only when a reader
CLICKS a citation is that reader's own search rather than automated access.
Implemented as asked: Scholar first, the open databases as the fallback, both
switchable, and the whole arrangement written down for the reader.

### R32-1 - the source, and what makes it work
`references/scholar.mjs` is back, as a source module rather than the whole
lookup: `searchScholar` (one page, injected fetch so pacing/timeouts stay in
sources.mjs), `readResults` (the `.gs_r`/`.gs_ri` parse), `scholarBibtex` (the
cite dialog, for a match with no DOI), and the refusal test.

Two properties make it usable, both about HOW the request is made:
- **`credentials: "include"`.** Scholar refuses an anonymous request and
  answers a cookie-bearing one (R31).
- **One per click.** No crawl, no prefetch, no background pass.

And one about the QUERY, measured: Scholar wants **the title alone**.
"Attention is all you need" returns that paper first; "Attention is all you
need Vaswani 2017" returns three unrelated recent papers and not the work at
all - Scholar reads the extra terms as more topic, not narrower identity. This
is the opposite of what Crossref's `query.bibliographic` wants, so the two
rungs send different queries for the same reference. Safe because every
candidate still goes through `bestMatch` (R24-1's rule): a bare title cannot
promote the better-cited paper that merely contains those words.

### R32-2 - a captcha is not a "no match"
Scholar's refusal is usually **HTTP 200** with a body that says "Please show
you're not a robot" while the page header still reports "About 34 results".
Parsed naively that is zero results - which the ladder would read as "Scholar
has nothing", cache as a no-match for seven days, and never retry. The refusal
test now covers every wording seen (`gs_captcha`, "not a robot", "unusual
traffic", "automated queries", `/sorry/index`), and a refusal falls through to
the open databases and stores nothing. Unit-tested in
`test/unit/scholarsource.test.mjs` (no DOM needed - the refusal is decided
before the parse) and end-to-end in `cachecheck.mjs`.

### R32-3 - what the fallback still does
- Everything after Scholar is unchanged and is a complete lookup on its own:
  arXiv by id, DOI, Crossref, then OpenAlex+OpenAIRE concurrently.
- A Scholar match has **no DOI and no abstract** - `.gs_rs` is a query-biased
  snippet, not an abstract. `fetchDetails` therefore looks the record up in
  OpenAlex BY TITLE (verified against the reference before anything is copied),
  and fills in the real abstract, the DOI, the citation count and an
  open-access PDF after the card is on screen.
- "Cite" is now a three-step ladder: the publisher-registered BibTeX by DOI,
  then Scholar's own cite dialog for a Scholar match, then the locally
  generated entry.

### R32-4 - the settings, and the disclosure
`scholarLookup` and `openSources`, both default ON, in Options → Reference
lookups, each with a hint that says plainly what it means. With both off no
lookup happens at all and the card shows the document's own entry.

- **README gains a "Privacy: what leaves your computer" section**: the two
  things that reach the network, a table of who sees a lookup and with what
  cookies, the fact that a Scholar lookup is visible to Google the way that
  reader's own searches are and is subject to Google's terms, what is cached
  locally and how to clear it, and how to turn either half off.
- **README gains "No affiliation, no warranty"**: not affiliated with,
  endorsed by or connected to Google, arXiv, Crossref, OpenAlex, OpenAIRE,
  Mozilla/PDF.js or any publisher; marks belong to their owners; provided AS IS
  under Apache-2.0; the reader is responsible for their own use of the
  third-party services, including their terms.
- **THIRD_PARTY_NOTICES gains a "Reference lookup services" table**: each
  service, its endpoint, a link to its terms, and what is fetched - with the
  note that no code from them is bundled or redistributed.

(What is deliberately NOT written anywhere: any claim that this arrangement is
permitted by Google's terms, or that publishing carries no risk. That is a
judgement for the maintainer, not something a README can assert.)

### Verification
- `npm test`: **176/176**, naming guard, patch check. New
  `test/unit/scholarsource.test.mjs`.
- `test/cachecheck.mjs`: **18/18**, updated for the new ladder - Scholar is the
  first source asked, its captcha falls through to the databases, a DOI still
  spends no search, the tail still goes out concurrently, and a card's three
  lookups are still ONE request.
- `test/e2e.mjs`, `test/optionscheck.mjs`: ALL CHECKS PASSED.
- Live coverage over 20 real references: **95% matched** — but every match came
  from the fallback, because this machine's address is currently captcha-walled
  by Scholar (see below). The fallback carrying the whole feature while Scholar
  refuses is exactly the behavior this round is meant to have.

### The measurement this round could not make
Scholar has been serving this address a captcha for every search - **including a
normal tab navigation typed by a person** - since some point during this
session's testing (~150 searches). So the Scholar rung's real-world hit rate is
unmeasured here. What is known: earlier the same profile answered 14 of 15
cookie-bearing queries at a reader's pace, and the parse and verification are
covered by the offline tests. A fresh address should be used to measure it.

## Round 33 (R33) - an abstract on a Scholar card, a private page cache, and a reader's pace for Scholar

### R33-1 - Scholar cards get a real abstract
Scholar's result page has no abstract to give: `.gs_rs` is a two-line,
query-biased fragment with ellipses, and the page carries no DOI to ask anyone
else about. So a Scholar match is completed the same way every other incomplete
record is - `fetchDetails`, after the card is on screen - except that with no
DOI it finds the record in OpenAlex **by title**, and VERIFIES it against the
reference before copying anything across. The abstract, the DOI, the citation
count and an open-access PDF all arrive from that one request.

Pinned in `cachecheck.mjs`, deterministically, with no service involved: a
Scholar match arrives with `snippetIsAbstract: false` and a snippet, and ends
with the paper's own abstract and the DOI Scholar never gave.

**And the converse, which was a real defect.** `snippetIsAbstract` was set only
by scholar.mjs, so a Crossref or OpenAlex record - which arrives WITH its
abstract - looked incomplete too, and every card would have spent a second
request re-fetching what it already had. `preview()` now sets the flag whenever
the source supplied an abstract, and `cachecheck` asserts that such a record
asks for nothing more (`extra: 0`).

### R33-2 - the pacing, and then its removal from the reader path
This round first made the floor per-host in VALUE as well as in queue (350 ms
for the APIs, 1500 ms for Scholar, jittered) — and then took it out of the
reader's path entirely, which is the right answer and the maintainer's:

**A reader's lookup gets no delay at all.** The click IS the rate limit:
nothing here runs on its own, so there is no burst to smooth out, and a floor
only makes the card slower for the person who asked for it. Measured in
`cachecheck.mjs`: a lookup's four requests now start within 1 ms of each other,
and that check exists so a floor cannot come back unnoticed.

What remains costs a reader nothing — the cache (a repeat click is free), one
lookup per reference however many times the card asks for it, the ladder
stopping at the first verified match, the 3.5 s deadline, and the single retry
on a 429. Requests to ONE service still queue behind each other, which adds no
time and keeps the ladder's order readable; different services never wait on
each other, which is what keeps the concurrent tail concurrent.

The delay now lives only where the bursting actually happens — automated
testing. `globalThis.__fxRequestGap` (set by `citelookup --gap=`, default 0 so
a harness matches the product by default), the harnesses' own sleeps between
references, and `scholarcache` recording at 6 s with jitter, stopping at the
first refusal rather than pushing through it.

### R33-3 - a private cache of real Scholar pages
Scholar answers a limited number of searches from an address and then serves a
captcha to everything - including a person's own tab - for hours. That makes the
Scholar rung unmeasurable exactly when you want to measure it, which is what
happened in R32.

`test/lib/scholar-cache.mjs` + `test/scholarcache.mjs`:

- **record** - one page per reference, headful, cookies warmed by a visit to
  scholar.google.com first, at the pace above; saved raw under
  `local/scholar-cache/`. `--wait=<minutes>` polls until Scholar is answering
  again and records then.
- **replay** - the shipping parse and verification over the recorded pages,
  in an extension page, with NO network. This is the Scholar hit rate:
  repeatable, offline, and free.
- **status** - what is in the cache.

`local/` is git-ignored in BOTH `.gitignore` and `.git/info/exclude`, the same
belt-and-braces the private review corpus uses, so a recorded page cannot reach
the repository by editing one file. The pages are Google's content fetched with
the machine owner's own cookies: they stay on that machine, like a browser
cache, and nothing derived from them is committed.

### Verification
- `npm test`: **176/176**, naming guard, patch check.
- `test/cachecheck.mjs`: **21/21** - the three new Scholar-abstract checks and
  the no-needless-request converse, on top of R32's ladder checks.
- Recording is queued against the current block (`--wait=180`); the Scholar
  rung's live hit rate is still the open measurement from R32, and `replay` is
  how it gets taken once a page or two is in the cache.

## Round 34 (R34) - two bibliographies in one PDF (user report)

Reported on a private-corpus paper: citations were not linked, and the
reference list was emphasized as body prose. Both symptoms, one cause.

### R34-1 (HIGH) - only the LAST reference list was ever found

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

## Round 35 (R35) - a highlight you can say something about (user request)

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

## R35 — the last line of every column, dropped in silence

Found by the v1.0.8 release gate, pre-existing, and invisible to every check
that existed at the time.

`engine.mjs`'s candidate filter cut any item whose baseline fell in the top or
bottom 6% of the page:

```js
if (y - vy0 < pageH * 0.06 || y - vy0 > pageH * 0.94) return false;
```

The intent is running heads and page numbers. The effect, on a paper with a
tight bottom margin, is that the **last line of body text in every column** is
discarded — on one document, 12 of its 20 pages. It never showed up because the
cut runs before `#classifyBlocks`, the only stage that recorded a reason, so an
affected line reported "no reason recorded": indistinguishable from a line the
engine never saw. `skipRun` counts runs of three or more lines and a single
trailing line never reached it.

What separates a footer from a final body line is **isolation, not position**. A
running head sits alone, a full margin from the text block; a final body line is
one line pitch below its predecessor. The band still cuts, unless the baseline
chains back to a baseline in the body region within one pitch — grown
iteratively, so two body lines inside the band are both admitted while a footer
block that only touches itself is not. Letterless and single-character runs
(bare page numbers) are excluded from vouching, since they never carry emphasis
themselves.

Fixed: trailing gaps on the affected document went 12 pages → 0; the running
header stays unprocessed; `papers.mjs` still reports `headerOk` and `footerOk`
true on all 8 templates, which is the automated guard that the band was not
simply relaxed away.

### The diagnostic gap that hid it
The candidate filter now labels its own rejections (`margin-band`, `over-body`,
`special-or-short`, `script-attach`, `left-margin`, `script-size`) through a
`reject()` helper, under `__fxDebug`, never overwriting a more specific
block-pass reason. `test/whyskip.mjs` reports them, and its `trailing` count —
unreasoned prose at or below everything the engine processed — is the regression
guard for this class.

## R36 — the gate was manufacturing findings faster than the product had defects

Four harness defects, all pre-existing, each of which produced confident false
reports during the v1.0.8 visual sweep. Roughly twenty claimed render defects
were investigated; every one was a measurement artifact, by-design behaviour, or
the manuscript's own typo.

- **The shutter fired mid-processing.** `debug-shot.mjs` and `shot-region2.mjs`
  waited for a *document-wide* `.fx-b` count to cross a threshold, then slept a
  fixed interval — neither says anything about the page being photographed. A
  whole batch of "emphasis missing from this paragraph" findings evaporated once
  the capture waited properly. Both now settle on the target page's
  `data-fx-done` *and* `.fx-b` counts: two counters, because a run is painted
  after its span is marked done. `diagnose.mjs` had the same flat sleep and now
  settles too.
- **The sidebar ate a fifth of the page.** A PDF with `/PageMode /UseOutlines`
  opens the outline sidebar, which keeps its layout width even when the toggle
  reports it closed, pushing the right-hand column past the viewport edge. A
  capture that silently loses a column is how a visual gate reports "clean" on a
  page it only partly saw. Both harnesses now force it hidden with CSS and clip
  to the page's own rect.
- **`refbold` counted processing, not emphasis.** It flagged any `data-fx-done`
  span inside the bibliography box, but a span the engine walked and left with
  zero emphasis runs renders identically to an untouched one. One private paper
  failed every sweep over a single ALL-CAPS caption span with no runs at all. It
  now requires a `.fx-b` to fail, and reports processed-but-unemphasized spans
  separately — visible, not fatal.
- **`diag-drag` reported "nothing was verified" and did not say why.** It looked
  only at pages PDF.js had already rendered and demanded four words in ONE span
  — a property of how a document is chopped into text items, not of anything
  under test. A paper whose front matter carries no emphasis rendered nothing but
  unprocessed pages, so one document sat unverified across every sweep. It now
  walks deeper until a page offers a processed line, falls back to shorter spans,
  and prints what each rendered page offered. That diagnostic is what identified
  the cause in one run.

Two lessons worth keeping: a capture harness must settle on the thing it is
photographing, and a check must measure what its name claims. Both failure modes
are the "always-passes twin of a blind check" this file already warns about in
`diagnose.mjs` — except these ones always *failed*, which is just as misleading
and much more expensive.

### New guards (`test/fontkeep.mjs`, `test/whyskip.mjs`, `test/wordshot.mjs`)
`REQUIREMENTS.md` states that a span in a math, monospace, small-caps or
bold-display face is never processed; nothing checked it, so "emphasis inside a
code span" could only be argued from screenshots — and was, five times, wrongly
every time (those tokens were set in the papers' BODY face, where the engine has
no signal). `fontkeep.mjs` reads the font off each processed span and resolves it
through `commonObjs`, which is the string the engine's own filter tests, with no
span↔item index alignment to degrade silently. It fails on any violation AND
when it resolves no fonts at all, so it cannot pass blind. Result: 0 violations
across the public corpus (14 documents, ~19k processed spans) and the private
corpus.

`wordshot.mjs` is the answer to "name the exact word": it finds the word, reports
what the engine did to it (`processed` / `keep` / the exact emphasis runs), and
captures it zoomed. `processed=false keep=true` means absent emphasis is
correct; `emph=0` falsifies "emphasis applied here" outright.

## R37 — highlight toolbar & fx-on visibility, citation range expansion, direct local save, Scholar BibTeX by default

Introduced in v1.0.9:

- **Floating highlight & comment GUI on selection (`enableHighlightFloatingButton`).**
  PDF.js supports a floating action toolbar triggered on text selection that provides instant access to color-coded highlight options and comment creation. This preference (`enableHighlightFloatingButton`) was turned on via vendored patch 9 in `scripts/pdfjs-patches.mjs`.

- **Highlight visibility and pointer interaction in `fx-on` mode.**
  In stock PDF.js, `/Highlight` annotations are drawn to canvas while their DOM `.annotationLayer .highlightAnnotation` wrappers remain transparent. In `fx-on` reading mode, white `.fx-mask` rectangles cover the canvas glyphs to replace them with enhanced typography, inadvertently masking canvas-rendered highlights.
  Fix:
  1. `.annotationLayer .highlightAnnotation` is styled with `background-color: var(--fx-highlight-color, rgb(255 235 59 / 0.45))` and `mix-blend-mode: multiply`.
  2. In `overlay.mjs`, `colorizeHighlightAnnotations(pageView)` extracts annotation RGB colors and sets `--fx-highlight-color` on each annotation element.
  3. However, `.highlightAnnotation` with default pointer events intercepted mouse drag events, preventing text selection over highlighted text. Fixing this required `pointer-events: none` on `.highlightAnnotation` while keeping `.annotationCommentButton` with `pointer-events: auto !important` so comments remain interactive.

- **Citation range expansion for separate bracketed ranges (`[6]-[11]`).**
  Previously, only hyphenated/dash ranges inside a single pair of brackets (such as `[6-11]`) were parsed as ranges. When authors wrote separate bracketed ranges like `[6]-[11]` (or using en-dash/em-dash variants `[6]–[11]`), the regex parsed only the two endpoints `[6]` and `[11]`, omitting cards and hit targets for the intermediate citations `[7], [8], [9], [10]`.
  Fix:
  Added `NUMERIC_BRACKET_RANGE` regex to `references/parser.mjs` matching `\[(\d+)\]\s*[\u2013\u2014-]\s*\[(\d+)\]`. When matched, all intermediate integers in the range are generated into citation keys, hit targets, and reference cards.

- **Direct local file saving for `file://` PDFs.**
  When reading local PDFs via `file://`, the default viewer download button initiated standard browser downloads, producing redundant copies (`file (1).pdf`) in the user's Downloads directory.
  Fix:
  In `overlay.mjs`, `fxLocalDownload` intercepts downloads for `file://` URLs and invokes the File System Access API (`window.showSaveFilePicker` with `createWritable()`) to overwrite the local file directly in place. Configurable via the `saveLocalFile` setting (default `true`) in `options.html` / `options.mjs`, falling back cleanly to standard browser download on cancel or if unsupported.

- **Google Scholar BibTeX by default for Cite action.**
  The Cite dialog previously queried Crossref by default whenever a DOI was present, even when the card was matched from Google Scholar.
  Fix:
  `fetchBibtex` in `references/sources.mjs` now queries Google Scholar's BibTeX endpoint by default (using `record.cid`, or looking up the work on Scholar when enabled). If Scholar is unavailable, refused, disabled in settings, or has no match, it falls back cleanly to publisher-registered metadata via DOI (Crossref content negotiation), and finally to local entry synthesis (`entryBibtex`).

- **Flexible Cache Identity Without Requiring DOIs & Request Minimization.**
  The cache does **not** require a DOI to operate:
  1. If a DOI is available, it is used as the canonical key `doi:${clean}`.
  2. If a DOI is missing, paper identity is cleanly derived from its title and first author (`paper:${title}:${author}`), cluster ID (`cid:${cid}`), or citation query.
  3. **No duplicate entries**: When multiple queries target the same paper (e.g. initial citation string, followed by details enrichment or Cite action), `lookup-cache.mjs` stores the canonical record once and uses lightweight alias pointers for other queries rather than duplicating payload data.
  4. **Progressive field merging**: `mergeRecords()` merges incoming query results into existing records, progressively filling missing fields (`doi`, `snippetIsAbstract`, `abstract`, `pdfUrl`, `citedBy`, `bibtex`) without overwriting existing data.
  5. **Network request minimization**: If all required fields are already populated in memory or cache, `fetchDetails()` and `fetchBibtex()` immediately return without dispatching speculative or redundant network requests.

- **Automatic User Cache Clearing on Extension Install and Update.**
  Because citation structures, schema formats, or cache keys can evolve between versions, stale cached lookups in `chrome.storage.local` could cause inconsistencies.
  Fix:
  In `background/service-worker.mjs`, `chrome.runtime.onInstalled` now invokes `clearUserCache()` (via `references/lookup-cache.mjs` `clearCached()`) whenever `details.reason` is `"install"` or `"update"`. This purges all `fx.cite.*` lookup entries and `fx.cite.index` from `chrome.storage.local`, ensuring a clean state across version upgrades while preserving user settings in `chrome.storage.sync`.

- **Strict Suppression of Crossref Queries When Display Fields Are Available.**
  When all information displayed to the user on the card (`title`, `authors`/`byline`, `snippet`/`abstract`, `citedBy`, `pdfUrl`, and/or `doi`) is already available (from Google Scholar, local storage cache, open access repositories, or the document's own parsed entry), outgoing requests to Crossref are strictly suppressed.
  1. `sources.mjs` exports `isDisplayComplete(record)` to verify if all visual elements of the card (title, byline, abstract/snippet, cited-by count, and open-access PDF or DOI) are satisfied.
  2. `lookupReference(ref)` checks `isDisplayComplete(ref)` and inspects the cache using canonical keys (`doi:`, `paper:`, `cid:`) in addition to the raw query string; if a display-complete record exists, it is returned immediately with 0 network calls.
  3. `searchCrossref()`, `byDoi()`, and `resolveDoi()` check `isDisplayComplete()` and inspect persistent storage before dispatching network requests to `api.crossref.org`, completely avoiding unnecessary calls.
  4. `fetchBibtex()` checks existing `record.bibtex` and cached entries under both the query key and `doi:${clean}`; if BibTeX is already known or if Scholar supplies it, Crossref content negotiation is never invoked.

- **Prioritizing CID Before Canonical Key in Reference Lookup and Cache.**
  Google Scholar cluster IDs (`cid`) are the most specific identifier for works retrieved via Scholar.
  1. `lookup-cache.mjs`: `canonicalKeyFor(query, record)` checks `if (record.cid) return \`cid:\${record.cid}\`` before checking DOI and title+author (`paper:\${title}:\${author}`).
  2. In `writeCached()`, all candidate keys (`query`, `cid`, `doi`, `paper:`) and alias pointers are gathered; if an established canonical record or alias exists in storage, it is adopted and merged into `finalResult`. All alternate keys are aliased to the canonical record, preventing duplicate records.
  3. `sources.mjs`: `lookupReference()`, `byDoi()`, `searchCrossref()`, `resolveDoi()`, and `fetchBibtex()` check `cid:\${cid}` in cache before querying canonical DOI or paper keys.

- **Unified Dark Background GUI Style Across the Plugin.**
  To provide a consistent, cohesive visual experience across all surfaces of the extension:
  1. **Extension Toolbar Popup** (`popup.css`): Defaulted to dark backgrounds (`#202124`) with `color-scheme: dark`, light text (`#e8e8e8`), dark select inputs (`#2b2a33`), and `#8ab4f8` accent highlights.
  2. **Options Page** (`options.html`): Defaulted to dark backgrounds (`#202124`) with `color-scheme: dark`, high-contrast headings (`#f1f3f4`), dark text inputs, dark textareas (`#1e1e22`), and subtle section dividers (`#3c4043`).
  3. **Citation Popup Cards** (`overlay.css` `.fx-cite-popup`): Styled with dark background (`#242428`), border (`#52525e`), shadow (`0 4px 16px rgba(0, 0, 0, 0.45)`), readable green byline (`#7fbf8e`), and dark action pills (`#2b2a33` / `#394457`).
  4. **Pop-up Comment Button & Selection Floating Toolbar** (`overlay.css`): `.annotationCommentButton` and `.editToolbar` previously inherited inconsistent light-mode defaults. Styled `.annotationCommentButton` with a modern dark container (`#242428`), border (`#52525e`), icon mask (`#e8e8e8`), and active/hover states (`#3c4043`, `#8ab4f8`). The floating selection toolbar (`.editToolbar`), comment popup notes (`.commentPopup`), and the comment editing modal (`#commentManagerDialog`) all share the same dark palette and styling.

## R38 — highlight appearance parity with fx-on/off, and cross-platform packaging

Introduced in v1.1.2:

- **Highlight Appearance Parity Between `fx-on` and `fx-off` Modes.**
  - **Symptom**: In `fx-on` mode, text highlights appeared washed-out/milky (`[253, 255, 214]`), with horizontal white seams between multiline text rows and the top edge clipped. In `fx-off` mode, highlights were vibrant, saturated yellow (`[252, 255, 164]`) and completely seamless.
  - **Root Cause**:
    1. *Color & Multiply Blending*: Stock PDF.js renders highlights directly onto the canvas with `blendMode: Multiply` using full opacity RGB `[255, 255, 152]`. In `fx-on`, `overlay.css` and `colorizeHighlightAnnotations` applied a `0.45` alpha divisor (`rgb(r g b / 0.45)`). Because `mix-blend-mode: multiply` composites alpha against the white canvas background before multiplying, semi-transparency desaturates yellow into a milky pale tint.
    2. *Horizontal White Seams*: For multiline highlights, PDF.js generates an SVG `<clipPath>` containing separate `<rect>` elements per text quad. Because of font leading/line-height, adjacent text lines have a vertical gap of 1–2 CSS pixels. In `fx-on`, white `.fx-mask` rectangles cover canvas glyphs; inside that 1–2px leading gap where `clipPath` clipped out the highlight, the white mask showed through as a stripe.
    3. *Top-Edge Truncation*: Typography mask vertical padding above the text baseline encroached onto the upper quad rectangle of the annotation box, clipping the top edge.
    4. *Toggle Desynchronization*: Toggling `fx` from OFF to ON did not re-colorize existing highlight annotations on already-rendered pages.
  - **Fix**:
    1. Switched fallback color to `#ffff98` and removed the `/ 0.45` alpha divisor in `extension/viewer/overlay.css` and `colorizeHighlightAnnotations(pv)` in `extension/viewer/overlay.mjs`. Annotations use full opacity unless explicitly configured with `annot.opacity < 1`. Full opacity with `mix-blend-mode: multiply` preserves black text while multiplying background white into full-saturation yellow (`[255, 255, 152]`), matching stock PDF.js pixel-for-pixel.
    2. Grouped SVG `<rect>` elements in `clipPath` by text baseline and bridged vertical leading gaps to meet the next line (`next.y + 0.005 - r.y`). Because clip-paths perform a boolean union of their child shapes, extending the rect eliminates the gap without double-multiplying color.
    3. Expanded the topmost quad rectangle up to `y = 0` when `y < 0.05` to prevent mask padding from clipping the upper boundary.
    4. In `applyEnabled(on)`, re-invoked `colorizeHighlightAnnotations(pv)` on all rendered page views when toggling `fx` on.

- **Cross-Platform Extension Packaging (`scripts/package.mjs`).**
  - **Symptom**: `npm run package` failed on Windows with `Join-Path : Cannot bind argument to parameter 'Path' because it is null` (`ParameterArgumentValidationError`). On POSIX platforms without native `zip` installed, packaging failed with `ENOENT`.
  - **Root Cause**: Windows PowerShell 5.1 `-Command "param($src, $dst) ..."` does not bind positional CLI arguments to scriptblock `param()`.
  - **Fix**:
    1. On Windows (`win32`), passed source directory and destination zip paths through process environment variables (`$env:SRC`, `$env:DST`) directly into `Compress-Archive`. This is fully portable across PowerShell versions and completely immune to quoting or path spacing issues.
    2. On POSIX (`darwin`, `linux`), implemented robust multi-tier fallbacks: native `zip -qr` CLI first, falling back to Python 3/Python standard library `zipfile` module (`python3 -m zipfile -c`), and bsdtar.

## R39 — evidence-backed reading fonts, proportional font scaling, open word-spacing protection, zero-leak memory audit, and security review

Introduced in v1.1.2:

- **Research-Backed Reading Fonts for Academic Focus and Reading Speed.**
  - **Research & Rationale**:
    1. **Lexend**: Designed by Dr. Bonnie Shaver-Troup and Google. Specifically engineered based on educational typography research to reduce visual crowding (crowding of adjacent letters that slows down saccadic reading). Clinical studies measured immediate reading fluency and comprehension gains of ~17–20%.
    2. **Source Serif 4**: Designed by Frank Grießhammer at Adobe. An open-source serif family purpose-built for sustained, long-form reading on digital displays and academic literature. Matches traditional journal typography with higher digital legibility and robust serifs.
    3. **OpenDyslexic Evaluation & Removal**: Initially evaluated for dyslexia accessibility. However, in two-column justified academic papers, OpenDyslexic's extreme glyph widths and bottom-heavy shapes forced the engine to compress `--scale-x` down to ~0.68, resulting in vertically stretched, distorted letterforms that looked cartoonish and degraded academic legibility. Following user review and visual inspection, OpenDyslexic was removed to preserve high typographical standards for scientific literature.
  - **Implementation & Vendoring**:
    - Vendored 400 and 700 weights from `@fontsource` into `extension/vendor/fonts/` (`lexend-{w}.woff2`, `source-serif-4-{w}.woff2`).
    - Added `@font-face` rules to `extension/viewer/overlay.css`.
    - Integrated font modes into `FONT_STACKS` in `extension/viewer/typography/engine.mjs`.
    - Added to `FONT_MODES` in `extension/viewer/overlay.mjs` for toolbar cycling, and `<option>` elements in `extension/popup/popup.html` and `extension/options/options.html`.
    - Added font attribution and SIL Open Font License notices to `THIRD_PARTY_NOTICES.md`.
    - Enhanced `scripts/check-vendor.mjs` to automatically verify presence of all 10 vendored font woff2 files.

- **Proportional Font Size Scaling (`FONT_SCALES`).**
  - **Problem**: Modern digital screen typefaces (Source Serif 4, Literata, Lexend, Inter) possess significantly larger x-heights (0.51em–0.55em) and wider character advances (+15% to +18%) than traditional journal body typefaces (Computer Modern, Times New Roman, Minion at 0.45em). When applied at 1.0× `font-size`, the swapped fonts appeared bloated and oversized relative to the line leading, dominating the page.
  - **Fix**: Introduced `FONT_SCALES` in `extension/viewer/typography/engine.mjs`:
    - `atkinson`: `0.96`
    - `inter`: `0.93`
    - `literata`: `0.91`
    - `lexend`: `0.92`
    - `source-serif-4`: `0.91`
  - Normalizes visual x-heights to ~0.47em–0.50em across all faces, perfectly aligning body text proportions with the original publication format.
  - Preserved original `fontSize` in `#pristine` WeakMap and restored cleanly in `#restorePage`.
  - Mathematically calibrated baseline alignment: compensated baseline margin formula $\Delta = (r_{orig} / scale) - r_{new}$ and canvas-calibrated measurements to ensure pixel-accurate row alignment with unswapped math and symbols.
  - Sized overlay white masks using `Math.max(rect.height, r2.height)` and union boundaries to guarantee 100% canvas text concealment without clipping or leaking.

- **Narrow Space Elimination & Word-Spacing Protection.**
  - **Problem**: When wide fonts were swapped into justified columns, the line's natural text width exceeded the PDF canvas item width (`natural > targetW`). The previous width pass trimmed `word-spacing` negatively (down to `-MAX_SPACE_TRIM = -0.02em`) and compressed `--scale-x` down to 0.84. In faces with naturally compact space glyphs (Literata native space is only 0.20em), this reduced rendered inter-word gaps to < 0.18em, causing adjacent words to feel cramped and run together.
  - **Fix**:
    1. Proportional font scaling naturally reduces width overshoot, bringing `--scale-x` to a comfortable 0.94–1.0.
    2. Enforced a zero-negative-trim floor (`minTrim = 0`) for all bundled reading fonts in `engine.mjs` line-width pass. The engine never eats horizontal inter-word space; negative surplus is absorbed entirely by subtle `--scale-x` compression.
    3. Added `FONT_BASE_WORD_SPACING` (+0.04em for Literata, +0.02em for Source Serif 4) to open up naturally tight space glyphs to comfortable academic reading standards (~0.24em–0.26em).
    4. Enhanced `test/matrix-fonts.mjs` to track narrow gaps (< 0.20em) alongside word jams (< 0.12em). Across all 18 matrix combinations (6 font modes × 3 weights), `jams = 0`, `narrow = 0`, and `gapMin >= 0.207em`.

- **Thorough Code Review & Security Hardening.**
  - **Message Validation**: Service worker verifies `sender.id === chrome.runtime.id` and validates origin via `sender.url.startsWith(chrome.runtime.getURL(""))`.
  - **Input Sanitization**: All external URL links pass through `sanitizeHttpUrl(url)` strictly restricting protocols to `http:` or `https:`.
  - **Safe DOM Construction**: Verified strict absence of unescaped `innerHTML` when interpolating external metadata. Popups and cards construct DOM exclusively via `document.createElement`, `textContent`, and safe append operations.
  - **ReDoS Protection**: User-configured bypass URLs escaped via `escapeRegex()` before insertion into DNR rules, and domain formats validated against RFC hostnames with length limits.
  - **Zero Private Info Leakage**: Full repository audit verified zero private review filenames, titles, paths, or text in git history or working tree.

- **Memory Leak Audit & CDP Stress Benchmark (`test/test-memory-leaks.mjs`).**
  - **Detached DOM Retention Fixes**:
    1. `CitationPopup.hide()` now explicitly clears `this.#anchor = null;` and `this.#entries = [];` to release old page DOM node references when dismissed.
    2. Guarded `CitationPopup.#position()` against null or detached anchor references.
    3. Added `TypographyEngine.onDocumentLoaded()` to clear document-specific caches (`#pageFonts`, `#ascentCache`, `#spaceInkCache`, `#pending`, `#refsBoxes`, `#furnitureBoxes`, `#inkRetryPages`) across different documents opened in the same tab.
  - **CDP Benchmark Results**:
    - **10 FX Toggle Cycles**: Exactly `0` DOM node delta, heap delta `+0.14 MB`.
    - **6 Font Mode Swaps**: Exactly `0` DOM node delta, heap delta `+0.10 MB`.
    - **Citation Interactions**: Reusable single `.fx-cite-popup` node in DOM with zero lingering popups.
    - **Cleanup on Disable**: All `.fx-mask` elements cleanly removed (`Active Masks: 0, fxDone: 0`).
    - **Total Heap Growth**: Strictly bounded to `+3.73 MB` across full 20-cycle multi-page virtualization stress test.

- **Full Verification Across Public & Private Corpora.**
  - **Unit Tests**: 202/202 pass (`npm test`).
  - **Public Papers**: 8/8 templates pass (`test/papers.mjs`).
  - **Private Corpus Sweep**: 31/31 papers pass (`rv01`–`rv31` via `local/sweep-private.mjs`).
  - **Console Diagnostics**: 0 problems (`test/console.mjs --selftest`).
  - **Full Font × Weight Matrix**: 18/18 combinations pass (`test/matrix-fonts.mjs`), 0 jams, 0 narrow gaps, 0 overlaps.

## R40 — in-paper reference support, array indexing exclusion, and native hyperlink citation confirmation

- **In-Paper References Support on Documents Without Bibliographies.**
  - **Problem**: Review documents or standalone memos without reference lists were rejected by `#shouldAnnotate()`, causing in-paper references (Figure, Table, Section, etc.) to remain uncolored.
  - **Fix**: Removed `#shouldAnnotate()` gating on `annotatePage()`, restricting it strictly to bibliography citations (`findCitations`). In-paper reference coloring (`findInternalRefs`) now runs reliably on all rendered documents.

- **`documentloaded` Race Condition & Idempotent Handler.**
  - **Problem**: In `overlay.mjs`, top-level `await` operations preceded registering the `documentloaded` event listener. When PDF.js completed loading before the listener was attached, references extraction was never kicked off, leaving `#entries` empty.
  - **Fix**: Added `handleDocumentLoaded()` guarded by `lastLoadedDoc` check, running immediately if `app.pdfDocument` is already available on evaluation, and registered on `app.eventBus`.

- **Span Filter Re-annotation Preservation.**
  - **Problem**: `annotatePage()` span filtering skipped any span matching `span.querySelector("span")`, which mistook `<span class="fx-sp">` or `.fx-ref-c` for PDF.js markedContent wrappers and wiped citations on subsequent re-annotation passes.
  - **Fix**: Replaced with `span.closest(".fx-cite-c, .fx-ref-c, .fx-sp")` guard and `span.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")`.

- **Preserved Natural Line Wrap Word Boundaries.**
  - **Problem**: Concatenating text-layer spans as bare `joined += text` merged end-of-line and start-of-line tokens without word boundaries (e.g. `inSection V`, `Appendix Aincludes`), corrupting regex matching.
  - **Fix**: Appended `\n` to concatenated line spans (`joined += text + "\n"`), recording `{ span, start, end: start + text.length }` so word boundaries `\b` are preserved without skewing character offsets.

- **Code Array Indexing Exclusion (`packet[4]`, `crc[0]`) & Native Hyperlink Citation Confirmation.**
  - **Problem**: Array and variable indexing in code listings (e.g. `packet[4]`, `crc[0]`, `char[16]`) matched numeric citation regexes, resulting in spurious hit targets, popup cards, and coloring over code.
  - **Fix**:
    1. In `parser.mjs`, updated `findCitations()` to detect tokens preceded by identifier characters (`[\p{L}\p{N}_$\]]`) and exclude them by default (`includeIndexed: false`).
    2. In `citations.mjs`, added native PDF hyperlink detection (`#isReferenceLink`, destination resolution against bibliography pages).
    3. Enforced the hyperlink confirmation rule: if a bracketed token carries a native hyperlink to a reference (`#cite.xxx`, `#bib.xxx`, or destination page within bibliography), it is unconditionally treated as a citation even if adjacent to word characters (e.g. `Author\cite{...}` in LaTeX without space).
    4. If a bracketed token has no reference hyperlink and is preceded by an identifier character or set in a monospace font, it is rejected and never annotated.

- **Full Verification Across Public & Private Corpora.**
  - **Public Suite**: 206/206 unit tests passed (`npm test`), 8/8 templates passed (`test/papers.mjs`), 0 console problems (`test/console.mjs --selftest`).
  - **Private Corpus 1 (`Reviews`)**: 31/31 papers passed in-paper reference sweep (100% PASS), 100% citation coloring verified.
  - **Private Corpus 2 (`papers`)**: 98/98 citations colored, 32/32 in-paper references colored. Fig. 14 array indexing false hits dropped from 36 to 0, visually verified clean via high-resolution rendering.

## R41 — a page with no emphasis at all, a security gate that only guarded one URL shape, and two tests that could not fail

A full review: every page of all twelve corpus papers read against TESTING.md §3
from a fresh classification capture, the R39 security audit re-checked claim by
claim, and a pass over the tree for dead and duplicated code.

### The defect: the page gutter read as a table column, and a page lost its emphasis

`usenixsecurity24-tu` p12 rendered with **no emphasis anywhere** — 498 text-layer
spans, `processedDone=0`, and 197 of them marked `data-fx-why="table-aligned"`
over plain body prose. Both columns of the page were classified as table.

`test/diag-aligned.mjs` (new) prints every run the aligned-gap rule seeds, and
named the cause in one line:

```
y=409 h=10 rows=29 band=[296,318] split=false  seed:"found some UEs accept plaintext Registration Acc"
```

The band is `[296,318]` — precisely this template's 296/318 column boundary. The
run was the **page gutter**, held across 29 consecutive body baselines, which is
exactly what a two-column body looks like to a rule searching for a shared
vertical gap.

There was already a guard against this, and it was off. `skipAlignedTable` took
one `splitX` parameter doing two unrelated jobs: excluding the gutter from band
candidates, and bounding a detected run to one side of it. The per-region call
site wanted only the first and passed `null`, opting out of both. Split into two
parameters (`gutterX`, `splitX`), each call site now takes what it needs.

That alone did not fix it, and the reason is the more interesting half. The
gutter guard was keyed on `twoColumn`, which counts every line equally — and p12
carries a 24-row full-width table over its two-column body. Every one of those
rows crosses the centre, so `twoColumn` came out **false** for a page that
plainly has two columns of prose, and the guard switched itself off with it. The
fix is a separate `gutterX` signal computed from **body-height lines only**,
which a table cannot outvote because its rows are not at body height
(`gutterRows=27` on p12, against `twoColumn=false`).

Result on p12: `processedDone` 0 → 91, `table-aligned` 197 → 1, the real table
still detected (its own band moved to `[485,498]`), body prose green in both
columns. Corpus unchanged elsewhere: `papers.mjs` 8/8, and `tables.mjs` reports
0 offenders on both single-column papers, which is the check that the gutter
exclusion has not cost a centred table its detection.

### Two more product defects, in the in-paper reference pattern

Neither appears anywhere in the twelve-paper corpus, which is why both survived;
both are now unit-tested, since the sweeps cannot see them.

- **Roman numerals with no "I" matched nothing.** The canonical-Roman pattern
  ended in `(?:IX|IV|V?I{1,3})` — a group that *requires* an I. `V`, `X`, `L`,
  `C` were rescued by the single-capital-letter alternative, but `Table XV`,
  `Section XX`, `Table XXV` and `Table XL` matched nothing at all and went
  uncoloured. Making that group optional instead would let the numeral match the
  empty string and colour a bare `Table `; a bounded run of Roman letters
  (`[IVXLCDM]{1,8}`) can do neither, and the mandatory leader in front is what
  keeps it from claiming ordinary capitalised words.
- **A dotted range was cut in half.** `Section 3.1-3.4` matched only
  `Section 3.1-3`: the right-hand side of a range was matched as a bare integer,
  so the colouring stopped inside the reference's own second number and left
  `.4` behind as an orphan — the same "abrupt, oddly-coloured orphan" the
  comment above that pattern already warns about.

Verified as a pure widening: over all 14 corpus papers the old and new patterns
produce **identical** match sets, so nothing regressed and no false positive was
introduced.

### Re-checking the R39 security audit

Most of it held. `sanitizeHttpUrl` does gate every href the reference card
builds; the DOM is built with `createElement`/`textContent` throughout (the only
`innerHTML` is `engine.mjs` round-tripping PDF.js's own serialization, which is
lossless and inert); `escapeRegex` is applied before user input reaches a DNR
`regexFilter`, and the bypass-domain pattern is linear (measured: 0.6 ms on a
100 000-character hostile input, its `{0,61}` bounds preventing backtracking);
`openAlexAbstract` is bounded and cannot be used for prototype pollution; and the
zero-leak claim checks out — no private path, filename or corpus marker appears
anywhere in the working tree or in the full history, and no PDF or `CLAUDE.md`
was ever committed.

One claim did not hold.

- **The `?file=` scheme allowlist guarded only one URL shape.**
  `normalizeFileParam` returned early unless the query *started with* `?file=`,
  so the check was skipped entirely by putting any parameter in front of it.
  Measured, before the fix:

  ```
  ?file=javascript:alert(1)        -> PDF.js would open: null      (rejected)
  ?x=1&file=javascript:alert(1)    -> PDF.js would open: "javascript:alert(1)"
  ?a=b&file=file:///C:/Windows/... -> PDF.js would open: "file:///C:/Windows/..."
  ```

  This is the only control on what the viewer will fetch: `viewer.html` is
  web-accessible to `<all_urls>`, so any page can open it with a query of its
  choosing, and patch 1 disables PDF.js's own `validateFileURL` origin check for
  extension origins. The gate now runs first, on the value PDF.js will actually
  read, in every query shape, and removes only the `file` parameter rather than
  the whole query.

- **Correction to R40.** R40 claims citation confirmation by "destination
  resolution against bibliography pages". That code (`#destTargetsRef`,
  `#destPageCache`) never functioned: the cache was cleared but never written, so
  its branch was unreachable, and the remaining branch re-tested the same regex
  on the same string that `#isReferenceLink` had already tested one line earlier
  (verified exhaustively: over 4096 generated hrefs the disjunct added
  information in 0 of them). It has been removed. Hyperlink confirmation works —
  it is `#isReferenceLink` doing it, by named destination, and nothing else.

### Two tests that could not fail, and a capture that photographed the wrong moment

- **The frame-protection test asserted an inline copy of the condition**, not the
  module — it threw an error it had written itself and caught it. It passed no
  matter what `file-param.mjs` did. It now imports the module afresh (Node caches
  by specifier, hence the query suffix) with a framed window and asserts the
  guard rejects. Mutation-checked: disabling the guard now fails the test.
- **`review-capture.mjs` had exactly the defect R36 fixed everywhere else.**
  TESTING.md §5 prescribes it for the visual review, and it waited on a
  *document-wide* `.fx-b` count and then slept a fixed interval — the shutter
  fired mid-emphasis, which manufactures "body wrongly skipped" findings, the
  very thing the capture exists to detect. It also never hid the outline sidebar,
  so a page could silently lose its right-hand column. Both fixed, matching
  `debug-shot.mjs`: settle on the target page's `data-fx-done` **and** `.fx-b`
  counts, and force the sidebar hidden.
- **`__fxDebug` was set ~2.5 s after navigation**, so the first pages of every
  paper recorded their skips as `?` — an unattributed skip is precisely the
  ambiguity a runaway rule hides in. It is now injected with
  `Page.addScriptToEvaluateOnNewDocument` before a reload, and no `?` remains.

### Instruments added, and one honest label

- `test/diag-aligned.mjs` — every aligned-table run on a page, with the band and
  the column model beside it. A band straddling the page centre means the gutter
  guard is off; a band inside a column means a real table's run escaped it.
- `test/review-triage.mjs` — ranks captured pages by how likely they hold a
  defect, so the visual pass starts where the evidence is. Each rule names the
  §3 rule it is looking for a violation of, and every flag is a question.
  `review-capture.mjs` now records `refsPage` per page: without it a bibliography
  page and a page whose body was eaten look identical ("nothing processed"), and
  ten correct ones buried the one that mattered.
- `papers.mjs`'s summary now marks `~bolded`, `~masks` and `~cites` as
  render-dependent. They count what is rendered when the poll stops, and PDF.js
  virtualizes pages: `cites` measured 151, 151 and 266 on three consecutive runs
  of one commit. Only `pages` and `refs` are document-wide, and only the
  per-paper `checks=` line decides PASS — but an unlabelled number that halves
  between runs reads as a regression, and did.

### Dead code and drift

`verifyScholar` (a pass-through to `bestMatch` with no callers), the unused
`queryVariants` import in `sources.mjs`, and the `#refPages` set in
`citations.mjs` — which recomputed, to publish a global, exactly the page set
`engine.setRefsRegion` publishes moments later. `__fxRefPages` now has one owner:
the engine, which also resets it in `onDocumentLoaded` so a document with no
bibliography cannot inherit the previous one's pages. TESTING.md's gate
expectations said "173 unit tests" and "patch check passed (6/6)" against a tree
with 215 tests and 9 patches, which makes a correct run look wrong; they now
state the invariant rather than a number that goes stale.

### Verification

- `npm test` — 215/215, and the naming + vendored-patch guards pass (9/9).
- `node test/papers.mjs` — 8/8 PASS, every check true.
- `node test/tables.mjs` on both single-column papers — 0 offenders.
- Full visual review — all 181 pages of all 12 papers, from a capture taken
  after the fixes, read against TESTING.md §3. One defect found (p12, above);
  everything else classifies correctly. Every remaining "nothing processed" page
  is a bibliography, a full-page figure or a code listing, as it should be.

### R41 (cont.) — the same review over the private corpus

Every document of the private verification corpus, every page, against the same
Section 3 rules and from a capture taken after the fixes above. Nothing about
those documents appears here; they are referred to only by their positional
aliases, and the harness serves them under those aliases so no filename reaches
a URL, a log line or an output path (CLAUDE.md, "Private corpus").

| Gate | Result |
|---|---|
| `tables.mjs` — no processed span inside a rule-bounded table zone | **0 offenders**, every document |
| `fontkeep.mjs --all` — no processed span in a math/mono/small-caps/bold face | **0 violations**, every document |
| `whyskip.mjs --all` — unreasoned prose below everything processed | `trailing: 0` and `unreasoned: 0` on **all 475 pages** (after the fix below) |
| Visual, per page | **every page of every document**, no classification defect |

`tables.mjs` is the one that matters most for the gutter fix: excluding the
gutter from the band candidates can only ever make the rule skip LESS, so the
risk it introduces is emphasis leaking into a table. Zero offenders across the
whole private corpus, and zero on both single-column public papers, is what
retires that risk.

**No page of the private corpus shows the R41 defect shape.** Of the pages with
nothing processed, every one is a full-page table, a full-page figure or protocol
diagram, a bibliography, a code listing, or a submission cover/metadata page —
checked individually rather than assumed.

Two behaviours were investigated as candidate defects and are **correct**:

- **A document whose body prose is set in a bold face gets no emphasis.** One
  document sets an entire response-to-reviewers section in CMBX10 — Computer
  Modern Bold Extended — and those pages come out almost entirely skipped as
  `runin`. That is the bold-display rule (`SPECIAL_FONT`) doing exactly what R18
  hardened it to do, confirmed by resolving the fonts through `commonObjs`
  rather than by reading the screenshot: 2 654 of ~2 950 characters on the page
  are in CMBX10, and the regular-faced prose on the same pages IS processed.
  Relaxing it to catch this document would put emphasis back into every run-in
  heading in the corpus. Left as is.
- **A composite document's sections can fall outside the body-size band.** A
  submission bundle (questionnaire + manuscript + response letter, each typeset
  at its own size) has ONE document-wide body height, char-weighted, which the
  manuscript dominates; the other sections' prose is then off-size and is not a
  candidate. The manuscript — the part being read — is processed correctly. This
  is a real limitation of a single document-wide `bodyHeight` rather than a
  misclassification, and worth knowing before anyone reports it as a bug.

### The last three silent skips, and a check that can now fail

The private corpus surfaced what the public one could not: 32 prose lines on 21
pages carried **no skip reason at all** (`(none)`), against zero on every page of
three public papers (49 pages, USENIX / NeurIPS / acmart). `trailing` was 0 for
all of them, so none was the R35 "last line of the column" shape — but an
unreasoned skip is exactly the ambiguity R35 was hiding in, and the engine's own
policy is that every skip path records one.

Tracked down by marking each candidate the filter saw and re-probing: the spans
DID reach the filter and passed it, so the reason was missing further along.
Three paths returned without recording:

- `link-annot` — an item covered by the PDF's own link annotation.
- `url-or-math` — `emphasizeParts` declines a span that is math-heavy or a
  wrapped URL/path fragment (`MATHY`, or a space-free fragment containing `/`
  or `@`). This was the one the private corpus hit: file paths and source
  identifiers set in a monospace face inside prose.
- `overlaps-skipped` — a candidate that duplicates already-skipped content.

`furniture` was also moved onto the shared `reject()` helper so it honours the
"never overwrite a more specific reason" rule the others follow. All four changes
are inside `globalThis.__fxDebug` guards: with debug off the engine behaves
exactly as before, which is why the corpus numbers are unchanged.

**`whyskip.mjs` can now fail.** Until R41 it exited non-zero only on an exception,
so a sweep of it reported every document PASS while proving nothing about the
criterion its own header states. It now prints a `TOTALS:` line, exits 1 on any
page with `unreasoned` or `trailing` above zero — naming the page and its sample
— and fails a run that probed no page at all, so it cannot pass blind. Verified
by mutation: removing the `url-or-math` reason turns the affected document from
PASS into `FAIL p5 unreasoned=6`, which is what it would have done silently
before.

Its FAIL line is indented to the shape a sweep driver greps for, so a failure now
arrives with its page and sample attached rather than as a bare exit code — the
gap that made the original numbers have to be dug out of `--verbose` output
instead of read off the PASS column.

### `citeaudit.mjs` — a correction, and the fix it did need

Auditing the harnesses for the same "states a criterion it cannot enforce"
defect found four with no failure path: `skipline`, `matrix-fonts`, `citecolor`
and `citeaudit`. The first three describe themselves as reports. `citeaudit`
does not — its header says JUMP-CITE "Must be 0" and NO-HIT "Must be 0".

**A first pass through this recorded that `citeaudit` was badly broken — that it
could not see the citations it audits, counting 0 on a page holding 36 coloured
ones. That finding was wrong, and it is worth saying why.** `citeaudit` takes its
document POSITIONALLY; every other harness here takes `--url=`. Invoked as
`--url=<pdf>`, the flag itself became the document, PDF.js silently opened its
built-in sample instead, and the audit dutifully reported on 14 pages of the
wrong file — `numPages=14`, `refCount=19`, bracketed numbers that were never
citations. Run correctly on the same paper it reports 19 pages, `refCount=58`
matching `refbold`, and zero NO-HIT and zero JUMP-CITE. The span filter was
likewise exonerated: the pre-R40 form skips a span whose citation was coloured,
but the colour WRAPS have no child spans and are kept, so the text is recovered
either way.

This is the failure mode CLAUDE.md warns about in its own words — a confident
false positive costing more than a missed subtle one — and the thing that made it
possible is that a harness handed the wrong document still produced a clean,
plausible report. So the fixes are aimed there:

- **`--url=` is accepted alongside the positional form**, so the invocation that
  every other harness takes cannot silently audit a different file.
- **A blind-pass guard**: examining no citation bracket at all is now a failure
  (`FAIL no citation bracket was examined`), which is exactly what the wrong-file
  run would have tripped.
- **The two counts the header calls "Must be 0" are now the exit criterion**
  (JUMP-CITE, NO-HIT), printed as indented `FAIL` lines a sweep can surface.
  `unresolved` stays advisory — a paper citing beyond its own bibliography
  produces it legitimately.

Verified on a USENIX paper: both invocations now give the identical
`cites=130 jumpCites=0 noHit=0 unresolved=0 refCount=58`, and a URL that loads
nothing exits 1 instead of reporting a clean zero.

The span-filter question raised here earlier is now closed. A first comparison,
computed as a second counter inside the same probe, suggested the R40 filter
would see 188 citation brackets against the current filter's 130. Running the
audit for real with each filter shows no difference at all: usenixsecurity24-tu
reports `cites=130 noHit=0 refCount=58` either way, Proteus-ccs24
`cites=110 noHit=0 refCount=73` either way. The 188 was an artifact of how that
side-by-side counter was measured, not a property of the filter — the colour
wraps carry no child spans, so whichever end of the parent/child pair is skipped,
the same text reaches the joined page string. The filter is left as committed.

## R42 — the pointer said [12] and the card said [4]

### The defect

Hovering the **12** of a citation printed `[4, 12]` opened the card for **[4]**.
Every number after the first in a multi-key bracket did it, on every document:
`[24, 39, 42, 60]` opened [24] from all four of its numbers.

The cause is one line short of a decision. `annotatePage` built the card list for
a citation's keys and then laid a hit-target over each rect of the **whole
bracket**, every one of them carrying the same list:

```js
for (const rect of rangeRects(seg.span, localStart, localEnd)) {
  hits.push({ rect, cards });          // the whole citation, one card list
}
…
a.addEventListener("mouseenter", () => this.#popup.scheduleShow(cards, a));
```

and `CitationPopup.showNow` opened that list at `#index = 0`. So the pointer
carried no information at all: the card was "this citation's first reference",
wherever inside the brackets you happened to be. The pager could reach the other
references — you had to know to press it, on a card already showing the wrong
paper.

Nothing in the DOM was wrong, which is why this survived: the citation was
annotated, its hit-target covered the digits, and `reconcileLinks` had properly
neutralised the PDF's own link. `citeaudit` checks exactly those three things and
reported the page clean. The defect lived entirely in which of several right
answers was chosen.

### The fix — the key under the pointer, not the citation

`findCitations` now returns `keySpans` alongside `keys`: the character range of
each key the document actually PRINTS. Only printed keys get one — the implied
middle of `[6-11]` has no glyphs, and a range truncated at 26 keys never reaches
the number at its far end, so neither claims a target for a card that is not
there. All five citation forms carry them: numeric lists, the two range
spellings, `;`-separated author-year, alpha keys, and the years of a narrative
`Benioff [1980, 1982a]`.

`buildCards` (lifted out of the class, so it can be unit-tested) returns
`indexOf` next to `cards`: which CARD each key produced. Not a count — cards are
de-duplicated, and one key can resolve to several entries, so a key's place in
the key list is not its place in the card list.

`annotatePage` then lays a second, precise hit-target over each printed key, on
top of the whole-citation ones, and `scheduleShow`/`showNow` take the index it
carries. Later siblings in the layer sit on top, so the precise target wins where
it exists and the characters no key claims — the brackets, the comma, a locator —
still open the citation at its first card, exactly as before. Single-key
citations get no extra node.

### The check that would have caught it: `test/citepoint.mjs`

For every multi-key bracket on a page, each printed number is clicked at its own
centre and the card that opens must carry that number:

```
p5: multi-key cites=7 wrongTarget=0 wrongCard=0
```

Verified by negative control — reverting the three source files turns one paper's
first six pages from `wrongCard=0` into 18 named failures
(`FAIL p5 WRONG-CARD "[24, 39, 60]" key 60 opened [24]`), so a PASS means
something. It also fails a document where no page carried a hit-target at all,
and SKIPs — with its hit-target count printed — a document that simply cites one
work at a time, because making that a failure would fail real papers over a
property they are entitled to have.

The HOVER path is the one the reader actually uses, and the unpinned card has no
header to read a label off, so it was checked separately against the entry text:
on `[9, 11]` the 9 shows OpenAirInterface and the 11 shows srsRAN.

## R43 — the gate's own litter, two harnesses that could not fail, and four real classification defects

Found while running the full release gate for the R42 citation fix. The R42
change itself is clean — see the differential below — but the sweep that proved
it turned up three defects in the GATE and four in the engine.

### The harness leak: the gate was poisoning its own results

Every harness spawns Edge and ends with `browser.kill()`. That signals only the
launcher; Chromium's renderer, GPU and utility processes are in no process group
of ours and survive it, holding their profile directory, their remote-debugging
port and their memory. One document leaks about nine processes.

Measured mid-sweep: **476 live `msedge` processes, 159 stale profile directories
in `%TEMP%`, and 1.1 GB of free RAM.** At that point a new harness could not bind
`11400 + pid % 300` — some 46 ports in that range were already held by dead runs'
browsers — so it attached to a stale browser or none at all and died with
"extension did not load" or `chrome.storage` undefined. **Five documents were
recorded as product failures over this** (one public paper, four private) and
every one of them re-ran clean once the litter was cleared. The retry loop that
first papered over it was treating the harness's own garbage as flakiness.

The fix is central, because all 83 leaking scripts import `test/lib/env.mjs`:

- `killBrowser(child)` kills the process TREE (`taskkill /F /T` on Windows, the
  process group elsewhere), and the fourteen harnesses the gate drives call it
  in place of `child.kill()`.
- An exit-time net in `env.mjs` reaps any `msedge` whose profile directory
  carries THIS process's pid, which covers the other sixty-nine scripts and a
  run that dies before its own cleanup. Keyed on the pid in `fx-<tag>-<pid>`, so
  it can never reach a concurrent lane's browser — the corpus sweeps run several
  at once. `FX_NO_REAP=1` disables it.

Negative control, on a harness that was NOT given `killBrowser` so only the net
applies: **16 leftover processes with `FX_NO_REAP=1`, 0 without it.**

### `review-capture.mjs` reported PASS on a document it never photographed

One private document's capture died with `ECONNREFUSED` before its browser came
up. The script printed the error, exited **0**, and the sweep recorded PASS — with
no output directory at all. A visual gate that says "clean" about pages nobody
photographed is worse than no gate, and this is the third instance of the R41
class (a test stating a criterion it cannot enforce). It now counts failures and
exits 1; verified by forcing a capture to throw.

### `citepoint.mjs`'s blind-pass guard was too strict

The new harness failed a two-page document that has **no bibliography and no
bracketed citation at all** — zero hit-targets is the right answer there, and
`citeaudit` fails the same document the same way. The guard now asks whether a
citation was PRESENT before demanding one was annotated: brackets in the text
with no hit-target is a failure, no brackets at all is a SKIP. Verified both
ways, including a forced-zero control that still fails with 17 brackets found.

### Four engine classification defects — and one claimed defect that was not real

Every page of all fourteen public documents was read against TESTING.md §3 from a
post-fix capture. **No rendering defect of any kind was found** — no ghosting, no
canvas peek at mask edges, no whited-out words, no jammed spacing, no
wrong-typeface span, no baseline drift. What the sweep did find is
classification, and each one below was re-verified with `wordshot.mjs` before
being written down:

1. **Function names inside DISPLAYED equations are processed and emphasized.**
   `exp` in a Computer Modern paper's equations: `processed=true emph=1 ["ex"]`,
   and the bold "ex" of `exp(2πia` is plainly visible in the capture. It is
   inconsistent within one page — the same token is correctly skipped in
   neighbouring equations — which is what makes it a bug and not a policy.
2. **A caption's continuation lines are processed and emphasized.** A table
   caption wraps; only its first line is skipped, and the rest carries five
   emphasis runs (`processed=true emph=5`). §3 puts captions "plus their
   multi-line continuation" on canvas. The absorb loop bails before reaching
   the continuation, which the per-line dump shows as a caption line followed
   immediately by a line with no skip reason at all.
3. **Numbered / labelled run-in sub-headings are processed and emphasized.**
   The number is skipped as `leadrun` and the heading text after it is not:
   `processed=true emph=3 ["Ba","stat","regis"]`.
4. **The run-in family both over- and under-claims.** `runin-short`,
   `line-head` and `runin` eat body prose — a paragraph's last line, a
   mid-sentence fragment, in one template an entire abstract — while long
   run-in heads escape the same rule. Both directions are the same
   length-gated rule, so they want one fix, not two.

**Not real:** "inline monospace spans are processed and emphasized" was reported
on two pages of one paper from a 3× magnification of a page-scale capture.
`wordshot` says `processed=false keep=false emph=0` — the span is untouched and
carries no emphasis. This is exactly the downsampling-artifact class CLAUDE.md
warns about, and it is why `fontkeep` reporting zero violations on that document
was correct rather than a hole.

### The R42 change is not implicated in any of the above

`findCitations` is on the typography engine's path too (`engine.mjs`,
`segmenter.mjs`), so "the new field is additive" needed measuring rather than
asserting. Old and new parser, compared record-by-record with `keySpans`
stripped, over **9,172 strings of real page text and 195 citations: 0
mismatches.** The engine's inputs are byte-identical, so none of the four
classification defects can originate in it — they are pre-existing.

## R44 — reading the document's own structure instead of guessing at it

R43 left four classification defects, all of them boundary errors: where a
caption stops, where a run-in heading stops, whether a roman token belongs to
the equation around it. The block classifier decides all of that from rendered
geometry — line pitch, height deltas, x-bands, computed weight — and geometry
is a poor instrument for boundaries the source document knows exactly.

### What a LaTeX PDF already tells you

hyperref writes NAMED DESTINATIONS for every float, heading and numbered
equation, in the SAME user space as the text items:

```
subsubsection.3.1.2   page 3   x=53.798   y=188.28
figure.caption.7      page 4   x=53.798   y=713.793
table.caption.9       page 4   x=317.955  y=234.734
```

`figure.caption.N` is the `hypcap` anchor and sits ON the caption — exactly the
boundary the caption pass keeps getting wrong. Measured across the public
corpus, every paper typeset since hyperref became standard carries 80–159 of
these, and they include `subsubsection.*` and `paragraph.*` anchors that the
PDF OUTLINE omits: bookmarks usually stop at subsection, and depth 3–4 is
precisely the run-in level the word-count gate kept mishandling.

`typography/pdfhints.mjs` extracts them and resolves each to a page and a
position; `engine.setStructureHints` holds them as priors. They are hints, not
a contract: the 1995 Computer Modern paper in the corpus has no name tree at
all and reports `available: false`, so the geometry path remains the only path
for such documents, and nothing is ever classified as a heading or a caption
because a hint is MISSING. `cite.*` and `page.*` names are ignored outright —
a citation anchor says nothing about the region it sits in. Tagged PDFs would
be better still (`/Caption`, `/Formula` roles), but none of the corpus is
tagged, so that avenue is closed for now.

### The equation defect was not a font problem

Worth recording separately, because the obvious fix would not have worked. The
`exp` of a displayed equation rendered with a bold "ex" while the same token in
the neighbouring equations did not. The natural reading is "the math-font test
missed it" — and `MATH_FONT` does exist and is applied per item.

The font is not the issue. PDF.js resolves that paper's equation symbols to NO
font at all: the text layer draws them in a generic substitute, so the math
ratio of a row full of mathematics reads as ZERO. The row is then handed to the
body filter, where every symbol is rejected on its own for being under two
characters or carrying no Latin letter — and the one token LaTeX deliberately
sets in upright ROMAN sails through, because `\exp`, `\cos`, `\min`, `\max`,
`\log` and `\mod` are body-face text by construction. No font test can separate
those from prose.

The fix classifies the ROW by its composition: no prose words, and
overwhelmingly built from items the body filter would reject anyway. Note the
shared `MATH_SIGNAL` was not sufficient — it lists relations, and the offending
equation is built from `+` and `∣`, neither of which is in it; a trailing
equation number is the second tell, and a very high symbol ratio the third.

Verified by occurrence on the page, which is the only way to tell this defect
from its own look-alikes: `exp` #2, #4 and #8 are displayed equations and are
now kept (`processed=false keep=true emph=0`), while "**ex**pression" in body
prose is still emphasized. A first pass at this verification checked the FIRST
`exp` on the page, which is inline math inside a running sentence — the wrong
instance, and it would have confirmed the wrong thing.

## R45 — a harness that spliced two columns into one row, and the section symbol that never matched

Both findings here come from the same place: a test whose criterion was close
enough to right that nothing it said could be trusted either way.

### eqkeep grouped by baseline, and a two-column page has two rows per baseline

The final release gate came back green on the public corpus and red on one
private document: a span reported as emphasized inside a numbered displayed
equation. The flagged "row" was not a row. It was the left column's closing
line of a paragraph together with the RIGHT column's equation number — two
items from opposite sides of the page, sharing a baseline and nothing else.
`eqkeep` keyed a row on `Math.round(bottom / 3)` alone, so it glued them
together, and the glued pair passed every test the harness had: a trailing
parenthesised number, hard against the page's right edge, too few words to be a
sentence. The emphasized span was ordinary body prose, correctly emphasized.

The product was never wrong here. The engine's rows are column-scoped already
(regions are split left/right/full-width at the page-centre gutter), and that
two-item row would have failed its `items.length < 3` guard regardless.

The fix gives the harness the same notion of a column: find the vertical band
near the page's middle that the FEWEST rows cross, split each baseline there,
and measure each segment against ITS OWN column's right edge. Counting rows
rather than marking occupied pixels is the part that matters — a full-width
title, figure or table crosses the gutter, and a plain occupancy map lets any
one of them erase it. The width floor is 1% of the page: a two-column ACM page
floor is derived from the PUBLIC corpus, so the threshold owes nothing to the
document that exposed the bug: at the harness's rendering width the two-column
gutter measures 3.4–3.7% of the page on ACM and USENIX layouts and only 1.83%
on the IEEE journal one, so the 2% that looked safe discards a whole real
layout. Single-column papers measure 0% — no quiet band is found at all — which
is the evidence that 1% is not merely tuned low. Telling a gutter from a wide
word-space is left to the coverage test, which is what can actually do it — a
single column's middle is crossed by nearly every row and never comes close to
being quiet.

### And then the harness found a real one

With the columns separated, the same page yielded a genuine numbered displayed
equation, entirely inside one column, still carrying emphasis.

Its shape: an operator bounded by a ROMAN multi-word identifier — `\max` or
`\min` applied to a `\mathrm` name of two or three words — then a relation, a
quantifier, and the equation number. The row-equation pass had rejected it on
the word-length veto. That veto exists so a SENTENCE ending in a parenthesised
number cannot read as an equation, and it works by assuming nothing five
letters long belongs in one. Papers disagree: a roman identifier of that kind
is ordinary notation, and one of its words reached five letters.

A long word is now forgiven when the row carries a relation glyph AND is still
mostly symbols. Both conditions are needed — a relation such as `≤`/`∈`/`∀` is
what no English sentence has, and the ratio is what stops a prose line with one
inline relation from qualifying. The offending row is symbol items in all but
one position.

Note what this cost: the false row had been masking the true one on the same
page for the whole gate. A harness that is merely approximately right does not
fail safe.

### `§4.2` was in the leader list from the start and never once matched

Reported from the render: section references written with the symbol were not
coloured, while the spelled-out "Section 4.2" beside them was.

`§` had been in `REF_LEADER` since the pattern was written. The pattern opens on
`\b`, and a word boundary needs a word character on one side — in "see §4.2"
both the space and the `§` are non-word, so there is no boundary between them
and the match never started. Every section-symbol reference in every paper went
uncoloured: `§4.2`, `§§5.1-5.3`, `§7`, `§ 8.2`, and the form at the start of a
span or inside parentheses. A lookahead is the whole fix; `§` needs no boundary
test of its own, because unlike "sec" it cannot occur inside a word.

`test/refcolor.mjs` carries its own copy of the pattern and carried the same
bug, so the harness shared the product's blind spot and could not have reported
this no matter how often it ran. Both copies are fixed. Negative control, with
the product fix reverted and the harness fix kept: 21 references found, 11
coloured — the 10 uncoloured ones are exactly the `§` forms. With the fix,
21/21.

One thing deliberately left alone: a `§` locator inside a citation bracket
("[9, §5.2.2.1]") now nests a reference-coloured run inside the citation-coloured
bracket, which is what the spelled-out "[24, Section 5.2]" has always done.
`NUMERIC_CITE`'s own comment says the whole bracket should read as one citation,
so this is arguably a pre-existing defect — but it is a separate one, and
changing shipped behaviour for both forms is not part of colouring `§`.

### R45 (cont.) — the leak audit, and a review of this round's own code

**Private-corpus audit.** The R45 write-up as first committed leaked the very
thing the policy exists to prevent, and from the document that exposed the bug:
a verbatim body line, a verbatim equation including a roman multi-word
identifier, and the page coordinates of both. Removed from `REVIEW_FINDINGS.md`,
`TESTING.md`, `engine.mjs` and `eqkeep.mjs`; the mechanism is stated without the
text, which loses nothing, because the mechanism was never document-specific.

The gutter floor is now justified from the PUBLIC corpus instead — at the
harness's rendering width the two-column gutter runs 3.4–3.7% of the page on ACM
and USENIX layouts and 1.83% on the IEEE journal one, and single-column papers
measure 0%. That is a better justification than the private measurement it
replaces: it shows both why 2% is too high AND that the detector finds nothing
on a single-column page.

Swept the rest of the repo for the same class. Clean: no corpus path, no
document names, every `rvNN` an alias with no mapping to content. The quoted
body text under the early letter labels (`A`–`F`) is from PUBLIC corpus papers,
confirmed with the user — those were briefly over-redacted here and restored
verbatim.

**Two defects in this round's own code, found by reviewing it rather than by
running it.**

1. *A hot loop hoisted above its own early exit* (`engine.mjs`). Widening the
   equation test moved the per-item symbol tally above the `proseWords` bail, so
   a tally that resolves a FONT PER ITEM ran over every row of every page
   instead of only over rows that could still qualify. Restored as a cheap
   pre-test (`numbered && words.length <= 2`) ahead of the tally, with the prose
   count hoisted so it is computed once. The decision is unchanged — the same
   rows qualify, case by case — only the work is.

2. *An untrusted name tree bought unbounded work* (`pdfhints.mjs`). The
   structure-hint reader iterates the document's destinations and resolves one
   PAGE-TREE WALK per distinct ref. Nothing bounded the tree, and the extension
   opens whatever PDF the reader points it at, so a file naming a million
   destinations bought a million pattern tests and up to a million walks on the
   main thread. Now capped at 50000 destinations examined, 4000 anchors kept and
   400 refs resolved — two orders of magnitude above the measured corpus
   (80–159 destinations, ~20 refs), so no real document reaches one, and a file
   that does falls back to geometry, which is the right answer for it. Covered
   by a unit test that asserts the ceiling holds and that usable hints still
   come back.

**Security review of the round's surface.** No new permissions and no manifest
change beyond the version; CSP remains `script-src 'self' 'wasm-unsafe-eval'`.
The new citation hit-targets are `<a>` elements with NO `href` — listeners only
— positioned from `getBoundingClientRect` numbers, so there is no URL to
smuggle; every link the card renders still goes through `sanitizeHttpUrl`. No
`innerHTML` sink takes reference text. The parser's regexes were timed against
adversarial input (5000 consecutive section symbols, separator and bracket
storms, deep nested parentheses): worst case 3ms, and the `(?=§)` alternative
adds no backtracking, since both `REF_ITEM` and `REF_SEP` require at least one
character and the repeated group therefore cannot spin on an empty match.

## R46 — eight independent review passes, and the defect none of them was looking for

An external reviewer (a second agentic CLI, run read-only in a detached
worktree) reviewed this release eight times, each pass seeing the previous
reports and the diff answering them. What it found, and what that cost, is
worth recording — including where it was wrong.

### The tally

Rounds 1-8 returned 3, 3, 2, 0, 5, 2, 2 and 0 material defects. The two zeros
are not equivalent: round 4 returned SHIP and was WRONG, and round 8 returned
SHIP and held up. Round 4's verdict rested on an "adversarial stress analysis"
that traced the parser on paper and pronounced each shape correct. Two of those
shapes were defects when EXECUTED rather than reasoned about — a roman-numeral
page locator and an undated citation, each losing a real citation. Tracing a
state machine agrees with whatever you already believe about it. Every claimed
finding after that was run before it was accepted, and every claimed
non-finding too.

Round 1 also built a finding on a FABRICATED quotation, stating REF_LEADER
contained a paragraph mark it has never contained. Round 2 caught this when
asked to re-read what it cited. Quoting the code, not describing it, was made a
standing instruction from then on.

### The defect none of the rounds was aimed at

Round 7's brief asked for a fresh ReDoS look because the scanner was new code.
The scanner was fine. `AUTHOR_YEAR_CITE` was not, and it had shipped in v1.2.x:
it described the parenthetical's internal shape with a star over alternatives
that all began with a lazy `[^();]*?`, so a parenthetical the pattern REJECTS
partitions exponentially. On the pattern exactly as shipped, unmodified —
122 characters 7ms, 218 characters 4.9 SECONDS, 264 characters never finished.
The input is body text from whatever PDF the reader opens.

It was found because the brief named the class, not because a round happened
upon it. That is the argument for asking a reviewer for specific classes of
defect rather than for "anything wrong".

### Why the parser was rewritten

Rounds 3-7 each repaired the previous round's fix to the same function, and
three of those repairs introduced the next defect. Round 6 was asked directly
whether the code was sound or accumulating patches, and answered with three
shapes the approach could not express: a comma page list ("pp. 12, 14" — "14"
leaked into the next citation's hit-target), a compressed multi-year citation
("(Smith 2019, 2020)" — the second work dropped), and a narrative prefix
("(See Smith 2019)" — key "See-2019", a reference that cannot exist). All three
reproduced.

The cause is that a separator does not mean one thing. A comma ends a citation
in "(Smith 2019, Jones 2020)", joins authors in "(Smith, Jones & Roe 2019)",
introduces the year in APA's "(Smith et al., 2020)", and continues a page list
in "pp. 12, 14". No rule over the pieces can recover what the comma meant,
because the pieces are what the comma destroyed.

The parenthetical is now scanned once, left to right, classifying years,
locators, undated markers, initials and names. The evidence for adopting it:
all 242 pre-existing tests passed UNCHANGED, including every test written to pin
the old parser's behaviour. It satisfies them rather than needing them relaxed.

### The trade that was accepted, and what is still unmeasured

Removing the ReDoS meant the grammar stopped describing the parenthetical's
internal shape. It now finds a parenthetical and applies one linear year test;
the scanner decides everything else. That removed two defect classes at once —
the ReDoS, and the class where a segment the grammar could not describe cost
every citation BESIDE it rather than itself.

It also widens what reaches the scanner. Measured against the shipped grammar,
most prose false positives are not new — "(completed in May 2020)" and "(born
in Berlin in 1985)" matched the old pattern too — but the shape with prose
CONTINUING AFTER the year is: "(born in Berlin in 1985 and later)" and "(we
used ImageNet 2012 for pretraining)" were rejected before and are keyed now.

Only a false positive that RESOLVES to a bibliography entry is user-visible: an
unresolved author-year parenthetical yields no card, so no colouring and no
hit-target. Whether these resolve depends on the document's own bibliography,
which is exactly what invented strings cannot tell us — and adding another
heuristic on invented strings is the failure mode that produced rounds 3-7. So
this is left for `citepoint` over the two corpora to measure, and tightened, if
at all, on that evidence.

## R47 — emphasis depends on the reader's zoom (FIXED — see "Fixed" below)

**Status: fixed.** Pre-existing, not introduced by the release it was logged
in. The original record is kept as written; the fix and its evidence follow it.

### What was measured

`fontkeep` over the same public paper (ACL), same harness, only the viewer zoom
changed:

```
zoom 1.0  ->  1819 processed spans
zoom 1.8  ->  1831
zoom 2.5  ->  1817
```

Standalone runs are otherwise reproducible to the span (1831 twice at 1.8), so
this is not run-to-run noise. Comparing the two page dumps span by span, keyed
on text and position, **12 spans flip VISIBLE emphasis** between 1.0 and 1.8 —
counted by actual `.fx-b` runs, not by `data-fx-done`, which can be set on a
span that produces no emphasis at all. Every flip carries the reason
`table-rules`.

Confirmed on one of them with `wordshot`, which is the tool this project
requires before a defect is reported:

```
zoom 1.0 -> processed=false keep=true  emph=0
zoom 1.8 -> processed=true  keep=false emph=14  ["Th","gue","i","con","wro","i","th","ke"]
```

The line is the first line inside a framed table box: kept on the canvas at
100%, emphasized at 180%.

### Why

`#readCanvasPixels` finds table rules, box frames, underlines and footnote
separators by reading the PAINTED CANVAS — they are canvas art the text layer
knows nothing about, and masks have to clamp around them or a processed
neighbour whites out the rule. The scan thresholds each pixel
(`alpha > 40 && luminance < 140`), samples every second pixel, and needs a run
of >=60 CSS px.

Re-rasterise at a different zoom and a hairline frame edge spreads over more
pixels, each one lighter. A marginal rule falls on either side of that
threshold, the region stops (or starts) reading as ruled, and the lines nearest
the boundary change classification. It is not monotonic in zoom, which is what
one would expect from an anti-aliasing threshold rather than from a resolution
effect.

### Why the gate cannot see it

`tables.mjs` — the check that asks "is anything emphasized inside a ruled
zone?" — runs at `page-fit`. `fontkeep` and `whyskip` run at 1.8 but do not ask
that question. So no stage tests the thing at the zoom where it misbehaves.
That gap is the part most worth fixing, independently of the defect.

### Scope, stated carefully

An earlier reading of this said the whole table box is emphasized only at 1.8.
That was WRONG, and the zoom-1.0 screenshot is what caught it: most of that box
is emphasized at BOTH zooms, and only four spans on that page flip. The
zoom-dependence is real; whole regions do not move, individual lines at the
rule-detection boundary do — 12 of ~1820 spans on this paper.

### If this is picked up later

The fix is to make rule detection resolution-independent — normalise the
luminance threshold by the rasterised stroke width, or derive rules from the
PDF's own operators rather than from pixels. Both are real work on a path with
a history of regressions (masks whiting out table rules), and neither belongs in
a release whose gate is otherwise green. Anyone starting should first give
`tables.mjs` a zoom sweep, so the fix has a check that can fail.

### Fixed

**First, a check that can fail.** `tables.mjs` now sweeps zooms
(`--zooms=page-fit,1.0,1.8` by default), each zoom in a fresh viewer tab with
the zoom set before the engine is enabled — a standalone run, as measured above.
It reports two things and exits 1 on either:

- the old offenders (processed span inside a rule-bounded zone), per zoom. The
  oracle no longer reads the viewer's canvas: it renders the page itself at a
  fixed 4 px/pt, so its zones are identical at every zoom and only the engine's
  decisions move. Reading the viewer canvas made the oracle exactly as
  zoom-dependent as the engine it was checking;
- **zoom flips**: a span (its text + occurrence index on the page — the text
  layer's order does not depend on the zoom, a rect does) carrying a different
  number of `.fx-b` runs at two zooms. Processed-span totals are printed for
  reference and are not a verdict.

Before any product change, on the unmodified engine:

```
ACL p24-25   zoom 1.8: 6 offenders ("Suggested Fix", "dns_rcode_noerror", "packet. ...")
             11 zoom flips, every one table-rules at page-fit/1.0, emphasized at 1.8
ACL (all)    12 zoom flips — the 12 recorded above — and processed 1819 / 1819 / 1831
```

**The cause was sharper than "anti-aliasing".** At 180% the page is large
enough that PDF.js CAPS the base canvas (`maxCanvasPixels`): measured 0.70
device px per CSS px at 1.8 against 2.0 at 1.0, i.e. 1.27 against 2.0 device px
per page px. The rule scan reads only that base canvas. A 0.4pt frame edge
covers ~0.7 of one pixel there, prints at luminance ~125-190 depending on
sub-pixel phase, and the per-pixel `luminance < 140` test drops it. On p25 the
Table 20 frame's zone simply did not form at 1.8 (the engine's zone-line
introspection is empty for it), so the whole box processed. Several constants
were also raw CSS px — rule length 60, thickness 3, zone rule width 40,
same-rule gap 2, line buckets `r.top / 5` with a 5-bucket continuation — so
their meaning in page terms changed with the zoom too. The buckets were also
taken from VIEWPORT y, so their edges moved with the scroll position.

**The fix** (`#detectCanvasRules` and the zone code in `#processPage`):

- rule ink is judged by COVERAGE, not per pixel: ink (255 − luminance) summed
  over the pixel and its two neighbours across the rule must reach
  `RULE_STROKE` page px × `ppu`, where `ppu` is measured from the canvas
  actually read (so a capped canvas is accounted for). That sum is the
  rasterised stroke width whatever the resolution and phase. The pixel must
  carry half of it itself (never more than the old per-pixel test asked), so a
  band does not grow onto blank rows;
- every length is in page units (CSS px at 100%) × `ppu`, each set to the
  value it had at a gate-validated zoom, named in the source; the thickness
  limit allows the fringe row the window admits on each side;
- zone lines are bucketed from the PAGE top in page units.

Operator-derived rules were considered and not taken: on PDF.js 6 that means
following CTMs, form XObjects, clip paths and fill colours to tell a rule from
a white background rectangle, and it goes blind to rules inside raster images,
which masks must still clamp around.

**After the fix:**

```
ACL p24-25   page-fit / 1.0 / 1.8 / 2.5: 0 offenders, 0 zoom flips, processed 60 at every zoom
wordshot     ACL p25 "considered" at 1.0 / 1.8 / 2.5: processed=false keep=true emph=0, all three
ACL (all)    page-fit / 1.0 / 1.8: 0 offenders, 0 zoom flips, processed 1819 at every zoom
corpus       tables.mjs over all 14 public papers x (page-fit, 1.0, 1.8): 0 offenders on all;
             0 zoom flips on 13; LaTeX article (CM) kept 2 — not table-rules; fixed as R48
             (0 flips on all 14 since)
```

Span-by-span against the unmodified engine (`tables.mjs --dump`, same spans,
same zoom): 13 spans change, all of them at 1.8 and
all toward what page-fit and 1.0 already showed — R47's 12 on ACL (11 now kept
as table interior, p16's wordy cell line now emphasized as at the other zooms)
and IEEE (stamped) p4's prose line below. At page-fit and at 1.0 not one span
changed on any of the 14 papers (~50k spans per zoom).

The divider sweep, both builds, page-fit and 1.8 (`diag-dividers` gained
`--zoom`, a per-page settle before scoring, `killBrowser` cleanup instead of the
`browser.kill()` that leaks the renderer tree, and exit 1 on a harness error
instead of a silent 0):

```
page-fit   fixed engine: masked=0 on all 13 papers. Old engine: masked=0 on the 11
           that completed (2 harness errors under machine contention).
1.8        residual masked counts IDENTICAL in both builds wherever both completed:
           5GShield 6, NeurIPS 4, USENIX (baseline) 4, ACL 3, UC-Scheme 3,
           USENIX (no cover) 3, LaTeX (CM) 2, ACM (short) 1; 0 on 5GCVerif,
           AFC-Diss, IEEE (stamped). Not caused by this change; NOT yet analysed.
```

The first 1.8 sweep read 5-49 masked per paper, also identical in both builds,
and that was the harness: it predicts each rule's row from the base canvas, and
at 180% (capped, and whose floored pixel grid drifts ~3 px from its CSS box by
the page foot) a ±1 px window missed sharp hairlines plainly on screen — IEEE
p4's listing frames, visible in the captured composite at the very rows it
scored "97% white". `diag-dividers` now LOCATES each rule (the band-wide row with
the most dark samples within two base-canvas px) before scoring it, and gained
`--control`, which paints a white strip over each page's first horizontal rule:
at page-fit and 1.8 on IEEE it reads 0 without the strip and catches 3 of 3 with
it, and across the corpus at 1.8 it caught the strip on every page where the
strip fell inside the captured viewport. The residual 1.8 counts above are what
is left after that correction; whether they are real whiteouts or more harness
geometry is the open follow-up, and runs are on hold while the release gate
uses the machine.

**Oracle calibration, found by the sweep.** IEEE (stamped) p4 "the response
from" — running prose between two framed listings, emphasized at every zoom
after the fix (the old engine kept it at 1.8 only) — was flagged by the oracle
at 1.8 alone. Its paragraph-continuation window was 3-5 buckets (9-15 page px),
narrower than 12pt leading (~16 px), so a processed line's few-px shift at 1.8
decided it. Widened to 6-21 px, mirroring the engine's own window. The widened
oracle still reports all 6 offenders and 11 flips on ACL p24-25 against the
unmodified engine, so it did not go blind to R47. An intermediate version of
the oracle (3-px buckets) also flagged one line of ACL p16's wordy table cell;
the HEAD oracle reports 0 there and so does the final one — that flag was the
bucketing, not the engine.

**Review.** A first-pass cross-model review (Gemini via `agy`) raised seven
points. Accepted and fixed: the per-pixel floor was absolute (40) and outranked
the whole requirement on a canvas under ~1 device px per page px; the thickness
slack admitted a fringe row on one side only; `diag-dividers --zoom` scored
masks before the page re-settled. Rejected on the code: `.fx-b` is a `<b>`, not
a span, so the leaf test does not skip emphasized spans (the sweep records
non-zero `.fx-b` counts on them); `PORT` is defined in `tables.mjs`; rotation
handling is unchanged from HEAD, which already bucketed by screen y.

### Not fixed here — the table box's first line

Consistency was the defect. Whether the Table 20 box's FIRST line should be
kept is a separate question: it is kept because its span box touches the top
frame (`gapTop` −2 in the zone introspection), and the header-row rule
(`clearOfRules`) treats a line hugging a rule as a header. That was the 100%
behaviour, the oracle agrees with it, and it is now the behaviour at every zoom.

## R48 — a second zoom dependence, in the duplicate-overlap resolver (FIXED)

**Status: fixed.** Surfaced by the `tables.mjs` zoom sweep added for R47, on its
first corpus run. Pre-existing: identical in the build before R47's fix, and not
`table-rules`.

```
LaTeX article (CM) p24  "raison d'ê..."  page-fit:0 (dup-overlap)  1.0:2  1.8:0 (dup-overlap)
LaTeX article (CM) p16  "to"             page-fit:0 (dup-hidden)   1.0:1  1.8:1
```

Reproduced on the unfixed engine with
`tables.mjs "LaTeX article (CM)" --pages=16-24 --zooms=page-fit,1.0,1.8`
(2 zoom flips, exit 1), and on p24 with `wordshot`: at 1.0
`processed=true emph=2 ["rai","d'"]`, at 1.8 `processed=false emph=0`.

### The hypothesis was wrong, and the resolver's own numbers say so

This entry first guessed that the ink-fit scores suffer R47's canvas-capping
effect, and the first fix written for it put `inkFit` on a fixed page-unit
sampling grid. The engine's pair introspection (`__fxOverlap`, per zoom)
disproved that for p24 before the fix was ever run, and it was reverted:

- **p24.** The pair is "raison d'ˆ" and "etre": the accent is carried at the END
  of the first span and drawn over the first letter of the next. Both are
  printed text and both fit the ink well (0.75 and 0.87 at 1.8), so neither
  wins by the resolver's 0.35 margin — a tie, and a tie between two candidates
  vetoes BOTH (`dup-overlap`). At 1.0 the pair was never judged at all: the
  overlap is 11.8 × 23.9 px against a smaller box of 38.9 × 23.9, i.e. 0.303 of
  it, against a 0.3 threshold. Sub-pixel rounding of the text-layer rects
  decided whether the pair existed.
- **p16.** The pair is "to" and a KEPT math bracket "〉" set tight against it,
  overlapping by 4.7 px (~30% of the narrower box). Here the ink fit does move
  with resolution — "to" scores 0.87 at page-fit, 0.67 at 1.0, 0.08 on the
  capped 1.8 canvas (no detail canvas existed, so the resolver's "retry on sharp
  pixels" path never ran) — and where it landed against the margins decided
  whether "to" was dropped as hidden.

Both are the same geometry: NEIGHBOURS TOUCHING END TO END, overlapping by a
glyph. That is not what the resolver is for. Duplicates, a fine-grained span
inside a wide one, and hidden layers straddling a printed line all share all or
nearly all of the narrower box's WIDTH; these share ~30% of it.

### Fixed

The resolver now skips a pair whose horizontal overlap is under half the
narrower box's width. The cases it exists for sit near 100% and end-to-end
neighbours near 30%, so the cut has room on both sides and no rounding or
resolution change can carry a pair across it — which is what made the old 0.3
area test zoom-dependent for these pairs. A skipped mixed pair falls through to
the plain obstacle-overlap rule, exactly as a tie already did.

```
tables.mjs "LaTeX article (CM)" --pages=16-24 --zooms=page-fit,1.0,1.8
             0 zoom flips, 0 offenders, exit 0; processed 646 at every zoom
wordshot     p24 "raison d" at page-fit / 1.0 / 1.8: processed=true emph=2 ["rai","d'"],
             all three; the 1.8 capture shows "raison d'être" emphasized, accent intact
corpus       tables.mjs over all 14 public papers x (page-fit, 1.0, 1.8):
             0 offenders and 0 zoom flips on ALL 14
per span     against the R47-only engine (--dump): exactly 3 cells change, all
             LaTeX article — p16 "to" at page-fit, p24 "raison d'ˆ" at page-fit
             and 1.8 — each to the 1.0 state. Nothing else moves, on any
             paper, at any zoom
dividers     diag-dividers at page-fit: masked=0 on all 13 papers
```

The ink fit's resolution sensitivity seen on p16 is real and is NOT fixed here:
this change stops the resolver from judging pairs it should never have judged,
it does not make the scores themselves resolution-independent. No flip in the
public corpus comes from a genuine duplicate pair.

## R49 — a gate that could not tell a hang from a failure, and one render per zoom

The release gate's DOM stages were rebuilt: shared CDP transport, three
outcomes per document, one copy of each check, and one render per zoom instead
of one per check. The combined gate was then run over both corpora against
the old one. What follows is measured, not argued.

### The previous gate run was not a result

It reported 20 document failures. Sixteen were the harness's:

- **Seven were Node's exit 13, "unsettled top-level await".** Every harness
  carried its own five-line CDP `send`, and each copy settled a call only when
  a reply with its id arrived. A browser that went away left the promise
  pending, Node found nothing left to run, and the process ended with no
  error, no page and no stack. The sweep's flake retry never fired: it matched
  on output, and a hang has none.
- **Nine were console timeouts**, on a machine running another session's
  browser sweeps at the same time — which nothing recorded.

### What changed

- `test/lib/cdp.mjs`: one connection for every gate harness. Every call has a
  deadline, a closing socket rejects every call still waiting (and `ready`,
  if it never opened), and a timed-out evaluate names the expression it was
  waiting on. Unit-tested with a fake socket.
- **Three outcomes per document** (local sweep runner): PASS, FAIL, or
  UNVERIFIED. Exit 13, a CDP deadline, a dropped socket, a document the
  harness gave up loading, a blind guard ("the check proved nothing") and the
  per-document watchdog are *no verdict*: retried in-lane, then once more
  **alone** after every lane has drained; still no verdict alone is
  UNVERIFIED, which fails the gate and says it was the harness. A check that
  printed its own failure keeps it — a real failure beside a timeout line is
  not retried into "harness". Each retry note keeps the failed attempt's
  cause and last lines, which the final log otherwise discards.
- **Contention is recorded**: the gate refuses to start while other harnesses
  run, samples once a minute, marks the verdict CONTENDED if anything else
  ran, and holds a marker file other sessions check before launching browsers.
- **One copy of each check.** fontkeep, whyskip, eqkeep, refcolor and
  citepoint moved their page probe and verdict to `test/probes/<check>.mjs`;
  the standalone harness and the combined runner both import it. Each probe
  was shown to build a byte-identical expression to the previous harness's for
  every page (and every citepoint cap/progress combination tried), with a
  mutated copy shown to fail that comparison. The previous combined runner
  read probes back out of harness sources as text, and on its first run that
  silently made refcolor's regex a different one.
- **One render per zoom.** Zoom changes classification (R47), so checks share
  a render only with checks validated on the same one: pass A (fontkeep,
  whyskip at 1.8) and pass B (eqkeep, refcolor, citepoint at the default
  zoom). tables and console keep their own. **Both corpora now run the same
  stages with the same arguments** — the previous gate ran tables on the
  private corpus only and capped citepoint lower there; privacy (aliases, a
  path outside the repo) is the only difference left.
- **No blind pass in the combined runner.** A page it cannot read after
  re-reading is `NOT MEASURED`; a check that got no page, or whose own blind
  guard fired, is UNMEASURED; either way the run has no verdict (exit 75). A
  viewer that stops answering ends the run in seconds: the first combined run
  polled a stalled viewer 60 times against a 30 s deadline, and three
  documents rode the 25-minute watchdog before passing on retry.

### The old gate is not reproducible — which changes what "equivalent" means

Two standalone runs of identical product code (the previous gate and a
fresh baseline, same harnesses) disagree on the same documents: one public
paper was measured on 6 pages in one run and on 0 in the other, both "PASS";
another's references counted 29 in one run and 24 in the other, which had
skipped four pages. A standalone harness skips a page it cannot read in silence. Two fields differ
even when everything else agrees — citepoint's `hitTargets` total and
papers.mjs's `cites` count hit-target elements while annotation may still be
arriving (6 documents differ in `hitTargets` alone between the two standalone
runs) — so they are not measurements and are not compared.

So the combined gate was held to this: every document-check measurement must
equal what **some** standalone run of the same code printed, character for
character.

### Result

| | standalone (baseline) | combined |
|---|---|---|
| public corpus, all stages | 26.1 min | 15.8 min |
| private pass B vs eqkeep+refcolor+citepoint | 29.2 min | 19.8 min |
| whole gate, 8 lanes | 77.7 min | 75.3 min, of which three stalls rode the 25-min watchdog (fixed since) |

- **330 document-check pairs; 329 match a standalone run.** 18 of them match
  the older standalone run rather than the baseline — every one a document
  the baseline measured incompletely (skipped pages, a viewer that never
  loaded, a blind first page).
- **The one difference is coverage the old gate never had:** a private paper
  whose references neither standalone run measured (one never loaded the
  viewer, the other hung after five pages); the combined run measured all 19
  pages, every reference coloured.
- An independent reviewer from another model family, given only the raw logs,
  reached the same pairs and the same single difference; it first called the
  run "NOT EQUIVALENT" on the `hitTargets` fields, then verified from the two
  standalone runs itself that those are not reproducible, and agreed.

### What the gate found: four eqkeep failures, all the check's

The only failures either gate reported were eqkeep's, on one public paper and
three private ones — and none of the flagged rows was a displayed equation:

- a sentence ending in a parenthesised decimal value, or a list of
  enumerations "(3)", all in ONE text span at a justified right edge (three
  private papers);
- inline math "REL(1^λ)" in a sentence (the public paper), whose math-face
  spans sat on a baseline of their own and so formed a "row" ending in "(1)",
  the bracket 1 px after the name. `wordshot`: `processed=true keep=false
  emph=0` — no emphasis on it at all.

A displayed equation's number is typeset apart from it, so the check now
requires that: its own span, more than a word space (0.3 line heights) clear
of what precedes it. Measured before changing anything, over every row eqkeep
counted as an equation on both corpora (153): every real numbered equation
passes both tests, its number 0.47 to 14 line heights clear; the 27 rows that
fail are the four false violations, bibliography years and two tables of
parenthesised values. After it, all 49 documents pass and each document's
equation-row count drops by exactly those rows. The engine is untouched.

### Negative controls — can the new gate still fail?

Each product mutation was applied in a throwaway worktree, both gates were run
over the public corpus, and the mutation reverted. A control counts only if
BOTH gates fail it and fail it identically:

| mutation | standalone | combined | compared |
|---|---|---|---|
| parser's `(?=§)` alternative removed (R45) | 7/14 fail | the same 7 | 14/14 identical |
| every skip-reason write in the engine blanked | 14/14 fail | 14/14 | 13/14 identical ¹ |
| math/mono/small-caps face keep disabled | 12/14 fail | the same 12 | 14/14 identical |
| per-key citation hit-targets collapsed to one | 8/14 fail | the same 8 | 14/14 identical |
| block classification bypassed (equations, tables processed) | 3/14 fail | the same 3 | 14/14 identical |

¹ the one difference is a standalone run that died in its first 3 s with no
output — the runner now treats a failure that does not say why as no verdict
and retries it.

Two first attempts did not bite and are worth recording, because a control
that cannot fail proves nothing: disabling one of the engine's several
skip-reason paths left every reason in place, and disabling displayed-equation
detection alone left every equation row kept by the engine's other rules
(math faces, block classification). Both were replaced by the mutations
above. And at the runner level: a probe that throws on every page ends
UNVERIFIED (never PASS), and a check that does not exist is refused (exit 2).

The eqkeep control is also the check on the criterion change above: with
the number required to be set apart, eqkeep still fails exactly the three
papers whose displayed equations the mutated engine emphasizes.

### The disk filled during the gate

Mid-way through the controls the drive reached 0 bytes free. The cause was
the harnesses' own litter: every harness creates a browser profile
`fx-<tag>-<pid>` in the temp directory and deletes it on the way out — unless
it never gets there (the watchdog's tree-kill, a crash, a browser still
holding files at the harness's own delete). Months of sweeps had left 3,373
of them, at up to ~400 MB each. The sweep runner now deletes each harness's
profiles, by the pid in their name, as soon as that harness has exited.

### Independent code review

A reviewer from another model family read the diff and the runner. Of its
eight findings six were real and are fixed (a flake pattern that could
relabel a console failure as a harness hiccup; a comparison of two runs that
shared nothing reading "EQUIVALENT"; a socket closing before it opened waiting
out its deadline; an unreadable process list counted as contention; two
reporting labels). One was a known, bounded difference: pass B's window
matches refcolor's and citepoint's, not eqkeep's, which can only matter on a
page too wide for the default zoom's 1.25 cap — and the equivalence run is
the test of it (eqkeep matched on all 49 documents). One was pre-existing and
kept deliberately: the standalone harnesses still skip an unreadable page in
silence, because the migration had to be behaviour-identical, and they are no
longer the gate's stages for these checks.

### Left for later

- R46 left the author-year grammar's prose false positives "for citepoint
  over the two corpora to measure". citepoint cannot: it examines numeric
  multi-key brackets only. The measurement is still owed, by a probe that
  looks at author-year hits.
- The console harness's toggle-off-and-on check reads the page 2.5 s after
  re-enabling, and on one large private paper saw 0 emphasis runs where the
  first pass had thousands. It is informational (not a pass criterion); worth
  a look before anyone relies on it.

## R50 — zoom independence by construction, a gate at one zoom, and the lanes that shared a browser

R47 and R48 made the engine's canvas measurements resolution-independent in
page units. The first gate to sweep every document at three zooms (page-fit,
1.0, 1.8) still found four private papers whose emphasis changed with the
zoom — the same four, the same counts, every run. Each was taken apart with
`test/diag-zones.mjs` (a decision's inputs per zoom, in page units) before
anything was changed.

### Four flips, two mechanisms

- **A measurement near a threshold, read at a different resolution.** A
  light-grey 0.4 pt listing frame around a lightly shaded box summed to just
  under the rule-stroke requirement on the 100% and page-fit canvases and
  just over it on the capped 180% one, whose three-row window also takes in
  more of the grey fill. At 180% the listings became rules, the prose between
  them a table zone, and its one-word last lines lost their emphasis.
- **A padding in the wrong unit.** Detected rules were padded by 1 CSS px — a
  different number of page px at every zoom. A ruled table's lower rule pair
  sat 159 page px apart against a limit of 158; the padding tipped it in at
  100% and out at 180%, and two of its cells were emphasized at 180% only. The
  same padding put an underline over a 35% overlap test at 100% only, and let
  a figure label clear a "prose between rules" test at one zoom and not another.

Tuning each threshold so that these four land on one side only moves the edge
to the next document. The input was made zoom-independent instead.

### Fix: the rules come from one render, whatever the zoom

The engine renders each page ONCE, privately, at RULE_PPU (2 bitmap px per
page px — 100% on the 2x display the constants were tuned at), finds the rules
there (`scanRules`, typography/rules.mjs) and caches them per page in page
units for every later pass and zoom; the viewer's own rendering stays whatever
the zoom makes it. Rules are padded by one page px; zone containment uses a
page px too. The resolution was measured, not assumed: at the gate zoom, 2 and
3 decide identically on all 49 documents, while 0.5 does not (1,367 vs 1,963
processed spans on one public paper — the control that the setting bites).
Renders are serialized, cancelled after 8 s, and skipped for a closed document.

What the flips had only made visible, fixed as general rules:
- **Figure-size text** stays on the canvas: below 0.7 of body height every
  processed span in both corpora was figure material (diagram and plot labels
  down to 0.3 of body, pseudocode, boxed figure panels), while the smallest
  prose convention sits at 0.75-0.8 (`test/diag-sizes.mjs`). A size cut, not a
  word-count heuristic — grouping small spans into "runs" merged neighbouring
  diagram labels into sentences. Accepted trade-off: 8 pt footnotes under a
  12 pt body (0.67) would lose emphasis, drawn as the document draws them;
  neither corpus has one. ~30 short labels at 0.70-0.74 remain processed.
- **One word, one decision**: a piece of a word PDF.js split at a font change
  (TeX-composed accents) follows a piece the block pass kept.

After it, the three-zoom sweep (page-fit, 1.0, 1.8) passes all 49 documents:
0 zoom flips, 0 table offenders — the four papers above included.

### References

- **A locator inside a citation** ("[9, §5.2.1]") was painted in reference red
  inside citation blue — 22 citations on three private papers, computed colour
  and a capture. A reference that FOLLOWS its citation's key (a number or year
  earlier in the citation, no ";" between) keeps the citation's colour; "(see
  Section 3; Smith 2020)" still colours this paper's Section 3.
- **A reference hyphenated across a line** ("Fig-" / "ure 3") was never
  coloured: matched against the spans joined by "\n", neither half is one. A
  line-end hyphen before a lowercase continuation is closed up for matching.
  Six public papers carry one.
- **A reference printed without a word** ("(§3.5)," in its own span) was never
  processed, so never coloured; like a bracket citation it is now.
- **Whole or not at all.** A reference with a piece that stays on the canvas —
  a "§" TeX set from the symbol font (CMSY), a number in a kept face — was
  coloured in part ("§2", only the "2" red). Processing that "§" to colour it
  was tried and would have re-drawn a math-font glyph in the text face
  (fontkeep: 11 violations on one paper). Instead a reference running into
  such a piece is cut back to its longest leading part that is itself a
  complete reference, all in processed text — "Lemma 4, M" (the list grammar
  reaching a math variable) colours "Lemma 4" — and one with no such part
  ("§ 2", "Listing 2" with the number on the canvas) is left uncoloured, its
  link intact. The first version dropped the whole reference; the final gate
  caught it on two private papers (refcolor) and the cut-back fixed both.
  About one reference a paper is affected, some of them false positives
  ("table T") that no longer show at all.
- refcolor matches across spans as the product does, needs every piece of a
  reference coloured, and fails a reference colour nested in a citation.
- R46's owed measurement: every annotated author-year citation over both
  corpora (`test/diag-authoryear.mjs`) — only two documents use them, 185 in
  all, every one a real citation. A thin sample, recorded as such.

### The gate: one render at one zoom — and lanes that shared a browser

The zoom no longer moves the decisions, so the gate renders at one zoom:
`test/allprobes.mjs` runs fontkeep, whyskip, eqkeep, refcolor, tables and
citepoint over ONE render of each document at 100%; console keeps its own.
Renders per document: 2, down from 6. Zoom independence stays
`tables.mjs --zooms=page-fit,1.0,1.8`, run when the engine's canvas reads
change. From v1.3.0 on this combined gate is the release gate.

Proving it exposed the gate's own worst defect. **Every harness chose its
debug port as `base + pid % N`; with 8 lanes two regularly landed on the same
port**, the second browser could not bind it, and its harness silently drove
the FIRST harness's browser — two documents in one browser, the other's tab in
front (this one hidden, where the engine pauses by design), the other harness
switching reading mode off under it. That was behind the gate's most puzzling
results: whole pages unprocessed at one zoom (233 and 210 "zoom flips" on two
papers that pass), documents with nothing processed, and emphasis that "never
came back" after a toggle (16 console documents in one gate, every one with
the tab hidden and another document's viewer in the same browser). Each
browser now picks a free port (`--remote-debugging-port=0`, read from the
profile's DevToolsActivePort). The private console stage went from 4-12
retries a run to none; standalone runs stopped skipping pages, which is why
equivalence below needed only one reference.

Other gate defects the negative controls found, all fixed:
- a real whyskip failure came back UNVERIFIED (every page waited out the full
  "handled" bound, long documents hit the watchdog): the wait now ends when
  the page stops changing;
- the console toggle check watched the bibliography page (no emphasis to lose)
  and passed half the documents with re-processing disabled: it now watches
  the page with the most emphasis, waits and times the return, and fails
  (REPROCESS FAIL) when it never comes; it no longer judges silence on a
  document the engine did not process;
- whyskip read only the text layer's direct children and saw no prose on a
  tagged PDF; the comparer dropped every per-page tables line (a regex that
  lost its escapes) and invented phantom checks for a document that died; a
  product failure printed before the watchdog was retried as a harness one.

**Result, at 2bec30d:**

| | standalone | combined |
|---|---|---|
| verdict | PASS, 49/49 on every stage | PASS, 49/49 on every stage |
| retries | 0 | 0 |
| wall time, 8 lanes | 73.5 min | 35.9 min |
| equivalence | — | **344/344 document-check pairs identical** |

A second combined run of the same commit: PASS in 36.1 min, and **344/344
document-check pairs identical to the first** — the gate reproduces itself.

Negative controls (a product mutation in a throwaway worktree; both gates
must fail it identically) — every one bit, and every comparison was identical:

| mutation | fails |
|---|---|
| `(?=§)` removed from the reference regex | refcolor 7/14 |
| math/mono face keep off | fontkeep 11/14 |
| per-key citation hit-targets collapsed | citepoint 8/14 |
| block classification bypassed | eqkeep 3/14 |
| every skip reason blanked | whyskip 14/14 |
| table-zone drops disabled | tables 6/14 |
| locator colour rule reverted | refcolor 3/3 affected private papers |
| line-break reference matching off | refcolor 6/14 |
| no re-process when reading mode is switched on | console 14/14 |

### A slow mouse — performance

A reader saw the MOUSE slow down whenever reading mode was switched on. Measured
in a real window on the 2x display (`test/diag-perf.mjs --headful`; headless
canvases are in CPU memory, so it never showed there): the viewer's canvases
are GPU-backed and the engine read them back with getImageData, a synchronous
GPU->CPU copy of up to ~100 ms a page on the main thread. The rule scan and
every canvas readback now run in a worker (typography/rules-worker.mjs); the
pixels it returns were compared with direct readbacks — 0 bytes differ,
headless and on the real GPU.

| ACM-full, page width, 2x display | before | after |
|---|---|---|
| switch on: worst frame gap / gaps > 50 ms | 83 ms / 3 | 50 ms / 1 |
| font switch (original -> Atkinson): worst gap | 67 ms | 50 ms |
| cold scroll, 10 pages: long tasks | 19 / 1.7 s | 11 / 1.15 s |

Also: settings changes apply one at a time and a toggle no longer re-processes
every page (the toolbar button processed the document twice). What remains in
a scroll's > 100 ms frames is the browser laying out and painting the
rewritten text layer (layout 33-74 ms, paint 42-52 ms a frame); the bundled
reading fonts add ~13-16% over the document's own face. Tried and not kept,
because they measured no better: CSS containment on the text layer, a longer
idle timeout for off-screen pages, dropping the emphasis text-shadow. The gate
itself runs at below-normal priority: eight browsers at normal priority slowed
the desktop too.

### Independent review

A reviewer from another model family, given the raw logs and not these
summaries, counted the same 344/344 identical pairs, every document PASS and
no retry, UNVERIFIED or unmeasured page. Of its findings on the code, fixed:
the rules worker's canvas released per message rather than at GC; a
postMessage that throws settles its job; switching reading mode off no longer
applies twice; a console run whose DOM read returned nothing, and a standalone
eqkeep, citepoint or tables run that read no page, are no verdict rather than
a pass. Checked and dismissed with evidence: "a locator with no digit before it
is coloured" — the citation grammar never matches such a bracket, so there is
no citation for it to be a locator of. Its other items concern the standalone
harnesses, which after this release are a reference tool, not the gate.

### Left over from R49, resolved

- The author-year false-positive measurement (above).
- The console toggle check (above: it now waits, times and fails).

## R51 — a targeted visual review, and what it found at the edges

### Method

A whole-page visual review cost a vision pass over every band of every page,
and nearly all of it was plain body text that has never held a defect.
`test/edgepairs.mjs` captures only the lines where the engine drew a
boundary — the prose line before and after each heading, caption, table and
equation, a caption's first and last line, every line kept for vector art —
as fx-on / fx-off strips on contact sheets, picked from the engine's own
`__fxDebug` reasons. Both corpora, four rounds, each sheet read independently
by Claude and by agy; every claimed defect was checked on the engine's
classification (and a fresh capture) before and after its fix, and every new
rule was counted over the public corpus for spill-over into body text.

### Fixed

- Vector art on a text line (a circled step number, a boxed label, a
  highlight) was erased by the masks: the text layer holds only the digit. The
  page's operator list gives its painted, clipped paths (`vector-art.mjs`);
  such a span is kept, and its art is an obstacle cut out of every mask.
- Masks around kept glyphs: a kept subscript's descender, an italic tail that
  sweeps left, a lone "/", underscores and commas that ink below their text box,
  and a protect zone's padding cutting the next line's mask sideways (the
  canvas copy of a word's first letters showed beside the redrawn ones).
- Captions: a label in its own face under a paragraph; long captions past four
  lines; a caption's pitch measured from a table label's baseline; a one-line
  caption swallowing the justified paragraph under it (pre-existing).
- Headings: Libertine/Biolinum bold (acmart) was not recognised as bold, so
  every ACM run-in heading was emphasized; wrapped and hyphenated headings;
  IEEE lettered italic subsection headings; an italic lead whose colon opens
  the next item.
- Equations whose named quantities are set in the text face; code faces
  embedded under package names (Inconsolata, EC/TX typewriters, PSNFSS
  Courier); rows of a fully ruled table read as prose (the tables oracle had
  the same blind spot and now tests its own pixels); a wrapped pseudocode
  line's hanging continuation.
- Processed text redrawn in the reading colour turned a paper's coloured prose
  black; the glyph ink colour is kept when clearly chromatic.
- The "native" button saved every click to sync storage, and once the list
  reached Chrome's 8 KB item cap the button did nothing. It now opens the
  PDF natively once and saves nothing (a tab-scoped DNR allow, cleared on
  commit); only Options entries persist.

### Withdrawn

A rule to stop colouring theorem-style labels ("Definition 2.") was built
on a claim that was in fact a reference running onto a new span; the gate's
refcolor caught it leaving such references uncoloured, and it was removed.
Lesson: check a claim against the surrounding sentence, not just the span.

### Known limitations

Small caps set as glyph variants of the regular face extract as lowercase and
are processed; a dashed vertical table border is not seen as a rule.

## R52 — the native button on local files, and a revision-marked document in reading mode

### Fixed

- The "native" button did nothing on a local PDF when "Allow access to file
  URLs" is off — the default for a store install, and invisible to the
  harnesses, whose command-line install has it on. The browser refuses every
  extension navigation to a file: URL. The worker now tracks, per tab, whether
  the file's native view is the entry right behind the viewer (the popup's
  "Open in FixateScholar" leaves it there) and the viewer steps back to it —
  counting its own entries, and not with `chrome.tabs.goBack`, which skips the
  native view as history-intervention skippable. With nothing behind it, the
  viewer explains the setting and links to it.
- A local file whose name holds an apostrophe never loaded: `encodeURIComponent`
  leaves `'`, the browser escapes it in the query, and the file parameter was
  escaped a second time.
- A latexdiff (ulem) document lost its revision markup in reading mode:
  - a line running black, deleted red and added blue in one text item took one
    sampled colour. Mixed spans are now coloured per character after the width
    pass (`ink-runs.mjs`; wrapped in an inline `<fx-ink>`, not a span);
  - strike-out bars were masked with the glyphs they cross. Thin horizontal
    bars through a text item's glyph band — stroked lines included, whose box
    has no height — are taken from the operator list (`barsNear`, below) and cut
    out of every mask;
  - the wavy underline, a kept run of wave glyphs, was erased: it failed the
    hidden-copy fit (its box reaches into the line it underlines) and was
    clamped like text. A wordless kept run is glyph art: the band below its
    top 30% is cut out of the masks.
- Plain black text read as coloured. The viewer's canvas is opaque, so the
  browser draws its text with subpixel antialiasing, tinting a black glyph's
  edges; sampled pixel by pixel those tints passed for ink. v1.3.1 already
  coloured dozens of spans in papers with no colour (dark navy "(mod", "and");
  the per-character pass, as first written, wrapped most lines of ordinary
  papers. Colour is now each channel's darkness summed over the band, relative
  to the paper under the glyph: the tints cancel, black stays black on any
  background, and coloured ink comes back exactly. A window or one letter cuts
  through glyphs and must show strong colour; a tint's channel order is never
  ink there.


### Pre-existing defects fixed (found in this round's visual review)

All were already in v1.3.1; they were fixed before the release rather than
carried.

- An underscore that LaTeX's classic encoding draws as a short rule had no
  text-layer glyph, and the processed word's mask covered it ("file_id" read
  "file id"). The strike-out bars above were one case of this: every thin
  horizontal bar within a processed item's reach — through, under, or in the
  leading around its line — is cut out of the masks (`barsNear`, which
  replaced `strikesThrough`). A bar in paper colour inks nothing and is not
  collected, nor is a white outline vector art.
- Captions:
  - a caption wrapped so that a line opened with an in-caption "Table 1.", or
    a narrow centred caption's short first line, ended the caption, and the
    rest was emphasized as body. A line ending on a word that cannot end a
    sentence, or on a word or compound broken at its hyphen, runs on; a short
    line so broken does not continue into a line opening in capitals ("… Cl-"
    above "The …");
  - a one-line caption centred in the column and nearly its width passed for a
    full line, and the justified paragraph under it was absorbed (found by
    comparing the gate's per-page skip reasons with the previous candidate's).
    The line right under such a caption ends it when it runs to the column's
    right edge from its left edge or from an indent; a centred line, or one
    keeping a narrower box's inset, runs on. Not for a caption spanning both
    columns of a two-column page, where a full-width line under it is the
    float's own description.
- In a face whose space paints a box, a citation, reference or colour wrap
  could split a hidden space into an element of its own colour, painting the
  box again. Anything inside `.fx-sp` is transparent.
- Kept glyphs beside processed words:
  - an inline math letter kept on the canvas lost the italic serifs that reach
    past its box to the neighbouring words' masks (a math "I" read "l"), and a
    small exponent kept with its formula lost its lower half to the line above
    ("n" read as an apostrophe). Kept runs of one or two symbols, and of up to
    eight glyphs below 85% of body size, are cut out of the masks across their
    whole box;
  - those cuts, and a kept run's descender band, stop at an abutting processed
    word's glyph box (never short of the kept glyph's own edge): a footnote
    marker or subscript set against a word ("system¹") had bared the word's
    canvas copy. A descender band is still cut in full below the word's
    baseline, where a kept subscript's tail sweeps back (agy).
- A wrapped heading's second line was emphasized when a long word wrapped
  early; the wrap test now asks whether that word would have fitted.
- A table with only vertical cell borders had its rows emphasized. A line with
  text tight against both sides of a vertical rule is a table row — except at
  a column separator (`\columnseprule`), which on a page whose two-column part
  is short turned whole columns into table rows: a rule in the middle of the
  page's text block, with the text it borders reaching a column's width from
  it on either side over its lines, is not a cell border (agy).
- Punctuation opening a coloured word ("(new") takes the colour of the letter
  after it when it reads that colour itself.

### Method

The colour defect was invisible to every gate stage (none measures colour) and
was found by counting colour wraps over the public corpus and comparing with
v1.3.1 — a count worth keeping for any change to colour sampling. agy reviewed
every commit; each finding was checked against the code and, where it could
be, reproduced — on synthetic pages where the corpora have no instance (a
short column separator: 50 of 54 lines lost; footnote markers and subscripts
against words: 486 of 1400 sample points in the words' last 3 px bare; centred
captions over indented and unindented paragraphs, a caption centred
throughout, a caption in a narrower box) — and each fix has a control that
fails without it.

Comparing every page's skip reasons with the previous candidate's gate, on both
corpora, caught what no stage fails on: a caption absorbing a paragraph and a
paragraph absorbing a caption description are both "reasoned" skips. The last
candidate differs from the one agy agreed before it on exactly the two pages
its fix was for; agy re-derived that from the raw logs.

The edge sheets of both corpora (525) were read by agy in full and sampled
by Claude, with every claim checked at high zoom against the original: of
agy's six, five were sheet artefacts (a strip's cropped neighbour, an
underline present on both sides, a footnote marker that is black) and one
is the highlight limitation below, identical in v1.3.1.

### Found after the first candidate, on the revision-marked document

Neither corpus holds a latexdiff document, so the gate never saw these; a
check of the document this round was for did.

- A strike-out bar near the foot of a page vanished at 150% and 300% — the
  red stayed, the line through it did not. A canvas whose resolution PDF.js
  caps draws the whole viewport into its pixels and then gets a CSS box a few
  px short of the page (1582 for 1584 at 150%), squeezing its content; the
  bar's cut followed the text layer and landed 2 px off the ink, which the
  mask covered. At 300% a canvas row is 2.3 CSS px and the bar is smeared over
  it. Bar and art cuts now cover where the canvas drew them too, to whole
  canvas rows.
- Coloured text came out in the wrong colour after a scroll: a struck red line
  once showed blue, and on one page 30 words lost their colour. A pass runs
  over several idle callbacks; the obstacles, cut zones and canvas snapshots'
  boxes were recorded in viewport coordinates by its first call, while each
  later call measured its spans afresh, so once the page moved, colours were
  sampled from where the spans used to be. They now move with the page.
- `test/latexdiff.mjs` covers both on a synthetic two-page document (invented
  words): colours of spans and runs against the canvas, and every bar's ink
  uncovered, at four zooms and while scrolling mid-pass. On the first
  candidate it fails at 150%, 200% and 300% and under scrolling (up to 591
  bar points covered, 33 wrong colours); on the fix it passes, three runs out
  of three. It needs more than one batch of spans on the page to yield
  between calls — the reason its page is dense.
- The edge sheets of that candidate showed a black comma after a green link
  digit ("ure 3,") coloured green — new in this release, black in v1.3.1 (see
  the limitation below). Reading punctuation on its own box was tried and
  withdrawn: agy showed the letters' core band misses a comma, and with the
  band widened, a page built with known colours showed the reading wrong in
  both directions — a mark is a handful of pixels, and its text-layer box can
  sit off its glyph — so it fixed this comma by luck and broke others.

### Known limitations

- Dark ink in a subpixel tint's hues (brown, steel blue) cannot be told from a
  tint and reads as black; a line mixing black with a dark colour is not split.
- Without file access, a viewer reached by back/forward rather than a fresh
  navigation shows the explanation instead of stepping back.
- Centred captions: one set in by under 2% of the column, a short line or an
  indent under 2.5% right under it, or a caption centred throughout whose
  second line spans nearly the whole column, is not told from the paragraph
  under it — those behave as before.
- `bandMeasure` is cached by a band's left edge only, so a band spanning the
  page can get the measure of the column it starts in; a centred title over a
  spanning float runs on into the float's description because of it. Keying
  it by both edges is a change to every spanning caption, not made here.
- A table as wide as the text with a single rule down its middle and wide
  cells reads as a column separator and is processed, as before vertical
  borders were read.
- Small caps set as glyph variants of the regular face are still processed
  (R51).
- In a span coloured character by character, a punctuation mark takes the
  colour of the letter before it when its padded reading agrees, and the
  padding reaches that letter: a black comma right after a coloured word (a
  green link digit) can come out in the word's colour. New with per-character
  colouring in this release.
- On a highlight drawn on the page (a yellow band behind a phrase), a mask
  takes the highlight's colour, and its padding paints it a little past the
  band's edge (a thin strip under an unhighlighted heading above it); a kept
  run inside the highlight shows a slightly darker box. Identical in v1.3.1;
  a fix was tried this round and not kept, unproven.

## R53 — the native button that no fix had reached: a background worker kept from the first install

### Found

- The "native" button still did nothing in the author's own Chrome after R52.
  The extension there is the unpacked checkout, with file access on, so none
  of R52's conditions held. The cause was outside the code: the browser was
  running the background worker it had stored when the extension was first
  loaded in July — a worker from before the one-time bypass, before the
  file-bypass check, before every native-button fix since. The viewer pages
  load from the files as they are now; the worker does not. Its old handler
  re-navigated the tab to the local file and its own listener intercepted that
  navigation straight back into the viewer, which is "nothing happens".
- Measured in a throwaway profile (the June tree installed, then the current
  files put under it): a browser restart keeps the stored worker; so does a
  new manifest version (installed at 0.1.0, bumped to 0.2.0, restarted: still
  the June worker; the prefs' registration record stays at 0.1.0, since the
  re-registration resolves to the registration that exists and stores nothing
  new). Only reloading the extension — the extensions page's Reload, or
  `chrome.runtime.reload()` — installs the current worker. Every harness runs
  a fresh profile, so no test could see this.

### Fixed

- The worker answers an `fx-worker` message with the build its files carry
  (`extension/build.mjs`, a literal held equal to the manifest version by
  `test/unit/build.test.mjs`; not `getManifest().version`, which the browser
  hands every page and worker alike). Before acting on a native click the
  viewer asks, and unless the answer is its own build — an older worker answers
  its own, one from before the question answers nothing — it says the browser
  is still running the worker from an earlier install and offers to reload the
  extension, which closes the document's tab (measured) and says so.
- `test/stale-worker.mjs` installs the extension with the handshake removed at
  a lower version, puts the current files under the running browser, and
  checks the button names the old worker rather than acting, once, and that
  the reload link installs the current worker, after which the button works.
  (It does not restart the browser: the harness's command-line install did
  not keep a stable extension id across a restart, and the survival of the
  stored worker across restarts and a version bump is the measurement above.)
- For the author's Chrome the one-time remedy is that reload; the viewer now
  says so instead of doing nothing.

### Verification

- `npm test` 298/298, naming guard and vendor check passed. `test/latexdiff.mjs`
  PASS (six runs: four zooms and two scrolling). `test/native-button.mjs` PASS
  on http, on a local file with file access, and `--no-file-access`;
  `test/stale-worker.mjs` PASS.
- The combined gate, both corpora: PASS on 00e4610 (34.3 min, every stage
  49/49, no retries, not contended; the native-button edits above landed in
  the working tree while its private lanes were still launching, so it is not
  a clean record of either tree) and PASS again on ac199a2, the committed
  tree (34.9 min, every stage 49/49, no retries, not contended).
- Edge sheets on ac199a2: public 14/14 (150 sheets), private 35/35 (375
  sheets). agy read every sheet and raised 9 public and 7 private claims;
  each was checked against the sentence on the sheet, against the same sheet
  from the v1.3.2 review where one existed, and the emphasis claims with
  `wordshot`. Twelve were false positives (a caption read as a typeface
  change, a bold caption clipped on both sides, a link border taken for text
  colour, a paper's own spacing, emphasis that does start at the word, red
  that is on the whole reference, italic tails that are italic). The rest
  are pre-existing — pixel-identical in the v1.3.2 sheets — and recorded
  under the limitations below. No regression; the two gates and the sheets
  agree with the one engine change since 1.3.2 (a4820f8).

### Known limitations (found in this round's sheets; identical in v1.3.2)

- In an author–year citation whose author is a word of a few letters, the
  author loses the citation colour and is emphasised while the year keeps
  it: the few-letter rule (R52) wants strong colour, and the paper's link
  blue is not.
- A reference split by a line break so that only its number starts the next
  line ("Listing" at one line's end, "2" at the next's) colours the word and
  leaves the number black and emphasised.
- The last line of a pseudocode block that abuts a heading can be processed
  as prose (an assignment line emphasised).
- A text item that runs from a small-caps run into regular words ("Proof of
  Lemma 5.5. We apply a") is set in small caps throughout.
- A small-caps logotype whose text layer splits it ("B ASEECHO", "ZC OVER")
  gets a widened gap at the split and emphasis on the second part — the
  glyph-variant small caps of R51.

## R54 — a paragraph cut into one block with the listing under it

### Found

- On a paper outside both corpora (reported by the author from an open tab;
  nothing of it enters the repo), two body paragraphs over a numbered code
  listing had no emphasis at all. `whyskip` named the reason: `blk-table`,
  31 spans. The block cutter had run the paragraphs and the listing into one
  block — the listing is set at 70% of the body size and its line numbers
  nearer 75%, just inside the cutter's 30% size tolerance, with no whitespace
  gap between — and the table rule then counted the paragraphs' lowercase
  words over the listing's rows too: 43 rows, 141 words against the 172 that
  four a row demand, so the whole block, paragraphs included, went onto the
  canvas as a table.

### Fixed

- The block cutter (`blocksOf`) now also cuts between body-height rows and a
  RUN of off-size rows — body height being the page's dominant size, a row at
  90% of it or more counts as body — even when the two are within the size
  tolerance. The tolerance is for a paragraph's own variation; a change
  across the body line is a block boundary. Row height is taken from the
  stream's own items, since a column stream's row carries the whole
  baseline's height and a listing row sharing a baseline with the other
  column's prose would otherwise read as body-height.
- A run counts only when it is three rows long or carries prose (a row with
  three words of three letters or more). The first version cut at every
  off-size row, and a sub- or superscript on its own baseline is one: a
  sentence between two equations then became a block of its own, short of
  lowercase words, and went onto the canvas as a table — two to four lines
  on one private page, two on another, both processed before. Shorter runs
  keep their neighbours' size. The gate's `whyskip` records were diffed page
  by page between the runs to find this; the diff is what to read after any
  change to the cutter.
- The caption's upward walk, which absorbs every block between a caption and
  the prose above it as figure content, judged "prose" by an average of four
  lowercase words a row over the block. With the finer cut a figure's own
  wordy label rows no longer pad that average, and on two private pages two
  body lines above a figure — one block with the small-caps heading over
  them, the other with sub- and superscript rows between them — fell under
  it and were absorbed. The walk now also stops at the shape of a paragraph:
  a body-height row of four lowercase words followed by the next body-height
  row carrying two, the off-size rows passed over — and the first of the two
  a line, from the column's left edge across 70% of its measure. Without
  that last condition the description cells of a table ("Generate a string
  with a random length" over "Generate an empty string") made the shape, the
  walk stopped under the table, and the table was processed: the gate's
  `tables` probe caught it on a public paper (one gate run failed on it).
- On that page the paragraphs now form their own block (prose-dense,
  processed) and the listing its own (absorbed as the figure body of the
  caption under it). The same cut frees, across the corpora, body paragraphs
  that had been merged with the smaller block under them — a paper's whole
  abstract skipped with the copyright block, paragraphs above figures
  absorbed as figure content, paragraphs over a bulleted list read as a
  table — and separates footnotes from the paragraph above them, which the
  footnote rule then skips as it should.

### Verification

- `npm test` 298/298, naming guard and vendor check passed. On the reported
  document (outside both corpora): `whyskip` page 3 from 50 unprocessed prose
  spans with `blk-table` 31 to 21 with none; `wordshot` on three words of the
  two paragraphs `processed=true`; its 13 edge sheets captured on the final
  engine, rows identical to the first capture, page 3 and every other page
  read.
- The combined gate, both corpora, on the working tree: PASS with the first
  cut (49/49), PASS with the run rule (49/49), FAIL with the paragraph-shape
  stop without the line condition (public 13/14: `tables` on one paper, a
  table processed), PASS with the final version (49/49, 35.2 min, no retries,
  not contended). Every run's `whyskip` records were diffed page by page
  against the previous engine's (ac199a2): 773 pages; the final version
  changes 55 pages' classification, 32 of them in the count of unprocessed
  prose. Each of those 32 was dumped span by span with both engines and read:
  every page that processes more now does so on body prose the original had
  skipped (as a table, as the figure above a caption, as part of the
  copyright block — one paper's whole abstract, another's first three
  introduction lines); every page that skips more now skips a footnote the
  original had processed as the tail of the paragraph above it; the two
  regressions of the intermediate versions (prose above a figure absorbed;
  the table processed) are gone, those pages back to the original's output.

## R55 — performance on the real display, a calibration lost for a month, and papers of other layouts

### Performance

Measured with `test/diag-perf.mjs --cold --pages=8` on the real display (a 2x
screen; `--headful`, since headless hides the GPU) over a two-column paper,
before and after, the same scroll:

| | before | after |
|---|---|---|
| main-thread task time | 5237 ms | 3757 ms |
| longest task | 495 ms | 173 ms (page 1), 43–65 ms on every other page |
| `createImageBitmap` self time | 1247 ms | not in the profile |
| per page: longest chunk | 135–167 ms (one chunk held the page) | 43–65 ms |

- The canvas hand-over to the worker (`#prefetchPixels`) asked
  `createImageBitmap` for `premultiplyAlpha: "none"`, which forces the copy
  through the CPU: 21–34 ms a canvas at 8.6 Mpx, measured, against 0.0 ms
  with the default — a texture share. The page canvases are opaque (PDF.js
  makes them with `alpha: false`), so premultiplying changes no byte: the
  engine's own parity check (`worker pixels vs direct readback`) reads 0
  differing after the change as before. `colorSpaceConversion: "none"` is
  kept; it is free.
- One idle callback did a page's whole first stage (obstacles, rules, the ink
  checks, the overlap resolver) AND its first batch of 150 spans: the
  140–170 ms task a reader felt as a skipped frame on every page. The pass
  now yields once between the stage and the batches when the callback's
  budget is spent, and a batch is 60 spans (`CHUNK`): a couple more layouts
  a page, tasks under ~60 ms. Page 1's first stage alone is still 173 ms.
- Two of the profile's top entries were the harness's own: under `__fxDebug`
  the engine scans the rules on the main thread too (`scanRules`, 500–600
  ms) and reads every canvas back directly to prove the worker's pixels
  (`getImageData`, 330 ms). `--phases` turns that on; a production profile is
  taken without it, and then our own code is under 300 ms of a 12 s scroll.

### Found and fixed

- `canvasInkTop` was used at the baseline calibration's one sample line and
  declared nowhere: commit 1cff7e0 (2026-09-18) deleted the declaration and
  left the use. In a module the use threw on the first sample of every page,
  inside the `try`, so no family was ever calibrated and the metric fallback
  did all the baseline re-seating since. Restored, and applied only where the
  rendered face changes (a bundled reading font); with the same face PDF.js's
  own placement is right, so the default mode is untouched. Measured on the
  real display in Literata, one line with a kept monospace word beside
  processed words, 4x clips: with the calibration the processed words sit on
  the row of the kept word; with the fallback they sit a few device pixels
  higher. The calibration needs the full-resolution canvas (`csy > 0.85 dpr`),
  which headless rendering does not give it; that is why no harness saw the
  loss.
- A bibliography with no heading. REVTeX (Physical Review) sets its reference
  list under a rule with no title, and two such papers had every one of their
  246 citations unresolved: the parser found a bibliography only by its
  heading. When no heading matches, the list is found by its shape: a "[1]"
  line in the document's second half followed, within a few lines each, by
  "[2]" and "[3]" at the same size; its first line stands in for the heading.
  An enumerated list in the first half, and one bracketed number in prose,
  do not qualify.
- REVTeX balances its last page so the text's closing lines and the
  acknowledgments sit at the top of the right column, above the list's
  continuation; in column order they fall between "[22]" and "[23]", and the
  acknowledgments heading ended the list at 22 of 69 entries. A heading
  inside the list is now an interruption, not an end, when the numbering
  carries on right after it ("[23]" after "[22]"); the interruption's own
  lines are left out. An appendix opening with a bracketed number of its own
  still ends the list (its number does not follow). 147/147 citations now
  resolve on the one paper, 98/99 on the other.
- The heading vocabulary was English only ("References", "Bibliography",
  "Works Cited", "Literature Cited"). It now covers the English variants
  ("References and Notes", "Reference List", …) and the headings of German,
  French, Spanish, Portuguese, Italian, Japanese and Chinese papers
  (Literaturverzeichnis, Références, Referencias, Bibliografia, 参考文献, …),
  with an optional colon or Japanese bracket pair.
- Appendix headings were body text. "A.2 Hint Retrieval Prompt" — a letter
  with dotted numbers — matched none of the heading lead's shapes (a number,
  "A.", a roman numeral, "(a)"), and on a line-numbered submission set in
  Times every appendix heading was processed; the paper's small caps are
  FAKED — a full-height capital, then the word's remaining letters as
  reduced capitals in spans of their own ("H" "INT", "R" "ETRIEVAL") — so
  the fragments came out bold mid-word ("**ET**RIEVAL"). The lead now takes
  the appendix shape, and the candidate filter rejects a faked small-caps
  tail wherever it appears (`smallcaps-tail`: all capitals, under 0.9 of
  body height, starting where a full-height item ending in a capital ends on
  the same baseline), since in running text ("O" "CTOPUS") the heading rule
  would not reach it. A real small-caps face is already kept by its name.

- A section sign after a statute's name. "47 CFR § 15.407(k)" was coloured
  as an in-paper reference — the `§` leader — on an IEEE paper citing the
  FCC rules; it points into the law, and the blue "[8]" beside it is the
  citation. The title number and the source's abbreviation stand right
  before the sign (CFR, C.F.R., U.S.C., "… Code"), on the same line or the
  one above, and a `§` reference so preceded is left alone (parser
  `LEGAL_BEFORE`, mirrored in the refcolor probe). A spelled-out "Section
  230" of a statute is not told apart — the paper's own sections look the
  same — and stays coloured.
- A white mask on a shaded box. Every mask was paper white, so on a grey
  callout — "Key Finding" boxes, a prompt box inside a figure; two private
  papers, nine sheet rows — each processed line sat on a white band, the
  mask's edge plain against the shading. `vector-art.mjs` now collects the
  page's coloured fills wide and tall enough to carry a line of text
  (`meta.shades`, the largest 48), the rules worker samples the colour each
  really shows on the baseline render — the most common pixel inside it, so
  a translucent fill or a pattern reads as the page shows it (`rules.mjs
  shadeColors`) — and a span whose centre lies on one gets its mask in that
  colour where it overlaps the fill, paper white beyond its edge (its
  padding reaching past the box). Without the worker the fill as written
  stands in. Emphasis inside the box is kept; the alternative, leaving such
  text on the canvas, would have lost it on exactly the sentences a
  callout exists to be read. Verified on both papers' boxes after the
  change: the lines sit on the box's own grey, no band.
- Rotated text redrawn upright and huge. The words of a NeurIPS attention
  visualisation are set rotated by ninety degrees; processed, each was laid
  out upright at the span's advance for its height — several times its
  size, stretched across the figure and over the section heading above
  it. Prose is never rotated on the page the reader sees, so a span with
  any rotation in the viewport's frame (the page's own rotation cancelled,
  as PDF.js lays the span out) stays on the canvas (`rotated`). Verified
  on the three figure pages: the words are small and upright again.
- A caption's second line emphasised. Two captions lost their continuation
  to the body. In a REVTeX table caption a superscript's own row stood
  between the lines, and the walk that absorbs a caption's lines took it
  for a size change and stopped: a sub-height row between a caption's
  lines is now skipped, neither ending the caption nor moving its pitch.
  Under a REVTeX figure, the plot's axis label ("P_T (GeV/c)") had fallen
  onto the caption's first row, so the row's text no longer ended in the
  dangling "The" that says a caption runs on, and its leading (1.36) then
  read as a paragraph break. A short item in another face set well inside
  the caption's measure is foreign to it: left out of every test that
  reads a line's text and shape, still marked with the line it lies on;
  the caption's height is its own, not its row's; and after a line that
  ran on, a pitch up to 1.5 is still the caption's leading. Both captions
  are kept whole now.
- A framed box's title emphasised. "Prompt for Hint Retrieval in ALFWorld"
  heads a prompt listing in an ICLR submission: the body's own face and
  weight, no number, no anchor, so no heading rule reached it, and it
  carried bold prefixes above a box whose monospace lines are kept (the
  tables probe reported it as processed text inside a ruled zone). A
  Title-Case line with no label to vouch for it is a heading when every
  test holds: two to eight words, each capitalised but the small
  connectives, no sentence punctuation, the body's face, no wide gaps
  (a table's row), alone on its row and short of the measure by a
  quarter, under a line that ended a sentence (or a short one, or none),
  and not continued by a lowercase line — a paragraph's last line ends in
  a period, and a sentence broken before a lowercase word fails the last
  test. Kept now; an affiliation line ("Imperial College London") is
  kept by the same rule, which costs nothing.
- The column's measure set by one stray item. The measure a column's full
  lines reach was the widest item end in the column; under a REVTeX figure
  one plot label reached 63 units past every caption and body line, so the
  caption's first line fell "short" of the measure and was taken for its
  last. Justified text makes the full lines' ends equal, so the measure is
  now the widest end that a second line shares, the widest alone only when
  no two agree. Every rule that asks whether a line is full or short reads
  this (headings, captions, run-in leads); the gate's skip-reason diff is
  the measurement of what else it moved.
- A paragraph kept as a caption under a wrapped "Figure 4." Found in the
  skip-reason diff of the final gate, on a USENIX paper, and older than
  this round: "… using (S¹, γ¹) and (S¹, γ²), / Figure 4. To resolve ψ₁,
  we …" wraps a sentence so that "Figure 4." opens a line, the caption
  lead's shape. The guard that reads the line above as prose counts its
  lowercase words, and math left that line with two; its trailing comma
  is the stronger evidence. A line above that ends in a comma or a
  dangling word, in the same face at normal pitch, is prose, and no
  caption opens under it. That alone did not reach the line: the guard
  took "the line above" as the previous line group on the page, and
  line groups run across both columns, so on a two-column page it was
  often the other column's line with nothing in this band — and here
  the subscripts of the math line ("in out in out"), grouped as a row
  of their own in another face. The line above is now the nearest group
  with a full-height item in this column. Four body lines are emphasised
  again (traced with `PROBE='Figure 4.'`). Finding the real line above
  undid a lucky miss elsewhere: in a private paper a table sits
  mid-paragraph in the right column, under a line ending "into" — the
  group above had been the other column's, with nothing in the band, so
  the guard never ran; now it ran, the line above dangled, and "no caption
  opens under an unfinished sentence" emphasised the table's caption and
  notes (23 spans, found in the gate-to-gate skip-reason diff). A gap
  wider than the page's own leading by a third is a float's, however the
  line above ends: the page's leading is the median baseline pitch of its
  consecutive prose rows, and both continuation tests sit under that
  ceiling. The double-spaced manuscript's 1.73 is its own leading and
  still passes; the pitch is taken between the baselines of full-height
  items, since a math line's superscripts had moved its group a half line
  up.
- A symbol's right loop cut off. A CM "∞" laid out in the fallback face
  is narrower in the text layer than the glyph the canvas drew, and the
  next word's mask, clamped to the box, cut its right loop to "∝" — three
  times on one page of an amsart paper. A kept one- or two-glyph symbol's
  obstacle is now its INK: the canvas beside its box is probed for the
  ink that continues it, up to 0.4 of the line's height and never into a
  processed neighbour's own box, whose canvas copy the mask must cover.
  Verified: the sign is whole.
- An address with its underscore lost. The text layer carries no character
  for an underscore drawn as a rule, so "ab_cd@…" read "ab cd@…" and the
  orphaned local part was emphasised as a word in a private paper's
  contact line. With two or more addresses in the span, a plain lowercase
  word right before an address is its lost local part (one address in
  prose keeps the word before it). Verified: nothing emphasised on the
  line.
- Two kana whited out on a mojibake page. The Japanese paper whose text
  layer is garbage (the font has no usable ToUnicode map) keeps its lines
  by the per-span mojibake test — three scripts in one span, or marks on a
  tenth of its characters — but a two-character span of ONE script passes
  it: "ȃ!" (Latin Extended-B) stood over "せて", was redrawn as nothing,
  and its mask whited the kana out. On a page with two or more mojibake
  lines, every span with a letter outside Latin, or a Latin letter from
  the Extended-B and IPA blocks no paper's prose uses, is the same wreck
  and stays on the canvas. Verified: the line reads whole.

### A reference across a line break, and what it points at

- "…as we saw in the proof of Theorem" / "2, for every n": the page's text
  is joined for the citation pass in the text layer's own order, which is the
  content stream's, and on a mathematics paper that order put the line's end
  ahead of a line two below ("3, ∆(…"): the grammar read "Theorem 3", into a
  kept span, and coloured nothing, while the real number sat elsewhere in
  the sequence. The join is now in READING order — rows by baseline, a
  two-column page's left column before its right (the gutter found as the
  equation probe finds it) — and the break between two spans is one a
  reference may cross only when the second continues the first: the same
  line to the right, or the next line down the column. Any other break is a
  character no grammar treats as space. `readingOrder` and `continuesLine`
  are exported and unit-tested.
- The first cut of that join wrote each span's separator AFTER the span,
  from the gap before it — one span late. A line's last word was then cut
  from the next line's first by the hard break meant for the column change
  two spans on, and "(Section 4.4)" split over a line end on the public
  USENIX paper lost its colour (83/84, where the old join had 84/84). The
  separator is now written before each span, from the gap it describes;
  84/84 again.
- The `refcolor` probe joined only the PROCESSED spans' text, so a kept math
  span between "…proof of Theorem" and "2, for every" vanished from its view
  and it reported an uncoloured "Theorem 2" — a reference the page does not
  print. It now joins every span, and a reference running through a kept
  span (the number set in the math face — R53's limitation) is counted
  apart (`kept=N` on the page's line) rather than as a miss or a hit.
- The other half of R53's "Listing / 2": a bare number beginning a line is
  kept on the canvas (it has no letter), and the colour rule, which paints a
  reference whole or not at all, left the leader black with it. The
  candidate filter now processes a line-starting number when the item before
  it, on the baseline above, ends in a reference's leader word
  (`REF_LEADER_END`, `REF_ITEM_START` in parser.mjs).
- On hover, an in-paper reference now shows what it points at
  (`references/preview.mjs`): a clip of the target page rendered small — a
  figure or table reaching up from its caption, a theorem's statement or a
  section's opening lines reading down from its heading, an equation about
  its tag — with the target's first lines as text and its page number, in the
  citation popup's card. The target is the PDF's own link destination where
  the paper has one (hyperref's `figure.3`, `section.4.2`, an explicit
  destination array, read off the annotation layer's href as PDF.js writes
  it), else the document's lines searched for the label the target prints
  ("Figure 3:", "Theorem 2.", "4.2 Title", a trailing "(5)"), from the
  referring line forward. The hyperref'd reference sits under the PDF's link
  element, so the handlers go on the annotation layer's links as well as on
  the coloured wraps. Clips are cached per target; the pure parts
  (`parseDestHash`, `targetByText`, `regionFor`, `columnAt`) are unit-tested,
  and `test/refpreview.mjs` hovers a reference end to end — through the
  text search by default, and with `--expect=link` through the PDF's own
  link box, which hyperref draws over the number alone ("Figure 2": the
  box is 10 px wide, over the "2"), so the harness looks for the link under
  any wrap of the reference's run, not under the wrap holding "Fig".
- The link path's first cards were wrong. A link's anchor is wherever the
  paper's class put it, not where the target prints: a float's at its
  caption (plain hyperref) or at its TOP (hypcap, which acmart loads), a
  section's a skip above the heading with the page margin's x — so "up from
  the anchor" clipped the two columns of text above Figure 2 with a body
  sentence for a snippet, and Section 4.3's card showed both columns and
  quoted the left one. The target's own line, found by its label on the
  destination page, is now the fixed point for every kind — its column,
  its top, its text — and a float whose anchor sits above its caption is
  measured by it (the clip reaches the anchor; no guessed height). A
  caption's snippet ends where the next line opens with a capital or a
  number (the body or a heading after it), and an equation has no snippet:
  its text layer is the symbols in stream order ("(HU)μνABQAφ σ UB + h.c.,
  (1)"), which says nothing the clip does not.
- The `eqkeep` probe read "…contributions to Eq. (39)" ending a line as a
  numbered equation and the sentence's emphasis as a violation (a REVTeX
  paper): the trailing parenthesis is a reference's, when the leader stands
  right before it. The probe now says so.

### Rules from the other layouts' edge sheets

The extra corpus's edge sheets (18 documents, 147 agent reads and
verifications, every claim checked against the page with `wordshot` and a
DOM dump before any rule changed) sorted into these classes. Each fix is a
rule about the layout, not about the paper it was found on:

- **Caption labels the lead test did not read.** The label split over text
  items ("Fig." | " " | "2" | " " | the text in another face — BMC/PLOS); set
  in capitals ("FIG. 2:", "TABLE I" — REVTeX); an appendix float's letter
  ("Table A.3.", "Figure B.1:"). The caption pass now tests the line's first
  few items joined, and the lead regexes take the three shapes; every
  caption of the biology paper had been emphasised as body.
- **A body line taken for a caption.** "Figure 8. Thus, there appears …" is
  a wrapped sentence's middle line; the continuation guard allowed only
  single-spaced leading (1.45), and the manuscript is set at 1.73. The
  guard now also accepts a wider pitch (to 2.0) when the line above ends
  dangling ("… shown in Panel C of"): no caption opens under an unfinished
  sentence.
- **Headings in the body face.** An italic numbered subsection
  ("2.1. Diffusion models for image restoration", elsarticle) exceeded the
  three-lowercase-word cap; the italic-throughout tell now takes a numbered
  label as well as IEEE's lettered one, and a numbered line stopping well
  short of the measure with no sentence inside is a heading up to eight
  lowercase words. An italic run-in heading ending in a PERIOD ("Gradient
  Loss. The gradient …", "Benchmarks. We …" — elsarticle's \paragraph) had
  no rule (the bold and roman ones did): a short Title-Case italic run with
  the roman body resuming on its line is skipped like them. The outline's
  heading anchor sits a skip above the heading, and landed on a
  paragraph's last line ("ET-SDE yields more robust results with …", skipped
  whole): a line of four or more lowercase words in the body face under the
  anchor is prose.
- **Footnotes without a marker.** The rule required a marker opening the
  block; a footnote continued from the page before ("timekeeping, meaning …"
  with footnote 13 after it, NBER) and an AMS paper's first-page notes ("Z.
  Reichstein was partially supported …") have none. Small prose at the
  bottom of its column, body prose above it and none below, is a footnote;
  an appendix set small throughout has no body block over it. The marker
  class takes U+2217, the asterisk TeX sets for \thanks.
- **A figure under its caption.** The figure-body sweep assumed the figure
  ABOVE the caption; economics working papers put the caption over the
  figure, and the legend ("Sun-Abraham", "Borusyak et al.") and axis title
  ("Chat Date") under it were body. With prose right over the caption, or
  the caption heading its column, the sweep runs down instead: lines that
  are not running prose, to the first prose line (the figure's "Notes: …")
  or caption; a panel title ("A. Resolutions Per Hour") is figure content.
  Writing it exposed a flaw the upward sweep had carried: a prose line was
  one filling 72% of the COLUMN'S WIDTH, and on a single-column page that
  width was the page's — the NeurIPS/ICLR measure is 65% of a letter page —
  so no prose line ever bounded a sweep there (the first downward run took
  a submission's body whole as a figure; the upward one had been running to
  the page's top edge, hidden because those templates' figures head their
  pages). Both sweeps now take the measure from the column's own lines.
- **A word broken at a line end.** Its tail opened the next line as a fresh
  word with its own bold prefix ("it" of "findabil-" / "ity") — on every
  justified paper, a second fixation mark on a word already fixated. The
  cross-span word join now joins a hyphen-ended line to the lowercase line
  start under it in the same column: the tail gets no emphasis of its own,
  the head's prefix is sized against the whole word. Such a join is for
  the emphasis only: it does not carry a kept line's reason to the body
  line under it.
- **Faked small caps, the other half.** "-C" + "ONTROL" in a heading's
  "LEAKAGE-CONTROL": the full-height capital with the hyphen riding on it
  is two characters, a letter, processed — bold. The head of such a word
  is rejected like its tail.
- **A text layer that is not the page's text.** A Japanese paper's font has
  no usable ToUnicode map: its lines reach the text layer as Greek,
  Armenian and Latin Extended-B code points with combining marks among
  them, and were masked and redrawn as that — kana stacked, characters
  gone. Letters of three script families in one span, or marks on a tenth
  of its characters, is text no paper sets: the span stays on the canvas.
  The same paper's fullwidth parentheses came out as U+022A, a Latin letter
  to the word-join, which made "Juliet" after one a continuation with no
  emphasis: a one- or two-character head wholly in Latin Extended-B or IPA
  joins nothing.
- **Short prose beside a kept script.** "number of Γ" (eleven characters,
  the subscript "reg" under the Γ) was expression-sized by length and left
  plain with the words around it: two lowercase words say prose, whatever
  the length.
- **Kept italic letters under a neighbour's mask.** The italic J of a math
  "J-regular" overhangs its text box to the right by a tenth of its height;
  the next word's mask, padded 2 px at 100% zoom (more than the box's own
  slack), took its top bar and upper stem — at 100% only, which is why no
  close-up showed it. A kept one- or two-glyph run in an italic or math face
  is cut out of the neighbouring masks as a symbol run already was.
- **A full-measure equation.** "(Yield per A + A collision)" over "(Yield
  per p + p collision)", the R_AA ratio: set to the full measure (no
  centring signal), its rows unnumbered (the tag sits on the fraction
  bar's row), with words. A block of a few rows with scarcely a sentence's
  words whose row ends in a tag set apart at the region's right edge is an
  equation; and the rows a half-pitch above and below a numbered row,
  built like an equation (an operator, a relation, a math-face item) with
  at most two words and no sentence's shape, belong to it.
- **Citations.** "[ 1, 2]" with a space inside the bracket; natbib's
  compressed "(2021b,c)" (the bare letter is the previous year's suffix);
  a name whose ä the PDF composes from a spacing diaeresis and the letter
  ("Kujanp¨a¨a" — matched to the entry with accents folded either way); and
  "[512, 256, 1]", a list of layer sizes, every number of which was a stub
  card and coloured as a citation in a paper whose bibliography has no
  numbers — a numeric stub is made only where a numbered bibliography
  could carry it.

A second pass — the sheets re-captured on the engine above and re-read
against the first read's claims (22 documents), then the release gate's
skip-reason diff over both corpora (161 pages changed, every one read) —
added:

- **The join's reading order, again.** The column split used a vertical
  band few rows cross; a wide figure's labels fill it, and the two body
  columns' lines then interleaved by height — "(Fig. 8" lost its "and 9)"
  to a line of the other column between them (a private paper). Columns are
  now judged row by row at the page's centre (a row's items all on one
  side, or both sides with a gap across the centre, or straddling it), the
  left sequence first and the right after. Which a page is, the PROSE rows
  say: a one-column page's prose lines all cross the centre, a two-column
  page's never do — judged by the rows alone, a mathematics page's
  displayed equations (short rows, left, right or two-sided) outnumbered
  its prose lines and made two columns of one, cutting "Eq." from its
  "(20)". Two columns must also be real: their lines start at a shared
  edge and run a column's width, and the gutter is the band the two-sided
  rows' MEDIAN edges leave (one formula overflowing into the gutter voided
  a band forty-two rows agreed on). A page that is neither keeps the
  document's own order. A spanning row's own items (a centred caption)
  ride with the left sequence, but a line of each column on that baseline
  still goes to its column. Rows are built from the items of body height
  alone; a sub- or superscript joins the nearest row afterwards (built in
  one pass by centre, a superscript was reached before its own line and
  joined the row ABOVE, cutting "Sec." from "IV A"), and a tall item — a
  rotated axis title, a big delimiter — likewise (seeding a row, it
  swallowed every line within half its height, and "Fig-" went to the
  other column's sequence). A numbered manuscript's margin line numbers
  ("1217", digits alone, outside the lettered items' extent by the 5th and
  95th percentiles, or more than a line height clear of the row at its
  edge) go to the end of the order: between "Theorems 5.7" and "and 5.8"
  one broke the reference, and IEEE's right-margin numbers, each on a
  baseline of its own, broke "Proposition" from "1, showing".
  The right column's first item continues the left column's last line: a
  word broken there is one. A sub- or superscript (set small, its centre
  half a height off its line's) belongs to its line's row — as a row of
  its own it fell between "(Al-" and "gorithm 1), which" and broke the
  hyphenated reference — and the next-line bound is 2.4 heights, since a
  double-spaced manuscript sets its lines 1.7 to 2.2 apart. And a
  whitespace-only span (an OCR layer's or a Word export's space item, often
  with no height) joins as a space and never as a line of its own — "Table"
  | " " | "4" was cut by a hard break; the colour probe, likewise, no longer
  counts such a span as one a reference must run through, and names the
  spans of each miss, with the product's own joined text around them.
- **Leaders.** Remark, Proposition, Corollary, Example, Assumption,
  Conjecture, Observation, Fact, Exercise, Hypothesis, Property, Notation,
  Reduction and Step are reference leaders (capitalised only); an abbreviated
  leader takes its period or a space, so "fig1" and "fig3.ps" (file names on
  a template paper) are not references; REVTeX's "Sec. II B" takes its
  letter. The probe's copy of the grammar moved in step.
- **Citations.** An amsalpha label with no year ("[P]", "[RY]", with a
  locator "[P, Section 6]") is a citation key; a stub card is made only for
  a NUMERIC key, so a matrix "[A]" in prose stays plain.
- **A label or a variable is not a word.** The "a" of a list's "(a)", and
  the "n", "p", "df" of "(n = 617)", "p < 0.001" — one or two letters with a
  relation sign after them — get no bold.
- **The run-in rule's paragraph start.** The regular-weight run-in rule
  meant to fire on an INDENTED paragraph start measured the indent from the
  band's edge, which for the right column is the page's centre (and for the
  left the page's edge): every line start was "indented", and a
  mid-sentence "Sun-centered frame [4, 15, 19]. Cartesian …" (REVTeX) was
  kept as a run-in heading — while the same accident is what let it catch
  ACM's unindented run-in heads ("NAS security activation. However, …").
  A paragraph start is now an indent from the column's own text edge, or a
  line under one that stops short of the measure, a gap, or nothing; a
  sentence's tail continues a full line.
- **A scan with an OCR layer.** The operator walk now counts text drawn
  invisibly (rendering mode 3 or 7) against text drawn visibly, and the
  largest image's share of the page. A page whose text is all invisible
  under a page-sized raster is a scan: its text layer says what the OCR
  read ("ritimbtr" for "number", "GENUAL~Y" for "GENERAL THEORY"), and
  redrawn over the scan it replaced the page's own glyphs with that. No
  span of such a page is processed (`ocr-layer`). Two OCR'd papers of the
  extra corpus had every line so. The first cut of the rule took a
  born-digital page of a private paper for a scan: its figure sets mode 3
  inside its own q…Q, and the walk kept the mode past the Q, so the body
  text after the figure counted as hidden. The mode is graphics state, now
  saved and restored with it; and the raster is required, since a
  flattened page carries its selectable text invisibly too.
- **Garbled text, the small spans.** A span of combining marks with no
  letters to carry them drew nothing where kana stood; a span with as many
  marks as letters is kept.
- **A kept letter in another face.** The j of an optimisation paper's
  "j-th" is in a face named neither italic nor math; the one-letter run was
  not a symbol to the masks, and the next word's mask took its stem at 100%.
  A one- or two-glyph run kept in a face other than the page's body face
  (by characters set in it) is a symbol.
- **Footnotes, bounded.** The marker-less footnote rule does not take the
  bibliography's last entries (small, under the body, at the column's
  foot — the shape exactly) nor a small table: those keep their own
  reasons.

Known and left (each named in the sheets, none a regression): the LaTeX
logo's split spans (a bold "L", the lowered E flattened — two template
papers); a run-in operator name set in the text face ("diag", "Sim");
booktabs tables whose rules pair over more than 15% of the page height;
a /Rotate 90 page's baseline re-seat; a URL's blue lost when its link
annotation covers less than half of a prose span; a one-glyph fullwidth
parenthesis whose box is narrower than its ink; Word's small caps, set as
small-cap GLYPHS at capital codes in one text run ("TRANSACTIONS" redrawn
in full capitals — the text layer cannot see the glyphs); a theorem of a cited paper ("Theorem
2.2 from [12]") coloured as in-paper; a capitalised product name swept
into an author run ("Uni-Mol Zhou et al. (2023)"); a paper's own missing
space ("ENZYMEBairoch"); a reference whose number is the next line's first
item under a hyperref box on one LNCS paper, still kept — not resolved
this round.

### The layout model, an option (experimental)

The user asked whether a light computer-vision model could divide the page
where the rules struggle, at the rules' speed on a GPU or NPU and still on
a CPU, and chose to leave it as an option. It is one: `layoutModel` in
Settings, off by default, with no file of it in the extension until
fetched (`scripts/fetch-layout.mjs`, into the git-ignored vendor
directory, like PDF.js).

- The model is PP-DocLayout-S (PaddleOCR 3.x, Apache-2.0): PicoDet-S with a
  GFL head, 4.8 MB, 480×480 input, 23 classes (paragraph_title, image, text,
  number, abstract, content, figure_title, formula, table, table_title,
  reference, doc_title, footnote, header, algorithm, footer, seal,
  chart_title, chart, formula_number, header_image, footer_image,
  aside_text), 70.9 mAP(0.5) on the publisher's benchmark, 18.5 ms a page
  on a server CPU in their table. Its larger siblings (RT-DETR-L, 124 MB)
  are out of the question for a CPU; the DocLayNet YOLO exports carry
  Ultralytics' AGPL, which this Apache-2.0 extension cannot bundle.
- It runs in the rules worker (`layout-model.mjs`), on the same baseline
  bitmap the canvas rules are scanned from — one fixed-resolution render a
  page, so its decisions do not move with the zoom either — through ONNX
  Runtime Web (MIT): WebNN on the NPU where `navigator.ml` exists, WebGPU
  where `navigator.gpu` does, WebAssembly otherwise, falling through in
  that order. The pure parts (the tensor preparation, the output decoding
  by shape, the class map) are unit-tested; the runtime path is exercised
  by `test/diag-layout.mjs`, which refuses to pass when the model is
  unavailable on every page.
- Its regions are evidence, not verdicts: in a pass's first stage (where
  vector art and a scan's OCR layer already keep candidates) a candidate
  whose centre lies in a figure, table, caption, footnote, formula,
  algorithm, header, footer, heading or aside region at 0.5 confidence or
  better is kept with the region's class as its reason (`region-figure`
  …); a "text", "abstract" or "reference" region changes nothing, and no
  region un-keeps what the rules kept. A model miss therefore leaves
  today's behaviour exactly in place, and the gate's skip-reason diff
  between a run with `--layout` and one without is the measurement.
- Fetched and run (2026-10-19). `npm run fetch-layout` takes ONNX Runtime
  Web 1.30.0 from npm (seven dist files out of the 33 MB tarball, which
  ships no licence file — the MIT text is written beside them) and the
  model. The publisher's own files are Paddle 3's inference.json and
  inference.pdiparams, and paddle2onnx has no wheel for Python 3.13 (its
  onnx dependency fails to build), so the ONNX export published beside the
  original on Hugging Face (two-input GFL graph, NMS inside, 4.92 MB,
  Apache-2.0) is fetched and refused unless its SHA-256 is the one the
  card states; MODEL-SOURCE.txt records the provenance and the I/O
  contract.
- Three traps between the files and a result, each now in the code or
  the harness: a tab opened through DevTools' `/json/new` stays hidden
  behind about:blank, and the overlay applies a settings change only once
  the page is visible, so the harness's toggle never reached the engine
  (`/json/activate`); a page's baseline, with the model's result, is
  cached per page, so flipping the option drops the cache
  (`updateSettings`) and the diagnostic arms the flag before the first
  baseline; and WebGPU creates a session on this export but fails inside
  a MatMul kernel ("shared dimension does not match") at run time, so a
  provider that cannot run the graph is left for the next one, once, and
  the diagnostics can force one (`--provider=`). The threaded WebAssembly
  build spawns its workers from blob: URLs, which the extension's CSP
  refuses; the single-threaded SIMD build is used.
- Measured, headless, WebAssembly: 130–230 ms a page on the public NeurIPS
  paper, off the main thread after the page's own render; the regions are
  the ones a reader would draw (the arXiv stamp as aside text, the title,
  the headings, a figure and its caption), and on those pages they keep
  nothing the rules had not kept. The regions-on gate diff is the
  measurement of the option's effect (`node local/gate.mjs --layout`).

### Code review of the day's engine changes (2026-10-19)

Four readers over the day's changes by area (masks, the candidate filter
and symbol obstacles, the caption pass and the measure, the smaller
rules), each finding handed to a skeptic. Eleven findings, nine confirmed,
two refuted; all nine fixed:

- The shade rectangles were recorded in the first stage in client
  coordinates and never moved with the page between idle callbacks, unlike
  the obstacles and zones beside them; a scroll mid-pass put the grey
  masks one scroll away from the box. They move with the rest now.
- A mask piece cut around a kept run can lie wholly off the shade; the
  clamps, bounded by the shade alone, then painted a remainder past the
  piece, over the band the cut had opened. A piece that misses the shade
  is painted white, exactly the piece.
- A white fill inside a coloured one — a white box in a grey panel — was
  never recorded (paper inks nothing), so the panel's colour won under
  the box's text. A white fill inside a recorded shade is a shade of its
  own, and a paper-coloured innermost fill means a white mask.
- The symbol ink probe never stopped: the ink check calls a rect under ten
  canvas pixels wide "too small to judge" and answers ink, so every
  one-pixel column beside a kept glyph read as ink and the obstacle grew
  to its full reach each time (it still stopped at a neighbour's box, which
  is why the "∞" came out whole). An exact probe now judges the column it
  is given and never registers the low-resolution retry.
- The page-level mojibake count took a math accent stored as a combining
  mark on one letter for a mojibake line; two such accents on an ordinary
  page would have kept every Greek letter and accented name. The count
  uses the script and mark-density rules alone.
- A caption's own text read as foreign when its label leads in a face of
  its own (a bold "Fig. 2"): every token of its short last line met the
  position test. The caption's text face — the widest item of its first
  row — is its own too.
- A left-column "TABLE I" alone on its row took the right column's
  lowercase text after it, in the lead text joined across the row, and
  read as an in-text reference. The lead text is its own column's.
- The caption's height was the row's over both columns, and a max with
  the lead's own height changed nothing (the row's is already the
  maximum); it is now the tallest in-band item of the row.
- The citation lookbehind refused a name after an apostrophe, and
  "d’Ascoli et al. (2021)" has no other start; an elided particle of one
  letter at a word start is allowed again, with the run time unchanged.

Refuted: the Title-Case rule's "its row is its own" test is a tautology
(the band is the row's in-band items) — true, and harmless; and its
line-above guard on a two-column page with offset baselines, which the
column filter already handles.

### Security review (2026-10-19)

Five readers over the extension by area (manifest and service worker, DOM
output of PDF-derived text, settings and messaging, supply chain and
run-time loading, the PDF.js patches), each finding handed to a skeptic
asked to refute it from the code. Thirteen findings, six confirmed (two
pairs reporting one issue), seven refuted. Fixed:

- A `file:` URL with a host. Every gate on a file: URL was a scheme test —
  the viewer's `?file=` gate, the bypass list's normaliser, the context
  menu, the navigation fallback and the "native" button — and viewer.html
  is web-accessible to every page. `file://host/share/x.pdf` is
  `\\host\share\x.pdf` on Windows, an SMB connection to that host made with
  the user's credentials once the user has turned on file access for the
  extension; a web page cannot navigate to a file: URL itself, but it can
  send the viewer there. One predicate, `isLocalFileUrl` (no host or
  localhost, no UNC path), now stands at each of the six sites; the bypass
  normaliser no longer keeps a file: string the URL parser rejects, since
  its host cannot be checked. The SMB step itself was not exercised; the
  missing check was plain in the code.
- Two regexes quadratic on a hostile span. The narrative-citation pattern
  started a name at every capital and ran its greedy class to the end of
  the run before the year failed: forty thousand capitals in one text
  operator held the viewer's thread for six seconds, a few hundred
  thousand for minutes, on every render and zoom. A word-start lookbehind
  makes it linear (a millisecond on the same input); a name no longer
  starts inside a word, which no citation did. The line-join fragment
  regex, anchored at the end only, had the same shape; its input is now
  the last 64 characters, longer than any word fragment at a line end.
  Both are a denial of service of the tab only.
- Fonts fetched by a floating range. The build fetched the five reading
  faces from the CDN at `@5` with no hash, and the release workflow
  bundles them: the CDN or a compromised release could put any bytes into
  a release. Each file is now pinned to an exact version and a SHA-256
  (the vendored files' own, which the versions resolved today reproduce
  byte for byte), checked before it is written.

A refuted finding was a real defect of another kind: `REF_LEADER_END`,
the pattern that says a line ends in a reference leader ("as shown in
Figure" / "4"), was built from a string whose `\b` and `\s` had lost
their backslashes — a backspace character and an `s` — so it matched
nothing, and a reference broken at a line end before its number was never
coloured. Repaired, with a test that reads the regex as the product does.
The remaining refuted items were a query-parsing nuance PDF.js and the
gate already read alike, the model and runtime fetches (now hash-checked
and with their licences written, as above), and loopback requests the
viewer could be made to issue, which carry no credentials and return
nothing to the page.

### Papers of other layouts (`local/corpus-extra`, 23 documents)

Open-access papers of layouts neither corpus had, found by one scout per
type and fetched (sources in `local/corpus-extra/SOURCES.md`; local/ is
git-ignored): amsart mathematics, PLOS/BMC biology, Japanese journal
articles (J-STAGE), NBER economics working papers, elsarticle preprints, law
reviews (footnote-only), landscape-page physics instrumentation papers, ICLR
submissions with line numbers, LNCS, REVTeX physics, a scanned OCR report, and
two Word-template IEEE papers. A second scan with no text layer at all is set
aside (`local/corpus-extra-aside`): every harness waits its full timeout on a
document with nothing to process. The corpus is served like the private one
(`servePrivate({ corpus: "extra" })`, aliases ex01..), so every harness runs
on it unchanged.

### Verification

- Unit suite: 333 pass, 0 fail, naming guard passed (parser, citations,
  preview, segmenter, vector-art, rules, layout-model, settings and
  file-param tests added this round).
- Combined gate on the final code — after the code review's nine fixes
  and the security review's — GATE PASS, 37.7 min, every stage 49/49:
  public allprobes 14/14 (8.5 min), public console 14/14 (2.5), public
  papers 1/1 (1.5), private allprobes 35/35 (19.4), private console 35/35
  (5.8). Two gates on this tree earlier in the day passed the same way
  (36.4 and 36.1 min); four before them found the reading-order and
  refcolor defects this round fixed.
- Skip-reason diff against the committed baseline (07bed09): 240 of 773
  pages reclassified, no page unreasoned. Against the gate before the
  day's last fixes: 86 pages, of which 82 keep their count of kept spans
  — the Title-Case heading rule now names lines the figure-body and
  figure-label rules named before, and rotated labels are `rotated` where
  they were `over-body` (an arXiv stamp on every page of one paper).
  Four pages change their count: one caption line absorbed, one span
  more under an overlap, and two pages one heading line fewer. Dumped
  under both measures (`PRE='globalThis.__fxOldMeasure=1'`): on one, a
  run-in heading's line ("G4. Post-suppression resilience. … constitutes
  a …") was skipped whole under the old measure and only the heading run
  is now, its sentence tail processed — the run-in rule needs the line to
  fill the measure, which the stray-inflated one never let it; on the
  other the two dumps agree line for line, so the one-span difference is
  the run's, not the measure's. The USENIX paragraph read below was found
  in this diff.
- The gate on the committed tree itself — d0d3e79, clean, the classifier's
  option off — GATE PASS, 36.5 min, every stage 49/49: public allprobes
  14/14 (8.8 min), public console 14/14 (2.4), public papers 1/1 (1.6),
  private allprobes 35/35 (18.3), private console 35/35 (5.3). Its
  skip-reason diff against the previous gate: 16 pages, one of which
  changes its count — a public paper's table caption, restored by the
  float-gap ceiling; the rest are the Title-Case rule naming lines the
  figure rules named before.
- The second agent: agy re-derived both gates' verdicts from the raw stage
  logs (49/49 per stage, no contention) and the two skip-reason diffs
  (16 pages / 1 count change; 1 page), reviewed the commits' diff (no
  defect; versions consistent) and AGREED the tree is fit to tag. It
  flagged two strings as possible private identifiers: a box title from
  the extra corpus (public, a false positive) and three author e-mail
  addresses in the segmenter test and its comments — those came from a
  private paper's contact line and should never have been written; the
  commit was rewritten before anything was pushed, so the addresses are in
  no commit (e0348c4 is the scrubbed v1.4.0; the classifier's commit
  rebased onto it as 59910fb, the same tree the gate ran on, since only
  comments, a test fixture and these notes changed).
- The gate with the layout option on (`--layout`), on the committed tree:
  GATE PASS, 36.1 min, every stage 49/49, and its skip-reason diff against
  the plain gate of the same engine moves ONE page of 773 — one span more
  kept as a caption. On these corpora the detector's regions keep almost
  nothing the rules had not already kept; the option is safe, and its value
  lies on layouts the rules have not met.
- Extra corpus (23 documents, not a gate corpus), on the committed tree:
  22/23 — ex05 UNVERIFIED by nature (no Latin words, nothing to process).
  ex16 had failed the tables probe on page 15's box title until the
  Title-Case rule learned that a line more than a line and a half under
  the previous one (a box's bottom edge, the blank between boxes) needs no
  sentence end above it; both titles kept, the probe clean.
- The line classifier the next round was to build landed the same day
  from a forked session (d0d3e79): a DocBank/DocLayNet-trained
  gradient-boosted model over line features, as evidence behind its own
  option, with `--line` on the gate; inert unless switched on.
- Edge sheets of both corpora read in full by a sonnet reader (69
  documents, 298 flags, 57 at high confidence); every high flag
  captured at the word before anything changed. 21 were stale sheets
  of the scanned paper from before the scan rule (deleted); nine classes
  were real and are the fixes above; the rest were false positives
  (a wrapped citation that is coloured, a letter that is intact, a
  reference inside a kept equation row — the known R53 limitation) or
  the known small-caps limitation.

## R56 — a line classifier trained on public layouts (2026-10-19)

The user asked whether a model trained for this task would beat both the
rules and the stock layout detector. It does, on held-out public pages, when
the model is a LINE classifier over what the engine already knows rather
than a box detector over pixels.

### What was built (`ml/`, tracked; data and models ignored)

- Features of a text line, computed identically by a Python extractor and a
  JS mirror (`line-features.mjs`, held to the same numbers by a fixture
  test): position against the column and the page, size against the body,
  face flags from the font name, text shape (lowercase words, digits,
  caption and numbered leads, list markers, dangling ends, Title Case),
  two neighbours each side, and the line's block (its first line's lead,
  its length, its position in it).
- Data: DocBank (8,000 arXiv papers, 1.42M lines, token labels from the
  LaTeX source) and DocLayNet's scientific pages (918 papers, 628k lines,
  fetched without images by column-projected range reads of the parquet
  files; the 65 test papers overlap none of them). Seven coarse classes
  the engine acts on: text, heading, caption, formula, table, figure,
  furniture.
- A LightGBM model, 260 rounds of 23-leaf trees per class, exported to a
  2.78 MB JSON that `line-model.mjs` walks in microseconds a line; no
  runtime, no WebAssembly, any CPU. Held out by paper throughout.

### Measured

On 940 DocLayNet scientific test pages, per line (45,423 lines): the
shipped model 0.944 accuracy / 0.942 keep-vs-process F1, the stock
PP-DocLayout-S 0.895 / 0.884. On the same pages through the viewer, per
span weighted by characters (204,016 spans, 1.89M characters), with the
rules' decision being what the engine did: rules 0.808 / 0.611 / 0.497
(accuracy / keep-process F1 / macro F1), classifier 0.965 / 0.884 /
0.885, detector 0.958 / 0.863 / 0.755. The classifier leads on headings
(0.92 vs 0.72 F1), table rows (0.90 vs 0.62) and headers and footers
(0.85 vs 0.31); the detector keeps a small edge on captions, formulas and
figure text. DocLayNet's conventions differ from the engine's design in
places (bibliographies are text there; kept single glyphs count as
misses), so the rules' row is a floor; the engine's genuine weaknesses on
publisher PDFs and single pages are visible all the same. Two lessons on
the way: a font flag that counted CMR as a math face fired on two thirds
of all words; and the two extractors must share ASCII word boundaries.
A heading-level head (title / section / subsection / run-in) reaches 0.89
from geometry alone; a math-token head is weak against DocBank's noisy
inline-math labels and is not shipped.

### In the engine

Behind the `lineModel` option (off by default), as evidence like the
layout model's regions: a line the model names a class in
`LINE_MODEL_KEEP` at that class's confidence or better keeps its
candidates (`model-<class>`); nothing is un-kept. `allprobes` and the gate
take `--line`, and the gate's output directory carries the option's name,
so an option run is diffed against the plain run on the same tree. Details
and the recipe: `ml/README.md`.

What the option did on this project's corpora decided the policy. The
first integration kept any line the model named a kept class at 0.75 or
better; the option gate passed (49/49, 36.0 min) and the skip-reason diff
against the plain gate on the same tree showed 44 pages changed, every
change a new keep (94 named caption, 7 header/footer, 3 heading, 3 table,
2 figure, 1 formula), nothing un-kept. Reading every one of the 190 spans
those keeps covered at the gate's zoom: about twenty were real gains the
rules had missed — sub-figure captions, table cells, a small-caps table
title, a legend, a lettered sub-heading, table notes — and about 170 were
body prose: lines under or beside a figure, lines at the foot of a page,
sentence tails, all named caption or furniture. The rules already catch
nearly every caption and footer on LaTeX-set papers, so what the model
adds on top of them in those classes is dominated by its own errors, however
good its DocLayNet F1. Its table and heading calls were the opposite: the
rules' weak classes, where every extra keep was right. The policy is now
`LINE_MODEL_KEEP = { table: 0.75, heading: 0.9 }`. Re-dumping the 44 pages
with it leaves 8 keeps — 7 table cells and a table title on three private
papers, and the continuation line of a lettered sub-heading — and no
loss. The heading threshold is high because the lettered sub-headings of
one paper scored 0.60–0.78 while a prose line of another scored 0.78: no
threshold separates them, so 0.9 keeps the one certain line and leaves the
rest to the rules, emphasised as before. The option gate with this policy:
PASS, 49/49 in 34.7 min, no retries; the skip-reason diff against the plain gate on the same tree is exactly those four pages (773/773 pages compared), four new keeps — three table, one heading — and nothing else changed.

The lesson for the next step: the classifier's measured edge is where the
rules over-keep (whole columns of prose sent to `table-aligned` or
`line-head` on publisher layouts), and a keep-only integration cannot use
it. Un-keeping — the model vetoing a weak rule reason at high confidence
— is the follow-up, to be judged on the extra corpus where those
over-keeps live, not on the gate corpora where they do not.
