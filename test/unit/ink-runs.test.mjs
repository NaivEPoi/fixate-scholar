// A span whose text runs in several colours — a latexdiff line: black, struck
// red, added blue within one text item — is coloured per character from the
// canvas ink under each glyph (engine.mjs inkRuns). colourRuns turns those
// samples into runs; the cases are what per-glyph sampling actually returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { colourRuns, inkColour } from "../../extension/viewer/typography/ink-runs.mjs";

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

test("one faint letter in a colour of its own keeps it", () => {
  // A struck single letter "a" (red) on a line that also has blue: faint, but
  // not a shade of the blue, so not a blend.
  const samples = [...chars("BB K"), { space: true }, { color: RED, n: 10 }];
  assert.deepEqual(colourRuns(samples), [{ from: 0, to: 2, color: BLUE }, { from: 5, to: 6, color: RED }]);
});

// inkColour reads summed channel darkness (255 - value, over the pixels read).
// `ink(rgb, k)`: the sums for k pixels of solid ink of that colour.
const ink = ([r, g, b], k = 100) => [(255 - r) * k, (255 - g) * k, (255 - b) * k];

test("solid ink colours come back exactly", () => {
  assert.deepEqual(inkColour(ink([255, 0, 0]), 60), [255, 0, 0]);
  assert.deepEqual(inkColour(ink([0, 0, 255]), 60), [0, 0, 255]);
  assert.deepEqual(inkColour(ink([178, 0, 0]), 60), [178, 0, 0]);
  assert.deepEqual(inkColour(ink([0, 204, 0]), 60), [0, 204, 0]);
});

test("black under subpixel tints is black: the channel sums come out level", () => {
  // A black glyph's two tinted edges, blue-ish and orange-ish, plus its core.
  const d = [0, 1, 2].map((c) => ink([0, 0, 0])[c] + ink([0, 60, 200], 3)[c] + ink([200, 60, 0], 3)[c]);
  assert.equal(inkColour(d, 60), null);
  assert.equal(inkColour(ink([128, 128, 128]), 60), null); // grey text: neutral
});

test("an edge's tint left over is not ink: green strictly between red and blue", () => {
  // Measured on plain black text, a thin "i" read alone.
  assert.equal(inkColour(ink([185, 54, 0]), 60), null);
  assert.equal(inkColour(ink([0, 33, 65]), 60), null);
  assert.equal(inkColour(ink([148, 91, 0]), 60), null);
});

test("over a letter or a window, a tint-shaped colour is never ink, however bright", () => {
  assert.equal(inkColour(ink([0, 146, 234]), 120, true), null); // measured on a black "l"
  assert.equal(inkColour(ink([255, 165, 0]), 120, true), null);
});

test("bright ink in a tint's hues is kept over a whole span", () => {
  assert.deepEqual(inkColour(ink([255, 165, 0]), 60), [255, 165, 0]); // orange
  // Goldenrod: its blue floor does not survive the recovery, the hue does.
  assert.deepEqual(inkColour(ink([218, 165, 32]), 60), [213, 152, 0]);
});

test("the chroma a colour must reach", () => {
  assert.deepEqual(inkColour(ink([0, 0, 90]), 60), [0, 0, 90]); // navy, whole span
  assert.equal(inkColour(ink([0, 0, 90]), 120), null); // too dark for a letter alone
});

test("punctuation keeps the colour before it only when it reads that colour", () => {
  const P = (color) => ({ punct: true, color, n: 30 });
  // "data," struck red: the comma reads red too.
  assert.deepEqual(colourRuns([...chars("RRRR"), P(RED)]), { uniform: RED });
  // "4," : a green link digit, then a black comma.
  const GREEN = "rgb(0, 200, 0)";
  assert.deepEqual(colourRuns([...chars("KK "), { color: GREEN, n: 40 }, P(null)]), [{ from: 3, to: 4, color: GREEN }]);
  // A tinted full stop in black text stays black.
  assert.deepEqual(colourRuns([...chars("KKK"), P("rgb(0, 115, 215)")]), []);
});

test("opening punctuation takes the colour of the letter after it", () => {
  const P = (color) => ({ punct: true, color, n: 30 });
  // "KK (BB)": the bracket opening a blue word reads blue, and so does the closer.
  assert.deepEqual(colourRuns([...chars("KK "), P(BLUE), ...chars("BB"), P(BLUE)]), [{ from: 3, to: 7, color: BLUE }]);
  // ...but not when it reads black itself.
  assert.deepEqual(colourRuns([...chars("KK "), P(null), ...chars("BB")]), [{ from: 4, to: 6, color: BLUE }]);
});
