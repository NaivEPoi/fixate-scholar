import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestMatch,
  referenceQuery,
  titleScore,
} from "../../extension/viewer/references/scholar.mjs";

// The three citations of the ProVerif manual's "[AF01, RS11, ABF17]" — the
// bracket whose cards all showed the same, wrong paper. Titles as the parser
// reads them out of the PDF (TeX accent composition and all).
const AF01 = {
  label: "AF01",
  title: "Mobile values, new names, and secure communication",
  surname: "Abadi",
  year: "2001",
};
const RS11 = {
  label: "RS11",
  title: "Applied pi calculus",
  surname: "Ryan",
  year: "2011",
};

// A result block as readResult() returns it (only the scored fields matter).
const result = (title, byline) => ({ title, byline });

test("referenceQuery adds the first author and the year to the title", () => {
  assert.equal(referenceQuery(RS11), "Applied pi calculus Ryan 2011");
});

test("referenceQuery does not repeat an author or year already in the title", () => {
  const ref = { title: "Ryan's 2011 survey of applied pi", surname: "Ryan", year: "2011" };
  assert.equal(referenceQuery(ref), "Ryan's 2011 survey of applied pi");
});

test("referenceQuery drops the loose accents TeX composition leaves behind", () => {
  const ref = { title: "Certi ed email", surname: "Mart´ın", year: null };
  assert.equal(referenceQuery(ref), "Certi ed email Martın");
});

test("referenceQuery accepts a bare title string and falls back to the raw entry", () => {
  assert.equal(referenceQuery("just a title"), "just a title");
  assert.equal(referenceQuery({ raw: "unparsed entry text", year: null }), "unparsed entry text");
});

test("titleScore is symmetric — a superset title is not a match", () => {
  // Containment scored this 1.0, which is how the wrong paper got in.
  const s = titleScore(
    "Applied pi calculus",
    "Simulation based security in the applied pi calculus",
  );
  assert.ok(s < 0.6, `expected a middling score, got ${s}`);
  assert.equal(titleScore("Applied pi calculus", "Applied pi calculus"), 1);
});

test("a longer paper that merely contains the title's words is rejected", () => {
  const results = [
    result("Simulation based security in the applied pi calculus", "S Delaune, S Kremer, O Pereira - Cryptology ePrint Archive, 2009"),
    result("Automated verification of selected equivalences for security protocols", "B Blanchet, M Abadi… - Journal of Logic and…, 2008"),
  ];
  assert.equal(bestMatch(results, RS11), null);
});

test("the cited work wins even when it is not Scholar's first hit", () => {
  const right = result("Applied pi calculus", "MD Ryan, B Smyth - Formal Models and Techniques…, 2011");
  const results = [
    result("Simulation based security in the applied pi calculus", "S Delaune, S Kremer, O Pereira - …, 2009"),
    right,
  ];
  assert.equal(bestMatch(results, RS11), right);
});

test("an exact title with the right author and year is accepted", () => {
  const hit = result(
    "Mobile values, new names, and secure communication",
    "M Abadi, C Fournet - Proceedings of the 28th ACM SIGPLAN-SIGACT…, 2001",
  );
  assert.equal(bestMatch([hit], AF01), hit);
});

test("diacritics do not block the author check", () => {
  const ref = { title: "Prudent engineering practice for cryptographic protocols", surname: "Abadi", year: "1996" };
  const hit = result(
    "Prudent engineering practice for cryptographic protocols",
    "M Abadi, RM Needham - IEEE transactions on Software Engineering, 1996",
  );
  assert.equal(bestMatch([hit], ref), hit);
});

test("a reprint dated a year off the entry still matches", () => {
  const ref = { title: "A logic of authentication", surname: "Burrows", year: "1989" };
  const hit = result(
    "A logic of authentication",
    "M Burrows, M Abadi, RM Needham - Proceedings of the Royal Society…, 1990",
  );
  assert.equal(bestMatch([hit], ref), hit);
});

test("a hyphenated surname still matches the byline", () => {
  const ref = { title: "Fast probabilistic algorithms", surname: "Ben-Or", year: "1994" };
  const hit = result("Fast probabilistic algorithms", "M Ben-Or - Proceedings of FOCS, 1994");
  assert.equal(bestMatch([hit], ref), hit);
});

test("an unrelated result is never returned just because it is the only one", () => {
  assert.equal(bestMatch([result("Something else entirely", "X Y - 1999")], AF01), null);
  assert.equal(bestMatch([], AF01), null);
});

