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

  // The processed spans' text in layer order, one line per span, with every
  // text node's place in it — matched ACROSS spans, as the product does: a
  // reference split over two spans ("Figure" / "3" in another face, or "Fig-"
  // / "ure 6" hyphenated at a line end) was invisible to a per-span match, so
  // a split reference left uncoloured could not fail this check.
  let joined = "";
  const nodes = []; // { node, span, start, end }
  for (const s of div.querySelectorAll("span[data-fx-done]")) {
    if (s.dataset.fxRefs) continue;
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push({ node, span: s, start: joined.length, end: joined.length + node.data.length });
      joined += node.data;
    }
    joined += "\\n";
  }
  // Close a line-end hyphen break before a lowercase continuation (the rule of
  // parser.mjs findInternalRefsAcrossBreaks), keeping each character's origin.
  let flat = "";
  const at = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "-" && joined[i + 1] === "\\n" && /[A-Za-z]/.test(joined[i - 1] || "") && /[a-z]/.test(joined[i + 2] || "")) { i++; continue; }
    at.push(i);
    flat += joined[i];
  }
  let total = 0, colored = 0, nested = 0;
  const misses = [];
  for (const m of flat.matchAll(INTERNAL_REF)) {
    const a = at[m.index], b = at[m.index + m[0].length - 1] + 1;
    total++;
    // Coloured means coloured in EVERY span the reference runs through.
    const spans = new Map(); // span -> { hit, cite }
    for (const x of nodes) {
      if (x.end <= a || x.start >= b) continue;
      const st = spans.get(x.span) ?? { hit: false, cite: false };
      if (x.node.parentElement.closest(".fx-cite-c")) st.cite = true;
      if (x.node.parentElement.closest(".fx-ref-c")) st.hit = true;
      spans.set(x.span, st);
    }
    const all = [...spans.values()];
    const cite = all.some((v) => v.cite), hit = all.length > 0 && all.every((v) => v.hit);
    if (cite) { total--; if (all.some((v) => v.hit)) nested++; continue; }
    if (hit) colored++;
    else if (misses.length < 6) misses.push({ m: m[0].replace(/\\n/g, " "), ctx: flat.slice(Math.max(0, m.index - 20), m.index + m[0].length + 6).replace(/\\n/g, " ") });
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
  const out = [`\nTOTAL refs=${state.T} colored=${state.C}${nested}`];
  // No page read at all is no measurement: "0 refs, 0 colored" used to pass.
  if (!state.pages) out.push("  FAIL no page was probed — the check proved nothing");
  return { ok: state.pages > 0 && !(state.T > state.C) && !state.N, out, err: [] };
}
