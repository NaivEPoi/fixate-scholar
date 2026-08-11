// Multi-template smoke test: loads a set of real academic papers spanning the
// common publication templates in the extension viewer and reports per-paper
// typography and reference-parsing results.
//
// FIVE templates, identified from the PDFs themselves (page box, body size,
// leading, column extents, embedded fonts, publisher boilerplate, heading
// style) — several are represented by more than one paper, and the parenthesized
// part of a label is that paper's COVERAGE VARIANT, never a separate template:
//   USENIX ........ 612x792, 10pt/12, cols 54-296 + 318-560, Nimbus Roman +
//                   Nimbus Sans, numbered headings ("1 Introduction").
//                   3 papers, one template — verified identical on every one of
//                   those measurements. They differ in CONTENT: (baseline),
//                   (code + algorithms) = the math/table/algorithm/appendix
//                   workhorse most probes default to, and (no cover page) =
//                   front matter starting on page 1 with no proceedings cover.
//   ACM acmart .... 612x792, 9pt/11, same column grid, Linux Libertine body /
//                   Biolinum headings, ACM Reference Format + CCS Concepts +
//                   ISBN/DOI. 2 papers, one template: (full) and (short).
//   IEEE .......... IEEEtran, cols 49-300 + 312-563 (a tighter 12pt gutter than
//                   USENIX), "Abstract—" / "Index Terms—", roman-numeral
//                   headings. The two entries are the class's two real MODES:
//                   conference (no running head; this copy also carries a
//                   stamp overlay) and journal ("Member, IEEE" byline, running
//                   head with page number).
//   NeurIPS ....... its own style file: single column, Times, text block
//                   108-506, 10pt/11, NeurIPS proceedings footer.
//   LaTeX article . plain single column, Computer Modern, block 116-496, running
//                   heads, no publisher boilerplate.
// Hosting is not a template: three of these are arXiv preprints, each typeset in
// one of the above, so none is labelled "arXiv". Older entries in
// REVIEW_FINDINGS.md / REVIEW_LOG.md use the previous letter labels; TESTING.md
// carries the old→new mapping.
//
// Usage: node test/papers.mjs [path-to-browser]
// (Regular Chrome ≥137 ignores --load-extension; use Edge/Chromium.)

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { browserPath } from "./lib/env.mjs";

const FILTER = process.argv[3] ?? "";
// untouched: ground-truth texts known to live in data tables / algorithm
// listings of that paper — they must never be emphasized. processed:
// ground-truth body prose that MUST be emphasized (e.g. appendix text on a
// references-heavy page). Probe pages must be rendered by the refs/appendix
// navigation, so they should sit on late pages.
const PAPERS = [
  { template: "USENIX (baseline)", url: "https://yilud.me/usenixsecurity25-dong-yilu.pdf" },
  {
    template: "USENIX (code + algorithms)",
    url: "https://yilud.me/usenixsecurity24-tu.pdf",
    untouched: ["Snapdragon 865", "learning not terminate", "Network Traces ("],
    // Early probes run before refs-page navigation (their pages may get
    // virtualized away afterwards): the wrapped 2-line URL must be whole.
    untouchedEarly: ["com/SyNSec-den/5GBaseChecker"],
    processed: ["takes as input a set of UEs"],
    // Body prose on a mid content page (§2 Preliminaries, p4) — guards against
    // a whole content page being skipped by the block classifier.
    processedPage: 4,
    processedOnPage: ["primarily comprises three major", "consists of several Network"],
  },
  { template: "USENIX (no cover page)", url: "https://yilud.me/AFC_Attacks_NSDI.pdf" },
  { template: "ACM acmart (full)", url: "https://yilud.me/Proteus-ccs24.pdf" },
  { template: "ACM acmart (short)", url: "https://yilud.me/SIB-Auth.pdf" },
  { template: "IEEE conference (stamped)", url: "https://yilud.me/a33-dong%20stamped.pdf" },
  { template: "IEEE journal", url: "https://arxiv.org/pdf/2502.04915" },
  {
    // Single-column journal template, Computer Modern, math-dense, with a
    // running head on every page and an UNNUMBERED author-year bibliography
    // spanning four pages (R19). Both probe sets below are regression guards:
    // paragraphs broken by displayed equations were swept as tables, and the
    // bibliography's continuation pages were emphasized as body prose.
    template: "LaTeX article (CM)",
    url: "https://arxiv.org/pdf/quant-ph/9508027",
    // Bibliography entry titles: unnumbered, so the numeric-marker refsOk
    // check cannot see them — probe them directly.
    untouched: ["Oracle quantum computing", "Quantum circuit complexity"],
    processedPage: 17,
    processedOnPage: ["to reach the state", "that the above probability is", "where the sum is over all"],
  },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9337 + (process.pid % 150); // per-pid: a fixed port collides with zombie Edge listeners
const userDataDir = join(tmpdir(), `fx-papers-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(path, method = "GET") {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
  return res.json();
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (msg) =>
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result),
      );
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  close() {
    this.ws.close();
  }
}

const browser = spawn(
  browserPath("edge", process.argv[2]),
  [
    `--remote-debugging-port=${PORT}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--window-size=1400,1800",
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let failures = 0;

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    try {
      version = await http("/json/version");
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("debugger endpoint never came up");
  console.log(`Browser: ${version.Browser}\n`);

  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const targets = await http("/json/list");
    const sw = targets.find((t) => t.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(250);
  }
  if (!extId) throw new Error("extension did not load");

  const results = [];
  for (const paper of PAPERS.filter((p) => p.template.includes(FILTER))) {
    const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(paper.url)}`;
    const tab = await http(`/json/new?${viewerUrl}`, "PUT");
    const cdp = new CDP(tab.webSocketDebuggerUrl);
    await cdp.ready;
    await sleep(1500);
    await cdp.eval(`chrome.storage.sync.set({ enabled: true })`);

    let state = null;
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      try {
        state = await cdp.eval(`(() => ({
          pages: window.PDFViewerApplication?.pagesCount ?? 0,
          spans: document.querySelectorAll('.textLayer span').length,
          bolded: document.querySelectorAll('.textLayer .fx-b').length,
          masks: document.querySelectorAll('.fx-mask > div').length,
          cites: document.querySelectorAll('.fx-cite-hit').length,
          refs: globalThis.__fxRefCount ?? 0,
          refPages: (globalThis.__fxRefPages ?? []).length,
          fxOn: !!document.querySelector('#viewerContainer.fx-on'),
        }))()`);
      } catch {
        continue;
      }
      // refPages too: __fxRefCount is set when the bibliography is PARSED,
      // while the refs REGION (which protects it from processing, and which the
      // refsOk check below reads) is applied a few async steps later. Breaking
      // on refs alone raced that gap, and an empty region made refsOk report
      // `null` — a silent pass — on a different paper each run.
      if (state.bolded > 100 && state.refs > 0 && state.cites > 0 && state.refPages > 0) break;
    }

    // Early ground-truth probes, before navigation virtualizes early pages.
    let earlyOk = true;
    for (const probe of paper.untouchedEarly ?? []) {
      const hit = await cdp.eval(`(() => {
        const span = [...document.querySelectorAll('.textLayer span')]
          .find(s => s.textContent.includes(${JSON.stringify(probe)}));
        if (!span) return 'missing';
        return span.dataset.fxDone || span.querySelector('.fx-b') ? 'processed' : 'ok';
      })()`);
      if (hit !== "ok") {
        earlyOk = false;
        console.log(`      early probe ${hit}: ${probe}`);
      }
    }
    // Body prose that MUST be emphasized on a mid content page — catches a
    // whole content page skipped by mis-classification (navigate there first
    // so the page is rendered).
    if (paper.processedOnPage) {
      await cdp.eval(`(async () => {
        window.PDFViewerApplication.page = ${paper.processedPage};
        await new Promise(r => setTimeout(r, 3500));
      })()`);
      for (const probe of paper.processedOnPage) {
        const hit = await cdp.eval(`(() => {
          const span = [...document.querySelectorAll('.textLayer span')]
            .find(s => s.textContent.includes(${JSON.stringify(probe)}));
          if (!span) return 'missing';
          return span.dataset.fxDone || span.querySelector('.fx-b') ? 'ok' : 'unprocessed';
        })()`);
        if (hit !== "ok") {
          earlyOk = false;
          console.log(`      processed-on-page ${hit}: ${probe}`);
        }
      }
      await cdp.eval(`window.PDFViewerApplication.page = 1`);
    }

    // Deeper checks: embedded-font rendering, page-1 header exclusion,
    // heading (font-size) exclusion, URL/email exclusion — then force the
    // references pages to render and confirm they are left untouched.
    let checks = null;
    try {
      checks = await cdp.eval(`(async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const done = () => [...document.querySelectorAll('.textLayer span[data-fx-done]')];
        const out = {};

        // Original-font mode: processed spans must use the embedded FontFace.
        out.fontOk = done().length > 0 && done().every(s => /^"?g_/.test(s.style.fontFamily));

        // No processed span may be much larger than the median (headings).
        const sizes = done().map(s => parseFloat(getComputedStyle(s).fontSize)).sort((a, b) => a - b);
        const median = sizes[Math.floor(sizes.length / 2)];
        out.headingOk = sizes.every(s => s <= median * 1.3);

        // Section headings stay in their original form: no processed span may
        // begin with a section label — numbered ("9.2.3 Foo"), lettered
        // ("A1: Foo"), or roman ("IV. Foo"). Body-size subsection headings slip
        // past the size check above, so guard them explicitly.
        // Heading-shaped = starts with a section label AND is not a running
        // sentence (few lowercase words) — so body prose that merely opens with
        // a number ("2.4 GHz and 5 GHz bands have become …") is not flagged.
        const headingHit = (t) =>
          (t.match(/\\b[a-z]{2,}\\b/g) || []).length <= 3 &&
          (/^\\d+(?:\\.\\d+){1,3}\\.?\\s+[A-Z]/.test(t) ||
            /^[A-Z]\\d*[.:]\\s+[A-Z]/.test(t) || /^[IVX]{1,5}\\.\\s+[A-Z]/.test(t));
        out.headingClean = !done().some(s => headingHit(s.textContent.trim()));
        out.headingDirty = done().filter(s => headingHit(s.textContent.trim()))
          .slice(0, 5).map(s => s.textContent.trim().slice(0, 50));

        // Front matter: nothing processed before the Abstract heading —
        // neither on cover pages nor in the title/authors/emails block.
        out.headerOk = true;
        const cs = globalThis.__fxContentStart;
        if (cs) {
          const abstractPage = document.querySelector('.page[data-page-number="' + cs.page + '"]');
          const abstract = [...(abstractPage?.querySelectorAll('.textLayer span') ?? [])]
            .find(s => /^\\s*abstract\\s*$/i.test(s.textContent));
          const cut = abstract?.getBoundingClientRect().top ?? null;
          out.headerOk = !done().some(s => {
            const n = parseInt(s.closest('.page')?.dataset.pageNumber ?? '0', 10);
            if (n < cs.page) return true;
            if (n === cs.page && cut !== null) {
              return s.getBoundingClientRect().bottom < cut;
            }
            return false;
          });
        }

        // URLs/emails inside processed spans must carry no <b> in the link.
        out.linkOk = true;
        for (const s of done()) {
          const text = s.textContent;
          const m = /(?:https?:\\/\\/|www\\.|doi\\.org\\/)[^\\s]+|[^\\s@]+@[^\\s@]+\\.[A-Za-z]{2,}/.exec(text);
          if (!m) continue;
          let pos = 0;
          for (const node of s.childNodes) {
            const len = node.textContent.length;
            if (node.nodeName === 'B' && pos < m.index + m[0].length && pos + len > m.index) {
              out.linkOk = false;
            }
            pos += len;
          }
        }

        // Running headers/footers: nothing processed in the outer 5.5% bands.
        out.footerOk = !done().some(s => {
          const page = s.closest('.page');
          if (!page) return false;
          const pr = page.getBoundingClientRect();
          const r = s.getBoundingClientRect();
          const band = pr.height * 0.055;
          return r.top < pr.top + band || r.bottom > pr.bottom - band;
        });

        // Bibliography region: render its pages; no span that looks like a
        // reference entry start ("[18] Name ...") may be processed. Then the
        // last page (appendices, when present) must still be processed.
        // A paper with a parsed bibliography but NO region is a real failure,
        // not an inapplicable check: nothing would keep the reference list from
        // being emphasized. Only a document with no bibliography at all leaves
        // refsOk null.
        out.refsOk = (globalThis.__fxRefCount ?? 0) > 0 ? false : null;
        out.appendixOk = null;
        const refPages = globalThis.__fxRefPages ?? [];
        out.refPages = refPages.length;
        const app = window.PDFViewerApplication;
        if (refPages.length) {
          for (const p of refPages.slice(0, 3)) {
            app.page = p;
            await sleep(3000);
          }
          out.refsOk = !done().some(s =>
            /^\\[\\d{1,3}\\]\\s+\\p{Lu}/u.test(s.textContent) && s.textContent.length > 30);
          const last = app.pagesCount;
          if (!refPages.includes(last)) {
            app.page = last;
            await sleep(3500);
            const lastDiv = document.querySelector('.page[data-page-number="' + last + '"]');
            const lastSpans = lastDiv?.querySelectorAll('.textLayer span') ?? [];
            if (lastSpans.length > 40) {
              // Appendix prose must be processed — but a last page that is
              // entirely a RULED TABLE (e.g. a property/results table) is
              // correct with nothing processed: masking its cells would white
              // out the table rules. Accept either processed spans or a page
              // whose content was deliberately classified as table.
              const tabled = lastDiv.querySelectorAll('.textLayer span[data-fx-table]').length;
              out.appendixOk =
                !!lastDiv.querySelector('.textLayer span[data-fx-done]') ||
                tabled > lastSpans.length * 0.5;
            }
          }
          app.page = 1;
        }

        // Tables/listings: the engine marks tabular spans with
        // data-fx-table; none of those may also be processed, the marker
        // must actually fire somewhere in the corpus run, and the paper's
        // ground-truth probes must hold: "untouched" texts (table cells,
        // pseudocode) never emphasized, "processed" texts (body prose on
        // tricky pages) always emphasized.
        out.tableOk = !document.querySelector('.textLayer span[data-fx-table][data-fx-done]');
        out.tableMarked = document.querySelectorAll('.textLayer span[data-fx-table]').length;
        const spansAll = [...document.querySelectorAll('.textLayer span')];
        for (const probe of ${JSON.stringify(paper.untouched ?? [])}) {
          const cell = spansAll.find(s => s.textContent.includes(probe));
          if (!cell) {
            out.tableOk = false; // probe page should have rendered
            out.tableSample = ['probe missing: ' + probe];
          } else if (cell.dataset.fxDone || cell.querySelector('.fx-b')) {
            out.tableOk = false;
            out.tableSample = ['probe processed: ' + probe];
          }
        }
        out.proseOk = true;
        for (const probe of ${JSON.stringify(paper.processed ?? [])}) {
          const span = spansAll.find(s => s.textContent.includes(probe));
          if (!span || !span.dataset.fxDone) {
            out.proseOk = false;
            out.proseSample = (span ? 'unprocessed: ' : 'missing: ') + probe;
          }
        }

        // Coloring: citations and in-paper references get distinct colors
        // (sampled from the document or palette defaults) on processed text.
        const citeC = document.querySelector('span[data-fx-done] .fx-cite-c');
        const refC = document.querySelector('span[data-fx-done] .fx-ref-c');
        out.citeColored = citeC ? getComputedStyle(citeC).color : null;
        out.refColored = refC ? getComputedStyle(refC).color : null;
        out.colorOk =
          (!citeC || out.citeColored !== 'rgb(26, 26, 26)') &&
          (!refC || out.refColored !== 'rgb(26, 26, 26)');
        return out;
      })()`);
    } catch (e) {
      checks = { error: String(e.message ?? e) };
    }
    cdp.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); // plain-text response

    const checksOk =
      !!checks && !checks.error && earlyOk &&
      checks.fontOk && checks.headingOk && checks.headingClean && checks.headerOk && checks.linkOk &&
      checks.footerOk && checks.tableOk && checks.proseOk && checks.colorOk &&
      checks.refsOk !== false && checks.appendixOk !== false;
    const ok = !!state && state.pages > 0 && state.fxOn && state.bolded > 100 && checksOk;
    if (!ok) failures++;
    const warn =
      state && (state.refs === 0 ? " ⚠ no references parsed" : state.cites === 0 ? " ⚠ no citations linked" : "");
    results.push({ paper, state, ok, warn });
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${paper.template.padEnd(26)} ${JSON.stringify(state)} checks=${JSON.stringify(checks)}${warn}`,
    );
  }

  // Column width from the longest label actually printed — template names vary
  // in length, and a fixed width leaves the table ragged.
  const w = Math.max(8, ...results.map((r) => r.paper.template.length));
  console.log("\nSummary:");
  console.log(`${"Template".padEnd(w)} | pages | bolded | masks | refs | cites`);
  for (const { paper, state, ok } of results) {
    const s = state ?? {};
    console.log(
      `${paper.template.padEnd(w)} | ${String(s.pages ?? "-").padStart(5)} | ${String(s.bolded ?? "-").padStart(6)} | ${String(s.masks ?? "-").padStart(5)} | ${String(s.refs ?? "-").padStart(4)} | ${String(s.cites ?? "-").padStart(5)}${ok ? "" : "  << FAIL"}`,
    );
  }
} catch (e) {
  failures++;
  console.error("papers test error:", e);
} finally {
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* Edge still holds the profile */ }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PAPERS PASSED");
process.exit(failures ? 1 : 0);
