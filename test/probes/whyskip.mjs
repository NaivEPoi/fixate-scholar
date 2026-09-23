// whyskip's check — the per-page probe and the verdict — shared by the
// standalone harness (test/whyskip.mjs) and the combined gate runner
// (test/allprobes.mjs). One copy, imported by both: the check means the same
// thing whichever of them runs it, and nothing has to read a probe back out of
// another file's source text to find out what it was.
//
// Why did the engine leave this prose alone?
//
// Turns on `globalThis.__fxDebug` BEFORE reading mode is enabled, so every skip
// records its reason in `data-fx-why`, then lists the unprocessed PROSE spans
// with that reason and their position down the page.
//
// Reasons come from two places: #classifyBlocks (caption, line-head, runin,
// blk-table, fig-body, …) and the candidate filter (margin-band, over-body,
// special-or-short, script-attach, left-margin). The filter used to record
// nothing at all, so an unprocessed line read as "(none)" — indistinguishable
// from a line the engine never saw. That ambiguity hid a real bug: a fixed 6%
// footer band was swallowing the last line of body text on papers with a tight
// bottom margin, on 12 of one document's 20 pages, in complete silence.
//
// `trailing` counts unreasoned prose sitting at or below everything the engine
// processed — the "last line of the column left alone" shape. It should be 0.
//
// EXIT 1 when it isn't — and when `unreasoned` isn't either. Both counts are
// the pass criterion, and a run that examined no prose at all fails too, so it
// cannot pass blind.
//
// Module shape (every test/probes/*.mjs has it):
//   probe(page, opts)   the page expression, a string for Runtime.evaluate
//   create()            fresh per-document state
//   add(state, page, r) fold one page's result in; returns { out, err } lines to print
//   summarize(state)    { ok, out, err, logLine } — the harness's own verdict lines

/** The page expression. `page` is 1-based. */
export const probe = (page) => `(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page - 1});
    if (!pv || !pv.textLayer) return null;
    const pr = pv.div.getBoundingClientRect();
    // LEAF spans, not the layer's children: a tagged PDF nests its text spans
    // in marked-content spans, and reading only direct children saw no prose
    // on such a document at all — every page "clean", measured blind. Our own
    // inline wrappers (citation/reference colour, spacing) are not leaves.
    const spans = [...pv.textLayer.div.querySelectorAll("span")]
      .filter((s) => !s.classList.contains("endOfContent") && !s.matches(".fx-cite-c, .fx-ref-c, .fx-sp") &&
        !s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)"));
    const prose = (t) => ((t || "").match(/[a-z]{2,}/g) || []).length >= 2;
    const rows = [];
    for (const s of spans) {
      const t = (s.textContent || "").trim();
      if (!prose(t) || s.hasAttribute("data-fx-done")) continue;
      const r = s.getBoundingClientRect();
      if (r.top - pr.top < 0 || r.bottom - pr.top > pr.height) continue; // page stamps
      rows.push({ y: Math.round(r.top - pr.top),
                  why: s.dataset.fxWhy || (s.hasAttribute("data-fx-keep") ? "(keep)" :
                        s.hasAttribute("data-fx-table") ? "(table)" : "(none)"),
                  text: t.slice(0, 30) });
    }
    const done = [...pv.textLayer.div.querySelectorAll("span[data-fx-done]")]
      .map((s) => Math.round(s.getBoundingClientRect().bottom - pr.top));
    const lowest = done.length ? Math.max(...done) : null;
    const unreasoned = rows.filter((r) => r.why === "(none)");
    // Is an unreasoned prose span BELOW everything the engine processed? That is
    // the "last line of the column left alone" shape.
    const belowAll = lowest === null ? [] : unreasoned.filter((r) => r.y >= lowest - 4);
    const byWhy = {};
    for (const r of rows) byWhy[r.why] = (byWhy[r.why] || 0) + 1;
    return { page: ${page}, unprocessedProse: rows.length, unreasoned: unreasoned.length,
             trailing: belowAll.length, byWhy,
             sample: unreasoned.slice(0, 3).map((r) => r.text) };
  })()`;

export const create = () => ({ report: [] });

export function add(state, page, r) {
  if (r) state.report.push(r);
  return { out: [], err: [] };
}

export function summarize(state, { label = "doc" } = {}) {
  const report = state.report;
  const line = `${label} ${JSON.stringify(report)}`;
  const sum = (k) => report.reduce((n, r) => n + (r[k] || 0), 0);
  const totals = {
    pages: report.length,
    unprocessedProse: sum("unprocessedProse"),
    unreasoned: sum("unreasoned"),
    trailing: sum("trailing"),
  };
  const out = [line, `TOTALS: ${JSON.stringify(totals)}`];
  const err = [];
  if (!totals.pages) {
    err.push("  FAIL no page was probed");
  }
  const offenders = report.filter((r) => r.unreasoned || r.trailing);
  for (const r of offenders) {
    err.push(
      `  FAIL p${r.page} unreasoned=${r.unreasoned} trailing=${r.trailing} ` +
        `sample=${JSON.stringify(r.sample)}`,
    );
  }
  const ok = Boolean(totals.pages && !offenders.length);
  return { ok, out, err, logLine: line };
}
