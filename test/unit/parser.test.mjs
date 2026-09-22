import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseReferences,
  findReferencesBody,
  findReferenceSections,
  findFurniture,
  guessTitle,
  guessAuthors,
  firstAuthorSurname,
  bibAuthors,
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

test("a float caption interrupting the bibliography does not end it", () => {
  // A two-column reference list is routinely interrupted by a figure pinned to
  // the top of the next column. Its caption is set at BODY size — larger than
  // the entries and as large as the "References" heading — so the heading-size
  // cutoff read it as the next section and truncated the list. Entries resume
  // after it; a real appendix heading does not.
  const entry = (n, y) => ({
    text: `[${n}] ${"ABC"[n % 3]}. Author, “A reference entry with enough length,” in Proc., 20${10 + n}.`,
    x: 50,
    y,
    page: 9,
    h: 8,
    column: 0,
  });
  const big = (text, y) => ({ text, x: 50, y, page: 9, h: 10, column: 0 });
  const doc = [
    big("References", 700),
    entry(1, 690),
    entry(2, 681),
    big("Fig. 9: Empirical CDFs of the positioning error for each panel", 660),
    big("configuration, with and without the surface in place.", 650),
    entry(3, 630),
    entry(4, 621),
    big("B Additional Results", 600),
    big("Appendix prose that should be processed normally.", 590),
  ];
  const { heading, body } = findReferencesBody(doc);
  assert.equal(heading.text, "References");
  assert.deepEqual(
    body.map((l) => l.text.slice(0, 3)),
    ["[1]", "[2]", "[3]", "[4]"], // caption skipped, appendix ends the body
  );
  assert.deepEqual(parseReferences(doc).map((e) => e.number), [1, 2, 3, 4]);
});

test("a running head at a page break does not end the bibliography", () => {
  // Journal/preprint templates print a running head and page number on every
  // page, at BODY size while the bibliography is set smaller — so the
  // heading-size cutoff used to read the continuation page's running head as a
  // new section and drop every reference after the first page (which then got
  // emphasized as body prose). Furniture is stepped over instead.
  const page = (texts, page, startY) =>
    texts.map((t, i) => {
      const indent = typeof t === "object";
      return { text: indent ? t.text : t, x: indent ? 62 : 50, y: startY - i * 12, page, h: 8, column: 0 };
    });
  const head = (text, p) => ({ text, x: 50, y: 720, page: p, h: 10, column: 0 });
  const doc = [
    // Running head repeats on enough pages to be recognized as furniture.
    head("P. W. SHOR", 23), head("24", 24), head("P. W. SHOR", 24),
    ...page(["Body prose on the last content page before the references."], 24, 700),
    { text: "References", x: 50, y: 600, page: 24, h: 8, column: 0 },
    ...page([
      "A. Author (1994), First entry with a title long enough to pass the gate, in Proc.,",
      { text: "Publisher, pp. 1-20." },
    ], 24, 580),
    head("25", 25), head("P. W. SHOR", 25),
    ...page([
      "B. Author (1995), Second entry with a title long enough to pass the gate, in Proc.,",
      { text: "Publisher, pp. 21-40." },
      "C. Author (1996), Third entry with a title long enough to pass the gate, in Proc.,",
      { text: "Publisher, pp. 41-60." },
    ], 25, 700),
  ];
  const { body } = findReferencesBody(doc);
  assert.ok(body.some((l) => /Third entry/.test(l.text)), "body must cross the page break");
  assert.ok(!body.some((l) => /SHOR|^\d+$/.test(l.text)), "furniture must not enter the body");
  const entries = parseReferences(doc);
  assert.equal(entries.length, 3);
});

test("a repeated running head with the SAME title as the section is not mistaken for it", () => {
  // Two-sided book/report templates set the chapter title as a running head
  // on every page of the chapter, alternating left/right margins — including
  // every page of a "Bibliography" chapter, right up to its last page. A
  // naive last-match search for the heading text locks onto that final running
  // head instead of the true (once-per-document) chapter title, so everything
  // before it — most of the bibliography — reads as ordinary body prose.
  // The distinguishing signal: the running head sits at the SAME y on every
  // page it appears on; the true heading's y is wherever its own layout put
  // it, not pinned to the header's slot (here, deliberately overlapping the
  // running head's normalized text and even sitting near ITS OWN page's top).
  const runningHead = (p) => ({ text: "BIBLIOGRAPHY", x: 300, y: 770, page: p, h: 10, column: 0 });
  const page = (texts, p, startY) =>
    texts.map((t, i) => ({
      text: typeof t === "object" ? t.text : t,
      x: typeof t === "object" ? 62 : 50,
      y: startY - i * 12,
      page: p,
      h: 8,
      column: 0,
    }));
  const doc = [
    ...page(["Body prose on the chapter's last content page."], 5, 700),
    // The true heading: near its own page's top (blank space above a chapter
    // title is normal), but at a y distinct from the running head's fixed slot.
    { text: "Bibliography", x: 72, y: 660, page: 6, h: 14, column: 0 },
    ...page([
      "[1] A. Author. First entry with a title long enough to pass the gate, 2020.",
    ], 6, 630),
    runningHead(7),
    ...page([
      "[2] B. Author. Second entry with a title long enough to pass the gate, 2021.",
    ], 7, 700),
    runningHead(8),
    ...page([
      "[3] C. Author. Third entry with a title long enough to pass the gate, 2022.",
    ], 8, 700),
    runningHead(9),
    ...page([
      "[4] D. Author. Fourth entry with a title long enough to pass the gate, 2023.",
    ], 9, 700),
  ];
  const { heading, body } = findReferencesBody(doc);
  assert.equal(heading.page, 6);
  assert.equal(heading.text, "Bibliography");
  const entries = parseReferences(doc);
  assert.equal(entries.length, 4);
  assert.ok(!body.some((l) => l.text === "BIBLIOGRAPHY"), "the running head stays out of the body");
});

test("alpha-style bibliography markers ([WL92], [SRC07]) are parsed and resolved", () => {
  // BibTeX's "alpha" style keys entries with author-initials + 2-digit year
  // ("[WL92]") instead of a running number or a dotted list. Neither the
  // numeric nor the dotted marker matches, so this must fall into its own
  // "alpha" split mode rather than the marker-less indent fallback.
  const doc = lines([
    "Bibliography",
    "[WL92] Thomas Woo and Simon Lam. Authentication for distributed systems.",
    { text: "Computer, 25(1):39–52, 1992." },
    "[SRC07] Ben Smyth, Mark Ryan, and Liqun Chen. Certificate management using",
    { text: "distributed trust in a wireless network. In WOSIS, 2007." },
    "[Yub10] Yubico AB. The YubiKey manual (Version 2.2), 2010.",
  ]);
  const entries = parseReferences(doc);
  assert.deepEqual(
    entries.map((e) => e.label),
    ["WL92", "SRC07", "Yub10"],
  );
  const resolved = resolveCitation(["SRC07"], entries);
  assert.equal(resolved.length, 1);
  assert.match(resolved[0].raw, /distributed trust/);
});

test("a phrase repeated inside the bibliography is not furniture", () => {
  // Furniture is recognized by repetition, so a line that recurs in the
  // reference list itself qualified — an italic journal name ending an entry, or
  // a page range whose digits normalize away ("pages 1251–1263. IEEE." →
  // "pages . IEEE."). Those lines were dropped from the body, so they got no
  // box in the region the engine leaves alone and were EMPHASIZED inside the
  // reference list (ACL, five reference pages, three of them affected).
  // A running head is the first or last line on its page; these are neither.
  const head = (p) => ({ text: "SOME JOURNAL, VOL. 9", x: 50, y: 740, page: p, h: 10, column: 0 });
  const page = (texts, p, startY) =>
    texts.map((t, i) => ({
      text: typeof t === "object" ? t.text : t,
      x: typeof t === "object" ? 62 : 50,
      y: startY - i * 12,
      page: p,
      h: 8,
      column: 0,
    }));
  const foot = (n, p) => ({ text: String(n), x: 300, y: 60, page: p, h: 8, column: 0 });
  const doc = [
    head(10), head(11), head(12),
    foot(10, 10), foot(11, 11), foot(12, 12),
    { text: "References", x: 50, y: 600, page: 10, h: 8, column: 0 },
    ...page([
      "[1] A. Author. An entry with a title long enough to pass the length gate. In Trans.",
      { text: "Software Engineering" },
      { text: "pages 100–200. IEEE." },
    ], 10, 580),
    ...page([
      "[2] B. Author. Another entry with a title long enough to pass the gate. In Trans.",
      { text: "Software Engineering" },
      { text: "pages 300–400. IEEE." },
    ], 11, 700),
    ...page([
      "[3] C. Author. A third entry with a title long enough to pass the gate. In Trans.",
      { text: "Software Engineering" },
      { text: "pages 500–600. IEEE." },
    ], 12, 700),
  ];
  const { body } = findReferencesBody(doc);
  assert.equal(body.filter((l) => l.text === "Software Engineering").length, 3);
  assert.equal(body.filter((l) => /^pages /.test(l.text)).length, 3);
  assert.ok(!body.some((l) => /SOME JOURNAL/.test(l.text)), "the real running head stays out");
  assert.ok(!body.some((l) => /^1[012]$/.test(l.text)), "the page number at the foot stays out");
});

test("findFurniture: a MULTI-LINE running head is furniture, body prose is not", () => {
  // The engine's margin cut (outer 6% of the page) reaches a one-line head. A
  // three-line title block repeated at the top of every odd page hangs below it
  // at or under body size, so it was emphasized as body prose — and being
  // processed, a canvas glyph peeked past its mask — one word rendered with a
  // doubled letter. Repetition across pages is what identifies it.
  const head = (text, p, y) => ({ text, x: 50, y, page: p, h: 7, column: 0, endX: 300 });
  const body = (text, p, y) => ({ text, x: 50, y, page: p, h: 9, column: 0, endX: 500 });
  const doc = [];
  for (const p of [3, 5, 7]) {
    doc.push(head("A Long Paper Title That Repeats:", p, 731));
    doc.push(head("Second Line Of The Same Title Block", p, 723));
    doc.push(head("Third Line Of The Same Title Block", p, 714));
    doc.push({ text: String(p), x: 300, y: 60, page: p, h: 7, column: 0, endX: 310 });
    // Unique body prose, some of it inside the top band.
    doc.push(body(`Body prose on page ${p} that appears nowhere else at all.`, p, 700));
    doc.push(body(`More prose on page ${p} lower down the page, also unique.`, p, 400));
  }
  const boxes = findFurniture(doc);
  assert.deepEqual([...boxes.keys()].sort((a, b) => a - b), [3, 5, 7]);
  // three head lines + the page number
  assert.equal(boxes.get(5).length, 4);
  const covers = (page, y) => boxes.get(page).some((b) => y >= b.y0 && y <= b.y1);
  assert.ok(covers(5, 731) && covers(5, 723) && covers(5, 714), "every head line is covered");
  assert.ok(covers(5, 60), "the page number at the foot is covered");
  assert.ok(!covers(5, 700), "body prose in the top band is NOT furniture");
  assert.ok(!covers(5, 400), "body prose mid-page is NOT furniture");
});

test("findFurniture: nothing repeats ⇒ no furniture", () => {
  const words = ["Introduction", "Background", "Evaluation"];
  const doc = [];
  for (const p of [1, 2, 3]) {
    doc.push({ text: `${words[p - 1]} of the system`, x: 50, y: 730, page: p, h: 9, column: 0, endX: 300 });
    doc.push({ text: `Body text about ${words[p - 1]} with enough words to be prose.`, x: 50, y: 400, page: p, h: 9, column: 0, endX: 500 });
  }
  assert.equal(findFurniture(doc).size, 0);
});

test("findFurniture: a SHORT head carrying its page number still counts", () => {
  // The digit-stripped ledger exists for this shape ("Journal Name, Vol. 5, No.
  // 3" / "12  ACM Trans. Something"). It is limited to short lines because two
  // different BODY lines separated only by a number would otherwise match.
  const doc = [];
  for (const p of [4, 5, 6]) {
    doc.push({ text: `Journal of Things, Vol. 9, No. ${p}`, x: 50, y: 740, page: p, h: 8, column: 0, endX: 280 });
    doc.push({ text: `A long body sentence on page ${p} that differs only by its number, which is why the exact ledger is what governs a line this long.`, x: 50, y: 700, page: p, h: 9, column: 0, endX: 520 });
  }
  const boxes = findFurniture(doc);
  assert.deepEqual([...boxes.keys()].sort((a, b) => a - b), [4, 5, 6]);
  assert.equal(boxes.get(5).length, 1, "only the head, not the long body line");
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

test("findCitations: separate bracket range expansion like [6]-[11]", () => {
  // Hyphen, en-dash, em-dash, double-hyphen, and spaced variants
  const c1 = findCitations("As shown in [6]-[11] previously.");
  assert.equal(c1.length, 1);
  assert.deepEqual(c1[0].keys, ["6", "7", "8", "9", "10", "11"]);
  assert.equal("As shown in [6]-[11] previously.".slice(c1[0].start, c1[0].end), "[6]-[11]");

  const c2 = findCitations("Prior art [6]–[11] established this.");
  assert.equal(c2.length, 1);
  assert.deepEqual(c2[0].keys, ["6", "7", "8", "9", "10", "11"]);

  const c3 = findCitations("See [6] - [11] for details.");
  assert.equal(c3.length, 1);
  assert.deepEqual(c3[0].keys, ["6", "7", "8", "9", "10", "11"]);

  const c4 = findCitations("References [6]--[11] demonstrate this.");
  assert.equal(c4.length, 1);
  assert.deepEqual(c4[0].keys, ["6", "7", "8", "9", "10", "11"]);

  // Chained with single citations or other ranges
  const c5 = findCitations("See [1], [6]-[11], and [15].");
  assert.equal(c5.length, 3);
  assert.deepEqual(c5[0].keys, ["1"]);
  assert.deepEqual(c5[1].keys, ["6", "7", "8", "9", "10", "11"]);
  assert.deepEqual(c5[2].keys, ["15"]);

  // Range with locator in second bracket
  const c6 = findCitations("Detailed in [6]-[11, §3.2].");
  assert.equal(c6.length, 1);
  assert.deepEqual(c6[0].keys, ["6", "7", "8", "9", "10", "11"]);
  assert.equal("Detailed in [6]-[11, §3.2].".slice(c6[0].start, c6[0].end), "[6]-[11, §3.2]");
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

test("findCitations: code array indexing is not a citation", () => {
  assert.equal(findCitations("packet[4] = 0x55").length, 0);
  assert.equal(findCitations("crc[0] = crc16 & 0xff").length, 0);
  assert.equal(findCitations("char[16] buffer;").length, 0);
  assert.equal(findCitations("matrix[1][2]").length, 0);
  assert.equal(findCitations("arr_1[2]").length, 0);
  assert.equal(findCitations("arr$1[2]").length, 0);

  // When includeIndexed is explicitly true (for hyperlink reconciliation)
  const indexed = findCitations("packet[4] = 0x55", { includeIndexed: true });
  assert.equal(indexed.length, 1);
  assert.equal(indexed[0].precededByIdentifier, true);
  assert.deepEqual(indexed[0].keys, ["4"]);
});

test("findCitations: narrative author-year, bracketed or parenthesized year", () => {
  // natbib \citet — the authors are running prose, only the year is bracketed.
  // The numeric pattern can't see a 4-digit year and the parenthetical pattern
  // needs the author INSIDE the parens, so these used to be missed entirely.
  const t = "shown in papers of Church [1936], Turing [1936], and Post [1936].";
  const found = findCitations(t);
  assert.deepEqual(found.map((c) => c.keys), [["Church-1936"], ["Turing-1936"], ["Post-1936"]]);
  assert.equal(t.slice(found[0].start, found[0].end), "Church [1936]");
  // "et al.", nobiliary particles, initials, a round-bracket year, a year list
  assert.deepEqual(findCitations("which Vergis et al. [1986] have called")[0].keys, ["Vergis-1986"]);
  assert.deepEqual(findCitations("the Invariance Thesis of van Emde Boas [1990]")[0].keys, ["Boas-1990"]);
  assert.deepEqual(findCitations("as L. M. Adleman [1994] showed")[0].keys, ["Adleman-1994"]);
  assert.deepEqual(findCitations("as Bennett (1973) showed")[0].keys, ["Bennett-1973"]);
  assert.deepEqual(findCitations("Benioff [1980, 1982a] proved")[0].keys, ["Benioff-1980", "Benioff-1982a"]);
});

test("findCitations: narrative form does not swallow prose or numbered things", () => {
  // A lowercase word ends the name run, and the year bracket must follow it.
  assert.equal(findCitations("the Turing machine [1936] was augmented").length, 0);
  assert.equal(findCitations("see Table [1990] for the layout").length, 0);
  assert.equal(findCitations("in Section [2020] we show").length, 0);
  // A 1-3 digit bracket stays a NUMERIC citation, even after a capitalized word
  assert.deepEqual(findCitations("as Shor [12] showed")[0].keys, ["12"]);
  // ranges/ordinary text are still untouched
  assert.equal(findCitations("the interval [1936, and beyond]").length, 0);
});

test("findCitations: overlapping matches are dropped, earliest-longest wins", () => {
  // The annotator wraps each range in the span markup, so ranges must not nest.
  const found = findCitations("as Doe (2019) and (Smith et al., 2020) showed");
  for (let i = 1; i < found.length; i++) {
    assert.ok(found[i].start >= found[i - 1].end, `range ${i} overlaps its predecessor`);
  }
});

test("firstAuthorSurname reads either author convention", () => {
  // Surname first (APA): the surname is the head of the name.
  assert.equal(firstAuthorSurname("Doe, J., & Smith, A."), "Doe");
  assert.equal(firstAuthorSurname("Smith, A., Jones, B., & Lee, C."), "Smith");
  // Given name first (numeric / alpha bibliographies): the surname is last.
  assert.equal(firstAuthorSurname("Mark D. Ryan and Ben Smyth"), "Ryan");
  assert.equal(firstAuthorSurname("A. Vaswani, N. Shazeer, N. Parmar, et al."), "Vaswani");
  // A PDF that splits TeX accent composition still yields the surname, which
  // the given-name-first regex used to return as "Mart".
  assert.equal(firstAuthorSurname("Mart´ın Abadi and C´edric Fournet"), "Abadi");
  // A nobiliary particle keeps the same head word findCitations picks.
  assert.equal(firstAuthorSurname("van Emde Boas"), "Boas");
  assert.equal(firstAuthorSurname(null), null);
});

test("guessAuthors cuts the entry where guessTitle does", () => {
  assert.equal(
    guessAuthors("Mark D. Ryan and Ben Smyth. Applied pi calculus. In Formal Models, 2011."),
    "Mark D. Ryan and Ben Smyth",
  );
  assert.equal(
    guessAuthors("Doe, J. (2019). A study of reading behavior. Journal of Reading, 12(3)."),
    "Doe, J.",
  );
  assert.equal(
    guessAuthors('A. Author, “A quoted title,” in Proc. CHI, 2021.'),
    "A. Author",
  );
  // Nothing separates authors from title here — guessTitle falls back too.
  assert.equal(guessAuthors("short unparseable entry text"), null);
});

test("entry surname is the first author's, not their given name", () => {
  const doc = lines([
    "References",
    "[1] Mart´ın Abadi and C´edric Fournet. Mobile values, new names. In POPL, 2001.",
    "[2] Mark D. Ryan and Ben Smyth. Applied pi calculus. In Formal Models, 2011.",
    "[3] Ross Anderson and Roger Needham. Programming computers. In CS Today, 1995.",
  ]);
  const entries = parseReferences(doc);
  assert.deepEqual(entries.map((e) => e.surname), ["Abadi", "Ryan", "Anderson"]);
});

test("resolveCitation splits keys on the LAST hyphen (hyphenated surnames)", () => {
  const entries = [{ number: null, surname: "Ben-Or", year: "1994", raw: "M. Ben-Or (1994), A theorem." }];
  assert.equal(resolveCitation(["Ben-Or-1994"], entries).length, 1);
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

test("findInternalRefs matches the section SYMBOL, not only the spelled-out word", () => {
  // `§` was in the leader list from the start and never once matched: the
  // pattern opens on `\b`, a word boundary needs a word character on one side,
  // and in "see §4.2" both the space and the `§` are non-word — so every
  // section-symbol reference in every paper went uncoloured while the
  // "Section 4.2" beside it coloured fine.
  const text = "As in §4.2 and §§5.1-5.3, described in §7; cf. § 8.2 too.";
  const found = findInternalRefs(text).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(found, ["§4.2", "§§5.1-5.3", "§7", "§ 8.2"]);

  // At the very start of a span, and inside parentheses — both are positions
  // where the missing boundary would still have bitten.
  assert.deepEqual(
    findInternalRefs("§3 covers it").map(({ start, end }) => "§3 covers it".slice(start, end)),
    ["§3"],
  );
  assert.deepEqual(
    findInternalRefs("(see §4.2)").map(({ start, end }) => "(see §4.2)".slice(start, end)),
    ["§4.2"],
  );

  // The symbol without a number is punctuation, not a reference.
  assert.equal(findInternalRefs("a §-delimited list and the § itself").length, 0);
});

test("findInternalRefs: a line-wrap with no space after the number is not swallowed", () => {
  // Text-layer spans correspond to PDF-authored lines. A justified line that
  // wraps right after "Chapter 2" carries no trailing space, and the next
  // span starts immediately with the next word — "...Chapter 2" + "provides
  // an introduction..." concatenates to "...Chapter 2provides...". The
  // optional subsection-suffix letter must not treat that "p" as part of the
  // reference.
  const text = "Chapter 2 concludes. Chapter 2provides an introduction to the topic.";
  const found = findInternalRefs(text).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(found, ["Chapter 2", "Chapter 2"]);
  // A genuine subsection suffix (not followed by another letter) still works.
  const suffixText = "See Section 3a, then Section 3b.";
  const suffixed = findInternalRefs(suffixText).map(({ start, end }) => suffixText.slice(start, end));
  assert.deepEqual(suffixed, ["Section 3a", "Section 3b"]);
});

test("findInternalRefs matches plurals, Roman numerals, subfigures, lists, and equations", () => {
  const text =
    "See Figures 1 and 2, Table II, Table III, Table IV, Tables VI, VII and VIII, and Section III-E. " +
    "Also Figure 1(a), Eq. (1), Equations (1)-(3), and Sections 3.1 to 3.4.";
  const found = findInternalRefs(text).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(found, [
    "Figures 1 and 2",
    "Table II",
    "Table III",
    "Table IV",
    "Tables VI, VII and VIII",
    "Section III-E",
    "Figure 1(a)",
    "Eq. (1)",
    "Equations (1)-(3)",
    "Sections 3.1 to 3.4",
  ]);
});

// Neither of these appears anywhere in the 14-paper corpus, which is exactly
// why both survived: the sweeps could not see them. They are locked in here.
test("findInternalRefs matches Roman numerals that contain no I", () => {
  // The canonical-Roman pattern ended in a group requiring an "I", so V/X/L/C
  // were rescued only by the single-capital-letter rule and the multi-letter
  // ones — XV, XX, XXV, XL — matched nothing at all and went uncoloured.
  for (const n of ["I", "IV", "V", "IX", "X", "XIV", "XV", "XVI", "XX", "XXI", "XXV", "XL", "L"]) {
    const text = `as reported in Table ${n} above`;
    const found = findInternalRefs(text).map(({ start, end }) => text.slice(start, end));
    assert.deepEqual(found, [`Table ${n}`], `Table ${n} must be a reference`);
  }
});

test("findInternalRefs covers the whole of a dotted section range", () => {
  // "Section 3.1-3.4" used to stop at "3.1-3": the range's right-hand side was
  // matched as a bare number, so the colouring cut off inside the reference's
  // own second number and left ".4" behind.
  const text = "described in Section 3.1-3.4 and Section 10.2.3-10.2.9 below";
  const found = findInternalRefs(text).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(found, ["Section 3.1-3.4", "Section 10.2.3-10.2.9"]);
});

test("findInternalRefs matches concatenated line-wrapped references", () => {
  // When a reference wraps across text layer spans, plain concatenation glues
  // the leader directly to the number, Roman numeral, or appendix letter, or
  // glues the preceding line-ending word directly to the leader.
  const text =
    "The results are in TableIII. As seen in TableIV and SectionIII-E, along with AppendixA and Figure1. " +
    "Also implementation inSection V and as showsFigure 2, but intersection 5 is not matched.";
  const found = findInternalRefs(text).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(found, [
    "TableIII",
    "TableIV",
    "SectionIII-E",
    "AppendixA",
    "Figure1",
    "Section V",
    "Figure 2",
  ]);
});

test("guessTitle falls back to raw prefix", () => {
  const t = guessTitle("short unparseable entry text");
  assert.equal(t, "short unparseable entry text");
});

test("guessTitle: author-year punctuated with commas (older LaTeX article style)", () => {
  // No sentence period anywhere, so the generic split cannot see a title and
  // the whole entry used to become the Scholar query (Shor quant-ph/9508027:
  // 54 of 64 entries).
  assert.equal(
    guessTitle(
      "L. M. Adleman (1994), Algorithmic number theory, in Proceedings of the 35th Annual Symposium, pp. 88-113.",
    ),
    "Algorithmic number theory",
  );
  // The venue may be an abbreviated journal name instead of ", in ...".
  assert.equal(
    guessTitle(
      "A. Barenco, D. Deutsch, and R. Jozsa (1995b), Conditional quantum dynamics and logic gates, Phys. Rev. Lett., 74, pp. 4083-4086.",
    ),
    "Conditional quantum dynamics and logic gates",
  );
});

test("guessTitle: LNCS \"Surname, I.: Title. In: Venue\"", () => {
  assert.equal(
    guessTitle("Abdolmaleki, B., Lipmaa, H., Zajac, M.: Dl-extractable commitment schemes. In: ACNS. pp. 385-405 (2019)"),
    "Dl-extractable commitment schemes",
  );
  // A trailing DOI makes the entry look like APA ("(2005). https://doi.org/x"),
  // which returned "https://doi" as the title until LNCS was tried first. A
  // lowercase particle in the author list must not break the guard either.
  assert.equal(
    guessTitle("Ateniese, G., de Medeiros, B., Tsudik, G.: Sanitizable Signatures. In: Computer Security. pp. 159-177 (2005). https://doi.org/10.1007/x"),
    "Sanitizable Signatures",
  );
});

test("guessTitle: a trailing year parenthesis is not the author-year delimiter", () => {
  // ACM Reference Format ends with one, and taking what follows returned the
  // PAGE RANGE as the title. The generic sentence split reads this form right.
  assert.equal(
    guessTitle(
      "A. Stulman. 2009. Searching for Optimal Homing Sequences. J. Network and Computer Applications 32, 2 (2009), 315-323.",
    ),
    "Searching for Optimal Homing Sequences",
  );
});

test("guessTitle: an LNCS author list may end in \"et al.\"", () => {
  assert.equal(
    guessTitle("Ben-Sasson, E., et al.: Aurora: Transparent succinct arguments. In: EUROCRYPT 2019. pp. 103-128 (2019)"),
    "Aurora: Transparent succinct arguments",
  );
});

test("guessTitle: the new branches leave the established styles alone", () => {
  assert.equal(
    guessTitle("Doe, J. (2019). A study of reading behavior. Journal of Reading Research, 12(3), 45-67."),
    "A study of reading behavior",
  );
  assert.equal(
    guessTitle("A. Vaswani, N. Shazeer, et al. Attention is all you need. In Advances in NIPS, 2017."),
    "Attention is all you need",
  );
  // A colon inside a numeric entry's TITLE is not an LNCS author separator.
  assert.equal(
    guessTitle("J. Devlin, M. Chang. BERT: Pre-training of deep bidirectional transformers. In NAACL, 2019."),
    "BERT: Pre-training of deep bidirectional transformers",
  );
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

// Each printed key of a multi-key citation has to be locatable on its own:
// the annotator puts a hit-target on each span, so pointing at the "12" of
// "[4, 12]" opens [12]'s card instead of [4]'s. A span that is off by even one
// character lands the target on the wrong glyph, so every case checks the
// slice of the ORIGINAL text, not just the offsets.
const keySpanSlices = (text) =>
  findCitations(text, { includeIndexed: true }).map((c) => ({
    match: text.slice(c.start, c.end),
    keys: c.keys,
    spans: (c.keySpans ?? []).map((s) => [s.key, text.slice(s.start, s.end)]),
  }));

test("findCitations locates each key of a numeric list", () => {
  const [cite] = keySpanSlices("as shown in [4, 12]. A malicious");
  assert.equal(cite.match, "[4, 12]");
  assert.deepEqual(cite.keys, ["4", "12"]);
  assert.deepEqual(cite.spans, [["4", "4"], ["12", "12"]]);
});

test("findCitations spans a range's printed endpoints, not its implied middle", () => {
  // Both spellings of a range: inside one bracket and across two.
  for (const text of ["see [6-11] there", "see [6]-[11] there"]) {
    const [cite] = keySpanSlices(text);
    assert.deepEqual(cite.keys, ["6", "7", "8", "9", "10", "11"], text);
    // 7..10 are never printed — those characters stay with the citation.
    assert.deepEqual(cite.spans, [["6", "6"], ["11", "11"]], text);
  }
  // A range truncated at 26 keys never reaches the number at its far end, so
  // that number must not claim a target for a card that does not exist.
  const [big] = keySpanSlices("see [1-300] there");
  assert.equal(big.keys.at(-1), "26");
  assert.deepEqual(big.spans, [["1", "1"]]);
});

test("findCitations puts a bracket range's second key on the KEY, not on a locator that repeats it", () => {
  // A cross-bracket range may carry a locator, and a locator can print the
  // same number as the key: "[6]-[11, p. 11]". The second key used to be
  // located with `lastIndexOf`, which lands on the page number — so [11]'s
  // hit-target sat on "p. 11" while pointing at "[11" fell through to the
  // whole-citation target and opened [6]'s card. That is precisely the defect
  // per-key targets exist to prevent.
  //
  // Asserted by OFFSET, not by the sliced text: both candidates slice to the
  // identical string "11", so a text comparison cannot tell them apart — which
  // is why the existing spans test above stayed green through the bug.
  const text = "see [6]-[11, p. 11] here";
  const [cite] = findCitations(text, { includeIndexed: true });
  const second = cite.keySpans.find((s) => s.key === "11");
  assert.equal(second.start, text.indexOf("[11") + 1);
  assert.equal(second.end, second.start + 2);
  // And the locator's copy is NOT what was chosen.
  assert.notEqual(second.start, text.lastIndexOf("11"));

  // The plain range still resolves to its own printed endpoint.
  const plain = "see [6]-[11] here";
  const [p] = findCitations(plain, { includeIndexed: true });
  assert.equal(p.keySpans.find((s) => s.key === "11").start, plain.indexOf("[11") + 1);
});

test("findCitations locates the keys of author-year, alpha and narrative citations", () => {
  // The separator's spacing belongs to neither citation, so each span is the
  // trimmed run — a target that starts on the space before a name is one the
  // reader can hit without pointing at anything.
  const [ay] = keySpanSlices("work (Smith 2020; Jones 2021) shows");
  assert.deepEqual(ay.spans, [["Smith-2020", "Smith 2020"], ["Jones-2021", "Jones 2021"]]);

  // A COMMA separates author-year citations just as a semicolon does, and
  // splitting on ";" alone gave "(Smith 2019, Jones 2020)" a single key whose
  // span covered both names: Jones had no card, and pointing at Jones opened
  // Smith's.
  const [comma] = keySpanSlices("work (Smith 2019, Jones 2020) shows");
  assert.deepEqual(comma.keys, ["Smith-2019", "Jones-2020"]);
  assert.deepEqual(comma.spans, [["Smith-2019", "Smith 2019"], ["Jones-2020", "Jones 2020"]]);

  // But a comma also JOINS the authors of one citation, and that must stay one
  // card. The year is what tells the two uses apart: a piece carrying no year
  // is not a citation of its own.
  const [authors] = keySpanSlices("per (Smith, Jones & Roe 2019) we");
  assert.deepEqual(authors.keys, ["Smith-2019"]);
  assert.deepEqual(authors.spans, [["Smith-2019", "Smith, Jones & Roe 2019"]]);

  // A trailing page locator is part of the citation, not a second one, and it
  // belongs to the citation BEFORE it.
  const [loc] = keySpanSlices("see (Brown et al. 2021, p. 44) now");
  assert.deepEqual(loc.keys, ["Brown-2021"]);
  assert.deepEqual(loc.spans, [["Brown-2021", "Brown et al. 2021, p. 44"]]);

  // The direction of that attachment is the whole subtlety. A yearless piece
  // BEFORE any citation is an author prefix and joins what follows; one AFTER a
  // citation is that citation's locator and joins what precedes. Merging every
  // yearless piece forward put Smith's page number inside Jones's span, so
  // pointing at Smith's locator opened Jones's card.
  // A locator may be paginated in ROMAN numerals — front matter is — and
  // leaving those out of the locator shape put the defect straight back:
  // "p. ix" fell through to the next citation and opened its card.
  const [rom] = keySpanSlices("see (Smith 2019, p. ix; Jones 2020) here");
  assert.deepEqual(rom.keys, ["Smith-2019", "Jones-2020"]);
  assert.deepEqual(rom.spans, [["Smith-2019", "Smith 2019, p. ix"], ["Jones-2020", "Jones 2020"]]);

  // An UNDATED citation carries no 4-digit year, so it can never key a card of
  // its own — but it must not become the author prefix of the citation after
  // it either. "(Smith n.d.; Jones 2020)" used to yield the single invented key
  // Smith-2020 and lose Jones entirely.
  const [nd] = keySpanSlices("see (Smith n.d.; Jones 2020) here");
  assert.deepEqual(nd.keys, ["Jones-2020"]);
  assert.deepEqual(nd.spans, [["Jones-2020", "Jones 2020"]]);

  // APA writes the comma BETWEEN author and year, so a yearless piece after a
  // citation is usually the NEXT citation's author, not a locator: attaching
  // every one of them backwards lost Doe-2019 from "(Smith et al., 2020; Doe,
  // 2019)" entirely. Only something shaped like a locator attaches backwards.
  const [apa] = keySpanSlices("As shown previously (Smith et al., 2020; Doe, 2019).");
  assert.deepEqual(apa.keys, ["Smith-2020", "Doe-2019"]);
  assert.deepEqual(apa.spans, [["Smith-2020", "Smith et al., 2020"], ["Doe-2019", "Doe, 2019"]]);

  for (const text of [
    "see (Smith 2019, p. 12; Jones 2020) here",
    "see (Smith 2019, p. 12, Jones 2020) here",
    "see (Smith 2019, pp. 3-4, Jones 2020) here",
  ]) {
    const [mid] = keySpanSlices(text);
    assert.deepEqual(mid.keys, ["Smith-2019", "Jones-2020"], text);
    assert.equal(mid.spans[0][0], "Smith-2019", text);
    assert.match(mid.spans[0][1], /^Smith 2019, pp?\. ?[\d-]+$/, text);
    assert.deepEqual(mid.spans[1], ["Jones-2020", "Jones 2020"], text);
  }

  const [alpha] = keySpanSlices("keys [WL92, SRC07] here");
  assert.deepEqual(alpha.spans, [["WL92", "WL92"], ["SRC07", "SRC07"]]);

  // Narrative: the years distinguish the two papers, the shared name run does
  // not, so only the years are pointable.
  const [narr] = keySpanSlices("Benioff [1980, 1982a] proved");
  assert.deepEqual(narr.spans, [["Benioff-1980", "1980"], ["Benioff-1982a", "1982a"]]);
});

test("findCitations: a locator is part of the citation, not of any key", () => {
  const [cite] = keySpanSlices("see [9, Section 5.2] there");
  assert.equal(cite.match, "[9, Section 5.2]");
  assert.deepEqual(cite.spans, [["9", "9"]]);
});

test("bibAuthors splits a given-name-first list on its commas", () => {
  assert.equal(
    bibAuthors("Syed Rafiul Hussain, Imtiaz Karim, and Elisa Bertino"),
    "Syed Rafiul Hussain and Imtiaz Karim and Elisa Bertino",
  );
  assert.equal(
    bibAuthors("A. Vaswani, N. Shazeer, N. Parmar, et al."),
    "A. Vaswani and N. Shazeer and N. Parmar",
  );
});

test("bibAuthors never cuts a surname-first name in half", () => {
  assert.equal(bibAuthors("Doe, J., & Smith, A."), "Doe, J. and Smith, A.");
  assert.equal(bibAuthors("Smith, A., Jones, B., & Lee, C."), "Smith, A. and Jones, B. and Lee, C.");
  assert.equal(bibAuthors(null), null);
});


// A journal proof: the article, its REFERENCES, then supplementary material
// with a second, shorter REFERENCES of its own. Both lists number from [1], so
// the document holds two different references called "[1]" — and the article's
// list, being neither the first heading nor the last, is the one a single-
// bibliography search loses.
function proofDoc() {
  const article = lines([
    "We build on prior work [1], [2].",
    "REFERENCES",
    "[1] A. Author, “A protocol analysis paper,” in Proc. ACM CCS, 2021.",
    "[2] B. Buthor, “A second cited work,” IEEE Trans. Inf. Forensics, 2022.",
    "[3] C. Cuthor, “A third cited work,” in Proc. USENIX Security, 2023.",
  ]);
  const supplement = lines([
    "APPENDIX A",
    "The supplement restates [1] in more detail.",
    "REFERENCES",
    "[1] Z. Zuthor, “A supplement-only citation,” arXiv:2401.00001, 2024.",
    "[2] Y. Yuthor, “Another supplement-only citation,” arXiv:2401.00002, 2024.",
  ]);
  for (const l of supplement) l.page = 11;
  return [...article, ...supplement];
}

test("findReferenceSections finds every bibliography, not just the last", () => {
  const sections = findReferenceSections(proofDoc());
  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading.page, 9);
  assert.equal(sections[0].body.length, 3);
  assert.equal(sections[1].heading.page, 11);
  assert.equal(sections[1].body.length, 2);
});

test("findReferencesBody returns the primary (longest) section", () => {
  const { heading, body } = findReferencesBody(proofDoc());
  assert.equal(heading.page, 9);
  assert.equal(body.length, 3);
  assert.match(body[0].text, /A protocol analysis paper/);
});

test("parseReferences returns both sections' entries, tagged and in order", () => {
  const entries = parseReferences(proofDoc());
  assert.deepEqual(entries.map((e) => e.number), [1, 2, 3, 1, 2]);
  assert.deepEqual(entries.map((e) => e.section), [0, 0, 0, 1, 1]);
  // A bare "[1]" with no page context resolves to the ARTICLE's entry.
  assert.match(resolveCitation(["1"], entries)[0].raw, /A protocol analysis paper/);
});

test("findCitations: a locator is one shape, shared by the regex and the grouping", () => {
  // The citation regex decides whether a parenthetical IS a citation; the
  // grouping decides who a locator belongs to. They used to carry separate
  // notions of the same thing, and every divergence was a defect.
  const slice = (t) => {
    const [c] = findCitations(t, { includeIndexed: true });
    return c ? (c.keySpans ?? []).map((k) => [k.key, t.slice(k.start, k.end)]) : null;
  };

  // Non-digit locators: the regex accepted only digits after "p.", so these
  // matched nothing at all and produced no card.
  assert.deepEqual(slice("see (Smith 2019, p. ix) here"), [["Smith-2019", "Smith 2019, p. ix"]]);
  assert.deepEqual(slice("see (Smith 2019, § 4) here"), [["Smith-2019", "Smith 2019, § 4"]]);
  assert.deepEqual(slice("see (Smith 2019, ¶ 2) here"), [["Smith-2019", "Smith 2019, ¶ 2"]]);

  // A dotted or ranged section number is still one locator, and still belongs
  // to the citation before it.
  assert.deepEqual(slice("see (Smith 2019, § 4.2; Jones 2020) here"), [
    ["Smith-2019", "Smith 2019, § 4.2"],
    ["Jones-2020", "Jones 2020"],
  ]);

  // An APA initial is NOT a locator. Folded case with the roman numerals in one
  // character class, "P. Dix" parsed as page mark + numerals and swallowed the
  // citation after it, losing Dix-2020 entirely.
  assert.deepEqual(slice("see (Smith, 2019; P. Dix, 2020) here"), [
    ["Smith-2019", "Smith, 2019"],
    ["Dix-2020", "P. Dix, 2020"],
  ]);
});

test("findCitations: an undated marker can arrive after the name it belongs to", () => {
  // APA punctuates it — "(Smith, n.d.; Jones 2020)" cuts to "Smith" / " n.d." /
  // " Jones 2020" — so testing only the piece that OPENED the group left the
  // group open, and it swallowed Jones under the invented key Smith-2020.
  for (const text of [
    "see (Smith, n.d.; Jones 2020) here",
    "see (Smith n.d.; Jones 2020) here",
    "see (Smith, in press; Jones 2020) here",
  ]) {
    const [c] = findCitations(text, { includeIndexed: true });
    assert.deepEqual(c.keys, ["Jones-2020"], text);
  }
});

test("findCitations: an unknown segment costs its own segment, not its neighbours", () => {
  const keys = (t) => (findCitations(t, { includeIndexed: true })[0] ?? {}).keys ?? null;

  // An undated work is a legitimate member of a citation list even though it
  // can never key a card. The list grammar did not admit one, so the whole
  // parenthetical stopped being a citation and the good Jones 2020 went with
  // it — a failure out of all proportion to the unknown segment.
  assert.deepEqual(keys("see (Jones 2020; Smith n.d.) here"), ["Jones-2020"]);
  assert.deepEqual(keys("see (Jones 2020, Smith in press) here"), ["Jones-2020"]);
  assert.deepEqual(
    keys("see (Jones 2020; Smith forthcoming; Roe 2021) here"),
    ["Jones-2020", "Roe-2021"],
  );

  // Roman page RANGES are cited as readily as arabic ones; without the range
  // the whole parenthetical failed to be a citation at all.
  assert.deepEqual(keys("see (Smith 2019, pp. ix-xii) here"), ["Smith-2019"]);
  assert.deepEqual(
    keys("see (Smith 2019, pp. ix-xii; Jones 2020) here"),
    ["Smith-2019", "Jones-2020"],
  );

  // And the parentheticals that are not citations still are not.
  assert.equal(findCitations("in the year (2020)").length, 0);
  assert.equal(findCitations("(Figure 2020 shows this)").length, 0);
});

test("findCitations: shapes the split-and-repair parser could not express", () => {
  const slice = (t) => {
    const [c] = findCitations(t, { includeIndexed: true });
    return c ? (c.keySpans ?? []).map((k) => [k.key, t.slice(k.start, k.end)]) : null;
  };

  // A comma page list is ONE locator. Cutting on commas isolated "14", which
  // had no page mark of its own and so leaked into the next citation's target.
  assert.deepEqual(slice("see (Smith 2019, pp. 12, 14, Jones 2020) here"), [
    ["Smith-2019", "Smith 2019, pp. 12, 14"],
    ["Jones-2020", "Jones 2020"],
  ]);

  // Two works by one author. The second year has no author of its own and was
  // dropped; it belongs to the author before it.
  assert.deepEqual(slice("see (Smith 2019, 2020) here"), [
    ["Smith-2019", "Smith 2019"],
    ["Smith-2020", "2020"],
  ]);

  // A narrative prefix is not a surname. Taking the first capitalised word gave
  // the key "See-2019", for a reference that cannot exist, so the card never
  // resolved.
  assert.deepEqual(slice("see (See Smith 2019) here"), [["Smith-2019", "Smith 2019"]]);
  assert.deepEqual(slice("see (Cf. Smith 2019) here"), [["Smith-2019", "Smith 2019"]]);

  // An initial is not a surname either: "P. Dix" keyed on "P".
  assert.deepEqual(slice("see (Smith, 2019; P. Dix, 2020) here"), [
    ["Smith-2019", "Smith, 2019"],
    ["Dix-2020", "P. Dix, 2020"],
  ]);
});

test("findCitations: the citation grammar cannot be made to backtrack", () => {
  // The shipped v1.2.x pattern described the parenthetical's INTERNAL shape
  // with a star over branches that all began with a lazy [^();]*?, so a
  // parenthetical it ultimately REJECTS could be partitioned exponentially many
  // ways: 122 characters took 7ms, 218 took 4.9 SECONDS, 264 did not finish.
  // The input is body text from whatever PDF the reader opens.
  //
  // Bounded here rather than asserted exactly, because wall-clock on a shared
  // machine is noisy — but the failure mode was seconds-to-forever on inputs
  // this size, so any honest threshold separates them.
  const shapes = [
    "(" + "Smith 2019, ".repeat(3000) + ")",
    "(" + "Smith 2019, ".repeat(3000), // never closes: the worst case
    "(Smith 2019" + ", pp. 1".repeat(3000) + ")",
    "(" + "n.d.; ".repeat(3000) + "Smith 2019)",
  ];
  for (const text of shapes) {
    const t0 = Date.now();
    findCitations(text, { includeIndexed: true });
    const ms = Date.now() - t0;
    assert.ok(ms < 2000, `took ${ms}ms on ${text.length} chars — backtracking is back`);
  }
});
