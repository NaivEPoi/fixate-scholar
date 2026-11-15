// What changed between two sweeps (test/sweep.mjs runs of allprobes): per
// document, every page whose skip reasons moved and every check total that
// moved. This is the "skip-reason diff" an engine change is read by: a rule
// that was meant to move one line shows up as that line, and anything else it
// moved shows up beside it.
//
//   node test/sweep-diff.mjs <dirA> <dirB> [--all]
//
// A directory is a sweep's output folder (test/out/sweep/<run>, or the same
// in another worktree). Only documents present in both are compared; the ones
// in one alone are listed. Per page the whyskip `byWhy` counts are compared
// (unprocessed prose spans by reason; a span that became processed leaves its
// reason's count), and per document the fontkeep / eqkeep / refcolor / tables /
// citepoint summary lines. `--all` also prints the documents with no change.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dirA, dirB] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!dirA || !dirB) { console.error("usage: node test/sweep-diff.mjs <dirA> <dirB> [--all]"); process.exit(2); }
const ALL = process.argv.includes("--all");

/** One log: the whyskip pages, and each check's summary line. */
function read(path, id) {
  // The last run in the file is the one the sweep scored (a 75 is retried).
  const text = readFileSync(path, "utf8").split("=== retry").pop();
  const lines = text.split(/\r?\n/);
  const out = { pages: null, totals: {} };
  let section = "";
  for (const l of lines) {
    const s = /^--- (\w+) ---$/.exec(l);
    if (s) { section = s[1]; continue; }
    if (l.startsWith(`${id} [{"page"`)) { try { out.pages = JSON.parse(l.slice(id.length + 1)); } catch { /* truncated */ } continue; }
    if (/^TOTALS?[: ]/.test(l) && section) out.totals[section] = l.trim();
  }
  out.verdict = lines.filter((l) => l.trim()).pop() ?? "";
  return out;
}

const idsA = new Set(readdirSync(dirA).filter((f) => f.endsWith(".log")).map((f) => f.slice(0, -4)));
const idsB = new Set(readdirSync(dirB).filter((f) => f.endsWith(".log")).map((f) => f.slice(0, -4)));
const both = [...idsA].filter((id) => idsB.has(id)).sort();
const only = [...idsA].filter((id) => !idsB.has(id)).map((id) => `${id} (first only)`)
  .concat([...idsB].filter((id) => !idsA.has(id)).map((id) => `${id} (second only)`));

let changedDocs = 0, changedPages = 0, pagesSeen = 0;
for (const id of both) {
  const a = read(join(dirA, `${id}.log`), id), b = read(join(dirB, `${id}.log`), id);
  const rows = [];
  if (!a.pages || !b.pages) rows.push(`  whyskip pages not found (${a.pages ? "" : "first "}${b.pages ? "" : "second"})`);
  else {
    const byPage = new Map(b.pages.map((p) => [p.page, p]));
    for (const pa of a.pages) {
      const pb = byPage.get(pa.page);
      pagesSeen++;
      if (!pb) { rows.push(`  p${pa.page}: missing in second`); continue; }
      const keys = new Set([...Object.keys(pa.byWhy || {}), ...Object.keys(pb.byWhy || {})]);
      const moved = [...keys].filter((k) => (pa.byWhy?.[k] || 0) !== (pb.byWhy?.[k] || 0))
        .map((k) => `${k} ${pa.byWhy?.[k] || 0}->${pb.byWhy?.[k] || 0}`);
      if (pa.unreasoned !== pb.unreasoned) moved.push(`UNREASONED ${pa.unreasoned}->${pb.unreasoned}`);
      if (pa.trailing !== pb.trailing) moved.push(`TRAILING ${pa.trailing}->${pb.trailing}`);
      if (moved.length) { changedPages++; rows.push(`  p${pa.page}: unprocessed ${pa.unprocessedProse}->${pb.unprocessedProse}  ${moved.join(", ")}`); }
    }
  }
  for (const c of new Set([...Object.keys(a.totals), ...Object.keys(b.totals)])) {
    if (c === "whyskip") continue;
    if (a.totals[c] !== b.totals[c]) rows.push(`  ${c}: ${a.totals[c] ?? "(none)"}  ->  ${b.totals[c] ?? "(none)"}`);
  }
  const va = a.verdict.replace(/^\S+\s/, ""), vb = b.verdict.replace(/^\S+\s/, "");
  if (va !== vb) rows.push(`  verdict: ${va}  ->  ${vb}`);
  if (rows.length) changedDocs++;
  if (rows.length || ALL) console.log(`${id}${rows.length ? "" : ": no change"}`);
  for (const r of rows) console.log(r);
}
for (const o of only) console.log(o);
console.log(`=== ${both.length} documents compared, ${pagesSeen} pages: ${changedDocs} document(s) and ${changedPages} page(s) changed ===`);
