// refcolor's check — the per-page probe and the verdict — shared by the
// standalone harness (test/refcolor.mjs) and the combined gate runner
// (test/allprobes.mjs). One copy, imported by both: the check means the same
// thing whichever of them runs it, and nothing has to read a probe back out of
// another file's source text to find out what it was.
//
// In-paper reference coloring: per page, find in-paper references (Figure,
// Table, Section, Algorithm, Equation, ...) inside PROCESSED spans that have no
// .fx-ref-c coloring wrap. A match inside a citation's own colouring is not one:
// that is the citation's locator ("[9, §5.2]"), a place in the cited work, and
// the product deliberately leaves it the citation's colour — and one painted
// in the reference colour INSIDE the citation is reported as "nested".
//
// Module shape (every test/probes/*.mjs has it):
//   probe(page, opts)   the page expression, a string for Runtime.evaluate
//   create()            fresh per-document state
//   add(state, page, r) fold one page's result in; returns { out, err } lines to print
//   summarize(state)    { ok, out, err } — the harness's own verdict lines

/** The page expression. `p` is 1-based. */
export const probe = (p) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
  const div = pv?.textLayer?.div;
  if (!div) return { error: "no layer" };

  const REF_LEADER = "(?:[Ff]igures?|[Ff]igs?\\\\.?|[Tt]ables?|[Tt]abs?\\\\.?|[Aa]lgorithms?|[Aa]lgs?\\\\.?|[Ll]istings?|[Ss]ections?|[Ss]ecs?\\\\.?|§{1,2}|[Aa]ppendices|[Aa]ppendix|[Aa]pps?\\\\.?|[Ee]quations?|[Ee]qs?\\\\.?|[Cc]hapters?|[Tt]heorems?|[Ll]emmas?|[Dd]efinitions?|[Cc]laims?)";
  const REF_ROMAN = "(?:(?<=[a-zA-Z~])|\\\\b)(?=[IVXLCDM])M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{1,3})(?:-[A-Za-z\\\\d]+)?\\\\b";
  const REF_NUM = "\\\\d+(?:\\\\.\\\\d+)*(?:-[A-Za-z\\\\d]+)?(?:\\\\([a-z\\\\d]+\\\\)|[a-z](?![a-zA-Z]))?";
  const REF_PAREN_NUM = "\\\\(\\\\d+(?:\\\\.\\\\d+)*[a-z]?\\\\)";
  const REF_ALPHA = "(?:(?<=[a-zA-Z~])|\\\\b)[A-Z]\\\\b(?:\\\\.\\\\d+)?";
  const REF_ITEM = "(?:" + REF_PAREN_NUM + "|" + REF_NUM + "|" + REF_ROMAN + "|" + REF_ALPHA + ")";
  const REF_SEP = "(?:\\\\s*(?:[–—\\\\u2212\\\\u2015-]|--|to)\\\\s*|\\\\s*,\\\\s*(?:and\\\\s+|&\\\\s*)?|\\\\s+and\\\\s+|\\\\s*&\\\\s*)";
  // Kept in step with parser.mjs, INCLUDING the (?=§) alternative: this copy
  // carried the same missing-word-boundary bug, so the harness shared the
  // product's blind spot and could never have reported an uncoloured "§4.2".
  // (No backticks in this comment — it lives inside a template literal.)
  const INTERNAL_REF = new RegExp("(?:\\\\b|(?<=[a-z])(?=[A-Z])|(?=§))" + REF_LEADER + "\\\\s*~?\\\\s*" + REF_ITEM + "(?:" + REF_SEP + REF_ITEM + ")*", "g");

  let total = 0, colored = 0, nested = 0;
  const misses = [];
  for (const s of div.querySelectorAll("span[data-fx-done]")) {
    if (s.dataset.fxRefs) continue;
    const text = s.textContent;
    for (const m of text.matchAll(INTERNAL_REF)) {
      total++;
      let pos = 0, hit = false, cite = false;
      const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const len = node.data.length;
        const a = Math.max(m.index, pos), b = Math.min(m.index + m[0].length, pos + len);
        if (a < b && node.parentElement.closest(".fx-cite-c")) cite = true;
        if (a < b && node.parentElement.closest(".fx-ref-c")) hit = true;
        pos += len;
      }
      if (cite) { total--; if (hit) nested++; continue; }
      if (hit) colored++;
      else if (misses.length < 6) misses.push({ m: m[0], ctx: text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 6) });
    }
  }
  return { total, colored, nested, misses };
})()`;

export const create = () => ({ T: 0, C: 0, N: 0, pages: 0, unmeasured: [] });

/** A page the probe could not read ("no layer") is printed and skipped, as it always was. */
export function add(state, p, r) {
  if (r.error) { state.unmeasured.push(p); return { out: [`p${p}: ${r.error}`], err: [] }; }
  state.pages++;
  state.T += r.total; state.C += r.colored; state.N += r.nested ?? 0;
  const tag = (r.total > r.colored ? "  <<< UNCOLORED" : "") +
    (r.nested ? `  nested=${r.nested} <<< REFERENCE COLOUR INSIDE A CITATION` : "");
  const out = [`p${p}: refs=${r.total} colored=${r.colored}${tag}`];
  for (const m of r.misses ?? []) out.push(`   miss: ${m.m} in "${m.ctx}"`);
  return { out, err: [] };
}

export function summarize(state) {
  const nested = state.N ? ` nested=${state.N}` : "";
  return { ok: !(state.T > state.C) && !state.N, out: [`\nTOTAL refs=${state.T} colored=${state.C}${nested}`], err: [] };
}
