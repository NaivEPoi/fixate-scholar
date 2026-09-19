// Rank the pages captured by review-capture.mjs by how likely they are to hold
// a classification defect, so the visual pass starts where the evidence is.
//
// This is NOT a gate and it does not replace looking at the pages — the whole
// point of the capture is that a human (or model) reads the overlay colours
// against TESTING.md Section 3. What this removes is the part that does not
// need eyes: a page whose every processed sample is prose and whose every skip
// reason is a structural one carries no signal, and there are ~180 of them.
//
// Each rule below states the Section 3 rule it is looking for a violation of.
// A flag is a QUESTION, never a finding: REVIEW_LOG.md records more than one
// round where the instrument, not the product, was wrong.
//
// Usage:
//   node test/review-triage.mjs                 # every captured paper
//   node test/review-triage.mjs USENIX_baseline_
//   node test/review-triage.mjs --no-text       # reasons only, no document text
//
// `--no-text` exists for sweeping a corpus whose contents must not be quoted:
// it reports which rule fired on which page and suppresses the sample text, so
// the shortlist is still usable while nothing from the document is printed.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { outDir } from "./lib/env.mjs";

const REVIEW = outDir("review");
const ARGS = process.argv.slice(2);
const NO_TEXT = ARGS.includes("--no-text");
const ONLY = ARGS.filter((a) => !a.startsWith("--"));

/** A sample, or a placeholder when the corpus must not be quoted. */
const show = (s) => (NO_TEXT ? `<${proseWords(s)} prose words>` : JSON.stringify(s.slice(0, 60)));

/** Prose looks like prose: several runs of lowercase letters in a row. */
const proseWords = (s) => (String(s).match(/\b[a-z]{3,}\b/g) ?? []).length;

/** Skip reasons that mean "this is structure, not prose". Seeing one of these
 *  on a sample that reads as a full sentence is the thing worth looking at. */
const STRUCTURAL = new Set([
  "blk-table", "line-cells", "line-cells-wide", "table-aligned", "table-region",
  "table-starts", "table-rules", "caption", "caption-absorb", "fig-body",
  "blk-caption", "blk-capprev", "blk-figlabel", "line-algo", "line-formula",
]);

const findings = [];
const papers = (ONLY.length ? ONLY : readdirSync(REVIEW)).filter((d) =>
  existsSync(join(REVIEW, d)),
);

let pagesSeen = 0;
for (const paper of papers) {
  const dir = join(REVIEW, paper);
  const pages = readdirSync(dir).filter((f) => /^p\d+\.json$/.test(f)).sort();
  for (const file of pages) {
    const p = JSON.parse(readFileSync(join(dir, file), "utf8"));
    pagesSeen++;
    const at = `${paper} ${file.replace(".json", "")}`;
    const why = [];

    // Section 3 "PROCESS: running body text". A page with a substantial text
    // layer and nothing processed is either front matter, a full-page figure,
    // a bibliography page — or a page whose body was wrongly skipped.
    //
    // `refsPage` is what separates the last case from the third. Before the
    // capture recorded it, ten correct reference pages were flagged for every
    // real defect, and the one page whose two columns of prose had been eaten
    // by a runaway table rule sat in the middle of that list looking exactly
    // like its neighbours.
    if (p.processedDone === 0 && p.leafSpans >= 40 && !p.refsPage) {
      why.push(`nothing processed on ${p.leafSpans} spans`);
    }

    // Section 3 "DO NOT PROCESS: table cells / captions / figure bodies".
    // A structural skip whose sample text reads as a sentence is the F2/F3
    // defect shape: prose swept up with the structure around it. The threshold
    // is 4 words, not 6: the line that opened the runaway run above was "found
    // some UEs accept plaintext", and at 6 it was invisible here.
    for (const [reason, info] of Object.entries(p.skipByReason ?? {})) {
      if (!STRUCTURAL.has(reason)) continue;
      for (const ex of info.ex ?? []) {
        if (proseWords(ex) >= 4) why.push(`${reason} on prose: ${show(ex)}`);
      }
    }

    // A structural rule that claims most of a page is either a full-page table
    // or a run that escaped one; either way it is worth the look.
    const structural = Object.entries(p.skipByReason ?? {})
      .filter(([r]) => STRUCTURAL.has(r))
      .reduce((n, [, i]) => n + i.n, 0);
    if (structural >= 60 && structural > p.processedDone * 2 && !p.refsPage) {
      why.push(`${structural} spans skipped structurally vs ${p.processedDone} processed`);
    }

    // Section 3 "PROCESS". The inverse: something processed that reads like a
    // caption rather than a sentence. "Figure 5 shows…" IS prose (REF_PROSE),
    // so only a real caption opener — the label followed by ":" or "." — counts.
    for (const ex of p.sampleDone ?? []) {
      if (/^(Figure|Table|Algorithm|Listing)\s+\d+\s*[:.]/.test(ex)) {
        why.push(`processed a caption opener: ${show(ex)}`);
      }
    }

    if (why.length) findings.push({ at, done: p.processedDone, skip: p.skippedTable, why });
  }
}

for (const f of findings) {
  console.log(`${f.at.padEnd(34)} done=${String(f.done).padStart(4)} skip=${String(f.skip).padStart(4)}`);
  for (const w of f.why) console.log(`    - ${w}`);
}
console.log(
  `\n${pagesSeen} pages triaged across ${papers.length} papers; ` +
    `${findings.length} flagged for a look.`,
);
