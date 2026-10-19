import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, getSettings, isLocalFileUrl, normalizeBypassUrl, urlsMatch, fitBypassUrls } from "../../extension/viewer/settings-client.mjs";

test("a file: URL is local only without a host (or localhost) and never a UNC path (R55 security review)", () => {
  // "file://host/share/x.pdf" is \\host\share\x.pdf on Windows: an SMB
  // connection to that host with the user's credentials, which any web page
  // could make the web-accessible viewer open.
  for (const ok of ["file:///C:/papers/a.pdf", "file://localhost/C:/a.pdf", "file:///home/u/a.pdf", " file:///C:/a.pdf "]) assert.equal(isLocalFileUrl(ok), true, ok);
  for (const bad of ["file://attacker.example/share/x.pdf", "file://10.0.0.1/s/x.pdf", "file:////server/share/x.pdf", "FILE://evil/x.pdf", "https://a.example/x.pdf", "javascript:1", "", null]) assert.equal(isLocalFileUrl(bad), false, String(bad));
  // The bypass list keeps local file: URLs and drops the others, parsed or not.
  assert.equal(normalizeBypassUrl("file:///C:/papers/a.pdf#page=2"), "file:///C:/papers/a.pdf");
  assert.equal(normalizeBypassUrl("file://attacker.example/share/x.pdf"), "");
  assert.equal(normalizeBypassUrl("file://10.0.0.1/s/x.pdf"), "");
  assert.equal(normalizeBypassUrl("https://a.example/x.pdf#f"), "https://a.example/x.pdf");
});

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

test("fitBypassUrls keeps the newest URLs that fit one sync item", () => {
  const urls = Array.from({ length: 40 }, (_, i) => `https://example.com/${"x".repeat(200)}${i}`);
  const kept = fitBypassUrls(urls);
  assert.ok(kept.length < urls.length && kept.length > 0);
  assert.equal(kept.at(-1), urls.at(-1), "the URL just added survives");
  assert.deepEqual(kept, urls.slice(urls.length - kept.length), "the oldest go first");
  assert.ok(new TextEncoder().encode("bypassUrls" + JSON.stringify(kept)).length <= 8192);
  assert.deepEqual(fitBypassUrls(["https://a.org/x.pdf"]), ["https://a.org/x.pdf"]);
});
