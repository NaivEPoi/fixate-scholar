# FixatePDF

A Chrome (Manifest V3) extension that renders PDFs — especially academic papers — with
**fixation-guided typography**: the leading portion of each word is bolded to create
visual fixation points that guide the eye, a technique that can improve reading speed
and focus, particularly for neurodivergent readers.

Built on Mozilla's [PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0). No proprietary
code, fonts, or assets.

## Features

- **Fixation typography**: bolds the first syllable of each word by default (a fixed
  configurable fraction is available instead), with adjustable weight and an optional
  word-skip (saccade) interval. Text renders in the document's own embedded fonts at
  the original size and color; bundled open-source reading fonts (Atkinson
  Hyperlegible, Inter, Literata) are available as replacements. Only main body prose
  is processed — the paper title, authors and emails, section headings, math, tables,
  figures, captions, footnotes, and the references section are left exactly as set.
  Instant on/off toggle that restores the native rendering pixel-for-pixel.
- **Automatic PDF interception**: any PDF you navigate to (including links from Google
  Scholar) opens in the FixatePDF viewer. Per-site bypass list, per-document
  "open in native viewer" escape hatch, and a context-menu fallback.
- **References & citations** (academic papers): detects the bibliography, links in-text
  citations like `[12]` or `(Smith et al., 2020)` to their entries, and shows a hover
  preview of the entry. Clicking a citation opens a pinned card with a Google Scholar
  preview (title, authors, snippet, cited-by, direct [PDF] link when available), a
  pager for multi-citations like `[38, 24, 15]`, and **See in References** /
  **DOI** actions.
- Rendering is 100% local. The only network requests are fetching the PDF itself and,
  when you *click* a citation, one Google Scholar search for that reference (same as
  typing the query into Scholar yourself; cached per session, never automatic).

## Install (from source)

Requirements: [Node.js](https://nodejs.org) 20+, Chrome 128+.

```sh
npm run fetch-pdfjs   # downloads + verifies the pinned PDF.js viewer into extension/vendor/
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and
select the `extension/` directory. To use it on local PDF files, also enable
**Allow access to file URLs** in the extension's details page.

## Development

```sh
npm test              # naming guard + unit tests (node --test)
npm run package       # build a store-uploadable zip into dist/

# end-to-end smoke test (headless browser; see test/fixtures/urls.md —
# regular Chrome ≥137 ignores --load-extension, so point it at Edge,
# Chromium, or Chrome for Testing):
node test/e2e.mjs "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
```

The PDF.js generic viewer is vendored (not committed) by `scripts/fetch-pdfjs.mjs`, which
pins the release version and sha256 and applies two loud-failure string patches (see the
script header). Everything else is plain ES modules — no bundler.

## How it works

PDF.js paints each page to a canvas and overlays an invisible, selectable HTML text layer.
FixatePDF makes that text layer visible, masks the duplicate canvas text behind each line,
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
