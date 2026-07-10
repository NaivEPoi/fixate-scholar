# Visual review log — resumable

Purpose: a full per-page audit of every paper PDF against the rules in
`TESTING.md` Section 3. Capture a classification-overlay screenshot per page
(green = processed body, red = left-on-canvas, blue = kept math/special), then
check each page/figure/table and record mismatches here. Update as you go so the
review survives a session limit.

Papers (yilud.me, from test/review-capture.mjs `PAPERS`):
- Two-column A — usenixsecurity25-dong-yilu.pdf
- Two-column B — usenixsecurity24-tu.pdf
- Two-column C — AFC_Attacks_NSDI.pdf
- Two-column D — Proteus-ccs24.pdf
- Two-column E — SIB-Auth.pdf
- Two-column F — a33-dong stamped.pdf
- arXiv — 1706.03762 (Attention Is All You Need)

## Status

| Paper | Pages | Captured | Reviewed | Issues found |
|---|---|---|---|---|
| Two-column A | 21 | ☑ | partial — F2 (p10,p15 body skipped); p4/8/21 false-pos; p12 borderline | F2, F3? |
| Two-column B | 19 | ☑ | ☑ triage+spot | F1, F2 (p08) |
| Two-column C | 17 | ☑ | ☑ triage+visual (p08) | F1, F2 (p08,p11) |
| Two-column D | 15 | ☑ | ☑ triage | F1, F2 (p03,p09) |
| Two-column E | 6 | ☑ | ☑ triage | — (captions OK) |
| Two-column F | 6 | ☑ | ☑ triage | F2 (p04) |
| arXiv | 15 | ☑ | ☑ triage | F1, F2 (p04,p09) |

Review method: per-page JSON triage across all 99 pages (cheap) + visual
confirmation of flagged pages (A p10, C p08). Findings consolidated in
REVIEW_FINDINGS.md (F1/F2/F3). Review COMPLETE for the original corpus.

## Round 2 (2026-07-08): updated yilud.me — 5 NEW papers

Enumerated from https://yilud.me/sitemap.xml → publication pages (11 pubs total;
6 were already in the corpus). New entries added to test/review-capture.mjs:

| Paper | PDF | Pages | Captured | Reviewed | Issues |
|---|---|---|---|---|---|
| 5GCVerif | /5GCVerif-ccs23.pdf | 15 | ☑ | ☑ | F2-residual p03 (fixed); p08 Table 4 verified correct |
| 5GShield | /5GShield.pdf | 20 | ☑ | ☑ | F5 cites=0 (fixed: 0→67 entries) |
| AFC-Diss | /afc_testing_DISS.pdf | 4 | ☑ | ☑ | clean |
| ACL | /2026.acl-long.2136.pdf | 25 | ☑ | ☑ | F5 cites=0 (fixed: 0→91 entries); p19 REF_PROSE paren (fixed) |
| UC-Scheme | /UC_Scheme.pdf | 18 | ☑ | ☑ | clean (p16 = refs page, correctly untouched; table-region fired p8 ✓) |

Round-2 findings (all FIXED, see REVIEW_FINDINGS.md):
- **F5 (HIGH):** extractor merged narrow-gutter columns (ACL ~18pt gutter < the 2×h
  join threshold) → "References" heading merged with the other column's text →
  never matched → 0 entries → the ENTIRE citations feature silently disabled on
  ACL + 5GShield. Fix (extractor.mjs): a gap crossing the page CENTER only joins
  at word-space scale (<0.8×h). ACL 0→91 entries (author-year cites now blue),
  5GShield 0→67. Side benefit: better parsing on old corpus (F 13→23, arXiv 47→68).
- **F2 residual:** caption + 2 body lines = 3-row merged block, under the ≥5-row
  guard → threshold lowered to ≥3 (5GCVerif p03 freed; genuine ≤4-line captions
  still fully skipped via the caption pass).
- **REF_PROSE paren:** "Listing 3 (representative of …" body sentence skipped as a
  caption (ACL p19) → REF_PROSE accepts a parenthetical lowercase continuation.
- Regression after all fixes: npm test 32/32; papers.mjs 7/7 PASS (run 3×).

Capture tool: `test/review-capture.mjs`. Review workflow: `test/review-workflow.mjs`
(run via the Workflow tool with `args` = enumerated page items). Spot-check of
Two-column B p2/p7/p10: classification correct (title/headings/captions/tables/
figure-labels red, body green, math untinted, citations blue) — round-4 DevLyzer
fixes holding.

## Findings (running) — RESOLVED

- **F1 (FIXED):** citation cards attached to bibliography entries' `[N]` markers
  (A p18, C p14/15, D p15, arXiv p11/12). Fix: engine tags refs spans
  `data-fx-refs`; citations.mjs skips them. Validated cites→0.
- **F2 (FIXED):** caption-led block merged with the body paragraph below it was
  skipped whole (A p10/p14, C p08/p11, F p04; caption-absorb on A p15, D p03/p09).
  Fix: don't whole-skip a long prose-dense caption block; tighten caption
  continuation (cap 4, gap 1.3×). Validated body→green, captions stay red.
- **F3 (FIXED):** table cells with prose / wrapped cell lines were processed and
  their masks covered the table rules. Fix: `line-cells-wide` (≥4 gaps >2.2× line
  height) + `table-region` bbox skip of confirmed-table-row regions. Validated:
  B p12 done 183→91, table fully red, body green; no prose-list regression.

See REVIEW_FINDINGS.md for details + validation numbers.

## Notes / resume pointer

- Captures: `test/out/review/<paper>/pNN.png` + `pNN.json` (ALL 7 papers, 99 pages, done).
- Consolidated issues + fixes go in `REVIEW_FINDINGS.md`.

### State at 2026-06-22 (session limit hit mid-review; resets 10:40am ET)
- Capture: COMPLETE — A 21, B 19, C 17, D 15, E 6, F 6, arXiv 15.
- Review workflow `test/review-workflow.mjs` (run id `wf_a5d4adf5-6fc`) ran but the
  session limit aborted most agents. Only ~17 pages cleared review+verify clean;
  no issues were *confirmed* (the verify pass failed on the limit). It cost ~1.07M
  tokens for partial coverage → the per-page-agent workflow is too expensive.
- **UNVERIFIED candidates flagged by the review agents (Two-column A only):**
  - p4  green-on-nonbody (something processed that shouldn't be)
  - p8  green-on-nonbody
  - p12 green-on-nonbody (×2)
  - p21 green-on-nonbody
  - p10 red-on-body (body wrongly skipped)
  - p15 red-on-body
- Confirmed earlier (data): **F1 citation cards on bibliography pages** — see REVIEW_FINDINGS.md.

### RESUME STRATEGY (cheaper — do this instead of the workflow)
Review the captured screenshots **directly in the main session, in small batches**
(read `test/out/review/<paper>/pNN.png` + `pNN.json`, check vs TESTING.md §3, log
findings here). This avoids the workflow's per-page-agent token blowup and is
fully resumable. Order of priority:
1. Verify the 6 Two-column A candidates above (read those PNGs, confirm/refute).
2. Review remaining papers page by page (B, C, D, E, F, arXiv) — a few pages/turn,
   appending findings to the running list and ticking the Status table.
(If a workflow is still wanted: it's batchable as one-agent-per-paper to cut cost;
or resume via `Workflow({scriptPath:"test/review-workflow.mjs", resumeFromRunId:"wf_a5d4adf5-6fc"})` same-session only.)
