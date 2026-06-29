export const meta = {
  name: "fixate-page-review",
  description: "Audit every captured PDF page's classification overlay against the FixateScholar processing rules; adversarially verify findings.",
  phases: [
    { title: "Review", detail: "one agent per page: read the overlay screenshot + JSON, flag rule violations" },
    { title: "Verify", detail: "adversarially re-check each flagged finding against the screenshot" },
  ],
};

// args: { base: <abs dir>, papers: [{ paper, dir, pages }] } — expanded to one
// item per page here (png/json paths built from base/dir/pNN).
let A = args;
if (typeof A === "string") { try { A = JSON.parse(A); } catch { A = null; } }
const BASE = (A && A.base) || "C:/misc/Claude_Workspace/fixate-scholar/test/out/review";
const papers = (A && A.papers) || [
  { paper: "Two-column A", dir: "Two_column_A", pages: 21 },
  { paper: "Two-column B", dir: "Two_column_B", pages: 19 },
  { paper: "Two-column C", dir: "Two_column_C", pages: 17 },
  { paper: "Two-column D", dir: "Two_column_D", pages: 15 },
  { paper: "Two-column E", dir: "Two_column_E", pages: 6 },
  { paper: "Two-column F", dir: "Two_column_F", pages: 6 },
  { paper: "arXiv", dir: "arXiv", pages: 15 },
];
const items = [];
for (const p of papers) {
  for (let pg = 1; pg <= p.pages; pg++) {
    const n = String(pg).padStart(2, "0");
    items.push({ paper: p.paper, page: pg, png: `${BASE}/${p.dir}/p${n}.png`, json: `${BASE}/${p.dir}/p${n}.json` });
  }
}
if (!items.length) { log("no page items (args.papers empty)"); return { error: "no items" }; }
log(`Reviewing ${items.length} pages across ${papers.length} papers`);

const RULES = `FixateScholar processing rules (the overlay colors the engine's DECISION):
- GREEN tint  = processed body text (data-fx-done): bold leading syllables in the embedded font.
- RED tint    = left on the canvas / skipped (data-fx-table) — the engine's "do not process" set.
- BLUE tint   = kept math/special (data-fx-keep).
- NO tint     = canvas text with no flag (front matter before Abstract, references region, math/special with no Latin letter, headers/footers, page numbers, size-filtered text).

CORRECT classification (what SHOULD be each color):
- GREEN should ONLY cover running body prose paragraphs, in-text reference sentences ("Figure 5 shows…"), appendix prose, dense prose lists. The bold run-in lead of a paragraph may be red while the rest is green — that is correct.
- RED should cover: section/subsection headings (numbered/label/bold/large), figure & table CAPTIONS (+ their continuation) and the figure/table body, table cells, figure/axis labels, displayed equations, pseudocode/algorithm listings.
- UNTINTED is expected for: the paper title/authors/affiliations/emails, the bibliography/references list, inline math & symbols & subscripts & single chars & version strings, running headers/footers, page numbers, arXiv watermark.
- Citations [N] / (Author Year) should render BLUE; in-paper refs "Figure 3"/"Table 9"/"Section 5" should render RED-colored text (distinct from the red skip tint — judge by context). These are colors on the glyphs, not region tints.

REPORT ONLY CLEAR violations (be conservative — the engine is mostly correct):
1) GREEN over a heading / caption / table cell / figure label / equation / code  → wrongly processed.
2) RED over a clearly running body paragraph (full sentences, many lowercase words) → wrongly skipped.
3) UNTINTED over a clearly running body paragraph that is NOT front-matter/references → missed (never became a candidate).
4) Visual defect on the glyphs: wrong typeface / fallback font, text baseline visibly higher/lower than neighbours, canvas "ghost" doubling around words (mask miss), a citation NOT blue, an in-paper ref NOT red.
Do NOT flag: correct red on headings/captions/tables, correct untinted on title/refs/math, a run-in lead being red, or subjective spacing.`;

const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    paper: { type: "string" },
    page: { type: "number" },
    pageType: { type: "string", description: "title | body | figure | table | references | appendix | mixed" },
    overallLooksCorrect: { type: "boolean" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["green-on-nonbody", "red-on-body", "untinted-body", "visual-defect", "citation-color", "ref-color", "other"] },
          region: { type: "string", description: "short quote/location of the affected text" },
          expected: { type: "string" },
          actual: { type: "string" },
          why: { type: "string", description: "data-fx-why reason from the JSON if relevant, else ''" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["kind", "region", "expected", "actual", "severity", "confidence"],
      },
    },
  },
  required: ["paper", "page", "pageType", "overallLooksCorrect", "findings"],
};

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    real: { type: "boolean", description: "true if the violation is genuine after re-inspection" },
    reason: { type: "string" },
  },
  required: ["real", "reason"],
};

const reviewPrompt = (it) => `${RULES}

Review ONE page of paper "${it.paper}", page ${it.page}.
1. Read the classification-overlay screenshot:  ${it.png}
2. Read the per-page classification JSON:        ${it.json}
The JSON has counts (processedDone/skippedTable/keptKeep), sample texts per category (sampleDone/sampleOther), and skipByReason (data-fx-why → count + examples). Cross-reference the JSON against what you SEE in the screenshot.
Classify the page (pageType) and decide overallLooksCorrect. List ONLY clear rule violations as findings (empty array if the page is correct). For each finding give the region text, expected vs actual color/behaviour, the data-fx-why if relevant, severity and your confidence. Return the structured object.`;

const verifyPrompt = (it, f) => `Adversarially re-check a single reported issue on paper "${it.paper}" page ${it.page}. Default to real=false unless you can clearly confirm it.
Reported: kind=${f.kind}; region="${f.region}"; expected="${f.expected}"; actual="${f.actual}".
${RULES}
Open the screenshot ${it.png} and the JSON ${it.json}, find that exact region, and decide if the reported violation is GENUINE (a real rule break) or a false alarm (e.g. it is actually a heading/caption/table that is correctly red, correctly-untinted front-matter/refs/math, a correct run-in lead, or a misread). Return {real, reason}.`;

const results = await pipeline(
  items,
  (it) => agent(reviewPrompt(it), { label: `review:${it.paper} p${it.page}`, phase: "Review", schema: FINDINGS_SCHEMA }),
  (review, it) => {
    if (!review || !review.findings?.length) return { paper: it.paper, page: it.page, pageType: review?.pageType, confirmed: [] };
    return parallel(
      review.findings.map((f) => () =>
        agent(verifyPrompt(it, f), { label: `verify:${it.paper} p${it.page} ${f.kind}`, phase: "Verify", schema: VERDICT_SCHEMA })
          .then((v) => ({ ...f, verdict: v }))
          .catch(() => ({ ...f, verdict: { real: false, reason: "verify failed" } })),
      ),
    ).then((checked) => ({ paper: it.paper, page: it.page, pageType: review.pageType, confirmed: checked.filter((c) => c.verdict?.real) }));
  },
);

const pages = results.filter(Boolean);
const confirmed = pages.flatMap((p) => (p.confirmed || []).map((c) => ({ paper: p.paper, page: p.page, pageType: p.pageType, ...c })));
const byPaper = {};
for (const c of confirmed) (byPaper[c.paper] ||= []).push(c);
log(`Confirmed ${confirmed.length} issue(s) across ${Object.keys(byPaper).length} paper(s); reviewed ${pages.length} pages`);
return {
  reviewedPages: pages.length,
  confirmedCount: confirmed.length,
  byPaper,
  confirmed,
  cleanPages: pages.filter((p) => !p.confirmed?.length).length,
};
