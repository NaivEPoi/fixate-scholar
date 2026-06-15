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
const CAPTION = /^\s*(?:Fig(?:ure)?\.?|Table|TABLE|FIGURE)\s*\d/;
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

  constructor(app, settings) {
    this.#app = app;
    this.#settings = settings;
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
   * Divs the author set apart from running prose, returned as two sets:
   *  - tableSet: tabular / pseudocode-listing rows. A baseline (sub-)row is
   *    tabular when it has 3+ column-gap-separated cells, OR special-font
   *    items (mono/math/bold) holding the majority of its characters, OR it
   *    starts with a pseudocode line number ("10:") / algorithm keyword
   *    (Require:/Ensure:/Input:/Output:/Algorithm N). Detected tabular rows
   *    are then clustered and the whole band is filled (x-bounded), so
   *    interior rows with only one or two filled cells can't leak through.
   *  - captionSet: figure/table caption blocks — a "Table N"/"Figure N"
   *    leader plus its same-size continuation lines (multi-line captions).
   *
   * The page-center column split is applied ONLY on genuinely two-column
   * pages (few items cross the center). Applying it to a wide single-column
   * table would shred its rows into <3-cell fragments and let them through.
   */
  #skipRegions(allPairs, vx0, pageW, isSpecial) {
    const tableSet = new Set();
    const captionSet = new Set();
    const items = allPairs.filter((p) => p.item?.transform && p.item.str.trim());
    const lines = this.#lineGroups(items);
    if (!lines.length) return { tableSet, captionSet };

    // Two-column? Test whether a narrow band at the page center is a gutter.
    // A baseline that merges a left-column item with a right-column item spans
    // the center as a *line*, so test individual items: in a real two-column
    // layout almost no item's own box covers the center band, whereas in a
    // single column (or a wide full-width table) many lines have an item over
    // it. This keeps left-column prose from being swept up with a right-column
    // table that happens to share its baseline.
    const centerX = vx0 + pageW * 0.5;
    const cm = pageW * 0.03;
    // A line "occupies" the center only if one of its items actually CROSSES
    // the center line (spans from left of it to right of it). Left- and
    // right-column items merely reaching toward the gutter do not count, so a
    // two-column page reads as two-column even when PDF.js collapses a left
    // and a right line onto one baseline. Only genuinely full-width content
    // (single-column prose, full-width tables, a figure straddling the gutter)
    // crosses, so a high ratio means single column.
    let occupy = 0;
    for (const ln of lines) {
      const over = ln.items.some(
        (p) => p.item.transform[4] < centerX && p.item.transform[4] + (p.item.width ?? 0) > centerX,
      );
      if (over) occupy++;
    }
    const twoColumn = lines.length > 4 && occupy < lines.length * 0.35;
    const splitX = twoColumn ? centerX : null;

    const ALGO_LEAD = /^(?:\d{1,3}:|Require:|Ensure:|Input:|Output:|Algorithm\s+\d+)/;
    const runIsTabular = (run) => {
      if (!run.length) return false;
      if (ALGO_LEAD.test(run[0].item.str.trim())) return true;
      if (run.length < 2) return false;
      let specialChars = 0;
      let specialItems = 0;
      let totalChars = 0;
      for (const p of run) {
        const len = p.item.str.trim().length;
        totalChars += len;
        if (isSpecial(p)) {
          specialChars += len;
          specialItems++;
        }
      }
      if (specialItems >= 2 && totalChars > 0 && specialChars / totalChars >= 0.55) return true;
      if (run.length < 3) return false;
      let cells = 1;
      for (let k = 1; k < run.length; k++) {
        const prev = run[k - 1].item;
        const gap =
          run[k].item.transform[4] - (prev.transform[4] + (prev.width ?? 0));
        if (gap > Math.max(prev.height || 8, run[k].item.height || 8) * 1.5) cells++;
      }
      return cells >= 3;
    };
    // A text item that reads as running prose (several lowercase words) — used
    // to spare body sentences from a table/figure band-fill when they share a
    // baseline with it. Pseudocode keywords are NOT spared, because their rows
    // match runIsTabular (ALGO_LEAD) and are filled wholesale before this runs.
    const LOWER_WORD = /^[a-zà-ÿ]{2,}$/;
    const isProseItem = (p) => {
      let lc = 0;
      for (const w of p.item.str.trim().split(/\s+/)) if (LOWER_WORD.test(w)) lc++;
      return lc >= 4;
    };
    // Split every baseline into per-column sub-rows. On a two-column page,
    // left- and right-column content share baselines; clustering and filling
    // must stay within a column, or a table in one column would swallow prose
    // in the other (e.g. an appendix with a symbol table beside running text).
    const columns = splitX === null ? [[]] : [[], []];
    for (const ln of lines) {
      if (splitX === null) {
        columns[0].push({ y: ln.y, h: ln.h, items: ln.items });
      } else {
        const left = ln.items.filter((p) => p.item.transform[4] < splitX);
        const right = ln.items.filter((p) => p.item.transform[4] >= splitX);
        if (left.length) columns[0].push({ y: ln.y, h: ln.h, items: left });
        if (right.length) columns[1].push({ y: ln.y, h: ln.h, items: right });
      }
    }

    // Within a column, cluster tabular sub-rows (interior non-tabular rows
    // tolerated up to a few line-heights apart) and fill the band between the
    // first and last tabular sub-row, bounded to the table's own x-extent.
    const fillColumn = (rows) => {
      const tabIdx = rows.map((r, k) => (runIsTabular(r.items) ? k : -1)).filter((k) => k >= 0);
      let c = 0;
      while (c < tabIdx.length) {
        let end = c;
        while (end + 1 < tabIdx.length) {
          const a = rows[tabIdx[end]];
          const b = rows[tabIdx[end + 1]];
          if (a.y - b.y > Math.max(a.h, b.h) * 4) break;
          end++;
        }
        const cluster = tabIdx.slice(c, end + 1).map((k) => rows[k]);
        if (cluster.length >= 2) {
          let xMin = Infinity;
          let xMax = -Infinity;
          for (const r of cluster) {
            for (const p of r.items) {
              xMin = Math.min(xMin, p.item.transform[4]);
              xMax = Math.max(xMax, p.item.transform[4] + (p.item.width ?? 0));
            }
          }
          const top = rows[tabIdx[c]];
          const bot = rows[tabIdx[end]];
          const yTop = top.y + top.h * 0.6;
          const yBot = bot.y - bot.h * 0.6;
          for (const r of rows) {
            if (r.y > yTop || r.y < yBot) continue;
            // Pseudocode rows (line-number / keyword led) are filled wholesale
            // — their English keywords must not be bolded. Everywhere else,
            // running-prose items are spared: body text frequently shares a
            // PDF baseline with a figure's labels or a table's cells (super/
            // subscripts collapse onto one baseline), and that prose should
            // still be emphasized while the genuine cells stay on the canvas.
            const algo = ALGO_LEAD.test(r.items[0]?.item.str.trim() ?? "");
            for (const p of r.items) {
              const x = p.item.transform[4] + (p.item.width ?? 0) / 2;
              if (x < xMin - cm || x > xMax + cm) continue;
              if (algo || !isProseItem(p)) tableSet.add(p.div);
            }
          }
        } else {
          for (const p of cluster[0].items) tableSet.add(p.div);
        }
        c = end + 1;
      }
    };
    for (const col of columns) fillColumn(col);

    // Multi-line caption blocks: a "Table N"/"Figure N" leader plus its
    // following same-size lines (tight spacing), stopping at the table, a size
    // change, a paragraph gap, or the next caption. Captions are emphasized
    // like body text (see #processPage), so this set marks which spans are
    // caption text — letting smaller-than-body caption lines bypass the size
    // filter — and the generous line cap errs toward covering the whole caption.
    for (let k = 0; k < lines.length; k++) {
      if (!CAPTION.test(lines[k].text)) continue;
      const lead = lines[k];
      for (const p of lead.items) captionSet.add(p.div);
      let absorbed = 0;
      for (let m = k + 1; m < lines.length && absorbed < 12; m++) {
        const gap = lines[m - 1].y - lines[m].y;
        if (gap > Math.max(lines[m - 1].h, lines[m].h) * 1.6) break;
        if (Math.abs(lines[m].h - lead.h) > lead.h * 0.15) break;
        if (CAPTION.test(lines[m].text)) break;
        if (lines[m].items.some((p) => tableSet.has(p.div))) break;
        for (const p of lines[m].items) captionSet.add(p.div);
        absorbed++;
      }
    }

    return { tableSet, captionSet };
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
    const isSpecial = (p) =>
      this.#isSpecialFont(pageView, p.item?.fontName, fontCache);
    const refsBoxes = this.#refsBoxes?.get(pageNumber);
    const inRefsBox = (item) => {
      if (!refsBoxes || !item?.transform) return false;
      const x = item.transform[4];
      const y = item.transform[5];
      return refsBoxes.some(
        (b) => y >= b.y0 && y <= b.y1 && x >= b.x0 - 2 && x <= b.x1 + 2,
      );
    };
    const { tableSet, captionSet } = this.#skipRegions(allPairs, vx0, pageW, isSpecial);
    for (const d of tableSet) d.dataset.fxTable = "1"; // debug/test marker
    // The dominant body size must come from actual prose: bibliography, table,
    // and caption text (often smaller) would skew it on pages they dominate,
    // and then real body text gets skipped as "larger than body".
    const dominant = this.#dominantHeight(
      allPairs.filter(
        (p) => !tableSet.has(p.div) && !captionSet.has(p.div) && !inRefsBox(p.item),
      ),
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
    const pairs = allPairs.filter(({ div, item }) => {
      if (!div?.isConnected || div.dataset.fxDone) return false;
      const text = div.textContent;
      if (!text || text.trim().length < 2) return false;
      if (tableSet.has(div)) return false;
      // Figure/table captions are emphasized like body text — including their
      // continuation lines and even when set smaller than the body — so they
      // bypass the smaller/larger-than-body size filter below.
      const isCaption = captionSet.has(div) || CAPTION.test(text);
      if (dominant && item?.height && !isCaption) {
        if (item.height < dominant * 0.85) return false;
        if (item.height > dominant * 1.15) return false;
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
    let wordIndex = 0;
    let i = 0;

    const work = (deadline) => {
      if (holder.cancelled) {
        holder.resolve();
        return;
      }
      const layerRect = textLayerDiv.getBoundingClientRect();
      while (i < pairs.length) {
        const end = Math.min(i + CHUNK, pairs.length);
        const batch = [];
        // Read pass: pristine geometry.
        for (let j = i; j < end; j++) {
          const pair = pairs[j];
          // Inline math (math-heavy spans) and special-font runs (mono, small
          // caps, symbols) are kept in their original face, not bolded — but
          // they must render on TOP of the masks so a neighbouring processed
          // span's mask can't erase them from the canvas.
          const result = isSpecial(pair)
            ? null
            : emphasizeParts(pair.div.textContent, settings, wordIndex);
          if (!result) {
            // Keep: mask the canvas glyph and show the original text-layer
            // glyph (unchanged face, no bold) on top — so it survives a
            // neighbouring mask instead of being whited out.
            batch.push({ pair, keep: true, rect: pair.div.getBoundingClientRect() });
            continue;
          }
          wordIndex = result.wordIndex;
          batch.push({
            pair,
            parts: result.parts,
            rect: pair.div.getBoundingClientRect(),
          });
        }
        // Write pass: masks + content + font.
        for (const entry of batch) {
          const { pair, parts, rect, keep } = entry;
          const span = pair.div;
          // Cover glyph overshoot too: ink (italics, descenders, accents)
          // extends past the advance-width box the rect describes. Keep the
          // horizontal reach small — adjacent canvas glyphs (inline math,
          // mono identifiers) must not get shaved.
          const padY = rect.height * 0.28;
          const padX = Math.max(1.5, rect.height * 0.06);
          const m = document.createElement("div");
          m.style.left = `${rect.left - layerRect.left - padX}px`;
          m.style.top = `${rect.top - layerRect.top - padY}px`;
          m.style.width = `${rect.width + 2 * padX}px`;
          m.style.height = `${rect.height + 2 * padY}px`;
          mask.append(m);

          if (keep) {
            // Inline math / special-font run: mask its canvas glyph and let
            // the original (unbolded, original-face) text-layer span show on
            // top of the masks. Content and font are left untouched.
            span.dataset.fxKeep = "1";
            continue;
          }

          this.#pristine.set(span, {
            html: span.innerHTML,
            scaleX: span.style.getPropertyValue("--scale-x"),
            fontFamily: span.style.fontFamily,
            wordSpacing: span.style.wordSpacing,
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
          const family = this.#fontFamilyFor(pair);
          if (family) span.style.fontFamily = family;
          span.dataset.fxDone = "1";
        }
        // Read pass 2 + write pass 2: restore the span's pristine rendered
        // width (the font swap and bolding change the natural width).
        // Preferred correction is word-spacing — glyphs keep their natural
        // shapes and the line reads naturally; spans with too few spaces
        // (or needing too much per-space correction) fall back to scaling
        // the --scale-x custom property. PDF.js composes the span transform
        // as rotate(--rotate) scaleX(--scale-x) scale(--min-font-size-inv);
        // only the custom property may be adjusted — writing
        // style.transform would wipe the other parts.
        for (const { pair, rect, keep } of batch) {
          if (keep) continue; // unchanged content/font — width is already exact
          const span = pair.div;
          const newWidth = span.getBoundingClientRect().width;
          if (!(newWidth > 0) || Math.abs(newWidth - rect.width) <= 0.5) continue;
          const prevScale =
            parseFloat(span.style.getPropertyValue("--scale-x")) || 1;
          const spaces = (span.textContent.match(/ /g) || []).length;
          const natural = newWidth / prevScale;
          const perSpace = spaces ? (rect.width - natural) / spaces : Infinity;
          if (spaces >= 2 && Math.abs(perSpace) < rect.height * 0.45) {
            span.style.setProperty("--scale-x", 1);
            span.style.wordSpacing = `${perSpace}px`;
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
