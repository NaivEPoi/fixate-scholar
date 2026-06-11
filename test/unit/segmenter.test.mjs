import { test } from "node:test";
import assert from "node:assert/strict";
import {
  segment,
  emphasisLength,
  emphasizeParts,
} from "../../extension/viewer/typography/segmenter.mjs";

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

test("emphasisLength default fraction 0.4", () => {
  assert.equal(emphasisLength("a"), 1);
  assert.equal(emphasisLength("to"), 1); // round(2*0.4)=1
  assert.equal(emphasisLength("the"), 1); // round(1.2)=1
  assert.equal(emphasisLength("word"), 2); // round(1.6)=2
  assert.equal(emphasisLength("reading"), 3); // round(2.8)=3
});

test("emphasisLength never bolds the whole multi-char word", () => {
  assert.equal(emphasisLength("ab", { fraction: 1 }), 1);
  assert.equal(emphasisLength("abcdef", { fraction: 1 }), 5);
});

test("emphasisLength smart syllable bolds exactly the first syllable", () => {
  // "comprehension": first syllable "com" (consonant, vowel, one consonant)
  assert.equal(emphasisLength("comprehension", { smartSyllable: true }), 3);
  // "reading": "read" (r + ea cluster + d)
  assert.equal(emphasisLength("reading", { smartSyllable: true }), 4);
  // syllable mode ignores the fraction entirely
  assert.equal(
    emphasisLength("comprehension", { fraction: 0.6, smartSyllable: true }),
    3,
  );
  // never the whole word
  assert.equal(emphasisLength("the", { smartSyllable: true }), 2);
});

test("URLs, DOIs, and emails are never emphasized", () => {
  const url = emphasizeParts("code at https://github.com/SyNSec-den/5GBaseChecker today");
  const urlBold = url.parts.filter((p) => p.bold).map((p) => p.text);
  assert.deepEqual(urlBold, ["co", "a", "to"]); // code, at, today only
  const email = emphasizeParts("contact yilud@psu.edu for details");
  const emailBold = email.parts.filter((p) => p.bold).map((p) => p.text);
  assert.ok(!emailBold.some((t) => /yilud|psu|edu/.test(t)));
  const doi = emphasizeParts("the published version is available at doi.org/10.1145/3576915 online");
  assert.ok(!doi.parts.some((p) => p.bold && /doi|org/.test(p.text)));
  // round-trip safety with links present
  assert.equal(url.parts.map((p) => p.text).join(""), "code at https://github.com/SyNSec-den/5GBaseChecker today");
});

test("non-Latin and mixed words are never emphasized", () => {
  const greek = emphasizeParts("the αβγ decay");
  assert.deepEqual(
    greek.parts.filter((p) => p.bold).map((p) => p.text),
    ["t", "de"],
  );
  const mixed = emphasizeParts("see x2 and H2O here");
  const bolded = mixed.parts.filter((p) => p.bold).map((p) => p.text);
  assert.ok(!bolded.some((t) => /\d/.test(t)));
  assert.ok(bolded.includes("s")); // "see"
});

test("emphasizeParts splits words into bold prefix + rest", () => {
  const { parts } = emphasizeParts("reading guide");
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
  assert.deepEqual(boldWords, ["o", "th"]); // words 0 and 2
});

test("emphasizeParts leaves numbers unbolded", () => {
  const { parts } = emphasizeParts("in 2017 we");
  const bolded = parts.filter((p) => p.bold).map((p) => p.text);
  assert.deepEqual(bolded, ["i", "w"]);
});
