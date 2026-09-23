// fontkeep's check — the per-page probe and the verdict — shared by the
// standalone harness (test/fontkeep.mjs) and the combined gate runner
// (test/allprobes.mjs). One copy, imported by both: the check means the same
// thing whichever of them runs it, and nothing has to read a probe back out of
// another file's source text to find out what it was.
//
// Invariant guard: a span set in a math, monospace, small-caps or bold-display
// face is NEVER processed. REQUIREMENTS.md states it (the "kept on canvas +
// obstacle" rows); nothing checked it, so "emphasis inside a code span" could
// only ever be argued about from screenshots — and it was, five times in one
// gate, wrongly every time. The tokens carrying emphasis in those papers were
// set in the BODY face, where the engine has no signal that they are code.
//
// Reads the font off the PROCESSED SPAN itself: #fontFamilyFor writes the
// item's own PDF.js fontName as the span's first CSS family, which resolves
// through commonObjs to the real font name — the same string the engine's own
// filter tests. No span<->item index alignment, which is what made an earlier
// version of this check inconclusive on 7 of 31 pages: PDF.js does not always
// emit one span per text item, and a mapping by DOM order degrades silently.
//
// Note the font id is read UNQUOTED: the engine writes it quoted, but CSSOM
// serializes a valid custom ident without quotes, so a pattern anchored on a
// quote matches nothing and every page reports a clean zero.
//
// Fails the run (exit 1) on any violation, and ALSO when it resolved no fonts
// at all — a check that reads zero because it is blind is worse than no check.
//
// Module shape (every test/probes/*.mjs has it):
//   probe(page, opts)   the page expression, a string for Runtime.evaluate
//   create()            fresh per-document state
//   add(state, page, r) fold one page's result in; returns { out, err } lines to print
//   summarize(state)    { ok, out, err, logLine } — the harness's own verdict lines

/** The page expression. `page` is 1-based. */
export const probe = (page) => `(async () => {
    const mod = await import(chrome.runtime.getURL("viewer/typography/engine.mjs"));
    const SPECIAL = mod.SPECIAL_FONT;
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page} - 1);
    if (!pv || !pv.textLayer) return null;
    const pdfPage = pv.pdfPage;
    const cache = new Map();
    const nameOf = (id) => {
      if (!cache.has(id)) {
        let n = "";
        try { n = pdfPage.commonObjs.get(id)?.name ?? ""; } catch { n = ""; }
        cache.set(id, n);
      }
      return cache.get(id);
    };
    const done = [...pv.textLayer.div.querySelectorAll("span[data-fx-done]")];
    let resolved = 0, unresolved = 0, violations = 0;
    const bad = [];
    for (const span of done) {
      const id = (span.style.fontFamily || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
      const real = id ? nameOf(id) : "";
      if (!real) { unresolved++; continue; }
      resolved++;
      if (SPECIAL.test(real)) {
        violations++;
        if (bad.length < 6) bad.push({ text: (span.textContent || "").trim().slice(0, 22), font: real });
      }
    }
    return { page: ${page}, processedSpans: done.length, resolved, unresolved, violations, bad };
  })()`;

export const create = () => ({ results: [] });

export function add(state, page, r) {
  if (r) state.results.push(r);
  return { out: [], err: [] };
}

export function summarize(state, { label = "doc" } = {}) {
  const results = state.results;
  const totals = results.reduce((a, r) => ({
    processedSpans: a.processedSpans + r.processedSpans,
    resolved: a.resolved + r.resolved,
    unresolved: a.unresolved + r.unresolved,
    violations: a.violations + r.violations,
  }), { processedSpans: 0, resolved: 0, unresolved: 0, violations: 0 });
  const offenders = results.filter((r) => r.violations);
  const out = [];
  out.push(`TOTALS: ${JSON.stringify({ pages: results.length, ...totals })}`);
  for (const r of offenders) out.push(`  p${r.page} violations=${r.violations} ${JSON.stringify(r.bad)}`);
  let ok = true;
  if (totals.violations) {
    out.push(`  FAIL ${totals.violations} processed span(s) set in a kept face`);
    ok = false;
  } else if (!totals.resolved) {
    // The blind-check guard: no resolved fonts means nothing was compared.
    out.push("  FAIL resolved no font names — the check proved nothing");
    ok = false;
  }
  const report = { pages: results.length, ...totals };
  const logLine = `${label} ${JSON.stringify(report)}`;
  out.push(logLine);
  return { ok, out, err: [], logLine };
}
