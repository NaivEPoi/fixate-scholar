// Words carrying a typographic ligature must be emphasized like any other word.
//
// R25/G2: the ligature codepoints (U+FB00-FB06 — ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ) live in
// Alphabetic Presentation Forms, outside the Latin range PLAIN_WORD accepted, so
// every word containing one was rejected as "not a plain Latin word" and left
// with NO emphasis at all. It was invisible on the papers whose producer encodes
// fi as two characters, and hit 62 of 63 such words on one that does not.
//
// The prefix is also measured on the LETTERS rather than the characters: a
// ligature is one character standing for two or three, so sizing against the raw
// string shorted the prefix on exactly these words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emphasizeParts } from "../../extension/viewer/typography/segmenter.mjs";

const LIG = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl" };

/** "[eﬃc]ient" — the emphasis, marked, as the reader would see it. */
const marked = (word) => {
  const { parts } = emphasizeParts(word, {}, 0, null, []);
  return parts.map((p) => (p.bold ? `[${p.text}]` : p.text)).join("");
};

/** The same, with each ligature spelled out, so the two forms are comparable. */
const asLetters = (word) =>
  marked(word).replace(/[ﬀ-ﬄ]/g, (c) => LIG[c]);

// Every pair: the plain spelling, and the same word as a PDF text layer built
// from a ligature font delivers it.
const PAIRS = [
  ["efficient", "eﬃcient"],
  ["different", "diﬀerent"],
  ["workflow", "workﬂow"],
  ["significantly", "signiﬁcantly"],
  ["firewalls", "ﬁrewalls"],
  ["classification", "classiﬁcation"],
  ["specific", "speciﬁc"],
  ["fluffy", "ﬂuﬀy"],
  ["office", "oﬃce"],
  ["shuffle", "shuﬄe"],
];

for (const [plain, ligated] of PAIRS) {
  test(`a ligature word is emphasized at all: ${ligated}`, () => {
    const { parts } = emphasizeParts(ligated, {}, 0, null, []);
    assert.ok(
      parts.some((p) => p.bold),
      `"${ligated}" got no emphasis — PLAIN_WORD rejected the ligature`,
    );
  });

  test(`the prefix is sized on letters, not characters: ${ligated}`, () => {
    // The emphasized prefix, spelled out, must match the plain word's to within
    // one letter. Exactness is not always reachable: a ligature is a single
    // glyph, so when the target lands inside one the prefix has to stop just
    // before or just after it.
    const boldLetters = (s) => (s.match(/\[([^\]]*)\]/)?.[1] ?? "").length;
    const drift = Math.abs(boldLetters(asLetters(ligated)) - boldLetters(marked(plain)));
    assert.ok(
      drift <= 1,
      `${asLetters(ligated)} vs ${marked(plain)} — prefix differs by ${drift} letters`,
    );
  });
}

test("a ligature-only run is still not a word", () => {
  const { parts } = emphasizeParts("ﬁ", {}, 0, null, []);
  // One character, so the single-character rule applies rather than the
  // "reject it" path — what matters is that nothing throws and the text
  // survives intact.
  assert.equal(parts.map((p) => p.text).join(""), "ﬁ");
});

test("words with no ligature are untouched by the new path", () => {
  // The guard that keeps every existing corpus count stable: expandLigatures is
  // a no-op on ordinary words, so they must take the identical code path they
  // always did.
  for (const w of ["the", "attention", "mechanism", "transformer", "naive"]) {
    const { parts } = emphasizeParts(w, {}, 0, null, []);
    const bold = parts.find((p) => p.bold);
    assert.ok(bold && bold.text.length >= 1 && bold.text.length < w.length);
  }
});
