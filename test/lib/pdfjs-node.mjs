// Running the SHIPPING extractor + parser over a PDF straight from Node — no
// browser, no extension, seconds per paper.
//
// pdf.js's browser build is what the extension vendors, and it touches a few
// DOM globals at import time. Text extraction needs none of their behavior, so
// stubs are enough — and using the vendored build (rather than a second copy
// from npm) is the point: this measures what actually ships.
//
// Lives here because two harnesses need the same bootstrap: refparse.mjs
// (breadth over the parse) and citelookup.mjs (breadth over the Scholar
// lookup). A second copy of the stub list is a second thing to forget when a
// pdf.js upgrade touches one of them.

import { mkdtempSync, readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { root } from "./env.mjs";

class Matrix {
  constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
  multiplySelf() { return this; }
  translateSelf() { return this; }
  scaleSelf() { return this; }
  invertSelf() { return this; }
  transformPoint(p) { return p; }
}

const vendor = join(root, "extension", "vendor", "pdfjs");

/**
 * The vendored pdf.js, with the DOM globals its browser build expects stubbed
 * in. Exits(2) with the one instruction that fixes it when the vendor tree is
 * missing — a fresh clone (or a fresh worktree) has no `extension/vendor`, and
 * the raw failure is an unrelated-looking module error.
 */
export async function loadPdfjs() {
  globalThis.DOMMatrix ??= Matrix;
  globalThis.Path2D ??= class { addPath() {} };
  globalThis.ImageData ??= class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
  // Newer array/Math methods pdf.js uses that older Node releases lack.
  Uint8Array.prototype.toHex ??= function () { return Buffer.from(this).toString("hex"); };
  Uint8Array.fromHex ??= (h) => new Uint8Array(Buffer.from(h, "hex"));
  Uint8Array.prototype.toBase64 ??= function () { return Buffer.from(this).toString("base64"); };
  Uint8Array.fromBase64 ??= (b) => new Uint8Array(Buffer.from(b, "base64"));
  Math.sumPrecise ??= (xs) => [...xs].reduce((a, b) => a + b, 0);

  let pdfjs;
  try {
    pdfjs = await import(pathToFileURL(join(vendor, "build", "pdf.mjs")).href);
  } catch {
    console.error("extension/vendor/pdfjs is missing — run `npm run fetch-pdfjs` first.");
    process.exit(2);
  }
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(vendor, "build", "pdf.worker.mjs")).href;
  return pdfjs;
}

/** The extension's own reference modules, loaded from the source tree. */
export async function loadReferenceModules() {
  const mod = (f) =>
    import(pathToFileURL(join(root, "extension", "viewer", "references", f)).href);
  const [extractor, parser] = await Promise.all([mod("extractor.mjs"), mod("parser.mjs")]);
  return { ...extractor, ...parser };
}

/** One PDF → a pdf.js document, with the vendored standard fonts. */
export async function openPdf(pdfjs, path) {
  return pdfjs.getDocument({
    data: new Uint8Array(readFileSync(path)),
    standardFontDataUrl: join(vendor, "web", "standard_fonts") + "/",
  }).promise;
}

/**
 * Targets (files, directories, http URLs, in any mix) → `{path, name}` list.
 * URLs are downloaded into a temp dir the OS reclaims.
 */
export async function resolveTargets(targets) {
  const files = [];
  let downloads = null;
  for (const t of targets) {
    if (/^https?:/i.test(t)) {
      downloads ??= mkdtempSync(join(tmpdir(), "fx-pdf-"));
      const dest = join(downloads, `${files.length}-${basename(new URL(t).pathname) || "paper"}.pdf`);
      const res = await fetch(t);
      if (!res.ok) { console.log(`ERR  ${t} — HTTP ${res.status}`); continue; }
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      files.push({ path: dest, name: t });
      continue;
    }
    if (statSync(t).isDirectory()) {
      for (const f of readdirSync(t).filter((f) => f.toLowerCase().endsWith(".pdf"))) {
        files.push({ path: join(t, f), name: f });
      }
    } else {
      files.push({ path: t, name: basename(t) });
    }
  }
  return files;
}
