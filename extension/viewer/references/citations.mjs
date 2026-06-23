// Detects in-text citations on rendered pages and overlays clickable
// hit-targets (a separate absolutely-positioned layer — the text layer itself
// is never modified here, so this composes with the typography engine).

import { extractLines } from "./extractor.mjs";
import {
  parseReferences,
  findReferencesBody,
  findContentStart,
  findCitations,
  findInternalRefs,
  resolveCitation,
} from "./parser.mjs";
import { CitationPopup } from "./popup.mjs";

export class ReferencesFeature {
  #app;
  #entries = [];
  #popup;
  #ready = null;

  /** Called with the bibliography line boxes (Map<page, boxes>) once known. */
  onRefsRegion = null;

  /** Called with the Abstract heading position (front matter ends there). */
  onContentStart = null;

  /** Called with the document-wide body-text height once known. */
  onBodyHeight = null;

  constructor(app) {
    this.#app = app;
    this.#popup = new CitationPopup(app);
  }

  onDocumentLoaded(pdfDocument) {
    this.#entries = [];
    this.#ready = (async () => {
      try {
        const lines = await extractLines(pdfDocument);
        this.#entries = parseReferences(lines);
        globalThis.__fxRefCount = this.#entries.length; // test introspection
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
        if (bodyH) await this.onBodyHeight?.(bodyH);
        const contentStart = findContentStart(lines);
        if (contentStart) await this.onContentStart?.(contentStart);
        const { heading, body } = findReferencesBody(lines);
        if (heading && body.length) {
          const boxes = new Map();
          for (const line of [heading, ...body]) {
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
        // Pages rendered before extraction finished need annotating now.
        this.reannotateRendered();
      } catch (e) {
        console.warn("FixateScholar: reference extraction failed", e);
      }
    })();
  }

  async onTextLayerRendered(pageView) {
    await this.#ready;
    if (this.#entries.length) this.annotatePage(pageView);
  }

  /** Rebuild hit-targets on every rendered page (geometry has changed). */
  reannotateRendered() {
    if (!this.#entries.length) return;
    const viewer = this.#app.pdfViewer;
    for (let i = 0; i < viewer.pagesCount; i++) {
      const pv = viewer.getPageView(i);
      if (pv?.textLayer?.div?.childElementCount) this.annotatePage(pv);
    }
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
      if (span.querySelector("span")) continue; // markedContent wrappers
      const text = span.textContent;
      if (!text) continue;
      segments.push({ span, start: joined.length, end: joined.length + text.length });
      joined += text;
    }

    for (const cite of findCitations(joined)) {
      const entries = resolveCitation(cite.keys, this.#entries);
      if (!entries.length) continue;
      for (const seg of segments) {
        if (seg.end <= cite.start || seg.start >= cite.end) continue;
        const localStart = Math.max(0, cite.start - seg.start);
        const localEnd = Math.min(seg.end - seg.start, cite.end - seg.start);
        for (const rect of rangeRects(seg.span, localStart, localEnd)) {
          const a = document.createElement("a");
          a.className = "fx-cite-hit";
          a.style.cssText =
            "position:absolute;pointer-events:auto;cursor:pointer;" +
            `left:${rect.left - layerRect.left}px;top:${rect.top - layerRect.top}px;` +
            `width:${rect.width}px;height:${rect.height}px;`;
          a.addEventListener("mouseenter", () =>
            this.#popup.scheduleShow(entries, a),
          );
          a.addEventListener("mouseleave", () => this.#popup.scheduleHide());
          a.addEventListener("click", (e) => {
            e.preventDefault();
            this.#popup.showNow(entries, a, { pinned: true });
          });
          layer.append(a);
        }
        // Color the citation text itself. A fixed, high-contrast color (set
        // in overlay.css) — not the document's own link color, which is often
        // a low-contrast pastel that's hard to read.
        if (seg.span.dataset.fxDone) {
          wrapRange(seg.span, localStart, localEnd, "fx-cite-c", null);
        }
      }
    }

    // In-paper references (Figure 3, Table 9, Section 5, Algorithm 2, …) get a
    // distinct fixed high-contrast color, also from overlay.css.
    for (const ref of findInternalRefs(joined)) {
      for (const seg of segments) {
        if (seg.end <= ref.start || seg.start >= ref.end) continue;
        if (!seg.span.dataset.fxDone) continue;
        const localStart = Math.max(0, ref.start - seg.start);
        const localEnd = Math.min(seg.end - seg.start, ref.end - seg.start);
        wrapRange(seg.span, localStart, localEnd, "fx-ref-c", null);
      }
    }

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
    for (const a of layer.querySelectorAll("a")) {
      const href = a.getAttribute("href") || "";
      if (/^(https?|mailto|tel):/i.test(href)) continue; // external — keep
      const r = a.getBoundingClientRect();
      if (!r.width || !r.height) continue;
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
