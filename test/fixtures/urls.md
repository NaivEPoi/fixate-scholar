# Manual test matrix

| Case | URL | Expect |
|---|---|---|
| Content-type-only PDF (no .pdf extension), numeric citations | https://arxiv.org/pdf/1706.03762 | Opens in FixatePDF, bolding + citation popups |
| APA author-year citations | any psychology paper PDF, e.g. via Google Scholar | (Author, year) popups resolve |
| Attachment disposition | a link served with `Content-Disposition: attachment` | Opens in FixatePDF (no auto-download); save via the toolbar download button |
| Local file | file:///C:/...some.pdf (needs "Allow access to file URLs") | Opens in FixatePDF |
| Google Scholar results | scholar.google.com → click a [PDF] link | Opens in FixatePDF |
| Bypass | toggle "Bypass current site" in popup, reload PDF | Native viewer |
| Native escape hatch | "native" toolbar button in the viewer | Re-opens in Chrome's viewer once |

## Template corpus (automated: `node test/papers.mjs`)

Real papers covering the major academic templates, used by the multi-template
smoke test:

| Template | Paper | URL |
|---|---|---|
| USENIX Security '25 | CoreCrisis | https://yilud.me/usenixsecurity25-dong-yilu.pdf |
| USENIX Security '24 | Logic Gone Astray | https://yilud.me/usenixsecurity24-tu.pdf |
| USENIX NSDI '26 | AFC Threat Analysis | https://yilud.me/AFC_Attacks_NSDI.pdf |
| ACM CCS '24 | Proteus | https://yilud.me/Proteus-ccs24.pdf |
| ACM WiSec '25 | SIB-Auth | https://yilud.me/SIB-Auth.pdf |
| EW '25 (stamped) | AFC GPS Spoofing | https://yilud.me/a33-dong%20stamped.pdf |
| IEEE (arXiv preprint) | E2IBS | https://arxiv.org/pdf/2502.04915 |

`node test/debug-refs.mjs <pdf-url>` dumps heading candidates and surrounding
extracted lines when reference parsing misbehaves on a new paper.

The full processing rulebook these tests enforce lives in
[REQUIREMENTS.md](../../REQUIREMENTS.md). When adding a paper with a data
table, set its `tableProbe` in `test/papers.mjs` to a string known to live in
a table cell — it must never be emphasized.

Automated smoke test: `node test/e2e.mjs [path-to-browser]`.

Note: Google Chrome stable ≥137 ignores `--load-extension`, so the automated
test defaults to Chrome but should be pointed at Edge (or Chrome for Testing /
Chromium):

```
node test/e2e.mjs "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
```

Manual loading via chrome://extensions → "Load unpacked" works fine in regular
Chrome; the flag removal only affects command-line loading.
