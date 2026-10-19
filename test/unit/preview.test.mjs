import { test } from "node:test";
import assert from "node:assert/strict";
import { columnAt, kindOf, parseDestHash, regionFor, splitReference, targetByText } from "../../extension/viewer/references/preview.mjs";

// Synthetic extractor output: y decreasing down the page.
function lines(texts, { page = 3, startY = 700, x = 50 } = {}) {
  return texts.map((t, i) => ({ text: t, x, endX: x + 300, y: startY - i * 12, page, h: 10, column: 0 }));
}

test("parseDestHash reads PDF.js's named and explicit destination hashes", () => {
  assert.deepEqual(parseDestHash("#figure.3"), { name: "figure.3" });
  assert.deepEqual(parseDestHash("#" + escape("section.4.2")), { name: "section.4.2" });
  const explicit = [{ num: 12, gen: 0 }, { name: "XYZ" }, 72, 500, null];
  assert.deepEqual(parseDestHash("#" + escape(JSON.stringify(explicit))), { explicit });
  assert.equal(parseDestHash("#page=3&zoom=auto"), null);
  assert.equal(parseDestHash("https://example.org/x.pdf"), null);
  assert.equal(parseDestHash(""), null);
});

test("kindOf and splitReference read a reference's leader and number", () => {
  assert.equal(kindOf("Figure"), "figure");
  assert.equal(kindOf("Fig."), "figure");
  assert.equal(kindOf("Table"), "table");
  assert.equal(kindOf("§"), "section");
  assert.equal(kindOf("Sec."), "section");
  assert.equal(kindOf("Eq."), "equation");
  assert.equal(kindOf("Algorithm"), "float");
  assert.equal(kindOf("Theorem"), "statement");
  assert.deepEqual(splitReference("Figure 3"), { leader: "Figure", num: "3" });
  assert.deepEqual(splitReference("§4.2"), { leader: "§", num: "4.2" });
  assert.deepEqual(splitReference("Theorem\n2"), { leader: "Theorem", num: "2" });
  assert.deepEqual(splitReference("Eq. (5)"), { leader: "Eq.", num: "5" });
  assert.equal(splitReference("and then"), null);
});

test("targetByText finds captions, headings, statements and equation tags", () => {
  const doc = lines([
    "4.2 Attack model",
    "We consider an attacker who, as Figure 3 shows, controls the link.",
    "Theorem 2. Every such attacker is bounded by the capacity of the link.",
    "Proof. By Lemma 1 and the argument of Section 4.2 above.",
    "x = y + z (5)",
    "Figure 3: The attacker's position on the link.",
    "Table 3: Results per setting.",
  ]);
  assert.equal(targetByText(doc, "Figure", "3", 2), 5);
  assert.equal(targetByText(doc, "Table", "3"), 6);
  assert.equal(targetByText(doc, "Theorem", "2"), 2);
  assert.equal(targetByText(doc, "Section", "4.2"), 0, "a heading, not the sentence that mentions 4.2");
  assert.equal(targetByText(doc, "§", "4.2"), 0);
  assert.equal(targetByText(doc, "Eq.", "5"), 4);
  assert.equal(targetByText(doc, "Figure", "9"), -1);
  // Searching from after the caption wraps around to it.
  assert.equal(targetByText(doc, "Figure", "3", 6), 5);
});

test("regionFor reaches up for a figure and down for a statement, within the page", () => {
  const page = [0, 0, 612, 792];
  const fig = regionFor("figure", { x: 100, y: 300 }, { x0: 72, x1: 300 }, page);
  assert.ok(fig.y1 > 300 && fig.y0 < 300 && fig.y1 - 300 > 300 - fig.y0, "mostly above the caption anchor");
  assert.equal(fig.x0, 68);
  assert.equal(fig.x1, 304);
  const thm = regionFor("statement", { x: 100, y: 300 }, null, page);
  assert.ok(thm.y1 - 300 < 300 - thm.y0, "mostly below the heading anchor");
  assert.equal(thm.x0, 0);
  assert.equal(thm.x1, 612);
  const top = regionFor("figure", { x: 100, y: 780 }, null, page);
  assert.equal(top.y1, 792, "clipped to the page");
  // A float whose top is known (a link anchored there, hypcap-style): the
  // clip reaches that top, 8 pt over, instead of the guessed height — and a
  // reach at or below the caption changes nothing.
  const tall = regionFor("figure", { x: 100, y: 200 }, null, page, 640);
  assert.equal(tall.y1, 648);
  assert.ok(tall.y0 < 200);
  const short = regionFor("figure", { x: 100, y: 300 }, null, page, 320);
  assert.equal(short.y1, 328, "reaches a float only 20 pt tall, not 230");
  const below = regionFor("figure", { x: 100, y: 300 }, null, page, 100);
  assert.equal(below.y1, 530, "a reach below the caption is ignored");
});

test("columnAt gives the column's extent from the lines around a point", () => {
  const left = lines(["a", "b", "c", "d"], { x: 54 }).map((l) => ({ ...l, endX: 290 }));
  const right = lines(["e", "f", "g", "h"], { x: 320 }).map((l) => ({ ...l, endX: 556 }));
  const col = columnAt([...left, ...right], 3, 400, 690);
  assert.deepEqual(col, { x0: 320, x1: 556 });
  assert.equal(columnAt(left, 9, 100, 690), null, "another page");
});
