// Canvas line-art detection: the scan that finds table rules, box frames,
// underlines and separators in a page bitmap. Its own module, free of any page
// or DOM code, because it runs in two places: in the engine (the live-canvas
// fallback) and in rules-worker.mjs, off the main thread, over the page's
// baseline render (engine #baselineRules). Lengths are in PAGE units — CSS px
// at 100% zoom — and scaled to the bitmap's resolution (see engine.mjs, above
// RULE_MIN_WIDTH, for how each value was chosen).
//
// RULE_STROKE is the stroke the scan must find in a pixel column, summed over
// the rows the anti-aliasing spread it across. A 0.4pt hairline lands as one
// dark pixel or two light ones depending on sub-pixel phase, and at 180% the
// base canvas is CAPPED below one device px per CSS px (maxCanvasPixels) — the
// per-pixel "luminance < 140" test read the same frame edge as a rule at 100%
// and as nothing at 180%. Coverage summed across the spread is the stroke width
// times its darkness at any resolution and any phase.
const RULE_STROKE = 0.25; // min stroke, page px (~0.19pt of black)
const RULE_MIN_LEN = 34; // ~60 CSS px at 180%
const RULE_MAX_THICK = 3; // 3 CSS px at 100%

/**
 * Long, thin dark runs in an RGBA bitmap of a page — table rules, box frames,
 * underlines, footnote separators — as {x0, y0, x1, y1} in the bitmap's own
 * pixels (x1/y1 exclusive). `ppu`/`ppuY` are bitmap px per page px (CSS px at
 * 100%), and every length is RULE_* × ppu, so the scan means the same thing at
 * any resolution it is handed. Guards against false positives from glyph rows:
 * a run must be RULE_MIN_LEN long, at most RULE_MAX_THICK thick after
 * band-merge, and ISOLATED (the rows just above and below the band are mostly
 * light within its x-extent — an in-glyph row fails because the glyphs
 * continue above/below).
 *
 * A pixel counts as rule ink when the ink summed over it and its two
 * neighbours ACROSS the rule (rows for a horizontal rule, columns for a
 * vertical one) reaches RULE_STROKE page px: that sum is the rasterised stroke
 * width whatever the resolution and sub-pixel phase. The pixel must carry some
 * ink itself, so a band never grows onto the blank rows beside it.
 *
 * One dark/light byte per pixel, resolved in a single row-major sweep: the band
 * scans and isolation checks used to re-evaluate the luminance predicate per
 * pixel through a closure, and the vertical scan walked column-major over the
 * RGBA buffer, missing cache on essentially every read.
 */
export function scanRules(data, W, H, ppu, ppuY) {
  const out = [];
  const ink = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < ink.length; p++, i += 4) {
    if (data[i + 3] > 40) {
      ink[p] = 255 - (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
  }
  const need = (k) => Math.min(255 * 2.7, 255 * RULE_STROKE * k); // 3-px window max is 3×255
  const needH = need(ppuY), needV = need(ppu);
  // A pixel must carry half the window's requirement — the share of an
  // evenly split stroke — but never more than the old per-pixel test asked
  // (ink > 115). The floor is relative: a fixed one outranked the whole
  // requirement on a low-resolution canvas (ppu ≲ 1) and rejected an evenly
  // split hairline there. 12 only keeps paper-white noise out.
  const own = (t) => Math.max(12, Math.min(115, t / 2));
  const ownH = own(needH), ownV = own(needV);
  const dark = new Uint8Array(W * H); // horizontal-rule ink (window across rows)
  const darkV = new Uint8Array(W * H); // vertical-rule ink (window across columns)
  for (let y = 0; y < H; y++) {
    const row = y * W;
    const up = y > 0 ? row - W : -1;
    const dn = y < H - 1 ? row + W : -1;
    for (let x = 0; x < W; x++) {
      const p = row + x;
      const v = ink[p];
      if (!v) continue;
      if (v >= ownH && v + (up >= 0 ? ink[up + x] : 0) + (dn >= 0 ? ink[dn + x] : 0) >= needH) dark[p] = 1;
      if (v >= ownV && v + (x > 0 ? ink[p - 1] : 0) + (x < W - 1 ? ink[p + 1] : 0) >= needV) darkV[p] = 1;
    }
  }
  // Isolation probes sit one page px outside a band (never under 2 device px).
  const isoY = Math.max(2, Math.round(ppuY));
  const isoX = Math.max(2, Math.round(ppu));
  const darkFrac = (x0, x1, y) => {
    if (y < 0 || y >= H) return 0;
    let n = 0, d = 0;
    const row = y * W;
    for (let x = x0; x < x1; x += 2) { n++; if (dark[row + x]) d++; }
    return n ? d / n : 0;
  };
  const minLen = Math.max(24, Math.round(RULE_MIN_LEN * ppu));
  // +2: the across-window can admit an anti-aliased fringe row on EACH side.
  const maxThick = Math.max(3, Math.round(RULE_MAX_THICK * ppuY) + 2);
  // Horizontal runs per row → merge vertically adjacent runs into bands.
  const bands = []; // {y0,y1,x0,x1}
  for (let y = 0; y < H; y++) {
    let run = 0, x0 = 0;
    const row = y * W;
    for (let x = 0; x <= W; x++) {
      if (x < W && dark[row + x]) { if (!run) x0 = x; run++; continue; }
      if (run >= minLen) {
        const x1 = x;
        // findLast and slice().reverse().find() return the same element,
        // but `??` fell through to the copy whenever findLast found
        // NOTHING — the common case — so the O(n) copy of an up-to-800
        // entry list ran on nearly every completed run.
        const prev = bands.findLast((b) => b.y1 === y - 1 && x0 < b.x1 + 4 && x1 > b.x0 - 4);
        if (prev) { prev.y1 = y; prev.x0 = Math.min(prev.x0, x0); prev.x1 = Math.max(prev.x1, x1); }
        else if (bands.length < 800) bands.push({ y0: y, y1: y, x0, x1 });
      }
      run = 0;
    }
  }
  for (const b of bands) {
    if (b.y1 - b.y0 + 1 > maxThick) continue; // too thick — a filled area/image
    // Isolation: rows just outside the band are mostly light in its span.
    if (darkFrac(b.x0, b.x1, b.y0 - isoY) > 0.35 || darkFrac(b.x0, b.x1, b.y1 + isoY) > 0.35) continue;
    out.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 + 1 });
    if (out.length >= 400) break;
  }
  // Vertical rules (cell borders, listing frames) — the same scan
  // transposed. Column step 1, run down y; merge horizontally adjacent.
  const darkFracV = (y0, y1, x) => {
    if (x < 0 || x >= W) return 0;
    let n = 0, d = 0;
    for (let y = y0; y < y1; y += 2) { n++; if (darkV[y * W + x]) d++; }
    return n ? d / n : 0;
  };
  const minLenV = Math.max(24, Math.round(RULE_MIN_LEN * ppuY));
  const maxThickV = Math.max(3, Math.round(RULE_MAX_THICK * ppu) + 2);
  const vbands = []; // {x0,x1,y0,y1}
  for (let x = 0; x < W; x++) {
    let run = 0, y0 = 0;
    for (let y = 0; y <= H; y++) {
      if (y < H && darkV[y * W + x]) { if (!run) y0 = y; run++; continue; }
      if (run >= minLenV) {
        const y1 = y;
        // Same element as the reverse-copy scan, without copying the list.
        const prev = vbands.findLast((b) => b.x1 === x - 1 && y0 < b.y1 + 4 && y1 > b.y0 - 4);
        if (prev) { prev.x1 = x; prev.y0 = Math.min(prev.y0, y0); prev.y1 = Math.max(prev.y1, y1); }
        else if (vbands.length < 400) vbands.push({ x0: x, x1: x, y0, y1 });
      }
      run = 0;
    }
  }
  for (const b of vbands) {
    if (b.x1 - b.x0 + 1 > maxThickV) continue;
    if (darkFracV(b.y0, b.y1, b.x0 - isoX) > 0.35 || darkFracV(b.y0, b.y1, b.x1 + isoX) > 0.35) continue;
    out.push({ x0: b.x0, y0: b.y0, x1: b.x1 + 1, y1: b.y1 });
    if (out.length >= 700) break;
  }
  return out;
}
