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

/**
 * `chars`: one entry per character of the span's text, in order —
 * `{ space: true }` for whitespace, `{ color, n }` for a glyph sampled from `n`
 * inked pixels (`color` null when its ink is black or grey), `{}` when it had
 * too little ink to say.
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
  const cls = chars.map((ch) => (ch.space ? undefined : "color" in ch ? snap(ch.color) : undefined));
  // A colour only one faint glyph has is a blend at a colour change — a full
  // stop beside the first red letter read dark red — not a colour of its own.
  for (let i = 0; i < cls.length; i++) {
    if (cls[i]?.n === 1 && chars[i].n < FAINT && palette.length > 1) cls[i] = undefined;
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
