// Pure heuristics that turn extracted lines into a reference list and map
// in-text citation keys onto entries. No DOM, no Chrome APIs (unit-testable).

const HEADING = /^(?:[ivxlcdm]+[.\s]+|\d+[.\s]+|[A-Z][.\s]+)?(references|bibliography|works cited|literature cited)\s*$/i;
const SECTION_AFTER = /^(?:[A-Z\d]+[.\s]+)?(appendix|acknowledg|supplementary|author contributions|funding|conflicts? of interest)/i;
const NUMERIC_MARKER = /^\[(\d{1,3})\]\s*/;
const DOTTED_MARKER = /^(\d{1,3})\.\s+(?=\D)/;
const YEAR = /\b(19|20)\d{2}[a-z]?\b/;

/**
 * @param lines output of extractor.mjs (reading order)
 * @returns {entries: Array<{label:string|null, number:number|null, raw:string,
 *           title:string, page:number, y:number}>} or empty list
 */
export function parseReferences(lines) {
  const { body } = findReferencesBody(lines);
  if (body.length < 2) return [];

  const numericStarts = body.filter((l) => NUMERIC_MARKER.test(l.text)).length;
  const dottedStarts = body.filter((l) => DOTTED_MARKER.test(l.text)).length;

  let groups;
  let mode;
  if (numericStarts >= 3) { groups = splitByMarker(body, NUMERIC_MARKER); mode = "numeric"; }
  else if (dottedStarts >= 3) { groups = splitByMarker(body, DOTTED_MARKER); mode = "dotted"; }
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

function findHeadingIndex(lines) {
  // Search from the end — "References" may also appear in the TOC or body.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (HEADING.test(lines[i].text)) return i;
  }
  return -1;
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

export function findReferencesBody(lines) {
  const start = findHeadingIndex(lines);
  if (start === -1) return { heading: null, body: [] };
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
      break;
    }
    body.push(line);
  }
  return { heading, body };
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
  let m = NUMERIC_MARKER.exec(raw) || DOTTED_MARKER.exec(raw);
  if (m) {
    number = parseInt(m[1], 10);
    raw = raw.slice(m[0].length).trim();
  }
  const surname = /\p{Lu}[\p{L}'’-]+/u.exec(raw)?.[0] ?? null;
  const year = YEAR.exec(raw)?.[0] ?? null;
  const doi =
    /\b10\.\d{4,9}\/[^\s"',;]+/.exec(raw)?.[0].replace(/[).,;]+$/, "") ?? null;
  return {
    number,
    label: number !== null ? String(number) : surname && year ? `${surname}-${year}` : null,
    surname,
    year,
    doi,
    raw,
    title: guessTitle(raw),
    page: first.page,
    y: first.y + first.h,
  };
}

/** Best-effort title for the Scholar query; falls back to the raw entry. */
export function guessTitle(raw) {
  // Quoted titles: “Title,” or "Title."
  const quoted = /[“"]([^”"]{8,200})[”"]/.exec(raw);
  if (quoted) return quoted[1].replace(/[,.;]\s*$/, "");
  // APA: ... (2020). Title. Venue ...
  const apa = /\(\s*(?:19|20)\d{2}[a-z]?\s*\)\.\s*([^.]{8,200})\./.exec(raw);
  if (apa) return apa[1];
  // Numeric style: Authors. Title. Venue, year. — authors block is the
  // comma/initial-heavy first sentence; title is the next sentence. The
  // lookbehind requires two word chars so "A. Vaswani" initials don't split,
  // while "et al." does.
  const sentences = raw.split(/(?<=\w{2}[.?!])\s+(?=[A-Z“"])/u);
  if (sentences.length >= 2) {
    const candidate = sentences[1].replace(/[.;,]\s*$/, "");
    if (candidate.length >= 8 && candidate.length <= 250) return candidate;
  }
  return raw.slice(0, 150);
}

// In-paper references: pointers to the document's own figures, tables,
// sections, equations, algorithms, and appendices.
const INTERNAL_REF =
  /\b(?:Figure|Fig\.|Figs?\.|Table|Tab\.|Algorithm|Alg\.|Listing|Section|Sec\.|§|Appendix|App\.|Equation|Eq\.|Chapter|Theorem|Lemma|Definition|Claim)\s*~?\s*(?:\d+(?:\.\d+)*[a-z]?|[A-Z]\b(?:\.\d+)?)/g;

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
