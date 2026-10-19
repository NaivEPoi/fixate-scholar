import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildLines, pageFeatures, fontFlags } from "../../extension/viewer/typography/line-features.mjs";

test("font flags: math faces, not Computer Modern's roman text face", () => {
  assert.equal(fontFlags("XMBBQW+CMMI10").f_math, 1);
  assert.equal(fontFlags("CMSY10").f_math, 1);
  assert.equal(fontFlags("GJAZDJ+CMR10").f_math, 0, "CMR is the text face");
  assert.equal(fontFlags("NimbusRomNo9L-Medi").f_bold, 0);
  assert.equal(fontFlags("CMBX12").f_bold, 1);
  assert.equal(fontFlags("CMTT10").f_mono, 1);
  assert.equal(fontFlags("Helvetica-Bold").f_sans, 1);
});

// The Python extractor (ml/docbank_lines.py) and this module must agree
// number for number on the same tokens, or a model trained there means
// nothing here. The fixture holds four DocBank pages' tokens and rows; it is
// generated locally (ml/export_fixture_page.py) and not committed, since
// DocBank asks for no redistribution of its data — the test skips without it.
const FIXTURE = "ml/data/line-features.fixture.json";
test("line features: the JS mirror reproduces the Python extractor's rows", { skip: existsSync(FIXTURE) ? false : "no fixture" }, () => {
  const fx = JSON.parse(readFileSync(FIXTURE, "utf8"));
  let checked = 0;
  for (const page of fx.pages) {
    const toks = page.tokens.map((t) => [t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8]]);
    const lines = buildLines(toks);
    assert.equal(lines.length, page.lines.length, `${page.name}: line count`);
    const recs = pageFeatures(lines);
    for (let i = 0; i < recs.length; i++) {
      const want = page.features[i], got = recs[i];
      for (const [k, v] of Object.entries(want)) {
        if (typeof v !== "number") continue;
        assert.ok(k in got, `${page.name} line ${i}: feature ${k} missing in JS`);
        const d = Math.abs(got[k] - v);
        assert.ok(d <= 1e-6 + 1e-6 * Math.abs(v), `${page.name} line ${i} ${JSON.stringify(lines[i].map((t) => t[0]).join(" ").slice(0, 40))}: ${k} JS ${got[k]} vs Python ${v}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 1000, `checked ${checked} values`);
});
