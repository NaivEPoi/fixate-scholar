# Third-party notices

## Fonts

The optional reading fonts vendored into `extension/vendor/fonts/` by
`scripts/fetch-pdfjs.mjs` are licensed under the SIL Open Font License 1.1
(https://openfontlicense.org):

- **Atkinson Hyperlegible** — Copyright Braille Institute of America, Inc.
- **Inter** — Copyright The Inter Project Authors (rsms.me/inter)
- **Literata** — Copyright The Literata Project Authors

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
