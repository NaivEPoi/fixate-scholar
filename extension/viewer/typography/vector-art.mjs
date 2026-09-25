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
 */
export function vectorArt({ fnArray, argsArray }, OPS, view = [-Infinity, -Infinity, Infinity, Infinity]) {
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0], fill = "#000000", clip = view, pendingClip = false;
  const stack = [];
  let inAnnotation = 0;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    switch (fn) {
      case OPS.save: stack.push([ctm, fill, clip]); break;
      case OPS.restore: if (stack.length) [ctm, fill, clip] = stack.pop(); break;
      case OPS.transform: ctm = mul(ctm, args); break;
      case OPS.paintFormXObjectBegin:
        stack.push([ctm, fill, clip]);
        if (args?.[0]) ctm = mul(ctm, args[0]);
        break;
      case OPS.paintFormXObjectEnd: if (stack.length) [ctm, fill, clip] = stack.pop(); break;
      case OPS.beginAnnotation: inAnnotation++; break;
      case OPS.endAnnotation: inAnnotation = Math.max(0, inAnnotation - 1); break;
      case OPS.clip: case OPS.eoClip: pendingClip = true; break;
      case OPS.setFillRGBColor: if (typeof args?.[0] === "string") fill = args[0]; break;
      case OPS.constructPath: {
        const [op, , minMax] = args ?? [];
        const raw = minMax ? transformBox(ctm, minMax) : null;
        const painted = raw && clip ? intersect(raw, clip) : null;
        // W n / W f: the path narrows the clip for what follows (itself too).
        if (pendingClip) { clip = raw && clip ? intersect(clip, raw) : null; pendingClip = false; }
        if (inAnnotation || !painted || op === OPS.endPath) break;
        const filledOnly = op === OPS.fill || op === OPS.eoFill;
        if (filledOnly && WHITE.test(fill)) break;
        if (Math.min(painted[2] - painted[0], painted[3] - painted[1]) < THIN) break;
        out.push(painted);
        break;
      }
    }
  }
  return out;
}

/**
 * Does vector art sit on this text item? Only art on the scale of a line —
 * up to 2.5 × its height tall — counts: a figure or a framed block is far
 * larger, and its own text is decided elsewhere. The art must lie mostly
 * inside the item's line band, and overlap it along the line.
 */
export function artUnder(art, item) {
  const t = item?.transform;
  if (!art?.length || !t || t[1] || t[2] || !(item.height > 0) || !(item.width > 0)) return false;
  const h = item.height;
  const x0 = t[4], x1 = t[4] + item.width, y0 = t[5] - 0.3 * h, y1 = t[5] + h;
  for (const [a0, b0, a1, b1] of art) {
    if (b1 - b0 > 2.5 * h || b1 - b0 < 0.3 * h) continue;
    const ox = Math.min(x1, a1) - Math.max(x0, a0);
    const oy = Math.min(y1, b1) - Math.max(y0, b0);
    if (ox <= 0 || oy < 0.6 * (b1 - b0)) continue;
    if (ox >= Math.min(0.5 * (a1 - a0), 0.5 * h)) return true;
  }
  return false;
}
