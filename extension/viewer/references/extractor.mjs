// Extracts the document's full text as reading-order "lines" with geometry,
// using pdfDocument.getPage(i).getTextContent(). Runs once per document, off
// the render path. Output feeds the pure parser (parser.mjs).

/**
 * @returns {Promise<Array<{text:string, x:number, y:number, page:number,
 *           h:number, column:number}>>} lines in reading order
 */
export async function extractLines(pdfDocument) {
  const allLines = [];
  for (let p = 1; p <= pdfDocument.numPages; p++) {
    const page = await pdfDocument.getPage(p);
    const pageWidth = page.view[2] - page.view[0];
    const content = await page.getTextContent();
    let items = content.items
      .filter((it) => {
        if (!it.str || !it.str.trim()) return false;
        // Drop ROTATED text (diagonal/vertical watermarks like "Unpublished
        // working draft. Not for distribution.", sideways figure labels). Its
        // huge line height trips the reference-body's heading-size cutoff and
        // truncates the bibliography; it is never reading content anyway. A
        // horizontal item has transform b≈c≈0.
        const [a, b, c, d] = it.transform;
        const skew = Math.abs(b) + Math.abs(c);
        const scale = Math.abs(a) + Math.abs(d);
        return !(scale > 0 && skew > scale * 0.087); // > ~5° off-axis
      })
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || 0,
        h: it.height || Math.abs(it.transform[3]) || 10,
      }));
    // Drop REVIEW-DRAFT LINE-NUMBER GUTTERS: a column of ≥10 pure-digit items
    // on ≥10 distinct baselines within a narrow band in an outer margin
    // (mirrors the typography engine's gutter filter). Left in, the numbers
    // become phantom entry/citation content and their baselines pollute
    // reference grouping.
    items = dropLineNumberGutters(items, page.view[0], pageWidth);
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    // Two passes: first collect baseline "rows" (everything within a y
    // tolerance, both columns included), then split each row at column-sized
    // x gaps. Grouping in one y-then-x sweep merges the columns of
    // two-column layouts, whose lines share baselines.
    const rows = [];
    let row = null;
    for (const it of items) {
      if (row && Math.abs(row.y - it.y) < Math.max(row.h, it.h) * 0.6) {
        row.items.push(it);
      } else {
        row = { y: it.y, h: it.h, items: [it] };
        rows.push(row);
      }
    }
    const lines = [];
    const centerX = page.view[0] + pageWidth / 2;
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let cur = null;
      for (const it of r.items) {
        // Threshold must stay below two-column gutters (~2.4× the font
        // height in typical two-column templates) while exceeding word spacing
        // — sized by the smaller item so a large heading can't inflate it.
        // Items in clearly different font sizes never share a line.
        // Some templates (ACL, LNCS) use a NARROW gutter (~1.8× font height)
        // that fits under the 2× threshold, merging the left column's last
        // words with the right column's first (e.g. body + the "References"
        // heading — which then never matches the heading regex and disables
        // the whole citations feature). A gutter gap straddles the page
        // CENTER; a genuine full-width line only ever has word-sized spaces
        // there. So a gap that crosses the center may only be bridged when it
        // is word-spacing sized (< 0.8× the font height).
        const gap = cur ? it.x - cur.endX : 0;
        const crossesCenter = cur && cur.endX < centerX && it.x > centerX;
        const joinMax = Math.min(cur ? cur.h : it.h, it.h) * (crossesCenter ? 0.8 : 2);
        const differentFont =
          cur && Math.abs(cur.h - it.h) > Math.max(cur.h, it.h) * 0.25;
        if (cur && !differentFont && gap < joinMax) {
          cur.text += (gap > Math.max(cur.h, it.h) * 0.15 ? " " : "") + it.str;
          cur.endX = Math.max(cur.endX, it.x + it.w);
        } else {
          cur = { text: it.str, x: it.x, y: it.y, page: p, h: it.h, endX: it.x + it.w };
          lines.push(cur);
        }
      }
    }

    // Running headers/footers and page numbers live in the outer 6% vertical
    // bands (the same margins rule the typography engine applies). In reading
    // order they interleave the bibliography — a heading-sized "Page 18 of
    // 31" or bare page number then trips findReferencesBody's next-section
    // cutoff and truncates the reference list mid-bibliography. Only SHORT
    // outer-band lines are dropped: page furniture is a few words, while a
    // real bibliography entry whose first line lands in the band on a dense
    // page is a full column line and must survive.
    const pageH = page.view[3] - page.view[1];
    const filtered = lines.filter((l) => {
      const rel = (l.y - page.view[1]) / pageH;
      return (rel > 0.06 && rel < 0.94) || l.text.trim().length >= 45;
    });
    lines.length = 0;
    lines.push(...filtered);

    // Two-column layouts: assign columns so reading order is left column
    // top-to-bottom, then right column. A line is "right column" when it
    // starts past ~45% of the page and a meaningful share of lines do so.
    const mid = pageWidth * 0.45;
    const rightCount = lines.filter((l) => l.x > mid).length;
    const twoColumn = rightCount > lines.length * 0.25 && rightCount > 5;
    for (const l of lines) l.column = twoColumn && l.x > mid ? 1 : 0;
    lines.sort((a, b) => a.column - b.column || b.y - a.y || a.x - b.x);
    allLines.push(...lines);
  }
  return allLines.map(({ text, x, y, page, h, column, endX }) => ({
    text: text.trim(),
    x,
    y,
    page,
    h,
    column,
    endX,
  }));
}

/** Remove submission-draft line-number gutters (both outer margins): a column
 *  of ≥10 pure-digit items on ≥10 distinct baselines clustered in a narrow
 *  x-band whose centers sit in the outer 12% of the page. */
function dropLineNumberGutters(items, x0, pageWidth) {
  const drop = new Set();
  for (const sideTest of [(cx) => cx < pageWidth * 0.12, (cx) => cx > pageWidth * 0.88]) {
    const digits = items.filter(
      (it) => /^\d{1,4}$/.test(it.str.trim()) && sideTest(it.x + it.w / 2 - x0),
    );
    if (digits.length < 10) continue;
    digits.sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
    let run = [];
    let best = [];
    for (const it of digits) {
      const cx = it.x + it.w / 2;
      const c0 = run.length ? run[0].x + run[0].w / 2 : cx;
      if (run.length && cx - c0 > pageWidth * 0.025) {
        if (run.length > best.length) best = run;
        run = [];
      }
      run.push(it);
    }
    if (run.length > best.length) best = run;
    const baselines = new Set(best.map((it) => Math.round(it.y)));
    if (best.length >= 10 && baselines.size >= 10) for (const it of best) drop.add(it);
  }
  return drop.size ? items.filter((it) => !drop.has(it)) : items;
}
