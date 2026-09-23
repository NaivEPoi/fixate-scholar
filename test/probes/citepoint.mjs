// citepoint's check — the per-page probe and the verdict — shared by the
// standalone harness (test/citepoint.mjs) and the combined gate runner
// (test/allprobes.mjs). One copy, imported by both: the check means the same
// thing whichever of them runs it, and nothing has to read a probe back out of
// another file's source text to find out what it was.
//
// Which reference does the pointer open? For every MULTI-KEY citation bracket
// on a page ("[4, 12]", "[3, 7, 9]"), each printed number is clicked at its own
// centre and the card that opens must be THAT number's.
//
// Also checks WRONG-TARGET (hit-target covered) and unannotated citations.
//
// Module shape (every test/probes/*.mjs has it):
//   probe(page, opts)   the page expression, a string for Runtime.evaluate
//   create()            fresh per-document state
//   add(state, page, r) fold one page's result in; returns { out, err } lines to print
//   summarize(state)    { ok, out, err } — the harness's own verdict lines

/** The page expression. `p` is 1-based. */
export const probe = (p, { max, examined }) => `(async () => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${p - 1});
      if (!pv || !pv.textLayer) return null;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = { checked: 0, hits: pv.div.querySelectorAll('.fx-cite-hit').length, brackets: 0, wrongCard: [], wrongTarget: [] };

      // Page text exactly as the annotator assembles it, or the offsets below
      // address different characters than the hit-targets were built from.
      let joined = '';
      const spans = [];
      for (const s of pv.textLayer.div.querySelectorAll('span')) {
        if (s.closest('.fx-cite-c, .fx-ref-c, .fx-sp')) continue;
        if (s.querySelector('span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)')) continue;
        const t = s.textContent;
        if (!t) continue;
        spans.push({ s, start: joined.length, end: joined.length + t.length });
        joined += t + '\\n';
      }
      const rangeRects = (span, start, end) => {
        const range = document.createRange();
        let pos = 0, startSet = false;
        const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const len = node.data.length;
          if (!startSet && start < pos + len) { range.setStart(node, start - pos); startSet = true; }
          if (startSet && end <= pos + len) { range.setEnd(node, end - pos); return [...range.getClientRects()].filter((r) => r.width > 0); }
          pos += len;
        }
        return [];
      };
      const rectsFor = (a, b) => {
        const rs = [];
        for (const sg of spans) {
          if (sg.end <= a || sg.start >= b) continue;
          const ls = Math.max(0, a - sg.start), le = Math.min(sg.end - sg.start, b - sg.start);
          rs.push(...rangeRects(sg.s, ls, le));
        }
        return rs;
      };

      // Any bracketed citation, single or multi-key, counted OUTSIDE the
      // bibliography's own entry markers. This is what separates "the
      // annotation pass never ran" from "this document has nothing to cite":
      // only the first is a defect, and only the first may fail the run.
      const ANY_CITE = /\\[\\d{1,3}(?:\\s*[,;\\u2013\\u2014-]\\s*\\d{1,3})*\\]/g;
      for (const m of joined.matchAll(ANY_CITE)) {
        if (spans.some((sg) => sg.end > m.index && sg.start < m.index + m[0].length && sg.s.dataset.fxRefs)) continue;
        out.brackets++;
      }

      // Plain comma lists only: every number in one is printed AND cited, so
      // the expected card is unambiguous without re-deriving the parser's
      // range expansion here. Ranges are covered by citeaudit's coverage check.
      const LIST = /\\[(\\d{1,3}(?:\\s*,\\s*\\d{1,3})+)\\]/g;
      for (const m of joined.matchAll(LIST)) {
        if (${max} - ${examined} - out.checked <= 0) break;
        const listAt = m.index + m[0].indexOf(m[1]);
        if (spans.some((sg) => sg.end > m.index && sg.start < m.index + m[0].length && sg.s.dataset.fxRefs)) continue;
        const keys = [...m[1].matchAll(/\\d{1,3}/g)].map((k) => ({ key: k[0], at: listAt + k.index }));
        if (keys.some((k) => k.key === '0')) continue; // a vector, not a citation
        // The citation must be annotated at all — an unannotated bracket is
        // citeaudit's finding, not this one.
        const anyHit = rectsFor(m.index, m.index + m[0].length).some((r) => {
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!el?.classList.contains('fx-cite-hit');
        });
        if (!anyHit) continue;
        out.checked++;
        for (const k of keys) {
          const rs = rectsFor(k.at, k.at + k.key.length);
          if (!rs.length) continue;
          const r = rs[0];
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          const el = document.elementFromPoint(x, y);
          if (!el || !el.classList.contains('fx-cite-hit')) {
            out.wrongTarget.push({ cite: m[0].slice(0, 24), key: k.key, got: el ? (el.className || el.tagName) : 'null' });
            continue;
          }
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          await sleep(60);
          const label = document.querySelector('.fx-cite-popup .fx-cite-label')?.textContent ?? '(no card)';
          if (label !== '[' + k.key + ']') {
            out.wrongCard.push({ cite: m[0].slice(0, 24), key: k.key, label });
          }
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          await sleep(30);
        }
      }
      return out;
    })()`;

export const create = () => ({
  examined: 0,
  wrongCard: 0,
  wrongTarget: 0,
  annotated: 0,
  bracketed: 0,
});

export function add(state, p, r) {
  if (!r) return { out: [`p${p}: no textLayer`], err: [] };
  state.examined += r.checked;
  state.annotated += r.hits;
  state.bracketed += r.brackets;
  const out = [];
  for (const w of r.wrongTarget) {
    state.wrongTarget++;
    out.push(`  FAIL p${p} WRONG-TARGET "${w.cite}" key ${w.key} → ${w.got}`);
  }
  for (const w of r.wrongCard) {
    state.wrongCard++;
    out.push(`  FAIL p${p} WRONG-CARD "${w.cite}" key ${w.key} opened ${w.label}`);
  }
  if (r.checked) {
    out.push(`p${p}: multi-key cites=${r.checked} wrongTarget=${r.wrongTarget.length} wrongCard=${r.wrongCard.length}`);
  }
  return { out, err: [] };
}

export function summarize(state) {
  const out = [
    `TOTAL multi-key cites=${state.examined} wrongTarget=${state.wrongTarget} wrongCard=${state.wrongCard} ` +
    `hitTargets=${state.annotated} bracketsInText=${state.bracketed}`,
  ];
  const err = [];
  let ok = true;
  if (!state.annotated && state.bracketed) {
    err.push(`  FAIL ${state.bracketed} bracketed citation(s) in the text and not one hit-target — the annotation pass did not run`);
    ok = false;
  } else if (!state.examined && !state.annotated) {
    out.push("  SKIP this document has no bracketed citation at all — zero hit-targets is the right answer");
  } else if (!state.examined) {
    out.push(`  SKIP this document cites one work at a time — ${state.annotated} hit-targets, no multi-key bracket`);
  }
  if (state.wrongTarget || state.wrongCard) {
    ok = false;
  }
  return { ok, out, err };
}
