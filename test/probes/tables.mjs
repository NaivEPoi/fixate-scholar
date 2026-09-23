// tables' check — the per-page oracle and the verdict — shared by the
// standalone harness (test/tables.mjs) and the combined gate runner
// (test/allprobes.mjs). One copy, imported by both: the check means the same
// thing whichever of them runs it.
//
// Processed text inside a ruled table. Tables (and framed algorithm/figure
// boxes) are bounded by horizontal rules drawn on the page; the text between
// two stacked, x-overlapping rules is table interior and must stay on the
// canvas. The oracle is independent of the engine: it renders the page itself
// at ORACLE_SCALE, finds the rules in its own pixels, and reports every
// processed span centred inside a zone they bound (see the expression).
//
// Module shape (every test/probes/*.mjs has it):
//   probe(page, opts)   the page expression, a string for Runtime.evaluate
//   create(opts)        fresh per-document state
//   add(state, page, r) fold one page's result in; returns { out, err } lines to print
//   summarize(state)    { ok, out, err, logLine } — the harness's own verdict lines

// The oracle's own render, in device px per PDF point. ~4 is what the
// page-fit canvas at devicePixelRatio 2 used to give it, so the rule-length and
// merge constants below keep the meaning they were validated with.
export const ORACLE_SCALE = 4;

// In-page: rules from the oracle's own render, zones from rule pairs, offenders
// from processed-span centers inside zones (span rects mapped through the
// viewer canvas rect, which covers exactly the page).
//
// The render is the oracle's, at ORACLE_SCALE px/pt whatever the viewer zoom:
// reading the viewer's canvas made the oracle exactly as zoom-dependent as the
// engine it checks (at 1.8 that canvas is capped to ~0.7 device px per CSS px
// and a 0.4pt frame edge reads light), so a zoom sweep would have compared two
// moving things. Line grouping is likewise in page units (LINE_Q zoom-1 px per
// bucket, ~5 CSS px at the page-fit it used to run at).
export const probe = (page, { noexempt = false } = {}) => `(async () => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${page - 1});
  const canvas = pv.canvas || pv.div.querySelector("canvas");
  const layer = pv.textLayer && pv.textLayer.div;
  if (!canvas || !layer || !pv.pdfPage) return { error: "no canvas/layer" };
  const own = document.createElement("canvas");
  const vp = pv.pdfPage.getViewport({ scale: ${ORACLE_SCALE}, rotation: pv.viewport.rotation });
  own.width = Math.round(vp.width); own.height = Math.round(vp.height);
  const ctx = own.getContext("2d", { willReadFrequently: true });
  try { await pv.pdfPage.render({ canvasContext: ctx, viewport: vp }).promise; } catch (e) { return { error: "oracle render: " + e }; }
  const W = own.width, H = own.height;
  let img; try { img = ctx.getImageData(0, 0, W, H); } catch (e) { return { error: String(e) }; }
  own.width = own.height = 0; // release the buffer; the pixels are copied out
  const d = img.data;
  const LINE_Q = 3; // zoom-1 CSS px per line bucket
  const zs = pv.scale || 1; // viewer zoom: CSS px per zoom-1 CSS px
  const lineKeyOf = (r, top) => Math.round((r.top - top) / zs / LINE_Q);
  const dark = (i) => d[i + 3] > 40 && (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) < 165;
  const minLen = Math.max(180, W * 0.15);
  const rows = [];
  for (let y = 0; y < H; y++) {
    let run = 0, best = 0, bx0 = 0, cur0 = 0, bx1 = 0;
    for (let x = 0; x <= W; x++) {
      if (x < W && dark((y * W + x) * 4)) { if (!run) cur0 = x; run++; }
      else { if (run > best) { best = run; bx0 = cur0; bx1 = x; } run = 0; }
    }
    if (best >= minLen) rows.push({ y, x0: bx0, x1: bx1 });
  }
  // merge adjacent rows into rules
  const rules = [];
  for (const r of rows) {
    const prev = rules.at(-1);
    if (prev && r.y - prev.yEnd <= 2 && Math.abs(r.x0 - prev.x0) < 40) { prev.yEnd = r.y; prev.x0 = Math.min(prev.x0, r.x0); prev.x1 = Math.max(prev.x1, r.x1); continue; }
    rules.push({ y0: r.y, yEnd: r.y, x0: r.x0, x1: r.x1 });
  }
  // Chain vertically adjacent overlapping rules; a real table shows ≥3 rules
  // (top/mid/bottom or row separators). An isolated PAIR is usually two
  // underlined run-in leads in a column of prose — no zone for those.
  const pairs = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i], b = rules[j];
      if (b.y0 - a.yEnd <= 2) continue; // same merged band
      if (b.y0 - a.yEnd > H * 0.15) break; // too far — rules sorted by y
      const lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1);
      const longer = Math.max(a.x1 - a.x0, b.x1 - b.x0);
      if (hi - lo < longer * 0.7) continue;
      pairs.push({ i, j, x0: lo, x1: hi, yTop: a.yEnd, yBot: b.y0 });
      break; // pair each rule with the NEAREST qualifying rule below
    }
  }
  // chain membership per rule index
  const chain = new Map(); // rule idx -> chain id
  let cid = 0;
  for (const p of pairs) {
    const c = chain.get(p.i) ?? ++cid;
    chain.set(p.i, c);
    chain.set(p.j, c);
  }
  const chainSize = new Map();
  for (const c of chain.values()) chainSize.set(c, (chainSize.get(c) || 0) + 1);
  const zones = pairs.filter((p) => (chainSize.get(chain.get(p.i)) || 0) >= 3);
  if (!zones.length) return { zones: 0, offenders: [] };
  const cr = canvas.getBoundingClientRect();
  const sx = W / cr.width, sy = H / cr.height;
  // Group ALL text-layer spans into baseline lines (for the prose exemption).
  // The leaf test must ignore OUR OWN inline wrappers: the citation and
  // in-paper-reference coloring inserts <span class="fx-cite-c|fx-ref-c"> inside
  // a processed span, so a plain "has a nested span" test dropped exactly the
  // prose lines that mention a Figure/Table/Listing — the lines most likely to
  // sit beside a ruled block — out of the prose map, and every one of them then
  // reported as an offender (all four false positives were of this shape:
  // "Listing 2 provides…", "…shown in Figure 8a", "as shown in Figure 8b.",
  // "Figure 11 shows…"). Only PDF.js's markedContent wrappers should be skipped.
  const lineMap = new Map();
  for (const s of layer.querySelectorAll("span")) {
    if (!s.textContent.trim() || s.querySelector("span:not(.fx-cite-c):not(.fx-ref-c):not(.fx-sp)")) continue;
    const r = s.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const key = lineKeyOf(r, cr.top);
    if (!lineMap.has(key)) lineMap.set(key, []);
    lineMap.get(key).push(s);
  }
  // Prose lines (≥4 lowercase words spanning ≥55% of some zone's width) and
  // their PARAGRAPH CONTINUATIONS: a short last line ("as shown in Figure
  // 8b.") directly under a prose line is the same paragraph, not a cell.
  // Whole lowercase words, not letter runs inside identifiers — mirrors the
  // engine's proseWordCount. Counting runs made a code line of the shape
  // "RETURN x.name AS label, ..." look as wordy as a sentence, which is how a
  // framed listing's interior came to be treated as prose between frames on
  // both sides. (No backticks in here - this whole block is a template literal.)
  const words = (s) => (s.match(/(?:^|[\\s(“"'])[a-zà-ÿ]{2,}(?=[\\s.,;:)\\]”"']|$)/g) || []).length;
  const proseKeys = new Set();
  const keys = [...lineMap.keys()].sort((a, b) => a - b);
  for (const key of keys) {
    const line = lineMap.get(key);
    const text = line.map((el) => el.textContent).join(" ");
    const lw = words(text);
    const xs = line.map((el) => el.getBoundingClientRect());
    const w = (Math.max(...xs.map((q) => q.right)) - Math.min(...xs.map((q) => q.left))) * sx;
    const wideProse = lw >= 4 && zones.some((z) => w >= (z.x1 - z.x0) * 0.55);
    // Continuation: a prose line 6-21 page px above (2-7 buckets). The old
    // 3-5 buckets (9-15 px) was narrower than 12pt leading (~16 px), so
    // whether the previous line counted came down to rounding — at 180% a
    // processed line's few-px shift dropped IEEE p4's "the response from"
    // (prose between two framed listings) out of the window and it read as
    // an offender. 21 px mirrors the engine's own window (ZONE_CONT_LINES).
    let contPrev = false;
    for (let k = 2; k <= 7 && !contPrev; k++) contPrev = lw >= 2 && proseKeys.has(key - k);
    if (wideProse || contPrev) proseKeys.add(key);
  }
  // --noexempt: drop the prose exemption entirely. A control for the exemption
  // itself — with it off, every processed span inside a zone is reported, which
  // shows the zone/offender machinery is alive and that a change in offender
  // count came from the EXEMPTION and nothing else. (Neutering the engine's
  // table skipping does not work as a control: table text is typically set
  // smaller than body, so those spans are not processing candidates at all and
  // no amount of un-skipping makes them offenders.)
  if (${!!noexempt}) proseKeys.clear();
  const offenders = [];
  for (const s of layer.querySelectorAll("span[data-fx-done]")) {
    const r = s.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cx = ((r.left + r.right) / 2 - cr.left) * sx;
    const cy = ((r.top + r.bottom) / 2 - cr.top) * sy;
    for (const z of zones) {
      if (!(cx >= z.x0 && cx <= z.x1 && cy > z.yTop + 1 && cy < z.yBot - 1)) continue;
      // Prose exemption: a rule chain can bracket a PROSE gap (text between
      // two stacked framed listings/tables). Exemption is per-SPAN within
      // the prose line (mirrors the engine): a short label sharing a
      // baseline with a wordy cell is still an offender if processed.
      if (proseKeys.has(lineKeyOf(r, cr.top))) {
        const t = s.textContent.trim();
        const slw = words(t);
        if (slw >= 2 || (slw >= 1 && t.length >= 12)) break; // part of the prose flow
      }
      // --why: the inputs the prose exemption above judged, so a FALSE POSITIVE
      // can be diagnosed instead of guessed at. lineW/zoneW are canvas px; the
      // exemption needs lineW >= zoneW * 0.55 on a line of >= 4 lowercase words.
      const key = lineKeyOf(r, cr.top);
      const line = lineMap.get(key) ?? [];
      const lxs = line.map((el) => el.getBoundingClientRect());
      const lineW = lxs.length ? (Math.max(...lxs.map((q) => q.right)) - Math.min(...lxs.map((q) => q.left))) * sx : 0;
      const lineText = line.map((el) => el.textContent).join(" ");
      offenders.push({
        t: s.textContent.trim().slice(0, 44),
        zone: [Math.round(z.yTop / sy), Math.round(z.yBot / sy)],
        why: {
          key, spansOnLine: line.length,
          lineWords: words(lineText),
          lineW: Math.round(lineW), zoneW: Math.round(z.x1 - z.x0),
          ratio: +(lineW / Math.max(1, z.x1 - z.x0)).toFixed(2),
          inProseKeys: proseKeys.has(key),
        },
      });
      break;
    }
  }
  return { zones: zones.length, offenders: offenders.slice(0, 20) };
})()`;

/** `why`: also print the prose-exemption inputs of each offender. */
export const create = ({ why = false } = {}) => ({ why, pages: 0, offenders: 0 });

export function add(state, page, r) {
  const out = [];
  state.pages++;
  state.offenders += r.offenders.length;
  const tag = r.offenders.length ? "  <<< PROCESSED IN TABLE" : "";
  if (r.offenders.length || r.zones) out.push(`p${page}: zones=${r.zones} offenders=${r.offenders.length}${tag}`);
  for (const o of r.offenders) {
    out.push(`   y${o.zone[0]}-${o.zone[1]}: "${o.t}"`);
    if (state.why && o.why) out.push(`      why: ${JSON.stringify(o.why)}`);
  }
  return { out, err: [] };
}

export function summarize(state, { label = "doc" } = {}) {
  const line = `${label} tables pages=${state.pages} offenders=${state.offenders}`;
  return { ok: state.offenders === 0, out: [`TOTAL offenders: ${state.offenders}`], err: [], logLine: line };
}
