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

test("normalizeFileParam clears dangerous schemes such as javascript: and data:", async () => {
  const w = fakeWindow("?file=javascript:alert(1)");
  const { normalizeFileParam } = await load(w);
  normalizeFileParam();
  assert.equal(w.location.search, "");

  const wData = fakeWindow("?file=" + encodeURIComponent("data:text/html,<script>alert(1)</script>"));
  globalThis.window = wData;
  normalizeFileParam();
  assert.equal(wData.location.search, "");
});

// viewer.html is web-accessible to <all_urls> and patch 1 disables PDF.js's own
// validateFileURL for extension origins, so this scheme gate is the only thing
// deciding what the viewer will fetch. It used to read the scheme only when the
// query STARTED with `?file=`, so putting any parameter in front of it — which
// an attacker opening the viewer controls completely — skipped the check.
const SNEAKY = [
  ["a parameter before file=", "?x=1&file=javascript:alert(1)"],
  ["an empty leading parameter", "?&file=javascript:alert(1)"],
  ["data: behind a parameter", "?a=b&file=data:text/html,<script>alert(1)</script>"],
  ["a scheme-less value", "?a=b&file=/etc/passwd"],
];
for (const [name, search] of SNEAKY) {
  test(`the scheme gate holds when the query does not start with file=: ${name}`, async () => {
    const w = fakeWindow(search);
    const { normalizeFileParam } = await load(w);
    normalizeFileParam();
    assert.equal(asPdfJsReadsIt(w.location.search), null, "PDF.js must be given no file at all");
  });
}

test("stripping a rejected file= leaves the other parameters alone", async () => {
  const w = fakeWindow("?zoom=150&file=javascript:alert(1)&pagemode=none");
  const { normalizeFileParam } = await load(w);
  normalizeFileParam();
  const params = new URLSearchParams(w.location.search);
  assert.equal(params.get("file"), null);
  assert.equal(params.get("zoom"), "150");
  assert.equal(params.get("pagemode"), "none");
});

test("a legitimate file= behind another parameter is left intact", async () => {
  const url = "https://host.example/paper.pdf";
  const w = fakeWindow(`?zoom=150&file=${encodeURIComponent(url)}`);
  const { normalizeFileParam } = await load(w);
  normalizeFileParam();
  assert.equal(asPdfJsReadsIt(w.location.search), url);
});

// The frame guard runs at module EVALUATION time, so it can only be observed by
// importing the module afresh. Node caches by resolved specifier, hence the
// query suffix: without it this test re-imports the copy the tests above already
// evaluated in an unframed window and asserts nothing about the guard. (It used
// to assert an inline copy of the condition instead, which passed no matter what
// the module did.)
const loadFresh = async (w, tag) => {
  globalThis.window = w;
  return import(`../../extension/viewer/file-param.mjs?${tag}`);
};

test("frame protection blocks execution when window.top !== window.self", async () => {
  const framed = fakeWindow("?file=https://example.com/test.pdf");
  framed.top = {}; // a different object: we are not the top-level document
  framed.self = framed;
  framed.stop = () => {};
  await assert.rejects(
    () => loadFresh(framed, "framed"),
    /embedding the PDF viewer in a frame is blocked/,
  );
});

test("a top-level document loads normally and still normalizes its parameter", async () => {
  const top = fakeWindow("?file=https://host.example/p.pdf?a=1&b=2");
  top.self = top;
  top.top = top;
  await assert.doesNotReject(() => loadFresh(top, "toplevel"));
  assert.equal(asPdfJsReadsIt(top.location.search), "https://host.example/p.pdf?a=1&b=2");
});

