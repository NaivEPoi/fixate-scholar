// eqkeep's check — the per-page probe and the verdict — shared by the
// standalone harness (test/eqkeep.mjs) and the combined gate runner
// (test/allprobes.mjs). One copy, imported by both: the check means the same
// thing whichever of them runs it, and nothing has to read a probe back out of
// another file's source text to find out what it was.
//
// Invariant guard: no emphasis inside a DISPLAYED EQUATION.
//
// REQUIREMENTS.md and TESTING.md §3 both put displayed equations on the
// canvas, and nothing checked it. The defect that prompted this was invisible
// to every existing probe: `fontkeep` asks whether a processed span is set in
// a math FACE, and the offending token is not — LaTeX sets \exp, \cos, \min,
// \max, \log and \mod in upright ROMAN, the same face as body text, so the
// equation's operator name was emphasized while the symbols around it were
// left alone. `whyskip` was clean too, because nothing was wrongly SKIPPED.
//
// The criterion here is deliberately INDEPENDENT of the rule the engine uses
// to decide the same question. It keys on something the engine does not consult
// at all: a row carrying a trailing EQUATION NUMBER — "(5.6)", "(12)", "(A.3)"
// — hard against the column's right edge, set apart from the row's content
// (its own span, more than a word space clear), with no running prose on it.
//
// Module shape (every test/probes/*.mjs has it):
//   probe(page, opts)   the page expression, a string for Runtime.evaluate
//   create()            fresh per-document state
//   add(state, page, r) fold one page's result in; returns { out, err } lines to print
//   summarize(state)    { ok, out, err, logLine } — the harness's own verdict lines

/** The page expression. `page` is 1-based. */
export const probe = (page) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page} - 1);
  if (!pv || !pv.textLayer) return null;
  const spans = [...pv.textLayer.div.querySelectorAll("span")]
    .filter((s) => s.textContent.trim() && !s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)"));
  if (!spans.length) return { page: ${page}, rows: 0, eqRows: 0, violations: 0, bad: [] };

  // Group into visual rows by baseline.
  const rows = new Map();
  for (const s of spans) {
    const r = s.getBoundingClientRect();
    if (!r.width) continue;
    const key = Math.round(r.bottom / 3);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ s, r });
  }

  // THE PAGE'S GUTTER — a baseline is not a row on a two-column page.
  //
  // The left column's line and the right column's equation number share one
  // baseline, so a row keyed by baseline alone glues them together. The glued
  // pair then matches every test below — a trailing parenthesised number, hard
  // against the page's right edge, too few words to be a sentence — and a
  // correctly-emphasized body line in the left column is reported as emphasis
  // inside an equation. Seen on a private paper, where it also MASKED a real
  // violation elsewhere on the same page (R45). A real equation and its number
  // always live in ONE column.
  //
  // The gutter is the vertical band near the page's middle that the FEWEST
  // rows cross. Counting rows rather than marking occupied pixels is what
  // survives a full-width title, figure or table: those cross the gutter, and
  // a plain occupancy map would let any one of them erase it.
  const all = [...rows.values()].flat();
  const pageBox = pv.div.getBoundingClientRect();
  const x0 = pageBox.left, W = Math.max(1, Math.ceil(pageBox.width));
  const cover = new Int32Array(W);
  for (const arr of rows.values()) {
    const seen = new Uint8Array(W);
    for (const x of arr) {
      const a = Math.max(0, Math.floor(x.r.left - x0));
      const b = Math.min(W, Math.ceil(x.r.right - x0));
      for (let i = a; i < b; i++) seen[i] = 1;
    }
    for (let i = 0; i < W; i++) if (seen[i]) cover[i]++;
  }
  let maxCover = 0;
  for (let i = 0; i < W; i++) if (cover[i] > maxCover) maxCover = cover[i];
  const quiet = maxCover * 0.15;
  const lo = Math.floor(W * 0.3), hi = Math.ceil(W * 0.7);
  let gutter = null, best = 0, run = -1;
  for (let i = lo; i <= hi; i++) {
    const open = i < W && cover[i] <= quiet;
    if (open) { if (run < 0) run = i; continue; }
    if (run >= 0 && i - run > best) { best = i - run; gutter = x0 + (run + i) / 2; }
    run = -1;
  }
  if (run >= 0 && hi - run > best) { best = hi - run; gutter = x0 + (run + hi) / 2; }
  // Too narrow to be a gutter: a single-column page, where the whole row is
  // the segment and this behaves exactly as it did before.
  //
  // The floor only rejects slivers, and it is set from the PUBLIC corpus: at
  // the harness's rendering width the two-column gutter measures 3.4-3.7% of
  // the page on ACM and USENIX layouts but only 1.83% on the IEEE journal one,
  // so a floor anywhere near 2% throws a whole real layout away. Single-column
  // papers measure 0% — the detector finds no quiet band at all — which is the
  // evidence that this is not merely tuned low.
  //
  // Telling a gutter from a wide word-space is the coverage test's job, not
  // this one's: a single column's middle is crossed by nearly every row and
  // never comes close to being quiet.
  if (best < W * 0.01) gutter = null;

  const sideOf = (x) => (gutter === null ? 0 : (x.r.left < gutter ? 0 : 1));
  // Each column's own right edge — an equation number sits hard against the
  // margin of the column it belongs to, not the page's.
  const edges = [0, 1].map((side) => {
    const xs = all.filter((x) => sideOf(x) === side).map((x) => x.r.right).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length * 0.97)] : 0;
  });

  let eqRows = 0, violations = 0;
  const bad = [];
  for (const arr of rows.values()) {
    for (const side of gutter === null ? [0] : [0, 1]) {
      const seg = arr.filter((x) => sideOf(x) === side);
      if (!seg.length) continue;
      seg.sort((a, b) => a.r.left - b.r.left);
      const text = seg.map((x) => x.s.textContent).join(" ").trim();
      // A trailing equation number, hard against the column's right edge.
      if (!/\\(\\s*(?:[A-Z]\\s*[.-]\\s*)?\\d+(?:\\.\\d+)*\\s*\\)\\s*$/.test(text)) continue;
      const last = seg[seg.length - 1];
      if (last.r.right < edges[side] - 40) continue;
      // The number is SET APART, as a displayed equation's number is: it opens
      // a span of its own, and more than a word space separates it from what
      // precedes it. Measured over both corpora (R49), every real numbered
      // equation passes both - its number sits 0.47 to 14 line heights clear
      // of the equation. What failed them: a sentence ending in a value or an
      // enumeration "(3)" inside one span, bibliography years, table cells,
      // and inline math whose math-face spans sat on a baseline of their own
      // with the "(" 1 px after the name - four false violations in one gate.
      let k = seg.length - 1;
      while (k > 0 && !seg[k].s.textContent.includes("(")) k--;
      const own = seg[k].s.textContent.trim().startsWith("(");
      // Some exporters emit an equation line as ONE run, number included; the
      // number is still set apart there, by a run of spaces or a tab. A
      // sentence's "(3)" follows a single space.
      const spaced = /(?:\\s{2,}|\\t)\\(\\s*(?:[A-Z]\\s*[.-]\\s*)?\\d+(?:\\.\\d+)*\\s*\\)\\s*$/.test(seg[k].s.textContent);
      if (!own && !spaced) continue;
      if (own && k > 0 && seg[k].r.left - seg[k - 1].r.right < 0.3 * seg[k].r.height) continue;
      // No running prose: three or more ordinary lowercase words means a
      // sentence that merely ends in a parenthesised number, not an equation.
      const words = (text.match(/\\b[a-z]{3,}\\b/g) || [])
        .filter((w) => !/^(?:exp|log|ln|cos|sin|tan|max|min|sup|inf|lim|det|dim|deg|gcd|mod|arg|where|and|for|the)$/.test(w));
      if (words.length >= 3) continue;
      eqRows++;
      for (const x of seg) {
        if (!x.s.dataset.fxDone) continue;
        violations++;
        if (bad.length < 6) bad.push({ text: x.s.textContent.trim().slice(0, 24), row: text.slice(0, 60) });
      }
    }
  }
  return { page: ${page}, rows: rows.size, eqRows, violations, bad };
})()`;

export const create = () => ({ results: [] });

export function add(state, page, r) {
  if (r) state.results.push(r);
  return { out: [], err: [] };
}

export function summarize(state, { label = "doc" } = {}) {
  const results = state.results;
  const totals = results.reduce((a, r) => ({
    eqRows: a.eqRows + r.eqRows,
    violations: a.violations + r.violations,
  }), { eqRows: 0, violations: 0 });
  const out = [];
  out.push(`TOTALS: ${JSON.stringify({ pages: results.length, ...totals })}`);
  for (const r of results.filter((x) => x.violations)) {
    out.push(`  FAIL p${r.page} ${r.violations} emphasized span(s) in a numbered equation ${JSON.stringify(r.bad)}`);
  }
  let ok = true;
  // No page read at all is no measurement: 0 violations of 0 pages used to pass.
  if (!results.length) {
    out.push("  FAIL no page was probed — the check proved nothing");
    ok = false;
  }
  if (totals.violations) {
    out.push(`  FAIL ${totals.violations} processed span(s) inside a numbered displayed equation`);
    ok = false;
  }
  // Unlike fontkeep this one does NOT fail on zero rows examined: plenty of
  // real papers number no equations at all, and a document with none is
  // legitimately inapplicable. The sweep reports the count so a run that
  // examined nothing anywhere is visible rather than silent.
  const line = `${label} ${JSON.stringify({ pages: results.length, ...totals })}`;
  out.push(line);
  return { ok, out, err: [], logLine: line };
}
