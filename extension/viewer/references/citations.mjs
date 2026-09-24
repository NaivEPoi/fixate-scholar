// Detects in-text citations on rendered pages and overlays clickable
// hit-targets (a separate absolutely-positioned layer — the text layer itself
// is never modified here, so this composes with the typography engine).

import { extractLines } from "./extractor.mjs";
import {
  parseReferenceSections,
  findContentStart,
  findFurniture,
  findCitations,
  findInternalRefsAcrossBreaks,
  resolveCitation,
} from "./parser.mjs";
import { CitationPopup } from "./popup.mjs";

export class ReferencesFeature {
  #app;
  #entries = [];
  // One entry pool per reference section, with the page its heading sits on.
  // A journal proof carries the article and its supplementary material in one
  // PDF, each with its own "REFERENCES" and its own [1]…[n] — so which entry
  // "[3]" means depends on which side of the supplement's heading the citation
  // is printed. See #entriesForPage.
  #sections = [];
  // Does the document HAVE a bibliography, whatever came of parsing it? A
  // paper whose reference section was found but whose entries all failed to
  // group is still a paper whose "[12]" is a citation — see #shouldAnnotate.
  #hasBibliography = false;
  #popup;
  #ready = null;

  /** Called with the bibliography line boxes (Map<page, boxes>) once known. */
  onRefsRegion = null;

  /** Called with the Abstract heading position (front matter ends there). */
  onContentStart = null;

  /** Called with the document-wide body-text height once known. */
  onBodyHeight = null;

  /** Called with running-head/foot line boxes (Map<page, boxes>) once known. */
  onFurniture = null;

  /** Called with every extracted line of the document, once. The extraction
   *  happens here anyway; other features (the copy reflow's hyphen vocabulary)
   *  want the same text and should not pay for a second pass over the PDF. */
  onLines = null;

  /** Called before / after the four document-wide results above are handed
   *  over. They all land together, and each one re-processes rendered pages,
   *  so the consumer uses this pair to coalesce that into a single pass. */
  onAnalysisStart = null;
  onAnalysisEnd = null;

  constructor(app) {
    this.#app = app;
    this.#popup = new CitationPopup(app);
  }

  onDocumentLoaded(pdfDocument) {
    this.#entries = [];
    this.#sections = [];
    this.#hasBibliography = false;
    this.#ready = (async () => {
      try {
        const lines = await extractLines(pdfDocument);
        if (globalThis.__fxDebug) {
          globalThis.__fxAllLines = lines.map((l) => ({ page: l.page, col: l.column, x: Math.round(l.x), h: Math.round(l.h * 10) / 10, text: l.text })); // test introspection
        }
        try {
          this.onLines?.(lines);
        } catch (e) {
          console.warn("FixateScholar: line consumer failed", e);
        }
        const sections = parseReferenceSections(lines);
        this.#sections = sections.map((sec) => ({
          page: sec.heading.page,
          entries: sec.entries,
        }));
        this.#entries = sections.flatMap((sec) => sec.entries);
        globalThis.__fxRefCount = this.#entries.length; // test introspection
        globalThis.__fxRefNums = this.#entries.map((e) => e.number); // test introspection
        // Document-wide body height (char-weighted height mode over every
        // page) — body text dominates the whole document, so a single
        // small-text-heavy page can't skew it.
        const hHist = new Map();
        for (const l of lines) {
          if (!l.h || !l.text) continue;
          const b = Math.round(l.h * 2) / 2;
          hHist.set(b, (hHist.get(b) || 0) + l.text.length);
        }
        let bodyH = null;
        let bestW = 0;
        for (const [b, w] of hHist) if (w > bestW) { bestW = w; bodyH = b; }
        globalThis.__fxBodyH = bodyH; // test introspection
        // The four document-wide results are handed over inside a batch, so
        // the consumer can re-process the rendered pages once instead of after
        // each. try/finally: a throw partway through must still close the
        // batch, or the deferred re-process would never run.
        await this.onAnalysisStart?.();
        try {
          if (bodyH) await this.onBodyHeight?.(bodyH);
          const contentStart = findContentStart(lines);
          if (contentStart) await this.onContentStart?.(contentStart);
          // Running heads and feet: only a document-wide pass can recognize them
          // (repetition across pages), and the engine's margin cut reaches just a
          // one-line head.
          const furniture = findFurniture(lines);
          if (furniture.size) await this.onFurniture?.(furniture);
          if (globalThis.__fxDebug) {
            globalThis.__fxRefBody = sections.flatMap((sec) => sec.body.map((l) => l.text)); // test introspection
          }
          this.#hasBibliography = sections.length > 0;
          if (sections.length) {
            // EVERY section's lines go into the region the engine leaves
            // alone. Covering only one of them left the other reference list
            // emphasized as body prose.
            const boxes = new Map();
            for (const line of sections.flatMap((sec) => [sec.heading, ...sec.body])) {
              const pad = line.h * 0.7;
              if (!boxes.has(line.page)) boxes.set(line.page, []);
              boxes.get(line.page).push({
                x0: line.x,
                x1: line.endX ?? line.x + 1000,
                y0: line.y - pad,
                y1: line.y + pad,
              });
            }
            await this.onRefsRegion?.(boxes);
          }
        } finally {
          // Runs the coalesced re-process the setters above deferred; awaited,
          // so the annotation below sees the final span DOM rather than one
          // that is about to be restored and rebuilt under it.
          await this.onAnalysisEnd?.();
        }
        // Pages rendered before extraction finished need annotating now.
        this.reannotateRendered();
      } catch (e) {
        console.warn("FixateScholar: reference extraction failed", e);
      }
    })();
  }

  /**
   * Whether a native annotation link points at the bibliography rather than
   * somewhere else in the document.
   *
   * The named-destination conventions the LaTeX toolchains emit — `cite.Foo12`,
   * `bib.3`, `bibitem-7`, `ref_9` — with or without the leading `#` that the
   * annotation layer writes into `href`.
   */
  #isReferenceLink(href) {
    return !!href && /^#?(?:cite|bib|ref|bibr|bibitem)[._-]/i.test(href);
  }

  /**
   * Whether to run the BIBLIOGRAPHY-citation pass ("[12]", "(Author 2017)").
   *
   * In-paper references ("Figure 3", "Section 5") are not gated on this: they
   * resolve against the document itself, so a memo or review with no reference
   * list at all still gets them coloured and still keeps its jump links.
   *
   * Parsed entries are the normal reason. The second one is the honest
   * fallback: the document HAS a reference section — the heading and its body
   * lines were found — but the entries could not be grouped out of it (an
   * unusual marker style, a bibliography rendered as an image-backed text
   * layer, a list the extractor mangled). Every bracketed "[12]" in that
   * document is still a citation, and refusing to touch any of them was the
   * worst of the three outcomes: no color, no card, and — because
   * reconcileLinks only neutralises a native link that one of OUR hit-targets
   * covers — a click on the citation scrolled the reader away to the
   * bibliography, the one thing this feature exists to prevent. With the
   * fallback each bracketed citation still gets its hit-target and a stub card
   * that says plainly the entry could not be read. Author-year parentheticals
   * are NOT annotated here: without entries to resolve against, that pattern
   * cannot be told from ordinary prose in parentheses (#buildCards already
   * declines to stub them).
   */
  #shouldAnnotate() {
    return this.#entries.length > 0 || this.#hasBibliography;
  }

  async onTextLayerRendered(pageView) {
    await this.#ready;
    this.annotatePage(pageView);
  }

  /** Rebuild hit-targets on every rendered page (geometry has changed). */
  reannotateRendered() {
    const viewer = this.#app.pdfViewer;
    for (let i = 0; i < viewer.pagesCount; i++) {
      const pv = viewer.getPageView(i);
      if (pv?.textLayer?.div?.childElementCount) this.annotatePage(pv);
    }
  }

  /**
   * The entries a citation printed on `page` is numbered against: the first
   * reference section at or after that page — an article's citations precede
   * its bibliography, so the next list down the document is its own — falling
   * back to the last section for anything printed after every list (an
   * appendix, or the reference lines themselves).
   *
   * With one bibliography, which is every ordinary paper, this is just all the
   * entries.
   */
  #entriesForPage(page) {
    if (this.#sections.length < 2 || !page) return this.#entries;
    const sec =
      this.#sections.find((s) => s.page >= page) ?? this.#sections.at(-1);
    return sec.entries;
  }

  /** This page's card list for a citation — see buildCards. */
  #buildCards(keys, bracketed, page) {
    return buildCards(keys, bracketed, this.#entriesForPage(page));
  }

  annotatePage(pageView) {
    pageView.div.querySelector(".fx-cite-layer")?.remove();
    const textLayerDiv = pageView.textLayer?.div;
    if (!textLayerDiv) return;

    const layer = document.createElement("div");
    layer.className = "fx-cite-layer";
    layer.style.cssText =
      "position:absolute;inset:0;z-index:2;pointer-events:none;";
    textLayerDiv.after(layer);
    const layerRect = layer.getBoundingClientRect();

    // Citations frequently wrap across text-layer spans ("(Smith et al.," /
    // "2020)"), so match against the concatenated page text and map match
    // offsets back to the contributing spans. Spans carry no trailing
    // whitespace, so plain concatenation reassembles split tokens; the
    // citation regexes already tolerate missing/extra inner whitespace.
    const segments = [];
    let joined = "";
    for (const span of textLayerDiv.querySelectorAll("span")) {
      if (span.closest(".fx-cite-c, .fx-ref-c, .fx-sp")) continue;
      if (span.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")) continue; // markedContent wrappers
      const text = span.textContent;
      if (!text) continue;
      const start = joined.length;
      joined += text + "\n";
      segments.push({ span, start, end: start + text.length });
    }

    // TWO PHASES, and they must stay separate. Phase 1 only READS geometry
    // (rangeRects → Range.getClientRects); phase 2 only WRITES the DOM (the
    // hit-target layer, then the color wraps). Interleaved — which is what this
    // did — every wrapRange/append dirtied the layout, so the next citation's
    // getClientRects forced a synchronous re-layout of a text layer holding
    // hundreds of absolutely-positioned spans: one forced layout PER CITATION,
    // which is where a citation-dense page's visible render lag came from.
    // Batched, a page costs one layout instead of one per citation. The reads
    // are unaffected by the deferred writes: a wrap is geometry-neutral by
    // construction (overlay.css pins .fx-cite-c/.fx-ref-c to display:inline,
    // position:static, color only), and splitting a text node doesn't move a
    // glyph — so every rect is identical to what the interleaved order read.
    const hits = []; // { rect, cards }
    const wraps = []; // { span, start, end, className } — applied in push order

    // Collect all native annotation links on this page that target references/bibliography
    const annotLayer = pageView.div?.querySelector(".annotationLayer");
    const refLinks = [];
    if (annotLayer) {
      for (const a of annotLayer.querySelectorAll("a")) {
        const href = a.getAttribute("href") || "";
        if (/^(https?|mailto|tel):/i.test(href)) continue;
        if (this.#isReferenceLink(href)) {
          const rect = a.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            refLinks.push({ rect, href });
          }
        }
      }
    }

    const isMonospace = (span) => {
      const font = (span.style?.fontFamily || window.getComputedStyle(span)?.fontFamily || "").toLowerCase();
      return (
        font.includes("mono") ||
        font.includes("courier") ||
        font.includes("consolas") ||
        font.includes("menlo") ||
        font.includes("inconsolata") ||
        font.includes("typewriter") ||
        font.includes("code")
      );
    };

    // The character ranges this pass annotates as citations: what an in-paper
    // reference must stay out of (below).
    const citeRanges = [];
    if (this.#shouldAnnotate()) {
      for (const cite of findCitations(joined, { includeIndexed: true })) {
        const bracketed = joined[cite.start] === "[";
        const citeSegs = [...intersecting(segments, cite.start, cite.end)];
        if (!citeSegs.length) continue;

        // Check if this bracketed match has a hyperlink to a reference
        let hasRefLink = false;
        if (bracketed && refLinks.length) {
          for (const seg of citeSegs) {
            const localStart = Math.max(0, cite.start - seg.start);
            const localEnd = Math.min(seg.end - seg.start, cite.end - seg.start);
            for (const cr of rangeRects(seg.span, localStart, localEnd)) {
              for (const rl of refLinks) {
                const w = Math.min(cr.right, rl.rect.right) - Math.max(cr.left, rl.rect.left);
                const h = Math.min(cr.bottom, rl.rect.bottom) - Math.max(cr.top, rl.rect.top);
                if (w > 0 && h > 0 && (w * h) > 0.15 * (cr.width * cr.height)) {
                  hasRefLink = true;
                  break;
                }
              }
              if (hasRefLink) break;
            }
            if (hasRefLink) break;
          }
        }

        // If it has a hyperlink to the reference, it must be the citation.
        // If it does NOT have a hyperlink to the reference:
        // - Reject if preceded by an identifier character (array/variable indexing like packet[4], crc[0]).
        // - Reject if in a monospace/code font (code listing).
        if (!hasRefLink) {
          if (cite.precededByIdentifier) continue;
          if (citeSegs.some((s) => isMonospace(s.span))) continue;
        }

        // One card per CITED key, in reading order: the resolved entry, or — for
        // a bracketed marker the extractor missed — a stub. So (1) a multi-citation's
        // pager shows EVERY cited reference, not only the ones that resolved, and
        // (2) every bracketed citation gets a hit-target, which lets reconcileLinks
        // neutralise the PDF's own link so a click opens our card instead of
        // scrolling to the bibliography. Unresolved AUTHOR-YEAR parentheticals
        // get no card (that pattern false-positives on ordinary parens).
        const { cards, indexOf } = this.#buildCards(cite.keys, bracketed, pageView.id);
        if (!cards.length) continue;
        citeRanges.push([cite.start, cite.end]);
        for (const seg of citeSegs) {
          // Don't annotate the bibliography's own entry "[N]" markers (the engine
          // tags refs-region spans data-fx-refs): the reference list is left as the
          // author set it, no hover/click cards on its own numbers (F1).
          if (seg.span.dataset.fxRefs) continue;
          const localStart = Math.max(0, cite.start - seg.start);
          const localEnd = Math.min(seg.end - seg.start, cite.end - seg.start);
          for (const rect of rangeRects(seg.span, localStart, localEnd)) {
            hits.push({ rect, cards, index: 0 });
          }
          // Color the citation text itself. A fixed, high-contrast color (set
          // in overlay.css) — not the document's own link color, which is often
          // a low-contrast pastel that's hard to read.
          if (seg.span.dataset.fxDone) {
            wraps.push({ span: seg.span, start: localStart, end: localEnd, className: "fx-cite-c" });
          }
        }
        // A multi-key citation is several references printed as one run of
        // text, and the reader points at ONE of them: "[4, 12]" hovered over
        // the 12 must open [12]'s card, not [4]'s. So each printed key gets a
        // hit-target of its own, over the whole-citation ones pushed above —
        // later siblings in the layer sit on top, so the precise target wins
        // wherever it exists and the characters no key claims (the brackets,
        // the comma, a locator) still open the citation at its first card.
        if (cards.length > 1) {
          for (const ks of cite.keySpans ?? []) {
            const index = indexOf.get(ks.key);
            if (index === undefined || index === 0) continue;
            for (const seg of intersecting(segments, ks.start, ks.end)) {
              if (seg.span.dataset.fxRefs) continue;
              const localStart = Math.max(0, ks.start - seg.start);
              const localEnd = Math.min(seg.end - seg.start, ks.end - seg.start);
              for (const rect of rangeRects(seg.span, localStart, localEnd)) {
                hits.push({ rect, cards, index });
              }
            }
          }
        }
      }
    }

    // In-paper references (Figure 3, Table 9, Section 5, Algorithm 2, …) get a
    // distinct fixed high-contrast color, also from overlay.css. Queued after
    // the citation wraps, exactly as they were applied before.
    // Not a citation's LOCATOR: "[9, §5.2]", "[4, Section 3]", "(Smith 2020,
    // Section 3)" point into the CITED work, not this paper, and were painted
    // in the reference colour nested inside the citation colour. A locator
    // follows its key — a number or year earlier in the same citation, with no
    // ";" between — so "(see Section 3; Smith 2020)" still refers to this paper.
    const isLocator = (ref) => citeRanges.some(([a, b]) => {
      if (!(ref.start < b && ref.end > a)) return false;
      const before = joined.slice(a, ref.start);
      return /\d/.test(before.slice(before.lastIndexOf(";") + 1));
    });
    for (const found of findInternalRefsAcrossBreaks(joined)) {
      if (isLocator(found)) continue;
      let ref = found;
      // Coloured whole or not at all, and only in processed text. A piece that
      // stays on the canvas — a "§" TeX set from the symbol font, a number in a
      // kept face — cannot be coloured, and half a reference in red read as a
      // bug ("§2", only the "2" red). So a reference running into such a piece
      // is cut back to its longest LEADING part that is itself a complete
      // reference, all in processed text: "Lemma 4, M" (the list grammar
      // reaching a math variable) colours "Lemma 4"; "§ 2" and "Listing 2",
      // whose leader or number is on the canvas, colour nothing.
      const inked = [...intersecting(segments, ref.start, ref.end)]
        .filter((seg) => joined.slice(Math.max(ref.start, seg.start), Math.min(ref.end, seg.end)).trim());
      const firstKept = inked.findIndex((seg) => !seg.span.dataset.fxDone);
      if (firstKept >= 0) {
        const cut = firstKept === 0 ? ref.start : Math.max(ref.start, inked[firstKept].start);
        const head = findInternalRefsAcrossBreaks(joined.slice(ref.start, cut)).find((r) => r.start === 0);
        if (globalThis.__fxDebug && inked.some((seg) => seg.span.dataset.fxDone)) {
          (globalThis.__fxRefPartial ??= []).push(
            joined.slice(ref.start, ref.end).replace(/\s+/g, " ").slice(0, 30) + (head ? " -> head" : " -> none"),
          ); // test introspection
        }
        if (!head) continue;
        ref = { start: ref.start, end: ref.start + head.end };
      }
      for (const seg of intersecting(segments, ref.start, ref.end)) {
        if (!seg.span.dataset.fxDone) continue;
        const localStart = Math.max(0, ref.start - seg.start);
        const localEnd = Math.min(seg.end - seg.start, ref.end - seg.start);
        wraps.push({ span: seg.span, start: localStart, end: localEnd, className: "fx-ref-c" });
      }
    }

    // Phase 2 — writes. The hit-targets go in through one fragment (a single
    // insertion instead of one per rect).
    const frag = document.createDocumentFragment();
    for (const { rect, cards, index } of hits) {
      const a = document.createElement("a");
      a.className = "fx-cite-hit";
      a.style.cssText =
        "position:absolute;pointer-events:auto;cursor:pointer;" +
        `left:${rect.left - layerRect.left}px;top:${rect.top - layerRect.top}px;` +
        `width:${rect.width}px;height:${rect.height}px;`;
      a.addEventListener("mouseenter", () => this.#popup.scheduleShow(cards, a, index));
      a.addEventListener("mouseleave", () => this.#popup.scheduleHide());
      a.addEventListener("click", (e) => {
        e.preventDefault();
        this.#popup.showNow(cards, a, { pinned: true, index });
      });
      frag.append(a);
    }
    layer.append(frag);
    for (const w of wraps) wrapRange(w.span, w.start, w.end, w.className, null);

    // Now that this page's citation hit-targets exist, reconcile the native
    // annotation links (it may have rendered before or after this pass).
    this.reconcileLinks(pageView);
  }

  /**
   * Decide, per native internal-destination link on a page, whether it is a
   * citation (→ our card handles it; disable the link's scroll-to-bibliography)
   * or an in-paper jump like Figure/Table/Section/Equation (→ keep the native
   * jump working). A link is treated as a citation when one of our citation
   * hit-targets overlaps it. External links (http/mailto/tel) are left alone.
   * Idempotent — safe to call from both textlayerrendered and
   * annotationlayerrendered, in any order.
   */
  reconcileLinks(pageView) {
    const pageDiv = pageView?.div;
    const layer = pageDiv?.querySelector(".annotationLayer");
    if (!layer) return;
    const hits = [...pageDiv.querySelectorAll(".fx-cite-hit")].map((a) =>
      a.getBoundingClientRect(),
    );
    // Measure every candidate link BEFORE writing any style. Interleaved, each
    // pointer-events write invalidated style/layout, so the next link's
    // getBoundingClientRect forced a synchronous recalc — one per annotation
    // link on the page. The checks and the decision are unchanged; only the
    // reads have been lifted out of the write loop.
    const candidates = [];
    for (const a of layer.querySelectorAll("a")) {
      const href = a.getAttribute("href") || "";
      if (/^(https?|mailto|tel):/i.test(href)) continue; // external — keep
      const r = a.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      candidates.push({ a, r });
    }
    for (const { a, r } of candidates) {
      const overlapsCite = hits.some((h) => {
        const w = Math.min(r.right, h.right) - Math.max(r.left, h.left);
        const ht = Math.min(r.bottom, h.bottom) - Math.max(r.top, h.top);
        return w > 0 && ht > 0 && w * ht > 0.3 * (r.width * r.height);
      });
      // Citation link → falls through to our hit-target/card; in-paper
      // reference link (Figure/Table/Section/…) → native jump preserved.
      // PDF.js renders each link as <section class="linkAnnotation"><a></a>
      // </section>, and the SECTION — not the <a> — is the topmost box sitting
      // over the glyphs. Disabling only the <a> leaves the section eating clicks
      // on the citation number (its hyperref /Rect usually aligns with the
      // number, not the surrounding brackets), so the click never reaches our
      // hit-target below: the brackets stay clickable but the number does not.
      // Toggle pointer-events on the wrapping section too.
      const box = a.closest("section") || a;
      const val = overlapsCite ? "none" : "";
      a.style.pointerEvents = val;
      box.style.pointerEvents = val;
    }
  }
}

/**
 * Ordered, de-duplicated card list for a citation's keys: each resolved entry,
 * plus a stub for any key of a BRACKETED citation the extractor didn't parse
 * (so the pager reflects every cited reference and the native link is
 * neutralised). Returns no cards for an unresolved author-year citation.
 *
 * "Bracketed" covers alpha keys ("[ABB+04]") as well as numeric ones: both are
 * entry MARKERS, and a marker the bibliography parse missed is exactly the
 * case the stub exists for. Restricting the stub to /^\d+$/ left an
 * alpha-keyed paper's unparsed citations with no hit-target at all, so
 * reconcileLinks never saw them and a click fell through to the PDF's own link
 * — scrolling away to the bibliography, the one thing this must not do.
 *
 * `indexOf` says which CARD each key produced. A key's position in `keys` is
 * not its position in the card list: cards are de-duplicated ("[4, 4]", or two
 * keys resolving to one entry) and a single key can resolve to several
 * entries. The per-key hit-targets need the card the reader is pointing at, so
 * they ask this map rather than counting — a key maps to the first card it
 * contributed.
 *
 * Exported for its unit test: the mapping is pure list work over parsed
 * entries, and getting it wrong shows up as the wrong reference on screen.
 */
export function buildCards(keys, bracketed, entries) {
  const cards = [];
  const seen = new Map();
  const indexOf = new Map();
  for (const key of keys) {
    const matches = resolveCitation([key], entries);
    if (matches.length) {
      for (const e of matches) {
        const id = "e:" + (e.number ?? e.label);
        if (!seen.has(id)) {
          seen.set(id, cards.length);
          cards.push(e);
        }
        if (!indexOf.has(key)) indexOf.set(key, seen.get(id));
      }
    } else if (bracketed) {
      const id = "s:" + key;
      if (!seen.has(id)) {
        seen.set(id, cards.length);
        cards.push({
          number: /^\d+$/.test(key) ? parseInt(key, 10) : null,
          label: key,
          unresolved: true,
          raw: "",
          title: "",
        });
      }
      if (!indexOf.has(key)) indexOf.set(key, seen.get(id));
    }
  }
  return { cards, indexOf };
}

/**
 * The segments covering the character range [start, end) of the page text.
 *
 * `segments` is built by walking the text layer in order, so it is sorted by
 * `start` and contiguous (each segment's end is the next one's start) — which
 * lets a binary search find the first overlapping segment instead of scanning
 * the whole list for every match. Scanning was O(matches × spans): on a
 * citation-dense page of a long paper that is tens of thousands of
 * comparisons per annotation pass, repeated for every re-annotation.
 * The membership test itself is unchanged (`!(end <= start || start >= end)`).
 */
export function* intersecting(segments, start, end) {
  let lo = 0;
  let hi = segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < segments.length && segments[i].start < end; i++) {
    yield segments[i];
  }
}

/**
 * Wrap the character range [start, end) of a span's text in colored
 * <span class> elements, splitting text nodes as needed (the span may
 * contain <b> emphasis wrappers; each intersecting text portion is wrapped
 * separately). Already-wrapped portions are skipped, so re-annotation is
 * idempotent. `color` (CSS color or null) overrides the class default.
 */
function wrapRange(span, start, end, className, color) {
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  const targets = [];
  let pos = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.data.length;
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + len);
    if (s < e && !node.parentElement.closest(`.${className}`)) {
      targets.push({ node, from: s - pos, to: e - pos });
    }
    pos += len;
  }
  for (const { node, from, to } of targets) {
    let piece = node;
    if (from > 0) piece = piece.splitText(from);
    if (to - from < piece.data.length) piece.splitText(to - from);
    const wrap = document.createElement("span");
    wrap.className = className;
    if (color) wrap.style.color = color;
    piece.before(wrap);
    wrap.append(piece);
  }
}

/** Client rects of the character range [start, end) inside a span,
 *  walking its text nodes (the span may contain <b> wrappers). */
function rangeRects(span, start, end) {
  const range = document.createRange();
  let pos = 0;
  let startSet = false;
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.data.length;
    if (!startSet && start < pos + len) {
      range.setStart(node, start - pos);
      startSet = true;
    }
    if (startSet && end <= pos + len) {
      range.setEnd(node, end - pos);
      return [...range.getClientRects()].filter((r) => r.width > 0);
    }
    pos += len;
  }
  return [];
}
