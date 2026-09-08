// Pure word segmentation + emphasis-point computation. No DOM, no Chrome APIs,
// so it runs under `node --test` as-is.
//
// The emphasis length is a user-configurable fraction of the word (default 0.4),
// optionally capped at the end of the first syllable ("smart mode"). It is NOT
// the fixed fractional table associated with the patented method — see TRADEMARKS.md.

const WORD_SEGMENTER = new Intl.Segmenter("en", { granularity: "word" });

const VOWELS = /[aeiouyàâäéèêëîïôöùûüAEIOUY]/;

// TeX composes an accented letter from two glyphs, and a PDF text layer keeps
// them apart: "naïve" arrives as "na" + "¨" + "ıve" (dotless i), "Martín" as
// "Mart" + "´" + "ın". These are the accent glyphs, spacing and combining.
const ACCENTS = "\u00a8\u00b4\u0060\u00af\u00b8\u02c6\u02c7\u02d8\u02d9\u02da\u02db\u02dc\u02dd\u0300-\u036f";
const ACCENT_ONLY = new RegExp(`^[${ACCENTS}]+$`);
// Typographic ligatures: ONE character in the text layer, two or three letters
// on the page. pdfTeX and friends emit these codepoints for the f-ligatures, so
// "efficient" can arrive as "eﬃcient" - 7 characters for 9 letters.
//
// They live in Alphabetic Presentation Forms, outside the Latin range below, so
// until R25 every word carrying one failed PLAIN_WORD and was left with NO
// emphasis at all: measured at 62 of 63 such words on one public paper, against
// 2259/2262 for words without one. Whether a document is affected is purely a
// matter of how its producer encoded the ligature, which is why this was
// invisible on the arXiv/USENIX papers and plain on the Computer Modern one.
const LIGATURES = {
  "\ufb00": "ff",
  "\ufb01": "fi",
  "\ufb02": "fl",
  "\ufb03": "ffi",
  "\ufb04": "ffl",
  "\ufb05": "st",
  "\ufb06": "st",
};
const LIGATURE_RANGE = "\ufb00-\ufb06";
const expandLigatures = (word) =>
  word.replace(new RegExp(`[${LIGATURE_RANGE}]`, "g"), (c) => LIGATURES[c]);

/**
 * Convert a prefix length measured in LETTERS into a count of CHARACTERS of
 * `word` - the two differ exactly when a ligature is involved.
 *
 * A ligature that straddles the boundary is taken whole: it is a single glyph,
 * so there is no way to emphasize half of it, and including it keeps the prefix
 * at least as long as asked rather than silently shorter.
 */
function charsForLetters(word, letters) {
  let chars = 0;
  let seen = 0;
  for (const ch of word) {
    if (seen >= letters) break;
    const width = LIGATURES[ch]?.length ?? 1;
    // A ligature straddling the target: take it only if that lands NEARER the
    // asked-for length than stopping short does. Always taking it emphasized
    // four letters of "oﬃce" where "office" gets two.
    if (
      seen + width > letters &&
      chars > 0 &&
      seen + width - letters > letters - seen
    ) {
      break;
    }
    seen += width;
    chars++;
  }
  return Math.max(1, chars);
}

// A plain Latin word, accent glyphs and ligatures included. It must still
// carry a real letter, so a stray accent run on its own is never emphasized.
const PLAIN_WORD = new RegExp(
  `^[A-Za-zÀ-\u024f'\u2019\\-${LIGATURE_RANGE}${ACCENTS}]+$`,
);

// Spans dominated by digits and operators (equations, axis labels) are left
// alone — bolding fragments of math reads as noise. Ordinary prose containing
// a year or page number must still pass.
const MATHY = (text) => {
  const letters = (text.match(/\p{L}/gu) || []).length;
  const mathChars = (text.match(/[\d=+*/^<>|\\∑∏∫√∞±×÷∈∉∀∃≤≥≈≠⊂⊃∪∩→←↔]/gu) || []).length;
  return mathChars > letters;
};

/**
 * Split text into segments, marking which are emphasizable words.
 * Returns [{text, isWord}] covering the input exactly (concatenation-safe).
 */
export function segment(text) {
  const raw = [];
  for (const s of WORD_SEGMENTER.segment(text)) {
    raw.push({ text: s.segment, isWord: s.isWordLike === true });
  }
  // Weld a split accented letter back together. Without this the segmenter
  // reports "na", "¨" and "ıve" as three tokens, and the emphasis pass bolds
  // a prefix of each — "naïve" rendered with two bold runs inside one word.
  // Concatenation-safety is preserved: only the token boundaries move.
  const out = [];
  let openAccent = false;
  for (const seg of raw) {
    const prev = out.at(-1);
    if (prev?.isWord && ACCENT_ONLY.test(seg.text)) {
      prev.text += seg.text;
      openAccent = true;
      continue;
    }
    if (openAccent && prev?.isWord && seg.isWord) {
      prev.text += seg.text;
      openAccent = false;
      continue;
    }
    openAccent = false;
    out.push({ text: seg.text, isWord: seg.isWord });
  }
  return out;
}

/**
 * Cumulative syllable end positions, by a naive but stable heuristic: each
 * syllable is consonants + a vowel cluster + at most one trailing consonant.
 */
export function syllableBoundaries(word) {
  const ends = [];
  let i = 0;
  while (i < word.length) {
    let j = i;
    while (j < word.length && !VOWELS.test(word[j])) j++;
    while (j < word.length && VOWELS.test(word[j])) j++;
    if (j < word.length && !VOWELS.test(word[j])) j++;
    if (j === i) break; // no progress (shouldn't happen) — bail out
    ends.push(j);
    i = j;
  }
  return ends;
}

/**
 * Number of leading characters to embolden for `word`, by emphasis mode:
 *  - "dynamic" (default): whole syllables, as many as fit in half the word
 *    (rounded up) — longer words get several syllables, never more than half.
 *  - "syllable": exactly the first syllable.
 *  - "fraction": `fraction` (0..1) of the word length, rounded, min 1.
 * Always at least 1 character and never the whole word.
 */
export function emphasisLength(word, opts = {}) {
  const { fraction = 0.4 } = opts;
  const mode = opts.emphasisMode ?? (opts.smartSyllable ? "syllable" : "dynamic");
  const letters = word.length;
  if (letters === 0) return 0;
  if (letters === 1) return 1;
  let n;
  if (mode === "fraction") {
    n = Math.max(1, Math.round(letters * fraction));
  } else {
    const ends = syllableBoundaries(word);
    const first = ends[0] ?? letters;
    if (mode === "syllable") {
      n = Math.max(1, first);
    } else {
      const half = Math.ceil(letters / 2);
      const fitting = ends.filter((e) => e <= half);
      n = fitting.length ? fitting.at(-1) : Math.min(first, half);
      n = Math.max(1, n);
    }
  }
  return Math.min(n, letters - 1 || 1);
}

// Character ranges that must never be emphasized: URLs, DOIs, emails —
// including brace-grouped academic address lists like {a, b.c, d}@psu.edu.
const LINKLIKE =
  /(?:https?:\/\/|www\.|doi\.org\/|ftp:\/\/)[^\s]+|\{[^{}]*\}@[^\s@]+\.[A-Za-z]{2,}|[^\s@{}]+@[^\s@]+\.[A-Za-z]{2,}/g;

function linkRanges(text) {
  const ranges = [];
  for (const m of text.matchAll(LINKLIKE)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/**
 * Convert a text-layer string into a list of parts:
 *   {text, bold: true|false}
 * wordIndex/saccade: only every Nth word gets emphasis (saccade=1 → all).
 * Returns null when the text shouldn't be touched at all (math-heavy spans).
 * The running word counter is returned so callers can thread it across spans.
 *
 * `join` stitches a word that PDF.js split across spans (a font change inside
 * a word: TeX accent composition, an italic math letter). `join.head` is the
 * part of this span's FIRST word that already appeared at the end of the
 * previous span — it is a continuation, so it gets no emphasis of its own and
 * does not advance the word counter. `join.tail` is the part of this span's
 * LAST word that continues into the next span — the prefix is sized against
 * the whole word, not the fragment.
 */
export function emphasizeParts(text, opts = {}, startWordIndex = 0, join = {}) {
  if (!text || MATHY(text)) return null;
  // A space-free fragment containing a path/address separator is the
  // continuation of a wrapped URL or email — leave it whole. EXCEPT the
  // slashed-word-pair prose pattern ("and/or", "read/write",
  // "input/output."): exactly two plain words around ONE slash, with
  // optional sentence punctuation, is text, not a path.
  const frag = text.trim();
  if (
    /^\S+$/.test(frag) &&
    /[/@]/.test(frag) &&
    !/^[A-Za-zÀ-ɏ'’-]+\/[A-Za-zÀ-ɏ'’-]+[.,;:]?$/.test(frag)
  ) {
    return null;
  }
  const { saccade = 1 } = opts;
  // Font-only mode: the span is still processed (masked + re-rendered, so a
  // bundled reading face applies), but nothing is emphasized.
  const noEmphasis = opts.emphasisMode === "none";
  const links = linkRanges(text);
  const parts = [];
  let wordIndex = startWordIndex;
  let offset = 0;
  const segs = segment(text);
  // A join only applies when the fragment really is at the span's edge: a
  // leading space means the word did not carry over.
  const firstWord = segs.findIndex((x) => x.isWord);
  const lastWord = segs.length - 1;
  const headJoin = join?.head && firstWord === 0;
  const tailJoin = join?.tail && segs[lastWord]?.isWord ? join.tail : "";
  for (const [segIndex, seg] of segs.entries()) {
    const start = offset;
    offset += seg.text.length;
    // Only plain Latin words get emphasis: Greek letters, math symbols,
    // identifiers with digits, URLs/emails, etc. are kept exactly as the
    // author set them. ALL-CAPS words (acronyms — "NAS", "AMF", "USENIX")
    // are labels, not prose: a bolded prefix reads as noise, so they keep
    // their uniform weight.
    const inLink = links.some(([a, b]) => start < b && offset > a);
    if (
      noEmphasis ||
      !seg.isWord ||
      inLink ||
      !PLAIN_WORD.test(seg.text) ||
      /^[A-ZÀ-Þ]{2,}$/.test(seg.text)
    ) {
      parts.push({ text: seg.text, bold: false });
      continue;
    }
    // Continuation of a word the previous span began: already counted there,
    // and its emphasis (if any) was applied there.
    if (headJoin && segIndex === firstWord) {
      parts.push({ text: seg.text, bold: false });
      continue;
    }
    const isTarget = saccade <= 1 || wordIndex % saccade === 0;
    wordIndex++;
    if (!isTarget) {
      parts.push({ text: seg.text, bold: false });
      continue;
    }
    const whole = segIndex === lastWord ? seg.text + tailJoin : seg.text;
    // The prefix is a fraction of the word as READ, so it is measured on the
    // letters, not the characters: a ligature is one character standing for two
    // or three, and sizing against the raw string would short the prefix on
    // every word containing one. Words without a ligature take the identical
    // path they always did - expandLigatures is a no-op on them, so no existing
    // count moves.
    const letters = expandLigatures(whole);
    let n =
      letters === whole
        ? Math.min(emphasisLength(whole, opts), seg.text.length)
        : Math.min(
            charsForLetters(whole, emphasisLength(letters, opts)),
            seg.text.length,
          );
    // Never end the prefix on an accent glyph: the accent paints over the
    // NEXT letter, which is not bolded, so a bold accent sits on a light stem.
    while (n > 1 && ACCENT_ONLY.test(seg.text[n - 1])) n--;
    if (n > 0) parts.push({ text: seg.text.slice(0, n), bold: true });
    if (n < seg.text.length) parts.push({ text: seg.text.slice(n), bold: false });
  }
  return { parts, wordIndex };
}
