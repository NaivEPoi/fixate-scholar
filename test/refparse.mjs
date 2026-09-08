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

import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

// pdf.js's browser build is what the extension vendors, and it touches a few
// DOM globals at import time. Text extraction needs none of their behavior, so
// stubs are enough — and using the vendored build (rather than a second copy
// from npm) is the point: this measures what actually ships.
class Matrix {
  constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
  multiplySelf() { return this; }
  translateSelf() { return this; }
  scaleSelf() { return this; }
  invertSelf() { return this; }
  transformPoint(p) { return p; }
}
globalThis.DOMMatrix ??= Matrix;
globalThis.Path2D ??= class { addPath() {} };
globalThis.ImageData ??= class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
// Newer array/Math methods pdf.js uses that older Node releases lack.
Uint8Array.prototype.toHex ??= function () { return Buffer.from(this).toString("hex"); };
Uint8Array.fromHex ??= (h) => new Uint8Array(Buffer.from(h, "hex"));
Uint8Array.prototype.toBase64 ??= function () { return Buffer.from(this).toString("base64"); };
Uint8Array.fromBase64 ??= (b) => new Uint8Array(Buffer.from(b, "base64"));
Math.sumPrecise ??= (xs) => [...xs].reduce((a, b) => a + b, 0);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "extension", "vendor", "pdfjs");
let pdfjs;
try {
  pdfjs = await import(pathToFileURL(join(vendor, "build", "pdf.mjs")).href);
} catch {
  console.error("extension/vendor/pdfjs is missing — run `npm run fetch-pdfjs` first.");
  process.exit(2);
}
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(vendor, "build", "pdf.worker.mjs")).href;

const { extractLines } = await import(
  pathToFileURL(join(root, "extension", "viewer", "references", "extractor.mjs")).href
);
const { parseReferences, findReferencesBody, findCitations, resolveCitation } = await import(
  pathToFileURL(join(root, "extension", "viewer", "references", "parser.mjs")).href
);

const args = process.argv.slice(2);
const LINES = args.find((a) => a.startsWith("--lines="))?.slice(8);
const targets = args.filter((a) => !a.startsWith("--"));
if (!targets.length) {
  console.error("usage: node test/refparse.mjs <pdf|dir|url> [more…] [--lines=<regex>]");
  process.exit(2);
}

// Expand directories; download URLs into a temp dir (deleted with it by the OS).
const files = [];
let downloads = null;
for (const t of targets) {
  if (/^https?:/i.test(t)) {
    downloads ??= mkdtempSync(join(tmpdir(), "fx-refparse-"));
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

globalThis.__fxDebug = true;
let zero = 0;
let low = 0;
for (const { path, name } of files) {
  try {
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(readFileSync(path)),
      standardFontDataUrl: join(vendor, "web", "standard_fonts") + "/",
    }).promise;
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
