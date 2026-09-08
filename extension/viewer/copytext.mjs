// Copy behavior: a paragraph should reach the clipboard as ONE line.
//
// A PDF has no paragraphs — it has typeset lines. PDF.js models that faithfully:
// every text item that ends a line gets a `<br>` after it in the text layer, and
// its own copy handler serializes `selection.toString()`, so pasting a paragraph
// gives you the page's line breaks verbatim, hyphenation and all:
//
//     Existing CSI-based indoor localization approaches fall
//     largely into three categories: channel charting, which
//     learns geometry-preserving latent representations sub-
//     sequently aligned to physical coordinates …
//
// That is the shape of the PAGE, not of the text. Re-wrapped anywhere else it
// reads as ragged fragments, and "sub- sequently" is not a word.
//
// This module rebuilds the paragraph. It reads the same lines the browser would
// have serialized, decides where one paragraph ends and the next begins from the
// GEOMETRY (indent, leading, and — in justified text — a short last line), joins
// the rest with a single space, and repairs the hyphen at each join.
//
// Nothing here is template-specific: the thresholds are fractions of the page
// box, and the two-column rule is the same one `references/extractor.mjs` uses.

// ASCII hyphen-minus and U+2010 HYPHEN are the two a typesetter emits at a
// break. An en/em dash never is, and a soft hyphen (U+00AD) is by definition
// only a break opportunity, so it always disappears on the join.
const HYPHEN_END = /[-‐]$/;
const WORD = "[\\p{L}\\p{N}\\u2019'\\u00ad-]";
const LAST_WORD = new RegExp(`${WORD}+$`, "u");
const FIRST_WORD = new RegExp(`^${WORD}+`, "u");

// A line that opens a list item: a bullet, an enumerator, or a bibliography
// marker. It always starts a block of its own — and, because such a list is set
// with a HANGING indent, its continuation lines are indented and must NOT be
// read as new paragraphs (which is the opposite of the first-line-indent rule
// that governs ordinary prose).
const LIST_MARKER =
  /^\s*(?:[•‣▪◦·]|[*+]\s|[–—-]\s|\(?\d{1,2}[.)]\s|\(?[a-z][.)]\s|\[[A-Za-z0-9+]{1,9}\]\s)/;

// A URL or DOI broken across lines: the break carries no space, so the pieces
// must butt together. (The typography engine's segmenter guards the same shapes
// against emphasis; this is the copy-side counterpart, kept local because it
// tests only a line's TAIL.)
const LINK_TAIL = /(?:https?:\/\/|ftp:\/\/|www\.|doi\.org\/|\b10\.\d{4,9}\/)\S*$/i;

/**
 * What the document itself knows about a hyphen.
 *
 * "well-\nknown" and "infor-\nmation" are indistinguishable on the page: TeX
 * writes the same glyph whether it broke a word or broke AT a compound's own
 * hyphen. The document is the tiebreaker — a paper that hyphenates "infor-
 * mation" almost always writes "information" somewhere else, and one that
 * breaks "well-known" writes it intact somewhere else too. So: learn every
 * whole word in the document, then ask which of the two readings it has seen.
 *
 * Unknown either way falls back to joining, which is the common case by a wide
 * margin (TeX hyphenates far more words than it breaks compounds).
 */
export class HyphenVocabulary {
  #plain = new Set();
  #compound = new Set();

  /** @param texts iterable of strings (one document line each is ideal —
   *  a token split across two lines then never enters the vocabulary). */
  learn(texts) {
    for (const text of texts) {
      for (const raw of (text ?? "").toLowerCase().match(new RegExp(`${WORD}+`, "gu")) ?? []) {
        // A line-final "infor-" is the very thing we are trying to resolve;
        // it is not evidence of anything.
        const token = raw.replace(/^[-‐]+|[-‐]+$/g, "");
        if (token.length < 3) continue;
        (/[-‐]/.test(token) ? this.#compound : this.#plain).add(token);
      }
    }
  }

  get size() {
    return this.#plain.size + this.#compound.size;
  }

  /** "join" (drop the hyphen), "keep" (it is a compound's own), or null. */
  verdict(tail, head) {
    if (!tail || !head) return null;
    const a = tail.toLowerCase();
    const b = head.toLowerCase();
    if (this.#plain.has(a + b)) return "join";
    if (this.#compound.has(`${a}-${b}`)) return "keep";
    return null;
  }
}

/**
 * A general English word list — the second opinion when the document itself has
 * nothing to say.
 *
 * The document's own vocabulary is the better witness (it knows "baseband" and
 * "hyperparameter", which no general dictionary carries) but it is silent
 * whenever the word in question appears exactly once, hyphen-broken, and never
 * again. Over 20 papers that is 356 of 1315 undecided hyphens; this settles 285
 * of those, and its answer is the user's rule literally: the hyphen stays when
 * it sits BETWEEN TWO WORDS.
 *
 * Held as one newline-delimited string rather than a Set: 111k short strings
 * cost several megabytes of heap, the string costs its own 1.04 MB, and a
 * handful of `includes` per copy is far below anything a reader can feel.
 */
export class WordList {
  #index = "";

  /** @param text sorted, newline-delimited, leading and trailing newline. */
  load(text) {
    if (!text) return;
    this.#index = (text.startsWith("\n") ? text : "\n" + text).trimEnd() + "\n";
  }

  get ready() {
    return this.#index.length > 1;
  }

  has(word) {
    return word.length > 1 && this.#index.includes(`\n${word}\n`);
  }

  /** "join" (the two pieces are one word), "keep" (they are two), or null. */
  verdict(tail, head) {
    if (!this.ready || !tail || !head) return null;
    const a = tail.toLowerCase();
    const b = head.toLowerCase();
    // Order matters: a closed compound the list knows ("throughput",
    // "background") must win over its two halves, which are also words.
    if (this.has(a + b)) return "join";
    if (this.has(a) && this.has(b)) return "keep";
    return null;
  }
}

/** Fetch and parse the vendored list; resolves to an empty list if it is
 *  missing (a dev tree that has not run `npm run fetch-pdfjs` still works —
 *  the document's vocabulary and the shape rules carry on alone). */
export async function loadWordList(url) {
  const list = new WordList();
  try {
    const res = await fetch(url);
    if (res.ok) list.load(await res.text());
    else console.warn(`FixateScholar: word list not vendored (HTTP ${res.status})`);
  } catch (e) {
    console.warn("FixateScholar: word list unavailable", e);
  }
  return list;
}

/**
 * Join two lines of one paragraph.
 *
 * No hyphen: a single space, which is what the line break stood for.
 * A hyphen: it goes only when it was splitting ONE word — the piece before it
 * ends lowercase, the next line starts lowercase, and that piece is not itself
 * already hyphenated ("state-of-" continuing into "the-art" is a compound
 * mid-stride, not a broken word). That is a guess, and two witnesses overrule
 * it: the document's own vocabulary first, then the general word list.
 *
 * @param decide `{document, words}` — either may be absent.
 */
export function joinLines(a, b, decide = {}) {
  const left = (a ?? "").replace(/\s+$/, "");
  const right = (b ?? "").replace(/^\s+/, "");
  if (!left) return right;
  if (!right) return left;
  if (left.endsWith("­")) return left.slice(0, -1) + right; // SOFT HYPHEN
  // A wrapped link takes no space and keeps whatever character it broke on.
  if (LINK_TAIL.test(left)) return left + right;
  if (!HYPHEN_END.test(left)) return `${left} ${right}`;

  const stem = left.slice(0, -1);
  const tail = LAST_WORD.exec(stem)?.[0] ?? "";
  const head = FIRST_WORD.exec(right)?.[0] ?? "";
  const looksBroken =
    /\p{Ll}$/u.test(tail) && /^\p{Ll}/u.test(head) && !/[-‐]/.test(tail);
  // The word list holds no hyphenated entries, so it is asked about the plain
  // alphabetic pieces: "end-" continuing into "to-end" is "end" and "to".
  const verdict =
    decide.document?.verdict(tail, head) ??
    (looksBroken
      ? decide.words?.verdict(/\p{L}+$/u.exec(tail)?.[0] ?? "", /^\p{L}+/u.exec(head)?.[0] ?? "")
      : null) ??
    (looksBroken ? "join" : "keep");
  // Either way the two pieces butt together — the only question is whether the
  // hyphen survives between them.
  return verdict === "join" ? stem + right : left + right;
}

/** p-th percentile of a numeric array (p in 0..1), nearest-rank. */
function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
}

function median(values) {
  return percentile(values, 0.5);
}

/**
 * Reflow selected lines into paragraphs.
 *
 * @param lines `{text, x0, x1, y, page}` in reading order, x/y as FRACTIONS of
 *        the page box (so zoom, page size and rotation drop out).
 * @param decide `{document, words}` — the hyphen witnesses (see joinLines)
 * @returns the clipboard text: one line per paragraph.
 */
export function flowLines(lines, decide = {}) {
  const kept = lines.filter((l) => l.text && l.text.trim());
  if (kept.length < 2) return kept.map((l) => l.text.trim()).join("\n");

  // TWO groupings, and they answer different questions.
  //
  // `block` is reading order: a new one starts wherever the text jumps back UP
  // the page or onto another page — which is exactly a column break. Deriving
  // it from the jump rather than from an x threshold matters, because a copy is
  // usually a handful of lines: a page-wide "is this a two-column document?"
  // vote (what extractor.mjs can afford over a whole document) has nothing to
  // count when the selection is one paragraph straddling one column break.
  let block = 0;
  kept[0].block = 0;
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1];
    const b = kept[i];
    if (b.page !== a.page || b.y < a.y - 0.002) block++;
    b.block = block;
  }

  // `col` is geometry: lines are clustered by where they START, so the left and
  // right columns get their own margins while the same column on consecutive
  // pages shares one. The gap that separates clusters is far wider than a
  // paragraph indent and far narrower than a column gutter.
  const starts = [...new Set(kept.map((l) => l.x0))].sort((a, b) => a - b);
  const bounds = [];
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] - starts[i - 1] > 0.06) bounds.push(starts[i]);
  }
  for (const l of kept) l.col = bounds.filter((b) => l.x0 >= b).length;

  // Margins per column. Percentiles, not min/max: one full-width line (a wide
  // equation, a spanning figure caption) would otherwise define the margin and
  // make every ordinary line look short — i.e. a paragraph break after each.
  const cols = new Map();
  for (const l of kept) {
    let c = cols.get(l.col);
    if (!c) cols.set(l.col, (c = { x0: [], x1: [] }));
    c.x0.push(l.x0);
    c.x1.push(l.x1);
  }
  // Every column of a document is the same width, which is what saves the
  // sparse ones: a paragraph that ends two lines into the next column gives
  // that column no margin of its own to measure, and its own longest line
  // would then BE the margin — so no line there could ever look short.
  const dense = [...cols.values()].filter((c) => c.x1.length >= 3);
  dense.sort((a, b) => b.x1.length - a.x1.length);
  const columnWidth = dense.length
    ? percentile(dense[0].x1, 0.9) - percentile(dense[0].x0, 0.1)
    : kept.reduce((w, l) => Math.max(w, l.x1 - l.x0), 0); // (not Math.max(...) — a
  // select-all can hand this thousands of lines, and spread would overflow)
  for (const [, c] of cols) {
    c.left = percentile(c.x0, 0.1);
    c.right = c.x1.length >= 3 ? percentile(c.x1, 0.9) : c.left + columnWidth;
  }
  // Justified text ends every line but a paragraph's last one at the right
  // margin, which makes "short" a reliable paragraph signal. Ragged-right text
  // ends lines wherever the next word did not fit, and it is not. One verdict
  // for the whole selection: a column with two lines in it cannot hold a vote.
  const atMargin = kept.filter((l) => l.x1 >= cols.get(l.col).right - 0.012).length;
  const justified = atMargin >= kept.length * 0.55;

  // Leading: the usual baseline step inside a column, for spotting the wider
  // gap a new paragraph (or a heading) opens up.
  const steps = [];
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1];
    const b = kept[i];
    if (a.block === b.block && b.y > a.y) steps.push(b.y - a.y);
  }
  const leading = median(steps);

  // A running head or foot is not part of any paragraph, and on a full page it
  // is the only thing between one page's last line and the next page's first.
  // The band is the same outer slice of the page the typography engine treats
  // as margin furniture.
  const inMargin = (l) => l.y < 0.045 || l.y > 0.95;

  /** @param first the line that opened the block `a` belongs to */
  const isBreak = (a, b, first) => {
    if (inMargin(a) || inMargin(b)) return true;
    // A line broken with a hyphen is never a paragraph's last line — the word
    // itself continues. This outranks every geometric signal below, and it is
    // the one that carries a word across a column or page break.
    if (HYPHEN_END.test(a.text.replace(/\s+$/, ""))) return false;
    if (LIST_MARKER.test(b.text)) return true; // the next item starts here
    const c = cols.get(a.col);
    const cb = cols.get(b.col);
    // A line that stops well short of the margin ended its paragraph. The
    // tolerance is wider for ragged-right text, where short lines are normal.
    const short = a.x1 < c.right - (justified ? 0.05 : 0.15);
    // Across a column or page break the paragraph does continue — that is what
    // a column break IS — unless the line before it had already ended one.
    if (a.block !== b.block) return short;
    // An indented line opens a paragraph in first-line-indent prose, but
    // CONTINUES one in a hanging-indent list — where the indent marks exactly
    // the lines that are not new items.
    if (!LIST_MARKER.test(first.text) && b.x0 > cb.left + 0.01) return true;
    if (leading > 0 && b.y - a.y > leading * 1.6) return true; // extra space
    return short;
  };

  // A line that OPENS a block keeps its leading whitespace — a listing's
  // indentation is content, and only a joined line's is a line-break artifact.
  const opening = (l) => l.text.replace(/\s+$/, "");
  const out = [];
  let first = kept[0];
  let cur = opening(kept[0]);
  for (let i = 1; i < kept.length; i++) {
    if (isBreak(kept[i - 1], kept[i], first)) {
      out.push(cur);
      first = kept[i];
      cur = opening(kept[i]);
    } else {
      cur = joinLines(cur, kept[i].text, decide);
    }
  }
  out.push(cur);
  return out.filter((l) => l.trim()).join("\n");
}

/** The text-layer line fragments of one page, in document order; `null` marks
 *  a PDF line end (PDF.js appends a <br> after the item that ends a line).
 *  `.markedContent` wrappers are transparent (display:contents), and the
 *  emphasis/citation wrappers this extension adds live INSIDE a fragment, so
 *  the walk never descends into one. */
function* fragments(node) {
  for (const el of node.children) {
    if (el.tagName === "BR") yield null;
    else if (el.classList.contains("markedContent")) yield* fragments(el);
    else if (el.tagName === "SPAN") yield el;
  }
}

/** The part of `el`'s text that lies inside the selection ("" if none). */
function selectedText(el, ranges) {
  let out = "";
  for (const range of ranges) {
    if (!range.intersectsNode(el)) continue;
    const r = document.createRange();
    r.selectNodeContents(el);
    // comparePoint: -1 before the element's contents, 0 inside, 1 after. Clamp
    // to the selection only where the selection's own boundary falls inside.
    try {
      if (r.comparePoint(range.startContainer, range.startOffset) === 0) {
        r.setStart(range.startContainer, range.startOffset);
      }
      if (r.comparePoint(range.endContainer, range.endOffset) === 0) {
        r.setEnd(range.endContainer, range.endOffset);
      }
    } catch {
      /* boundary in another tree — take the whole fragment */
    }
    out += r.toString();
  }
  return out;
}

/**
 * The selected PDF lines, in document order, with page-relative geometry.
 * Geometry comes from the WHOLE line even when only part of it is selected —
 * the margin tests are about the line's place on the page, not the selection's.
 */
export function selectedLines(app, selection) {
  const ranges = [];
  for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i));
  if (!ranges.length) return [];
  const viewer = app.pdfViewer;
  const lines = [];
  for (let p = 0; p < viewer.pagesCount; p++) {
    const layer = viewer.getPageView(p)?.textLayer?.div;
    if (!layer?.childElementCount) continue;
    if (!ranges.some((r) => r.intersectsNode(layer))) continue;
    const box = layer.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    let cur = null;
    const flush = () => {
      if (cur?.text.trim()) lines.push(cur);
      cur = null;
    };
    for (const el of fragments(layer)) {
      if (el === null) {
        flush();
        continue;
      }
      const rect = el.getBoundingClientRect();
      cur ??= { text: "", x0: 1, x1: 0, y: 1, page: p };
      if (rect.width || rect.height) {
        cur.x0 = Math.min(cur.x0, (rect.left - box.left) / box.width);
        cur.x1 = Math.max(cur.x1, (rect.right - box.left) / box.width);
        cur.y = Math.min(cur.y, (rect.top - box.top) / box.height);
      }
      cur.text += selectedText(el, ranges);
    }
    flush();
  }
  return lines;
}

/**
 * Install the flowing-copy handler.
 *
 * PDF.js binds its own `copy` listener to each text-layer div and finishes with
 * preventDefault + stopPropagation — but NOT stopImmediatePropagation, so a
 * listener added to the SAME element afterwards still runs and can replace the
 * text/plain flavour it wrote. That is the seam this uses: no patching, no
 * document-level capture (which would have to stop propagation and would take
 * PDF.js's own select-all-and-copy path down with it).
 *
 * @param app PDFViewerApplication
 * @param opts.isOn  () => boolean, read at copy time so the setting is live
 * @param opts.decide `{document, words}` — read at copy time, so the word list
 *        may still be loading when this is installed
 */
export function installFlowCopy(app, { isOn, decide }) {
  const bound = new WeakSet();
  const attach = (pageView) => {
    const layer = pageView?.textLayer?.div;
    if (!layer || bound.has(layer)) return;
    bound.add(layer);
    layer.addEventListener("copy", (event) => {
      if (!isOn()) return;
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed) return;
      let text;
      try {
        text = flowLines(selectedLines(app, selection), decide);
      } catch (e) {
        console.warn("FixateScholar: flowing copy failed, using the plain selection", e);
        return; // PDF.js's own text/plain is already on the clipboard
      }
      if (!text) return;
      // Match PDF.js's own normalization so ligatures and friends paste the
      // same way they do without this feature.
      const normalize = globalThis.pdfjsLib?.normalizeUnicode;
      event.clipboardData.setData("text/plain", normalize ? normalize(text) : text);
      event.preventDefault();
    });
  };
  return attach;
}
