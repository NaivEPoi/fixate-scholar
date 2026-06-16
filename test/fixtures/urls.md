# Manual test matrix

| Case | URL | Expect |
|---|---|---|
| Content-type-only PDF (no .pdf extension), numeric citations | https://arxiv.org/pdf/1706.03762 | Opens in FixateScholar, bolding + citation popups |
| APA author-year citations | any psychology paper PDF, e.g. via Google Scholar | (Author, year) popups resolve |
| Attachment disposition | a link served with `Content-Disposition: attachment` | Opens in FixateScholar (no auto-download); save via the toolbar download button |
| Local file | file:///C:/...some.pdf (needs "Allow access to file URLs") | Opens in FixateScholar |
| Google Scholar results | scholar.google.com → click a [PDF] link | Opens in FixateScholar |
| Bypass | toggle "Bypass current site" in popup, reload PDF | Native viewer |
| Native escape hatch | "native" toolbar button in the viewer | Re-opens in Chrome's viewer once |

## Template corpus (automated: `node test/papers.mjs`)

Real papers spanning a range of common academic-paper templates (two-column
conference/journal layouts and an arXiv preprint), used by the multi-template
smoke test. The labels are intentionally template-agnostic — the rules they
exercise are based on document structure, not any specific publisher template:

| Template | URL |
|---|---|
| Two-column A | https://yilud.me/usenixsecurity25-dong-yilu.pdf |
| Two-column B (dense math, tables, algorithms, appendix) | https://yilud.me/usenixsecurity24-tu.pdf |
| Two-column C | https://yilud.me/AFC_Attacks_NSDI.pdf |
| Two-column D | https://yilud.me/Proteus-ccs24.pdf |
| Two-column E (short paper) | https://yilud.me/SIB-Auth.pdf |
| Two-column F (stamped header) | https://yilud.me/a33-dong%20stamped.pdf |
| arXiv preprint | https://arxiv.org/pdf/2502.04915 |

`node test/debug-refs.mjs <pdf-url>` dumps heading candidates and surrounding
extracted lines when reference parsing misbehaves on a new paper.

The full processing rulebook these tests enforce lives in
[REQUIREMENTS.md](../../REQUIREMENTS.md). When adding a paper with a data
table, add to its `untouched` list in `test/papers.mjs` a string known to live
in a table cell (and to `processed` a string from real body prose) — the
former must never be emphasized, the latter always.

Automated smoke test: `node test/e2e.mjs [path-to-browser]`.

Note: Google Chrome stable ≥137 ignores `--load-extension`, so the automated
test defaults to Chrome but should be pointed at Edge (or Chrome for Testing /
Chromium):

```
node test/e2e.mjs "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
```

Manual loading via chrome://extensions → "Load unpacked" works fine in regular
Chrome; the flag removal only affects command-line loading.
