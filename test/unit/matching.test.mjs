import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestMatch,
  isSearchable,
  queryVariants,
  referenceQuery,
  scoreResult,
  titleScore,
} from "../../extension/viewer/references/matching.mjs";

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


// ── recall: the lookups that failed while the paper was on Scholar all along ──

test("a link in the entry is not a search term", () => {
  const ref = {
    title: "boofuzz: Network protocol fuzzing for humans. https://github.com/jtpereyda/boofuzz",
    surname: null,
    year: null,
  };
  assert.equal(referenceQuery(ref), "boofuzz: Network protocol fuzzing for humans.");
});

test("a DOI is not a search term either", () => {
  const ref = { title: "Prudent engineering practice. https://doi.org/10.1109/32.481513", year: null };
  assert.equal(referenceQuery(ref), "Prudent engineering practice.");
});

test("a name plus a link is not a paper and is never looked up", () => {
  assert.equal(isSearchable({ title: "Amarisoft. https://www.amarisoft.com/." }), false);
  assert.equal(isSearchable({ title: "Free5gc. https://www.free5gc.org/." }), false);
  // A real title that merely ends in a link still gets its lookup.
  assert.equal(
    isSearchable({ title: "boofuzz: Network protocol fuzzing for humans. https://github.com/x/y" }),
    true,
  );
  // And a short title with no link is a real, findable work.
  assert.equal(isSearchable({ title: "Applied cryptography" }), true);
});

test("the query variants fall back to the bare title, and only when that differs", () => {
  assert.deepEqual(queryVariants({ title: "Applied pi calculus", surname: "Ryan", year: "2011" }), [
    "Applied pi calculus Ryan 2011",
    "Applied pi calculus",
  ]);
  // Nothing to add -> nothing to retry.
  assert.deepEqual(queryVariants({ title: "Applied pi calculus" }), ["Applied pi calculus"]);
});

test("a ligature the text layer dropped does not lose the paper", () => {
  // "Certified email" comes out of some PDFs as "Certi ed email": the fi
  // ligature has no mapping and the glyph is simply gone.
  assert.ok(titleScore("Certi ed email", "Certified email") > 0.9);
  assert.ok(titleScore("E cient veri cation of protocols", "Efficient verification of protocols") > 0.9);
  const ref = { title: "Certi ed email with a light on-line trusted third party", surname: "Abadi", year: "2002" };
  const hit = result(
    "Certified email with a light on-line trusted third party: Design and implementation",
    "M Abadi, N Glew, B Horne, B Pinkas - Proceedings of the 11th international…, 2002",
  );
  assert.equal(bestMatch([hit], ref), hit);
});

test("a ligature repair cannot invent a match", () => {
  // "certi" + "ed" only ever becomes a word the OTHER title already contains.
  assert.ok(titleScore("Certi ed email", "Something else entirely") < 0.2);
});

test("a title Scholar printed truncated still matches", () => {
  const ref = {
    title: "Automated verification of selected equivalences for security protocols",
    surname: "Blanchet",
    year: "2008",
  };
  const hit = result(
    "Automated verification of selected equivalences for security…",
    "B Blanchet, M Abadi, C Fournet - The Journal of Logic and Algebraic…, 2008",
  );
  assert.equal(bestMatch([hit], ref), hit);
});

test("an accented surname the text layer cut short still matches the byline", () => {
  // "Fiterău-Broştean" reaches the parser as "Bro": TeX accent composition
  // splits the name at the accented letter.
  const ref = {
    title: "Model learning and model checking of ssh implementations",
    surname: "Bro",
    year: "2017",
  };
  const hit = result(
    "Model learning and model checking of SSH implementations",
    "P Fiterau-Brostean, T Lenaerts, E Poll… - Proceedings of the 24th…, 2017",
  );
  assert.equal(bestMatch([hit], ref), hit);
});

test("an initial in the byline is not an author match", () => {
  // The author test matches a surname PREFIX (for the names the text layer
  // cuts short), which must not degrade into "shares a first letter with an
  // initial": "B Smyth" cannot corroborate a reference by Bruck.
  const hit = result("Applied pi calculus", "MD Ryan, B Smyth - Formal Models and Techniques…, 2011");
  assert.equal(scoreResult(hit, { title: "Applied pi calculus", surname: "Bruck" }).authorOk, false);
  assert.equal(scoreResult(hit, { title: "Applied pi calculus", surname: "Ryan" }).authorOk, true);
  // A cut-short surname is still a prefix of the real one.
  assert.equal(
    scoreResult(result("x", "P Fiterau-Brostean, T Lenaerts - …, 2017"), { title: "x", surname: "Bro" })
      .authorOk,
    true,
  );
});

test("the year may sit anywhere in the byline", () => {
  const ref = { title: "Touching the untouchables", surname: "Kim", year: "2019" };
  const hit = result(
    "Touching the untouchables",
    "H Kim, J Lee, E Lee - 2019 IEEE Symposium on Security and Privacy",
  );
  assert.equal(bestMatch([hit], ref), hit);
});

test("the venue is not part of the search", () => {
  // A parsed title that still carries its venue tail: the paper is indexed
  // under its title and authors, so the tail is only competing terms.
  assert.equal(
    referenceQuery({ title: "Specification for DNS over Transport Layer Security (TLS). RFC 7858, May 2016", surname: "Hu", year: "2016" }),
    "Specification for DNS over Transport Layer Security (TLS) Hu 2016",
  );
  assert.equal(
    referenceQuery({ title: "Applied pi calculus. In Formal Models and Techniques", surname: "Ryan", year: "2011" }),
    "Applied pi calculus Ryan 2011",
  );
  // …but a title that merely CONTAINS such a word keeps it.
  assert.equal(
    referenceQuery({ title: "In search of an understandable consensus algorithm", surname: "Ongaro" }),
    "In search of an understandable consensus algorithm Ongaro",
  );
});

test("BibTeX casing braces are not search terms", () => {
  assert.equal(
    referenceQuery({ title: "{DoLTEst}: In-depth downlink negative testing framework for {LTE} devices", surname: "Park", year: "2022" }),
    "DoLTEst: In-depth downlink negative testing framework for LTE devices Park 2022",
  );
});
