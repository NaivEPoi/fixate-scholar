// The viewer's ?file= parameter arrives RAW from the declarativeNetRequest
// redirect (regexSubstitution cannot percent-encode), and PDF.js parses it with
// URLSearchParams. Every case below is a URL that URLSearchParams would read as
// a *different* URL — `&` truncates it, `+` becomes a space — which is how a
// perfectly good internet PDF ends up as "couldn't load this document".
//
// The rewrite has to be exactly a round trip: the context-menu and file://
// paths already encode at the source, so running over their output must not
// double-encode, and a URL whose own characters are legitimately escaped
// (`%26` in an S3 key) must come back escaped.
import { test } from "node:test";
import assert from "node:assert/strict";

/** A minimal window whose location/history behave like the real pair. */
function fakeWindow(search, hash = "") {
  const w = {
    location: { pathname: "/vendor/pdfjs/web/viewer.html", search, hash },
    history: {
      replaced: null,
      replaceState(_state, _title, url) {
        // Split on the FIRST ? and the FIRST # only — a file= value routinely
        // contains both, and a naive split() would quietly truncate it and
        // make the assertions test the harness instead of the code.
        w.history.replaced = url;
        const h = url.indexOf("#");
        const hash = h === -1 ? "" : url.slice(h);
        const beforeHash = h === -1 ? url : url.slice(0, h);
        const q = beforeHash.indexOf("?");
        w.location.pathname = q === -1 ? beforeHash : beforeHash.slice(0, q);
        w.location.search = q === -1 ? "" : beforeHash.slice(q);
        w.location.hash = hash;
      },
    },
  };
  return w;
}

const load = async (w) => {
  globalThis.window = w;
  return import("../../extension/viewer/file-param.mjs");
};

/** What PDF.js does with the query: URLSearchParams, exactly as viewer.mjs. */
const asPdfJsReadsIt = (search) =>
  new URLSearchParams(search.substring(1)).get("file");

const CASES = [
  ["single query param", "https://host.example/get.pdf?id=5"],
  ["two query params", "https://host.example/get.pdf?a=1&b=2"],
  ["presigned-style URL", "https://s3.example/k.pdf?X-Amz-Expires=900&X-Amz-Signature=abc&x=1"],
  ["plus in the path", "https://host.example/a+b.pdf"],
  ["escaped ampersand in the key", "https://s3.example/a%26b.pdf"],
  ["escaped space", "https://host.example/a%20b.pdf"],
  ["equals in a value", "https://host.example/p.pdf?q=a=b&r=2"],
  ["no query at all", "https://host.example/plain.pdf"],
  ["file URL", "file:///C:/papers/two%20words.pdf"],
];

for (const [name, url] of CASES) {
  test(`normalizeFileParam survives round trip: ${name}`, async () => {
    const w = fakeWindow("?file=" + url);
    const { normalizeFileParam } = await load(w);
    normalizeFileParam();
    assert.equal(
      asPdfJsReadsIt(w.location.search),
      url,
      "PDF.js must parse back the URL it was given",
    );
  });

  test(`normalizeFileParam is idempotent: ${name}`, async () => {
    const w = fakeWindow("?file=" + encodeURIComponent(url));
    const { normalizeFileParam } = await load(w);
    normalizeFileParam();
    assert.equal(w.history.replaced, null, "an encoded parameter is left alone");
    assert.equal(asPdfJsReadsIt(w.location.search), url);
  });
}

test("the fragment stays on location, where PDF.js reads the open parameters", async () => {
  const w = fakeWindow("?file=https://host.example/p.pdf?a=1&b=2", "#page=7");
  const { normalizeFileParam } = await load(w);
  normalizeFileParam();
  assert.equal(w.location.hash, "#page=7");
  assert.equal(asPdfJsReadsIt(w.location.search), "https://host.example/p.pdf?a=1&b=2");
});

test("a blob: URL minted by this page is left exactly as-is", async () => {
  const w = fakeWindow("?file=blob:chrome-extension://abc/1234-5678");
  const { normalizeFileParam } = await load(w);
  normalizeFileParam();
  assert.equal(w.history.replaced, null);
});

test("a stray percent that isn't an escape survives too", async () => {
  const url = "https://host.example/100%off.pdf";
  const w = fakeWindow("?file=" + url);
  const { normalizeFileParam } = await load(w);
  normalizeFileParam();
  assert.equal(asPdfJsReadsIt(w.location.search), url);
});

test("currentFileUrl decodes the parameter and rejects non-document schemes", async () => {
  const url = "https://host.example/get.pdf?a=1&b=2";
  const w = fakeWindow("?file=" + encodeURIComponent(url), "#page=3");
  const { currentFileUrl } = await load(w);
  // No fragment: the service worker matches this against a DNR urlFilter and a
  // webNavigation URL, neither of which ever carries one.
  assert.equal(currentFileUrl(), url);

  const bad = fakeWindow("?file=" + encodeURIComponent("javascript:alert(1)"));
  globalThis.window = bad;
  assert.equal(currentFileUrl(), null);

  const none = fakeWindow("");
  globalThis.window = none;
  assert.equal(currentFileUrl(), null);
});
