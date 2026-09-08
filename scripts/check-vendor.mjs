// Verifies that every source edit listed in pdfjs-patches.mjs is present in the
// vendored PDF.js build. Run by `npm test`.
//
// extension/vendor/ is git-ignored: the build is fetched per machine, so it can
// end up with only some patches applied and no error anywhere. That is not
// hypothetical — patch 5 (the drag-selection endOfContent fix, REVIEW_FINDINGS
// R16-1) was missing from a working tree, and selection regressed to "I can
// only select the bolded part of a word" with every automated check still green.
//
//   node scripts/check-vendor.mjs         report, exit 1 if anything is missing
//   node scripts/check-vendor.mjs --fix   re-apply what is missing, in place
//
// --fix needs no network: the vendored files are already there, only the edits
// are absent. A missing vendor directory is not a failure (unit tests run
// without it) — it just says to run `npm run setup`.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PATCHES, applyPatch, missingPatches } from "./pdfjs-patches.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(root, "extension", "vendor", "pdfjs");
const fix = process.argv.includes("--fix");

if (!existsSync(join(vendorDir, "web", "viewer.html"))) {
  console.log("No vendored PDF.js — run `npm run setup`. Skipping patch check.");
  process.exit(0);
}

// Same failure shape, different file: a vendor tree from before the word list
// existed has no extension/vendor/words, and the copy reflow then quietly falls
// back to its shape rules for every hyphen it cannot decide. Nothing else says
// so. Not fatal — the reader works, and `--fix` cannot conjure a download — but
// it must be said out loud.
if (!existsSync(join(root, "extension", "vendor", "words", "english.txt"))) {
  console.log(
    "No vendored word list (extension/vendor/words) — hyphen repair on copy falls\n" +
      "back to the document's own vocabulary. Run `npm run setup` to add it.",
  );
}

const missing = missingPatches(vendorDir);
if (!missing.length) {
  console.log(`Vendored PDF.js patch check passed (${PATCHES.length}/${PATCHES.length}).`);
  process.exit(0);
}

if (!fix) {
  console.error(
    `Vendored PDF.js is MISSING ${missing.length} of ${PATCHES.length} patches:\n  ` +
      missing.map((p) => `${p.file} — ${p.marker}`).join("\n  ") +
      `\n\nThe viewer is built but misbehaving in ways no unit test sees.` +
      `\nFix in place:  node scripts/check-vendor.mjs --fix` +
      `\nOr:            npm run setup`,
  );
  process.exit(1);
}

for (const p of missing) {
  console.log(`${applyPatch(vendorDir, p)}: ${p.file} — ${p.marker}`);
}
const left = missingPatches(vendorDir);
if (left.length) {
  console.error(`Still missing after --fix: ${left.map((p) => p.marker).join(", ")}`);
  process.exit(1);
}
console.log("All patches applied.");
