// Pure heuristics that turn extracted lines into a reference list and map
// in-text citation keys onto entries. No DOM, no Chrome APIs (unit-testable).

const HEADING = /^(?:[ivxlcdm]+[.\s]+|\d+[.\s]+|[A-Z][.\s]+)?(references|bibliography|works cited|literature cited)\s*$/i;
const SECTION_AFTER = /^(?:[A-Z\d]+[.\s]+)?(appendix|acknowledg|supplementary|author contributions|funding|conflicts? of interest)/i;
const NUMERIC_MARKER = /^\[(\d{1,3})\]\s*/;
const DOTTED_MARKER = /^(\d{1,3})\.\s+(?=\D)/;
// BibTeX "alpha" style: author-initials + 2-digit year, optionally a "+" for
// many-author entries and a trailing disambiguator letter — "[WL92]",
// "[SRC07]", "[GHI+21]", "[Bla09a]". Must start with a capital (so a genuine
// numeric marker like "[7]" or a plain word in brackets doesn't match) and
// end in exactly two digits (so it can't swallow an ordinary bracketed word).
const ALPHA_MARKER = /^\[([A-Z][A-Za-z]{0,6}\+?\d{2}[a-z]?)\]\s*/;
const YEAR = /\b(19|20)\d{2}[a-z]?\b/;

/**
 * @param lines output of extractor.mjs (reading order)
 * @returns {entries: Array<{label:string|null, number:number|null, raw:string,
 *           title:string, page:number, y:number}>} or empty list
 */
export function parseReferenceSections(lines) {
  const sections = findReferenceSections(lines).map((s) => ({
    ...s,
    entries: entriesFromBody(s.body),
  }));
  if (globalThis.__fxDebug) {
    globalThis.__fxRefDebug = { ...(globalThis.__fxRefDebug ?? {}), sections: sections.length }; // test introspection
  }
  return sections;
}

/**
 * Every section's entries in one flat list, each tagged with its `section`
 * index. Document order matters: a bare "[3]" with no page context resolves to
 * the FIRST section holding a [3], which is the article's own list rather than
 * a supplement's — callers that know the citing page should narrow the pool by
 * section first (citations.mjs #entriesForPage).
 */
export function parseReferences(lines) {
  const out = [];
  const sections = parseReferenceSections(lines);
  for (let i = 0; i < sections.length; i++) {
    for (const e of sections[i].entries) out.push({ ...e, section: i });
  }
  return out;
}

/** Entries out of ONE section's body lines. */
function entriesFromBody(body) {
  if (body.length < 2) return [];

  const numericStarts = body.filter((l) => NUMERIC_MARKER.test(l.text)).length;
  const dottedStarts = body.filter((l) => DOTTED_MARKER.test(l.text)).length;
  const alphaStarts = body.filter((l) => ALPHA_MARKER.test(l.text)).length;

  let groups;
  let mode;
  if (numericStarts >= 3) { groups = splitByMarker(body, NUMERIC_MARKER); mode = "numeric"; }
  else if (dottedStarts >= 3) { groups = splitByMarker(body, DOTTED_MARKER); mode = "dotted"; }
  else if (alphaStarts >= 3) { groups = splitByMarker(body, ALPHA_MARKER); mode = "alpha"; }
  else { groups = splitByIndent(body); mode = "indent"; }

  const entries = groups
    .map((g) => buildEntry(g))
    // A NUMBERED entry ("[7] RFC 9110, page 106.") is a real reference
    // however short — the length gate only guards the marker-less indent/
    // year-grouping mode, where stray fragments can form spurious groups.
    .filter((e) => e && (e.number !== null || e.raw.length > 20));
  if (globalThis.__fxDebug) {
    globalThis.__fxRefDebug = { bodyLen: body.length, numericStarts, dottedStarts, mode, groups: groups.length, entries: entries.length }; // test introspection
  }
  return entries;
}

function findHeadingIndexes(lines) {
  // Every genuine "References" heading in the document, in reading order.
  // Plural because one PDF can hold more than one bibliography: a journal
  // proof carries the article and then its supplementary material, each with
  // its own reference list, and a thesis chapter collection does the same.
  //
  // "References" may also appear in the TOC or body.
  // But in a two-sided book/report template the section title is ALSO set as
  // a running head on every page of the section (top margin, alternating
  // left/right), repeating right up to the section's own last page — a naive
  // last-match search locks onto THAT copy, on the final page, and reads the
  // whole bibliography before it as ordinary prose (only the handful of
  // entries after the last running head got parsed).
  //
  // A running head is pinned to the SAME y on every page it appears on (it's
  // set once in the page template); a true section heading is not — even
  // when it also happens to sit near a page's top margin (a chapter-opening
  // page with blank space above the title), its y is whatever the title's own
  // layout put it at, distinct from the header's fixed slot. So: cluster
  // HEADING matches by y, and treat a cluster spanning 3+ distinct pages as
  // the running head, not the heading itself. (Can't reuse the page-edge
  // text-repetition helpers below for this — those key on normalized TEXT
  // only, so the once-per-document heading, which case-folds to the exact
  // same string as the header, would false-positive as a repeat too.)
  const matches = [];
  for (let i = 0; i < lines.length; i++) if (HEADING.test(lines[i].text)) matches.push(i);
  if (!matches.length) return [];
  const byY = new Map();
  for (const i of matches) {
    const y = Math.round(lines[i].y);
    if (!byY.has(y)) byY.set(y, new Set());
    byY.get(y).add(lines[i].page);
  }
  const runningY = new Set([...byY].filter(([, pages]) => pages.size >= 3).map(([y]) => y));
  const real = matches.filter((i) => !runningY.has(Math.round(lines[i].y)));
  // Every match looks like a running head — fall back to the old behavior
  // (the last one) rather than losing the bibliography entirely.
  return real.length ? real : matches.slice(-1);
}

/**
 * Where the article's body begins: the Abstract heading. Everything before
 * it (branding/cover pages, title, authors, emails) is front matter that
 * should be left as set. Null when the document has no Abstract.
 */
export function findContentStart(lines) {
  const line = lines.find((l) => l.page <= 5 && /^abstract\.?$/i.test(l.text));
  return line ? { page: line.page, y: line.y, h: line.h } : null;
}

/**
 * The References heading line plus every line of the bibliography body
 * (stopping at the next section, e.g. an appendix). These lines carry
 * geometry (page, x..endX, y, h), so callers can leave exactly this region
 * untouched while appendices after it are still processed.
 */
/** Normalized line text for running-head matching: digits (the page number)
 *  dropped, whitespace collapsed, case-folded. */
const normHead = (t) =>
  t.replace(/\d+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Per page: the y of the topmost and bottommost line. A running head or foot is
 * always the FIRST or LAST line on its page, and that is what separates it from
 * content that merely repeats.
 */
function pageEdges(lines) {
  const edges = new Map();
  for (const l of lines) {
    let e = edges.get(l.page);
    if (!e) edges.set(l.page, (e = { top: l.y, bot: l.y }));
    if (l.y > e.top) e.top = l.y;
    if (l.y < e.bot) e.bot = l.y;
  }
  return edges;
}

/**
 * Is this line the topmost or bottommost on its page? The tolerance is half a
 * line height — enough for a head and its page number to sit on baselines that
 * differ by a hair, and NOT enough to admit the next line in (at a full line
 * height the last entry line of a reference page counted as a foot, which is
 * the very thing this is meant to distinguish).
 */
function atPageEdge(l, edges) {
  const e = edges.get(l.page);
  if (!e) return false;
  const slack = (l.h || 9) * 0.5;
  return l.y >= e.top - slack || l.y <= e.bot + slack;
}

/**
 * Running heads and feet — page furniture, not content.
 *
 * A bare page number, or a short MARGIN line whose text (page number aside)
 * repeats on three or more pages: "P. W. SHOR", "FACTORING WITH A QUANTUM
 * COMPUTER", a journal's volume line. Conference templates print none, which is
 * why this never came up on the corpus; a journal/preprint template prints them
 * on EVERY page, including the bibliography's continuation pages, and sets them
 * at BODY size while the bibliography itself is set smaller. findReferencesBody's
 * heading-size test then read the next page's running head as the start of a new
 * section and cut the bibliography off at the page break (Shor quant-ph/9508027:
 * 26 body lines and 9 entries instead of ~60, and the reference pages after the
 * first were emphasized as body prose).
 */
function runningHeadTexts(lines, edges) {
  const pages = new Map();
  for (const l of lines) {
    // Only MARGIN lines can establish a running head. Without this, a phrase
    // that recurs in the bibliography itself qualified: on ACL's five-page
    // reference list, "Software Engineering" (an italic journal name at the end
    // of an entry) and "pages 1251–1263. IEEE." (digits stripped → "pages .
    // IEEE.") each appear on three or more pages, so those lines were skipped
    // as furniture, got no box in the region the engine leaves alone, and were
    // emphasized inside the reference list.
    if (!atPageEdge(l, edges)) continue;
    const t = normHead(l.text ?? "");
    if (t.length < 3 || t.length > 60) continue;
    if (!pages.has(t)) pages.set(t, new Set());
    pages.get(t).add(l.page);
  }
  const out = new Set();
  for (const [t, ps] of pages) if (ps.size >= 3) out.add(t);
  return out;
}

/**
 * Running heads and feet as GEOMETRY, for the typography engine to leave alone.
 *
 * The engine's own defence is a margin cut — the outer 6% of the page — which
 * only reaches a ONE-LINE head. A three-line running head (an acmart-style title
 * block repeated at the top of every odd page) hangs well below that band, is set
 * at or under body size, and carries no other signal, so it was emphasized as
 * body prose. Repetition across pages is the signal that identifies it, and only
 * a document-wide pass (this one) can see it.
 *
 * A line qualifies when it sits in the top/bottom band of its page AND its
 * digit-stripped text recurs on three or more pages (or it is a bare page
 * number). Body text does not repeat verbatim on three pages, so the band can be
 * generous: it is the repetition that decides.
 *
 * @returns {Map<number, Array<{x0,x1,y0,y1}>>} boxes per page (PDF coordinates)
 */
export function findFurniture(lines) {
  const edges = pageEdges(lines);
  const inBand = (l) => {
    const e = edges.get(l.page);
    if (!e) return false;
    const m = Math.max((l.h || 9) * 1.2, (e.top - e.bot) * 0.08);
    return l.y >= e.top - m || l.y <= e.bot + m;
  };
  // Two ledgers. VERBATIM repetition is the safe signal and carries no length
  // limit — a three-line title block repeats word for word. Digit-stripped
  // repetition is needed for a head that embeds its page number ("Journal Name,
  // Vol. 5, No. 3"), but it also makes two DIFFERENT body lines look identical
  // when a number is all that separates them, so it is allowed only for short
  // lines, where a page number is the plausible difference.
  const exact = new Map();
  const stripped = new Map();
  const add = (map, key, page) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(page);
  };
  for (const l of lines) {
    if (!inBand(l)) continue;
    const raw = (l.text ?? "").trim();
    if (raw.length >= 3 && raw.length <= 120) add(exact, raw.toLowerCase(), l.page);
    const t = normHead(raw);
    if (t.length >= 3 && raw.length <= 40) add(stripped, t, l.page);
  }
  const repeats = (map, key) => (map.get(key)?.size ?? 0) >= 3;
  const boxes = new Map();
  for (const l of lines) {
    if (!inBand(l)) continue;
    const raw = (l.text ?? "").trim();
    // A digits-only line is a page number only when it is the EXTREME line on
    // its page. Inside the band it is usually a math subscript: the extractor
    // emits "1" and "2" as their own lines under a formula, and treating those
    // as page numbers put a furniture box around a single character — the body
    // line beside it then started inside the box's slack and lost its emphasis
    // (IEEE journal p6, "…is not known to the PKG…").
    const isPageNumber = /^\d{1,4}$/.test(raw) && atPageEdge(l, edges);
    // Repeated text must be WORDS. A repeated symbol/digit fragment (a
    // subscript pair, "(·)") is formula debris, not a running head.
    const hasLetter = /\p{L}/u.test(raw);
    if (
      !isPageNumber &&
      !(hasLetter && repeats(exact, raw.toLowerCase())) &&
      !(hasLetter && raw.length <= 40 && repeats(stripped, normHead(raw)))
    ) {
      continue;
    }
    const pad = (l.h || 9) * 0.7;
    if (!boxes.has(l.page)) boxes.set(l.page, []);
    boxes.get(l.page).push({
      x0: l.x - 2,
      x1: (l.endX ?? l.x + 1000) + 2,
      y0: l.y - pad,
      y1: l.y + pad,
    });
  }
  return boxes;
}

export function findReferenceSections(lines) {
  const starts = findHeadingIndexes(lines);
  const sections = [];
  for (const start of starts) {
    const body = sectionBody(lines, start);
    // Two lines is the floor for a bibliography; below it the "heading" is a
    // cross-reference in prose ("see the references"), not a section.
    if (body.length >= 2) sections.push({ heading: lines[start], body });
  }
  return sections;
}

/**
 * The PRIMARY reference section — the longest one, which is the article's own
 * whenever a supplement's shorter list follows it. Callers that can only act on
 * one bibliography (and every existing test) use this; callers that must cover
 * the whole document — the region the typography engine leaves alone, and the
 * entry pool citations resolve against — use findReferenceSections instead.
 */
export function findReferencesBody(lines) {
  const sections = findReferenceSections(lines);
  if (!sections.length) return { heading: null, body: [] };
  let best = sections[0];
  for (const s of sections) if (s.body.length >= best.body.length) best = s;
  return best;
}

/** Body lines of the section whose heading is at `start`. */
function sectionBody(lines, start) {
  const heading = lines[start];
  const edges = pageEdges(lines);
  const heads = runningHeadTexts(lines, edges);
  const isFurniture = (l) => {
    const t = (l.text ?? "").trim();
    if (!atPageEdge(l, edges)) return false; // furniture lives in the margins
    return /^\d{1,4}$/.test(t) || heads.has(normHead(t));
  };
  // A following section may not say "appendix" (some templates use bare
  // "B Title" appendix headings), so also stop at any heading-sized line: at
  // least as large as the References heading itself and clearly larger than
  // the entries.
  const entryH = lines[start + 1]?.h ?? heading.h;
  // …and heading-sized is not a boundary either when the bibliography plainly
  // RESUMES after it. A two-column reference list is routinely interrupted by
  // a float: a figure or table pinned to the top of the next column carries a
  // caption set at BODY size, which is larger than the entries and at least as
  // large as the "References" heading, so the size test read it as the next
  // section and cut the list off — on a paper whose bibliography starts at the
  // foot of the left column, that left a body of two lines and one entry, and
  // 101 of its 104 citations resolved to nothing. A real section boundary is
  // followed by prose; an interruption is followed by more entry markers at
  // entry size. Look for those (a bounded scan — a caption plus its float's
  // stray labels, not a whole page).
  const resumesAfter = (i) => {
    for (let j = i + 1; j < Math.min(lines.length, i + 16); j++) {
      const l = lines[j];
      if (SECTION_AFTER.test(l.text) || HEADING.test(l.text)) return false;
      const marker =
        NUMERIC_MARKER.test(l.text) ||
        DOTTED_MARKER.test(l.text) ||
        ALPHA_MARKER.test(l.text);
      if (marker && Math.abs(l.h - entryH) <= entryH * 0.15) return true;
    }
    return false;
  };
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    // Furniture is neither a section boundary nor bibliography content: step
    // over it so a page break inside the reference list does not end the body.
    if (isFurniture(line)) continue;
    if (SECTION_AFTER.test(line.text) || HEADING.test(line.text)) break;
    // Heading-SIZED alone is not enough: a stray oversized glyph (a lone
    // quotation mark split onto its own line by the font-size line rule)
    // must not end the bibliography — a real section heading carries at
    // least two characters including a letter or digit.
    if (
      line.h >= heading.h * 0.9 &&
      line.h >= entryH * 1.15 &&
      line.text.trim().length >= 2 &&
      /[\p{L}\p{N}]/u.test(line.text)
    ) {
      if (resumesAfter(i)) continue; // an interrupting float, not a new section
      break;
    }
    body.push(line);
  }
  return body;
}

function splitByMarker(body, marker) {
  const groups = [];
  let cur = null;
  for (const line of body) {
    if (marker.test(line.text)) {
      cur = [line];
      groups.push(cur);
    } else if (cur) {
      cur.push(line);
    }
  }
  return groups;
}

/** Hanging indent: entry-initial lines sit at the column's left margin. */
function splitByIndent(body) {
  const margins = new Map();
  for (const l of body) {
    const key = `${l.page}:${l.column}:${Math.round(l.x)}`;
    margins.set(key, (margins.get(key) || 0) + 1);
  }
  // Left margin per page+column = smallest x that occurs more than once.
  const leftMargin = new Map();
  for (const l of body) {
    const col = `${l.page}:${l.column}`;
    const x = Math.round(l.x);
    if (margins.get(`${col}:${x}`) < 2) continue;
    if (!leftMargin.has(col) || x < leftMargin.get(col)) leftMargin.set(col, x);
  }
  const groups = [];
  let cur = null;
  let sawIndent = false;
  for (const l of body) {
    const margin = leftMargin.get(`${l.page}:${l.column}`);
    const atMargin = margin === undefined || Math.round(l.x) <= margin + 2;
    if (!atMargin) sawIndent = true;
    if (atMargin || !cur) {
      cur = [l];
      groups.push(cur);
    } else {
      cur.push(l);
    }
  }
  // No hanging indent at all → margin splitting produced one line per group;
  // fall back to year-boundary grouping (entry ends after it contains a year).
  if (!sawIndent) {
    const merged = [];
    let acc = null;
    for (const l of body) {
      if (!acc) {
        acc = [l];
      } else {
        acc.push(l);
      }
      const text = acc.map((x) => x.text).join(" ");
      if (YEAR.test(text) && /[.”"]\s*$/.test(l.text)) {
        merged.push(acc);
        acc = null;
      }
    }
    if (acc) merged.push(acc);
    return merged;
  }
  return groups;
}

function buildEntry(group) {
  if (!group?.length) return null;
  const first = group[0];
  let raw = group.map((l) => l.text).join(" ").replace(/\s+/g, " ").trim();
  // De-hyphenate line breaks: "infor- mation" -> "information".
  raw = raw.replace(/(\p{Ll})- (\p{Ll})/gu, "$1$2");
  let number = null;
  let alphaKey = null;
  let m = NUMERIC_MARKER.exec(raw) || DOTTED_MARKER.exec(raw);
  if (m) {
    number = parseInt(m[1], 10);
    raw = raw.slice(m[0].length).trim();
  } else if ((m = ALPHA_MARKER.exec(raw))) {
    alphaKey = m[1];
    raw = raw.slice(m[0].length).trim();
  }
  // The first author's SURNAME. In an APA-style list ("Doe, J. (2019)") that is
  // the first capitalized word, which is all the old one-regex heuristic could
  // ever return — but a numeric/alpha bibliography sets the given name first
  // ("Martín Abadi and Cédric Fournet"), where the same regex returns the GIVEN
  // name ("Martín", or "Mart" once the PDF's accent composition splits it).
  // That name is what disambiguates a reference lookup, so it has to be right.
  const authors = guessAuthors(raw);
  const surname =
    firstAuthorSurname(authors) ??
    /\p{Lu}[\p{L}'’-]+/u.exec(raw)?.[0] ??
    null;
  const year = YEAR.exec(raw)?.[0] ?? null;
  const doi =
    /\b10\.\d{4,9}\/[^\s"',;]+/.exec(raw)?.[0].replace(/[).,;]+$/, "") ?? null;
  return {
    number,
    label: number !== null ? String(number) : alphaKey ?? (surname && year ? `${surname}-${year}` : null),
    surname,
    year,
    doi,
    raw,
    authors,
    title: guessTitle(raw),
    page: first.page,
    y: first.y + first.h,
  };
}

// Where one entry's AUTHOR BLOCK ends and its TITLE begins. Five shapes, each
// with its own delimiter, tried in order; the last is a generic sentence split.
//
// Quoted title: `A. Author, “Title,” in Proc. …`
const QUOTED_TITLE = /[“"]([^”"]{8,320})[”"]/;
// LNCS/Springer: `Surname, I., Surname, I.: Title. In: Venue`. The author list
// is surname+initials pairs (or "et al.") and ends at a COLON, which no other
// shape here does — so this guard cannot swallow a numeric entry whose TITLE
// happens to contain a colon ("BERT: Pre-training of …"). Tried before APA
// because an LNCS entry ending in a DOI ("… (2005). https://doi.org/10.1007/x")
// satisfies the APA pattern, whose answer was the title "https://doi".
const LNCS =
  /^(?:(?:\p{Ll}{2,4}\s+)?\p{Lu}[\p{L}'’-]+,\s*(?:\p{Lu}\.\s*)+(?:,\s*)?|et\s+al\.\s*,?\s*)+:\s*(.{8,220}?)(?=\.\s|$)/u;
// APA: `… (2020). Title. Venue …`
const APA_PERIOD = /\(\s*(?:19|20)\d{2}[a-z]?\s*\)\.\s*([^.]{8,200})\./;
// …but only when what follows the year is a TITLE. The ACM Reference Format
// puts its parenthesised year AFTER the title and follows it with the preprint
// id — "… Software Radio. (2016). arXiv:1607.05171 [cs.CR]" — where this
// pattern's answer is "arXiv:1607" (the capture cannot span a period, and
// there is one inside the identifier). Two words is the test: an identifier is
// one token, and the shortest real titles ("Applied cryptography") are two.
const TWO_WORDS = /\p{L}[\p{L}'’-]*\s+\S*\p{L}/u;
// The same author-year form punctuated with COMMAS — "L. M. Adleman (1994),
// Algorithmic number theory, in Proceedings of …" (older LaTeX article
// bibliographies). It has no sentence period anywhere, so the generic split
// cannot see a title at all and the whole entry became the Scholar query. The
// title runs to the venue, which announces itself as ", in …", ", pp. …",
// ", preprint", or an abbreviated journal name (", Phys. Rev. Lett.").
const APA_COMMA =
  /\(\s*(?:19|20)\d{2}[a-z]?\s*\)\s*,\s*(.{8,220}?)(?=,\s+(?:in|In|pp?\.|preprint|vol\.|volume)\b|,\s+\p{Lu}[\p{L}]{0,9}\.|\.\s|$)/u;
// A parenthesised year is not always the author-year delimiter: the ACM
// Reference Format ends with one ("… Applications 32, 2 (2009), 315–323."), and
// what follows it there is the PAGE RANGE. A title contains a word; a page range
// does not, and the sentence split reads the ACM form correctly.
const TITLE_SHAPED = /\p{L}{4}/u;
// Numeric style: `Authors. Title. Venue, year.` The author block is the
// comma/initial-heavy first sentence and the title is the next one. The
// lookbehind requires two word chars, so "A. Vaswani" initials don't split a
// sentence while "et al." does.
//
// The lookahead is what a title may START with, and a capital is not the only
// thing: "5GReasoner: …", "5G SUCI-Catchers: …" begin with a digit, and a
// bibliography that keeps BibTeX casing braces begins with one ("{DoLTEst}:
// In-depth downlink negative testing"). Neither used to split, so the sentence
// AFTER the title — the venue — became the title, and those papers could not be
// looked up at all. A digit run of one to three is a title like "5G…"; four is
// the year of an ACM-format entry ("… Bertino. 2019. 5GReasoner: …"), which
// must NOT split there or the title becomes "2019."
//
// A square bracket is deliberately NOT in that set: IEEE-style entries mark
// their link with one ("Smart home control on one app. [Online]. Available:
// https://…"), and splitting there makes "[Online]" the title — measured on
// six entries of one private paper, where the unsplit entry had been right.
//
// Two guards on the sentence end itself:
//   - Not inside a URL. A wrapped link reaches the parser with a space in it
//     ("Available: https://www. 3gpp.org/dynareport/33501.htm"), and "www."
//     then reads as the end of a sentence — making the rest of the URL the
//     title of a 3GPP specification.
//   - A title ending in "?" or "!" is followed by the style's own period
//     ("Still catching them all?. In Proceedings of…"), and one word character
//     plus two marks is still a sentence end.
// (A closing brace or paren may sit between the last word and the period —
// "…trade-offs in {PIR}. In 30th USENIX…" — and that is still a sentence end.)
const SENTENCE_SPLIT =
  /(?<!(?:https?:\/\/|www\.)\S{0,30})(?<=\w{2}[)}\]"”]?[.?!]{1,2})\s+(?=[A-Z“"{]|\d{1,3}\p{L})/u;

/**
 * Is this sentence a title, or the identifiers that some styles put between
 * the author and the title?
 *
 * "3GPP. TS 33.331 version 17.2.0 . 2022. 5G NR; Radio Resource Control (RRC);
 * Protocol specification" has THREE sentences before the title, and taking the
 * one right after the authors gives "TS 33.331 version 17.2.0 . 2022". Two
 * words of three letters or more is the test: a spec id and a year have one at
 * most, and the shortest real titles ("Applied cryptography") have two. They
 * are counted, not required to be adjacent — "Applied pi calculus" has a
 * two-letter word between its two.
 */
const readsLikeTitle = (s) => (s.match(/\p{L}{3,}/gu) ?? []).length >= 2;

/**
 * A sentence that announces where the work appeared, or how to reach it —
 * never the work's title. Reached when the author block and the title are one
 * sentence (authors ending in an initial: "…and Sakimura, N. JSON Web
 * Signature (JWS). Technical report, RFC Editor…"), where the sentence AFTER
 * the authors is the venue and picking it loses the title entirely.
 *
 * A bare "In" is deliberately not here — "In search of an understandable
 * consensus algorithm" is a title — so only the venue forms that actually
 * follow it are listed.
 */
const VENUE_START =
  /^(?:in\s+(?:proc\b|proceedings\b|the\s+proceedings\b|\d+(?:st|nd|rd|th)\b|acm\b|ieee\b|usenix\b|advances\b|lecture\s+notes\b|hardware\b)|proc\.|proceedings\b|technical\s+(?:report|specification)\b|tech\.?\s*rep\.?\b|rfc\s*\d|arxiv[:\s]|available\b|\[online\]|ieee\s+std\b|pages?\b|pp\.\s|vol\.\s|volume\s+\d|released\b|accessed\b|version\s+\d|preprint\b|(?:master'?s?|phd|doctoral)\s+thesis)/i;

const trimEdge = (s) => s.replace(/[,.;]\s*$/, "").trim();

/** {authors, title} for one entry — ONE decision, so guessAuthors and
 *  guessTitle can never disagree about where the author block ends. `authors`
 *  is null when no shape matched (there is nothing to separate). */
function splitEntry(raw) {
  const quoted = QUOTED_TITLE.exec(raw);
  if (quoted) {
    const head = trimEdge(raw.slice(0, quoted.index));
    return { authors: head.length >= 2 ? head : null, title: trimEdge(quoted[1]) };
  }
  const lncs = LNCS.exec(raw);
  if (lncs) {
    return { authors: raw.slice(0, raw.indexOf(":")).trim(), title: trimEdge(lncs[1]) };
  }
  const apa = APA_PERIOD.exec(raw);
  if (apa && TWO_WORDS.test(apa[1])) {
    // The year parenthesis is the delimiter, so a trailing period belongs to
    // the last initial ("Doe, J.") and is kept.
    return {
      authors: raw.slice(0, apa.index).trim().replace(/[,;]\s*$/, ""),
      title: apa[1],
    };
  }
  const apaComma = APA_COMMA.exec(raw);
  if (apaComma && TITLE_SHAPED.test(apaComma[1])) {
    return {
      authors: raw.slice(0, apaComma.index).trim().replace(/[,;]\s*$/, ""),
      title: trimEdge(apaComma[1]),
    };
  }
  const sentences = raw.split(SENTENCE_SPLIT);
  if (sentences.length >= 2) {
    // The first sentence after the authors that reads as a title, not as the
    // identifiers a few styles put in between (a spec number, a bare year).
    // Everything skipped stays with the authors, so `authors` and `title`
    // still describe the same cut.
    // No qualifying sentence means the title is not a sentence of its own (it
    // shares one with the authors), and the whole entry — the catch-all below
    // — carries it where a venue sentence would not.
    let i = 1;
    while (
      i < sentences.length &&
      !(readsLikeTitle(trimEdge(sentences[i])) && !VENUE_START.test(trimEdge(sentences[i])))
    ) {
      i++;
    }
    const candidate = i < sentences.length ? trimEdge(sentences[i]) : "";
    if (candidate.length >= 8 && candidate.length <= 250) {
      return { authors: trimEdge(sentences.slice(0, i).join(" ")), title: candidate };
    }
  }
  return { authors: null, title: raw.slice(0, 150) };
}

/** Best-effort title for the Scholar query; falls back to the raw entry. */
export function guessTitle(raw) {
  return splitEntry(raw).title;
}

/** The run of names before the title, or null when no shape matched. */
export function guessAuthors(raw) {
  return splitEntry(raw).authors;
}

/**
 * The first author's surname, for either convention:
 *   "Doe, J., & Smith, A."        → Doe   (surname first, initials after it)
 *   "Martín Abadi and C. Fournet" → Abadi (given name first, surname last)
 * One rule covers both: cut at the first " and "/"&"/";"/"," — whatever that
 * leaves is a single name, surname-only in the first form and given-name-first
 * in the second — then take its last multi-letter capitalized token. Initials
 * ("A.") are one letter and never win; a lowercase nobiliary particle ("van
 * Emde Boas" → Boas) is skipped exactly as findCitations skips it, so the
 * entry and the citation key agree.
 */
export function firstAuthorSurname(authors) {
  if (!authors) return null;
  const head = authors.split(/\s+(?:and|&)\s+|[,;]/)[0];
  return head.match(/\p{Lu}[\p{L}'’-]+/gu)?.at(-1) ?? null;
}

/**
 * The parsed entry's author block as BibTeX's " and "-separated list.
 *
 * Two conventions, and the separator differs: a SURNAME-FIRST list puts a comma
 * inside each name ("Doe, J., & Smith, A."), so only "and"/"&"/";" may split it
 * — splitting on commas would cut every name in half. A given-name-first list
 * ("Syed Rafiul Hussain, Imtiaz Karim, and Elisa Bertino") separates names WITH
 * commas. The test for the first form is a comma followed by initials that END
 * the name; "A. Vaswani, N. Shazeer" has its initials at the START of the next
 * name and is correctly read as the second form.
 */
export function bibAuthors(authors) {
  if (!authors) return null;
  const surnameFirst = /,\s*(?:\p{Lu}\.\s*)+(?=,|;|&|$)/u.test(authors);
  // In the surname-first form the ONLY comma that separates two names is the
  // one right after a run of initials; every other comma is inside a name.
  const sep = surnameFirst
    ? /\s*(?:;|&|\band\b)\s*|(?<=\p{Lu}\.)\s*,\s*/u
    : /\s*(?:,|;|&|\band\b)\s*/;
  const names = authors
    .split(sep)
    .map((n) => (n ?? "").trim().replace(/[,;]+$/, "").replace(/(\p{Ll})\.$/u, "$1"))
    .filter((n) => n && !/^et\s+al$/i.test(n));
  return names.length ? names.join(" and ") : null;
}

// In-paper references: pointers to the document's own figures, tables,
// sections, equations, algorithms, and appendices.
// The trailing letter only counts as a subsection suffix ("Section 2a") when
// it is NOT itself followed by another letter. Text-layer spans correspond to
// PDF-authored LINES, and a justified line's wrap point carries no space
// character in either the outgoing or incoming span — "...Chapter 2" / "pro-
// vides..." joins as "...Chapter 2provides...". Without this guard the bare
// `[a-z]?` swallowed the next word's first letter as a fake suffix ("2p"),
// leaving that single letter colored as part of the reference and the rest
// of the word an abrupt, oddly-colored orphan.
const INTERNAL_REF =
  /\b(?:Figure|Fig\.|Figs?\.|Table|Tab\.|Algorithm|Alg\.|Listing|Section|Sec\.|§|Appendix|App\.|Equation|Eq\.|Chapter|Theorem|Lemma|Definition|Claim)\s*~?\s*(?:\d+(?:\.\d+)*(?:[a-z](?![a-zA-Z]))?|[A-Z]\b(?:\.\d+)?)/g;

/** Character ranges of in-paper references in a text string. */
export function findInternalRefs(text) {
  const out = [];
  for (const m of text.matchAll(INTERNAL_REF)) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// A numeric citation bracket: a number list, optionally followed by a single
// locator into the cited work — "[9, §5.2.2.1]", "[24, Section 5.2]",
// "[26, Lemma 1]", "[58, §4.2, NOTE 2]". Only the leading number LIST is
// captured (group 1) for resolution; the locator is consumed so the whole
// bracket becomes one clickable/colored citation. The locator must begin with
// §/¶/p./pp. or a capital word so ordinary prose "[9, and ...]" is not swept up.
const NUMERIC_CITE =
  /\[(\d{1,3}(?:\s*[,;–—-]\s*\d{1,3})*)(?:\s*,\s*(?:§|¶|pp?\.|[A-Z])[^\]]{0,55})?\]/g;
const AUTHOR_YEAR_CITE = /\(([^()]{2,120}?(?:19|20)\d{2}[a-z]?(?:\s*[;,]\s*(?:p+\.\s*[\d–-]+|[^();]*?(?:19|20)\d{2}[a-z]?))*)\)/g;

// NARRATIVE author-year (natbib \citet): the author names are running PROSE and
// only the year is bracketed — "Church [1936]", "Vergis et al. [1986]",
// "van Emde Boas [1990]", "Benioff [1980, 1982a]", "Bennett (1973)". Neither
// pattern above can see these: NUMERIC_CITE takes 1-3-digit entry numbers (a
// 4-digit year never matches), and AUTHOR_YEAR_CITE needs the AUTHOR inside the
// parentheses. On a paper written this way nothing was linked at all (Shor
// quant-ph/9508027 — 0 citations, while its 64 references parsed fine).
//
// The name run accepts initials ("L. M. Adleman"), lowercase nobiliary
// particles ("van Emde Boas"), "et al." and "and" — but nothing else, so
// ordinary prose cannot grow into it: a lowercase word ends the run, and the
// year bracket must follow immediately.
const CITE_NAME = "\\p{Lu}[\\p{L}'’-]*\\.?";
const CITE_PARTICLE = "(?:van|von|de[nrl]?|del|della|di|da|ter|ten)";
const CITE_YEARS = "(?:19|20)\\d{2}[a-z]?(?:\\s*[,;]\\s*(?:19|20)\\d{2}[a-z]?)*";
const NARRATIVE_CITE = new RegExp(
  `((?:${CITE_PARTICLE}\\s+)?${CITE_NAME}(?:\\s+(?:et\\s+al\\.?|and|&|${CITE_PARTICLE}|${CITE_NAME}))*)\\s*[[(](${CITE_YEARS})[\\])]`,
  "gu",
);
// Words that look like a surname but introduce a NUMBER, not an author.
const NOT_A_SURNAME = /^(Table|Figure|Fig|Section|Sec|Eq|Equation|Chapter|Appendix|Algorithm|Theorem|Lemma|Definition|Part|Step|Line|No|Vol|Ref)$/i;

// BibTeX "alpha"-style citation keys in brackets, matching ALPHA_MARKER's
// entry labels — "[WL92]", "[SRC07, SRK10]", "[GHI+21]". Ends in exactly two
// digits (an optional disambiguator letter after) so it can't swallow an
// ordinary bracketed word or a numeric list (NUMERIC_CITE already owns those).
const ALPHA_CITE_KEY = "[A-Z][A-Za-z]{0,6}\\+?\\d{2}[a-z]?";
const ALPHA_CITE = new RegExp(
  `\\[(${ALPHA_CITE_KEY}(?:\\s*,\\s*${ALPHA_CITE_KEY})*)\\]`,
  "g",
);

/**
 * Find citation-like substrings in a text-layer span's text.
 * @returns Array<{start, end, keys: string[]}> keys match entry labels.
 */
export function findCitations(text) {
  const out = [];
  for (const m of text.matchAll(NUMERIC_CITE)) {
    const keys = expandNumericList(m[1]);
    // Bibliographies number from [1]: a bracketed list containing 0 is math
    // (a vector/matrix row like "[2, 1, 0]"), not a citation.
    if (keys.includes("0")) continue;
    if (keys.length) out.push({ start: m.index, end: m.index + m[0].length, keys });
  }
  for (const m of text.matchAll(AUTHOR_YEAR_CITE)) {
    const keys = [];
    for (const part of m[1].split(";")) {
      const year = YEAR.exec(part)?.[0];
      const surname = /\p{Lu}[\p{L}'’-]+/u.exec(part)?.[0];
      if (year && surname && !NOT_A_SURNAME.test(surname)) {
        keys.push(`${surname}-${year}`);
      }
    }
    if (keys.length) out.push({ start: m.index, end: m.index + m[0].length, keys });
  }
  for (const m of text.matchAll(ALPHA_CITE)) {
    const keys = m[1].split(/\s*,\s*/).map((k) => k.trim()).filter(Boolean);
    if (keys.length) out.push({ start: m.index, end: m.index + m[0].length, keys });
  }
  for (const m of text.matchAll(NARRATIVE_CITE)) {
    // The surname is the LAST multi-letter capitalized token of the run, so
    // initials are skipped ("L. M. Adleman" → Adleman) and a particle name
    // keeps its head word ("van Emde Boas" → Boas, which resolveCitation still
    // matches against the entry text).
    const surname = (m[1].match(/\p{Lu}[\p{L}'’-]{1,}/gu) ?? []).at(-1);
    if (!surname || NOT_A_SURNAME.test(surname)) continue;
    const keys = m[2]
      .split(/[,;]/)
      .map((y) => y.trim())
      .filter(Boolean)
      .map((y) => `${surname}-${y}`);
    if (keys.length) out.push({ start: m.index, end: m.index + m[0].length, keys });
  }
  out.sort((a, b) => a.start - b.start);
  // Drop overlaps: the annotator wraps each range in the span's text, so two
  // ranges covering the same characters would nest and corrupt the markup.
  // Earliest (then longest) wins.
  const kept = [];
  for (const c of out) {
    const prev = kept.at(-1);
    if (prev && c.start < prev.end) {
      if (c.end - c.start > prev.end - prev.start) kept[kept.length - 1] = c;
      continue;
    }
    kept.push(c);
  }
  return kept;
}

function expandNumericList(list) {
  const keys = [];
  for (const part of list.split(/[,;]/)) {
    const range = /^\s*(\d{1,3})\s*[–—-]\s*(\d{1,3})\s*$/.exec(part);
    if (range) {
      const [a, b] = [parseInt(range[1], 10), parseInt(range[2], 10)];
      for (let n = a; n <= Math.min(b, a + 12); n++) keys.push(String(n));
    } else {
      const n = /^\s*(\d{1,3})\s*$/.exec(part);
      if (n) keys.push(n[1]);
    }
  }
  return keys;
}

/** Map citation keys to entries. Returns the matched entries (may be empty). */
export function resolveCitation(keys, entries) {
  const found = [];
  for (const key of keys) {
    if (/^\d+$/.test(key)) {
      const e = entries.find((x) => x.number === parseInt(key, 10));
      if (e) found.push(e);
    } else if (entries.some((x) => x.label === key)) {
      // Alpha-style key ("WL92"): matches an ALPHA_MARKER entry's own label
      // directly — it's not a synthesized surname-year pair to split apart.
      found.push(entries.find((x) => x.label === key));
    } else {
      // Split on the LAST hyphen — a hyphenated surname ("Ben-Or-1994") would
      // otherwise yield surname "Ben", year "Or".
      const cut = key.lastIndexOf("-");
      const surname = key.slice(0, cut);
      const year = key.slice(cut + 1);
      const e =
        entries.find((x) => x.surname === surname && x.year === year) ||
        entries.find(
          (x) => x.year === year && x.raw.slice(0, 80).includes(surname),
        );
      if (e) found.push(e);
    }
  }
  return [...new Set(found)];
}
