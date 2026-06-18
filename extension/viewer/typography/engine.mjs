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
  #contentStart = null; // { page, y } — the Abstract heading; front matter above it
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
  #classifyBlocks(allPairs, vx0, pageW, pageH, isSpecial, isBold) {
    const skip = new Set();
    const items = allPairs.filter((p) => p.item?.transform && p.item.str.trim());
    const lines = this.#lineGroups(items);
    if (!lines.length) return skip;

    const centerX = vx0 + pageW * 0.5;
    const LOWER_WORD = /^[a-zà-ÿ]{2,}$/;
    // Caption leaders, section labels, and pseudocode/algorithm leaders.
    const CAP_LEAD = /^(?:Fig(?:ure)?\.?|Tab(?:le)?\.?|TABLE|FIGURE|Algorithm|Listing)\s*\d/;
    const HEAD_LEAD = /^(?:\d+(?:\.\d+)*\.?|[A-Z]\d*[.:]|[IVX]{1,5}\.)(?:$|\s+[A-Z(])/;
    const ALGO_LEAD = /^(?:\d{1,3}:|Require:|Ensure:|Input:|Output:|Algorithm\s+\d+)/;

    const lowerWords = (its) => {
      let lc = 0;
      for (const p of its)
        for (const w of p.item.str.trim().split(/\s+/)) if (LOWER_WORD.test(w)) lc++;
      return lc;
    };
    // Column-gap-separated cells in a row (a wide gap = a column boundary).
    const maxCells = (rows) => {
      let m = 0;
      for (const r of rows) {
        let cells = 1;
        for (let k = 1; k < r.items.length; k++) {
          const prev = r.items[k - 1].item;
          const gap = r.items[k].item.transform[4] - (prev.transform[4] + (prev.width ?? 0));
          if (gap > Math.max(prev.height || 8, r.items[k].item.height || 8) * 1.5) cells++;
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

    const skipBlock = (b) => { for (const p of b.items) skip.add(p.div); };
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
      }
    };

    const regions = twoColumn ? [left, right, full] : [full];
    for (const region of regions) {
      const blocks = blocksOf(region);
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        const lc = lowerWords(b.items);
        const cells = maxCells(b.rows);
        const spc = specialRatio(b.items);
        const offSize = b.h < dominant * 0.82 || b.h > dominant * 1.18;

        // Caption → skip whole block, plus the figure/table body in the block
        // directly above it in this column (figures are captioned below).
        if (CAP_LEAD.test(b.lead)) {
          skipBlock(b);
          const prev = blocks[bi - 1];
          if (prev && b.yTop - prev.yBot < pageH * 0.16 && lowerWords(prev.items) < 5) skipBlock(prev);
          continue;
        }
        // Table / pseudocode listing.
        if (cells >= 3 || ALGO_LEAD.test(b.lead) || (spc >= 0.5 && cells >= 2)) { skipBlock(b); continue; }
        // Heading: short, not a sentence, label- / bold- / large-led.
        if (b.rows.length <= 2 && lc <= 3 &&
            (HEAD_LEAD.test(b.lead) || b.leadBold || b.h > dominant * 1.15)) { skipBlock(b); continue; }
        // Figure label / displayed equation: almost no prose, with a non-body
        // face, an off-body size, or just a few glyphs.
        if (lc < 2 && (spc >= 0.3 || offSize || b.items.length <= 3)) { skipBlock(b); continue; }
        // Off-size block with little prose (footnotes, sub/superscript rows).
        if (offSize && lc < 4) { skipBlock(b); continue; }

        // Body text → process. Strip a leading run-in heading if present.
        if (b.leadBold || HEAD_LEAD.test(b.lead)) skipLeadRun(b);
      }
    }

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
        if (ALGO_LEAD.test(leadStr)) {
          // Pseudocode line ("10: while learning not terminate do"): the whole
          // line is a listing, even though its regular-font operands read as
          // prose between bold keywords.
          for (const p of band) skip.add(p.div);
        } else if (HEAD_LEAD.test(leadStr)) {
          if (lowerWords(band) <= 3) for (const p of band) skip.add(p.div);
          else if (isSpecial(lead)) skipHeadingRun(its, a);
        } else if (maxCells([{ items: band }]) >= 4) {
          // A table row that block grouping merged into a text block: several
          // wide column gaps on one baseline (running prose never has 4+).
          for (const p of band) skip.add(p.div);
        } else if (isBold(lead)) {
          skipHeadingRun(its, a);
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
        if (!lead || !CAP_LEAD.test(lead.item.str.trim())) continue;
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
        let prevY = lines[k].y;
        for (const p of lines[k].items.filter(inBand)) skip.add(p.div);
        for (let m = k + 1, absorbed = 0; m < lines.length && absorbed < 14; m++) {
          const bandM = lines[m].items.filter(inBand);
          if (!bandM.length) continue;
          if (prevY - lines[m].y > Math.max(leadH, lines[m].h) * 1.8) break; // gap
          if (Math.abs(lines[m].h - leadH) > leadH * 0.2) break; // size change
          if (CAP_LEAD.test(bandM[0].item.str.trim())) break; // next caption
          for (const p of bandM) skip.add(p.div);
          prevY = lines[m].y;
          absorbed++;
        }
      }
    }
    return skip;
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
    const isSpecial = (p) =>
      this.#isSpecialFont(pageView, p.item?.fontName, fontCache);
    const isBold = (p) =>
      this.#isBoldFont(pageView, p.item?.fontName, boldCache);
    const refsBoxes = this.#refsBoxes?.get(pageNumber);
    const inRefsBox = (item) => {
      if (!refsBoxes || !item?.transform) return false;
      const x = item.transform[4];
      const y = item.transform[5];
      return refsBoxes.some(
        (b) => y >= b.y0 && y <= b.y1 && x >= b.x0 - 2 && x <= b.x1 + 2,
      );
    };
    const skipSet = this.#classifyBlocks(allPairs, vx0, pageW, pageH, isSpecial, isBold);
    for (const d of skipSet) d.dataset.fxTable = "1"; // debug/test marker
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
        contentStart = { page: 1, y: abstractPair.item.transform[5] };
      }
    }
    const pairs = allPairs.filter((pair) => {
      const { div, item } = pair;
      if (!div?.isConnected || div.dataset.fxDone) return false;
      const text = div.textContent;
      const trimmed = text ? text.trim() : "";
      if (!trimmed) return false;
      // "Keep" glyphs are rendered on top of the masks in their own face,
      // never bolded: a special-font run (math/mono/small-caps/bold display), a
      // span with no Latin letters (subscripts, operators), OR a single
      // character (an italic variable like "I", a lone digit, a paren). These
      // must reach the write pass so they get their OWN mask and re-render on
      // top — otherwise the size / length filters below drop them, they stay
      // only on the canvas, and a neighbouring glyph's mask clips them (the
      // narrow ones, e.g. the "I" in an "(I₃, I₄)" marker, vanish at fit zoom).
      const keepGlyph =
        isSpecial({ item }) || !/[A-Za-zÀ-ɏ]/.test(trimmed) || trimmed.length < 2;
      pair._keep = keepGlyph;
      // Block classification (#classifyBlocks) owns content-type: anything not
      // body text — headings, captions, tables, figures, equations — is here.
      if (skipSet.has(div)) return false;
      // Backup net for an over-sized heading/title the block pass let through.
      // Only the LARGER-than-body cut remains: a smaller-than-body cut would
      // drop legitimate small body text (footnotes, and appendices or notes set
      // a point smaller than the main body). The threshold is the DOCUMENT body
      // height, so a small-text-heavy page can't skew it and clip real prose.
      if (dominant && item?.height && !keepGlyph && item.height > dominant * 1.2) {
        return false;
      }
      // Special-font (math/mono/small-caps) body spans are NOT excluded here:
      // they stay in the candidate set so the write pass can render them
      // visible on top of the masks (without bolding). Otherwise a bolded
      // neighbour's mask would white out an adjacent inline math glyph that
      // lives only on the canvas. They are diverted to "keep" in #work.
      if (item?.transform) {
        const x = item.transform[4];
        const y = item.transform[5];
        if (y - vy0 < pageH * 0.06 || y - vy0 > pageH * 0.94) return false;
        if (x - vx0 < pageW * 0.04) return false;
        if (contentStart) {
          if (pageNumber < contentStart.page) return false;
          if (pageNumber === contentStart.page && y >= contentStart.y - 1) return false;
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
          /[A-Za-zÀ-ÿ0-9]/.test(p.div.textContent || ""),
      )
      .map((p) => p.div);
    let obstacleRects = null;
    let wordIndex = 0;
    let i = 0;

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
        for (const d of obstacleDivs) {
          if (!d.isConnected) continue;
          const r = d.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) obstacleRects.push(r);
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
          // A candidate overlapping skipped content is a duplicate of it —
          // leave it on the canvas (no mask, no emphasis) so the skipped copy
          // survives.
          if (overlapsObstacle(rect)) continue;
          // Keep glyphs (math-heavy / special-font runs, lone symbols, and
          // single characters — flagged _keep in the filter) are kept in their
          // original face, not bolded, but masked and re-rendered on TOP of the
          // masks so a neighbouring processed span's mask can't clip them.
          const result = pair._keep
            ? null
            : emphasizeParts(pair.div.textContent, settings, wordIndex);
          if (!result) {
            // Keep: mask the canvas glyph and show the original text-layer
            // glyph (unchanged face, no bold) on top — so it survives a
            // neighbouring mask instead of being whited out.
            batch.push({ pair, keep: true, rect });
            continue;
          }
          wordIndex = result.wordIndex;
          batch.push({ pair, parts: result.parts, rect });
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
          const { pair, parts, keep } = entry;
          const span = pair.div;
          if (keep) {
            // Inline math / special-font run: kept in its original face on top
            // of the mask (content/font/position untouched, never bolded).
            span.dataset.fxKeep = "1";
            continue;
          }

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
          if (family && family !== origFamily) {
            span.style.fontFamily = family;
            // PDF.js placed the line-box top at baseline − fontHeight ×
            // ascentRatio(origFamily) (glyph-bbox ascent of the font it
            // assigned), so the substitute's baseline lands on the canvas
            // baseline. Our face's RENDERED baseline sits at a different
            // fraction, so re-seat it: shift by the difference between where
            // PDF.js put the box (origFamily bbox ascent) and where our face
            // actually draws its baseline (em-relative, scale-invariant).
            const dEm = this.#ascentRatio(origFamily) - this.#baselineRatio(family);
            if (Math.abs(dEm) > 0.004) span.style.marginTop = `${dEm.toFixed(4)}em`;
          }
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
        for (const { rect, rect2 } of batch) {
          const r2 = rect2 || rect;
          if (!(rect.width > 0) || !(r2.height > 0)) continue;
          const h = r2.height;
          const padY = h * 0.28;
          const padX = Math.max(2, h * 0.12);
          let L = rect.left - padX;
          let R = rect.right + padX;
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
        for (const { pair, rect, rect2, keep } of batch) {
          if (keep) continue; // unchanged content/font — width is already exact
          const span = pair.div;
          const newWidth = (rect2 || span.getBoundingClientRect()).width;
          if (!(newWidth > 0) || Math.abs(newWidth - rect.width) <= 0.5) continue;
          const prevScale =
            parseFloat(span.style.getPropertyValue("--scale-x")) || 1;
          const spaces = (span.textContent.match(/ /g) || []).length;
          const natural = newWidth / prevScale;
          const perSpace = spaces ? (rect.width - natural) / spaces : Infinity;
          if (spaces >= 2 && Math.abs(perSpace) < rect.height * 0.45) {
            const fontPx = parseFloat(getComputedStyle(span).fontSize) || rect.height;
            span.style.setProperty("--scale-x", 1);
            span.style.wordSpacing = `${perSpace / fontPx}em`;
          } else {
            span.style.setProperty(
              "--scale-x",
              (prevScale * rect.width) / newWidth,
            );
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

    requestIdleCallback(work, { timeout: 200 });
    return holder.promise;
  }
}
