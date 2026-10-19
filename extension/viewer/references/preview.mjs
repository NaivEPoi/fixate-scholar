// A preview of what an in-paper reference points at, shown on hover: the
// figure or table itself, a theorem's statement, a section's opening lines,
// an equation — a clip of the target page rendered small, with the target's
// first lines as text under it, and the page number. Where the PDF carries a
// link for the reference (hyperref), its destination says where the target
// is; otherwise the target is found in the document's own lines by its label
// ("Theorem 2." at a line's start, "Figure 3:" in a caption, "4.2" opening a
// heading). The pure parts — the destination hash, the text search, the
// region to clip — are exported for their unit tests; the rest needs PDF.js.

/**
 * The destination behind a PDF.js link element's href, as the annotation
 * layer writes it (`linkService.getDestinationHash`): `#` + escape(name) for
 * a named destination, `#` + escape(JSON array) for an explicit one. Null for
 * anything else (an external URL, a page hash the viewer wrote itself).
 */
export function parseDestHash(href) {
  if (!href || href[0] !== "#") return null;
  let raw;
  try { raw = unescape(href.slice(1)); } catch { return null; }
  if (!raw || raw.includes("=")) return null; // "#page=3&zoom=…" is the viewer's own
  if (raw[0] === "[") {
    try { const arr = JSON.parse(raw); return Array.isArray(arr) ? { explicit: arr } : null; } catch { return null; }
  }
  return { name: raw };
}

/** What kind of thing a reference's leader names, for the region to show. */
export function kindOf(leader) {
  const l = leader.toLowerCase().replace(/\.$/, "");
  if (/^(fig|figs|figure|figures)$/.test(l)) return "figure";
  if (/^(tab|tabs|table|tables)$/.test(l)) return "table";
  if (/^(alg|algs|algorithm|algorithms|listing|listings)$/.test(l)) return "float";
  if (/^(eq|eqs|equation|equations)$/.test(l)) return "equation";
  if (/^(sec|secs|section|sections|§|§§|chapter|chapters|app|apps|appendix|appendices)$/.test(l)) return "section";
  return "statement"; // theorem, lemma, definition, claim, …
}

/** The leader and the first item of a reference's text: "Figure 3" →
 *  { leader: "Figure", num: "3" }; "§4.2" → { leader: "§", num: "4.2" };
 *  "Theorem\n2" with the break. Null when the text is not a reference. */
export function splitReference(text) {
  const m = /^\s*([A-Za-z]+\.?|§{1,2})\s*~?\s*\(?([A-Za-z]?\d+(?:\.\d+)*[a-z]?|[IVXLCivxlc]+)\)?/.exec(text.replace(/\s+/g, " "));
  if (!m) return null;
  return { leader: m[1], num: m[2] };
}

/**
 * The target's line, found in the document's extracted lines by the label
 * the target itself prints: a caption "Figure 3:" / "Fig. 3." / "Table 3",
 * a heading "3.2 Title" / "4 Title" / "III. TITLE" / "Appendix B", a statement
 * "Theorem 2." / "Lemma 2 (…)" / "Definition 2.1", an equation's tag "(5)"
 * at a line's end. The first match in reading order after `fromIndex`
 * (the referring line, so a figure cited before it appears is found ahead;
 * the whole document is searched when nothing follows). Null when none.
 */
export function targetByText(lines, leader, num, fromIndex = 0) {
  const kind = kindOf(leader);
  const n = num.replace(/[.)]+$/, "");
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re;
  // The number may end in a period or colon ("Theorem 2.", "Figure 3:"),
  // but not run on into more digits ("Figure 31", "4.2" for "4").
  const end = "(?!\\d|\\.\\d)";
  if (kind === "figure") re = new RegExp(`^(?:Fig(?:ure)?s?\\.?|FIG(?:URE)?S?\\.?)\\s*${esc}${end}`);
  else if (kind === "table") re = new RegExp(`^(?:Tab(?:le)?s?\\.?|TABLE)\\s*${esc}${end}`);
  else if (kind === "float") re = new RegExp(`^(?:Algorithm|Listing|Alg\\.|ALGORITHM)\\s*${esc}${end}`);
  else if (kind === "equation") re = new RegExp(`\\(${esc}\\)\\s*$`);
  else if (kind === "section") re = new RegExp(`^(?:(?:Appendix|APPENDIX|Section|Chapter|CHAPTER)\\s+)?${esc}\\.?(?:\\s+\\S|$)`);
  else {
    const lead = leader.replace(/\.$/, "");
    const l = lead.toLowerCase();
    const words = l.startsWith("lem") ? "Lemma" : l.startsWith("def") ? "Definition" : l.startsWith("cor") ? "Corollary" : l.startsWith("prop") ? "Proposition" : l.startsWith("claim") ? "Claim" : l.startsWith("ex") ? "Example" : l.startsWith("rem") ? "Remark" : l.startsWith("conj") ? "Conjecture" : "Theorem";
    re = new RegExp(`^${words}\\s+${esc}${end}`, "i");
  }
  const test = (i) => {
    const t = (lines[i]?.text || "").trim();
    if (!t) return false;
    if (kind === "section") {
      // A heading: short, and not a sentence of prose — "4.2 Attack model",
      // not "4.2 times faster than…" in a paragraph.
      if (t.length > 90 || /[.,;:]\s+[a-z]/.test(t.slice(0, 40))) return false;
      return re.test(t) && !/^\d+\.?\s*$/.test(t);
    }
    return re.test(t);
  };
  for (let i = Math.max(0, fromIndex); i < lines.length; i++) if (test(i)) return i;
  for (let i = 0; i < Math.min(fromIndex, lines.length); i++) if (test(i)) return i;
  return -1;
}

/**
 * The region of the page to show for a target at (x, y) in PDF user space
 * (y up), with the column's text extent [cx0, cx1] and the page's box: a
 * figure or table is above its caption, so the region reaches up from the
 * anchor; a statement, section or equation reads down from it. Heights in
 * PDF points, clipped to the page.
 */
export function regionFor(kind, anchor, column, pageBox, reach = null) {
  const [px0, py0, px1, py1] = pageBox;
  const x0 = Math.max(px0, (column?.x0 ?? px0) - 4);
  const x1 = Math.min(px1, (column?.x1 ?? px1) + 4);
  let top, bottom;
  if (kind === "figure" || kind === "table" || kind === "float") {
    top = anchor.y + (kind === "table" ? 28 : 230);
    bottom = anchor.y - (kind === "table" ? 170 : 40);
    // The float's known top (a link anchored there): the clip reaches it,
    // and no further — a measured float needs no guessed height.
    if (reach !== null && reach > anchor.y) top = reach + 8;
  } else if (kind === "equation") {
    top = anchor.y + 36;
    bottom = anchor.y - 36;
  } else {
    top = anchor.y + 14;
    bottom = anchor.y - 120;
  }
  top = Math.min(py1, top);
  bottom = Math.max(py0, bottom);
  if (top - bottom < 30) { top = Math.min(py1, bottom + 60); }
  return { x0, x1, y0: bottom, y1: top };
}

/** The text column a point on a page belongs to, from that page's lines:
 *  the lines within a band of the point, overlapping it in x, give the
 *  column's edges. Null when the page has no lines there. */
export function columnAt(lines, page, x, y) {
  let x0 = Infinity, x1 = -Infinity, n = 0;
  for (const l of lines) {
    if (l.page !== page || Math.abs(l.y - y) > 260) continue;
    const ex = l.endX ?? l.x + 200;
    // A line overlaps the point with little slack: a two-column gutter is
    // 18–22 pt, and the left column's justified lines end at its edge, so
    // 30 pt of slack took the whole page for a point on the right column's
    // left edge (a heading's x).
    if (l.x - 6 <= x && ex + 6 >= x) { x0 = Math.min(x0, l.x); x1 = Math.max(x1, ex); n++; }
  }
  return n >= 3 ? { x0, x1 } : null;
}

/**
 * The whole reference a coloured wrap belongs to. A reference is wrapped per
 * text node, and a processed span's text is cut into nodes by its emphasis
 * ("Tab" in bold, "le 3" after it), so one reference is several wraps; one
 * can also run on into the next line's span ("Theorem" / "2"). The wraps
 * contiguous with this one in the span, with no unwrapped text between, read
 * in order — and when they end the span, the next span's leading wraps.
 */
export function referenceText(wrap) {
  const host = wrap.closest(".textLayer > span") || wrap.parentElement;
  const nodes = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push({ n, inRef: !!n.parentElement?.closest(".fx-ref-c"), mine: wrap.contains(n) });
  let i = nodes.findIndex((x) => x.mine);
  if (i < 0) return wrap.textContent;
  let a = i, b = i;
  while (a > 0 && nodes[a - 1].inRef) a--;
  while (b < nodes.length - 1 && nodes[b + 1].inRef) b++;
  let text = nodes.slice(a, b + 1).map((x) => x.n.data).join("");
  if (b === nodes.length - 1) {
    // The reference may continue in the next span ("Theorem" / "2").
    let next = host.nextElementSibling;
    while (next && !next.textContent.trim()) next = next.nextElementSibling;
    const lead = next?.querySelector?.(".fx-ref-c");
    if (lead && next.firstChild && (next.firstChild === lead || next.firstChild.contains?.(lead) || !next.firstChild.textContent?.trim())) {
      const more = [];
      const w2 = document.createTreeWalker(next, NodeFilter.SHOW_TEXT);
      for (let n = w2.nextNode(); n; n = w2.nextNode()) { if (n.parentElement?.closest(".fx-ref-c")) more.push(n.data); else if (more.length) break; else if (n.data.trim()) break; }
      if (more.length) text += " " + more.join("");
    }
  }
  return text.trim();
}

const SHOW_DELAY = 180;
const MAX_CACHE = 40;

/**
 * The hover preview itself. One per document; `attach(pageView)` after a
 * page's references are annotated and after its annotation layer renders.
 * Needs: the viewer application (its pdfDocument and link service), the
 * document's extracted lines (set when they exist), and the popup to show in.
 */
export class ReferencePreview {
  #app;
  #popup;
  #lines = [];
  #cache = new Map(); // key -> { canvas, title, snippet, page }
  #timer = null;
  #token = 0;

  constructor(app, popup) {
    this.#app = app;
    this.#popup = popup;
  }

  setLines(lines) { this.#lines = lines || []; this.#cache.clear(); }

  /** Hover handlers on a page: our coloured wraps in the text layer, and the
   *  PDF's own internal links in the annotation layer (they sit above the
   *  text, so a hyperref'd reference reaches them, not the wrap). */
  attach(pageView) {
    const textLayer = pageView.textLayer?.div;
    if (textLayer && !textLayer.dataset.fxPreview) {
      textLayer.dataset.fxPreview = "1";
      textLayer.addEventListener("mouseover", (e) => {
        const wrap = e.target?.closest?.(".fx-ref-c");
        if (wrap) this.#enter(pageView, wrap, referenceText(wrap), null);
      });
      textLayer.addEventListener("mouseout", (e) => {
        if (e.target?.closest?.(".fx-ref-c")) this.#leave();
      });
    }
    const annot = pageView.div?.querySelector(".annotationLayer");
    if (annot && !annot.dataset.fxPreview) {
      annot.dataset.fxPreview = "1";
      annot.addEventListener("mouseover", (e) => {
        const a = e.target?.closest?.("a");
        if (!a || a.style.pointerEvents === "none") return;
        const dest = parseDestHash(a.getAttribute("href") || "");
        if (!dest) return;
        // The reference's words sit under the link's box, in the text layer.
        const r = a.getBoundingClientRect();
        const text = this.#textUnder(pageView, r);
        if (!text) return;
        this.#enter(pageView, a, text, dest);
      });
      annot.addEventListener("mouseout", (e) => {
        if (e.target?.closest?.("a")) this.#leave();
      });
    }
  }

  #textUnder(pageView, r) {
    const layer = pageView.textLayer?.div;
    if (!layer) return "";
    for (const w of layer.querySelectorAll(".fx-ref-c")) {
      const b = w.getBoundingClientRect();
      const ov = Math.min(r.right, b.right) - Math.max(r.left, b.left);
      if (ov > 0 && Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 0) return referenceText(w);
    }
    return "";
  }

  #enter(pageView, anchor, text, dest) {
    clearTimeout(this.#timer);
    const token = ++this.#token;
    this.#timer = setTimeout(async () => {
      let built;
      try { built = await this.#build(pageView, text, dest); } catch (e) { built = null; if (globalThis.__fxDebug) console.warn("FixateScholar: preview failed", e); }
      if (token !== this.#token || !built) return;
      this.#popup.showPreview(this.#node(built), anchor);
      if (globalThis.__fxDebug) (globalThis.__fxPreviews ??= []).push({ text, page: built.page, kind: built.kind, how: built.how }); // test introspection
    }, SHOW_DELAY);
  }

  #leave() {
    clearTimeout(this.#timer);
    this.#token++;
    this.#popup.scheduleHide();
  }

  #node(built) {
    const box = document.createElement("div");
    box.className = "fx-preview";
    box.dataset.fxPreviewPage = String(built.page);
    const head = document.createElement("div");
    head.className = "fx-preview-head";
    head.textContent = `${built.title} · page ${built.page}`;
    box.append(head);
    if (built.canvas) {
      built.canvas.className = "fx-preview-thumb";
      box.append(built.canvas);
    }
    if (built.snippet) {
      const p = document.createElement("div");
      p.className = "fx-preview-snippet";
      p.textContent = built.snippet;
      box.append(p);
    }
    return box;
  }

  /** The target: by the link's destination when there is one, else by the
   *  text of the reference in the document's lines. */
  async #build(pageView, text, dest) {
    const ref = splitReference(text);
    if (!ref) return null;
    const kind = kindOf(ref.leader);
    const title = `${ref.leader.replace(/\.$/, "")} ${ref.num}`;
    const doc = this.#app.pdfDocument;
    if (!doc) return null;
    let page = null, x = null, y = null, how = "text", lineIndex = -1;
    if (dest) {
      try {
        const arr = dest.explicit ?? await doc.getDestination(dest.name);
        if (Array.isArray(arr) && arr[0]) {
          page = (await doc.getPageIndex(arr[0])) + 1;
          if (typeof arr[2] === "number") x = arr[2];
          if (typeof arr[3] === "number") y = arr[3];
          how = "link";
        }
      } catch { /* an unresolvable destination — fall back to the text */ }
    }
    if (page === null || y === null) {
      // The referring line, so the search starts after it.
      const here = this.#lines.findIndex((l) => l.page === pageView.id && l.text.replace(/\s+/g, " ").includes(text.replace(/\s+/g, " ").slice(0, 24)));
      lineIndex = targetByText(this.#lines, ref.leader, ref.num, here >= 0 ? here + 1 : 0);
      if (lineIndex < 0) return null;
      const l = this.#lines[lineIndex];
      page = l.page; x = l.x; y = l.y + (l.h || 10);
      how = "text";
    }
    // A link's anchor is wherever the paper's class put it, not where the
    // target prints: a float's at its caption (hyperref) or at its TOP
    // (hypcap, acmart), a section's a skip above the heading with the x of
    // the page's margin — from which the clip took the two columns above a
    // figure, and a section's card the OTHER column's lines. The target's
    // own line, found by its label on the destination page (the page the
    // link settles), is the fixed point for every kind: its column, its top
    // for the clip, its text for the snippet. A float whose anchor sits
    // above its caption is measured by it: the clip reaches the anchor.
    let reach = null;
    if (how === "link") {
      const first = this.#lines.findIndex((l) => l.page === page);
      const ci = first >= 0 ? targetByText(this.#lines, ref.leader, ref.num, first) : -1;
      if (ci >= 0 && this.#lines[ci].page === page) {
        const l = this.#lines[ci];
        const top = l.y + (l.h || 10);
        if ((kind === "figure" || kind === "table" || kind === "float") && y > top + 2 * (l.h || 10)) reach = y;
        lineIndex = ci; x = l.x; y = top;
      }
    }
    const key = `${kind}:${page}:${Math.round(x ?? 0)}:${Math.round(y)}:${reach === null ? "" : Math.round(reach)}`;
    const cached = this.#cache.get(key);
    if (cached) return { ...cached, title, kind, how };
    const pdfPage = await doc.getPage(page);
    const box = pdfPage.view; // [x0, y0, x1, y1] in PDF user space
    const column = columnAt(this.#lines, page, x ?? (box[0] + box[2]) / 2, y);
    const region = regionFor(kind, { x: x ?? box[0], y }, column, box, reach);
    const canvas = await this.#render(pdfPage, region);
    // An equation's text layer is its symbols in stream order — "(HU)μνABQAφ
    // σ UB + h.c., (1)" — which says nothing the clip does not; no snippet.
    const snippet = kind === "equation" ? "" : this.#snippet(kind, page, y, lineIndex);
    const built = { canvas, snippet, page };
    this.#cache.set(key, built);
    if (this.#cache.size > MAX_CACHE) this.#cache.delete(this.#cache.keys().next().value);
    return { ...built, title, kind, how };
  }

  /** The target's own lines: a caption from its label on, a statement or
   *  heading from its line down — three lines, trimmed to a sentence or so. */
  #snippet(kind, page, y, lineIndex) {
    const lines = this.#lines;
    let start = lineIndex;
    if (start < 0) {
      // From a destination: the first line at or below the anchor on that page.
      let best = -1, bestDy = Infinity;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.page !== page) continue;
        const dy = y - l.y; // positive: the line is below the anchor
        if (dy >= -2 && dy < bestDy) { bestDy = dy; best = i; }
      }
      start = best;
    }
    if (start < 0) return "";
    const out = [];
    let len = 0;
    // A caption ends where the text stops continuing it: its own wrapped
    // lines pick up mid-sentence, in lowercase; the body line or heading
    // after it opens with a capital or a number ("NF interactions.", "3.3
    // Solution Sketch"). A statement or a section reads on down the page.
    const caption = kind === "figure" || kind === "table" || kind === "float";
    const h0 = lines[start].h || 10;
    for (let i = start; i < lines.length && out.length < 4 && len < 260; i++) {
      const l = lines[i];
      if (l.page !== page) break;
      const t = l.text.trim();
      if (!t) continue;
      // A subscript the extractor set on a line of its own ("reg" under a
      // Γ) is not a line; a bare number is the page's folio — the end.
      if ((l.h || h0) < h0 * 0.7) continue;
      if (/^\d+$/.test(t)) break;
      if (caption && out.length && !/^[a-z(]/.test(t)) break;
      out.push(t);
      len += t.length;
    }
    let s = out.join(" ").replace(/\s+/g, " ");
    if (s.length > 260) s = s.slice(0, 257).replace(/\s\S*$/, "") + "…";
    return s;
  }

  /** The page region rendered into a small canvas: the viewport's offsets
   *  move the region's corner to the origin, and the canvas is the region's
   *  size, so PDF.js clips the page to it. */
  async #render(pdfPage, region) {
    const w = region.x1 - region.x0, h = region.y1 - region.y0;
    if (!(w > 10) || !(h > 10)) return null;
    const cssW = Math.min(380, w);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = (cssW / w) * dpr;
    const base = pdfPage.getViewport({ scale: 1 });
    // In viewport space (y down) the region's top edge is base.height - y1.
    const viewport = pdfPage.getViewport({ scale, offsetX: -region.x0 * scale, offsetY: -(base.viewBox[3] - region.y1) * scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${Math.round((h / w) * cssW)}px`;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const task = pdfPage.render({ canvasContext: ctx, viewport });
    const timer = setTimeout(() => task.cancel(), 4000);
    try { await task.promise; } finally { clearTimeout(timer); }
    return canvas;
  }
}
