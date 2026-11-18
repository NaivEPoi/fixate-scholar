// A processed span's text in more than one colour — a latexdiff line runs
// black, red (deleted) and blue (added) within a single text item. The engine
// samples the canvas ink under each character (engine.mjs, inkRuns); these turn
// those samples into colour runs and wrap them, so each word keeps the colour
// the page gives it.

// Per-character samples differ a little (antialiasing, a neighbour's overhang);
// two within this of each other, channel by channel, are one colour.
const SAME = 80;
// Inked pixels below which a glyph's sample is faint (a full stop, a comma).
const FAINT = 24;

const parse = (c) => c.match(/\d+/g).map(Number);

/** `a` is `b` darkened toward black: the same direction in RGB, less of it. */
function shadeOf(a, b) {
  const na = Math.hypot(...a), nb = Math.hypot(...b);
  if (!(na > 0 && nb > 0) || na >= nb) return false;
  return a.reduce((t, v, k) => t + v * b[k], 0) / (na * nb) > 0.95;
}

// What survives of a subpixel tint where a glyph edge is cut off keeps the
// subpixels' ORDER — red, green, blue falling or rising in turn, green strictly
// between: orange or steel blue. Read over one letter or a window (`local`),
// such a remainder can be bright — (0, 146, 234) on a black "l" — and is never
// ink. Over a whole span the tints nearly cancel and what is left stays DARK —
// (68, 33, 0) at most — so there only a dark one is a tint, and a bright span
// in those hues (orange, goldenrod) keeps its colour. Dark ink in them cannot
// be told from a tint: brown or steel-blue text reads as black.
const tint = ([r, g, b], local) => {
  const lo = Math.min(r, b), hi = Math.max(r, b), k = (hi - lo) * 0.15;
  return g > lo + k && g < hi - k && (local || Math.max(r, g, b) <= 200);
};

/**
 * The ink colour behind summed channel DARKNESS `d` ([R, G, B], each the sum
 * over the pixels read of 1 - value / background — 255 - value on white
 * paper, to scale), or null when it is black or grey.
 *
 * The canvas is opaque, so the browser draws its text with subpixel (LCD)
 * antialiasing and a black glyph's edges are tinted, blue on one side and red
 * on the other: read pixel by pixel, plain black text came out "dark navy"
 * letter by letter. Subpixel rendering only shifts each channel's coverage
 * sideways, so summed over a glyph the three come out level for black ink and
 * in the ink's own proportions for coloured ink. Taking the ink's darkest
 * channel as full gives the colour back: darkness (0, k, k) is rgb(255, 0, 0).
 * `need` is the chroma (on 255) it must reach to count as coloured; `local`
 * says the sums cover a letter or a window rather than a whole span.
 */
export function inkColour(d, need, local = false) {
  const hi = Math.max(...d);
  if (!(hi > 0)) return null;
  const rgb = d.map((v) => Math.round(255 * (1 - v / hi)));
  return Math.max(...rgb) - Math.min(...rgb) >= need && !tint(rgb, local) ? rgb : null;
}

/**
 * `chars`: one entry per character of the span's text, in order —
 * `{ space: true }` for whitespace, `{ color, n }` for a glyph sampled from `n`
 * inked pixels (`color` null when its ink is black or grey), `{}` when it had
 * too little ink to say, and `{ punct: true, color }` for punctuation. A glyph
 * whose colour is null may carry `weak` (a colour it reads below the bar a
 * single letter must clear) or `unsure` (neither that nor clearly grey).
 *
 * Punctuation is mostly its neighbours' edges, so its own reading is weak: it
 * takes the colour of the letter before it — after it, opening a word: "(new"
 * — only where it reads that colour itself ("data," struck red), and is
 * neutral otherwise (the black comma after a green link digit, a tinted full
 * stop in black text).
 *
 * Returns `{ uniform }` when the whole span turns out to be one colour, an empty
 * array when it is all neutral, and otherwise the coloured runs
 * `[{ from, to, color }]` in character offsets (neutral text is left out: it
 * keeps the reading colour). Samples are first snapped to the span's palette, so
 * one colour stays one run; an unsampled character takes the colour of its own
 * word (left first), and a space the colour on both sides of it, if they agree.
 */
export function colourRuns(chars) {
  const palette = [];
  const snap = (color) => {
    if (color == null) return null;
    const rgb = parse(color);
    let c = palette.find((p) => p.rgb.every((v, k) => Math.abs(v - rgb[k]) < SAME));
    if (!c) palette.push((c = { rgb, sum: [0, 0, 0], n: 0 }));
    c.sum = c.sum.map((v, k) => v + rgb[k]);
    c.n++;
    return c;
  };
  const cls = chars.map((ch) => (ch.space || ch.punct ? undefined : "color" in ch ? snap(ch.color) : undefined));
  // A colour only one faint glyph has, and that is a DARKER SHADE of another
  // colour in the span, is a blend at a colour change — a full stop beside the
  // first red letter read dark red — not a colour of its own. A faint glyph in
  // a colour of its own (one struck letter) keeps it.
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (c?.n === 1 && chars[i].n < FAINT && palette.some((p) => p !== c && shadeOf(c.rgb, p.rgb))) cls[i] = undefined;
  }
  // A DARK colour — forest green, maroon — reads below the bar a single letter
  // must clear (a letter keeps one edge's tint, so only strong colour counts
  // there), and letter by letter such prose came out coloured here and black
  // there. A letter under the bar carries its reading as `weak`, and its WORD
  // decides: beside a strongly read letter of that colour it joins it; with
  // none, the word is coloured when half its letters read so. In a word three
  // fifths coloured, the letters that could not be read (faint, or neither
  // clearly grey) take its colour too.
  // (A weak reading is a paler or darker one of the same ink: the same
  // channels lightest and darkest, within 100 a channel.)
  const order = (rgb) => rgb.indexOf(Math.max(...rgb)) * 3 + rgb.indexOf(Math.min(...rgb));
  const near = (rgb, p) => p.rgb.every((v, k) => Math.abs(v - rgb[k]) < SAME) ||
    (order(rgb) === order(p.rgb) && p.rgb.every((v, k) => Math.abs(v - rgb[k]) < 100));
  for (let a = 0; a < chars.length; ) {
    if (chars[a].space) { a++; continue; }
    let b = a;
    while (b < chars.length && !chars[b].space) b++;
    const letters = [];
    for (let i = a; i < b; i++) if (!chars[i].punct && "color" in chars[i]) letters.push(i);
    const weak = letters.filter((i) => !cls[i] && chars[i].weak);
    if (weak.length) {
      const strong = [...new Set(letters.map((i) => cls[i]).filter(Boolean))];
      if (strong.length) {
        for (const i of weak) { const rgb = parse(chars[i].weak); const c = strong.find((q) => near(rgb, q)); if (c) cls[i] = c; }
      } else if (weak.length * 2 >= letters.length) {
        for (const i of weak) cls[i] = snap(chars[i].weak);
      }
    }
    const col = letters.filter((i) => cls[i]);
    if (col.length && col.length * 5 >= letters.length * 3 && col.every((i) => cls[i] === cls[col[0]])) {
      for (const i of letters) if (!cls[i] && (chars[i].n < FAINT || chars[i].weak || chars[i].unsure)) cls[i] = cls[col[0]];
    }
    a = b;
  }
  // Punctuation: the letter before it (after it, opening a word), if it reads
  // that colour itself.
  for (let i = 0; i < chars.length; i++) {
    if (!chars[i].punct) continue;
    let left, opens = true;
    for (let j = i - 1; j >= 0 && !chars[j].space && left === undefined; j--) if (!chars[j].punct) { left = cls[j]; opens = false; }
    if (opens) for (let j = i + 1; j < chars.length && !chars[j].space && left === undefined; j++) if (!chars[j].punct) left = cls[j];
    const own = chars[i].color ? parse(chars[i].color) : null;
    cls[i] = left && own && left.rgb.every((v, k) => Math.abs(v - own[k]) < SAME) ? left : null;
  }
  // An unsampled glyph: nearest sampled one in its own word, left first.
  for (let i = 0; i < chars.length; i++) {
    if (chars[i].space || cls[i] !== undefined) continue;
    let v;
    for (let j = i - 1; j >= 0 && !chars[j].space && v === undefined; j--) v = cls[j];
    for (let j = i + 1; j < chars.length && !chars[j].space && v === undefined; j++) v = cls[j];
    cls[i] = v ?? null;
  }
  // A space joins the run around it when both sides agree; else it is neutral.
  for (let i = 0; i < chars.length; i++) {
    if (!chars[i].space) continue;
    let l, r;
    for (let j = i - 1; j >= 0 && l === undefined; j--) if (!chars[j].space) l = cls[j];
    for (let j = i + 1; j < chars.length && r === undefined; j++) if (!chars[j].space) r = cls[j];
    cls[i] = l !== undefined && l === r ? l : null;
  }
  // Shades of one ink read apart (a thin letter darker than its word) are one
  // colour: the smaller joins the larger, or each letter came out its own green.
  const byN = palette.slice().sort((p, q) => q.n - p.n);
  const into = new Map();
  for (const c of byN) {
    const mean = c.sum.map((v) => v / c.n);
    const big = byN.find((q) => q !== c && !into.has(q) && q.n >= c.n && byN.indexOf(q) < byN.indexOf(c) && near(mean, { rgb: q.sum.map((v) => v / q.n) }));
    if (big) into.set(c, big);
  }
  if (into.size) for (let i = 0; i < cls.length; i++) if (cls[i] && into.has(cls[i])) cls[i] = into.get(cls[i]);
  const css = (c) => `rgb(${c.sum.map((v) => Math.round(v / c.n)).join(", ")})`;
  const glyphs = cls.filter((c, i) => !chars[i].space);
  if (glyphs.length && glyphs.every((c) => c && c === glyphs[0])) return { uniform: css(glyphs[0]) };
  const runs = [];
  for (let i = 0; i < cls.length; ) {
    const c = cls[i];
    let j = i + 1;
    while (j < cls.length && cls[j] === c) j++;
    if (c) runs.push({ from: i, to: j, color: css(c) });
    i = j;
  }
  return runs;
}

/**
 * Wrap each run's characters of `span` in an inline `<fx-ink>` carrying the
 * colour — whole sibling nodes where a run covers them (a word and its emphasis
 * `<b>` in one wrap), descending into an element only where a run's edge falls
 * inside it. Nodes are split, never rebuilt, so the emphasis `<b>` and a search
 * match's `<span class="highlight">` keep their identity. Not a `<span>`:
 * everything that walks the text layer for leaf spans (`span:not(.fx-cite-c)…`,
 * in the engine and the harnesses) must not start seeing these as text items.
 * A span that already has its wraps is left alone.
 */
export function wrapInk(span, runs) {
  if (span.querySelector("fx-ink")) return;
  for (const { from, to, color } of runs) wrapRun(span, from, to, color);
}

function wrapRun(el, from, to, color) {
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const wrap = el.ownerDocument.createElement("fx-ink");
    wrap.style.color = color;
    // Also as --fx-ink, which a search match inside reads its colour from
    // (overlay.css): set on the span for a one-colour span, here for a run.
    wrap.style.setProperty("--fx-ink", color);
    group[0].before(wrap);
    wrap.append(...group);
    group = [];
  };
  let pos = 0;
  for (const kid of [...el.childNodes]) {
    const s = pos, e = pos + kid.textContent.length;
    pos = e;
    if (e <= from || s >= to) { flush(); continue; }
    if (s >= from && e <= to) { group.push(kid); continue; }
    if (kid.nodeType === 3) {
      // A text node the run's edge cuts: split off the part inside the run.
      let piece = kid;
      if (to < e) piece.splitText(to - s);
      if (from > s) piece = piece.splitText(from - s);
      group.push(piece);
      continue;
    }
    flush();
    wrapRun(kid, Math.max(from, s) - s, Math.min(to, e) - s, color);
  }
  flush();
}
