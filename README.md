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
  author-year `(Smith et al., 2020)`, and the narrative form where only the year is
  bracketed (`Church [1936]`, `Vergis et al. [1986]`, `van Emde Boas [1990]`) to their
  entries, and shows a hover preview of the entry.
  Citations and in-paper references (Figure/Table/Section/…) are marked in distinct,
  high-contrast colors. Clicking a citation opens a pinned reader-style card — title
  linking to the paper, authors, abstract snippet, cited-by, **which source it came
  from**, and actions for **[PDF]** (an open-access copy where one exists), **Cite**
  (the publisher-registered BibTeX, fetched by DOI), **Google Scholar**, and **DOI** —
  with a pager for multi-citations like `[38, 24, 15]` that shows one card per
  cited reference. Every record is verified against the reference — title, first author,
  year — before it is shown, so a card is either this paper or the document's own entry,
  clearly labelled, and never a confident near-miss. It **never scrolls the PDF to the bibliography**, even for a citation
  whose entry couldn't be parsed (that shows an honest placeholder card instead).
- **Copy a paragraph, get a paragraph**: a PDF stores typeset lines, so copying normally
  pastes the shape of the page — one fragment per line, hyphens and all
  (`sub- sequently`). FixateScholar rebuilds the paragraph: each one copies as a single
  line, joined across column and page breaks, with the line-break hyphens removed and the
  compound ones (`state-of-the-art`) kept. `well-known` and `information` break identically,
  so two witnesses decide: the paper's own vocabulary first, then a bundled English word
  list (the hyphen stays when it sits between two words). Lists keep one item per line,
  running heads and feet stay separate, and wrapped URLs are put back together. Off switch
  in the options page.
- **Highlighting & comments**: PDF.js's built-in highlighter (and the other annotation
  tools) work in reading mode — highlights show over the fixation-styled text just as over
  the original, appear on both the original and the processed text as you toggle the mode,
  and **save into the PDF** with the toolbar's download/save button (standard `/Highlight`
  annotations that open in any PDF reader). Any highlight can carry a **comment**: the
  note button on the highlight (or the toolbar's comment tool, for a standalone sticky
  note) opens a box to type in, the comments sidebar lists every note in the document, and
  a saved note is an ordinary `/Contents` + `/Popup` annotation — Acrobat, Preview, Foxit
  and the browser's own viewer all show it. Set **Your name on annotations** in the options
  page and it is written as each annotation's author, so a review someone else opens says
  whose comments they are.
- **Find (Ctrl+F)**: a match landing on fixation-styled text stays fully readable and keeps
  its bolded prefixes. PDF.js rewrites the matched line's markup to insert its own highlight
  span, so the overlay re-colors that span and re-applies the emphasis around it — without
  the fix a match rendered as an empty colored box, and searching stripped the bolding from
  every matched line for good.
- Rendering is 100% local. The only network requests are fetching the PDF itself and,
  when you *click* a citation, one lookup for that reference — Google Scholar first,
  then arXiv, Crossref, OpenAlex and OpenAIRE as fallbacks. Never automatic, never a
  whole bibliography at once, and results are kept on your machine so reopening a
  paper costs nothing. **The Scholar lookup carries your own Google cookies; the
  others carry nothing.** Both are switchable in Options — see
  [Privacy](#privacy-what-leaves-your-computer).

## Privacy: what leaves your computer

FixateScholar renders PDFs locally. Nothing is uploaded, no analytics, no
telemetry, no account, no server of ours anywhere — there is no "our server" in
this project at all. Two things reach the network, and only two.

**1. The PDF itself.** The same request your browser would make for that URL.
Local files never leave the machine.

**2. One reference lookup, when you click a citation.** Not on hover, not on
page load, not in the background, and never for a whole bibliography at once —
one click by you is one lookup. What is sent is the reference's title, first
author and year, as printed in the document's own bibliography. Results are
cached on this computer (matches 30 days, misses 7) so reopening a paper sends
nothing again, and **Options → Reference lookups → "Clear stored lookups"**
empties that cache.

### Who sees a lookup

| Source | Default | What it receives | Cookies |
|---|---|---|---|
| **Google Scholar** | on | the search terms | **your own Google cookies** |
| arXiv, Crossref, OpenAlex, OpenAIRE | on (fallback) | the search terms | none — anonymous |

**Google Scholar is different, and you should know how.** It has no API, and it
answers only requests that carry your browser's Google cookies — an anonymous
request gets a captcha. So a lookup there is visible to Google the same way your
own Scholar searches are, and if you are signed in to Google it is associated
with that account. It is also subject to
[Google's Terms of Service](https://policies.google.com/terms), which restrict
automated access to their services; this extension only ever searches on your
explicit click, but you are the one making the request, from your browser, with
your session.

The other four are public scholarly databases that take an anonymous request
with no cookie, no key and no account. They see a title; they do not see you.

### Your choices

**Options → Reference lookups** has one checkbox per half:

- **"Search Google Scholar first"** — turn it off to keep every lookup
  anonymous. The open databases matched 97% of a real paper's references on
  their own, so little is lost.
- **"Use the open databases"** — turn it off to use only Scholar.
- **Both off** — no lookup happens at all. Clicking a citation shows the
  document's own bibliography entry, and nothing leaves your computer.

### Stored on your computer

Settings sync through your browser profile like any extension setting. The
lookup cache uses `chrome.storage.local`, which does **not** sync: the record of
what you looked up stays on the machine it happened on, ages out on its own, and
is clearable from Options. Nothing about your reading — which papers, which
pages, which citations — is recorded anywhere else.

## No affiliation, no warranty

FixateScholar is a free, open-source, independent project. **It is not
affiliated with, endorsed by, sponsored by or connected to Google, Google
Scholar, arXiv, Crossref, OpenAlex, OpenAIRE, Mozilla/PDF.js, or any publisher,
university or venue whose content it displays.** All product names, trademarks
and service marks belong to their respective owners and are used only to
identify the services being queried (see `TRADEMARKS.md`).

The extension queries those services as a user's browser does. It has no
agreement with any of them; they may change, rate-limit, refuse, or discontinue
access at any time, and any of that will simply make a citation card show the
document's own bibliography entry instead.

**Provided "AS IS", without warranty of any kind**, as stated in the Apache-2.0
`LICENSE` that governs this software. You use it at your own risk, and you are
responsible for your own use of the third-party services it can query —
including compliance with their terms. If you would rather not query Google
Scholar at all, turn it off in Options; the extension is fully functional
without it.

## Install (from source)

Requirements: [Node.js](https://nodejs.org) 20+, Chrome 128+.

```sh
npm run setup         # fetches whatever extension/vendor/ is missing: the pinned PDF.js
                      # viewer (~22 MB), the bundled reading fonts, and the English word
                      # list — then applies the PDF.js source patches. Safe to re-run; it
                      # is a no-op on a complete tree and only fills the gaps otherwise.
                      # `npm run setup -- --check` reports without fetching.
```

(`npm run fetch-pdfjs` is still there and still fetches everything
unconditionally — that is what the release workflow wants; `setup` is the one to
reach for by hand.)

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
# Chromium, or Chrome for Testing). The scripts auto-detect an installed
# browser; override with FX_BROWSER (or FX_EDGE / FX_CHROME), or pass a path:
node test/e2e.mjs

# full corpus + rendering-fidelity harnesses (12 real papers, both browsers):
node test/papers.mjs                          # classification/color/link gate (must be 8/8 PASS)
node test/diag-dividers.mjs "USENIX (code + algorithms)"    # masks must never cover table rules/underlines
node test/chrome-xray.mjs  "USENIX (code + algorithms)" 10 --browser=chrome   # real-Chrome overlay-vs-canvas x-ray
node test/matrix-fonts.mjs "USENIX (code + algorithms)" 14 --browser=edge     # every fontMode × boldWeight combo
node test/refparse.mjs "<pdf|dir|url>" …      # offline reference-parse sweep, no browser (entries + citations resolved)
node test/copytext.mjs "<pdf-url>"            # copying a paragraph gives a paragraph, losslessly
node test/citeaudit.mjs  "<pdf-url>"          # citations: never jump to bib, always carded (jumpCites 0)
node test/highlights.mjs "<pdf-url>"          # highlight over processed text + save-to-PDF round-trip
node test/search.mjs "<pdf-url>" protocol     # find matches stay visible AND stay bolded
```

## Releases

Tag a version to publish a packaged extension zip as a GitHub Release. Bump
`extension/manifest.json` (and `package.json`) first, then:

```sh
git tag v1.0.2 && git push origin v1.0.2
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
pins the release version and sha256 and applies the loud-failure string patches listed in
`scripts/pdfjs-patches.mjs`. The same script vendors the reading fonts and the English word
list the copy reflow consults for hyphens (SCOWL, 111k words — 1.04 MB unpacked, ~300 KB of
the packaged zip; the frequency bands are a constant at the top of the script). Because `extension/vendor/` is not committed, `npm test` also
runs `scripts/check-vendor.mjs`, which fails if a vendored tree is missing any of those
patches (`--fix` re-applies them in place, without re-downloading). Everything else is plain
ES modules — no bundler.

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
