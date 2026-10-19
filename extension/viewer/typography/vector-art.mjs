// Vector art drawn among the words — a circled step number "①" drawn as a
// path, a boxed label, a highlight fill behind a phrase. The text layer knows
// nothing of it, and a processed span masks the canvas under it, so the circle
// or box vanished and the digit inside was re-set on its own ("( 1)ı2 )").
// Such a span stays on the canvas. Read from the page's operator list, not the
// pixels: exact, and independent of the zoom.

// A path thinner than this (PDF units) is a rule — an underline, a table
// border, a fraction bar — which the canvas-rule pass already accounts for.
const THIN = 1.2;

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

function transformBox(m, [x0, y0, x1, y1]) {
  const xs = [], ys = [];
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const WHITE = /^#?f{6}$/i;

const intersect = (a, b) => {
  const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[0] < r[2] && r[1] < r[3] ? r : null;
};

/**
 * The painted paths of a page's operator list, as boxes in PDF user space
 * [x0, y0, x1, y1]. Leaves out clip-only paths (painted nothing), rules
 * (thinner than THIN), white fills (a paper-coloured patch masks the same),
 * and annotation appearances (drawn over the page, not part of its text).
 * Each box is cut to the clip it is painted under, starting from the page's
 * `view`: a plot's lines run far off the figure and are clipped to it, and
 * their raw extent laid "art" across the text beside the figure.
 *
 * `bars`, when given, collects the HORIZONTAL rules left out above — thinner
 * than THIN, longer than they are thick — for barsNear.
 */
export function vectorArt({ fnArray, argsArray }, OPS, view = [-Infinity, -Infinity, Infinity, Infinity], bars = null, meta = null) {
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0], fill = "#000000", stroke = "#000000", clip = view, pendingClip = false, lineWidth = 1;
  const stack = [];
  let inAnnotation = 0;
  // `meta`, when given, learns what kind of page this is: how many text
  // operators draw INVISIBLY (text rendering mode 3 or 7 — an OCR layer
  // laid over a scan, whose glyphs are the scan's pixels) and how large the
  // largest image is, as a fraction of the view. A page whose text is all
  // invisible is a scan: its text layer says what the OCR read, not what the
  // page shows, and redrawn it replaced "number" with "ritimbtr" (R55).
  // The rendering mode is graphics state: saved by q and restored by Q. A
  // figure that sets mode 3 inside its own q…Q (labels drawn as clips, or
  // hidden) must not make the body text after it count as hidden — it did,
  // and a born-digital page of a private paper was taken for a scan.
  let textMode = 0;
  const modeStack = [];
  const viewArea = Number.isFinite(view[2] - view[0]) && Number.isFinite(view[3] - view[1]) ? (view[2] - view[0]) * (view[3] - view[1]) : 0;
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintJpegXObject, OPS.paintInlineImageXObject].filter((v) => v !== undefined));
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (meta) {
      if (fn === OPS.save || fn === OPS.paintFormXObjectBegin || fn === OPS.beginGroup) modeStack.push(textMode);
      else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd || fn === OPS.endGroup) { if (modeStack.length) textMode = modeStack.pop(); }
      else if (fn === OPS.setTextRenderingMode) textMode = args?.[0] ?? 0;
      else if (fn === OPS.showText || fn === OPS.showSpacedText) { if (textMode === 3 || textMode === 7) meta.hiddenText++; else meta.visibleText++; }
      else if (imageOps.has(fn) && viewArea > 0) {
        const b = transformBox(ctm, [0, 0, 1, 1]);
        meta.imageArea = Math.max(meta.imageArea, ((b[2] - b[0]) * (b[3] - b[1])) / viewArea);
      }
    }
    switch (fn) {
      case OPS.save: stack.push([ctm, fill, stroke, clip, lineWidth]); break;
      case OPS.restore: if (stack.length) [ctm, fill, stroke, clip, lineWidth] = stack.pop(); break;
      case OPS.transform: ctm = mul(ctm, args); break;
      case OPS.paintFormXObjectBegin:
        stack.push([ctm, fill, stroke, clip, lineWidth]);
        if (args?.[0]) ctm = mul(ctm, args[0]);
        // The form paints nothing outside its BBox.
        if (args?.[1] && clip) clip = intersect(clip, transformBox(ctm, args[1]));
        break;
      case OPS.paintFormXObjectEnd: if (stack.length) [ctm, fill, stroke, clip, lineWidth] = stack.pop(); break;
      // A form with a /Group passes its BBox here, not to paintFormXObjectBegin;
      // PDF.js clips to it through the form matrix.
      case OPS.beginGroup: {
        stack.push([ctm, fill, stroke, clip, lineWidth]);
        const g = args?.[0];
        if (g?.bbox && clip) clip = intersect(clip, transformBox(g.matrix ? mul(ctm, g.matrix) : ctm, g.bbox));
        break;
      }
      case OPS.endGroup: if (stack.length) [ctm, fill, stroke, clip, lineWidth] = stack.pop(); break;
      case OPS.beginAnnotation: inAnnotation++; break;
      case OPS.endAnnotation: inAnnotation = Math.max(0, inAnnotation - 1); break;
      case OPS.clip: case OPS.eoClip: pendingClip = true; break;
      case OPS.setFillRGBColor: if (typeof args?.[0] === "string") fill = args[0]; break;
      case OPS.setStrokeRGBColor: if (typeof args?.[0] === "string") stroke = args[0]; break;
      case OPS.setLineWidth: if (args?.[0] >= 0) lineWidth = args[0]; break;
      case OPS.constructPath: {
        const [op, , minMax] = args ?? [];
        const raw = minMax ? transformBox(ctm, minMax) : null;
        const painted = raw && clip ? intersect(raw, clip) : null;
        // W n / W f: the path narrows the clip for what follows (itself too).
        if (pendingClip) { clip = raw && clip ? intersect(clip, raw) : null; pendingClip = false; }
        const filledOnly = op === OPS.fill || op === OPS.eoFill;
        // A STROKED horizontal rule — ulem's strike-out is one — has a box of
        // no height; its ink is the line width thick, so that is its bar. Not
        // a white one: it inks nothing a mask would hide.
        if (bars && raw && clip && !inAnnotation && !filledOnly && op !== OPS.endPath && raw[3] - raw[1] < THIN && !WHITE.test(stroke)) {
          const half = (lineWidth * Math.hypot(ctm[2], ctm[3])) / 2;
          const bar = intersect([raw[0], raw[1] - half, raw[2], raw[3] + half], clip);
          if (bar && bar[3] - bar[1] < THIN && bar[2] - bar[0] > 2 * Math.max(bar[3] - bar[1], 0.5)) bars.push(bar);
        }
        if (inAnnotation || !painted || op === OPS.endPath) break;
        // A path in paper colour inks nothing: a white fill, a white outline.
        const strokes = !filledOnly, fills = op !== OPS.stroke && op !== OPS.closeStroke;
        // ...but a white fill INSIDE a coloured one is a shade of its own: a
        // white box in a grey panel, whose text must get white masks, not
        // the panel's grey (R55 review). Recorded only inside a shade, so a
        // chart's white rects do not fill the list.
        if (meta?.shades?.length && fills && WHITE.test(fill) && painted[2] - painted[0] >= 12 && painted[3] - painted[1] >= 8 &&
            meta.shades.some((s) => s[0] <= painted[0] + 0.5 && s[1] <= painted[1] + 0.5 && s[2] >= painted[2] - 0.5 && s[3] >= painted[3] - 0.5)) {
          meta.shades.push([painted[0], painted[1], painted[2], painted[3], fill]);
        }
        if (!(strokes && !WHITE.test(stroke)) && !(fills && !WHITE.test(fill))) break;
        const w = painted[2] - painted[0], h = painted[3] - painted[1];
        if (Math.min(w, h) < THIN) {
          // A filled bar (a TeX \rule); a stroked one was taken above.
          if (bars && filledOnly && h < THIN && w > 2 * Math.max(h, 0.5)) bars.push(painted);
          break;
        }
        // A coloured fill wide and tall enough to carry a line of text — a
        // callout's shading, a prompt box, a banded table row — is a SHADE
        // (`meta.shades`, with the fill as written): a span on it is masked
        // in its colour, not paper white, which showed as a white band
        // behind every line of a grey "Key Finding" box (R55, two private
        // papers). The engine samples the colour the page really shows from
        // its baseline render (rules-worker.mjs), so a translucent fill and a
        // pattern read right; the fill string is the stand-in without it.
        if (meta && fills && !WHITE.test(fill) && w >= 12 && h >= 8) (meta.shades ??= []).push([painted[0], painted[1], painted[2], painted[3], fill]);
        out.push(painted);
        break;
      }
    }
  }
  // The largest shades only: a bar chart fills hundreds of small rects, and
  // each one is sampled from the bitmap.
  if (meta?.shades?.length > 48) {
    const area = (s) => (s[2] - s[0]) * (s[3] - s[1]);
    meta.shades = meta.shades.sort((a, b) => area(b) - area(a)).slice(0, 48);
  }
  // By bottom edge, for artUnder's binary search: a plot-heavy page has tens
  // of thousands of boxes, and every candidate line is tested against them.
  bars?.sort((a, b) => a[1] - b[1]);
  return out.sort((a, b) => a[1] - b[1]);
}

/**
 * The thin horizontal bars (from vectorArt's `bars`, sorted) within reach of
 * this text item's mask: through its glyphs (a struck-out word — ulem's \sout,
 * latexdiff's deleted text), under them (an underscore drawn as a rule, as
 * LaTeX's classic encoding sets \_, an underline) or in the leading around
 * the line, where a mask's padding reaches. A processed span masks the canvas
 * around its glyphs, bars and all; the engine cuts these out of every mask.
 * That is always safe to do: the strip a bar is cut from shows the bar's own
 * ink. Returns the matching bars (PDF user space), possibly none.
 */
export function barsNear(bars, item) {
  const t = item?.transform;
  if (!bars?.length || !t || t[1] || t[2] || !(item.height > 0) || !(item.width > 0)) return [];
  const h = item.height;
  const x0 = t[4], x1 = t[4] + item.width;
  const lo = t[5] - 0.9 * h, hi = t[5] + 1.3 * h; // the bar's centre lies in here
  let a = 0, b = bars.length;
  while (a < b) { const mid = (a + b) >> 1; if (bars[mid][1] < lo - THIN) a = mid + 1; else b = mid; }
  const out = [];
  for (let i = a; i < bars.length && bars[i][1] < hi; i++) {
    const [b0, y0, b1, y1] = bars[i];
    const cy = (y0 + y1) / 2;
    if (cy < lo || cy > hi) continue;
    if (Math.min(x1, b1) - Math.max(x0, b0) > Math.min(0.5 * h, 0.5 * (b1 - b0))) out.push(bars[i]);
  }
  return out;
}

/**
 * Does vector art sit on this text item? `art` as vectorArt returns it (sorted). Only art on the scale of a line —
 * up to 2.5 × its height tall — counts: a figure or a framed block is far
 * larger, and its own text is decided elsewhere. The art must lie mostly
 * inside the item's line band, and overlap it along the line. Returns the
 * first such box (PDF user space), or null.
 */
export function artUnder(art, item) {
  const t = item?.transform;
  if (!art?.length || !t || t[1] || t[2] || !(item.height > 0) || !(item.width > 0)) return null;
  const h = item.height;
  const x0 = t[4], x1 = t[4] + item.width, y0 = t[5] - 0.3 * h, y1 = t[5] + h;
  // art is sorted by bottom edge (vectorArt); a box that counts reaches at
  // least 60% of its height into the band, and is at most 2.5 h tall, so its
  // bottom lies above y0 - 2.5 h.
  let lo = 0, hi = art.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (art[mid][1] < y0 - 2.5 * h) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < art.length && art[i][1] < y1; i++) {
    const [a0, b0, a1, b1] = art[i];
    if (b1 - b0 > 2.5 * h || b1 - b0 < 0.3 * h) continue;
    const ox = Math.min(x1, a1) - Math.max(x0, a0);
    const oy = Math.min(y1, b1) - Math.max(y0, b0);
    if (ox <= 0 || oy < 0.6 * (b1 - b0)) continue;
    if (ox >= Math.min(0.5 * (a1 - a0), 0.5 * h)) return art[i];
  }
  return null;
}
