// The line classifier's features (line-model.mjs), computed from PDF.js
// text items the way ml/docbank_lines.py computes them from DocBank
// tokens — the same names, the same definitions, so a model trained there
// runs here. Everything is geometry, font names and text shape: no canvas.
//
// Units: DocBank boxes run 0..1000 across the page in both axes; items are
// given in PDF user space with the page's width and height, and are scaled
// the same way. A "token" here is one PDF.js text item split at spaces
// into words with proportional boxes (DocBank tokens are words).

const CAP_LEAD = /^(?:Fig(?:ure)?\.?|FIG\.?|Tab(?:le)?\.?|TABLE|FIGURE|Algorithm|Listing)\s*(?:\d|[IVXLCDM]+\b|[A-Z]\.?\d)/;
const NUM_LEAD = /^(?:\d+(?:\.\d+)*\.?|[A-Z]\d*[.:]|[A-Z](?:\.\d+)+\.?|[IVX]{1,5}\.|(?:[a-zA-Z]|\d+)\))(?:$|\s)/;
const LIST_MARK = /^(?:[•·▪–—\-*]|\(?\d{1,2}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}[.)])(?:\s|$)/;
const DANGLING = /\b(?:a|an|and|as|at|between|by|for|from|in|into|of|on|or|over|than|the|to|under|via|with)\s*$/i;
const WORD = /[A-Za-z][a-z]+/g;
const LOWER_WORD = /\b[a-z][a-z]+\b/g;
const MATHSYM = /[=+\-±×÷<>≤≥≠∞∑∏∫√∂∇αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ^_{}\\|]/g;

export function fontFlags(name) {
  const u = (name || "").toUpperCase();
  return {
    f_bold: +/BOLD|CMBX|-B(?:[^A-Z]|$)|BX\d|SFBX|BLACK|HEAVY|SEMIBOLD/.test(u),
    f_italic: +/ITALIC|OBLIQUE|CMTI|CMMI|-I(?:[^A-Z]|$)|SFTI|SLANT|CMSL/.test(u),
    f_mono: +/MONO|CMTT|COURIER|SFTT|TYPEWRITER|CONSOLAS|INCONSOLATA/.test(u),
    f_math: +/CMMI|CMSY|CMEX|MSBM|MSAM|MATHEMATICAL|[-_ ]MATH|SYMBOL|RSFS|EUFM|EUSM|STIXMATH|STIX.*MATH|WASY|AMSB|AMSA|LMMI|LMSY|LMEX|TXMI|TXSY|PXMI|PXSY|MTMI|MTSY|MTEX|CMBSY|CMMIB|EURM|EUSB|BBOLD/.test(u),
    f_smallcaps: +/CMCSC|SMALLCAPS|-SC(?:[^A-Z]|$)|CAPS/.test(u),
    f_sans: +/HELVETICA|ARIAL|SFSS|CMSS|SANS|VERDANA|CALIBRI|DEJAVUSANS|LMSANS/.test(u),
  };
}

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** PDF.js text items (str, transform, width, height, fontName with the
 *  font's name resolved) → DocBank-like tokens [text, x0, y0, x1, y1, r, g, b, font].
 *  y grows DOWN the page here, as in DocBank: y0 = top. */
export function tokensOfItems(items, pageW, pageH, fontNameOf = (it) => it.fontName) {
  const out = [];
  const sx = 1000 / pageW, sy = 1000 / pageH;
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const text = (it.str || "").trim();
    if (!text || !(it.width > 0) || !(it.height > 0) || !it.transform) continue;
    const x = it.transform[4], yBase = it.transform[5], h = it.height, w = it.width;
    const top = pageH - yBase - h * 0.8, bottom = pageH - yBase + h * 0.2; // ascent/descent split of the em box
    const words = text.split(/\s+/);
    const total = words.reduce((s, wd) => s + wd.length, 0) + Math.max(words.length - 1, 0);
    let cx = x;
    const font = fontNameOf(it) || "default";
    for (const wd of words) {
      const ww = total ? w * (wd.length / total) : w;
      // slot 9: the source item's index, which the engine uses to map each
      // item to the line it fell in (the Python side has no such slot)
      out.push([wd, Math.round(cx * sx), Math.round(top * sy), Math.max(Math.round((cx + ww) * sx), Math.round(cx * sx) + 1), Math.max(Math.round(bottom * sy), Math.round(top * sy) + 1), 0, 0, 0, font, idx]);
      cx += ww + (total ? w / total : 0);
    }
  }
  return out;
}

/** Tokens → lines: the clustering of docbank_lines.build_lines. */
export function buildLines(toks) {
  if (!toks.length) return [];
  const sorted = [...toks].sort((a, b) => (a[2] + a[4]) / 2 - (b[2] + b[4]) / 2 || a[1] - b[1]);
  const bands = [];
  for (const t of sorted) {
    const cy = (t[2] + t[4]) / 2, h = Math.max(t[4] - t[2], 1);
    let placed = false;
    for (let i = Math.max(0, bands.length - 6); i < bands.length; i++) {
      const b = bands[i], bh = Math.max(b.y1 - b.y0, 1);
      if (cy >= b.y0 - 0.25 * bh && cy <= b.y1 + 0.25 * bh && Math.abs(h - bh) <= 0.6 * Math.max(h, bh)) {
        b.toks.push(t); b.y0 = Math.min(b.y0, t[2]); b.y1 = Math.max(b.y1, t[4]); placed = true; break;
      }
    }
    if (!placed) bands.push({ y0: t[2], y1: t[4], toks: [t] });
  }
  const lines = [];
  for (const b of bands) {
    const ts = [...b.toks].sort((p, q) => p[1] - q[1]);
    let cur = [ts[0]];
    const lh = Math.max(b.y1 - b.y0, 1);
    for (let i = 1; i < ts.length; i++) {
      if (ts[i][1] - ts[i - 1][3] > 2.0 * lh) { lines.push(cur); cur = [ts[i]]; } else cur.push(ts[i]);
    }
    lines.push(cur);
  }
  return lines.sort((a, b) => Math.min(...a.map((t) => t[2])) - Math.min(...b.map((t) => t[2])) || Math.min(...a.map((t) => t[1])) - Math.min(...b.map((t) => t[1])));
}

function pageStatistics(lines) {
  const hs = [];
  for (const L of lines) for (const t of L) if (t[4] > t[2]) hs.push(t[4] - t[2]);
  const counts = new Map();
  for (const h of hs.length ? hs : [10]) { const k = Math.round(h); counts.set(k, (counts.get(k) || 0) + 1); }
  let bodyH = 10, best = -1;
  for (const [k, n] of counts) if (n > best || (n === best && k < bodyH)) { best = n; bodyH = k; }
  const lefts = lines.map((L) => Math.min(...L.map((t) => t[1]))).sort((a, b) => a - b);
  const rights = lines.map((L) => Math.max(...L.map((t) => t[3]))).sort((a, b) => a - b);
  const pct = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
  return { body_h: bodyH, left: pct(lefts, 0.05), right: pct(rights, 0.95), mid: 500 };
}

const NEIGHBOUR_KEYS = ["h_rel", "x0", "x1", "f_bold", "f_italic", "f_math", "f_mono", "n_lower", "ends_period", "dangling", "cap_lead", "num_lead", "centred", "fills_measure", "frac_mathfont"];

function lineRecord(L, st) {
  const text = L.map((t) => t[0]).join(" ");
  const x0 = Math.min(...L.map((t) => t[1])), x1 = Math.max(...L.map((t) => t[3]));
  const y0 = Math.min(...L.map((t) => t[2])), y1 = Math.max(...L.map((t) => t[4]));
  const hs = L.map((t) => t[4] - t[2]).filter((h) => h > 0);
  const h = hs.length ? median(hs) : y1 - y0;
  const fontCounts = new Map();
  for (const t of L) fontCounts.set(t[8], (fontCounts.get(t[8]) || 0) + 1);
  let font = L[0][8], fb = -1;
  for (const [f, n] of fontCounts) if (n > fb) { fb = n; font = f; }
  const n = L.length;
  const mathFonts = L.reduce((s, t) => s + fontFlags(t[8]).f_math, 0);
  const nonblack = L.filter((t) => t[5] || t[6] || t[7]).length;
  const words = text.match(WORD) || [], lower = text.match(LOWER_WORD) || [];
  const parts = text.split(/\s+/);
  const capsWords = parts.filter((w) => /^[A-Z][a-z]/.test(w));
  const len = Math.max(text.length, 1);
  const r = {
    x0: x0 / 1000, x1: x1 / 1000, width: (x1 - x0) / 1000, y0: y0 / 1000, y1: y1 / 1000, h: h / 1000,
    h_rel: st.body_h ? h / st.body_h : 1,
    n_tok: n, n_chars: text.length, n_words: words.length, n_lower: lower.length,
    frac_digit: [...text].filter((c) => /\d/.test(c)).length / len,
    frac_upper: [...text].filter((c) => c !== c.toLowerCase() && c === c.toUpperCase()).length / len,
    frac_punct: [...text].filter((c) => !/[\p{L}\p{N}\s]/u.test(c)).length / len,
    frac_mathsym: (text.match(MATHSYM) || []).length / len,
    frac_mathfont: mathFonts / n, frac_nonblack: nonblack / n, n_fonts: fontCounts.size,
    title_case: capsWords.length / Math.max(parts.length, 1),
    ends_period: +/[.!?]\s*$/.test(text), ends_comma: +text.trimEnd().endsWith(","), ends_colon: +text.trimEnd().endsWith(":"),
    dangling: +DANGLING.test(text), cap_lead: +CAP_LEAD.test(text), num_lead: +NUM_LEAD.test(text), list_mark: +LIST_MARK.test(text),
    has_at: +text.includes("@"), has_url: +(text.includes("http") || text.includes("www.")), has_cid: +text.includes("(cid:"),
    bracket_ref: +/\[\d{1,3}\]/.test(text), year: +/\b(?:19|20)\d{2}\b/.test(text),
    ...fontFlags(font),
    left_gap: (x0 - st.left) / 1000, right_gap: (st.right - x1) / 1000,
  };
  r.centred = +(Math.abs((x0 - st.left) - (st.right - x1)) < 40 && (x0 - st.left) > 30);
  r.fills_measure = +((st.right - x1) < 12);
  r.col = x1 <= st.mid + 10 ? 0 : x0 >= st.mid - 10 ? 1 : 2;
  return r;
}

/** The shape of ONE span's text, by the tests the line record applies to
 *  a whole line: lowercase words, a number or list marker at its head, and
 *  whether it ends a sentence. The engine's release (line-model.mjs
 *  releasesKeep) reads these off the span rather than its line, because
 *  buildLines joins a page's columns into one line wherever the gutter is
 *  narrower than two line heights — a table row with its side note, an
 *  affiliation with a footnote — and a joined line reads as prose. */
export function textShape(text) {
  const t = (text || "").trim();
  return {
    n_lower: (t.match(LOWER_WORD) || []).length,
    num_lead: +NUM_LEAD.test(t), list_mark: +LIST_MARK.test(t),
    ends_sentence: +/[.!?]["'\u201d\u2019)\]]*$/.test(t),
  };
}

/** Feature records for every line of a page, in reading order. */
export function pageFeatures(lines) {
  if (!lines.length) return [];
  const st = pageStatistics(lines);
  const recs = lines.map((L) => lineRecord(L, st));
  const nL = recs.length;
  const blocks = [];
  for (let i = 0; i < nL; i++) {
    if (i === 0) { blocks.push([0]); continue; }
    const r = recs[i], p = recs[i - 1];
    const gap = Math.abs(r.y0 - p.y1) / Math.max(r.h, 1e-4);
    const fresh = gap > 1.35 || Math.abs(r.h_rel - p.h_rel) > 0.15 || r.col !== p.col || r.y0 < p.y0;
    if (fresh) blocks.push([i]); else blocks[blocks.length - 1].push(i);
  }
  for (const b of blocks) {
    const first = recs[b[0]], last = recs[b[b.length - 1]];
    const mMath = mean(b.map((j) => recs[j].frac_mathfont)), mLower = mean(b.map((j) => recs[j].n_lower)), mH = mean(b.map((j) => recs[j].h_rel));
    const bw = Math.max(...b.map((j) => recs[j].x1)) - Math.min(...b.map((j) => recs[j].x0));
    b.forEach((j, k) => {
      const r = recs[j];
      Object.assign(r, { blk_len: b.length, blk_pos: k / Math.max(b.length - 1, 1), blk_first: +(k === 0), blk_last: +(k === b.length - 1),
        blk_cap_lead: first.cap_lead, blk_num_lead: first.num_lead, blk_list_mark: first.list_mark, blk_first_centred: first.centred, blk_first_x0: first.x0, blk_first_bold: first.f_bold,
        blk_last_fills: last.fills_measure, blk_last_period: last.ends_period, blk_mean_math: mMath, blk_mean_lower: mLower, blk_mean_hrel: mH, blk_width: bw });
    });
  }
  for (let i = 0; i < nL; i++) {
    const r = recs[i];
    r.line_idx = i; r.n_lines = nL; r.pos = i / Math.max(nL - 1, 1); r.body_h = st.body_h / 1000;
    for (const [off, tag] of [[-2, "p2"], [-1, "p1"], [1, "n1"], [2, "n2"]]) {
      const j = i + off;
      if (j >= 0 && j < nL) {
        const o = recs[j];
        r[`${tag}_gap`] = Math.abs(o.y0 - r.y0) / Math.max(r.h, 1e-4);
        for (const k of NEIGHBOUR_KEYS) r[`${tag}_${k}`] = o[k];
        r[`${tag}_same_font`] = +(o.f_bold === r.f_bold && o.f_italic === r.f_italic && Math.abs(o.h_rel - r.h_rel) < 0.12);
      } else {
        r[`${tag}_gap`] = -1;
        for (const k of NEIGHBOUR_KEYS) r[`${tag}_${k}`] = -1;
        r[`${tag}_same_font`] = -1;
      }
    }
  }
  return recs;
}
