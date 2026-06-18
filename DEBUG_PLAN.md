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
