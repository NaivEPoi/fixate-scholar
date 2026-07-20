# FixateScholar

A Chrome (Manifest V3) extension that renders PDFs — especially academic papers — with
**fixation-guided typography**: the leading portion of each word is bolded to create
visual fixation points that guide the eye, a technique that can improve reading speed
and focus, particularly for neurodivergent readers.

It is **template-agnostic**: every rule is based on document structure (font sizes,
geometry, fonts, text patterns), never a specific publisher's template, so it works
across academic paper PDFs generally — single- and two-column layouts alike.

Built on Mozilla's [PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0). No proprietary
code, fonts, or assets.

## Features

- **Fixation typography**: dynamic syllable emphasis by default — longer words get
  several leading syllables bolded, never more than half the word (first-syllable-only
  and fixed-fraction modes available) — with adjustable weight and an optional
  word-skip (saccade) interval. Text renders in the document's own embedded fonts at
  the original size and color; bundled open-source reading fonts (Atkinson
  Hyperlegible, Inter, Literata) are available as replacements. Only main body prose
  is processed — the paper title, authors and emails, section headings, math, tables,
  figures, captions, footnotes, headers/footers, and the references section are left
  exactly as set (see [REQUIREMENTS.md](REQUIREMENTS.md) for the full rulebook).
  Instant on/off toggle that restores the native rendering pixel-for-pixel.
- **Automatic PDF interception**: any PDF you navigate to (including links from Google
  Scholar, and links served as `attachment` downloads) opens in the FixateScholar viewer —
  nothing is ever saved to disk just by clicking a link; the toolbar download button
  saves a copy explicitly. Per-site bypass list, per-document "open in native viewer"
  escape hatch, and a context-menu fallback.
- **Plays well with other PDF tools**: a master **Open PDFs in FixateScholar** switch
  (popup and options) governs interception. Turn it off and PDFs open in the browser's
  built-in viewer instead — so its PDF tools (including Gemini's "ask about this PDF")
  and other PDF extensions can read them. FixateScholar interception works by redirecting
  the PDF into its own viewer page, which those tools can't see into; turning it off (or
  bypassing a site) hands the PDF back to the native viewer. The reader stays one click
  away: the toolbar's **Open this PDF in FixateScholar** button on an open PDF, or
  right-click a link → **Open in FixateScholar**.
- **References & citations** (academic papers): detects the bibliography, links in-text
  citations like `[12]`, `[1–3]`, locator forms like `[9, §5.2.2.1]` or `[26, Lemma 1]`,
  and `(Smith et al., 2020)` to their entries, and shows a hover preview of the entry.
  Citations and in-paper references (Figure/Table/Section/…) are marked in distinct,
  high-contrast colors. Clicking a citation opens a pinned, Google-Scholar-reader-style
  card — title linking to the paper, authors, abstract snippet, cited-by, and actions for
  **[PDF]**, **Cite** (copyable BibTeX), **Related articles**, **Google Scholar**, and
  **DOI** — with a pager for multi-citations like `[38, 24, 15]` that shows one card per
  cited reference. It **never scrolls the PDF to the bibliography**, even for a citation
  whose entry couldn't be parsed (that shows an honest placeholder card instead).
- **Highlighting & annotations**: PDF.js's built-in highlighter (and the other annotation
  tools) work in reading mode — highlights show over the fixation-styled text just as over
  the original, appear on both the original and the processed text as you toggle the mode,
  and **save into the PDF** with the toolbar's download/save button (standard `/Highlight`
  annotations that open in any PDF reader).
- Rendering is 100% local. The only network requests are fetching the PDF itself and,
  when you *click* a citation, one Google Scholar search for that reference (same as
  typing the query into Scholar yourself; cached per session, never automatic).

## Install (from source)

Requirements: [Node.js](https://nodejs.org) 20+, Chrome 128+.

```sh
npm run fetch-pdfjs   # downloads + verifies the pinned PDF.js viewer into extension/vendor/
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and
select the `extension/` directory. To open local PDFs by their `file://` URL (e.g. by
opening the file in the browser), also enable **Allow access to file URLs** on the
extension's details page. Either way, the viewer's **Open File** button always works —
it reads the file directly, no permission toggle needed.

## Development

```sh
npm test              # naming guard + unit tests (node --test)
npm run package       # build a store-uploadable zip into dist/

# end-to-end smoke test (headless browser; see test/fixtures/urls.md —
# regular Chrome ≥137 ignores --load-extension, so point it at Edge,
# Chromium, or Chrome for Testing):
node test/e2e.mjs "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

# full corpus + rendering-fidelity harnesses (12 real papers, both browsers):
node test/papers.mjs                          # classification/color/link gate (must be 7/7 PASS)
node test/diag-dividers.mjs "Two-column B"    # masks must never cover table rules/underlines
node test/chrome-xray.mjs  "Two-column B" 10 --browser=chrome   # real-Chrome overlay-vs-canvas x-ray
node test/matrix-fonts.mjs "Two-column B" 14 --browser=edge     # every fontMode × boldWeight combo
node test/citeaudit.mjs  "<pdf-url>"          # citations: never jump to bib, always carded (jumpCites 0)
node test/highlights.mjs "<pdf-url>"          # highlight over processed text + save-to-PDF round-trip
```

## Releases

Tag a version to publish a packaged extension zip as a GitHub Release. Bump
`extension/manifest.json` (and `package.json`) first, then:

```sh
git tag v1.0.1 && git push origin v1.0.1
```

The [release workflow](.github/workflows/release.yml) vendors PDF.js, runs the
naming guard + unit tests, verifies the tag matches the manifest version, packs
`extension/` into `dist/fixate-scholar-<version>.zip`, and attaches it to the
release. A manual **Run workflow** (workflow_dispatch) builds the same zip as a
downloadable artifact without cutting a release.

**Read [TESTING.md](TESTING.md) before changing the engine** — it is the
rulebook (what must/must not be processed), the test inventory, and a list of
hard-won debugging rules (§6): measurement traps (stale text-layer scale,
font-load races, canvas readability windows), x-ray interpretation, and the
per-change verification gates.

The PDF.js generic viewer is vendored (not committed) by `scripts/fetch-pdfjs.mjs`, which
pins the release version and sha256 and applies a few loud-failure string patches (see the
script header). Everything else is plain ES modules — no bundler.

## How it works

PDF.js paints each page to a canvas and overlays an invisible, selectable HTML text layer.
FixateScholar makes that text layer visible, masks the duplicate canvas text behind each line,
and rewrites each word as `<b>prefix</b>rest`, re-calibrating the span scaling so selection
and search keep working. Pages are processed lazily as PDF.js renders them, in idle-time
chunks. See `extension/viewer/typography/`.

## Naming and legal

This project deliberately does **not** use the trademarked two-word brand name commonly
associated with this reading technique (registered in the US, EU, UK, and elsewhere and
actively enforced); `npm test` fails if it appears anywhere. The emphasis algorithm is
user-configurable and syllable-aware, distinct from any patented fixed fractional method.
Licensed [Apache 2.0](LICENSE); PDF.js notice in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
