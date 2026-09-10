// The four sources' payloads → the one card shape, and the identifiers that
// let a lookup skip searching altogether. No network: every payload here is
// hand-written in the shape the API documents.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arxivId,
  cleanDoi,
  crossrefWork,
  extractBibtexDoi,
  fetchBibtex,
  isDisplayComplete,
  lookupReference,
  openAlexAbstract,
  openAlexWork,
  resolveDoi,
  scholarSearchUrl,
  openAireWork,
  stripJats,
} from "../../extension/viewer/references/sources.mjs";
import { bestMatch, scoreResult } from "../../extension/viewer/references/matching.mjs";

const RS11 = {
  title: "Applied pi calculus",
  surname: "Ryan",
  year: "2011",
};

test("a Crossref record becomes a card, byline and all", () => {
  const card = crossrefWork({
    DOI: "10.1007/978-1-4419-1000-9_6",
    title: ["Applied pi calculus"],
    author: [
      { given: "Mark D.", family: "Ryan" },
      { given: "Ben", family: "Smyth" },
    ],
    issued: { "date-parts": [[2011, 3]] },
    "container-title": ["Formal Models and Techniques for Analyzing Security Protocols"],
    abstract: "<jats:p>A calculus for security protocols.</jats:p>",
    "is-referenced-by-count": 412,
    URL: "https://doi.org/10.1007/978-1-4419-1000-9_6",
  });
  assert.equal(card.title, "Applied pi calculus");
  assert.equal(card.source, "Crossref");
  assert.equal(card.year, 2011);
  assert.deepEqual(card.authors, ["Mark D. Ryan", "Ben Smyth"]);
  assert.equal(
    card.byline,
    "Mark D. Ryan, Ben Smyth - Formal Models and Techniques for Analyzing Security Protocols - 2011",
  );
  assert.equal(card.snippet, "A calculus for security protocols.");
  assert.equal(card.citedBy, "Cited by 412");
  assert.equal(card.doi, "10.1007/978-1-4419-1000-9_6");
  // …and it verifies against the reference it was fetched for.
  assert.equal(bestMatch([card], RS11), card);
});

test("an OpenAlex work becomes a card, with the open-access PDF and the count", () => {
  const card = openAlexWork({
    id: "https://openalex.org/W2100837269",
    doi: "https://doi.org/10.1145/359657.359659",
    display_name: "A logic of authentication",
    authorships: [
      { author: { display_name: "Michael Burrows" } },
      { raw_author_name: "Martin Abadi" },
    ],
    publication_year: 1990,
    primary_location: { source: { display_name: "ACM Transactions on Computer Systems" } },
    best_oa_location: { pdf_url: "https://www.example.org/papers/ban.pdf" },
    cited_by_count: 3771,
    abstract_inverted_index: { Authentication: [0], is: [1], "essential.": [2] },
  });
  assert.equal(card.source, "OpenAlex");
  assert.equal(card.pdfUrl, "https://www.example.org/papers/ban.pdf");
  assert.equal(card.pdfHost, "example.org");
  assert.equal(card.citedBy, "Cited by 3771");
  assert.equal(card.doi, "10.1145/359657.359659");
  assert.equal(card.snippet, "Authentication is essential.");
  // A reprint a year off the entry still verifies (matching.mjs allows ±1).
  const ref = { title: "A logic of authentication", surname: "Burrows", year: "1989" };
  assert.equal(bestMatch([card], ref), card);
});

test("a structured author list is what the author check reads", () => {
  // The venue must not be able to supply the author, nor a year: with
  // structured fields present, only they count.
  const card = openAlexWork({
    display_name: "Applied pi calculus",
    authorships: [{ author: { display_name: "Mark D. Ryan" } }],
    publication_year: 2011,
    primary_location: { source: { display_name: "Smyth Institute Proceedings 1999" } },
  });
  assert.equal(scoreResult(card, RS11).authorOk, true);
  assert.equal(scoreResult(card, { ...RS11, surname: "Smyth", year: "1999" }).yearOk, false);
});

test("an arXiv id is found in either form, and only when it is one", () => {
  assert.equal(arxivId("… (2024). arXiv:2409.02905 [cs.CR]"), "2409.02905");
  assert.equal(arxivId("R. P. Jover. arXiv:1607.05171v2"), "1607.05171v2");
  assert.equal(arxivId("P. Shor, arXiv:quant-ph/9508027"), "quant-ph/9508027");
  assert.equal(arxivId("arXiv preprint, no id given"), null);
  assert.equal(arxivId("published in arXiv Vol 3"), null);
});

test("a DOI is cleaned of the punctuation a sentence leaves on it", () => {
  assert.equal(cleanDoi("https://doi.org/10.1109/32.481513."), "10.1109/32.481513");
  assert.equal(cleanDoi("10.1007/978-3-540-30576-7_5)"), "10.1007/978-3-540-30576-7_5");
  assert.equal(cleanDoi("10.1145/359657.359659"), "10.1145/359657.359659");
  // Case-insensitive by spec, and both APIs index them lowercased.
  assert.equal(cleanDoi("10.1109/SP.2019.00095"), "10.1109/sp.2019.00095");
  assert.equal(cleanDoi("not a doi"), null);
  assert.equal(cleanDoi(null), null);
});

test("an abstract survives both of the shapes it arrives in", () => {
  assert.equal(
    stripJats("<jats:title>Abstract</jats:title><jats:p>One <jats:italic>two</jats:italic>.</jats:p>"),
    "One two .",
  );
  assert.equal(stripJats(null), "");
  // OpenAlex stores position lists; out of order is the normal case.
  assert.equal(openAlexAbstract({ world: [1], hello: [0] }), "hello world");
  assert.equal(openAlexAbstract(null), "");
});

test("a record with no title is not a card", () => {
  assert.equal(crossrefWork({ DOI: "10.1/x" }), null);
  assert.equal(openAlexWork({ id: "https://openalex.org/W1" }), null);
  assert.equal(crossrefWork(null), null);
});

test("the Google Scholar pill is a link, not a lookup", () => {
  assert.equal(
    scholarSearchUrl("Applied pi calculus Ryan 2011"),
    "https://scholar.google.com/scholar?hl=en&q=Applied%20pi%20calculus%20Ryan%202011",
  );
});

test("an OpenAIRE result becomes a card — the venues that register no DOI", () => {
  // Its JSON wraps values as {$: …} and ranks the authors out of order; a
  // DBLP-collected title carries a trailing period the real title does not.
  const card = openAireWork({
    metadata: {
      "oaf:entity": {
        "oaf:result": {
          title: { $: "ORANalyst: Systematic Testing Framework for Open RAN Implementations." },
          creator: [
            { "@rank": "2", $: "Syed Md. Mukit Rashid" },
            { "@rank": "1", $: "Tianchang Yang" },
          ],
          children: {
            instance: {
              webresource: {
                url: { $: "https://www.usenix.org/conference/usenixsecurity24/presentation/yang-tianchang" },
              },
            },
          },
        },
      },
    },
  });
  assert.equal(card.source, "OpenAIRE");
  assert.equal(card.title, "ORANalyst: Systematic Testing Framework for Open RAN Implementations");
  assert.deepEqual(card.authors, ["Tianchang Yang", "Syed Md. Mukit Rashid"]);
  // The venue's own page is the link — and it is not a PDF, so no [PDF] pill.
  assert.equal(
    card.url,
    "https://www.usenix.org/conference/usenixsecurity24/presentation/yang-tianchang",
  );
  assert.equal(card.pdfUrl, null);
  // It verifies on title and first author, with no year in the record at all —
  // and this entry's year was misparsed, so the match must not need it.
  const ref = {
    title: "ORANalyst: Systematic testing framework for open RAN implementations",
    surname: "Yang",
    year: "1921",
  };
  assert.equal(bestMatch([card], ref), card);
  assert.equal(openAireWork({}), null);
});

test("a registered SHORT title matches, but only with the author and year to back it", () => {
  // OpenAlex holds "Breaking and Fixing VoLTE" for a paper the bibliography
  // prints in full. A prefix agreement alone must not be enough.
  const ref = {
    title: "Breaking and fixing volte: Exploiting hidden data channels and misimplementations",
    surname: "Kim",
    year: "2015",
  };
  const short = openAlexWork({
    display_name: "Breaking and Fixing VoLTE",
    authorships: [{ author: { display_name: "Hongil Kim" } }],
    publication_year: 2015,
  });
  assert.equal(bestMatch([short], ref), short);
  // Same short title, a different paper's authors and year: rejected.
  const other = openAlexWork({
    display_name: "Breaking and Fixing VoLTE",
    authorships: [{ author: { display_name: "Someone Else" } }],
    publication_year: 1999,
  });
  assert.equal(bestMatch([other], ref), null);
  assert.equal(scoreResult(short, ref).prefix, true);
});

test("fetchBibtex returns null when no key can be derived", async () => {
  assert.equal(await fetchBibtex(null, null, null), null);
});

test("fetchBibtex queries Google Scholar cite dialog by default when cid is present", async () => {
  const origFetch = globalThis.fetch;
  const origDOMParser = globalThis.DOMParser;
  try {
    globalThis.DOMParser = class {
      parseFromString(html) {
        return {
          querySelectorAll(selector) {
            if (selector === "a.gs_citi") {
              return [
                {
                  textContent: "BibTeX",
                  getAttribute: () => "/scholar.bib?q=info:mock123:scholar.google.com/&output=citation",
                },
              ];
            }
            return [];
          },
        };
      }
    };
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("output=cite")) {
        return { ok: true, text: async () => `<a class="gs_citi" href="/scholar.bib?q=info:mock123">BibTeX</a>` };
      }
      if (String(url).includes("scholar.bib")) {
        return { ok: true, text: async () => `@article{mock,\n  title={Mock Paper}\n}` };
      }
      return { ok: false, status: 404 };
    };

    const bib = await fetchBibtex("10.1234/some.doi", { cid: "mock123", doi: "10.1234/some.doi" });
    assert.match(bib, /^@article\{mock/);
    assert(calls.some((u) => u.includes("scholar.google.com/scholar?q=info:mock123")), "Scholar cite dialog called first");
  } finally {
    globalThis.fetch = origFetch;
    globalThis.DOMParser = origDOMParser;
  }
});

test("fetchBibtex falls back to Crossref DOI when Scholar fails or returns no bibtex", async () => {
  const origFetch = globalThis.fetch;
  const origDOMParser = globalThis.DOMParser;
  try {
    globalThis.DOMParser = class {
      parseFromString() {
        return { querySelectorAll: () => [] };
      }
    };
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("scholar.google.com")) {
        return { ok: false, status: 503 };
      }
      if (String(url).includes("api.crossref.org")) {
        return { ok: true, text: async () => `@article{crossref,\n  title={Crossref Paper}\n}` };
      }
      return { ok: false, status: 404 };
    };

    const bib = await fetchBibtex("10.9999/fallback.doi", { cid: "mock_fail", doi: "10.9999/fallback.doi" });
    assert.match(bib, /^@article\{crossref/);
    assert(calls.some((u) => u.includes("api.crossref.org")), "Crossref fallback called when Scholar fails");
  } finally {
    globalThis.fetch = origFetch;
    globalThis.DOMParser = origDOMParser;
  }
});

test("extractBibtexDoi parses DOIs from BibTeX fields", () => {
  assert.equal(
    extractBibtexDoi("@article{ex1,\n  title={A},\n  doi={10.1145/359657.359659}\n}"),
    "10.1145/359657.359659",
  );
  assert.equal(
    extractBibtexDoi("@article{ex2,\n  title={B},\n  url={https://doi.org/10.1007/s10207-020-00508-8}\n}"),
    "10.1007/s10207-020-00508-8",
  );
  assert.equal(
    extractBibtexDoi('@article{ex3,\n  title={C},\n  doi = "10.1016/j.jss.2021.111000",\n}'),
    "10.1016/j.jss.2021.111000",
  );
  assert.equal(extractBibtexDoi("@article{ex4,\n  title={No DOI}\n}"), null);
  assert.equal(extractBibtexDoi(null), null);
});

test("resolveDoi discovers DOI via Crossref bibliographic search when target has no DOI", async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes("api.crossref.org")) {
        return {
          ok: true,
          json: async () => ({
            message: {
              items: [
                {
                  DOI: "10.1145/359657.359659",
                  title: ["Applied pi calculus"],
                  author: [{ family: "Ryan" }],
                  issued: { "date-parts": [[2011]] },
                },
              ],
            },
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    const target = { title: "Applied pi calculus", surname: "Ryan", year: 2011 };
    const doi = await resolveDoi(target);
    assert.equal(doi, "10.1145/359657.359659");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("isDisplayComplete identifies records with all user-displayed fields", () => {
  const complete = {
    title: "Attention Is All You Need",
    byline: "A Vaswani, N Shazeer - 2017",
    snippet: "The dominant sequence transduction models...",
    citedBy: "Cited by 120000",
    pdfUrl: "https://proceedings.neurips.cc/paper/file.pdf",
    doi: "10.5555/3295222.3295349",
  };
  assert.equal(isDisplayComplete(complete), true);

  const scholarComplete = {
    title: "Attention Is All You Need",
    authors: ["Vaswani"],
    year: 2017,
    snippet: "The dominant sequence transduction models...",
    citedBy: "Cited by 120000",
    pdfUrl: "https://proceedings.neurips.cc/paper/file.pdf",
  };
  assert.equal(isDisplayComplete(scholarComplete), true);

  const missingSnippet = { ...complete, snippet: "" };
  assert.equal(isDisplayComplete(missingSnippet), false);

  const missingTitle = { ...complete, title: "" };
  assert.equal(isDisplayComplete(missingTitle), false);

  const bareRef = {
    title: "Attention Is All You Need",
    authors: ["Vaswani"],
    year: 2017,
    doi: "10.5555/3295222.3295349",
  };
  assert.equal(isDisplayComplete(bareRef), false);
  assert.equal(isDisplayComplete(null), false);
});

test("do not send request to crossref when everything displayed to user is available", async () => {
  const origFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return { ok: false, status: 500 };
    };

    const completeTarget = {
      title: "Attention Is All You Need",
      byline: "A Vaswani, N Shazeer - 2017",
      snippet: "The dominant sequence transduction models...",
      citedBy: "Cited by 120000",
      pdfUrl: "https://proceedings.neurips.cc/paper/file.pdf",
      doi: "10.5555/3295222.3295349",
    };

    // resolveDoi skips Crossref when target is display-complete
    const doi = await resolveDoi(completeTarget);
    assert.equal(doi, "10.5555/3295222.3295349");
    assert.equal(calls.filter((u) => u.includes("api.crossref.org")).length, 0, "No Crossref requests when display-complete");

    // lookupReference skips network lookup when ref is display-complete
    const preview = await lookupReference(completeTarget);
    assert.equal(preview.title, "Attention Is All You Need");
    assert.equal(preview.doi, "10.5555/3295222.3295349");
    assert.equal(calls.length, 0, "Zero network calls made");
  } finally {
    globalThis.fetch = origFetch;
  }
});


