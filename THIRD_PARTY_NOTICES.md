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

## Reference lookup services

No code from these services is bundled or redistributed here. They are queried
over the network, one query per citation the reader clicks, and each response is
shown to that reader as their own lookup result. They are listed so it is clear
whose service is being asked and under whose terms.

FixateScholar is an independent project and is **not affiliated with, endorsed
by, sponsored by, or connected to** any of them. Each name and mark belongs to
its owner and is used here only to identify the service (see `TRADEMARKS.md`).
Each may change, restrict or discontinue access at any time; when one does, the
citation card falls back to the next source, or to the document's own
bibliography entry.

| Service | Endpoint | Terms | Notes |
|---|---|---|---|
| **Google Scholar** | `scholar.google.com/scholar` | [Google Terms of Service](https://policies.google.com/terms) | No public API; the result page is parsed. Answers only requests carrying the reader's own Google cookies, so a lookup is part of that reader's Google session. The default source, and switchable off in Options — see the Privacy section of `README.md`. |
| **arXiv** | `export.arxiv.org/api/query` | [arXiv API Terms of Use](https://info.arxiv.org/help/api/tou.html) | Public API, no key. Metadata under [CC0 1.0](https://info.arxiv.org/help/api/tou.html); abstracts belong to their authors. |
| **Crossref** | `api.crossref.org` | [Crossref REST API terms](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) | Public API, no key. Metadata is openly available; the "Cite" BibTeX comes from Crossref content negotiation. |
| **OpenAlex** | `api.openalex.org` | [OpenAlex terms](https://openalex.org/terms) | Public API, no key. Data released as [CC0](https://docs.openalex.org/additional-help/faq). |
| **OpenAIRE** | `api.openaire.eu` | [OpenAIRE terms](https://www.openaire.eu/terms) | Public search API, no key. Aggregates repository and DBLP records, including the venues that register no DOI. |

Titles, authors, abstracts, citation counts and links shown on a citation card
are the property of the respective publishers, authors and services. They are
fetched at the reader's request, displayed to that reader, and not stored beyond
a local cache on their own machine (30 days for a match, 7 for a miss),
clearable from the extension's options page.
