// Offline reference-parse sweep — no browser, no extension, seconds per paper.
//
// Runs the SHIPPING extractor + parser (references/extractor.mjs →
// references/parser.mjs) over PDFs straight from Node, and reports per paper:
// the heading it found, how many body lines and entries came out, and how many
// of the document's in-text citations resolve to one of those entries. That
// last number is the one that matters — entry count alone looks healthy on a
// bibliography that was silently truncated.
//
// It is a REPORTING tool, not a gate: `citeaudit.mjs` still owns the live
// behavior (hit-targets, native-link reconciliation) and `papers.mjs` the
// corpus. What this buys is breadth. The R26 defects were found by pointing it
// at 20 arXiv papers in one run; the browser harnesses would have taken hours.
//
// Usage:
//   node test/refparse.mjs <pdf|dir|url> [more…]   # any mix
//   node test/refparse.mjs papers/ --lines=REFERENCES   # dump matching lines
//
// Flags:
//   --lines=<regex>  after each paper, print extracted lines matching it
//                    (with page/column/x/height) — the "why did the heading not
//                    match" view, same job as debug-refs.mjs without a browser.

import { loadPdfjs, loadReferenceModules, openPdf, resolveTargets } from "./lib/pdfjs-node.mjs";

const pdfjs = await loadPdfjs();
const { extractLines, parseReferences, findReferencesBody, findCitations, resolveCitation } =
  await loadReferenceModules();

const args = process.argv.slice(2);
const LINES = args.find((a) => a.startsWith("--lines="))?.slice(8);
const targets = args.filter((a) => !a.startsWith("--"));
if (!targets.length) {
  console.error("usage: node test/refparse.mjs <pdf|dir|url> [more…] [--lines=<regex>]");
  process.exit(2);
}

// Directories expanded; URLs downloaded into a temp dir the OS reclaims.
const files = await resolveTargets(targets);

globalThis.__fxDebug = true;
let zero = 0;
let low = 0;
for (const { path, name } of files) {
  try {
    const doc = await openPdf(pdfjs, path);
    const lines = await extractLines(doc);
    const entries = parseReferences(lines);
    const { heading, body } = findReferencesBody(lines);
    let cites = 0;
    let resolved = 0;
    for (const l of lines) {
      for (const c of findCitations(l.text)) {
        cites++;
        if (resolveCitation(c.keys, entries).length) resolved++;
      }
    }
    // ZERO: a bibliography that produced nothing — the whole feature is off on
    // this document. LOW: entries exist but most citations miss them, which is
    // what a truncated reference list looks like.
    const flag = !entries.length ? "ZERO" : cites && resolved / cites < 0.6 ? "LOW " : "ok  ";
    if (flag === "ZERO") zero++;
    else if (flag === "LOW ") low++;
    console.log(
      `${flag} ${name.padEnd(28)} pages=${doc.numPages} head=${heading ? JSON.stringify(heading.text) : "(none)"} ` +
        `body=${body.length} entries=${entries.length} cites=${cites} resolved=${resolved} ` +
        `mode=${globalThis.__fxRefDebug?.mode ?? "-"}`,
    );
    if (LINES) {
      const re = new RegExp(LINES, "i");
      for (const l of lines) {
        if (!re.test(l.text)) continue;
        console.log(
          `       p${l.page} c${l.column} x=${Math.round(l.x)} y=${Math.round(l.y)} ` +
            `h=${l.h.toFixed(1)} ${JSON.stringify(l.text.slice(0, 120))}`,
        );
      }
    }
  } catch (e) {
    console.log(`ERR  ${name} — ${e.message}`);
  }
}
console.log(`\n${files.length} paper(s): ${zero} with no entries, ${low} resolving under 60%.`);
process.exit(0);
