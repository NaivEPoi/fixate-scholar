// Downloads the pinned PDF.js prebuilt generic viewer, verifies its hash,
// extracts it to extension/vendor/pdfjs/, and applies two small patches:
//   1. viewer.mjs  — allow ?file=<cross-origin url> when running from a
//      chrome-extension:// origin (the generic build only whitelists the
//      hosted-viewer origins; host_permissions <all_urls> makes this safe).
//   2. viewer.html — load our overlay module/styles after the stock viewer.
//
// Patches use exact string anchors and fail loudly if PDF.js changes them,
// so a version bump can never silently produce a broken viewer.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

function patch(file, anchor, replacement, marker) {
  const path = join(vendorDir, file);
  let text = readFileSync(path, "utf8");
  if (text.includes(marker)) {
    console.log(`Patch already applied: ${file}`);
    return;
  }
  if (!text.includes(anchor)) {
    throw new Error(
      `PATCH ANCHOR NOT FOUND in ${file}.\n` +
      `PDF.js ${PDFJS_VERSION} changed; update the anchor in scripts/fetch-pdfjs.mjs.\n` +
      `Anchor: ${anchor}`,
    );
  }
  text = text.replace(anchor, replacement);
  writeFileSync(path, text);
  console.log(`Patched ${file}`);
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

// Patch 1: don't reject cross-origin ?file= URLs (we run on chrome-extension://).
patch(
  "web/viewer.mjs",
  `if (HOSTED_VIEWER_ORIGINS.has(viewerOrigin)) {`,
  `if (viewerOrigin.startsWith("chrome-extension:") /* fixate-scholar-patch-1: extension pages may load cross-origin PDFs */ || HOSTED_VIEWER_ORIGINS.has(viewerOrigin)) {`,
  "fixate-scholar-patch-1",
);

// Patch 2: load the overlay (typography engine, references, toolbar buttons).
patch(
  "web/viewer.html",
  `</head>`,
  `  <link rel="stylesheet" href="../../../viewer/overlay.css"><!-- fixate-scholar-patch-2 -->\n  <script src="../../../viewer/overlay.mjs" type="module"></script>\n</head>`,
  "fixate-scholar-patch-2",
);

// Patch 3: allow the viewer to fetch local file:// PDFs (when the user has
// enabled "Allow access to file URLs"). The stock connect-src uses `*`, which
// covers network schemes but NOT file:, so a file:// fetch is otherwise
// blocked by CSP and the document fails to load.
patch(
  "web/viewer.html",
  `connect-src * blob: data:;`,
  `connect-src * blob: data: file:;`,
  `connect-src * blob: data: file:`,
);

// Patch 4: allow inline style="…" ATTRIBUTES on the viewer page. The stock CSP
// only allows inline <style> ELEMENTS (style-src-elem) and leaves style-src-attr
// to fall back to `style-src 'self'`, which blocks inline style attributes —
// some Chromium builds apply one during page layout (annotation / print code
// paths), logging "Applying inline style violates … style-src 'self'". Safe on
// this trusted page: it renders only the user's own PDF (text → canvas and
// textContent, never innerHTML, so a PDF can't inject DOM/styles) and
// script-src 'self' already blocks injected scripts.
patch(
  "web/viewer.html",
  `style-src-elem 'self' 'unsafe-inline';`,
  `style-src-elem 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline';`,
  `style-src-attr 'unsafe-inline'`,
);

console.log("Done. Load the ./extension directory as an unpacked extension.");
