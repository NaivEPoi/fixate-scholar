// R25/G1 regression guard: the hidden-space wrappers must be applied exactly
// where they are needed, and must cost nothing geometrically.
//
// Some embedded subset fonts map U+0020 to their .notdef glyph — a filled box.
// The canvas rendering never asks the font for a space, but our overlay renders
// real text in that face, so on one private paper every inter-word gap painted
// as tofu and a whole body page became unreadable. The engine now probes the
// face and wraps whitespace in <span class="fx-sp">, which overlay.css paints
// transparent.
//
// Two things can go wrong, and one of them already did:
//   1. the wrapper is MISSING on a face that inks a space  → tofu is back;
//   2. the wrapper CHANGES the geometry → the first attempt left `.fx-sp` at
//      PDF.js's `display: block`, every hidden space contributed no inline
//      advance, and the words rendered jammed together — the boxes gone and the
//      gaps with them. That version passed every DOM oracle in the repo.
//
// So this checks both, on every page of a document, rather than one band by eye:
// the probe decides which spans NEED wrapping, and the geometry is compared
// against the same span with its wrappers stripped.
//
// Usage:
//   node test/wrapcheck.mjs [template]
//   node test/wrapcheck.mjs --url=<pdf url> [--label=name]
//   node local/sweep-private.mjs --script=test/wrapcheck.mjs

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { browserPath, extensionDir, profileDir } from "./lib/env.mjs";

const ARGV = process.argv.slice(2);
const PAPERS = {
  "USENIX (baseline)": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "USENIX (code + algorithms)": "https://yilud.me/usenixsecurity24-tu.pdf",
  "USENIX (no cover page)": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "ACM acmart (full)": "https://yilud.me/Proteus-ccs24.pdf",
  "ACM acmart (short)": "https://yilud.me/SIB-Auth.pdf",
  "IEEE conference (stamped)": "https://yilud.me/a33-dong%20stamped.pdf",
  "IEEE journal": "https://arxiv.org/pdf/2502.04915",
  NeurIPS: "https://arxiv.org/pdf/1706.03762",
  "LaTeX article (CM)": "https://arxiv.org/pdf/quant-ph/9508027",
  "5GCVerif": "https://yilud.me/5GCVerif-ccs23.pdf",
  "5GShield": "https://yilud.me/5GShield.pdf",
  "AFC-Diss": "https://yilud.me/afc_testing_DISS.pdf",
  ACL: "https://yilud.me/2026.acl-long.2136.pdf",
  "UC-Scheme": "https://yilud.me/UC_Scheme.pdf",
};
const URL_ARG = ARGV.find((a) => a.startsWith("--url="))?.slice(6);
const LABEL = ARGV.find((a) => a.startsWith("--label="))?.slice(8);
const FILTER =
  ARGV.find((a) => !a.startsWith("--") && !a.toLowerCase().endsWith(".exe")) ??
  "USENIX (code + algorithms)";
const TARGET = URL_ARG ?? PAPERS[FILTER];
const NAME = LABEL ?? (URL_ARG ? "url" : FILTER);
// A width difference this small is sub-pixel rounding, not a layout change.
const WIDTH_TOLERANCE = 0.5;
if (!TARGET) {
  console.error(`wrapcheck: unknown template ${JSON.stringify(FILTER)}`);
  console.error(`  templates: ${Object.keys(PAPERS).join(", ")}`);
  process.exit(2);
}

const PORT = 9821 + (process.pid % 100);
const userDataDir = profileDir("wrapcheck");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") =>
  (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(
  browserPath("edge"),
  [
    `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
    "--no-default-browser-check", "--disable-sync", "--window-size=1300,1900",
    `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`, "about:blank",
  ],
  { stdio: "ignore" },
);

let ws;
let nextId = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 60_000);
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", h);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""),
    );
  }
  return r.result.value;
};

// Runs in the page, once per rendered page view.
const CHECK = (pageIndex) => `(() => {
  const pv = window.PDFViewerApplication.pdfViewer.getPageView(${pageIndex});
  const div = pv && pv.textLayer && pv.textLayer.div;
  if (!div) return { spans: 0, notdefSpans: 0, unwrapped: [], strayWrap: 0, maxDelta: 0, worst: null };

  // Same measurement the engine makes: paint U+0020 in the span's own first
  // family and look for ink.
  const inkCache = new Map();
  const spaceInks = (family) => {
    const key = family.split(',')[0].trim();
    if (inkCache.has(key)) return inkCache.get(key);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#000'; g.font = '48px ' + family; g.textBaseline = 'alphabetic';
    g.fillText(' ', 4, 52);
    const d = g.getImageData(0, 0, 64, 64).data;
    let inks = false;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200) { inks = true; break; }
    inkCache.set(key, inks);
    return inks;
  };

  const out = { spans: 0, notdefSpans: 0, unwrapped: [], strayWrap: 0, maxDelta: 0, worst: null };
  for (const span of div.querySelectorAll('span[data-fx-done]')) {
    if (!/\\S/.test(span.textContent)) continue;
    out.spans++;
    const family = span.style.fontFamily || getComputedStyle(span).fontFamily;
    const inks = spaceInks(family);
    const wraps = span.querySelectorAll('.fx-sp').length;
    if (inks) {
      out.notdefSpans++;
      // Every whitespace run must sit inside a wrapper. Walk the text nodes
      // that are NOT inside one; any whitespace there would paint a box.
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement.closest('.fx-sp')) continue;
        if (/[ \\u00a0]/.test(n.data) && out.unwrapped.length < 5) {
          out.unwrapped.push(span.textContent.trim().slice(0, 40));
          break;
        }
      }
    } else if (wraps) {
      out.strayWrap++; // wrapped a face that never needed it
    }
    if (!wraps) continue;
    // Geometric neutrality: the same span without the wrappers must be the
    // same width. This is what caught display:block.
    const probe = span.cloneNode(true);
    for (const sp of probe.querySelectorAll('.fx-sp')) sp.replaceWith(sp.textContent);
    probe.style.position = 'absolute';
    probe.style.left = '-99999px';
    probe.style.top = '0';
    probe.style.width = 'auto';
    span.parentElement.appendChild(probe);
    const delta = Math.abs(probe.getBoundingClientRect().width - span.getBoundingClientRect().width);
    probe.remove();
    if (delta > out.maxDelta) {
      out.maxDelta = delta;
      out.worst = span.textContent.trim().slice(0, 40);
    }
  }
  return out;
})()`;

let failures = 0;
try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    try { version = await http("/json/version"); } catch { await sleep(250); }
  }
  if (!version) throw new Error("debugger endpoint never came up");
  await sleep(1200);

  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const targets = await http("/json/list");
    const sw = targets.find((t) => t.url.includes("background/service-worker.mjs"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(300);
  }
  if (!extId) throw new Error("extension did not load");

  const viewer = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(TARGET)}`;
  const tab = await http(`/json/new?${viewer}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(2500);
  await ev(`new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))`).catch(() => {});
  for (let i = 0; i < 40; i++) {
    await sleep(800);
    const n = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0);
    if (n > 60) break;
  }

  const pages = await ev(`window.PDFViewerApplication.pagesCount`);
  const total = { spans: 0, notdefSpans: 0, unwrapped: [], strayWrap: 0, maxDelta: 0, worst: null, seen: 0 };
  for (let p = 1; p <= pages; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`);
    await sleep(900);
    const r = await ev(CHECK(p - 1));
    if (!r || !r.spans) continue;
    total.seen++;
    total.spans += r.spans;
    total.notdefSpans += r.notdefSpans;
    total.strayWrap += r.strayWrap;
    for (const u of r.unwrapped) if (total.unwrapped.length < 5) total.unwrapped.push(`p${p}: ${u}`);
    if (r.maxDelta > total.maxDelta) { total.maxDelta = r.maxDelta; total.worst = `p${p}: ${r.worst}`; }
  }

  const delta = Math.round(total.maxDelta * 100) / 100;
  // "TOTALS" so the corpus sweeps echo this line: a sweep that prints only
  // PASS/FAIL cannot be told apart from one that measured nothing.
  console.log(
    `TOTALS pages=${total.seen}/${pages} spans=${total.spans} ` +
      `notdefFaceSpans=${total.notdefSpans} unwrapped=${total.unwrapped.length} ` +
      `strayWrap=${total.strayWrap} maxWidthDelta=${delta}px`,
  );
  if (total.unwrapped.length) {
    failures++;
    console.log("  FAIL unwrapped whitespace in a face that paints .notdef:");
    for (const u of total.unwrapped) console.log(`    ${u}`);
  }
  if (delta > WIDTH_TOLERANCE) {
    failures++;
    console.log(`  FAIL the wrappers changed the layout by ${delta}px — worst: ${total.worst}`);
  }
  console.log(failures ? `${NAME}: FAIL` : `${NAME}: PASS`);
} catch (e) {
  console.error("wrapcheck error:", e.message);
  failures++;
} finally {
  browser.kill();
  await sleep(400);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
process.exit(failures ? 1 : 0);
