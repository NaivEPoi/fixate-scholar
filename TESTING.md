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

- **Use EDGE, not Chrome, for all automated/headless testing.** Chrome ≥149
  (149.0.7827.197) removed the `--load-extension` CLI path entirely (the
  `--disable-features=DisableLoadExtensionCommandLineSwitch` escape hatch is
  gone), so a spawned Chrome loads no extension. Chrome also blocks top-level
  navigation to the viewer's `web_accessible_resource` and blocks remote
  debugging on the default profile. Edge (same Chromium engine + same Windows
  DirectWrite text rendering) loads the unpacked extension and allows direct
  `/json/new?<viewerUrl>` navigation. Path:
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
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

---

## 2. Automated test inventory

| Command | What it verifies | Pass criteria |
|---|---|---|
| `npm test` | naming guard (trademarked 2-word brand absent) + unit tests | `Naming guard passed`, 32/32 |
| `node test/papers.mjs` | full corpus classification + color + links | 7/7 PASS |
| `node test/verify-links.mjs` | hyperref borders suppressed in fx-on, links still clickable, masks track glyphs | `ALL LINK CHECKS PASSED` |
| `node test/diagnose.mjs <paper>` | rendering fidelity: true whiteout, mask peek, font fallback, skipped paragraphs, citation alignment, selectability | whiteout 0; peek low; fontBad 0; selBad 0 |
| `node test/audit.mjs <paper>` | classification issue classes | keepFallback 0; tableLeak 0; capProse 0; skipBody ≈ 0 |

Paper templates (the `<paper>` arg): `"Two-column A"`..`"Two-column F"`, `"arXiv"`
(see the `PAPERS` map at the top of each probe; A–F are on yilud.me).

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
- Overlay glyphs sit on the **canvas baseline** (em-based correction; aligned at
  100% and at 175% × 125% zoom).
- **Per-span masks** cover each redrawn glyph + ink overshoot, never white out a
  skipped neighbour (clamp around "obstacles"); duplicate text-layer spans of
  skipped content are left on canvas.
- **Selection** shows a native translucent-blue highlight; **copy** works.
- **No fallback fonts** in processed/kept text (math/special render in the
  original face on the canvas).
- **Stable when idle / zoomed / backgrounded**: must NOT drift after the PDF.js
  30 s idle cleanup (font eviction), on window switch, or on zoom/DPI change.

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
