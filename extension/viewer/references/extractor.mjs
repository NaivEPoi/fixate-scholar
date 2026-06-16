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
    const items = content.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || 0,
        h: it.height || Math.abs(it.transform[3]) || 10,
      }));
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
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let cur = null;
      for (const it of r.items) {
        // Threshold must stay below two-column gutters (~2.4× the font
        // height in typical two-column templates) while exceeding word spacing
        // — sized by the smaller item so a large heading can't inflate it.
        // Items in clearly different font sizes never share a line.
        const gap = cur ? it.x - cur.endX : 0;
        const differentFont =
          cur && Math.abs(cur.h - it.h) > Math.max(cur.h, it.h) * 0.25;
        if (cur && !differentFont && gap < Math.min(cur.h, it.h) * 2) {
          cur.text += (gap > Math.max(cur.h, it.h) * 0.15 ? " " : "") + it.str;
          cur.endX = Math.max(cur.endX, it.x + it.w);
        } else {
          cur = { text: it.str, x: it.x, y: it.y, page: p, h: it.h, endX: it.x + it.w };
          lines.push(cur);
        }
      }
    }

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
