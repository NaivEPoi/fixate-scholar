// Multi-template smoke test: loads a set of real papers (USENIX, ACM, IEEE
// templates) in the extension viewer and reports per-paper typography and
// reference-parsing results.
//
// Usage: node test/papers.mjs [path-to-browser]
// (Regular Chrome ≥137 ignores --load-extension; use Edge/Chromium.)

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const FILTER = process.argv[3] ?? "";
// untouched: ground-truth texts known to live in data tables / algorithm
// listings of that paper — they must never be emphasized. processed:
// ground-truth body prose that MUST be emphasized (e.g. appendix text on a
// references-heavy page). Probe pages must be rendered by the refs/appendix
// navigation, so they should sit on late pages.
const PAPERS = [
  { template: "USENIX Sec'25", url: "https://yilud.me/usenixsecurity25-dong-yilu.pdf" },
  {
    template: "USENIX Sec'24",
    url: "https://yilud.me/usenixsecurity24-tu.pdf",
    untouched: ["Snapdragon 865", "learning not terminate", "Network Traces ("],
    // Early probes run before refs-page navigation (their pages may get
    // virtualized away afterwards): the wrapped 2-line URL must be whole.
    untouchedEarly: ["com/SyNSec-den/5GBaseChecker"],
    processed: ["takes as input a set of UEs"],
  },
  { template: "USENIX NSDI'26", url: "https://yilud.me/AFC_Attacks_NSDI.pdf" },
  { template: "ACM CCS'24", url: "https://yilud.me/Proteus-ccs24.pdf" },
  { template: "ACM WiSec'25", url: "https://yilud.me/SIB-Auth.pdf" },
  { template: "EW'25 (stamped)", url: "https://yilud.me/a33-dong%20stamped.pdf" },
  { template: "IEEE (arXiv)", url: "https://arxiv.org/pdf/2502.04915" },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9337;
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
  process.argv[2] || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
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
          fxOn: !!document.querySelector('#viewerContainer.fx-on'),
        }))()`);
      } catch {
        continue;
      }
      if (state.bolded > 100 && state.refs > 0 && state.cites > 0) break;
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
        out.refsOk = null;
        out.appendixOk = null;
        const refPages = globalThis.__fxRefPages ?? [];
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
              out.appendixOk = !!lastDiv.querySelector('.textLayer span[data-fx-done]');
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
      checks.fontOk && checks.headingOk && checks.headerOk && checks.linkOk &&
      checks.footerOk && checks.tableOk && checks.proseOk && checks.colorOk &&
      checks.refsOk !== false && checks.appendixOk !== false;
    const ok = !!state && state.pages > 0 && state.fxOn && state.bolded > 100 && checksOk;
    if (!ok) failures++;
    const warn =
      state && (state.refs === 0 ? " ⚠ no references parsed" : state.cites === 0 ? " ⚠ no citations linked" : "");
    results.push({ paper, state, ok, warn });
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${paper.template.padEnd(16)} ${JSON.stringify(state)} checks=${JSON.stringify(checks)}${warn}`,
    );
  }

  console.log("\nSummary:");
  console.log("Template         | pages | bolded | masks | refs | cites");
  for (const { paper, state, ok } of results) {
    const s = state ?? {};
    console.log(
      `${paper.template.padEnd(16)} | ${String(s.pages ?? "-").padStart(5)} | ${String(s.bolded ?? "-").padStart(6)} | ${String(s.masks ?? "-").padStart(5)} | ${String(s.refs ?? "-").padStart(4)} | ${String(s.cites ?? "-").padStart(5)}${ok ? "" : "  << FAIL"}`,
    );
  }
} catch (e) {
  failures++;
  console.error("papers test error:", e);
} finally {
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PAPERS PASSED");
process.exit(failures ? 1 : 0);
