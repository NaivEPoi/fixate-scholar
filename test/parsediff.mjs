// Regression check for a parser change, offline and over BOTH corpora.
//
// Writes one JSON per run (entries, citation resolution, and every parsed
// title/surname per paper); pass two of them to diff. Titles are compared, not
// just counted: a change that keeps the entry count identical can still move
// the title on half the entries, which is exactly what the lookup depends on.
//
// Private corpus: set FX_PRIVATE_DIR. Aliases only (rvNN by sorted filename) —
// no filename, title or text from those documents is printed or written, so a
// run and its JSON are safe to keep in git-ignored test/out.
//
// Usage:
//   node test/parsediff.mjs run test/out/parse-before.json     # on the OLD code
//   node test/parsediff.mjs run test/out/parse-after.json       # on the NEW code
//   node test/parsediff.mjs diff test/out/parse-{before,after}.json
import { readdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadPdfjs, loadReferenceModules, openPdf, resolveTargets } from "./lib/pdfjs-node.mjs";

const PUBLIC = [
  "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "https://yilud.me/usenixsecurity24-tu.pdf",
  "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "https://yilud.me/Proteus-ccs24.pdf",
  "https://yilud.me/SIB-Auth.pdf",
  "https://yilud.me/a33-dong%20stamped.pdf",
  "https://arxiv.org/pdf/2502.04915",
  "https://arxiv.org/pdf/1706.03762",
  "https://arxiv.org/pdf/quant-ph/9508027",
  "https://yilud.me/5GCVerif-ccs23.pdf",
  "https://yilud.me/5GShield.pdf",
  "https://yilud.me/afc_testing_DISS.pdf",
  "https://yilud.me/2026.acl-long.2136.pdf",
  "https://yilud.me/UC_Scheme.pdf",
];
const PRIVATE_DIR = process.env.FX_PRIVATE_DIR ?? "";

const [mode, a, b] = process.argv.slice(2);
if (mode === "diff") {
  const A = JSON.parse(readFileSync(a, "utf8"));
  const B = JSON.parse(readFileSync(b, "utf8"));
  let moved = 0;
  let same = 0;
  for (const key of Object.keys(A)) {
    const pa = A[key];
    const pb = B[key];
    if (!pb) { console.log(`${key}: missing in second run`); continue; }
    if (pa.entries !== pb.entries || pa.resolved !== pb.resolved || pa.cites !== pb.cites) {
      console.log(
        `${key}: entries ${pa.entries}->${pb.entries} cites ${pa.cites}->${pb.cites} resolved ${pa.resolved}->${pb.resolved}`,
      );
    }
    const n = Math.max(pa.titles.length, pb.titles.length);
    for (let i = 0; i < n; i++) {
      if (pa.titles[i] === pb.titles[i] && pa.surnames[i] === pb.surnames[i]) { same++; continue; }
      moved++;
      console.log(`${key} #${i + 1}`);
      console.log(`  - ${JSON.stringify(pa.titles[i])} / ${pa.surnames[i]}`);
      console.log(`  + ${JSON.stringify(pb.titles[i])} / ${pb.surnames[i]}`);
    }
  }
  console.log(`\n${moved} entries changed, ${same} identical.`);
  process.exit(0);
}

const pdfjs = await loadPdfjs();
const { extractLines, parseReferences, findCitations, resolveCitation } = await loadReferenceModules();
const targets = [...PUBLIC];
const aliases = new Map();
if (PRIVATE_DIR && existsSync(PRIVATE_DIR)) {
  const files = readdirSync(PRIVATE_DIR).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  files.forEach((f, i) => {
    const path = join(PRIVATE_DIR, f);
    aliases.set(path, `rv${String(i + 1).padStart(2, "0")}`);
    targets.push(path);
  });
}

const out = {};
for (const { path, name } of await resolveTargets(targets)) {
  const key = aliases.get(path) ?? name.replace(/^https:\/\//, "");
  try {
    const lines = await extractLines(await openPdf(pdfjs, path));
    const entries = parseReferences(lines);
    let cites = 0;
    let resolved = 0;
    for (const l of lines) {
      for (const c of findCitations(l.text)) {
        cites++;
        if (resolveCitation(c.keys, entries).length) resolved++;
      }
    }
    out[key] = {
      entries: entries.length,
      cites,
      resolved,
      titles: entries.map((e) => (e.title || "").slice(0, 120)),
      surnames: entries.map((e) => e.surname),
    };
    console.log(`${key.padEnd(42)} entries=${entries.length} cites=${cites} resolved=${resolved}`);
  } catch (e) {
    out[key] = { error: e.message };
    console.log(`${key.padEnd(42)} ERROR ${e.message}`);
  }
}
writeFileSync(a ?? "test/out/parse-run.json", JSON.stringify(out, null, 1));
console.log(`\nwritten to ${a ?? "test/out/parse-run.json"}`);
process.exit(0);
