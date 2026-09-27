import { test } from "node:test";
import assert from "node:assert/strict";
import { isStatementLabel } from "../../extension/viewer/references/citations.mjs";

const at = (text, word) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length });

test("a theorem-style label opening its run is the statement, not a reference", () => {
  const t = "prose before\nDefinition 2. A scheme is secure if";
  assert.equal(isStatementLabel(t, at(t, "Definition 2")), true);
  const u = "Lemma 4: For every x";
  assert.equal(isStatementLabel(u, at(u, "Lemma 4")), true);
});

test("references stay references", () => {
  const mid = "as stated in Definition 2. The proof";
  assert.equal(isStatementLabel(mid, at(mid, "Definition 2")), false, "mid-run: a reference");
  const noDot = "\nDefinition 2 shows that";
  assert.equal(isStatementLabel(noDot, at(noDot, "Definition 2")), false, "not followed by a period");
  const sec = "\nSection 4. We";
  assert.equal(isStatementLabel(sec, at(sec, "Section 4")), false, "not a statement kind");
});
