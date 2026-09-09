// The card's text handling — the parts that are string work, not DOM work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkParts } from "../../extension/viewer/references/popup.mjs";

const linked = (text) => linkParts(text).filter((p) => p.href);

test("a URL in the entry becomes a link", () => {
  const parts = linkParts("Amarisoft. https://www.amarisoft.com/.");
  // The entry reads exactly as the document prints it; only the middle part
  // is a link, and the sentence's closing period stays outside it.
  assert.deepEqual(parts.map((p) => p.text), ["Amarisoft. ", "https://www.amarisoft.com/", "."]);
  assert.equal(parts[1].href, "https://www.amarisoft.com/");
  assert.equal(parts[0].href, undefined);
  assert.equal(parts[2].href, undefined);
});

test("a URL the page wrapped is still one link", () => {
  // The text layer keeps the line break as a space; the address has none.
  const [link] = linked("boofuzz: fuzzing for humans. https://github. com/jtpereyda/boofuzz.");
  assert.equal(link.href, "https://github.com/jtpereyda/boofuzz");
  assert.equal(link.text, "https://github. com/jtpereyda/boofuzz");
});

test("a bare www. host gets a scheme", () => {
  const [link] = linked("srsRAN. www.srsran.com/ (accessed 2024).");
  assert.equal(link.href, "https://www.srsran.com/");
});

test("prose is left alone", () => {
  assert.deepEqual(linked("M. Abadi and C. Fournet. Mobile values, new names. In POPL, 2001."), []);
  // "e.g." is not a hostname, and neither is a version number.
  assert.deepEqual(linked("See e.g. TS 33.501 version 17.5.0 Release 17."), []);
  assert.deepEqual(linkParts(""), []);
});

test("text either side of a link survives, in order", () => {
  const parts = linkParts("A. Tool. https://example.org/x. Accessed 2025.");
  assert.equal(parts.map((p) => p.text).join(""), "A. Tool. https://example.org/x. Accessed 2025.");
});
