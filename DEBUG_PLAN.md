# FixateScholar rendering-fidelity debug plan

Persistent work-state for the "subtle rendering errors" fix effort. Survives
session pauses — **read this first on resume**, then `git log` and the task
list. Primary repro paper: **5GBaseChecker** (`usenixsecurity24-tu.pdf`,
"Two-column B" in `test/papers.mjs`); the user's screenshots are all from it.

## Key finding (baseline, 2026-06-17)

`node test/papers.mjs … "Two-column B"` **PASSES every existing check** yet the
user sees real visual defects. The current suite verifies *structural* rules
(headings/tables not emphasized, links not bolded, refs region untouched) but
**not visual fidelity**: mask coverage/offset, font fallback consistency,
hit-target alignment, selectability, internal-ref navigation, subtle
single-paragraph skips. So step 1 is a *sensitive* diagnostic harness
(`test/diagnose.mjs`) that fails on these, then fix until it is clean.

## Issue list (from user report + code analysis)

Status: ☐ open · ◐ in progress · ☑ fixed+verified

| # | Issue | Suspected root cause | Status |
|---|---|---|---|
| 1 | Figures masked with a different font | per-RUN mask bbox bridged gaps + swallowed skipped caption leaders; in-text "Figure N" ref has a duplicate skipped span the processed copy's mask covered | ☑ per-span masks + obstacle clamp + overlap-exclusion; true whiteout 0; verified visually |
| 2 | Layout collapses after a window switch | FontFace eviction on background → stale `getBoundingClientRect` bakes collapsed `--scale-x`/word-spacing; existing `document.hidden` gate only checked at `work()` entry, not mid-loop | ☐ needs visibilitychange repro |
| 3 | Headings masked completely / in a different font | run-in bold headings (skipLeadRun) left on canvas but covered by adjacent run's bbox mask → whited out | ☑ per-span masks; "Possible missing deviations." etc. render pristine bold; verified |
| 4 | Internal ref links (Table/Figure) removed | `annotationlayerrendered` set ALL internal `<a>` `pointer-events:none`; figure/table jumps died with no replacement | ☑ `reconcileLinks` keeps figure/table/section jumps, disables only citation-overlapping links; verifying nav |
| 5 | Citation hit-target not aligned with colored `[X]` | hit-target `<a>` from `rangeRects` at annotate time; metric noisy (conflates uncolored citation w/ misalignment) | ◐ needs better probe |
| 6 | Some paragraphs completely skipped | `#classifyBlocks` over-aggressive skip | ☑ not reproduced on body pages (skipRun only in refs = correct); watch other papers |
| 7 | Font randomly changes | embedded `g_*` FontFace not ready/evicted → fallback face | ☐ needs visibilitychange/font-evict repro |
| 8 | Masked text not selectable | hit-target/mask stacking | ◐ selBad 0; needs real Selection-API drag test |
| 9 | Mask off by a few pixels / incomplete cover | `padY=0.16h`, `padX=max(0.5,0.04h)` — below documented ±28% V / ±max(2px,12%) H | ☑ restored padding; peek 1410→155 (residual = clamp-adjacent + 1 outlier) |

## Verification pipeline

- `test/diagnose.mjs <template-filter>` — the new sensitive harness. Per page:
  capture region screenshots + DOM probes for each issue class. Writes
  `test/out/diag-<paper>.json` and PNGs under `test/out/`.
- `node test/papers.mjs <browser> "<filter>"` — existing structural corpus.
- `npm test` — naming guard + unit tests (must stay green).
- Browser: Edge only (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`);
  Chrome ≥137 ignores `--load-extension`. Tests leave zombie Edge/node procs —
  kill between runs if ports collide.

## Diagnostic findings (run1, Two-column B, 2026-06-17)

`test/out/diag-TwocolumnB.json`. TOTALS: whiteout 67, peek 1410 (d≈2px),
fontBad 0, skipRun 14 (all refs region — false positive), citeGapN 19
(max 522, noisy metric), refColored 102 / refHits 0, selBad 0.

Confirmed, ranked by impact:

1. **WHITEOUT (issues 1, 3) — top priority.** 67 spans left-on-canvas
   (skipped) are >55% covered by a mask but never re-rendered, so they vanish:
   - run-in bold headings: "Findings.", "Contributions." (p3), "A3:/A4:"
     (p6), "Possible missing deviations." (p16)
   - caption leaders split across spans: "Fig"+"ure" (p7,8,9,15),
     "Tab"+"le" (p10,11,13,14), "Algor"+"ithm" (p18)
   - appendix heading "Ap"+"pendix"+"B" (p8)
   Mechanism: TBD — the adjacent processed run's merged mask rectangle extends
   over the skipped word. Probing now.
2. **Mask peek / padding (issue 9).** Every processed span ~2px under-covered.
   Code uses padY=0.16h, padX=max(0.5,0.04h); spec is 0.28h V /
   max(2px,0.12h) H. Restore padding (verify no overlap onto next line).
3. **Internal ref nav (issue 4).** 102 colored Figure/Table refs, 0 clickable
   — `annotationlayerrendered` disables internal links with no replacement.
4. **Citation alignment (issue 5).** citeGap metric noisy (nearest-cite-c
   conflates "uncolored citation" with "misaligned"). Needs a better probe.
5. **Font change / collapse on window switch (issues 2, 7).** Not reproduced
   headless (fontBad 0); needs an explicit visibilitychange/occlusion repro.
6. **Skipped paragraphs (issue 6).** Not seen on body pages (skipRun only in
   refs region = correct). Low priority; watch on other papers.
7. **Selectability (issue 8).** Not reproduced (selBad 0); revisit after
   whiteout fix with a real Selection-API drag test.

## Round 2 (user follow-up, 2026-06-17 cont.)

User, on the arXiv "Attention Is All You Need" PDF, reported: (a) a box "going
upper than the original text" around the tensor2tensor URL; (b) "overlay glyphs
look higher than original"; (c) "mask cuts the lower part of the original glyph
like g in acknowledgements". Hint: "logical text location may differ from the
displayed text location — match the displayed position."

Findings + fixes:
- (a) The box was NOT our mask — it is PDF.js rendering the PDF's own hyperref
  link border (hyperref defaults: cyan URLs, red internal refs, green cites),
  present even with the extension OFF (`section.linkAnnotation`, computed border
  `1px rgb(0,255,255)`). Suppressed in reading mode via overlay.css
  (`#viewerContainer.fx-on .annotationLayer .linkAnnotation{border/outline/
  background:none}`). Verified: border `1px cyan` → `0px`, box gone, links still
  clickable (test/verify-links.mjs, test/probe-url.mjs).
- (b)+(c) ROOT CAUSE (the "logical vs displayed" issue): PDF.js positions each
  text-span's line-box top at `baseline − fontHeight × ascentRatio(assignedFont)`
  using the GLYPH-BBOX ascent of the substitute font it assigns (here it renders
  the text layer in `sans-serif`). That substitute's RENDERED baseline lands on
  the canvas baseline (verified: native text layer colored red sits exactly on
  the black canvas, fx off). When we swap in the embedded font, its RENDERED
  baseline (≠ its glyph-bbox ascent) lands ~2-3px higher → overlay sits above the
  canvas, and the box-derived mask falls short of the canvas descenders. Canvas-
  pixel probe confirmed overlay ~5px high (Range) / descenders cut.
  FIX in engine.mjs: re-seat each processed span's baseline with
  `margin-top = ascentRatio(origFamily) − baselineRatio(newFamily)` em (scale-
  invariant), where `#ascentRatio` = glyph-bbox ratio (matches PDF.js) and
  `#baselineRatio` = the font's actual RENDERED baseline ratio (measured with a
  `vertical-align:baseline` marker). Restructured the work loop so masks are
  built from the CORRECTED, re-measured vertical geometry (mask vertical from
  the post-shift rect; horizontal from the pristine rect that width-correction
  restores). marginTop is saved in pristine + reset in #restorePage.
  Verified: red overlay now sits on the black canvas; mask band covers
  descenders. New probes: test/probe-offset.mjs, probe-vshift.mjs,
  probe-canvas.mjs (reads canvas pixels, clusters dark rows to isolate a line),
  probe-overlap.mjs (red-overlay / mask / native-text-layer captures),
  probe-url.mjs, verify-links.mjs.

## Round 3 (user follow-up, 2026-06-18)

User reported, after merge: (1) "fallback fonts are still in the processed pdf
— use the original font/style for math symbols"; (2) "this table still gets
processed" (Table 8, p19 of 5GBaseChecker); (3) "some paragraphs are not
processed" (e.g. "Figure 5 shows the cumulative number of queries…").

Audit (`test/audit.mjs`, new) on Two-column B found: keepFallback=570,
tableLeak=0, capProse=2, skipPara=0. Root causes + fixes (engine.mjs):

- (1)+(2) ONE root cause: "keep" glyphs (math/special-font runs, symbols,
  subscripts, single chars, version strings) were MASKED and RE-RENDERED in
  the text layer, which PDF.js sets to a generic substitute face (sans-serif /
  monospace) → math lost its font. On Table 8 the Baseband-Version and
  Found-Issues cells are such keep glyphs, so the table "looked processed".
  Now that masks are per-span + obstacle-clamped, the keep re-draw is
  unnecessary. FIX: keep glyphs are EXCLUDED from candidates entirely — left
  on the CANVAS in the document's own face — and become obstacles
  (`obstacleDivs` now `/\S/`, so pure-symbol spans count) so neighbouring
  masks clamp around them. Removed all keep/`_keep`/`fxKeep` redraw code.
  Result: keepFallback 570→0; Table 8 cells all stay on canvas (original font).
- (3) "Figure N shows …" / "Algorithm 1 in Appendix …" — an in-text reference
  opening a running sentence (label+number followed by a LOWERCASE word) was
  matched by CAP_LEAD / ALGO_LEAD and skipped as a caption/listing. FIX: added
  `REF_PROSE` guard → `isCaptionLead` / `isAlgoLead` (and the figure-label
  rule) skip ONLY genuine captions/listings ("Figure 5:", "Figure 5. ",
  "Algorithm 1 StateSynth", standalone). "Figure 5 shows…" now processed.

- (3b) Corpus audit (`test/audit.mjs` on all 7 papers) found two more in-text
  "Figure/Table/Algorithm N <verb>" prose refs wrongly skipped. Added a
  debug skip-reason tagger (`globalThis.__fxDebug` → `data-fx-why`, gated, zero
  prod impact) to find the path:
  - Two-column A p15 "Figure 8 shows the coverage growth over time…" → skipped
    by **caption-absorb**: a caption above it absorbed downward into this body
    sentence. FIX: caption continuation-absorption now BREAKS at a REF_PROSE
    line (a new "Figure N shows…" sentence is body, not caption continuation).
    Verified: A capProse 1→0.
  - Two-column B p10 "Algorithm 1 in Appendix A." → skipped by the **block
    heading rule**: two-column layout puts it on the same baseline as the
    left-column "7.2 Checking Properties" heading, so the heading block sweeps
    it up. NOT masked (canvas, original font, just not bolded). Left as a
    KNOWN MINOR RESIDUAL — fixing the two-column heading/baseline grouping is
    risky vs the 1-phrase payoff.

Round-3 net: keepFallback 0 and tableLeak 0 on ALL 7 papers; capProse 0 on all
except the one B residual; skipPara only front-matter emails (correct).

## Round 4 (user follow-up, 2026-06-18)

User: dense/math-heavy body paragraphs not bolded (3.1 Problem Statement, the
DevLyzer §7.1/§7.3 paragraphs, "Evaluating collaborative learning", the §9.2
mishandling list). My earlier audit missed them because it treated
`data-fx-table` (skipSet) lines as legitimately skipped.

Added a `skipBody` audit metric (data-fx-table spans that are clearly body
prose) + a gated skip-reason tagger (`globalThis.__fxDebug` → `data-fx-why`).
On 5GBaseChecker: skipBody=31, reasons blk-table 14, line-cells 4,
caption-absorb 10, blk-figlabel 2 (refs author lists, correct). Fixes
(engine.mjs):

- **blk-table / line-cells (justified prose mistaken for a table).** Justified
  body lines stretch inter-word spaces wide enough that `maxCells` counts them
  as column gaps (cells≥3 / maxCells≥4). Restored the documented RUNNING-PROSE
  exception: a block averaging ≥4 lowercase words/row (or a line with ≥4
  lowercase words) is prose, not a table. Pseudocode (ALGO_LEAD) still skips.
- **caption-absorb (captions swallowing the body below).** Tightened the
  line-level caption continuation-absorption: cap 14→6 lines, gap break
  1.8h→1.5h, and stop at a bold run-in heading. Broadened REF_PROSE to allow
  punctuation after the number ("Table 4, and present …") so a wrapped in-text
  ref line isn't a false caption leader.

Result: skipBody 31→16, and ~14 of the 16 are CORRECT skips (real Table
captions, legend abbreviations, run-in headings, refs author lists). Real
residuals: 2 lines of §7.3 body still absorbed by Figure 4's caption; 1 §9.2
list line (blk-offsize). diagnose B: whiteout 0→2 (single math chars `d`/`q`,
cov 0.71 — partial, same minor class as the known arXiv residual), peek up
(more body processed near math obstacles → benign for redrawn spans),
refColored 106→131. Full papers.mjs corpus 7/7 PASS, table untouched-probes
intact (no real table un-skipped); npm test 32/32. 3.1 verified bolded with
math symbols in the original font.

Commits on `main` (unpushed since the round-2 push): 4758a4a (round 3),
a276b22 (round 4).

## Progress log

- 2026-06-17: Explored codebase. Baseline papers.mjs PASSES (coverage gap
  confirmed). Built `test/diagnose.mjs` (sensitive fidelity harness). First
  run surfaced findings above. Fixed an arg-parse bug (node.exe matched the
  `.exe` browser sniff). Probed whiteout mechanism on p7/p10.
- 2026-06-17: Whiteout root cause = mask design. Fixes in `engine.mjs`:
  (a) restored documented padding (0.28h V / max(2px,0.12h) H) — peek
  1410→107; (b) replaced per-RUN bounding-box masks with per-SPAN masks
  (gaps are whitespace, need no cover) — killed all run-in-heading whiteouts
  (67→51); (c) obstacle-clamp: padding never reaches a skipped span; (d)
  overlap-exclusion: a body candidate overlapping a skipped span is a
  duplicate (tagged-PDF / wide-caption-over-fine-spans) → left on canvas.
  This last targets the remaining caption-LEADER whiteouts ("Figure"/"Table"/
  "Algorithm"/"Appendix"). Verifying in run4.
  IMPORTANT: the whiteout is what the USER SEES — normal scroll-into-view runs
  the single first-pass processing (no re-process), which is the buggy pass.
  Issue 4 fix also landed: `citations.reconcileLinks` keeps figure/table jump
  links, disables only citation links (overlay handler rewired).
- Bash quirk: background commands DO inherit the foreground cwd here, but
  always `cd` to be safe; write logs to `test/out/` (abs paths in scripts).
- 2026-06-17 (cont.): Verified the remaining issues with `test/interact.mjs`
  (links/cites/selection) and the existing `debug-hidden.mjs` /
  `debug-relayout.mjs`:
  - Issue 5 (citation alignment): NOT a real bug. Cite hit-targets overlap
    their colored `[X]` at fraction 1.0 (15/16). The diagnostic's citeGap=522
    was a noisy nearest-cite-c metric (matched a hit to a far cite-c on
    another line), not real misalignment.
  - Issue 8 (selectability): NOT a real bug. Programmatic selection over a
    processed span returns its text; body/ref hit-tests reach `.textLayer`;
    only citation hit-targets sit on top (intended, for click). selBad=0.
  - Issue 2 (layout collapse on window/monitor switch): `debug-hidden`
    confirms processing PAUSES while `document.hidden` and resumes (0 while
    hidden → baseline when visible, overlaps≈1). `debug-relayout` (DPI 1→2 +
    size change = monitor switch) keeps overlaps at 1 (no collapse); the §7
    DevLyzer page — one of the user's screenshots — renders clean after.
    (debug-hidden's "FAIL" is only its `>100` done-count threshold being
    wrong for the sparse 59-span p10.)
  - Issue 7 (font randomly changes): the eviction→fallback path is mitigated
    by the `document.fonts` `loadingdone` re-process (overlay.mjs); normal
    relayout keeps embedded `g_*` faces + sizes stable. Hard to reproduce the
    actual eviction headless; no additional defect found.
  Net: of 9 reported issues, 1/3/9 fixed+verified, 4 fixed, 2 verified-ok,
  5/6/8 not-real/not-reproduced, 7 mitigated.
- 2026-06-17 (final verification): FULL corpus regression `node
  test/papers.mjs` → ALL 7 PAPERS PASS (proseOk/headingClean/tableOk/linkOk
  everywhere — no under-processing, no new heading/table leaks). Fidelity
  diagnostic true-whiteout: 5GBaseChecker 0, Two-column D 0, arXiv 2.
  npm test (naming + 32 unit) green. debug-hidden PASS threshold fixed
  (compare to page baseline, not a fixed >100).
  KNOWN MINOR RESIDUALS (not in the user's list, low visual impact):
  - arXiv p3/p6: 2 single-character inline-math glyphs ("i","U") skipped and
    covered by a neighbour mask — a math-glyph KEEP edge case, not the
    heading/caption class. Pre-existing; chase later if it matters.
  - peek residual ~155/paper (was 1410): mostly the clamp deliberately pulling
    a word's overshoot back from an adjacent skipped span (correct tradeoff:
    a ≤~3px ink sliver beats whiting out the heading), plus 1 tall figure-span
    outlier per paper (peekMax). Not visually significant.
