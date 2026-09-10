import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, getSettings } from "../../extension/viewer/settings-client.mjs";

test("DEFAULTS defines all required settings with correct types", () => {
  assert.equal(DEFAULTS.saveLocalFile, true, "saveLocalFile must default to true");
  assert.equal(DEFAULTS.enabled, true);
  assert.equal(DEFAULTS.intercept, true);
  assert.equal(DEFAULTS.flowCopy, true);
  assert.equal(DEFAULTS.scholarLookup, true);
  assert.equal(DEFAULTS.openSources, true);
  assert.equal(DEFAULTS.annotationAuthor, "");
  assert.equal(DEFAULTS.emphasisMode, "dynamic");
  assert.equal(typeof DEFAULTS.boldWeight, "number");
});

test("getSettings returns copy of DEFAULTS when chrome.storage is absent", async () => {
  const s = await getSettings();
  assert.deepEqual(s, { ...DEFAULTS });
  assert.equal(s.saveLocalFile, true);
});
