// Applies fixation emphasis to PDF.js text layers.
//
// PDF.js paints glyphs on a canvas and overlays transparent, absolutely
// positioned text spans for selection/search. With the mode on we:
//   1. make the span text visible (overlay.css, .fx-on),
//   2. cover the duplicate canvas glyphs with a per-span mask layer placed
//      between the canvas and the text layer,
//   3. rewrite each span as bold-prefix + rest,
//   4. re-calibrate the span's scaleX so its rendered width still matches the
//      original glyph run (keeps selection/search geometry usable).
// Everything is reversible: pristine markup is kept in a WeakMap and restored
// on toggle-off. Work happens in idle-time chunks to avoid jank.

import { emphasizeParts } from "./segmenter.mjs";

const CHUNK = 150;

export class TypographyEngine {
  #app;
  #settings;
  #enabled = false;
  #pristine = new WeakMap(); // span -> { html, transform }
  #pending = new Map(); // pageNumber -> cancel flag holder

  constructor(app, settings) {
    this.#app = app;
    this.#settings = settings;
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
        span.style.transform = orig.transform;
      }
      delete span.dataset.fxDone;
    }
  }

  #leafSpans(textLayerDiv) {
    return [...textLayerDiv.querySelectorAll("span")].filter(
      (s) =>
        s.childElementCount === 0 &&
        !s.dataset.fxDone &&
        s.textContent.trim().length > 1 &&
        !s.closest(".editToolbar"),
    );
  }

  #processPage(pageView) {
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

    pageView.div.querySelector(".fx-mask")?.remove();
    const textLayerDiv = pageView.textLayer.div;
    const mask = document.createElement("div");
    mask.className = "fx-mask";
    mask.setAttribute("aria-hidden", "true");
    textLayerDiv.before(mask);

    const spans = this.#leafSpans(textLayerDiv);
    const settings = this.#settings;
    let wordIndex = 0;
    let i = 0;

    const work = (deadline) => {
      if (holder.cancelled) {
        holder.resolve();
        return;
      }
      const layerRect = textLayerDiv.getBoundingClientRect();
      while (i < spans.length) {
        const end = Math.min(i + CHUNK, spans.length);
        const batch = [];
        // Read pass: pristine geometry.
        for (let j = i; j < end; j++) {
          const span = spans[j];
          const result = emphasizeParts(span.textContent, settings, wordIndex);
          if (!result) continue;
          wordIndex = result.wordIndex;
          batch.push({ span, parts: result.parts, rect: span.getBoundingClientRect() });
        }
        // Write pass: masks + content.
        for (const item of batch) {
          const { span, parts, rect } = item;
          this.#pristine.set(span, {
            html: span.innerHTML,
            transform: span.style.transform,
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
          span.dataset.fxDone = "1";
        }
        // Read pass 2 + write pass 2: re-calibrate scaleX to pristine width.
        for (const { span, rect } of batch) {
          const newWidth = span.getBoundingClientRect().width;
          if (newWidth > 0 && Math.abs(newWidth - rect.width) > 0.5) {
            const prevScale =
              parseFloat(/scaleX\(([\d.]+)\)/.exec(span.style.transform)?.[1]) || 1;
            span.style.transform = `scaleX(${(prevScale * rect.width) / newWidth})`;
          }
        }
        i = end;
        if (deadline && deadline.timeRemaining() < 4 && i < spans.length) {
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
