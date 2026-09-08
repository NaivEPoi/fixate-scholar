import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HyphenVocabulary,
  WordList,
  flowLines,
  joinLines,
} from "../../extension/viewer/copytext.mjs";

// Synthetic selected lines: a justified single column, 10 lines to the page.
// x/y are page fractions, exactly as selectedLines() produces them.
function col(texts, { page = 0, x0 = 0.1, x1 = 0.9, y0 = 0.2, step = 0.03 } = {}) {
  return texts.map((t, i) => {
    const spec = typeof t === "object" ? t : { text: t };
    return {
      text: spec.text,
      x0: spec.x0 ?? x0,
      x1: spec.x1 ?? x1,
      y: spec.y ?? y0 + i * step,
      page,
    };
  });
}

test("a paragraph's typeset lines become one line", () => {
  const out = flowLines(
    col([
      "Existing CSI-based indoor localization approaches fall",
      "largely into three categories: channel charting, which",
      { text: "aligned to physical coordinates using supervision.", x1: 0.62 },
    ]),
  );
  assert.equal(
    out,
    "Existing CSI-based indoor localization approaches fall largely into three " +
      "categories: channel charting, which aligned to physical coordinates using supervision.",
  );
});

test("a line-break hyphen goes; a compound's own hyphen stays", () => {
  assert.equal(joinLines("learns geometry-preserving latent representations sub-", "sequently aligned"), "learns geometry-preserving latent representations subsequently aligned");
  // The break falls ON a compound's hyphen: the piece before it is already
  // hyphenated, so the hyphen is the compound's, not a break artifact.
  assert.equal(joinLines("the state-of-", "the-art method"), "the state-of-the-art method");
  // Not a word break at all: next line starts with a capital or a digit.
  assert.equal(joinLines("a non-", "Gaussian channel"), "a non-Gaussian channel");
  assert.equal(joinLines("the 5-", "GHz band"), "the 5-GHz band");
  // No hyphen: one space, whatever the line break looked like.
  assert.equal(joinLines("first line", "second line"), "first line second line");
  // A soft hyphen is only ever a break opportunity.
  assert.equal(joinLines("infor­", "mation"), "information");
});

test("the document's own vocabulary settles the ambiguous hyphen", () => {
  // "well-known" and "information" are the SAME shape at a line break. Only
  // the rest of the document can tell them apart.
  const vocab = new HyphenVocabulary();
  vocab.learn([
    "a well-known result about information flow",
    "more information about the protocol",
  ]);
  assert.equal(joinLines("it is a well-", "known result", { document: vocab }), "it is a well-known result");
  assert.equal(joinLines("more infor-", "mation here", { document: vocab }), "more information here");
  // Without the vocabulary the shape-only guess joins, which is the common case.
  assert.equal(joinLines("it is a well-", "known result"), "it is a wellknown result");
});

test("the vocabulary does not learn from line-broken fragments", () => {
  const vocab = new HyphenVocabulary();
  vocab.learn(["a well-", "known result"]);
  // "well-" is the very thing under question; it must not become evidence.
  assert.equal(vocab.verdict("well", "known"), null);
});

test("the word list decides what the document cannot", () => {
  // The document is silent when the word appears exactly once, broken. The
  // general list then answers the user's rule literally: the hyphen stays when
  // it sits between two words.
  const words = new WordList();
  words.load("\nart\nbackground\nground\ninformation\nknown\nstate\nthrough\nput\nthroughput\nwell\n");
  const decide = { words };
  assert.equal(joinLines("a well-", "known result", decide), "a well-known result");
  assert.equal(joinLines("more infor-", "mation here", decide), "more information here");
  // A closed compound the list knows beats its two halves, which are also words.
  assert.equal(joinLines("the through-", "put of the link", decide), "the throughput of the link");
  assert.equal(joinLines("the back-", "ground noise", decide), "the background noise");
  // Neither reading is known — the shape guess stands, and it joins.
  assert.equal(joinLines("the base-", "band chip", decide), "the baseband chip");
});

test("the document outranks the word list", () => {
  // The list knows "well" and "known" separately; the DOCUMENT knows this
  // paper writes "wellknown" as one word. The paper wins.
  const document = new HyphenVocabulary();
  document.learn(["the wellknown result holds"]);
  const words = new WordList();
  words.load("\nknown\nwell\n");
  assert.equal(joinLines("a well-", "known result", { document, words }), "a wellknown result");
});

test("an unvendored word list is simply silent", () => {
  const words = new WordList();
  assert.equal(words.ready, false);
  assert.equal(words.verdict("well", "known"), null);
  assert.equal(joinLines("a well-", "known result", { words }), "a wellknown result");
});

test("a wrapped URL is rejoined without a space", () => {
  assert.equal(
    joinLines("We open-source it at: https://github.", "com/org/repo."),
    "We open-source it at: https://github.com/org/repo.",
  );
});

test("an indented line starts a new paragraph", () => {
  const out = flowLines(
    col([
      "the first paragraph runs to the right margin here and",
      { text: "ends short.", x1: 0.4 },
      { text: "The second paragraph is indented on its first line", x0: 0.12 },
      "and continues to the margin as well.",
    ]),
  );
  assert.deepEqual(out.split("\n"), [
    "the first paragraph runs to the right margin here and ends short.",
    "The second paragraph is indented on its first line and continues to the margin as well.",
  ]);
});

test("a hanging-indent list keeps one item per line", () => {
  // The item's continuation lines are INDENTED — the opposite of the
  // first-line-indent rule, and reading them as new paragraphs shreds the list.
  const out = flowLines(
    col([
      "• We design a framework based on differential testing",
      { text: "that infers the FSM of basebands.", x0: 0.12, x1: 0.5 },
      "• We develop a testing mechanism that takes FSMs as",
      { text: "inputs and finds deviating traces.", x0: 0.12, x1: 0.5 },
    ]),
  );
  assert.deepEqual(out.split("\n"), [
    "• We design a framework based on differential testing that infers the FSM of basebands.",
    "• We develop a testing mechanism that takes FSMs as inputs and finds deviating traces.",
  ]);
});

// A two-column page: both columns 38% of the page wide, gutter at the middle.
const LEFT = { x0: 0.08, x1: 0.46 };
const RIGHT = { x0: 0.54, x1: 0.92 };

test("a paragraph continues across a column break, a finished one does not", () => {
  // Left column's last line reaches the margin → the sentence carries over.
  const carries = flowLines([
    ...col(["a sentence that runs right up to the column margin"], { ...LEFT, y0: 0.8 }),
    ...col(["and finishes at the top of the next column."], { ...RIGHT, y0: 0.2 }),
  ]);
  assert.equal(
    carries,
    "a sentence that runs right up to the column margin and finishes at the top of the next column.",
  );
  const stops = flowLines([
    ...col(["the paragraph's last full line reaching the margin", { text: "and then it ended.", x1: 0.3 }], {
      ...LEFT,
      y0: 0.77,
    }),
    ...col(["A new one opens the next column and runs on to", "a second line of its own."], {
      ...RIGHT,
      y0: 0.2,
    }),
  ]);
  assert.deepEqual(stops.split("\n"), [
    "the paragraph's last full line reaching the margin and then it ended.",
    "A new one opens the next column and runs on to a second line of its own.",
  ]);
});

test("a hyphen carries the word across a column break", () => {
  const out = flowLines([
    ...col([{ text: "the measurement was inconclu-" }], { ...LEFT, y0: 0.8 }),
    ...col(["sive at that range."], { ...RIGHT, x1: 0.7, y0: 0.2 }),
  ]);
  assert.equal(out, "the measurement was inconclusive at that range.");
});

test("a running head or foot is never folded into a paragraph", () => {
  const out = flowLines(
    col([
      { text: "3064 33rd USENIX Security Symposium", y: 0.02, x1: 0.7 },
      "the body of the page starts here and runs to the margin",
      "and keeps going to the end of the paragraph.",
      { text: "USENIX Association", y: 0.97, x1: 0.4 },
    ]),
  );
  assert.deepEqual(out.split("\n"), [
    "3064 33rd USENIX Security Symposium",
    "the body of the page starts here and runs to the margin and keeps going to the end of the paragraph.",
    "USENIX Association",
  ]);
});

test("ragged-right text is not chopped at every short line", () => {
  // Nothing reaches a common right margin, so the short-line rule must not be
  // the one deciding — only a real indent or a wider gap ends a paragraph.
  const out = flowLines(
    col([
      { text: "a ragged line of text", x1: 0.5 },
      { text: "another ragged line here", x1: 0.62 },
      { text: "and a third one", x1: 0.44 },
    ]),
  );
  assert.equal(out, "a ragged line of text another ragged line here and a third one");
});

test("a single line, or none, survives untouched", () => {
  assert.equal(flowLines([]), "");
  assert.equal(flowLines(col(["just the one line"])), "just the one line");
});
