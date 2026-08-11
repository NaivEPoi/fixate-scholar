// Face-name classification, against the names PDF.js actually resolves
// (`pdfPage.commonObjs.get(fontName).name` — a Type1 subset tag plus the base
// font name). The tables below are real names seen in LaTeX output.
//
// These exist because a missed face is invisible in the corpus harnesses: it
// does not throw, it just renders wrong. ITALIC_FONT matched only lowercase
// `cmti`, but LaTeX Type1 subset names are conventionally UPPERCASE, and its
// `-It(?![a-z])` alternative could not reach URW Nimbus's `-ReguItal` /
// `-MediItal` (no hyphen before `Ital`, and the lookahead rejected `-Ital`).
// Italic body prose in those faces rendered UPRIGHT under a bundled reading
// font. Both cases are listed for every Computer Modern alternative here for
// the same reason SPECIAL_FONT lists them: the case is not predictable — R18
// then fixed the same hazard in SPECIAL_FONT/BOLD_FONT (`CMBX`, `CMCSC`) and a
// name that simply had no matching alternative (`NimbusMonL-Regu`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOLD_FONT, ITALIC_FONT, SPECIAL_FONT } from "../../extension/viewer/typography/engine.mjs";

const ITALIC = [
  "ABCDEF+CMTI10", // Computer Modern text italic, Type1 subset (UPPERCASE)
  "ABCDEF+cmti10", // ... and the lowercase spelling of the same face
  "ABCDEF+CMTI12",
  "XX+NimbusRomNo9L-Ital", // URW Nimbus Roman — the standard LaTeX Times clone
  "XX+NimbusRomNo9L-ReguItal", // ... as embedded by pdftex
  "XX+NimbusRomNo9L-MediItal",
  "XX+NimbusSanL-ReguItal",
  "XX+Times-Italic",
  "XX+LinLibertineRI", // Libertine italic (two subfamily spellings)
  "XX+LinLibertineTI",
  "XX+SourceSerifPro-It",
  "XX+Helvetica-Oblique",
  "ABCDEF+CMMI10", // math italic, both cases
  "ABCDEF+cmmi10",
];

const UPRIGHT = [
  "XX+NimbusRomNo9L-Regu",
  "XX+NimbusRomNo9L-Medi",
  "ABCDEF+CMR10",
  "ABCDEF+cmr10",
  "ABCDEF+CMBX12", // bold, not italic
  "XX+Times-Roman",
  "XX+LinLibertineT",
  "XX+Arial-BoldMT",
  "XX+Italiana-Regular", // a real upright face whose name merely starts "Ital"
];

test("ITALIC_FONT matches real italic face names in both name cases", () => {
  for (const name of ITALIC) assert.ok(ITALIC_FONT.test(name), `should be italic: ${name}`);
});

test("ITALIC_FONT does not match upright faces", () => {
  for (const name of UPRIGHT) assert.ok(!ITALIC_FONT.test(name), `should not be italic: ${name}`);
});

test("italic TEXT faces stay processing candidates (not SPECIAL)", () => {
  // The whole point of re-applying fontStyle: an italic text face is emphasized
  // like any body face, so the swapped reading font must carry the italic over.
  for (const name of ["ABCDEF+CMTI10", "ABCDEF+cmti10", "XX+NimbusRomNo9L-ReguItal", "XX+LinLibertineTI"]) {
    assert.ok(!SPECIAL_FONT.test(name), `should not be special: ${name}`);
  }
});

// Three of these were missed until R18, each for the same reason as the italic
// gap — a name the alternatives could not spell:
//   `NimbusMonL-Regu`  URW Nimbus Mono, the standard LaTeX Courier clone. The
//                      monospace alternative was `Mono(?![a-z])`, and "MonL"
//                      contains no "Mono", so typewriter text in that face was
//                      treated as body and emphasized. Now `Mon[oL]`.
//   `CMBX12`/`CMCSC10` Computer Modern bold extended / small caps in UPPERCASE
//                      Type1 subset names, where only lowercase `cmbx`/`cmcsc`
//                      were listed. Both cases are now listed for every CM
//                      alternative.
test("SPECIAL_FONT keeps math, monospace, small-caps and bold faces out, in both cases", () => {
  for (const name of [
    "ABCDEF+CMMI10", "ABCDEF+cmmi10", "ABCDEF+CMSY7", "ABCDEF+cmsy7", "ABCDEF+CMEX10",
    "ABCDEF+cmex10", "ABCDEF+CMBSY10", "ABCDEF+cmbsy10", "ABCDEF+MSAM10", "ABCDEF+msam10",
    "ABCDEF+MSBM10", "ABCDEF+msbm10",
    "ABCDEF+CMTT10", "ABCDEF+cmtt10", "XX+Courier", "XX+NimbusMonL-Regu",
    "XX+NimbusMonL-Bold", "XX+NimbusMonL-ReguObli",
    "ABCDEF+CMCSC10", "ABCDEF+cmcsc10",
    "ABCDEF+CMBX12", "ABCDEF+cmbx12", "ABCDEF+CMBXTI10",
    "XX+NimbusRomNo9L-Medi", "XX+NimbusRomNo9L-MediItal",
  ]) {
    assert.ok(SPECIAL_FONT.test(name), `should be special: ${name}`);
  }
});

test("SPECIAL_FONT leaves body text faces alone, including Mon/SC near-misses", () => {
  // `Mon[oL](?![a-z])` must not swallow a proportional face whose name merely
  // starts "Mon", and the sans/serif Nimbus text faces share NimbusMonL's
  // 3-letter-suffix shape ("SanL"/"RomNo9L" vs "MonL").
  for (const name of [
    "XX+NimbusRomNo9L-Regu", "XX+NimbusSanL-Regu", "XX+NimbusRomNo9L-ReguItal",
    "ABCDEF+CMR10", "ABCDEF+cmr10", "ABCDEF+CMTI10", "XX+LinLibertineT",
    "XX+Montserrat-Regular", "XX+MonaSans", "XX+Monotype-Corsiva",
  ]) {
    assert.ok(!SPECIAL_FONT.test(name), `should not be special: ${name}`);
  }
});

test("BOLD_FONT recognizes bold display faces in both cases", () => {
  // The run-in heading detector reads BOLD_FONT, not SPECIAL_FONT, so its bold
  // alternatives have to stay in step with SPECIAL_FONT's bold line.
  for (const name of ["ABCDEF+CMBX12", "ABCDEF+cmbx12", "XX+NimbusRomNo9L-Medi", "XX+Arial-BoldMT"]) {
    assert.ok(BOLD_FONT.test(name), `should be bold: ${name}`);
  }
  for (const name of ["ABCDEF+CMR10", "XX+NimbusRomNo9L-Regu", "ABCDEF+CMTI10"]) {
    assert.ok(!BOLD_FONT.test(name), `should not be bold: ${name}`);
  }
});
