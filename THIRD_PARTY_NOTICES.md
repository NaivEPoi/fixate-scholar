# Third-party notices

## Fonts

The optional reading fonts vendored into `extension/vendor/fonts/` by
`scripts/fetch-pdfjs.mjs` are licensed under the SIL Open Font License 1.1
(https://openfontlicense.org):

- **Atkinson Hyperlegible** — Copyright Braille Institute of America, Inc.
- **Inter** — Copyright The Inter Project Authors (rsms.me/inter)
- **Literata** — Copyright The Literata Project Authors

## English word list

The word list vendored into `extension/vendor/words/english.txt` by
`scripts/fetch-pdfjs.mjs` is **SCOWL** (Spell Checker Oriented Word Lists),
taken from the `wordlist-english` npm package (every frequency band it ships,
10–70; plain alphabetic entries only). It is used only to decide whether a
hyphen at a line break was splitting one word or joining two.

> The collective work is Copyright 2000-2016 by Kevin Atkinson.
>
> Permission to use, copy, modify, distribute and sell these word lists, the
> associated scripts, the output created from the scripts, and its documentation
> for any purpose is hereby granted without fee, provided that the above
> copyright notice appears in all copies and that both that copyright notice and
> this permission notice appear in supporting documentation. Kevin Atkinson
> makes no representations about the suitability of this array for any purpose.
> It is provided "as is" without express or implied warranty.

The full notice, including the credits for the sources SCOWL itself draws on, is
vendored alongside the list as `extension/vendor/words/COPYRIGHT`.

## PDF.js

This extension vendors the prebuilt generic viewer of
[PDF.js](https://github.com/mozilla/pdf.js) (version pinned in
`scripts/fetch-pdfjs.mjs`) into `extension/vendor/pdfjs/`.

PDF.js is Copyright Mozilla Foundation and contributors, licensed under the
Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0

The vendoring script applies a few small, marked patches to the viewer
(`fixate-scholar-patch-1`, `fixate-scholar-patch-2`, and a CSP `connect-src`
addition for `file:`); see `scripts/fetch-pdfjs.mjs` for the exact changes.
The upstream `LICENSE` file is preserved inside `extension/vendor/pdfjs/`.
