// The exact source edits made to the vendored PDF.js build, in ONE place so
// that fetch-pdfjs.mjs can apply them and check-vendor.mjs can verify them.
//
// extension/vendor/ is git-ignored, so a vendored tree can arrive on a machine
// with only SOME of these applied — a re-extract, an interrupted fetch, a
// restored backup — and until now nothing said so. Patch 5 went missing exactly
// that way and drag-selection silently regressed to "I can only select the
// bolded part of a word", the very bug it exists to fix. `npm test` verifies
// every marker now, and `node scripts/check-vendor.mjs --fix` re-applies what
// is missing without re-downloading.
//
// Each entry: the vendored file, an exact anchor, its replacement, and a MARKER
// present once applied — used both to skip an already-patched file and to
// verify one. Anchors fail loudly, so a version bump can never silently produce
// a broken viewer.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PATCHES = [
  {
    // Don't reject cross-origin ?file= URLs (we run on chrome-extension://).
    // The generic build only whitelists the hosted-viewer origins;
    // host_permissions <all_urls> makes this safe.
    file: "web/viewer.mjs",
    anchor: `if (HOSTED_VIEWER_ORIGINS.has(viewerOrigin)) {`,
    replacement: `if (viewerOrigin.startsWith("chrome-extension:") /* fixate-scholar-patch-1: extension pages may load cross-origin PDFs */ || HOSTED_VIEWER_ORIGINS.has(viewerOrigin)) {`,
    marker: "fixate-scholar-patch-1",
  },
  {
    // Load the overlay (typography engine, references, toolbar buttons).
    file: "web/viewer.html",
    anchor: `</head>`,
    replacement: `  <link rel="stylesheet" href="../../../viewer/overlay.css"><!-- fixate-scholar-patch-2 -->\n  <script src="../../../viewer/overlay.mjs" type="module"></script>\n</head>`,
    marker: "fixate-scholar-patch-2",
  },
  {
    // Allow the viewer to fetch local file:// PDFs (when the user has enabled
    // "Allow access to file URLs"). The stock connect-src uses `*`, which
    // covers network schemes but NOT file:, so a file:// fetch is otherwise
    // blocked by CSP and the document fails to load.
    file: "web/viewer.html",
    anchor: `connect-src * blob: data:;`,
    replacement: `connect-src * blob: data: file:;`,
    marker: `connect-src * blob: data: file:`,
  },
  {
    // Allow inline style="…" ATTRIBUTES on the viewer page. The stock CSP only
    // allows inline <style> ELEMENTS (style-src-elem) and leaves style-src-attr
    // to fall back to `style-src 'self'`, which blocks inline style attributes —
    // some Chromium builds apply one during page layout (annotation / print code
    // paths), logging "Applying inline style violates … style-src 'self'". Safe
    // on this trusted page: it renders only the user's own PDF (text → canvas
    // and textContent, never innerHTML, so a PDF can't inject DOM/styles) and
    // script-src 'self' already blocks injected scripts.
    file: "web/viewer.html",
    anchor: `style-src-elem 'self' 'unsafe-inline';`,
    replacement: `style-src-elem 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline';`,
    marker: `style-src-attr 'unsafe-inline'`,
  },
  {
    // Don't let the drag-selection helper move `.endOfContent` INSIDE a text
    // span. On every selectionchange TextLayerBuilder walks the selection edge
    // up from its text node and relocates the full-size, user-select:text
    // `.endOfContent` div next to it — assuming the result is a direct child of
    // the .textLayer. It normalizes exactly one level, plus one more for its OWN
    // <span class="highlight"> wrapper: proof the assumption breaks on nesting.
    // Reading mode nests too (<b class="fx-b"> emphasis, .fx-cite-c/.fx-ref-c
    // citation wrappers), so a drag whose edge lands inside a bold prefix
    // splices that layer-sized div into the middle of a word. It then wins every
    // hit-test over the span, the drag can't reach the rest of the line, and the
    // copy loses the non-bold tails. Climb out of ANY wrapper instead — a
    // superset of the stock .highlight hop, so PDF.js's own find-match case
    // keeps working. Upstream bug; report it.
    file: "web/viewer.mjs",
    anchor: `      if (anchor.classList?.contains("highlight")) {
        anchor = anchor.parentNode;
      }`,
    replacement: `      /* fixate-scholar-patch-5: climb out of every nested wrapper (PDF.js's
         own .highlight, our <b class="fx-b"> emphasis and .fx-cite-c/.fx-ref-c
         citation spans) so endDiv is never inserted inside a text span. */
      while (
        anchor.parentElement &&
        !anchor.parentElement.classList.contains("textLayer")
      ) {
        anchor = anchor.parentElement;
      }`,
    marker: "fixate-scholar-patch-5",
  },
  {
    // Re-encode ?file= BEFORE viewer.mjs reads it. The DNR redirect that brings
    // us here cannot percent-encode the URL it substitutes, and PDF.js parses
    // the query with URLSearchParams — so a PDF link carrying more than one
    // query parameter loses everything from the first `&`. This tag must sit
    // AHEAD of viewer.mjs: module scripts run in document order, and PDF.js
    // calls run() during its own evaluation (readyState is already
    // "interactive" by then), so overlay.mjs — which patch 2 appends after it —
    // can never win that race. See extension/viewer/file-param.mjs.
    file: "web/viewer.html",
    anchor: `  <script src="viewer.mjs" type="module"></script>`,
    replacement: `  <script src="../../../viewer/file-param.mjs" type="module"></script><!-- fixate-scholar-patch-6 -->
  <script src="viewer.mjs" type="module"></script>`,
    marker: "fixate-scholar-patch-6",
  },
  {
    // Turn PDF.js's comment feature ON. The build ships it complete — a
    // comment on a highlight, a standalone sticky note, the comments sidebar,
    // and /Contents written into the saved file — but behind a preference that
    // defaults to false, so the toolbar button stays hidden and
    // PDFViewerApplication builds no CommentManager at all. Reviewing a paper
    // is exactly what this viewer is for, and a highlight you cannot say
    // anything about is half the tool. Flipping the DEFAULT (rather than
    // writing a stored preference) keeps it on for every profile the extension
    // is loaded into, including the throwaway ones the harnesses spawn.
    file: "web/viewer.mjs",
    anchor: `  enableComment: {
    value: false,`,
    replacement: `  enableComment: {
    /* fixate-scholar-patch-7: comments on highlights, on by default */
    value: true,`,
    marker: "fixate-scholar-patch-7",
  },
  {
    // Write an AUTHOR onto saved annotations. Every markup annotation the
    // worker writes takes its /T from the serialized editor's `user` field —
    // and nothing in the viewer ever sets it, so a highlight or comment saved
    // by PDF.js arrives in Acrobat, Preview or Foxit with an empty author.
    // That is fine for a private highlight and wrong for a review comment,
    // which is read by someone who needs to know whose it is. The name comes
    // from the options page (overlay.mjs publishes it as fxAnnotationAuthor);
    // unset leaves the field undefined, which is exactly the old behavior.
    file: "build/pdf.mjs",
    anchor: `      structTreeParentId: this._structTreeParentId,
      popupRef: this._initialData?.popupRef || ""`,
    replacement: `      structTreeParentId: this._structTreeParentId,
      /* fixate-scholar-patch-8: author name for saved annotations (/T) */
      user: globalThis.fxAnnotationAuthor || undefined,
      popupRef: this._initialData?.popupRef || ""`,
    marker: "fixate-scholar-patch-8",
  },
  {
    // Turn PDF.js's highlight floating button (highlight & comment toolbar) ON.
    // When text is selected in the viewer, a floating toolbar appears with
    // a highlight button and a comment button, allowing the user to highlight
    // or immediately attach a comment to the highlighted selection.
    file: "web/viewer.mjs",
    anchor: `  enableHighlightFloatingButton: {
    value: false,`,
    replacement: `  enableHighlightFloatingButton: {
    /* fixate-scholar-patch-9: floating highlight and comment buttons on selection */
    value: true,`,
    marker: "fixate-scholar-patch-9",
  },
];

/** Apply one patch in `vendorDir`. Idempotent; throws if the anchor is gone. */
export function applyPatch(vendorDir, { file, anchor, replacement, marker }, version = "") {
  const path = join(vendorDir, file);
  const text = readFileSync(path, "utf8");
  if (text.includes(marker)) return "already-applied";
  if (!text.includes(anchor)) {
    throw new Error(
      `PATCH ANCHOR NOT FOUND in ${file}.\n` +
        `PDF.js ${version} changed; update the anchor in scripts/pdfjs-patches.mjs.\n` +
        `Anchor: ${anchor}`,
    );
  }
  writeFileSync(path, text.replace(anchor, replacement));
  return "patched";
}

/** The patches whose marker is absent from `vendorDir`. */
export function missingPatches(vendorDir) {
  return PATCHES.filter((p) => {
    const text = readFileSync(join(vendorDir, p.file), "utf8");
    return !text.includes(p.marker);
  });
}
