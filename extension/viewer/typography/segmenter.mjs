// Pure word segmentation + emphasis-point computation. No DOM, no Chrome APIs,
// so it runs under `node --test` as-is.
//
// The emphasis length is a user-configurable fraction of the word (default 0.4),
// optionally capped at the end of the first syllable ("smart mode"). It is NOT
// the fixed fractional table associated with the patented method — see TRADEMARKS.md.

const WORD_SEGMENTER = new Intl.Segmenter("en", { granularity: "word" });

const VOWELS = /[aeiouyàâäéèêëîïôöùûüAEIOUY]/;

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
  const out = [];
  for (const s of WORD_SEGMENTER.segment(text)) {
    out.push({ text: s.segment, isWord: s.isWordLike === true });
  }
  return out;
}

/**
 * Index of the end of the first syllable: the first vowel cluster plus any
 * single trailing consonant (naive but stable heuristic).
 */
function firstSyllableEnd(word) {
  let i = 0;
  while (i < word.length && !VOWELS.test(word[i])) i++;
  while (i < word.length && VOWELS.test(word[i])) i++;
  if (i < word.length && !VOWELS.test(word[i])) i++;
  return Math.min(i, word.length);
}

/**
 * Number of leading characters to embolden for `word`.
 * smartSyllable (the default mode): exactly the first syllable.
 * Otherwise fraction: 0..1 of the word length (rounded, min 1).
 */
export function emphasisLength(word, { fraction = 0.4, smartSyllable = false } = {}) {
  const letters = word.length;
  if (letters === 0) return 0;
  if (letters === 1) return 1;
  const n = smartSyllable
    ? Math.max(1, firstSyllableEnd(word))
    : Math.max(1, Math.round(letters * fraction));
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
 */
export function emphasizeParts(text, opts = {}, startWordIndex = 0) {
  if (!text || MATHY(text)) return null;
  const { saccade = 1 } = opts;
  const links = linkRanges(text);
  const parts = [];
  let wordIndex = startWordIndex;
  let offset = 0;
  for (const seg of segment(text)) {
    const start = offset;
    offset += seg.text.length;
    // Only plain Latin words get emphasis: Greek letters, math symbols,
    // identifiers with digits, URLs/emails, etc. are kept exactly as the
    // author set them.
    const inLink = links.some(([a, b]) => start < b && offset > a);
    if (!seg.isWord || inLink || !/^[A-Za-zÀ-ɏ'’-]+$/.test(seg.text)) {
      parts.push({ text: seg.text, bold: false });
      continue;
    }
    const isTarget = saccade <= 1 || wordIndex % saccade === 0;
    wordIndex++;
    if (!isTarget) {
      parts.push({ text: seg.text, bold: false });
      continue;
    }
    const n = emphasisLength(seg.text, opts);
    if (n > 0) parts.push({ text: seg.text.slice(0, n), bold: true });
    if (n < seg.text.length) parts.push({ text: seg.text.slice(n), bold: false });
  }
  return { parts, wordIndex };
}
