import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseReferences,
  findReferencesBody,
  guessTitle,
  findCitations,
  findInternalRefs,
  resolveCitation,
} from "../../extension/viewer/references/parser.mjs";

// Synthetic extractor output: single column, y decreasing down the page.
function lines(texts, { startY = 700, x = 50 } = {}) {
  return texts.map((t, i) => {
    const indent = typeof t === "object";
    return {
      text: indent ? t.text : t,
      x: indent ? x + 12 : x,
      y: startY - i * 12,
      page: 9,
      h: 10,
      column: 0,
    };
  });
}

const NUMERIC_DOC = lines([
  "5 Conclusion",
  "We rely on prior work [1] and [2, 3].",
  "References",
  "[1] A. Vaswani, N. Shazeer, N. Parmar, et al. Attention is all you need. In Advances in",
  { text: "Neural Information Processing Systems, pages 5998–6008, 2017." },
  "[2] J. Devlin, M. Chang, K. Lee, and K. Toutanova. BERT: Pre-training of deep bidirectional",
  { text: "transformers for language understanding. In NAACL, 2019." },
  "[3] T. Brown, B. Mann, N. Ryder, et al. Language models are few-shot learners. In NeurIPS,",
  { text: "2020." },
]);

const APA_DOC = lines([
  "Discussion",
  "As shown previously (Smith et al., 2020; Doe, 2019), results vary.",
  "References",
  "Doe, J. (2019). A study of reading behavior in digital environments. Journal of",
  { text: "Reading Research, 12(3), 45–67." },
  "Smith, A., Jones, B., & Lee, C. (2020). Fixation points and reading speed. Cognitive",
  { text: "Science Quarterly, 8(1), 1–19." },
]);

test("parses numeric-style references", () => {
  const entries = parseReferences(NUMERIC_DOC);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].number, 1);
  assert.match(entries[0].raw, /Attention is all you need/);
  assert.match(entries[1].raw, /transformers for language understanding/);
  assert.equal(entries[2].number, 3);
});

test("numeric entry title extraction", () => {
  const entries = parseReferences(NUMERIC_DOC);
  assert.equal(entries[0].title, "Attention is all you need");
});

test("keeps short numbered entries (>20-char length gate is marker-only)", () => {
  // A real but terse numbered reference ("[7] RFC 9110, page 106." — exactly
  // 20 chars after the marker) must survive; the length gate only guards the
  // marker-less indent/year grouping mode.
  const doc = lines([
    "References",
    "[1] A long enough first reference entry to pass any length gate, 2020.",
    "[2] RFC 9110, page 106.",
    "[3] RFC 9110, page 13.",
    "[4] Another sufficiently long reference entry for good measure, 2021.",
  ]);
  const entries = parseReferences(doc);
  assert.deepEqual(entries.map((e) => e.number), [1, 2, 3, 4]);
});

test("de-hyphenates wrapped lines", () => {
  const doc = lines([
    "References",
    "[1] A. Author. Understanding compre-",
    { text: "hension in reading. In CHI, 2021." },
    "[2] B. Author. Another paper title here. In CHI, 2022.",
    "[3] C. Author. Third paper title here. In CHI, 2023.",
  ]);
  const entries = parseReferences(doc);
  assert.match(entries[0].raw, /comprehension in reading/);
});

test("parses APA-style references via hanging indent", () => {
  const entries = parseReferences(APA_DOC);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].surname, "Doe");
  assert.equal(entries[0].year, "2019");
  assert.equal(entries[1].surname, "Smith");
});

test("APA title extraction", () => {
  const entries = parseReferences(APA_DOC);
  assert.equal(entries[0].title, "A study of reading behavior in digital environments");
});

test("returns empty when no references heading", () => {
  assert.deepEqual(parseReferences(lines(["Introduction", "Some text"])), []);
});

test("findReferencesBody returns heading and body lines, stopping at appendix", () => {
  const doc = [
    ...NUMERIC_DOC,
    ...lines(["A Appendix", "Appendix prose that should be processed normally."], { startY: 500 }),
  ];
  const { heading, body } = findReferencesBody(doc);
  assert.equal(heading.text, "References");
  assert.equal(body.length, 6); // the six bibliography lines only
  assert.ok(body.every((l) => !/Appendix/.test(l.text)));
});

test("a stray oversized punctuation glyph does not end the bibliography", () => {
  // A lone quotation mark can render heading-sized and split onto its own
  // extraction line mid-bibliography; the size cutoff must skip it.
  const doc = [
    ...lines([
      "References",
      "[1] A. Author. First reference entry with enough length. In CHI, 2021.",
    ]),
    { text: "“", x: 50, y: 640, page: 9, h: 14, column: 0 },
    ...lines(
      [
        "[2] B. Author. Second reference entry with enough length. In CHI, 2022.",
        "[3] C. Author. Third reference entry with enough length. In CHI, 2023.",
      ],
      { startY: 620 },
    ),
  ];
  const entries = parseReferences(doc);
  assert.deepEqual(entries.map((e) => e.number), [1, 2, 3]);
});

test("stops at appendix", () => {
  const doc = [
    ...NUMERIC_DOC,
    ...lines(["A Appendix", "[9] Should not be parsed. Fake entry text that is long enough."], { startY: 500 }),
  ];
  const entries = parseReferences(doc);
  assert.equal(entries.length, 3);
});

test("findCitations: numeric single and list", () => {
  const found = findCitations("We rely on prior work [1] and [2, 3].");
  assert.equal(found.length, 2);
  assert.deepEqual(found[0].keys, ["1"]);
  assert.deepEqual(found[1].keys, ["2", "3"]);
});

test("findCitations: numeric range expansion", () => {
  const found = findCitations("Several works [1-3] explore this.");
  assert.deepEqual(found[0].keys, ["1", "2", "3"]);
});

test("findCitations: numeric with a locator into the cited work", () => {
  // "[9, §5.2.2.1]", "[24, Section 5.2]", "[26, Lemma 1]" — only the number is
  // the key; the whole bracket (incl. locator) is the matched span.
  const a = findCitations("per the RRC spec [9, §5.2.2.1] this holds.");
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].keys, ["9"]);
  assert.equal("per the RRC spec [9, §5.2.2.1] this holds.".slice(a[0].start, a[0].end), "[9, §5.2.2.1]");
  assert.deepEqual(findCitations("shown in [24, Section 5.2].")[0].keys, ["24"]);
  assert.deepEqual(findCitations("by [26, Lemma 1], we get")[0].keys, ["26"]);
  assert.deepEqual(findCitations("response length [58, §4.2].")[0].keys, ["58"]);
  // a number list plus a trailing locator keeps every number
  assert.deepEqual(findCitations("see [24, 58, §2.2.3] here")[0].keys, ["24", "58"]);
  // ordinary prose after a number is NOT swallowed as a locator
  assert.equal(findCitations("the interval [9, and beyond]").length, 0);
});

test("findCitations: author-year, multiple in one paren", () => {
  const found = findCitations("As shown previously (Smith et al., 2020; Doe, 2019).");
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].keys, ["Smith-2020", "Doe-2019"]);
});

test("findCitations ignores figure/table parens and bare years", () => {
  assert.equal(findCitations("(Figure 2020 shows this)").length, 0);
  assert.equal(findCitations("in the year (2020)").length, 0);
});

test("findCitations: a bracketed list containing 0 is math, not a citation", () => {
  assert.equal(findCitations("the vector [2, 1, 0] spans it").length, 0);
  assert.equal(findCitations("index [0] of the array").length, 0);
  assert.deepEqual(findCitations("cited in [2, 1]")[0].keys, ["2", "1"]);
});

test("resolveCitation maps numeric keys to entries", () => {
  const entries = parseReferences(NUMERIC_DOC);
  const resolved = resolveCitation(["2"], entries);
  assert.equal(resolved.length, 1);
  assert.match(resolved[0].raw, /BERT/);
});

test("resolveCitation maps author-year keys to entries", () => {
  const entries = parseReferences(APA_DOC);
  const resolved = resolveCitation(["Smith-2020", "Doe-2019"], entries);
  assert.equal(resolved.length, 2);
});

test("findInternalRefs matches in-paper pointers, not prose", () => {
  const text =
    "As shown in Figure 3 and Table 9, Algorithm 2 (Section 5.1) and Appendix B apply.";
  const found = findInternalRefs(text).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(found, ["Figure 3", "Table 9", "Algorithm 2", "Section 5.1", "Appendix B"]);
  assert.equal(findInternalRefs("the figure shows a table of results").length, 0);
});

test("guessTitle falls back to raw prefix", () => {
  const t = guessTitle("short unparseable entry text");
  assert.equal(t, "short unparseable entry text");
});

test("extracts DOI from entry, stripping trailing punctuation", () => {
  const doc = lines([
    "References",
    "[1] A. Author. Some paper title here. Journal, 2021. doi:10.1234/abc.def-5.",
    "[2] B. Author. Another fine paper title. In CHI, 2022.",
    "[3] C. Author. A third paper title here. In CHI, 2023.",
  ]);
  const entries = parseReferences(doc);
  assert.equal(entries[0].doi, "10.1234/abc.def-5");
  assert.equal(entries[1].doi, null);
});

test("findCitations matches across reassembled line wraps", () => {
  // Spans concatenate without spaces; a wrapped citation reassembles like:
  const joined = "as shown (Smith et al.,2020) and in [12,13] elsewhere";
  const found = findCitations(joined);
  assert.equal(found.length, 2);
  assert.deepEqual(found.flatMap((f) => f.keys).sort(), ["12", "13", "Smith-2020"]);
});
