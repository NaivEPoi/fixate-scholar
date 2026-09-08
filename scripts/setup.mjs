// `npm run setup` — bring a checkout to a runnable state, fetching only what is
// actually missing.
//
// Everything under extension/vendor/ is git-ignored and downloaded per machine:
// the PDF.js viewer (~22 MB), the bundled reading fonts, and the English word
// list the copy reflow builds from SCOWL. `npm run fetch-pdfjs` gets all of it
// unconditionally, which is right for a release build and wrong for everyday
// use — a fresh worktree, an interrupted fetch, or a vendor tree copied from
// another checkout usually needs one piece, not all three, and re-downloading
// PDF.js to obtain a 1 MB word list is a bad trade.
//
// So this checks each dependency and fetches only the gaps, then verifies the
// PDF.js source patches and applies any that are absent (the same repair
// `check-vendor.mjs --fix` does — a tree can arrive with only SOME of them, and
// nothing else notices). Safe to run at any time; it is a no-op on a complete
// tree.
//
//   node scripts/setup.mjs            fetch what is missing
//   node scripts/setup.mjs --force    re-fetch everything
//   node scripts/setup.mjs --check    report only, exit 1 if anything is missing

import { existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FONTS,
  FONT_WEIGHTS,
  download,
  extract,
  fetchFonts,
  fetchWordList,
  patch,
  vendorDir,
  verify,
} from "./fetch-pdfjs.mjs";
import { PATCHES, missingPatches } from "./pdfjs-patches.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const checkOnly = process.argv.includes("--check");

/** A dependency is "present" only if every file it owns is there AND non-empty:
 *  an interrupted download leaves a 0-byte file, which existsSync happily
 *  accepts and the viewer then fails on. */
const has = (...parts) => {
  const p = join(root, ...parts);
  try {
    return statSync(p).size > 0;
  } catch {
    return false;
  }
};

const DEPS = [
  {
    name: "PDF.js viewer",
    where: "extension/vendor/pdfjs",
    // The build plus the two files the extension actually loads — a half-
    // extracted tree has viewer.html and nothing behind it.
    present: () =>
      has("extension", "vendor", "pdfjs", "web", "viewer.html") &&
      has("extension", "vendor", "pdfjs", "build", "pdf.mjs") &&
      has("extension", "vendor", "pdfjs", "build", "pdf.worker.mjs"),
    fetch: async () => {
      await download();
      verify();
      extract();
    },
  },
  {
    name: "reading fonts",
    where: "extension/vendor/fonts",
    present: () =>
      FONTS.every((f) =>
        FONT_WEIGHTS.every((w) =>
          has("extension", "vendor", "fonts", f.out.replace("{w}", w)),
        ),
      ),
    fetch: fetchFonts,
  },
  {
    name: "English word list",
    where: "extension/vendor/words",
    present: () => has("extension", "vendor", "words", "english.txt"),
    fetch: fetchWordList,
  },
];

const missing = DEPS.filter((d) => force || !d.present());

if (checkOnly) {
  for (const d of DEPS) {
    console.log(`${d.present() ? "ok     " : "MISSING"} ${d.name} (${d.where})`);
  }
  // Only ask about patches once there is a tree to patch: missingPatches reads
  // the vendored files, and on a fresh clone there are none to read.
  const gaps = existsSync(join(vendorDir, "web", "viewer.html")) ? missingPatches(vendorDir) : [];
  if (gaps.length) {
    console.log(`MISSING ${gaps.length} of ${PATCHES.length} PDF.js patches: ${gaps.map((p) => p.marker).join(", ")}`);
  } else if (existsSync(join(vendorDir, "web", "viewer.html"))) {
    console.log(`ok      PDF.js patches (${PATCHES.length}/${PATCHES.length})`);
  }
  const bad = missing.length || gaps.length;
  console.log(bad ? "\nRun `npm run setup`." : "\nNothing to fetch.");
  process.exit(bad ? 1 : 0);
}

for (const d of DEPS) {
  if (!missing.includes(d)) {
    console.log(`present: ${d.name} (${d.where})`);
    continue;
  }
  console.log(`fetching: ${d.name} …`);
  await d.fetch();
}

// Always, even when nothing was fetched: a vendor tree that was copied from
// another checkout, or re-extracted by hand, can carry the files and not the
// edits. applyPatch is idempotent and reports the ones already in.
const patched = existsSync(join(vendorDir, "web", "viewer.html")) ? patch() : 0;

const did = [];
if (missing.length) did.push(missing.map((d) => d.name).join(", "));
if (patched) did.push(`${patched} PDF.js patch${patched === 1 ? "" : "es"}`);
console.log(
  did.length
    ? `\nFetched/repaired: ${did.join("; ")}.\nLoad the ./extension directory as an unpacked extension.`
    : "\nEverything was already in place.",
);
