// Downloads the pinned PDF.js prebuilt generic viewer, verifies its hash,
// extracts it to extension/vendor/pdfjs/, and applies a few small patches:
//   1. viewer.mjs  — allow ?file=<cross-origin url> when running from a
//      chrome-extension:// origin (the generic build only whitelists the
//      hosted-viewer origins; host_permissions <all_urls> makes this safe).
//   2. viewer.html — load our overlay module/styles after the stock viewer.
//   3/4. viewer.html — widen the CSP for file:// PDFs and inline style attrs.
//   5. viewer.mjs  — keep the drag-selection helper's `.endOfContent` out of
//      the text spans, which reading mode's markup nests inside.
//
// Patches use exact string anchors and fail loudly if PDF.js changes them,
// so a version bump can never silently produce a broken viewer.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PATCHES, applyPatch } from "./pdfjs-patches.mjs";

const PDFJS_VERSION = "6.0.227";
// sha256 of pdfjs-6.0.227-dist.zip; recomputed and printed on every run.
// Set to null to accept any hash (first fetch of a new version), then pin it.
const PINNED_SHA256 = "f94782e933ce03a101bb5a5f032f0b275458184a07d0b52434dca759c0a0afaa";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(root, "extension", "vendor", "pdfjs");
const zipUrl = `https://github.com/mozilla/pdf.js/releases/download/v${PDFJS_VERSION}/pdfjs-${PDFJS_VERSION}-dist.zip`;
const zipPath = join(tmpdir(), `pdfjs-${PDFJS_VERSION}-dist.zip`);

async function download() {
  if (existsSync(zipPath)) {
    console.log(`Using cached ${zipPath}`);
    return;
  }
  console.log(`Downloading ${zipUrl} ...`);
  const res = await fetch(zipUrl);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
}

function verify() {
  const hash = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
  console.log(`sha256: ${hash}`);
  if (PINNED_SHA256 && PINNED_SHA256 !== "PLACEHOLDER_TO_BE_PINNED" && hash !== PINNED_SHA256) {
    rmSync(zipPath);
    throw new Error(`sha256 mismatch! expected ${PINNED_SHA256}. Cached zip deleted; re-run to re-download.`);
  }
}

function extract() {
  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });
  const extractTmp = join(tmpdir(), `pdfjs-extract-${PDFJS_VERSION}`);
  rmSync(extractTmp, { recursive: true, force: true });
  if (process.platform === "win32") {
    execFileSync("powershell.exe", [
      "-NoProfile", "-Command",
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${extractTmp}" -Force`,
    ]);
  } else {
    mkdirSync(extractTmp, { recursive: true });
    execFileSync("unzip", ["-q", zipPath, "-d", extractTmp]);
  }
  cpSync(extractTmp, vendorDir, { recursive: true });
  rmSync(extractTmp, { recursive: true, force: true });
  console.log(`Extracted to ${vendorDir}`);
}


// Reading-friendly free fonts (all SIL OFL) offered as alternatives to the
// document's embedded fonts. Vendored from the @fontsource npm packages via
// jsDelivr; the exact resolved version is logged for traceability.
const FONTS = [
  { pkg: "@fontsource/atkinson-hyperlegible", file: "atkinson-hyperlegible-latin-{w}-normal.woff2", out: "atkinson-{w}.woff2" },
  { pkg: "@fontsource/inter", file: "inter-latin-{w}-normal.woff2", out: "inter-{w}.woff2" },
  { pkg: "@fontsource/literata", file: "literata-latin-{w}-normal.woff2", out: "literata-{w}.woff2" },
];
const FONT_WEIGHTS = ["400", "700"];

// The English word list the copy reflow consults when it has to decide whether
// a line-break hyphen was splitting one word ("infor- mation") or joining two
// ("well- known"). SCOWL, via the `wordlist-english` npm package: its lists are
// CUMULATIVE size bands, 10 = the 1000 commonest words, 95 = every obscurity.
//
// Measured over 20 papers — 1315 line-final hyphens the shape rules alone
// cannot settle, of which the document's own vocabulary settles 959:
//
//   band | words | unpacked | in the .zip | of the remaining 356 it settles
//   -----|-------|----------|-------------|-------------------------------
//     20 |  10.9k|    89 KB |       29 KB | 203
//     35 |    39k|   340 KB |      100 KB | 255
//     50 |    61k|   559 KB |      160 KB | 268
//     60 |    77k|   712 KB |      200 KB | 275
//     70 |   111k|  1.04 MB |      302 KB | 285   <- shipped, every band there is
//
// Everything, because compressed it is still only ~300 KB of a ~7 MB package.
// The extra bands buy more than the 17 decisions: the list decides "keep the
// hyphen" when BOTH pieces are words and it does not know the closed compound,
// so every closed compound it learns is a wrong keep removed ("sub-sequences"
// becomes "subsequences" at 70). What no general English dictionary carries at
// any size is the technical compound — "baseband", "hyperparameter", "dataset" —
// and those are the document's own vocabulary's job.
//
// 70 is the top of this package, and of SCOWL's sane range: its 80 and 95 tiers
// are explicitly "questionable", carrying misspellings and scannos that would
// make the both-pieces-are-words test fire on nonsense.
const WORDLIST_PKG = "wordlist-english@1.2.1";
const WORDLIST_BANDS = [10, 20, 35, 40, 50, 55, 60, 70];

async function fetchWordList() {
  const outDir = join(root, "extension", "vendor", "words");
  mkdirSync(outDir, { recursive: true });
  const words = new Set();
  for (const band of WORDLIST_BANDS) {
    // english-* is the shared core; american-* adds the US spellings.
    for (const kind of ["english", "american"]) {
      const url = `https://cdn.jsdelivr.net/npm/${WORDLIST_PKG}/${kind}-words-${band}.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Word list download failed (${res.status}): ${url}`);
      for (const w of await res.json()) {
        const t = String(w).toLowerCase();
        // Plain alphabetic words only. A line-break hyphen can only ever
        // produce those, and dropping the rest (possessives, accents) halves
        // the file.
        if (/^[a-z]{2,}$/.test(t)) words.add(t);
      }
    }
  }
  // Sorted, newline-delimited, with a leading and trailing newline: the viewer
  // holds it as ONE string and tests membership with `includes("\n" + w + "\n")`,
  // which costs the file's own size in memory instead of the ~7x a Set of that
  // many short strings would.
  const text = "\n" + [...words].sort().join("\n") + "\n";
  writeFileSync(join(outDir, "english.txt"), text, "utf8");
  const notice = await fetch(`https://cdn.jsdelivr.net/npm/${WORDLIST_PKG}/Copyright`);
  if (!notice.ok) throw new Error(`SCOWL copyright download failed (${notice.status})`);
  writeFileSync(join(outDir, "COPYRIGHT"), await notice.text(), "utf8");
  console.log(
    `Word list vendored to ${outDir}: ${words.size} words, ${(text.length / 1024).toFixed(0)} KB` +
      ` (SCOWL bands ${WORDLIST_BANDS.join("+")})`,
  );
}

async function fetchFonts() {
  const fontsDir = join(root, "extension", "vendor", "fonts");
  mkdirSync(fontsDir, { recursive: true });
  for (const font of FONTS) {
    const pkgMeta = await (await fetch(`https://cdn.jsdelivr.net/npm/${font.pkg}@5/package.json`)).json();
    console.log(`${font.pkg}@${pkgMeta.version}`);
    for (const w of FONT_WEIGHTS) {
      const url = `https://cdn.jsdelivr.net/npm/${font.pkg}@${pkgMeta.version}/files/${font.file.replace("{w}", w)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Font download failed (${res.status}): ${url}`);
      writeFileSync(join(fontsDir, font.out.replace("{w}", w)), Buffer.from(await res.arrayBuffer()));
    }
  }
  console.log(`Fonts vendored to ${fontsDir}`);
}

await download();
verify();
extract();
await fetchFonts();
await fetchWordList();

// The edits themselves live in pdfjs-patches.mjs, shared with
// scripts/check-vendor.mjs so `npm test` can verify a vendored tree still has
// them (extension/vendor/ is git-ignored, and a tree missing one looks fine
// until a user reports the symptom).
for (const p of PATCHES) {
  console.log(`${applyPatch(vendorDir, p, PDFJS_VERSION)}: ${p.file} — ${p.marker}`);
}

console.log("Done. Load the ./extension directory as an unpacked extension.");
