// The Google Scholar source's decisions that do not need a DOM: what counts as
// a refusal, and what the card's Scholar link looks like.
//
// The refusal cases are the ones that matter. Scholar does not always say no
// with an HTTP error — the common form is a 200 whose body is a captcha while
// the page header still claims "About 34 results". Parsed naively that is zero
// results, which the ladder would read as "Scholar has nothing", cache as a
// no-match for a week, and never retry.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ScholarRefused,
  scholarSearchUrl,
  searchScholar,
} from "../../extension/viewer/references/scholar.mjs";

const refused = async (body) => {
  await assert.rejects(
    () => searchScholar("applied pi calculus", async () => body),
    (e) => e instanceof ScholarRefused,
  );
};

test("a captcha served with HTTP 200 is a refusal, not an empty result set", async () => {
  await refused(
    `<html><body>SIGN IN Articles About 34 results (0.25 sec)
     Please show you're not a robot Privacy Terms Help</body></html>`,
  );
});

test("every wording Scholar has been seen to refuse with", async () => {
  await refused('<html><body><div id="gs_captcha_c"></div></body></html>');
  await refused("<html><body>Our systems have detected unusual traffic from your computer network.</body></html>");
  await refused("<html><body>… we have detected automated queries …</body></html>");
  await refused('<html><body><a href="/sorry/index?continue=…">continue</a></body></html>');
});

test("the search link the card shows is a link, not a lookup", () => {
  assert.equal(
    scholarSearchUrl("Applied pi calculus Ryan 2011"),
    "https://scholar.google.com/scholar?hl=en&q=Applied%20pi%20calculus%20Ryan%202011",
  );
});
