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

Real papers covering **five templates**, used by the multi-template smoke test.
Templates were identified from the PDFs themselves — page box, body size,
leading, column extents, embedded fonts, publisher boilerplate, heading style.

Several templates are represented by more than one paper; the parenthesized part
of a label is that paper's COVERAGE VARIANT, not another template. The three
USENIX papers measure identically (612x792, 10pt body / 12pt leading, columns
54–296 + 318–560, Nimbus Roman + Nimbus Sans), as do the two ACM ones (9pt/11,
Libertine/Biolinum) — they are kept because their CONTENT differs, which is what
the structural rules actually key on. Hosting is not a template either: the last
three are arXiv preprints, each typeset in one of these same templates (their
arXiv side stamp is its own hazard, covered either way).

| Template | Variant | Identified by | URL |
|---|---|---|---|
| USENIX | baseline | proceedings cover page; 21pp, plain body/figures | https://yilud.me/usenixsecurity25-dong-yilu.pdf |
| USENIX | code + algorithms | same layout; LMMono code, algorithm listings, dense tables, appendix — the probe workhorse | https://yilud.me/usenixsecurity24-tu.pdf |
| USENIX | no cover page | same layout; front matter starts on page 1 | https://yilud.me/AFC_Attacks_NSDI.pdf |
| ACM acmart | full | Linux Libertine/Biolinum, ACM Reference Format, CCS Concepts, ISBN/DOI | https://yilud.me/Proteus-ccs24.pdf |
| ACM acmart | short | same acmart boilerplate, 6-page short paper | https://yilud.me/SIB-Auth.pdf |
| IEEE (IEEEtran) | conference, stamped | "Abstract—", "Index Terms—", "I. INTRODUCTION", no running head; stamp overlay | https://yilud.me/a33-dong%20stamped.pdf |
| IEEE (IEEEtran) | journal | "Member, IEEE" byline, running head with page number | https://arxiv.org/pdf/2502.04915 |
| NeurIPS | — | own style file: single column Times, block 108–506, 10pt/11, NeurIPS footer | https://arxiv.org/pdf/1706.03762 |
| LaTeX article | Computer Modern | plain single column, block 116–496, running heads, no publisher boilerplate | https://arxiv.org/pdf/quant-ph/9508027 |

`node test/debug-refs.mjs <pdf-url>` dumps heading candidates and surrounding
extracted lines when reference parsing misbehaves on a new paper.

## Reference-parse regressions (R26)

Public two-column IEEEtran-family papers that got NO citation layer at all
before R26 — the whole feature silently off, not merely a wrong card. Each is
`node test/citeaudit.mjs <url>`, which must report `jumpCites=0 noHit=0
unresolved=0` on every page.

| Paper | Was | Now |
|---|---|---|
| https://arxiv.org/pdf/2510.27394 | heading extracted as "EFERENCES" (small-caps "R" pulled into the other column's row) → 0 entries, 0/180 citations | 47 entries, 180/180 |
| https://arxiv.org/pdf/2603.06158 | same defect (45MB — allow a long settle before auditing) → 0 entries, 0/112 | 40 entries, 112/112 |
| https://arxiv.org/pdf/2511.09227 | the same cross-column bleed truncating the BODY → 20 entries, 44/178 | 65 entries, 178/178 |
| https://arxiv.org/pdf/2511.00919 | a figure caption at the top of the next column ended the bibliography → 1 entry, 3/104 | 39 entries, 104/104 |

Known gap: a Chinese-language paper (https://arxiv.org/pdf/2601.18473, heading
"参考文献:") still parses nothing — the heading vocabulary is English-only.

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
node test/e2e.mjs                 # or: FX_BROWSER=/path/to/msedge node test/e2e.mjs
```

Manual loading via chrome://extensions → "Load unpacked" works fine in regular
Chrome; the flag removal only affects command-line loading.
