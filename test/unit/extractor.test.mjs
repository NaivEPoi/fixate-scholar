import { test } from "node:test";
import assert from "node:assert/strict";

import { extractLines } from "../../extension/viewer/references/extractor.mjs";

// A stand-in for pdf.js's PDFDocumentProxy: extractLines only asks for
// numPages, each page's `view` box, and its text items.
function fakeDoc(pages) {
  return {
    numPages: pages.length,
    getPage: async (p) => ({
      view: [0, 0, 612, 792],
      getTextContent: async () => ({
        items: pages[p - 1].map(([str, x, y, w, h]) => ({
          str,
          width: w,
          height: h,
          transform: [h, 0, 0, h, x, y],
        })),
      }),
    }),
  };
}

test("a small-caps heading survives a neighbouring column's baseline", async () => {
  // IEEEtran sets "REFERENCES" as a 10pt "R" plus an 8pt "EFERENCES", and a
  // two-column bibliography puts the other column's lines a few points off
  // this one's baseline. Banding by the TALLER item let the 10pt "R" reach up
  // into the right column's previous line, 250pt away in x — the x-gap split
  // then stranded it as its own line and the heading became "EFERENCES".
  const lines = await extractLines(
    fakeDoc([
      [
        ["IEEE Trans. Mach. Learn. Commun. Netw.", 387.3, 584.1, 138.7, 7.97],
        ["R", 146.6, 578.75, 6.65, 9.96],
        ["EFERENCES", 153.75, 578.75, 48.65, 7.97],
        ["[1] G. Pan, Y. Gao, and S. Xu, “AI-driven wireless positioning,”", 52.9, 561.2, 233, 7.97],
      ],
    ]),
  );
  assert.ok(
    lines.some((l) => l.text === "REFERENCES"),
    `no intact heading in ${JSON.stringify(lines.map((l) => l.text))}`,
  );
});

test("a subscript still joins the line it hangs off", async () => {
  // The narrower band must not cost the case it exists for: small text sitting
  // just below the baseline of the words around it is part of that line.
  const lines = await extractLines(
    fakeDoc([
      [
        ["we recommend N", 49, 499, 62, 9.96],
        ["ref", 111.5, 496.8, 9, 6.97],
        ["= 20 or 30 for optimal accuracy", 121, 499, 120, 9.96],
      ],
    ]),
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /^we recommend Nref\s?= 20 or 30/);
});
