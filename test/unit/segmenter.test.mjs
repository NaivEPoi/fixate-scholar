import { test } from "node:test";
import assert from "node:assert/strict";
import {
  segment,
  syllableBoundaries,
  emphasisLength,
  emphasizeParts,
} from "../../extension/viewer/typography/segmenter.mjs";

const FRACTION = { emphasisMode: "fraction" };

test("segment covers input exactly", () => {
  const text = "The quick brown-fox, jumps (over) 12 dogs.";
  const joined = segment(text).map((s) => s.text).join("");
  assert.equal(joined, text);
});

test("segment marks words vs punctuation", () => {
  const segs = segment("Hello, world!");
  const words = segs.filter((s) => s.isWord).map((s) => s.text);
  assert.deepEqual(words, ["Hello", "world"]);
});

test("syllableBoundaries yields cumulative syllable ends", () => {
  assert.deepEqual(syllableBoundaries("comprehension"), [3, 7, 9, 13]);
  assert.deepEqual(syllableBoundaries("reading"), [4, 6, 7]);
  assert.deepEqual(syllableBoundaries("the"), [3]);
});

test("emphasisLength dynamic (default): whole syllables up to half the word", () => {
  // "comprehension" (13, half=7): syllables end at 3,7,9,13 → 7 ("compreh")
  assert.equal(emphasisLength("comprehension"), 7);
  // "reading" (7, half=4): 4 fits exactly ("read")
  assert.equal(emphasisLength("reading"), 4);
  // short words: first syllable exceeds half → capped at half
  assert.equal(emphasisLength("the"), 2);
  assert.equal(emphasisLength("to"), 1);
  assert.equal(emphasisLength("a"), 1);
  // never more than half (rounded up), even for very long words
  assert.ok(emphasisLength("internationalization") <= 10);
});

test("emphasisLength fraction mode", () => {
  assert.equal(emphasisLength("a", FRACTION), 1);
  assert.equal(emphasisLength("to", FRACTION), 1); // round(2*0.4)=1
  assert.equal(emphasisLength("the", FRACTION), 1); // round(1.2)=1
  assert.equal(emphasisLength("word", FRACTION), 2); // round(1.6)=2
  assert.equal(emphasisLength("reading", FRACTION), 3); // round(2.8)=3
});

test("emphasisLength never bolds the whole multi-char word", () => {
  assert.equal(emphasisLength("ab", { emphasisMode: "fraction", fraction: 1 }), 1);
  assert.equal(emphasisLength("abcdef", { emphasisMode: "fraction", fraction: 1 }), 5);
  assert.equal(emphasisLength("ab"), 1);
});

test("emphasisLength syllable mode: exactly the first syllable", () => {
  assert.equal(emphasisLength("comprehension", { emphasisMode: "syllable" }), 3);
  assert.equal(emphasisLength("reading", { emphasisMode: "syllable" }), 4);
  // legacy boolean still maps to syllable mode
  assert.equal(emphasisLength("comprehension", { smartSyllable: true }), 3);
  // never the whole word
  assert.equal(emphasisLength("the", { emphasisMode: "syllable" }), 2);
});

test("URLs, DOIs, and emails are never emphasized", () => {
  const url = emphasizeParts("code at https://github.com/SyNSec-den/5GBaseChecker today");
  const urlBold = url.parts.filter((p) => p.bold).map((p) => p.text);
  assert.deepEqual(urlBold, ["co", "a", "tod"]); // code, at, today only
  const email = emphasizeParts("contact yilud@psu.edu for details");
  const emailBold = email.parts.filter((p) => p.bold).map((p) => p.text);
  assert.ok(!emailBold.some((t) => /yilud|psu|edu/.test(t)));
  const braced = emphasizeParts("authors {kjt5562, abdullah.ishtiaq, yiludong, hussain1}@psu.edu wrote this");
  const bracedBold = braced.parts.filter((p) => p.bold).map((p) => p.text);
  assert.deepEqual(bracedBold, ["aut", "wro", "th"]); // authors, wrote, this only
  const doi = emphasizeParts("the published version is available at doi.org/10.1145/3576915 online");
  assert.ok(!doi.parts.some((p) => p.bold && /doi|org/.test(p.text)));
  // round-trip safety with links present
  assert.equal(url.parts.map((p) => p.text).join(""), "code at https://github.com/SyNSec-den/5GBaseChecker today");
  // wrapped-URL continuation lines (no scheme, no spaces) are left whole
  assert.equal(emphasizeParts("com/SyNSec-den/5GBaseChecker."), null);
  assert.equal(emphasizeParts("ishtiaq@psu.edu"), null);
});

test("non-Latin and mixed words are never emphasized", () => {
  const greek = emphasizeParts("the αβγ decay");
  assert.deepEqual(
    greek.parts.filter((p) => p.bold).map((p) => p.text),
    ["th", "dec"],
  );
  const mixed = emphasizeParts("see x2 and H2O here");
  const bolded = mixed.parts.filter((p) => p.bold).map((p) => p.text);
  assert.ok(!bolded.some((t) => /\d/.test(t)));
  assert.ok(bolded.includes("se")); // "see"
});

test("emphasizeParts splits words into bold prefix + rest", () => {
  const { parts } = emphasizeParts("reading guide", FRACTION);
  assert.deepEqual(parts, [
    { text: "rea", bold: true },
    { text: "ding", bold: false },
    { text: " ", bold: false },
    { text: "gu", bold: true },
    { text: "ide", bold: false },
  ]);
});

test("emphasizeParts round-trips text", () => {
  const text = "Attention is all you need (Vaswani et al., 2017).";
  const { parts } = emphasizeParts(text);
  assert.equal(parts.map((p) => p.text).join(""), text);
});

test("emphasizeParts skips math-heavy spans", () => {
  assert.equal(emphasizeParts("x = 3.14 * (a+b)/2"), null);
  assert.equal(emphasizeParts("∑ αi → ∞"), null);
});

test("emphasizeParts saccade interval skips words across spans", () => {
  const first = emphasizeParts("one two", { saccade: 2 }, 0);
  const second = emphasizeParts("three four", { saccade: 2 }, first.wordIndex);
  const boldWords = [...first.parts, ...second.parts]
    .filter((p) => p.bold)
    .map((p) => p.text);
  assert.deepEqual(boldWords, ["on", "thr"]); // words 0 and 2
});

test("emphasizeParts leaves numbers unbolded", () => {
  const { parts } = emphasizeParts("in 2017 we");
  const bolded = parts.filter((p) => p.bold).map((p) => p.text);
  assert.deepEqual(bolded, ["i", "w"]);
});

test("ALL-CAPS words (acronyms) are never emphasized", () => {
  const { parts } = emphasizeParts("the NAS layer of AMF nodes");
  const bolded = parts.filter((p) => p.bold).map((p) => p.text);
  assert.ok(!bolded.some((t) => /^[A-Z]+$/.test(t) && t.length >= 2));
  assert.ok(bolded.includes("th")); // "the" still emphasized
  assert.ok(bolded.includes("lay")); // "layer" still emphasized
  // single-letter words and Capitalized words keep their emphasis
  const cap = emphasizeParts("Reading Guide");
  assert.ok(cap.parts.some((p) => p.bold));
});

test('emphasisMode "none" bolds nothing but keeps the text intact', () => {
  const text = "reading with a swapped font only";
  const { parts } = emphasizeParts(text, { emphasisMode: "none" });
  assert.ok(parts.every((p) => !p.bold));
  assert.equal(parts.map((p) => p.text).join(""), text);
});
