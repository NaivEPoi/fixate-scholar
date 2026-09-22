// The structural hints read out of a LaTeX-produced PDF: which destination
// names anchor what, and how they group onto pages. Pure string and list work
// — the parts that decide whether a caption boundary lands on the right line,
// and the parts that would go wrong silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorNear,
  classifyDestination,
  extractStructureHints,
  groupByPage,
} from "../../extension/viewer/typography/pdfhints.mjs";

test("classifyDestination recognises hyperref's float anchors", () => {
  // hypcap puts this one ON the caption, which is the boundary the caption
  // pass needs — the distinction is the whole point of the flag.
  assert.deepEqual(classifyDestination("figure.caption.7"), {
    kind: "caption", family: "figure", onCaption: true, depth: null, name: "figure.caption.7",
  });
  assert.equal(classifyDestination("table.caption.9").family, "table");
  assert.equal(classifyDestination("table.caption.9").onCaption, true);

  // Without hypcap the anchor is the float, not the caption.
  assert.equal(classifyDestination("figure.3").kind, "float");
  assert.equal(classifyDestination("figure.3").onCaption, false);
  assert.equal(classifyDestination("algorithm.1").kind, "float");
  assert.equal(classifyDestination("lstlisting.2").kind, "float");
});

test("classifyDestination reads heading depth from the number, not the prefix", () => {
  assert.equal(classifyDestination("section.3").depth, 1);
  assert.equal(classifyDestination("subsection.3.1").depth, 2);
  // Depth 3 and 4 are the run-in levels the word-count gate kept mis-handling.
  assert.equal(classifyDestination("subsubsection.3.1.2").depth, 3);
  assert.equal(classifyDestination("paragraph.3.1.2.1").depth, 4);
  for (const n of ["section.3", "subsubsection.3.1.2", "paragraph.3.1.2.1"]) {
    assert.equal(classifyDestination(n).kind, "heading", n);
  }
});

test("classifyDestination ignores the names that say nothing about a region", () => {
  // A citation anchor tells you nothing about the block it sits in, and a
  // page anchor nothing at all. Treating either as structure would put a
  // heading wherever a paper cites something.
  for (const n of ["cite.Smith2020", "page.7", "Hfootnote.3", "Item.2", "Doc-Start", "", "figure.caption", "subsection"]) {
    assert.equal(classifyDestination(n), null, n);
  }
  assert.equal(classifyDestination(null), null);
  assert.equal(classifyDestination(42), null);
});

test("groupByPage orders anchors down the page, not by name", () => {
  // Destinations arrive in name order; "subsubsection.3.1.10" sorts before
  // "…3.1.2" as a string while sitting below it on the page.
  const grouped = groupByPage([
    { page: 3, x: 54, y: 188, name: "subsubsection.3.1.2" },
    { page: 3, x: 54, y: 325, name: "subsubsection.3.1.1" },
    { page: 4, x: 318, y: 621, name: "subsubsection.4.2.1" },
    { page: 3, x: 318, y: 529, name: "subsubsection.3.1.3" },
  ]);
  assert.deepEqual(grouped.get(3).map((a) => a.y), [529, 325, 188]);
  assert.deepEqual(grouped.get(4).map((a) => a.y), [621]);
  assert.equal(grouped.has(5), false);
});

test("groupByPage drops anchors that resolved to nothing", () => {
  const grouped = groupByPage([
    { page: 1, x: 10, y: 100, name: "section.1" },
    { page: null, x: 10, y: 100, name: "section.2" },
    { page: 2, x: 10, y: undefined, name: "section.3" },
  ]);
  assert.equal(grouped.get(1).length, 1);
  assert.equal(grouped.has(2), false);
});

test("anchorNear finds the anchor on that line and nothing further away", () => {
  const byPage = groupByPage([
    { page: 3, x: 54, y: 188, name: "subsubsection.3.1.2" },
    { page: 3, x: 54, y: 325, name: "subsubsection.3.1.1" },
  ]);
  assert.equal(anchorNear(byPage, 3, 186, 12)?.name, "subsubsection.3.1.2");
  assert.equal(anchorNear(byPage, 3, 322, 12)?.name, "subsubsection.3.1.1");
  // A body line between the two headings must match neither.
  assert.equal(anchorNear(byPage, 3, 260, 12), null);
  assert.equal(anchorNear(byPage, 9, 188, 12), null);
  assert.equal(anchorNear(undefined, 3, 188, 12), null);
});

// A fake document, because the interesting failures are a name tree that is
// missing, malformed, or full of destinations that resolve to nothing — none
// of which need a real PDF to reproduce.
const fakeDoc = (dests, { pageIndex = async () => 2, throws = false } = {}) => ({
  getDestinations: async () => { if (throws) throw new Error("no name tree"); return dests; },
  getPageIndex: pageIndex,
});

test("extractStructureHints resolves anchors to pages", async () => {
  const hints = await extractStructureHints(fakeDoc({
    "subsubsection.3.1.2": [{ num: 9, gen: 0 }, { name: "XYZ" }, 53.798, 188.28, null],
    "figure.caption.7": [{ num: 9, gen: 0 }, { name: "XYZ" }, 53.798, 713.793, null],
    "equation.4": [{ num: 9, gen: 0 }, { name: "XYZ" }, 100, 400, null],
    "cite.Smith2020": [{ num: 9, gen: 0 }, { name: "XYZ" }, 10, 20, null],
  }));
  assert.equal(hints.available, true);
  assert.equal(hints.counts.heading, 1);
  assert.equal(hints.counts.caption, 1);
  assert.equal(hints.counts.equation, 1);
  assert.equal(hints.headings.get(3)[0].name, "subsubsection.3.1.2");
  assert.equal(hints.captions.get(3)[0].onCaption, true);
  assert.equal(anchorNear(hints.headings, 3, 188, 10)?.depth, 3);
});

test("extractStructureHints reports unavailable rather than throwing", async () => {
  // The 1995 paper in the corpus has no name tree at all; the engine must fall
  // back to geometry, and "no hints" has to be a value, not an exception.
  for (const doc of [fakeDoc({}), fakeDoc(null), fakeDoc({}, { throws: true }), {}, null]) {
    const hints = await extractStructureHints(doc);
    assert.equal(hints.available, false);
    assert.equal(hints.headings.size, 0);
  }
  // Destinations that exist but name nothing structural are also "unavailable":
  // acting on them would be acting on citation anchors.
  const onlyCites = await extractStructureHints(fakeDoc({
    "cite.A": [{ num: 1, gen: 0 }, { name: "XYZ" }, 1, 2, null],
    "page.4": [{ num: 1, gen: 0 }, { name: "XYZ" }, 1, 2, null],
  }));
  assert.equal(onlyCites.available, false);
});

test("extractStructureHints survives destinations that resolve to nothing", async () => {
  const hints = await extractStructureHints(fakeDoc({
    "section.1": [{ num: 4, gen: 0 }, { name: "XYZ" }, 50, 700, null],
    "section.2": [{ num: 5, gen: 0 }, { name: "XYZ" }, 50, 600, null],
  }, {
    pageIndex: async (ref) => { if (ref.num === 5) throw new Error("dangling"); return 0; },
  }));
  assert.equal(hints.counts.heading, 1);
  assert.equal(hints.headings.get(1).length, 1);
});

test("extractStructureHints asks the page tree once per ref, not once per anchor", async () => {
  // A paper carries 80–160 destinations across ~20 pages; resolving every one
  // separately turns document load into a page-tree walk per anchor.
  let calls = 0;
  const ref = { num: 7, gen: 0 };
  const dests = {};
  for (let i = 1; i <= 20; i++) dests[`subsection.1.${i}`] = [ref, { name: "XYZ" }, 50, 700 - i, null];
  await extractStructureHints(fakeDoc(dests, { pageIndex: async () => { calls++; return 0; } }));
  assert.equal(calls, 1);
});
