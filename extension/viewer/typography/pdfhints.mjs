// Structural hints the LaTeX toolchain already wrote into the PDF.
//
// The block classifier decides what a region IS from rendered geometry alone —
// line pitch, height deltas, x-bands, computed weight. That works, but it is
// guessing at boundaries the source document knows exactly, and the guesses
// fail in both directions: a caption's wrapped continuation gets emphasized
// because the absorb loop stopped early, a numbered sub-heading gets
// emphasized because it ran past a word-count gate, a paragraph's last line
// gets skipped because a run-in rule claimed it (R43).
//
// hyperref writes NAMED DESTINATIONS for every float, heading and numbered
// equation, in the same user space as the text items:
//
//   subsubsection.3.1.2   page 3   x=53.798  y=188.28
//   figure.caption.7      page 4   x=53.798  y=713.793
//   table.caption.9       page 4   x=317.955 y=234.734
//
// `figure.caption.N` is hyperref's `hypcap` anchor and sits on the CAPTION,
// which is exactly the boundary the caption pass needs. Measured across the
// public corpus, every paper typeset since hyperref became standard carries
// these: 80–159 destinations each, including `subsubsection.*` anchors that
// the PDF outline itself omits (bookmarks usually stop at subsection).
//
// These are hints, not a contract. A 1995 paper in the corpus has no
// destinations and no outline at all, and a document can always name things
// differently — so everything here is optional, and the engine keeps its
// geometry path for whatever the file does not state. Nothing is ever
// classified as a heading or a caption because a hint is MISSING.

/** Destination names hyperref emits, and what each one anchors. */
const DEST_PATTERNS = [
  // `figure.caption.5` / `table.caption.9` — the hypcap anchor, ON the caption.
  { re: /^(figure|table)\.caption\.\d+$/i, kind: "caption", onCaption: true },
  // `figure.3` / `table.2` — the float itself when hypcap is not in use; the
  // caption is nearby but not necessarily AT this point.
  { re: /^(figure|table)\.\d+$/i, kind: "float", onCaption: false },
  { re: /^(algorithm|lstlisting|listing)\.[\w.]+$/i, kind: "float", onCaption: false },
  // Headings, at every depth hyperref numbers.
  { re: /^(sub)*section\.[\d.]+$/i, kind: "heading" },
  { re: /^paragraph\.[\d.]+$/i, kind: "heading" },
  // Numbered displayed equations.
  { re: /^equation\.[\d.]+$/i, kind: "equation" },
];

/**
 * What a destination name anchors, or null when the name is not one of the
 * structural ones. Pure string work, so it is unit-tested directly.
 *
 * `cite.*`, `page.*`, `Hfootnote.*`, `Item.*` and the rest deliberately return
 * null: a citation anchor says nothing about the region it sits in.
 */
export function classifyDestination(name) {
  if (typeof name !== "string") return null;
  for (const p of DEST_PATTERNS) {
    const m = p.re.exec(name);
    if (!m) continue;
    const family = (m[1] || "").toLowerCase();
    return {
      kind: p.kind,
      // "figure" / "table" for a caption or float, so the caption pass can say
      // WHICH float a caption belongs to; null for headings and equations.
      family: p.kind === "caption" || p.kind === "float" ? (family || null) : null,
      onCaption: !!p.onCaption,
      // Heading depth from the NUMBER, not the prefix: "subsection.3.1" is
      // depth 2, "subsubsection.3.1.2" depth 3. hyperref numbers a starred or
      // appendix heading the same way, and `paragraph.3.1.2.1` is depth 4 —
      // which is the run-in level, the one the word-count gate kept missing.
      depth: p.kind === "heading" ? name.replace(/^[A-Za-z]+\./, "").split(".").filter(Boolean).length : null,
      name,
    };
  }
  return null;
}

/**
 * Group resolved anchors by page.
 *
 * Exported for its unit test: the grouping and the de-duplication are where a
 * silent off-by-one would put a caption boundary on the wrong page, and that
 * is pure list work over already-resolved coordinates.
 */
export function groupByPage(anchors) {
  const out = new Map();
  for (const a of anchors) {
    if (!Number.isFinite(a.page) || !Number.isFinite(a.y)) continue;
    if (!out.has(a.page)) out.set(a.page, []);
    out.get(a.page).push(a);
  }
  // Reading order down the page: destinations arrive in name order, which is
  // document order only by accident.
  for (const list of out.values()) list.sort((p, q) => q.y - p.y || p.x - q.x);
  return out;
}

/**
 * Read every structural destination out of the document and resolve it to a
 * page and a position.
 *
 * Returns `available: false` when the file carries none — a pre-hyperref
 * paper, or one whose toolchain named nothing — and the caller then keeps to
 * the geometry path entirely.
 */
export async function extractStructureHints(pdfDocument) {
  const empty = {
    available: false,
    headings: new Map(),
    captions: new Map(),
    equations: new Map(),
    counts: { heading: 0, caption: 0, float: 0, equation: 0 },
  };
  if (!pdfDocument?.getDestinations) return empty;

  let dests;
  try {
    dests = await pdfDocument.getDestinations();
  } catch {
    return empty; // no name tree, or a malformed one — geometry it is
  }
  if (!dests || typeof dests !== "object") return empty;

  // One getPageIndex per distinct ref, not per destination: a paper with 159
  // destinations resolves ~20 refs, and the call is a lookup into the page
  // tree rather than a free operation.
  //
  // Everything below is driven by the DOCUMENT's name tree, which is untrusted
  // input — the extension opens whatever PDF the reader points it at. Nothing
  // here bounds the size of that tree, so the three ceilings are the bound: a
  // file naming a million destinations would otherwise buy a million pattern
  // tests and, worse, one page-tree walk per distinct ref. The ceilings sit
  // two orders of magnitude above the measured corpus (80-159 destinations,
  // ~20 refs, ≤40 pages), so no real document can reach one; a file that does
  // is not a paper, and falling back to geometry is the right answer for it.
  const MAX_SCAN = 50000; // destinations examined at all
  const MAX_ANCHORS = 4000; // structural anchors kept
  const MAX_REFS = 400; // distinct refs resolved (one page-tree walk each)
  const pageOfRef = new Map();
  const resolved = [];
  let scanned = 0;
  for (const [name, dest] of Object.entries(dests)) {
    if (++scanned > MAX_SCAN || resolved.length >= MAX_ANCHORS) break;
    const info = classifyDestination(name);
    if (!info) continue;
    if (!Array.isArray(dest) || dest.length < 4) continue;
    const [ref, , x, y] = dest;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = typeof ref === "object" && ref ? `${ref.num}R${ref.gen}` : String(ref);
    if (!pageOfRef.has(key)) {
      if (pageOfRef.size >= MAX_REFS) continue;
      let idx = null;
      try {
        idx = await pdfDocument.getPageIndex(ref);
      } catch {
        idx = null; // a destination pointing at nothing resolvable
      }
      pageOfRef.set(key, idx);
    }
    const idx = pageOfRef.get(key);
    if (idx === null || idx === undefined) continue;
    resolved.push({ ...info, page: idx + 1, x, y });
  }

  const counts = { heading: 0, caption: 0, float: 0, equation: 0 };
  for (const r of resolved) counts[r.kind]++;

  return {
    // A file with a handful of `page.*`-only names is not a structured file.
    //
    // Counted over the kinds the ENGINE ACTUALLY CONSULTS — headings and the
    // float/caption anchors. `equation.*` destinations are still extracted and
    // reported below, but no classifier reads them yet, so letting them raise
    // this flag buys a document a full restore/reprocess cycle that cannot
    // change a single decision. A paper whose only destinations are equations
    // is, for the engine's purposes, a paper with no hints at all.
    available: counts.heading + counts.caption + counts.float > 0,
    headings: groupByPage(resolved.filter((r) => r.kind === "heading")),
    captions: groupByPage(resolved.filter((r) => r.kind === "caption" || r.kind === "float")),
    // Extracted, and currently UNUSED by the engine — kept because it is the
    // one structural fact a numbered-equation classifier would need, and it
    // costs nothing beyond the scan already being done. If it is still unread
    // by the next release, delete it rather than letting it drift.
    equations: groupByPage(resolved.filter((r) => r.kind === "equation")),
    counts,
  };
}

/**
 * The anchor on `page` nearest to baseline `y`, within `tol` user-space units,
 * or null.
 *
 * The caller asks "is this line a heading / a caption's first line?", so the
 * tolerance is a line height, not a guess: hyperref's anchor sits at the top
 * of the line it labels, a little above the baseline of the text.
 */
export function anchorNear(byPage, page, y, tol, xRange = null) {
  const list = byPage?.get?.(page);
  if (!list?.length) return null;
  let best = null;
  let bestD = Infinity;
  for (const a of list) {
    // `xRange` is the COLUMN the caller is asking about, and on a two-column
    // page it is not optional. Baselines pair up across the gutter, so the
    // nearest anchor in y is routinely the other column's: a heading at
    // y=400.0 in column two is shadowed by one at y=400.1 in column one, and
    // the caller's own x-check then rejects that anchor — leaving the real,
    // correct anchor never considered and the heading treated as unanchored.
    // Restricting the search to the column is what makes "nearest" mean
    // nearest among the candidates that could actually belong to this line.
    if (xRange && (a.x < xRange[0] || a.x >= xRange[1])) continue;
    const d = Math.abs(a.y - y);
    if (d < bestD) { bestD = d; best = a; }
  }
  return bestD <= tol ? best : null;
}
