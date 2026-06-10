# Third-party notices

## PDF.js

This extension vendors the prebuilt generic viewer of
[PDF.js](https://github.com/mozilla/pdf.js) (version pinned in
`scripts/fetch-pdfjs.mjs`) into `extension/vendor/pdfjs/`.

PDF.js is Copyright Mozilla Foundation and contributors, licensed under the
Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0

The vendoring script applies two small, marked patches to the viewer
(`fixate-pdf-patch-1`, `fixate-pdf-patch-2`); see `scripts/fetch-pdfjs.mjs`
for the exact changes. The upstream `LICENSE` file is preserved inside
`extension/vendor/pdfjs/`.
