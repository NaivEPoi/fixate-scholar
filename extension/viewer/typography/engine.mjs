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
      if (pv.id <= pos.page) {
        this.#restorePage(pv);
        promises.push(this.#processPage(pv));
      }
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
      if (boxesByPage.has(pv.id)) {
        this.#restorePage(pv);
        promises.push(this.#processPage(pv));
      }
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
    for (const span of pageView.textLayer.div.querySelectorAll("span[data-fx-done]")) {
      const orig = this.#pristine.get(span);
      if (orig) {
        span.innerHTML = orig.html;
        span.style.setProperty("--scale-x", orig.scaleX || "");
        span.style.fontFamily = orig.fontFamily;
      }
      delete span.dataset.fxDone;
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
    const holder = { cancelled: false };
    holder.promise = new Promise((resolve) => (holder.resolve = resolve));
    this.#pending.set(pageNumber, holder);

    const allPairs = await this.#pagePairs(pageView);
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
    //  - smaller-than-body text (tables, figure labels, footnotes) and
    //    caption lines,
    //  - larger-than-body text (paper title, section headings),
    //  - math/symbol faces,
    //  - running headers/footers and the left/right margins (page numbers,
    //    proceedings lines, arXiv watermarks),
    //  - the page-1 header block (title/authors/emails) above "Abstract",
    //  - the bibliography region (setRefsRegion) — appendices after it are
    //    processed normally.
    const dominant = this.#dominantHeight(allPairs);
    const fontCache = new Map();
    const [vx0, vy0, vx1, vy1] = pageView.pdfPage.view;
    const pageW = vx1 - vx0;
    const pageH = vy1 - vy0;
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
    const refsBoxes = this.#refsBoxes?.get(pageNumber);
    const pairs = allPairs.filter(({ div, item }) => {
      if (!div?.isConnected || div.dataset.fxDone) return false;
      const text = div.textContent;
      if (!text || text.trim().length < 2) return false;
      if (CAPTION.test(text)) return false;
      if (dominant && item?.height) {
        if (item.height < dominant * 0.85) return false;
        if (item.height > dominant * 1.15) return false;
      }
      if (this.#isSpecialFont(pageView, item?.fontName, fontCache)) return false;
      if (item?.transform) {
        const x = item.transform[4];
        const y = item.transform[5];
        if (y - vy0 < pageH * 0.06 || y - vy0 > pageH * 0.94) return false;
        if (x - vx0 < pageW * 0.04) return false;
        if (contentStart) {
          if (pageNumber < contentStart.page) return false;
          if (pageNumber === contentStart.page && y >= contentStart.y - 1) return false;
        }
        if (refsBoxes?.some((b) => y >= b.y0 && y <= b.y1 && x >= b.x0 - 2 && x <= b.x1 + 2)) {
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
          const result = emphasizeParts(pair.div.textContent, settings, wordIndex);
          if (!result) continue;
          wordIndex = result.wordIndex;
          batch.push({
            pair,
            parts: result.parts,
            rect: pair.div.getBoundingClientRect(),
          });
        }
        // Write pass: masks + content + font.
        for (const entry of batch) {
          const { pair, parts, rect } = entry;
          const span = pair.div;
          this.#pristine.set(span, {
            html: span.innerHTML,
            scaleX: span.style.getPropertyValue("--scale-x"),
            fontFamily: span.style.fontFamily,
          });
          const pad = rect.height * 0.18;
          const m = document.createElement("div");
          m.style.left = `${rect.left - layerRect.left - 1}px`;
          m.style.top = `${rect.top - layerRect.top - pad}px`;
          m.style.width = `${rect.width + 2}px`;
          m.style.height = `${rect.height + 2 * pad}px`;
          mask.append(m);

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
        // Read pass 2 + write pass 2: re-calibrate the span's --scale-x so
        // its rendered width stays exactly the pristine width (the font swap
        // and bolding both change the natural width). PDF.js composes the
        // span transform as rotate(--rotate) scaleX(--scale-x)
        // scale(--min-font-size-inv); only the custom property may be
        // adjusted — writing style.transform would wipe the other parts.
        for (const { pair, rect } of batch) {
          const span = pair.div;
          const newWidth = span.getBoundingClientRect().width;
          if (newWidth > 0 && Math.abs(newWidth - rect.width) > 0.5) {
            const prevScale =
              parseFloat(span.style.getPropertyValue("--scale-x")) || 1;
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
