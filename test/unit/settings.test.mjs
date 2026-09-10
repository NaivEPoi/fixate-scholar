import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, getSettings, normalizeBypassUrl, urlsMatch } from "../../extension/viewer/settings-client.mjs";

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
  assert.deepEqual(DEFAULTS.bypassOrigins, []);
  assert.deepEqual(DEFAULTS.bypassUrls, []);
});

test("getSettings returns copy of DEFAULTS when chrome.storage is absent", async () => {
  const s = await getSettings();
  assert.deepEqual(s, { ...DEFAULTS });
  assert.equal(s.saveLocalFile, true);
});

test("normalizeBypassUrl strips hash fragments and trims whitespace", () => {
  assert.equal(normalizeBypassUrl(""), "");
  assert.equal(normalizeBypassUrl(null), "");
  assert.equal(normalizeBypassUrl("https://example.com/test.pdf#page=2"), "https://example.com/test.pdf");
  assert.equal(normalizeBypassUrl("https://example.com/test.pdf?v=1#page=2"), "https://example.com/test.pdf?v=1");
  assert.equal(normalizeBypassUrl("file:///C:/test.pdf#page=3"), "file:///C:/test.pdf");
  assert.equal(normalizeBypassUrl("javascript:alert(1)"), "");
  assert.equal(normalizeBypassUrl("data:text/html,bad"), "");
});

test("urlsMatch matches identical, fragmented, and case-insensitive file URLs", () => {
  assert.equal(urlsMatch("https://example.com/a.pdf", "https://example.com/a.pdf"), true);
  assert.equal(urlsMatch("https://example.com/a.pdf#page=2", "https://example.com/a.pdf"), true);
  assert.equal(urlsMatch("https://example.com/a.pdf", "https://example.com/b.pdf"), false);
  assert.equal(urlsMatch("file:///C:/test.pdf#page=1", "file:///c:/test.pdf"), true);
  assert.equal(urlsMatch("file:///C:/My%20Files/test.pdf", "file:///c:/My Files/test.pdf"), true);
});
