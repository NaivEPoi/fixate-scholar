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
  const start = findHeadingIndex(lines);
  if (start === -1) return [];
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (SECTION_AFTER.test(line.text) || HEADING.test(line.text)) break;
    body.push(line);
  }
  if (body.length < 2) return [];

  const numericStarts = body.filter((l) => NUMERIC_MARKER.test(l.text)).length;
  const dottedStarts = body.filter((l) => DOTTED_MARKER.test(l.text)).length;

  let groups;
  if (numericStarts >= 3) groups = splitByMarker(body, NUMERIC_MARKER);
  else if (dottedStarts >= 3) groups = splitByMarker(body, DOTTED_MARKER);
  else groups = splitByIndent(body);

  return groups
    .map((g) => buildEntry(g))
    .filter((e) => e && e.raw.length > 20);
}

function findHeadingIndex(lines) {
  // Search from the end — "References" may also appear in the TOC or body.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (HEADING.test(lines[i].text)) return i;
  }
  return -1;
}

/** Position of the References heading, for leaving the bibliography as-is. */
export function findReferencesHeading(lines) {
  const idx = findHeadingIndex(lines);
  return idx === -1 ? null : { page: lines[idx].page, y: lines[idx].y };
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

const NUMERIC_CITE = /\[(\d{1,3}(?:\s*[,;–—-]\s*\d{1,3})*)\]/g;
const AUTHOR_YEAR_CITE = /\(([^()]{2,120}?(?:19|20)\d{2}[a-z]?(?:\s*[;,]\s*(?:p+\.\s*[\d–-]+|[^();]*?(?:19|20)\d{2}[a-z]?))*)\)/g;

/**
 * Find citation-like substrings in a text-layer span's text.
 * @returns Array<{start, end, keys: string[]}> keys match entry labels.
 */
export function findCitations(text) {
  const out = [];
  for (const m of text.matchAll(NUMERIC_CITE)) {
    const keys = expandNumericList(m[1]);
    if (keys.length) out.push({ start: m.index, end: m.index + m[0].length, keys });
  }
  for (const m of text.matchAll(AUTHOR_YEAR_CITE)) {
    const keys = [];
    for (const part of m[1].split(";")) {
      const year = YEAR.exec(part)?.[0];
      const surname = /\p{Lu}[\p{L}'’-]+/u.exec(part)?.[0];
      if (year && surname && !/^(Table|Figure|Fig|Section|Eq|Equation)$/i.test(surname)) {
        keys.push(`${surname}-${year}`);
      }
    }
    if (keys.length) out.push({ start: m.index, end: m.index + m[0].length, keys });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
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
      const [surname, year] = key.split("-");
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
