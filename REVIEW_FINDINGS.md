# Visual review — confirmed issues & proposed fixes

Produced by the per-page audit (`test/review-capture.mjs` overlays +
`test/review-workflow.mjs` review/verify). Each issue is verified against the
screenshot before listing. Rules: `TESTING.md` Section 3.

Status: **review complete; F1-F5 all FIXED & validated.**

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
