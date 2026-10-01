// A span whose text runs in several colours — a latexdiff line: black, struck
// red, added blue within one text item — is coloured per character from the
// canvas ink under each glyph (engine.mjs inkRuns). colourRuns turns those
// samples into runs; the cases are what per-glyph sampling actually returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { colourRuns } from "../../extension/viewer/typography/ink-runs.mjs";

const RED = "rgb(255, 0, 0)", BLUE = "rgb(0, 0, 255)";
/** One sample per character: K = black, R = red, B = blue, . = no ink, space = space. */
const chars = (pattern, n = 60) =>
  [...pattern].map((c) =>
    c === " " ? { space: true }
      : c === "." ? {}
        : { color: c === "R" ? RED : c === "B" ? BLUE : c === "r" ? "rgb(102, 19, 19)" : null, n: c === "r" ? 10 : n },
  );

test("black then red: one run for the red, none for the black", () => {
  assert.deepEqual(colourRuns(chars("KKK KK RRR RRRR")), [{ from: 7, to: 15, color: RED }]);
});

test("a colour change inside a word is kept where it falls", () => {
  // "mechanismto": the deleted space left the black and red words joined.
  assert.deepEqual(colourRuns(chars("KKKKKKKKKRR RRR")), [{ from: 9, to: 15, color: RED }]);
});

test("near colours are one colour, averaged", () => {
  const samples = [{ color: "rgb(250, 4, 0)", n: 60 }, { color: "rgb(240, 10, 6)", n: 60 }, { color: null, n: 60 }];
  assert.deepEqual(colourRuns(samples), [{ from: 0, to: 2, color: "rgb(245, 7, 3)" }]);
});

test("a span coloured throughout is uniform, with no runs", () => {
  assert.deepEqual(colourRuns(chars("RRR RR. RRRR")), { uniform: RED });
});

test("all neutral: nothing to wrap", () => {
  assert.deepEqual(colourRuns(chars("KKK KKK")), []);
});

test("a glyph with too little ink takes its own word's colour", () => {
  // The "i" of a red word, sampled from a couple of pixels, says nothing.
  assert.deepEqual(colourRuns(chars("KK R.RR")), [{ from: 3, to: 7, color: RED }]);
  assert.deepEqual(colourRuns(chars("RR .KK")), [{ from: 0, to: 2, color: RED }]);
});

test("a space joins a run only when both sides agree", () => {
  assert.deepEqual(colourRuns(chars("BB BB KK")), [{ from: 0, to: 5, color: BLUE }]);
});

test("one faint blended glyph at a colour change is not a colour of its own", () => {
  // "al.has": the full stop beside the first red letter read dark red.
  assert.deepEqual(colourRuns(chars("KKrRRR")), [{ from: 3, to: 6, color: RED }]);
});

test("red and blue in one span are two runs", () => {
  assert.deepEqual(colourRuns(chars("RRR BBB")), [{ from: 0, to: 3, color: RED }, { from: 4, to: 7, color: BLUE }]);
});
