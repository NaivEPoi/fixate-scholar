// Applies fixation emphasis to PDF.js text layers.
//
// PDF.js paints glyphs on a canvas and overlays transparent, absolutely
// positioned text spans for selection/search. With the mode on we:
//   1. pick the spans belonging to the main document text (dominant body
//      font size — table/figure/caption/footnote text stays untouched on
//      the canvas),
//   2. make those spans visible in the document's own embedded font (the
//      FontFaces PDF.js loaded for the canvas) at the original size,
//   3. cover the duplicate canvas glyphs with a per-span mask layer placed
//      between the canvas and the text layer,
//   4. rewrite each span as bold-prefix + rest,
//   5. re-calibrate the span's scaleX so its rendered width still matches
//      the original glyph run (keeps selection/search geometry usable).
// Everything is reversible: pristine markup is kept in a WeakMap and restored
// on toggle-off. Work happens in idle-time chunks to avoid jank.

import { emphasizeParts } from "./segmenter.mjs";

const CHUNK = 150;
const ABSTRACT = /^\s*abstract\s*$/i;
// Faces that are never emphasized — they mark intentional special typography:
// TeX/Type1 math and symbol fonts, monospace/typewriter (code, URLs), small
// caps (system names), and bold display variants.
const SPECIAL_FONT = new RegExp(
  [
    "CMMI|CMSY|CMEX|CMBSY|MSAM|MSBM|Math|Symbol|cmmi|cmsy|cmex|stmary|rsfs|eufm|eusm|wasy|esint|MnSymbol|AMSa|AMSb", // math
    "cmtt|Typewriter|Mono(?![a-z])|Courier|Consol|Menlo|LMTT|TT(?=[0-9-])", // monospace
    "cmcsc|SmallCaps|[-+]SC(?![a-z])|Caps(?![a-z])", // small caps
    "Bold|bold|cmbx|Heavy|Black(?![a-z])|Medi(?![a-z])", // bold display variants
  ].join("|"),
);
// Bold/medium display faces only — the subset of SPECIAL_FONT used to spot
// unlabelled run-in headings (a bold paragraph lead-in like "Minimizing
// duplicate states."). Kept (masked + redrawn) bold text renders lighter than
// the canvas, so such headings are skipped to the canvas instead.
const BOLD_FONT = /Bold|bold|cmbx|Heavy|Black(?![a-z])|Medi(?![a-z])/;
// Italic faces — used ONLY for styled run-in paragraph leads ("Establishing
// privacy-preserving mutual authentication …:" set in underlined italics):
// processing such a lead erases its UNDERLINE (canvas art hugging the glyphs)
// with the mask. Ordinary inline italic emphasis is untouched (the rule below
// requires the italic run to open the line and end with a colon).
const ITALIC_FONT = /Italic|italic|Oblique|Slanted|cmti|cmmi|-It(?![a-z])|Libertine\w*I(?![a-zA-Z])/;

// Bundled reading fonts (SIL OFL, vendored by scripts/fetch-pdfjs.mjs);
// @font-face rules live in overlay.css. These ship real 700 weights, so
// emphasis uses true bold instead of the original-mode hairline stroke.
const FONT_STACKS = {
  atkinson: '"FX Atkinson Hyperlegible", sans-serif',
  inter: '"FX Inter", sans-serif',
  literata: '"FX Literata", serif',
};

export class TypographyEngine {
  #app;
  #settings;
  #enabled = false;
  #pristine = new WeakMap(); // span -> { html, scaleX, fontFamily }
  #pending = new Map(); // pageNumber -> cancel flag holder
  #refsBoxes = null; // Map<pageNumber, Array<{x0,x1,y0,y1}>> — bibliography region
  #contentStart = null; // { page, y, h } — the Abstract heading; front matter above it
  #bodyHeight = null; // document-wide body-text height (from the refs extractor)
  #ascentCache = new Map(); // fontFamily -> browser ascent ratio (baseline align)
  #measureCtx = null; // offscreen 2d context for ascent measurement

  constructor(app, settings) {
    this.#app = app;
    this.#settings = settings;
  }

  /** Document-wide body-text height (char-weighted height mode over every
   *  page, computed by the references extractor). Used by the size filter so a
   *  small-text-heavy page can't skew the body size and drop real prose.
   *  Re-processes rendered pages since the size cut may now differ. */
  setBodyHeight(h) {
    if (!h || h === this.#bodyHeight) return Promise.resolve();
    this.#bodyHeight = h;
    if (!this.#enabled) return Promise.resolve();
    this.#restoreAll();
    return this.#processAll();
  }

  /** The article body starts here (Abstract heading). Cover pages and the
   *  title/authors/emails block before it stay untouched. */
  setContentStart(pos) {
    this.#contentStart = pos;
    globalThis.__fxContentStart = pos; // test introspection
    if (!this.#enabled || !pos) return Promise.resolve();
    const promises = [];
    this.#eachRenderedPage((pv) => {
      if (pv.id <= pos.page) promises.push(this.#processPage(pv));
    });
    return Promise.all(promises);
  }

  /** The bibliography occupies exactly these line boxes (PDF coordinates,
   *  column-aware) — leave them as the author set them. Text after the
   *  region (appendices) is still processed. Re-processes affected pages. */
  setRefsRegion(boxesByPage) {
    this.#refsBoxes = boxesByPage;
    globalThis.__fxRefPages = boxesByPage ? [...boxesByPage.keys()] : []; // test introspection
    if (!this.#enabled || !boxesByPage?.size) return Promise.resolve();
    const promises = [];
    this.#eachRenderedPage((pv) => {
      if (boxesByPage.has(pv.id)) promises.push(this.#processPage(pv));
    });
    return Promise.all(promises);
  }

  get enabled() {
    return this.#enabled;
  }

  /** Resolves when re-processing (if any) has finished. */
  updateSettings(settings) {
    this.#settings = settings;
    if (!this.#enabled) return Promise.resolve();
    this.#restoreAll();
    return this.#processAll();
  }

  /** Re-process every rendered page from a clean (restored) state. Used when
   *  the page geometry our corrections depend on may have gone stale without a
   *  textlayerrendered — e.g. the embedded fonts were evicted when the window
   *  was backgrounded and re-loaded with different (fallback) metrics on
   *  return, leaving spans we measured during the fallback window mis-spaced. */
  refresh() {
    if (!this.#enabled) return Promise.resolve();
    this.#restoreAll();
    return this.#processAll();
  }

  /** Resolves when all (re)processing it triggered has finished. */
  setEnabled(on) {
    if (on === this.#enabled) return Promise.resolve();
    this.#enabled = on;
    // appConfig.viewerContainer is the inner #viewer div; our CSS hangs off
    // the scrolling #viewerContainer (appConfig.mainContainer).
    const container =
      this.#app.appConfig.mainContainer ??
      document.getElementById("viewerContainer");
    container.classList.toggle("fx-on", on);
    if (on) return this.#processAll();
    this.#restoreAll();
    return Promise.resolve();
  }

  /** Hook for the textlayerrendered event: (re)process one page lazily.
   *  Resolves when the page is fully processed (immediately if disabled). */
  onTextLayerRendered(pageView) {
    if (!this.#enabled) return Promise.resolve();
    return this.#processPage(pageView);
  }

  #eachRenderedPage(fn) {
    const viewer = this.#app.pdfViewer;
    for (let i = 0; i < viewer.pagesCount; i++) {
      const pageView = viewer.getPageView(i);
      if (pageView?.textLayer?.div?.childElementCount) fn(pageView);
    }
  }

  #processAll() {
    const promises = [];
    this.#eachRenderedPage((pv) => promises.push(this.#processPage(pv)));
    return Promise.all(promises);
  }

  #restoreAll() {
    for (const holder of this.#pending.values()) {
      holder.cancelled = true;
      holder.resolve();
    }
    this.#pending.clear();
    this.#eachRenderedPage((pv) => this.#restorePage(pv));
  }

  #restorePage(pageView) {
    pageView.div.querySelector(".fx-mask")?.remove();
    const layerDiv = pageView.textLayer?.div;
    if (!layerDiv) return;
    // The pristine --scale-x is dimensionless (canvas width / measured text
    // width — both scale with zoom), so restoring it is valid at any scale.
    for (const span of layerDiv.querySelectorAll("span[data-fx-done]")) {
      const orig = this.#pristine.get(span);
      if (orig) {
        span.innerHTML = orig.html;
        span.style.setProperty("--scale-x", orig.scaleX || "");
        span.style.fontFamily = orig.fontFamily;
        span.style.wordSpacing = orig.wordSpacing || "";
        span.style.marginTop = orig.marginTop || "";
      }
      delete span.dataset.fxDone;
    }
    for (const d of layerDiv.querySelectorAll("[data-fx-keep]")) {
      delete d.dataset.fxKeep;
    }
    for (const d of layerDiv.querySelectorAll("[data-fx-table]")) {
      delete d.dataset.fxTable;
    }
    for (const d of layerDiv.querySelectorAll("[data-fx-refs]")) {
      delete d.dataset.fxRefs;
    }
  }

  /**
   * Pair every text-layer div with its getTextContent item, giving us the
   * item's fontName (the FontFace PDF.js registered for the canvas) and
   * height. Falls back to bare divs when the mapping is unavailable.
   */
  async #pagePairs(pageView) {
    try {
      const divs = pageView.textLayer.highlighter?.textDivs;
      if (divs?.length) {
        const content = await pageView.pdfPage.getTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        });
        const strItems = content.items.filter((it) => it.str !== undefined);
        if (strItems.length === divs.length) {
          return strItems.map((item, i) => ({
            div: divs[i],
            item,
            style: content.styles[item.fontName],
          }));
        }
      }
    } catch {
      /* fall through */
    }
    return [...pageView.textLayer.div.querySelectorAll("span")]
      .filter((s) => !s.querySelector("span"))
      .map((div) => ({ div, item: null, style: null }));
  }

  /** Group page items into visual baseline lines, top→bottom (descending PDF
   *  y). Each line carries its x-extent and joined text. */
  #lineGroups(items) {
    const sorted = [...items].sort(
      (a, b) =>
        b.item.transform[5] - a.item.transform[5] ||
        a.item.transform[4] - b.item.transform[4],
    );
    const lines = [];
    let cur = null;
    for (const p of sorted) {
      const y = p.item.transform[5];
      const h = p.item.height || 8;
      if (cur && Math.abs(y - cur.y) < Math.max(cur.h, h) * 0.6) {
        cur.items.push(p);
        cur.h = Math.max(cur.h, h);
      } else {
        cur = { y, h, items: [p] };
        lines.push(cur);
      }
    }
    for (const ln of lines) {
      ln.items.sort((a, b) => a.item.transform[4] - b.item.transform[4]);
      ln.xStart = ln.items[0].item.transform[4];
      const last = ln.items.at(-1).item;
      ln.xEnd = last.transform[4] + (last.width ?? 0);
      ln.text = ln.items.map((p) => p.item.str).join(" ").replace(/\s+/g, " ").trim();
    }
    return lines;
  }

  /**
   * Block-based content recognition (recursive-XY-cut / Docstrum style).
   * Returns the set of text-layer divs to LEAVE on the canvas — every block
   * that is NOT running body text: section headings, figure/table captions,
   * table cells, figure labels, displayed equations, and pseudocode listings.
   *
   * Pipeline:
   *   1. group items into baseline lines (#lineGroups);
   *   2. assign each line to a column region — left / right / full-width — by
   *      the page-centre gutter. A line with text in the gutter band is
   *      full-width (a title, a figure/table spanning both columns); a line
   *      with the gutter empty is split into the two column streams (PDF.js
   *      collapses a left and a right line onto one baseline);
   *   3. cut each stream into blocks at vertical whitespace gaps wider than the
   *      stream's body leading, and at font-size jumps;
   *   4. classify each block; everything that is not body text is skipped.
   * Captions are skipped whole — treated as part of their figure/table.
   */
  #classifyBlocks(allPairs, vx0, pageW, pageH, isSpecial, isBold, isItalic, vy0 = 0) {
    const skip = new Set();
    // Divs whose SURROUNDINGS carry structural canvas art hugging the text (a
    // displayed formula's box frame): masks of neighbouring lines must clamp a
    // margin away from these, not just off their glyphs.
    const protect = new Set();
    const items = allPairs.filter((p) => p.item?.transform && p.item.str.trim());
    const lines = this.#lineGroups(items);
    if (!lines.length) return { skip, protect };

    const centerX = vx0 + pageW * 0.5;
    const LOWER_WORD = /^[a-zà-ÿ]{2,}$/;
    // Caption leaders, section labels, and pseudocode/algorithm leaders.
    const CAP_LEAD = /^(?:Fig(?:ure)?\.?|Tab(?:le)?\.?|TABLE|FIGURE|Algorithm|Listing)\s*\d/;
    const HEAD_LEAD = /^(?:\d+(?:\.\d+)*\.?|[A-Z]\d*[.:]|[IVX]{1,5}\.)(?:$|\s+[A-Z(])/;
    const ALGO_LEAD = /^(?:\d{1,3}:|Require:|Ensure:|Input:|Output:|Algorithm\s+\d+)/;
    // An in-text reference opening a running sentence ("Figure 5 shows …",
    // "Table 8 lists …", "Algorithm 1 in Appendix …", "Listing 3
    // (representative of …"): the label+number is followed by a LOWERCASE word
    // — directly or inside a parenthetical — so it is body prose, not a caption
    // or a listing header (those read "Figure 5: …", "Figure 5. …",
    // "Algorithm 1 StateSynth", or stand alone). Such lines must be
    // emphasized, not skipped.
    // Punctuation after the number may be a run of closers — a WRAPPED in-text
    // ref line can start "Figure 4), and (v) restarting …". A colon is NOT in
    // the class: "Figure 5: …" is always a caption. The parenthetical
    // alternative requires ≥2 lowercase letters so a single-letter SUBFIGURE
    // label — "Figure 5 (a) …", a caption — is not mistaken for prose
    // ("Listing 3 (representative of …" still is).
    const REF_PROSE = /^(?:Fig(?:ure)?|Figs?|Tab(?:le)?|TABLE|FIGURE|Algorithm|Alg|Listing|Section|Sec)\.?\s*\d+[a-z]?\s*(?:[)\],;.]*\s+[a-zà-ÿ]|\(\s*[a-zà-ÿ]{2,})/;
    // Publisher boilerplate markers (permission/copyright block, ISBN/DOI
    // lines, ACM self-citation). Matched against a whole block's text.
    const LEGAL_TEXT = /(Permission to make digital or hard copies|Copyrights? for components of this work|Request permissions from|licensed to ACM|ACM ISBN|ACM Reference Format|©\s*(19|20)\d\d\s|creativecommons\.org|(https?:\/\/)?(dx\.)?doi\.org\/)/i;
    const isCaptionLead = (t) => CAP_LEAD.test(t) && !REF_PROSE.test(t);
    const isAlgoLead = (t) => ALGO_LEAD.test(t) && !REF_PROSE.test(t);

    const lowerWords = (its) => {
      let lc = 0;
      for (const p of its)
        for (const w of p.item.str.trim().split(/\s+/)) if (LOWER_WORD.test(w)) lc++;
      return lc;
    };
    // Column-gap-separated cells in a row (a wide gap = a column boundary). The
    // gap multiplier controls how wide a gap must be to count: the default 1.5×
    // catches column boundaries AND a justified line's stretched inter-word
    // spaces; a larger multiplier (e.g. 3×) catches ONLY true column gaps, since
    // justification never stretches a space that far — used to spot a table row
    // even when a cell holds a prose phrase (whose mask would white out the rules).
    const maxCells = (rows, mult = 1.5) => {
      let m = 0;
      for (const r of rows) {
        let cells = 1;
        for (let k = 1; k < r.items.length; k++) {
          const prev = r.items[k - 1].item;
          const gap = r.items[k].item.transform[4] - (prev.transform[4] + (prev.width ?? 0));
          if (gap > Math.max(prev.height || 8, r.items[k].item.height || 8) * mult) cells++;
        }
        m = Math.max(m, cells);
      }
      return m;
    };
    const specialRatio = (its) => {
      let s = 0;
      let t = 0;
      for (const p of its) {
        const n = p.item.str.trim().length;
        t += n;
        if (isSpecial(p)) s += n;
      }
      return t ? s / t : 0;
    };
    // Aligned-gap table pass (stream level — the block cutter often splits a
    // table into 1-2-row blocks, so this can't run per block). A table's cell
    // boundary produces an inter-item gap containing the SAME x on row after
    // row; justified prose also stretches spaces past 1.4× line height, but at
    // VARYING positions, so consecutive prose rows never share one x. For each
    // stream, find runs of rows sharing a gap-x: ≥3 rows with the gap (rows
    // wholly on one side of x — wrapped description-cell lines, short label
    // cells — are absorbed into the run). Everything in the run is a table:
    // processing its prose cells would lay masks across the table's rules
    // (whiting out row/column lines) and ghost the cell text where the mask is
    // clamped by neighbouring cells. Bullet/numbered lists indent at the row
    // START (no inter-item gap), so they never seed a run.
    // splitX (the page-centre gutter) — when given, gaps containing splitX are
    // NEVER band candidates (a two-column page's merged left+right baselines
    // all share the gutter gap at the same x, which would read as a giant
    // aligned table), and a detected run skips only the row SEGMENT on the
    // band's side of the gutter (so a table in one column can't swallow the
    // other column's body sharing its baselines).
    const skipAlignedTable = (rows, splitX = null) => {
      if (rows.length < 3) return;
      const sorted = rows.slice().sort((a, b) => b.y - a.y); // top → bottom
      const gapsOf = (r) => {
        const g = [];
        for (let k = 1; k < r.items.length; k++) {
          const prev = r.items[k - 1].item;
          const a = prev.transform[4] + (prev.width ?? 0);
          const bx = r.items[k].item.transform[4];
          if (bx - a > Math.max(prev.height || 8, r.items[k].item.height || 8) * 1.4 &&
              !(splitX != null && a < splitX && bx > splitX)) g.push([a, bx]);
        }
        return g;
      };
      // Items of the row segment containing the band (split at the gutter gap
      // when one exists); the whole row when no gutter gap crosses it.
      const segItems = (r, band) => {
        if (splitX == null) return r.items;
        let cut = null;
        for (let k = 1; k < r.items.length; k++) {
          const a = r.items[k - 1].item.transform[4] + (r.items[k - 1].item.width ?? 0);
          const bx = r.items[k].item.transform[4];
          if (a < splitX && bx > splitX && bx - a > 2) { cut = (a + bx) / 2; break; }
        }
        // No gutter gap in this row: it may live entirely in ONE column (a
        // left-only body line swept up while the band sits in the right
        // column). Split at the gutter itself so only the band's side is
        // taken — for such a row that is the empty set, never the whole row.
        const cutX = cut ?? splitX;
        const mid = (band[0] + band[1]) / 2;
        return mid < cutX ? r.items.filter((p) => p.item.transform[4] < cutX) : r.items.filter((p) => p.item.transform[4] >= cutX);
      };
      const gaps = sorted.map(gapsOf);
      // ALL inter-item gaps of a row (no minimum width) — a full cell still
      // leaves its small word-gap at the column boundary.
      const allGapsOf = (r) => {
        const g = [];
        for (let k = 1; k < r.items.length; k++) {
          const prev = r.items[k - 1].item;
          const a = prev.transform[4] + (prev.width ?? 0);
          const bx = r.items[k].item.transform[4];
          if (bx - a > 1) g.push([a, bx]);
        }
        return g;
      };
      for (let i = 0; i < sorted.length; i++) {
        let bestLast = -1;
        let bestBand = null;
        for (const g0 of gaps[i]) {
          // The column boundary is wherever the rows' gaps keep a COMMON
          // interval — cells fill their column to different widths, so probe
          // the running INTERSECTION of gaps, not a fixed x.
          let band = g0.slice();
          let withGap = 1;
          let last = i;
          let ext = i;
          for (let j = i + 1; j < sorted.length; j++) {
            if (sorted[j - 1].y - sorted[j].y > Math.max(sorted[j].h, sorted[j - 1].h) * 2.5) break; // vertical gap — table ended
            // Wide gap intersecting the band → shrink the band, strong row.
            let hit = null;
            for (const [a, b] of gaps[j]) {
              const lo = Math.max(band[0], a);
              const hi = Math.min(band[1], b);
              if (hi - lo >= 1.5 && (!hit || hi - lo > hit[1] - hit[0])) hit = [lo, hi];
            }
            if (hit) { band = hit; withGap++; last = j; ext = j; continue; }
            // No wide gap. A SMALL gap still intersecting the band is a full
            // cell word-breaking at the boundary ("…initi-│Only …"); a row
            // wholly on one side of the band is a wrapped cell line or label.
            // Both extend the table, but at most 2 rows past the last strong
            // row so the run can't creep into the body below. A row COVERING
            // the band with glyphs is running prose — the run is over.
            const smallHit = allGapsOf(sorted[j]).some(([a, b]) => Math.min(band[1], b) - Math.max(band[0], a) >= 1.5);
            const oneSide =
              sorted[j].items.every((p) => p.item.transform[4] + (p.item.width ?? 0) <= band[0] + 1) ||
              sorted[j].items.every((p) => p.item.transform[4] >= band[1] - 1);
            if ((!smallHit && !oneSide) || j - last > 2) break;
            ext = j;
          }
          if (withGap >= 3 && ext > bestLast) { bestLast = ext; bestBand = band; }
        }
        if (bestLast >= 0) {
          if (globalThis.__fxDebug) (globalThis.__fxAligned ??= []).push({ seed: sorted[i].items.map((p) => p.item.str).join(" ").slice(0, 48), band: bestBand.map((v) => Math.round(v)), n: bestLast - i + 1, split: splitX != null, y: Math.round(sorted[i].y), h: Math.round(sorted[i].h * 10) / 10 });
          for (let k = i; k <= bestLast; k++) {
            const seg = segItems(sorted[k], bestBand);
            for (const p of seg) { skip.add(p.div); dbg(p.div, "table-aligned"); }
            // Feed the region pass: a two-column table's single-sided rows (a
            // tall cell's 3rd+ continuation line — "Modify a random byte")
            // extend a run at most 2 rows, so only the REGION fill can absorb
            // the rest; without these extents the table never forms a region.
            if (seg.length) tableLines.push(bandExtent(seg, sorted[k]));
          }
          i = bestLast; // resume after the table
        }
      }
    };

    // Reference body-text height: char-weighted mode over the whole page.
    const hist = new Map();
    for (const p of items) {
      if (!p.item.height) continue;
      const b = Math.round(p.item.height * 2) / 2;
      hist.set(b, (hist.get(b) || 0) + p.item.str.length);
    }
    let dominant = 8;
    let best = 0;
    for (const [b, w] of hist) if (w > best) { best = w; dominant = b; }

    // --- Column model: two-column iff few items cross the centre gutter. ---
    let occupy = 0;
    for (const ln of lines)
      if (ln.items.some((p) => p.item.transform[4] < centerX && p.item.transform[4] + (p.item.width ?? 0) > centerX))
        occupy++;
    const twoColumn = lines.length > 4 && occupy < lines.length * 0.35;

    const left = [];
    const right = [];
    const full = [];
    for (const ln of lines) {
      // An item that actually CROSSES the centre (spans it) ⇒ full-width
      // content: a title, a figure/table spanning both columns, single-column
      // prose. A left- or right-column line merely reaching toward the gutter
      // does NOT cross it, so a merged two-column baseline (left line + right
      // line collapsed by PDF.js, with an empty gutter between) splits into the
      // column streams rather than being mistaken for one wide row. (Using a
      // gutter *band* here would misfire: a column's inner edge sits within a
      // few percent of the centre, so its lines would all read as full-width.)
      const crosses = ln.items.some((p) => {
        const x0 = p.item.transform[4];
        return x0 < centerX && x0 + (p.item.width ?? 0) > centerX;
      });
      if (!twoColumn || crosses) {
        full.push({ y: ln.y, h: ln.h, items: ln.items });
        continue;
      }
      const l = ln.items.filter((p) => p.item.transform[4] < centerX);
      const r = ln.items.filter((p) => p.item.transform[4] >= centerX);
      if (l.length) left.push({ y: ln.y, h: ln.h, items: l });
      if (r.length) right.push({ y: ln.y, h: ln.h, items: r });
    }

    // --- Cut a column stream into blocks at whitespace gaps / size jumps. ---
    const blocksOf = (rows) => {
      if (!rows.length) return [];
      rows = rows.slice().sort((a, b) => b.y - a.y); // top → bottom
      const gaps = [];
      for (let i = 1; i < rows.length; i++) gaps.push(rows[i - 1].y - rows[i].y);
      const pitch = gaps.length
        ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
        : rows[0].h * 1.2;
      const groups = [];
      let cur = [rows[0]];
      for (let i = 1; i < rows.length; i++) {
        const gap = rows[i - 1].y - rows[i].y;
        const dh = Math.abs(rows[i].h - rows[i - 1].h);
        if (gap > Math.max(pitch * 1.5, rows[i].h * 1.8) ||
            dh > Math.max(rows[i].h, rows[i - 1].h) * 0.3) {
          groups.push(cur);
          cur = [];
        }
        cur.push(rows[i]);
      }
      if (cur.length) groups.push(cur);
      return groups.map((rs) => {
        const its = rs.flatMap((r) => r.items);
        let hsum = 0;
        let hc = 0;
        for (const p of its) {
          hsum += (p.item.height || 0) * p.item.str.length;
          hc += p.item.str.length;
        }
        const leadItems = rs[0].items;
        return {
          rows: rs,
          items: its,
          h: hc ? hsum / hc : rs[0].h,
          yTop: rs[0].y,
          yBot: rs.at(-1).y,
          lead: leadItems.map((p) => p.item.str).join(" ").replace(/\s+/g, " ").trim(),
          leadBold: leadItems[0] ? isBold(leadItems[0]) : false,
        };
      });
    };

    const dbg = (div, why) => { if (globalThis.__fxDebug) div.dataset.fxWhy = why; };
    const skipBlock = (b, why) => { for (const p of b.items) { skip.add(p.div); dbg(p.div, why || "block"); } };
    // A run-in heading that opens a body block ("Minimizing duplicate states.
    // We also …" / "A1: … reuse. To address …"): skip the leading bold/glyph
    // run so the heading stays pristine on the canvas (a kept redraw renders
    // lighter), while the rest of the block is emphasized as body.
    const skipLeadRun = (b) => {
      const its = b.rows[0].items;
      for (let j = 0; j < its.length; j++) {
        const t = its[j].item.str.trim();
        const glyphBit = t.length < 2 || !/[A-Za-zÀ-ÿ]/.test(t);
        if (!isSpecial(its[j]) && !glyphBit) break; // first body word
        skip.add(its[j].div);
        dbg(its[j].div, "leadrun");
      }
    };

    const regions = twoColumn ? [left, right, full] : [full];
    for (const region of regions) {
      const blocks = blocksOf(region);
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        const lc = lowerWords(b.items);
        // Cell gaps must come from body-height rows. A block can merge a
        // paragraph with the figure content below it (small-label rows whose
        // height sits just inside the block cutter's 0.3 size tolerance); the
        // figure labels' wide gaps then read as table cells and the whole
        // paragraph is skipped as a table (B p10 §7.3). Off-size rows are
        // figure labels / sub- superscript fragments, never table cells — a
        // real table's rows share the block's height.
        const cells = maxCells(b.rows.filter((r) => r.h >= b.h * 0.8));
        const spc = specialRatio(b.items);
        const offSize = b.h < dominant * 0.82 || b.h > dominant * 1.18;

        // Caption → skip whole block, plus the figure/table body in the block
        // directly above it in this column (figures are captioned below). An
        // in-text "Figure N shows …" prose ref is NOT a caption (REF_PROSE).
        if (isCaptionLead(b.lead)) {
          const prev = blocks[bi - 1];
          if (prev && b.yTop - prev.yBot < pageH * 0.16 && lowerWords(prev.items) < 5) skipBlock(prev, "blk-capprev");
          // A caption is short. A prose-dense caption-led block of ≥3 rows is a
          // caption that block-grouping MERGED with the body paragraph below it
          // (no whitespace gap between them); skipping it whole would drop the
          // body (the round-4 regression — A p10/p14, C p08/p11, F p04, and at
          // ≥3 rows 5GCVerif p03's caption + two body lines). Leave such a
          // block to the dedicated caption pass (which skips only the caption
          // lead + its short continuation) so the body is processed. Genuine
          // short captions still end up fully skipped: 1-2-row caption blocks
          // are skipped whole here, and a 3-4-line dense caption that is spared
          // here is consumed by the caption pass's lead+absorption instead.
          const captionBodyMerged = b.rows.length >= 3 && lc >= b.rows.length * 4;
          if (!captionBodyMerged) skipBlock(b, "blk-caption");
          continue;
        }
        // Pseudocode listing (always skipped, even with prose-looking operands).
        if (isAlgoLead(b.lead)) { skipBlock(b, "blk-algo"); continue; }
        // Publisher legal/metadata blocks (page-1 template furniture): the
        // ACM/IEEE permission-and-copyright statement, ISBN/DOI lines, the
        // "ACM Reference Format" self-citation, and the CCS-concepts line
        // (bullet + arrow taxonomy). Prose-dense, so no other rule catches
        // them, but they are boilerplate, not body text.
        const btext = b.items.map((p) => p.item.str).join(" ");
        // Legal boilerplate is always set smaller than body — the size guard
        // keeps a BODY paragraph that merely cites a DOI from being skipped.
        if (b.h < dominant * 0.95 && LEGAL_TEXT.test(btext)) { skipBlock(b, "blk-legal"); continue; }
        // CCS-concepts line: "X → Y; Z; W." — an arrow plus a semicolon list
        // (the leading bullet is often cut into its own block, so it can't be
        // required). Running prose never combines a literal arrow with a
        // semicolon-separated Title-Case list.
        if (btext.includes("→") && (btext.match(/;/g) || []).length >= 2) { skipBlock(b, "blk-ccs"); continue; }
        // Footnotes: a smaller-than-body block in the page's bottom band that
        // OPENS with a footnote marker — a symbol (•†‡§¶*) or a superscript
        // numeral (a tiny leading item). A plain smaller-than-body cut would
        // wrongly drop small-set appendix/notes prose, so all three signals
        // are required. (Also covers the ACM "authors contributed equally" /
        // "Corresponding Author" notes.)
        const fnLead = b.rows[0]?.items[0];
        const supMark =
          fnLead && fnLead.item.str.trim().length <= 2 &&
          (fnLead.item.height || b.h) < b.h * 0.8;
        if (b.h < dominant * 0.92 && b.yBot - vy0 < pageH * 0.3 &&
            (/^[•†‡§¶*]/.test(b.lead) || supMark)) {
          skipBlock(b, "blk-footnote"); continue;
        }
        // Table: wide column gaps (cells) or special-font label columns. Spare
        // RUNNING PROSE — a justified body line stretches its inter-word spaces
        // wide enough to read as column gaps, but it averages ≥4 lowercase words
        // per line (a table cell has few). Without this, dense body paragraphs
        // and bulleted prose lists are wrongly skipped as tables.
        const proseDense = lc >= b.rows.length * 4;
        if ((cells >= 3 || (spc >= 0.5 && cells >= 2)) && !proseDense) {
          if (globalThis.__fxDebug) (globalThis.__fxBlkStats ??= []).push({ lead: b.lead.slice(0, 48), rows: b.rows.length, cells, spc: +spc.toFixed(2), lc });
          skipBlock(b, "blk-table"); continue;
        }
        // Heading: short, not a sentence, label- / bold- / large-led.
        if (b.rows.length <= 2 && lc <= 3 &&
            (HEAD_LEAD.test(b.lead) || b.leadBold || b.h > dominant * 1.15)) { skipBlock(b, "blk-heading"); continue; }
        // Figure label / displayed equation: almost no prose, with a non-body
        // face, an off-body size, just a few glyphs, or symbol-dense text (a
        // displayed formula like "(regReq/authReq)·(¬(deregReq/deregAcpt))*"
        // is set in a body-sized text face — no font/size signal — but its
        // punctuation density is far above prose; processing it erases the
        // formula's box frame with masks). A short trailing prose line that is
        // an in-text reference ("…in Algorithm 1 in Appendix A.") has few
        // lowercase words but IS body — spare it (REF_PROSE).
        const blockText = b.items.map((p) => p.item.str).join("");
        const nonSpace = blockText.replace(/\s/g, "");
        const punct = nonSpace.length ? (nonSpace.match(/[^A-Za-z0-9À-ɏ]/g) || []).length / nonSpace.length : 0;
        if (lc < 2 && (spc >= 0.3 || offSize || b.items.length <= 3 || punct >= 0.15) && !REF_PROSE.test(b.lead)) { skipBlock(b, "blk-figlabel"); continue; }
        // Off-size block with little prose (footnotes, sub/superscript rows).
        if (offSize && lc < 4) { skipBlock(b, "blk-offsize"); continue; }

        // Body text → process. Strip a leading run-in heading if present.
        if (b.leadBold || HEAD_LEAD.test(b.lead)) skipLeadRun(b);
      }
    }

    // Confirmed table rows (skipped via cells / aligned starts) — collected for
    // the region pass, which fills each table's bounding box so interior rows
    // and multi-line-cell tails that defeat every per-row test still stay on
    // the canvas. Declared here so both aligned passes and the line pass below
    // can contribute.
    const tableLines = [];
    const bandExtent = (band, ln) => ({
      y: ln.y, h: ln.h,
      x0: Math.min(...band.map((p) => p.item.transform[4])),
      x1: Math.max(...band.map((p) => p.item.transform[4] + (p.item.width ?? 0))),
    });

    // Ruled-GRID tables (Proteus Tables 5/6): columns are separated by RULES,
    // not wide whitespace — no inter-item gap reaches the 1.4×h the gap passes
    // need, and wordy description cells veto blk-table (proseDense). Their
    // unmistakable signature: interior items (cells) START at the same x on
    // row after row. Justified prose is typically ONE item per line, and when
    // PDF.js does split a line the split x wanders — 4+ nearby rows sharing an
    // interior start-x do not happen in prose. Bibliographies and numbered
    // lists have exactly ONE interior column (marker + text), so a SEED row
    // must offer ≥2 interior starts; a run dominated by long-prose rows is
    // rejected outright.
    const skipAlignedStarts = (rows) => {
      if (rows.length < 4) return;
      const sorted = rows.slice().sort((a, b) => b.y - a.y); // top → bottom
      const startsOf = (r) => {
        const xs = [];
        for (let k = 1; k < r.items.length; k++) {
          const prev = r.items[k - 1].item;
          const x = r.items[k].item.transform[4];
          if (x - (prev.transform[4] + (prev.width ?? 0)) >= 1) xs.push(x);
        }
        return xs;
      };
      const all = sorted.map(startsOf);
      // A bullet/numbered LIST also aligns its text column: veto runs whose
      // rows mostly open with a bare marker item ("•", "1.", "[13]", "(a)").
      const MARKER = /^(?:[•‣▪◦*–—-]|\(?\[?\d{1,3}\]?[.):]?|\(?[a-z]\))$/;
      for (let i = 0; i < sorted.length; i++) {
        if (!all[i].length) continue; // seed: at least one interior cell start
        // 2-column tables offer a single interior start, so the seed accepts
        // one — but then the run must be LONGER (5 rows) to compensate.
        const need = all[i].length >= 2 ? 4 : 5;
        let last = i;
        const matched = [i];
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[j - 1].y - sorted[j].y > Math.max(sorted[j].h, sorted[j - 1].h, 8) * 2.5) break; // vertical gap — table ended
          if (j - last > 2) break; // two non-matching rows in a row — run over
          if (all[j].some((x) => all[i].some((x0) => Math.abs(x - x0) <= 1.2))) {
            matched.push(j);
            last = j;
          }
        }
        if (matched.length < need) continue;
        // Long-prose rows must not dominate: aligned interior starts across a
        // paragraph would mean 4+ lines split at one x — not seen in prose,
        // but this guard keeps a pathological case from erasing a paragraph.
        const proseRows = matched.filter((k) => lowerWords(sorted[k].items) >= 6).length;
        if (proseRows > matched.length * 0.34) continue;
        const markerRows = matched.filter((k) => MARKER.test(sorted[k].items[0].item.str.trim())).length;
        if (markerRows >= matched.length * 0.5) continue;
        for (const k of matched) {
          for (const p of sorted[k].items) { skip.add(p.div); dbg(p.div, "table-starts"); }
          tableLines.push(bandExtent(sorted[k].items, sorted[k]));
        }
        i = last;
      }
    };

    // Prose-cell tables (see skipAlignedTable): detected per stream, across
    // block boundaries. ALSO run over the unsplit lines — a table row whose
    // cell protrudes past the page centre is assigned to the full stream while
    // its neighbours go to left/right, hiding the table from every stream; the
    // whole-line pass sees them adjacent again (the gutter is excluded from
    // band candidates and the skip is segment-bounded, so merged two-column
    // body baselines are never swept).
    for (const region of regions) {
      skipAlignedTable(region);
      skipAlignedStarts(region);
    }
    if (twoColumn) skipAlignedTable(lines, centerX);

    // Line-level heading pass (independent of block grouping, which can merge a
    // heading line into the paragraph below it). At each column's start: a short
    // label-led line that is not a sentence ("I. INTRODUCTION", "C. Automated
    // Frequency …", "9.2.3 Mishandling …") is skipped whole — in ANY font, so
    // regular-weight / italic IEEE section titles are caught; a sentence-shaped
    // bold lead ("A1: … reuse. To address …") skips only its leading bold run.
    const skipHeadingRun = (its, a) => {
      for (let j = a; j < its.length; j++) {
        const t = its[j].item.str.trim();
        const glyphBit = t.length < 2 || !/[A-Za-zÀ-ÿ]/.test(t);
        if (!isSpecial(its[j]) && !glyphBit) break; // first body word
        skip.add(its[j].div);
        dbg(its[j].div, "runin");
      }
    };
    // Styled (often UNDERLINED) italic run-in lead: "Establishing
    // privacy-preserving mutual authentication …:" / "P1: Preventing identity
    // exposure:" opening a paragraph. Processing it would erase the underline
    // (canvas art hugging the glyphs) with the mask, so keep the italic run on
    // the canvas — same policy as bold run-ins. Only runs that OPEN the line
    // and terminate at a COLON qualify (possibly wrapping onto the next 1-2
    // lines); ordinary inline italic emphasis stays processed. Short UPRIGHT
    // entity names inside the italics ("… between UE and gNB under MA+:") may
    // interleave; a longer roman word ends the run (ordinary body follows).
    const skipItalicLead = (ln, its, a, bx0, bx1) => {
      const runDivs = [];
      let ended = false;
      let rows = 0;
      for (let m = lines.indexOf(ln); m < lines.length && rows < 3 && !ended; m++, rows++) {
        const bandM = (rows === 0 ? its.slice(a) : lines[m].items).filter(
          (p) => p.item.transform[4] >= bx0 && p.item.transform[4] < bx1,
        );
        if (!bandM.length) break;
        let any = false;
        for (const p of bandM) {
          const t = p.item.str.trim();
          const glyphBit = t.length < 2 || !/[A-Za-zÀ-ÿ]/.test(t);
          const shortRoman = t.length <= 5;
          if (!isItalic(p) && !glyphBit && !shortRoman) { ended = true; break; }
          runDivs.push(p);
          any = true;
          if (/:\s*$/.test(t)) { ended = true; break; }
        }
        if (!any) break;
      }
      // Qualify only when the run terminates at a colon (a lead-in), not for a
      // full italic sentence or block (quotes, definitions, theorem bodies).
      if (ended && runDivs.length && /:\s*$/.test(runDivs.at(-1).item.str.trim())) {
        for (const p of runDivs) { skip.add(p.div); protect.add(p.div); dbg(p.div, "runin-ital"); }
      }
    };
    for (const ln of lines) {
      const its = ln.items;
      const starts = [0];
      if (twoColumn) {
        const r = its.findIndex((p) => p.item.transform[4] >= centerX);
        if (r > 0) starts.push(r);
      }
      for (const a of starts) {
        const lead = its[a];
        if (!lead) continue;
        const leadStr = lead.item.str.trim();
        const ax = lead.item.transform[4];
        const bx0 = twoColumn && ax >= centerX ? centerX : vx0;
        const bx1 = twoColumn && ax < centerX ? centerX : vx0 + pageW;
        const band = its.filter((p) => p.item.transform[4] >= bx0 && p.item.transform[4] < bx1);
        if (isAlgoLead(leadStr)) {
          // Pseudocode line ("10: while learning not terminate do"): the whole
          // line is a listing, even though its regular-font operands read as
          // prose between bold keywords.
          for (const p of band) { skip.add(p.div); dbg(p.div, "line-algo"); }
        } else if (HEAD_LEAD.test(leadStr)) {
          if (lowerWords(band) <= 3) {
            for (const p of band) {
              skip.add(p.div);
              dbg(p.div, "line-head");
              // An italic-led heading line is often UNDERLINED ("P1:
              // Preventing identity exposure:"); protect it so the next
              // line's mask padding clamps a margin below the underline
              // instead of exactly at the em box (which erases the line).
              if (isItalic(lead)) protect.add(p.div);
            }
          }
          else if (isSpecial(lead)) skipHeadingRun(its, a);
          // A label-led sentence whose label + lead-in is styled italic
          // ("P1: Preventing identity exposure: During both …") — skip the
          // underlined italic lead run, process the rest as body.
          else if (isItalic(lead)) skipItalicLead(ln, its, a, bx0, bx1);
        } else if (maxCells([{ items: band }]) >= 4 && lowerWords(band) < 4) {
          // A table row that block grouping merged into a text block: several
          // wide column gaps on one baseline. Running prose is spared (a
          // justified line shows wide gaps but has ≥4 lowercase words).
          for (const p of band) { skip.add(p.div); dbg(p.div, "line-cells"); }
          if (band.length) tableLines.push(bandExtent(band, ln));
        } else if (maxCells([{ items: band }], 2.2) >= 4) {
          // A table row whose cell holds a full phrase (so it has ≥4 lowercase
          // words and escapes the rule above): if it ALSO has ≥4 wide gaps
          // (>2.2× line height — true column boundaries that justification never
          // produces, as its stretched spaces stay well under that), it is still
          // a table row. Skip it so its mask doesn't white out the table's rules
          // and make the table unreadable (F3).
          for (const p of band) { skip.add(p.div); dbg(p.div, "line-cells-wide"); }
          if (band.length) tableLines.push(bandExtent(band, ln));
        } else if (band.length >= 3 && lowerWords(band) === 0 &&
                   (() => { const t = band.map((p) => p.item.str).join("").replace(/\s/g, ""); return t.length >= 8 && ((t.match(/[^A-Za-z0-9À-ɏ]/g) || []).length / t.length) >= 0.15; })()) {
          // Displayed formula in a body-sized TEXT face ("(regReq/authReq) ·
          // (¬(deregReq/deregAcpt))* · (authRsp/SMCmd)"): no font/size signal,
          // and its camelCase identifiers pass the per-span word check — but a
          // formula line has NO lowercase dictionary words and far more
          // punctuation than prose. Processing it erases its box frame /
          // operators with masks; keep the whole line on the canvas.
          for (const p of band) { skip.add(p.div); protect.add(p.div); dbg(p.div, "line-formula"); }
        } else if (isBold(lead)) {
          skipHeadingRun(its, a);
        } else if (isItalic(lead) && !skip.has(lead.div)) {
          skipItalicLead(ln, its, a, bx0, bx1);
        } else if (!skip.has(lead.div) && /^[A-Z]/.test(leadStr) &&
                   ax > bx0 + (lead.item.height || 8) * 0.6) {
          // Regular-weight run-in heading, usually UNDERLINED ("Effectiveness
          // of ConnSentinel. On our dataset …"): an INDENTED paragraph start
          // opening with a short sentence — ≤5 words ending in a period,
          // followed by more prose. There is no font signal (not bold, not
          // italic), but processing it erases the underline with the mask.
          // Skip + protect just the short lead run; the paragraph body after
          // it is processed normally. A paragraph whose first sentence is
          // genuinely short loses emphasis on ≤5 words — harmless — and
          // non-indented (justified) lines never enter this branch.
          const runDivs = [];
          let words = 0;
          let closed = false;
          for (let j = a; j < its.length && !closed; j++) {
            const t = its[j].item.str.trim();
            words += t ? t.split(/\s+/).length : 0;
            if (words > 5) break;
            runDivs.push(its[j]);
            if (/[.]\s*$/.test(t)) closed = true;
          }
          if (closed && runDivs.length && runDivs.at(-1) !== its.at(-1)) {
            for (const p of runDivs) { skip.add(p.div); protect.add(p.div); dbg(p.div, "runin-short"); }
          }
        }
      }
    }

    // Table-region pass (F3). A table row whose cell holds a full phrase (≥4
    // lowercase words), or a tall cell's wrapped continuation lines (only that
    // cell's words, no column gaps), escape the per-row table tests above and
    // would be processed — the resulting white masks then cover the table's
    // rules and make it unreadable. Group the CONFIRMED table rows (skipped via
    // cells, ≥4 wide gaps & few lowercase words — justified prose never qualifies)
    // into table regions and skip every span inside each region's bounding box,
    // so the whole table stays on the canvas. Body above/below the table is
    // outside the box; justified prose forms no region.
    if (tableLines.length >= 2) {
      const rowsT = tableLines.slice().sort((a, b) => b.y - a.y); // top → bottom
      const regions = [];
      for (const t of rowsT) {
        const reg = regions.find((r) =>
          r.yBot - t.y >= -1 && r.yBot - t.y < Math.max(t.h, r.h) * 4 && t.x0 < r.x1 + 2 && t.x1 > r.x0 - 2);
        if (reg) { reg.yBot = Math.min(reg.yBot, t.y); reg.x0 = Math.min(reg.x0, t.x0); reg.x1 = Math.max(reg.x1, t.x1); reg.h = Math.max(reg.h, t.h); reg.n++; }
        else regions.push({ yTop: t.y, yBot: t.y, x0: t.x0, x1: t.x1, h: t.h, n: 1 });
      }
      // Absorb the table's TAIL: rows of multi-line bottom cells sit below the
      // last CONFIRMED (gap-qualified) row — their sub-lines carry only one
      // cell's words, so no row test fires and they'd be processed ("Replay
      // protected messages" under a "Send plaintext messages" cell). Chain the
      // region bottom downward through rows whose in-region slice is not
      // running prose (<4 lowercase words); the first prose row ends the chain.
      for (const reg of regions) {
        if (reg.n < 2) continue;
        let extended = true;
        while (extended) {
          extended = false;
          for (const ln of lines) {
            const inReg = ln.items.filter((p) => {
              const x = p.item.transform[4];
              return x >= reg.x0 - 2 && x + (p.item.width ?? 0) / 2 <= reg.x1 + 2;
            });
            if (!inReg.length) continue;
            const y = inReg[0].item.transform[5];
            const h = Math.max(reg.h, inReg[0].item.height || 0);
            if (y >= reg.yBot - 0.5 || reg.yBot - y > h * 2.4) continue;
            // A wordy row is running prose when it starts at the region's
            // left edge OR spans most of the region's width (an INDENTED
            // paragraph-opening line under the table still fills the column).
            // A tall cell's wordy continuation line ("Generate a string with
            // the same length") starts at its CELL column and spans only that
            // column — absorb it.
            if (lowerWords(inReg) >= 4) {
              const rx0 = Math.min(...inReg.map((p) => p.item.transform[4]));
              const rx1 = Math.max(...inReg.map((p) => p.item.transform[4] + (p.item.width ?? 0)));
              if (rx0 <= reg.x0 + 3 || rx1 - rx0 >= (reg.x1 - reg.x0) * 0.75) continue;
            }
            reg.yBot = y;
            extended = true;
          }
        }
      }
      if (globalThis.__fxDebug) {
        (globalThis.__fxRegions ??= []).push({
          page: globalThis.__fxCurPage,
          lines: tableLines.map((t) => ({ y: Math.round(t.y), x0: Math.round(t.x0), x1: Math.round(t.x1), h: Math.round(t.h * 10) / 10 })),
          regions,
        });
      }
      for (const reg of regions) {
        if (reg.n < 2) continue; // a single stray multi-gap row isn't a table
        for (const p of items) {
          if (skip.has(p.div)) continue;
          const y = p.item.transform[5];
          const x = p.item.transform[4];
          // The span's horizontal CENTER must sit inside the region, not just
          // its start: the neighbouring column's prose can begin at the
          // region's right edge + the 2-unit slack (Table 1's rotated
          // Pre-/Post-conn. labels reach x=313; §3.2's wrapped lines start at
          // x=315 and run 243 units right — clearly not cell content).
          if (
            y <= reg.yTop + reg.h * 0.5 &&
            y >= reg.yBot - reg.h * 1.2 &&
            x >= reg.x0 - 2 &&
            x + (p.item.width ?? 0) / 2 <= reg.x1 + 2
          ) {
            skip.add(p.div);
            dbg(p.div, "table-region");
            if (globalThis.__fxDebug) (reg.hits ??= []).push(p.item.str.slice(0, 28));
          }
        }
      }
    }

    // Caption pass (independent of block grouping). A "Figure N" / "Table N" /
    // "Algorithm N" leader at a column start marks a caption; skip its column
    // band on that baseline and the following tightly-spaced same-size lines
    // (multi-line captions and legends), so the whole caption stays on the
    // canvas as part of its figure/table. The caption's band is full-width when
    // its own line carries text across the gutter (a spanning legend).
    for (let k = 0; k < lines.length; k++) {
      const its = lines[k].items;
      const starts = [0];
      if (twoColumn) {
        const r = its.findIndex((p) => p.item.transform[4] >= centerX);
        if (r > 0) starts.push(r);
      }
      for (const a of starts) {
        const lead = its[a];
        if (!lead || !isCaptionLead(lead.item.str.trim())) continue;
        const ax = lead.item.transform[4];
        // Full-width (spanning legend) only when an item actually crosses the
        // centre; a column caption merely reaching the gutter stays in-column,
        // so the opposite column's body on that baseline isn't swept up.
        const capCrosses = lines[k].items.some((p) => {
          const x0 = p.item.transform[4];
          return x0 < centerX && x0 + (p.item.width ?? 0) > centerX;
        });
        const wide = !twoColumn || capCrosses;
        const bx0 = wide ? vx0 : ax < centerX ? vx0 : centerX;
        const bx1 = wide ? vx0 + pageW : ax < centerX ? centerX : vx0 + pageW;
        const inBand = (p) => p.item.transform[4] >= bx0 && p.item.transform[4] < bx1;
        const leadH = lines[k].h;
        // A body paragraph can WRAP so that "Figure 4." lands at a line start
        // ("… as shown in ⏎ Figure 4. To resolve ψ1 …" — B p10 §7.3). That
        // line is a mid-paragraph continuation, not a caption: the line
        // directly above it in the same band is running prose at normal
        // leading and the same size. A real caption's upstairs neighbour is
        // figure/table content (sparse or off-size) or a whitespace gap.
        if (k > 0) {
          const above = lines[k - 1];
          const aboveBand = above.items.filter(inBand);
          const pitch = above.y - lines[k].y;
          if (aboveBand.length && pitch > 0 &&
              pitch <= Math.max(leadH, above.h) * 1.45 &&
              Math.abs(above.h - leadH) <= leadH * 0.2 &&
              lowerWords(aboveBand) >= 3) continue;
        }
        let prevY = lines[k].y;
        for (const p of lines[k].items.filter(inBand)) { skip.add(p.div); dbg(p.div, "caption"); }
        // Absorb the caption's own continuation lines only — captions are
        // short. A small line cap and a tighter gap stop the sweep from
        // running on into the body paragraph that follows the caption.
        for (let m = k + 1, absorbed = 0; m < lines.length && absorbed < 4; m++) {
          const bandM = lines[m].items.filter(inBand);
          if (!bandM.length) continue;
          // A paragraph break (the body paragraph after the caption) shows a
          // slightly larger gap than caption-internal leading; 1.3× catches it
          // while sparing tight multi-line captions (F2: stop eating body).
          if (prevY - lines[m].y > Math.max(leadH, lines[m].h) * 1.3) break; // gap
          if (Math.abs(lines[m].h - leadH) > leadH * 0.2) break; // size change
          if (isCaptionLead(bandM[0].item.str.trim())) break; // next caption
          // A new in-text reference sentence ("Figure 8 shows …") is body prose,
          // not caption continuation — stop absorbing here.
          if (REF_PROSE.test(bandM.map((p) => p.item.str).join(" "))) break;
          // A bold run-in heading ("Evaluating collaborative learning.") opens a
          // new body paragraph below the caption — stop before swallowing it.
          if (isBold(bandM[0])) break;
          for (const p of bandM) { skip.add(p.div); dbg(p.div, "caption-absorb"); }
          prevY = lines[m].y;
          absorbed++;
        }
      }
    }
    return { skip, protect };
  }

  /** Dominant body-text height (weighted by character count). */
  #dominantHeight(pairs) {
    const counts = new Map();
    for (const { item } of pairs) {
      if (!item?.height || !item.str.trim()) continue;
      const bucket = Math.round(item.height * 2) / 2;
      counts.set(bucket, (counts.get(bucket) || 0) + item.str.length);
    }
    let best = 0;
    let height = null;
    for (const [bucket, weight] of counts) {
      if (weight > best) {
        best = weight;
        height = bucket;
      }
    }
    return height;
  }

  #fontFamilyFor(pair) {
    const mode = this.#settings.fontMode ?? "original";
    if (FONT_STACKS[mode]) return FONT_STACKS[mode];
    if (pair.item?.fontName) {
      const fallback = pair.style?.fontFamily || "sans-serif";
      return `"${pair.item.fontName}", ${fallback}`;
    }
    return null; // keep whatever PDF.js set
  }

  /**
   * Browser ascent ratio — fontBoundingBoxAscent / (ascent + descent) — for a
   * CSS font-family, measured exactly as PDF.js's TextLayer measures it. PDF.js
   * positions every text span's `top` as `baseline − fontHeight × ascentRatio`
   * using the ratio of the font IT assigned (often a generic substitute), so
   * the rendered baseline lands on the canvas baseline. When we swap in the
   * embedded (or a bundled) face whose ratio differs, the baseline slides — the
   * glyphs render visibly higher/lower than the canvas, and the box-derived
   * mask misses the canvas descenders. The ratio difference is the exact
   * em-relative shift needed to re-seat the baseline. Cached per family.
   */
  #ascentRatio(fontFamily) {
    if (!fontFamily) return 0.8;
    if (this.#ascentCache.has(fontFamily)) return this.#ascentCache.get(fontFamily);
    let ratio = 0.8;
    try {
      this.#measureCtx ??= document.createElement("canvas").getContext("2d");
      this.#measureCtx.font = `100px ${fontFamily}`;
      const m = this.#measureCtx.measureText("Hxbdfhklgjpqy");
      const asc = m.fontBoundingBoxAscent;
      const desc = Math.abs(m.fontBoundingBoxDescent ?? 0);
      if (asc && asc + desc > 0) ratio = asc / (asc + desc);
    } catch {
      /* metrics unavailable — keep default */
    }
    this.#ascentCache.set(fontFamily, ratio);
    return ratio;
  }

  /**
   * RENDERED alphabetic-baseline position for a CSS font-family, as a fraction
   * of font-size, measured the way the browser actually lays the font out
   * (line-height:1) — which can differ from the glyph bounding-box ascent
   * (#ascentRatio) that PDF.js positions with. A zero-height inline marker with
   * `vertical-align:baseline` sits exactly on the baseline; its offset from the
   * line-box top is the ratio. This is what we must match when we swap fonts:
   * the embedded face's rendered baseline lands elsewhere than the substitute's
   * bbox ascent, which is why the overlay drifted up. Cached per family.
   */
  #baselineRatio(fontFamily) {
    if (!fontFamily) return 0.8;
    const key = "bl:" + fontFamily;
    if (this.#ascentCache.has(key)) return this.#ascentCache.get(key);
    let ratio = 0.8;
    try {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;line-height:1;font-size:1000px;font-family:" +
        fontFamily;
      probe.textContent = "Hxbdfhklgjpqy";
      const marker = document.createElement("span");
      marker.style.cssText =
        "display:inline-block;width:1px;height:0;vertical-align:baseline";
      probe.append(marker);
      document.body.append(probe);
      const pr = probe.getBoundingClientRect();
      const mr = marker.getBoundingClientRect();
      if (pr.height > 0) ratio = (mr.top - pr.top) / pr.height;
      probe.remove();
    } catch {
      /* keep default */
    }
    this.#ascentCache.set(key, ratio);
    return ratio;
  }

  /**
   * Long, thin dark runs on the PAINTED page canvas — table rules, box frames,
   * underlines, footnote separators — returned as viewport-CSS rects. This is
   * canvas ART the text layer knows nothing about, so masks must clamp around
   * these exactly like text obstacles (otherwise a processed neighbour's mask
   * whites out the rule/underline). Best-effort: returns [] when the canvas is
   * unavailable or not yet painted (off-screen prefetch) — correctness never
   * depends on it, coverage just improves when it works. The canvas is painted
   * before textlayerrendered fires, so the visible-page process pass sees it.
   * Guards against false positives from glyph rows: a run must be ≥60 CSS px
   * long, ≤3 CSS px thick after band-merge, and ISOLATED (the rows just above
   * and below the band are mostly light within its x-extent — an in-glyph row
   * fails because the glyphs continue above/below).
   */
  #detectCanvasRules(pageView) {
    const out = [];
    try {
      const canvas = pageView.canvas || pageView.div.querySelector("canvas");
      if (!canvas || !canvas.width) return out;
      const cr = canvas.getBoundingClientRect();
      if (!(cr.width > 0) || !(cr.height > 0)) return out;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let data;
      try { data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; } catch { return out; }
      const W = canvas.width, H = canvas.height;
      const sx = cr.width / W, sy = cr.height / H;
      const isDark = (x, y) => { const i = (y * W + x) * 4; return data[i + 3] > 40 && 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 140; };
      const darkFrac = (x0, x1, y) => {
        if (y < 0 || y >= H) return 0;
        let n = 0, d = 0;
        for (let x = x0; x < x1; x += 2) { n++; if (isDark(x, y)) d++; }
        return n ? d / n : 0;
      };
      const minLen = Math.max(24, Math.round(60 / sx)); // ≥60 CSS px
      const maxThick = Math.max(2, Math.round(3 / sy)); // ≤3 CSS px
      // Horizontal runs per row → merge vertically adjacent runs into bands.
      const bands = []; // {y0,y1,x0,x1}
      for (let y = 0; y < H; y++) {
        let run = 0, x0 = 0;
        for (let x = 0; x <= W; x++) {
          if (x < W && isDark(x, y)) { if (!run) x0 = x; run++; continue; }
          if (run >= minLen) {
            const x1 = x;
            const prev = bands.findLast?.((b) => b.y1 === y - 1 && x0 < b.x1 + 4 && x1 > b.x0 - 4) ??
              bands.slice().reverse().find((b) => b.y1 === y - 1 && x0 < b.x1 + 4 && x1 > b.x0 - 4);
            if (prev) { prev.y1 = y; prev.x0 = Math.min(prev.x0, x0); prev.x1 = Math.max(prev.x1, x1); }
            else if (bands.length < 800) bands.push({ y0: y, y1: y, x0, x1 });
          }
          run = 0;
        }
      }
      for (const b of bands) {
        if (b.y1 - b.y0 + 1 > maxThick) continue; // too thick — a filled area/image
        // Isolation: rows just outside the band are mostly light in its span.
        if (darkFrac(b.x0, b.x1, b.y0 - 2) > 0.35 || darkFrac(b.x0, b.x1, b.y1 + 2) > 0.35) continue;
        out.push({
          left: cr.left + b.x0 * sx - 1,
          right: cr.left + b.x1 * sx + 1,
          top: cr.top + b.y0 * sy - 1,
          bottom: cr.top + (b.y1 + 1) * sy + 1,
        });
        if (out.length >= 400) break;
      }
      // Vertical rules (cell borders, listing frames) — the same scan
      // transposed. Column step 1, run down y; merge horizontally adjacent.
      const darkFracV = (y0, y1, x) => {
        if (x < 0 || x >= W) return 0;
        let n = 0, d = 0;
        for (let y = y0; y < y1; y += 2) { n++; if (isDark(x, y)) d++; }
        return n ? d / n : 0;
      };
      const minLenV = Math.max(24, Math.round(60 / sy));
      const maxThickV = Math.max(2, Math.round(3 / sx));
      const vbands = []; // {x0,x1,y0,y1}
      for (let x = 0; x < W; x++) {
        let run = 0, y0 = 0;
        for (let y = 0; y <= H; y++) {
          if (y < H && isDark(x, y)) { if (!run) y0 = y; run++; continue; }
          if (run >= minLenV) {
            const y1 = y;
            const prev = vbands.slice().reverse().find((b) => b.x1 === x - 1 && y0 < b.y1 + 4 && y1 > b.y0 - 4);
            if (prev) { prev.x1 = x; prev.y0 = Math.min(prev.y0, y0); prev.y1 = Math.max(prev.y1, y1); }
            else if (vbands.length < 400) vbands.push({ x0: x, x1: x, y0, y1 });
          }
          run = 0;
        }
      }
      for (const b of vbands) {
        if (b.x1 - b.x0 + 1 > maxThickV) continue;
        if (darkFracV(b.y0, b.y1, b.x0 - 2) > 0.35 || darkFracV(b.y0, b.y1, b.x1 + 2) > 0.35) continue;
        out.push({
          left: cr.left + b.x0 * sx - 1,
          right: cr.left + (b.x1 + 1) * sx + 1,
          top: cr.top + b.y0 * sy - 1,
          bottom: cr.top + b.y1 * sy + 1,
        });
        if (out.length >= 700) break;
      }
    } catch {
      /* best-effort */
    }
    return out;
  }

  /** True when the item is set in a math/symbol/mono/small-caps/bold face.
   *  The font objects are already resolved in commonObjs once the canvas has
   *  rendered. */
  #isSpecialFont(pageView, fontName, cache) {
    if (!fontName) return false;
    if (cache.has(fontName)) return cache.get(fontName);
    let special = false;
    try {
      const font = pageView.pdfPage.commonObjs.get(fontName);
      special = SPECIAL_FONT.test(font?.name ?? "");
    } catch {
      /* font not resolved — assume regular text */
    }
    cache.set(fontName, special);
    return special;
  }

  /** True when the item is set in a bold/medium display face (a subset of the
   *  special faces) — used to spot unlabelled bold run-in headings. */
  #isBoldFont(pageView, fontName, cache) {
    if (!fontName) return false;
    if (cache.has(fontName)) return cache.get(fontName);
    let bold = false;
    try {
      const font = pageView.pdfPage.commonObjs.get(fontName);
      bold = BOLD_FONT.test(font?.name ?? "");
    } catch {
      /* font not resolved — assume regular text */
    }
    cache.set(fontName, bold);
    return bold;
  }

  /** True when the item is set in an italic/oblique face — used to spot
   *  underlined italic run-in leads (see ITALIC_FONT). */
  #isItalicFont(pageView, fontName, cache) {
    if (!fontName) return false;
    if (cache.has(fontName)) return cache.get(fontName);
    let italic = false;
    try {
      const font = pageView.pdfPage.commonObjs.get(fontName);
      italic = ITALIC_FONT.test(font?.name ?? "");
    } catch {
      /* font not resolved — assume regular text */
    }
    cache.set(fontName, italic);
    return italic;
  }

  async #processPage(pageView) {
    const pageNumber = pageView.id;
    // A re-render (zoom) replaces the text layer DOM; drop any stale run.
    const prev = this.#pending.get(pageNumber);
    if (prev) {
      prev.cancelled = true;
      prev.resolve();
    }
    // A zoom/resize KEEPS the text-layer DOM and re-lays it out in place
    // (TextLayer.update): PDF.js overwrites --scale-x measuring the span's
    // plain text, while our pixel-unit word-spacing and mask geometry go
    // stale. Restore to pristine synchronously — the page shows its native
    // rendering rather than a half-stale hybrid — then process fresh below.
    this.#restorePage(pageView);
    const holder = { cancelled: false };
    holder.promise = new Promise((resolve) => (holder.resolve = resolve));
    this.#pending.set(pageNumber, holder);

    const allPairs = await this.#pagePairs(pageView);
    // External-link annotations are the PDF's own metadata for URLs/emails:
    // text under them stays canvas-rendered (original color) and clickable
    // through the native annotation layer — this also covers URLs wrapped
    // across lines, where each line has its own annotation rectangle.
    let urlRects = [];
    try {
      const annotations = await pageView.pdfPage.getAnnotations();
      urlRects = annotations
        .filter((a) => a.subtype === "Link" && (a.url || a.unsafeUrl))
        .map((a) => a.rect); // [x0, y0, x1, y1] PDF coords
    } catch {
      /* no annotations — regex-based URL handling still applies */
    }
    if (holder.cancelled) {
      holder.resolve();
      return holder.promise;
    }

    pageView.div.querySelector(".fx-mask")?.remove();
    const textLayerDiv = pageView.textLayer.div;
    const mask = document.createElement("div");
    mask.className = "fx-mask";
    mask.setAttribute("aria-hidden", "true");
    textLayerDiv.before(mask);

    // Main-text filter. Left to the canvas untouched:
    //  - tabular rows (3+ gap-separated cells on one baseline),
    //  - smaller-than-body text (figure labels, footnotes) and caption lines,
    //  - larger-than-body text (paper title, section headings),
    //  - math/symbol faces,
    //  - running headers/footers and the left/right margins (page numbers,
    //    proceedings lines, arXiv watermarks),
    //  - front matter before the Abstract heading (title/authors/emails),
    //  - the bibliography region (setRefsRegion) — appendices after it are
    //    processed normally.
    const [vx0, vy0, vx1, vy1] = pageView.pdfPage.view;
    const pageW = vx1 - vx0;
    const pageH = vy1 - vy0;
    const fontCache = new Map();
    const boldCache = new Map();
    const italicCache = new Map();
    const isSpecial = (p) =>
      this.#isSpecialFont(pageView, p.item?.fontName, fontCache);
    const isBold = (p) =>
      this.#isBoldFont(pageView, p.item?.fontName, boldCache);
    const isItalic = (p) =>
      this.#isItalicFont(pageView, p.item?.fontName, italicCache);
    const refsBoxes = this.#refsBoxes?.get(pageNumber);
    const inRefsBox = (item) => {
      if (!refsBoxes || !item?.transform) return false;
      const x = item.transform[4];
      const y = item.transform[5];
      return refsBoxes.some(
        (b) => y >= b.y0 && y <= b.y1 && x >= b.x0 - 2 && x <= b.x1 + 2,
      );
    };
    if (globalThis.__fxDebug) globalThis.__fxCurPage = pageNumber;
    const { skip: skipSet, protect: protectSet } = this.#classifyBlocks(allPairs, vx0, pageW, pageH, isSpecial, isBold, isItalic, vy0);
    for (const d of skipSet) d.dataset.fxTable = "1"; // debug/test marker
    // Tag bibliography-region spans so the references feature can skip annotating
    // the reference list's own "[N]" entry markers with citation cards (F1).
    for (const p of allPairs) if (p.div && inRefsBox(p.item)) p.div.dataset.fxRefs = "1";
    // Body-text height for the size filter. Prefer the document-wide body
    // height (from the references extractor, which reads every page) — a single
    // page can be dominated by small text (an appendix beside a big table, a
    // page of footnotes), skewing a per-page mode small and then dropping real
    // body prose as "larger than body". Fall back to the per-page mode until
    // the document-wide value arrives.
    const dominant =
      this.#bodyHeight ||
      this.#dominantHeight(
        allPairs.filter((p) => !skipSet.has(p.div) && !inRefsBox(p.item)),
      );
    // Document-level cut from setContentStart; until it arrives, a per-page
    // fast path keeps the common single-cover case (Abstract on page 1) right.
    // y grows upward in PDF coordinates: "above the heading" means y greater.
    let contentStart = this.#contentStart;
    if (!contentStart && pageNumber === 1) {
      const abstractPair = allPairs.find((p) => p.item && ABSTRACT.test(p.item.str));
      if (abstractPair) {
        contentStart = {
          page: 1,
          y: abstractPair.item.transform[5],
          h: abstractPair.item.height,
        };
      }
    }
    // Sub/superscript fragments (kept on canvas, F19). Collected up front so
    // the candidate filter can ALSO keep the text a script attaches to —
    // processing the base while its script stays canvas splits one
    // expression across two layers and the pair drifts apart.
    const scriptFrags = [];
    if (dominant) {
      for (const p of allPairs) {
        const it = p.item;
        if (!it?.height || !it.transform || it.height >= dominant * 0.8) continue;
        const t = (it.str || "").trim();
        if (!t || t.length > 4) continue;
        scriptFrags.push({
          x0: it.transform[4],
          x1: it.transform[4] + (it.width ?? 0),
          y: it.transform[5],
        });
      }
    }
    const pairs = allPairs.filter((pair) => {
      const { div, item } = pair;
      if (!div?.isConnected || div.dataset.fxDone) return false;
      const text = div.textContent;
      const trimmed = text ? text.trim() : "";
      if (!trimmed) return false;
      // Math/special glyphs stay on the CANVAS in the document's own face and
      // are never processed: a special-font run (math/mono/small-caps/bold
      // display), a span with no Latin letters (subscripts, operators,
      // bracketed numbers), or a single character (an italic variable like "I",
      // a lone digit/paren). PDF.js renders the text layer in a generic
      // substitute face, so re-drawing these would change the math's font and
      // weight; instead we leave them exactly as the document set them. They
      // are picked up as obstacles (see obstacleDivs), so neighbouring per-span
      // masks clamp around them and never white them out.
      if (isSpecial({ item }) || !/[A-Za-zÀ-ɏ]/.test(trimmed) || trimmed.length < 2) {
        return false;
      }
      // Sub/superscripts of math symbols — the "out"/"in"/"dev" under γ, S,
      // M — are set well below body size and are only a few characters.
      // They belong to the math cluster on the canvas: re-drawing such a
      // fragment ghosts it a fraction off its glyph and its mask can nick
      // the parent symbol. Footnotes/appendix small text are unaffected
      // (their spans are full words/lines, not ≤4-char fragments).
      if (dominant && item?.height && item.height < dominant * 0.8 && trimmed.length <= 4) {
        return false;
      }
      // Block classification (#classifyBlocks) owns content-type: anything not
      // body text — headings, captions, tables, figures, equations — is here.
      if (skipSet.has(div)) return false;
      // Backup net for an over-sized heading/title the block pass let through.
      // Only the LARGER-than-body cut remains: a smaller-than-body cut would
      // drop legitimate small body text (footnotes, and appendices or notes set
      // a point smaller than the main body). The threshold is the DOCUMENT body
      // height, so a small-text-heavy page can't skew it and clip real prose.
      if (dominant && item?.height && item.height > dominant * 1.2) {
        return false;
      }
      // …and the TEXT such a script attaches to: a candidate with a kept
      // sub/superscript fragment hugging its edge (vertically offset from
      // its own baseline) is part of that expression — keep it whole on the
      // canvas rather than splitting it across layers.
      if (scriptFrags.length && item?.transform && item?.height) {
        const sx0 = item.transform[4];
        const sx1 = sx0 + (item.width ?? 0);
        const sy = item.transform[5];
        for (const f of scriptFrags) {
          // Signed, asymmetric window (y grows upward): a superscript sits
          // ≤0.6h ABOVE its base's baseline, a subscript ≤0.45h BELOW it.
          // A symmetric 1h window also caught the NEXT line down — a
          // subscript hanging 0.3h under one line is ~0.9h above the next
          // line's baseline, which then lost its processing ("Finally, the
          // user signs…" after a List = {H_UID_1, …} line).
          const dy = f.y - sy; // + = frag above this item's baseline
          const inWin =
            dy > 0
              ? dy >= item.height * 0.08 && dy <= item.height * 0.6
              : -dy >= item.height * 0.08 && -dy <= item.height * 0.45;
          if (!inWin) continue; // same baseline / another line
          if (f.x0 > sx1 + 2 || f.x1 < sx0 - 2) continue; // not adjacent
          return false;
        }
      }
      if (item?.transform) {
        const x = item.transform[4];
        const y = item.transform[5];
        if (y - vy0 < pageH * 0.06 || y - vy0 > pageH * 0.94) return false;
        if (x - vx0 < pageW * 0.04) return false;
        if (contentStart) {
          if (pageNumber < contentStart.page) return false;
          // Front matter is what sits ABOVE the Abstract line — cut strictly
          // above it (more than half a line). In two-column layouts the other
          // column's first body line shares the Abstract lead's baseline
          // (5GShield/ACL: the right column starts level with "Abstract—…");
          // a same-baseline cut would skip exactly that first line. The
          // Abstract lead line itself is covered by the run-in/heading
          // classifiers, not by this cut.
          if (
            pageNumber === contentStart.page &&
            y >= contentStart.y + (contentStart.h || 9) * 0.6
          ) {
            return false;
          }
        }
        if (inRefsBox(item)) return false;
        // Skip when a URL annotation covers most of the item (a long prose
        // item merely brushing a link keeps its emphasis — the regex-based
        // range exclusion handles the link part).
        const itemEnd = x + (item.width ?? 0);
        if (
          urlRects.some((r) => {
            if (y < r[1] - 2 || y > r[3] + 2) return false;
            const overlap = Math.min(itemEnd, r[2]) - Math.max(x, r[0]);
            return overlap > Math.max(2, (itemEnd - x) * 0.5);
          })
        ) {
          return false;
        }
      }
      return true;
    });

    const settings = this.#settings;
    // Obstacles: every inked text-layer span we are NOT rendering on top (skip
    // set, headings, captions, tables, refs, size-filtered). Masks cover only
    // the canvas duplicate of spans we redraw — they must never white out an
    // obstacle, which would only exist on the canvas. We break runs at, and
    // clamp run padding away from, these. Measured lazily once in work() (needs
    // a live, non-hidden layout). Classification can vary between render passes
    // (async contentStart/refs/body-height), so this guard, not classification
    // stability, is what guarantees skipped content is never erased.
    const candidateDivs = new Set(pairs.map((p) => p.div));
    const obstacleDivs = allPairs
      .filter(
        (p) =>
          p.div &&
          p.div.isConnected &&
          !candidateDivs.has(p.div) &&
          /\S/.test(p.div.textContent || ""),
      )
      .map((p) => p.div);
    let obstacleRects = null;
    let zoneDrops = null; // candidates inside rule-bounded table zones — left on the canvas
    let baselineCal = null; // famKey -> measured marginTop (em) that lands overlay ink on canvas ink
    // Key by the bare leading family name: the same face reaches spans as
    // both '"g_d0_f12", sans-serif' (our swap string) and 'g_d0_f12,
    // sans-serif' (PDF.js's own), and both must hit the same entry.
    const famKey = (f) => f.split(",")[0].replace(/["']/g, "").trim();
    let wordIndex = 0;
    let i = 0;
    // True canvas width of an item, straight from the PDF geometry. The
    // pristine DOM rect can NOT be trusted for this: when the embedded font
    // wasn't yet usable at text-layer layout time (Chrome), PDF.js measured
    // the span in the css fallback face and baked a stale --scale-x; once the
    // real face applies, the span's box no longer equals the canvas width.
    const vpScale =
      (pageView.viewport?.rotation ?? 0) % 360 === 0
        ? pageView.viewport?.scale || 0
        : 0;

    const work = (deadline) => {
      if (holder.cancelled) {
        holder.resolve();
        return;
      }
      // Geometry reads (getBoundingClientRect) are unreliable while the tab/
      // window is hidden or occluded — the browser suspends layout, so widths
      // can come back as 0 or stale. Measuring then bakes wrong --scale-x /
      // word-spacing corrections (collapsed, jammed text) that persist until a
      // re-process. If the window was switched away mid-run, pause and resume
      // when it is visible again, so every measurement happens on a live layout.
      if (typeof document !== "undefined" && document.hidden) {
        const onVisible = () => {
          if (document.hidden) return;
          document.removeEventListener("visibilitychange", onVisible);
          if (holder.cancelled) holder.resolve();
          else requestIdleCallback(work, { timeout: 200 });
        };
        document.addEventListener("visibilitychange", onVisible);
        return;
      }
      const layerRect = textLayerDiv.getBoundingClientRect();
      if (!obstacleRects) {
        obstacleRects = [];
        // Canvas line-art (table rules, box frames, underlines, separators)
        // becomes obstacles too, so masks clamp around it exactly like skipped
        // text — the text layer alone can't see these.
        const canvasRules = this.#detectCanvasRules(pageView);
        for (const r of canvasRules) obstacleRects.push(r);
        // Rule-bounded table zones (canvas is readable HERE, unlike at
        // classification time): a ruled table's columns need no whitespace
        // gaps and its cells can be wordy, so text heuristics keep missing
        // row shapes — but every such table brackets its rows between ≥3
        // stacked, x-overlapping horizontal rules. Any remaining candidate
        // centered between two chained rules is table interior: leave it
        // pristine on the canvas (mask-clamped like other kept content).
        // Running prose CAN sit between two chains' rules (a paragraph
        // between two framed listings) — a full-width line with ≥4 lowercase
        // words stays processed.
        zoneDrops = new Set();
        try {
          const pageHcss = pageView.div.getBoundingClientRect().height || 0;
          const hRules = canvasRules
            .filter((r) => r.right - r.left >= (r.bottom - r.top) * 4 && r.right - r.left > 40)
            .sort((a, b) => a.top - b.top);
          const rulePairs = [];
          for (let a = 0; a < hRules.length; a++) {
            for (let b = a + 1; b < hRules.length; b++) {
              const A = hRules[a];
              const B = hRules[b];
              if (B.top - A.bottom <= 2) continue; // same visual rule
              if (B.top - A.bottom > pageHcss * 0.15) break;
              const lo = Math.max(A.left, B.left);
              const hi = Math.min(A.right, B.right);
              if (hi - lo < Math.max(A.right - A.left, B.right - B.left) * 0.7) continue;
              rulePairs.push({ a, b, x0: lo, x1: hi, yTop: A.bottom, yBot: B.top });
              break; // nearest qualifying rule below only
            }
          }
          // ≥3 rules must chain — an isolated PAIR is usually two underlined
          // run-in leads with a paragraph between.
          const chainOf = new Map();
          let cid = 0;
          for (const p of rulePairs) {
            const c = chainOf.get(p.a) ?? ++cid;
            chainOf.set(p.a, c);
            chainOf.set(p.b, c);
          }
          const csize = new Map();
          for (const c of chainOf.values()) csize.set(c, (csize.get(c) || 0) + 1);
          const zones = rulePairs.filter((p) => (csize.get(chainOf.get(p.a)) || 0) >= 3);
          if (zones.length) {
            const byLine = new Map();
            for (const pr of pairs) {
              const r = pr.div.getBoundingClientRect();
              if (!(r.width > 0) || !(r.height > 0)) continue;
              const cx = (r.left + r.right) / 2;
              const cy = (r.top + r.bottom) / 2;
              const zi = zones.findIndex(
                (z) => cx >= z.x0 && cx <= z.x1 && cy > z.yTop + 1 && cy < z.yBot - 1,
              );
              if (zi < 0) continue;
              const key = zi + ":" + Math.round(r.top / 5);
              let arr = byLine.get(key);
              if (!arr) byLine.set(key, (arr = []));
              arr.push({ pr, r, z: zones[zi] });
            }
            // Prose between frames stays processed — including a paragraph's
            // short LAST line ("as shown in Figure 8b."), which fails the
            // width test on its own but directly continues an exempt line.
            // Only spans that are themselves part of the prose flow stay: a
            // short label sharing the baseline with a wordy description CELL
            // ("NFRegister" centered beside a 3-line policy text) still drops.
            const entryKeys = [...byLine.keys()].sort((a, b) => {
              const [za, ka] = a.split(":").map(Number);
              const [zb, kb] = b.split(":").map(Number);
              return za - zb || ka - kb;
            });
            const lastExempt = new Map(); // zone index -> last exempt line key
            for (const key of entryKeys) {
              const group = byLine.get(key);
              const [zi, lineKey] = key.split(":").map(Number);
              const text = group.map((g) => g.pr.div.textContent).join(" ");
              const lw = (text.match(/[a-zà-ÿ]{2,}/g) || []).length;
              const gx0 = Math.min(...group.map((g) => g.r.left));
              const gx1 = Math.max(...group.map((g) => g.r.right));
              const z = group[0].z;
              const prev = lastExempt.get(zi);
              const exemptLine =
                (lw >= 4 && gx1 - gx0 >= (z.x1 - z.x0) * 0.55) ||
                (lw >= 2 && prev != null && lineKey - prev <= 5);
              if (exemptLine) lastExempt.set(zi, lineKey);
              for (const g of group) {
                if (exemptLine) {
                  const t = g.pr.div.textContent.trim();
                  const slw = (t.match(/[a-zà-ÿ]{2,}/g) || []).length;
                  if (slw >= 2 || t.length >= 12) continue;
                }
                zoneDrops.add(g.pr.div);
              }
            }
          }
        } catch {
          /* canvas zone guard unavailable — classification skips still apply */
        }
        for (const d of obstacleDivs) {
          if (!d.isConnected) continue;
          const r = d.getBoundingClientRect();
          if (!(r.width > 0) || !(r.height > 0)) continue;
          if (protectSet.has(d)) {
            // A protected span (displayed formula) has structural canvas art —
            // its box frame — hugging the glyphs. Expand its obstacle rect
            // vertically so neighbouring lines' mask padding clamps a margin
            // BEFORE the frame instead of exactly at the glyphs.
            const pad = r.height * 0.35;
            obstacleRects.push({ left: r.left - 3, right: r.right + 3, top: r.top - pad, bottom: r.bottom + pad });
          } else {
            obstacleRects.push(r);
          }
        }
        // Baseline snap: measure, per font family, the marginTop (em) that
        // lands the overlay's rendered ink exactly on the canvas ink. The
        // metric formula (ascentRatio − baselineRatio) leaves a sub-pixel to
        // ~1px font-specific residual — enough for a processed word to sit
        // visibly off the row of a kept neighbour (inline math, mono). The
        // canvas still holds the original glyphs at this point (masks are
        // DOM-side and none exist yet), so compare its ink-top under each
        // pristine span with where the post-swap face would paint, and take
        // the per-family median. Off-screen / CSS-stretched / low-res
        // canvases are rejected (metric fallback keeps correctness).
        baselineCal = new Map();
        try {
          const canvas = pageView.canvas;
          const cr = canvas?.getBoundingClientRect();
          const csx = cr && cr.width > 0 ? canvas.width / cr.width : 0;
          const csy = cr && cr.height > 0 ? canvas.height / cr.height : 0;
          const dpr = window.devicePixelRatio || 1;
          if (canvas && csx > 0 && csy > dpr * 0.85) {
            const cctx = canvas.getContext("2d", { willReadFrequently: true });
            this.#measureCtx ??= document.createElement("canvas").getContext("2d");
            const samples = new Map();
            const rej = { w: 0, xy: 0, ink: 0, asc: 0, bl: 0 };
            let inspected = 0;
            for (const pair of pairs) {
              if (inspected >= 150) break;
              const div = pair.div;
              const text = div.textContent;
              if (!text || text.trim().length < 6) continue;
              const family = this.#fontFamilyFor(pair) || div.style.fontFamily;
              if (!family) continue;
              const key = famKey(family);
              let arr = samples.get(key);
              if (!arr) samples.set(key, (arr = []));
              if (arr.length >= 10) continue;
              const r = div.getBoundingClientRect();
              if (!(r.width > 40) || !(r.height > 6)) { rej.w++; continue; }
              const x0 = Math.round((r.left - cr.left) * csx) + 2;
              const x1 = Math.round((r.right - cr.left) * csx) - 2;
              const y0 = Math.round((r.top - cr.top) * csy) - 3;
              const y1 = Math.round((r.top - cr.top + r.height * 0.75) * csy);
              if (x0 < 0 || y0 < 0 || x1 > canvas.width || y1 > canvas.height || x1 - x0 < 20) { rej.xy++; continue; }
              inspected++;
              const img = cctx.getImageData(x0, y0, x1 - x0, y1 - y0);
              let top = -1;
              for (let y = 0; y < img.height && top < 0; y++) {
                let dark = 0;
                for (let x = 0; x < img.width; x++) {
                  const k = (y * img.width + x) * 4;
                  if (img.data[k] < 120 && img.data[k + 1] < 120 && img.data[k + 2] < 120 && ++dark >= 2) { top = y; break; }
                }
              }
              if (top < 0) { rej.ink++; continue; }
              const canvasInkTop = (y0 + top) / csy + cr.top;
              const fontPx = parseFloat(getComputedStyle(div).fontSize) || r.height;
              this.#measureCtx.font = `${fontPx}px ${family}`;
              const asc = this.#measureCtx.measureText(text).actualBoundingBoxAscent;
              if (!(asc > 0) || !(fontPx > 0)) { rej.asc++; continue; }
              // Predicted overlay ink top with zero margin: rendered baseline
              // = blRatio × boxHeight below the box top, ink rises `asc`
              // above it. Pixel-validated (probe-bl2 red-vs-black offsets).
              const predictedNoMargin = r.top + this.#baselineRatio(family) * r.height - asc;
              arr.push((canvasInkTop - predictedNoMargin) / fontPx);
            }
            for (const [family, arr] of samples) {
              if (arr.length < 3) continue;
              arr.sort((a, b) => a - b);
              const med = arr[Math.floor(arr.length / 2)];
              if (Math.abs(med) <= 0.15) baselineCal.set(family, med);
            }
            if (globalThis.__fxDebug) {
              (globalThis.__fxCal ??= []).push({
                page: pageNumber, rej,
                samples: [...samples.entries()].map(([k, a]) => [k.slice(0, 24), a.length]),
                cal: [...baselineCal.entries()].map(([k, v]) => [k.slice(0, 24), +v.toFixed(4)]),
              });
            }
          }
        } catch {
          /* canvas unreadable — the metric fallback below still applies */
        }
      }
      // True when a rect substantially overlaps a skipped (obstacle) span.
      // Some PDFs carry a DUPLICATE text-layer span for the same glyphs (e.g. a
      // wide caption span on top of fine-grained "Tab"/"le"/"8" spans, or
      // tagged/accessibility duplicates). When one copy is skipped and its
      // duplicate is a body candidate, processing the duplicate would mask —
      // and white out — the skipped copy in the very same pixels. We can't both
      // mask the duplicate and spare the original, so leave the duplicate on
      // the canvas too.
      const overlapsObstacle = (r) => {
        const area = (r.right - r.left) * (r.bottom - r.top);
        if (!(area > 0)) return false;
        for (const o of obstacleRects) {
          const w = Math.min(r.right, o.right) - Math.max(r.left, o.left);
          const h = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
          if (w > 0 && h > 0 && w * h > area * 0.35) return true;
        }
        return false;
      };
      while (i < pairs.length) {
        const end = Math.min(i + CHUNK, pairs.length);
        const batch = [];
        // Read pass: pristine geometry.
        for (let j = i; j < end; j++) {
          const pair = pairs[j];
          const rect = pair.div.getBoundingClientRect();
          // Inside a rule-bounded table zone: table interior stays on the
          // canvas; its rect becomes an obstacle so neighbours' masks clamp.
          if (zoneDrops?.has(pair.div)) {
            if (rect.width > 0 && rect.height > 0) obstacleRects.push(rect);
            pair.div.dataset.fxTable = "1";
            if (globalThis.__fxDebug && !pair.div.dataset.fxWhy) pair.div.dataset.fxWhy = "table-rules";
            continue;
          }
          // A candidate overlapping skipped content is a duplicate of it —
          // leave it on the canvas (no mask, no emphasis) so the skipped copy
          // survives.
          if (overlapsObstacle(rect)) continue;
          const result = emphasizeParts(pair.div.textContent, settings, wordIndex);
          if (!result) {
            // Math-heavy text or a wrapped URL/email continuation: leave it on
            // the canvas in its original face, and add it to the obstacles so
            // neighbouring masks clamp around it instead of whiting it out.
            if (rect.width > 0 && rect.height > 0) obstacleRects.push(rect);
            continue;
          }
          wordIndex = result.wordIndex;
          const targetW =
            vpScale && pair.item?.width > 0
              ? pair.item.width * vpScale
              : rect.width;
          batch.push({ pair, parts: result.parts, rect, targetW });
        }
        // Content + font pass: rewrite each span as bold-prefix + rest, swap in
        // the chosen face, and RE-SEAT THE BASELINE. PDF.js set each span's top
        // from the ascent ratio of the font it assigned, so its baseline = the
        // canvas baseline; our face's ratio differs, which would slide the
        // glyphs off that baseline (rendering visibly higher/lower than the
        // canvas, and leaving the mask short of the canvas descenders). Shift by
        // the ratio difference, in `em` so it survives zoom/DPI re-layout.
        // Geometry is re-measured AFTER this pass, so masks and width correction
        // track what is actually rendered at the corrected position.
        for (const entry of batch) {
          const { pair, parts } = entry;
          const span = pair.div;
          this.#pristine.set(span, {
            html: span.innerHTML,
            scaleX: span.style.getPropertyValue("--scale-x"),
            fontFamily: span.style.fontFamily,
            wordSpacing: span.style.wordSpacing,
            marginTop: span.style.marginTop,
          });
          const frag = document.createDocumentFragment();
          for (const part of parts) {
            if (part.bold) {
              const b = document.createElement("b");
              b.className = "fx-b";
              b.textContent = part.text;
              frag.append(b);
            } else {
              frag.append(part.text);
            }
          }
          span.replaceChildren(frag);
          const origFamily = span.style.fontFamily;
          const family = this.#fontFamilyFor(pair);
          if (family && family !== origFamily) span.style.fontFamily = family;
          // Re-seat the baseline. Preferred: the per-family CANVAS-MEASURED
          // margin (baselineCal) — it lands the rendered ink exactly on the
          // canvas ink, so processed words sit in the same row as kept
          // neighbours (inline math, mono identifiers). Fallback when the
          // canvas wasn't measurable: the metric difference between where
          // PDF.js put the box (origFamily bbox ascent) and where our face
          // actually draws its baseline. Both are em-relative, so they
          // survive zoom/DPI re-layout.
          const fam = family || origFamily;
          const cal = fam ? baselineCal?.get(famKey(fam)) : undefined;
          // The metric fallback applies ONLY when the rendered FACE actually
          // changes (bundled reading fonts). When the face is the same and
          // just the family STRING differs (our quoted swap of the embedded
          // face), PDF.js's own placement is already correct — the formula's
          // bbox-vs-baseline difference is measurement noise that pushed
          // Libertine-faced papers ~0.12em off the canvas row.
          const dEm =
            cal !== undefined
              ? cal
              : family && famKey(family) !== famKey(origFamily)
                ? this.#ascentRatio(origFamily) - this.#baselineRatio(family)
                : 0;
          if (Math.abs(dEm) > 0.004) span.style.marginTop = `${dEm.toFixed(4)}em`;
          span.dataset.fxDone = "1";
        }
        // Re-measure pass: one layout flush. The post-change rect is the bolded
        // text in the new face at the corrected baseline.
        for (const entry of batch) entry.rect2 = entry.pair.div.getBoundingClientRect();

        // Mask pass: one white box PER RENDERED SPAN, covering its canvas
        // duplicate plus ink overshoot (italics, descenders, accents): ±28%
        // height vertical, ±max(2px, 12% height) horizontal. A mask need only
        // cover the glyphs we redraw — the gaps BETWEEN spans are inter-word
        // whitespace (no canvas ink) and need no cover. So, unlike an earlier
        // per-run bounding box that bridged those gaps, a skipped heading,
        // caption leader, or figure label sitting in a gap (even on a slightly
        // offset baseline that a bbox would have swallowed) is never whited
        // out. As a second guard, each box is clamped back from any obstacle its
        // padding would otherwise reach. The box's VERTICAL extent comes from
        // the re-measured rect (the corrected, canvas-aligned baseline) while
        // its HORIZONTAL extent comes from the pristine rect (the canvas glyph
        // width, which the width correction below restores). Every rendered span
        // sits in the text layer above the mask, so kept inline math survives.
        for (const { rect, rect2, targetW } of batch) {
          const r2 = rect2 || rect;
          if (!(rect.width > 0) || !(r2.height > 0)) continue;
          const h = r2.height;
          const padY = h * 0.28;
          const padX = Math.max(2, h * 0.12);
          let L = rect.left - padX;
          let R = rect.left + (targetW || rect.width) + padX;
          let T = r2.top - padY;
          let B = r2.bottom + padY;
          for (const o of obstacleRects) {
            if (o.right <= L || o.left >= R || o.bottom <= T || o.top >= B) continue;
            // Obstacle reaches into the padding — pull the nearest padded edge
            // back to it, but never past the span's own glyph rect.
            if (o.left >= rect.right) R = Math.min(R, o.left);
            else if (o.right <= rect.left) L = Math.max(L, o.right);
            else if (o.top >= r2.bottom) B = Math.min(B, o.top);
            else if (o.bottom <= r2.top) T = Math.max(T, o.bottom);
            else {
              // The obstacle overlaps the glyph rect itself (kerned or abutting
              // neighbours, slight measurement overlap — e.g. the big "C" of a
              // small-caps word next to a processed span). Pull the nearest
              // mask edge back to exclude the intersection, capped so we never
              // unmask most of our own glyphs: a small canvas peek of our own
              // duplicate beats whiting out kept text that exists ONLY on the
              // canvas.
              const cutL = o.right - L, cutR = R - o.left, cutT = o.bottom - T, cutB = B - o.top;
              const m = Math.min(cutL, cutR, cutT, cutB);
              // Vertical cuts are floored at the span's OWN glyph rect: a
              // protect zone (underline/frame padding) expanded into the line
              // above must not strip that line's mask off its own descenders —
              // the canvas lower halves would peek out as doubled/shifted
              // text. The protected ART itself always sits beyond the
              // expansion, so covering up to the glyph edge never touches it.
              if (m === cutL && cutL <= (R - L) * 0.4) L = o.right;
              else if (m === cutR && cutR <= (R - L) * 0.4) R = o.left;
              // Vertical cuts: a THIN obstacle is canvas line-art (a rule or
              // underline) — honor it exactly, a mask must never touch it.
              // A TALL obstacle is a protect zone or text rect whose padding
              // merely reaches into this line; floor the cut at the span's
              // own descender band (r2.bottom + 0.15h), else the canvas
              // lower halves peek out as doubled text (UC-Scheme P2/P3).
              else if (m === cutT && cutT <= (B - T) * 0.45) {
                T = o.bottom - o.top <= 5 ? o.bottom : Math.min(o.bottom, Math.max(T, r2.top - h * 0.05));
              } else if (m === cutB && cutB <= (B - T) * 0.45) {
                B = o.bottom - o.top <= 5 ? o.top : Math.max(o.top, Math.min(B, r2.bottom + h * 0.15));
              }
            }
          }
          if (R - L <= 0 || B - T <= 0) continue;
          const m = document.createElement("div");
          m.style.left = `${L - layerRect.left}px`;
          m.style.top = `${T - layerRect.top}px`;
          m.style.width = `${R - L}px`;
          m.style.height = `${B - T}px`;
          mask.append(m);
        }
        // Width pass: restore the span's pristine rendered width (the font swap
        // and bolding change the natural width). Preferred correction is
        // word-spacing — glyphs keep their natural shapes and the line reads
        // naturally; spans with too few spaces (or needing too much per-space
        // correction) fall back to scaling the --scale-x custom property. PDF.js
        // composes the span transform as
        // rotate(--rotate) scaleX(--scale-x) scale(--min-font-size-inv); only
        // the custom property may be adjusted — writing style.transform would
        // wipe the other parts.
        //
        // Both corrections are kept SCALE-INVARIANT so they survive a zoom /
        // window move / DPI change that re-lays-out the text layer at a new
        // scale (PDF.js scales each span's font-size): --scale-x is already
        // dimensionless, and word-spacing is written in `em` (relative to the
        // font size) rather than px, so the gap scales with the text. A px gap
        // would stay fixed while the glyphs grew/shrank, collapsing the spacing.
        // The correction targets targetW — the item's true canvas width from
        // the PDF geometry — NOT the pristine DOM width. In Chrome the text
        // layer can lay out before the embedded FontFace is usable: PDF.js
        // measures the span in the css fallback face and bakes a stale
        // --scale-x (e.g. 0.94), which then shrinks the REAL face's glyphs 6%
        // once it applies — every processed word rendered compressed, canvas
        // ghosts peeking around inline math (Edge has the face ready at
        // layout time, so it never showed). Normalizing to --scale-x:1 +
        // word-spacing against targetW erases the stale scale: glyphs render
        // at their natural advances (matching the canvas letters) and the
        // spaces absorb the justification surplus, exactly like the canvas.
        for (const { pair, rect, rect2, targetW } of batch) {
          const span = pair.div;
          const newWidth = (rect2 || span.getBoundingClientRect()).width;
          if (!(newWidth > 0)) continue;
          const prevScale =
            parseFloat(span.style.getPropertyValue("--scale-x")) || 1;
          const natural = newWidth / prevScale;
          if (Math.abs(natural - targetW) <= 0.5) {
            if (prevScale !== 1) span.style.setProperty("--scale-x", 1);
            continue;
          }
          const spaces = (span.textContent.match(/ /g) || []).length;
          const perSpace = spaces ? (targetW - natural) / spaces : Infinity;
          // Positive word-spacing (justification surplus) can stretch far;
          // NEGATIVE word-spacing eats the inter-word gaps themselves — on a
          // line LaTeX already squeezed to minimum glue, even −3px/space
          // fuses the words ("securitypoliciesfromspecifications", B p14).
          // Cap the negative side tightly and let --scale-x absorb bigger
          // shrinks: 2-3% narrower glyphs are invisible, missing spaces are
          // not.
          if (spaces >= 2 && perSpace < rect.height * 0.45 && perSpace > rect.height * -0.1) {
            const fontPx = parseFloat(getComputedStyle(span).fontSize) || rect.height;
            span.style.setProperty("--scale-x", 1);
            span.style.wordSpacing = `${perSpace / fontPx}em`;
          } else {
            span.style.setProperty("--scale-x", targetW / natural);
          }
        }
        i = end;
        if (deadline && deadline.timeRemaining() < 4 && i < pairs.length) {
          requestIdleCallback(work, { timeout: 200 });
          return;
        }
      }
      this.#pending.delete(pageNumber);
      holder.resolve();
    };

    // Measure only with the real faces: if the embedded fonts are still
    // loading (the Chrome race above), geometry reads would see the fallback.
    const kick = () => requestIdleCallback(work, { timeout: 200 });
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(kick, kick);
    } else {
      kick();
    }
    return holder.promise;
  }
}
