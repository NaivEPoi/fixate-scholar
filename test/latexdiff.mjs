// Revision markup in reading mode, on a synthetic latexdiff-style page (R52).
//
// Builds its own two-page PDF (page 2, checked, repeats page 1) — invented words, Times-Roman — in which lines
// run black, deleted red with a stroked strike-out bar, and added blue with a
// stroked underline, colours changing inside one text item, down to the foot
// of the page. Then, at each zoom (and once while the viewer scrolls during
// the pass), checks:
//   colour — every processed span, and every coloured run inside one, is the
//            colour of the ink under it on the canvas (red, blue or neither);
//   bars   — no mask covers a strike-out or underline bar where the canvas
//            drew it: the masks are cut along every bar so its ink shows.
//
// Both failed in 1.3.2's first candidate: at 150% and 300% a capped canvas is
// squeezed into a CSS box a few px short of the page, and the bar cut followed
// the text layer, 2 px off the ink; and a pass that resumed after the page
// had scrolled sampled colours from where its spans used to be.
//
// Usage: node test/latexdiff.mjs [--zooms=1,1.5,2,3] [--keep] [--debug] [--pdf-out=<file>]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { rmSync } from "node:fs";

import { browserPath, devtoolsPort, extensionDir, killBrowser, profileDir } from "./lib/env.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const ZOOMS = arg("zooms", "1,1.5,2,3").split(",").map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- The page --------------------------------------------------------------
// Times-Roman advance widths (AFM, per 1000 em) for what the page uses.
const AFM = { a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278, j: 278, k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500, r: 333, s: 389, t: 278, u: 500, v: 500, w: 722, x: 500, y: 500, z: 444, " ": 250, ",": 250, ".": 250, "(": 333, ")": 333, "'": 333, "-": 333 };
const SIZE = 8;
const width = (t) => [...t].reduce((s, c) => s + (AFM[c] ?? 500), 0) * SIZE / 1000;
// Punctuation in every colour, and black marks right after coloured words: the
// runs around them must keep their colours. (Each mark's own colour is not
// checked: on this page's standard, unembedded font the text layer's character
// boxes drift off the canvas glyphs, so a mark's box is no ground truth.)
const WORDS = "the reader's line keeps (each) word in view, while the column moves on. every well-set word stays where the page put it, so nothing drifts across the measure.".split(" ");
let wi = 0;
const words = (n) => Array.from({ length: n }, () => WORDS[wi++ % WORDS.length]).join(" ");
const esc = (t) => t.replace(/[()\\]/g, (m) => "\\" + m);
const COL = { k: "0 0 0", r: "1 0 0", b: "0 0 1" };
// Each line: runs of [colour, word count] — or [colour, literal text]; red
// runs are struck, blue underlined. The literal "," and "." are black marks
// right after a coloured word.
const PATTERNS = [
  [["k", 3], ["r", 3], ["k", 2], ["b", 3]],
  [["r", 9]],
  [["k", 2], ["b", 4], ["k", ","], ["k", 3]],
  [["b", 8]],
  [["k", 4], ["r", 2], ["k", "."], ["b", 2], ["k", 1]],
];
function buildPdf() {
  let c = "";
  const bars = [];
  let row = 0;
  // Two dense columns, and on every other line each run its own text item (a
  // gap of a few ems between runs splits them): ~300 spans, more than one
  // batch of the pass, so it yields between idle callbacks — when a scroll can
  // come between its reads. The other lines keep their colours in one item.
  const GAP = 1000; // thousandths of an em, as a TJ adjustment
  for (const left of [54, 318]) for (let y = 756; y >= 40; y -= 10, row++) {
    const runs = PATTERNS[row % PATTERNS.length];
    const split = row % 2 === 1;
    let x = left;
    c += `BT /F1 ${SIZE} Tf ${x} ${y} Td\n`;
    // A literal mark joins the word before it: no space, and no gap, in between.
    const gapAfter = (i) => split && i < runs.length - 1 && typeof runs[i + 1][1] !== "string";
    const pieces = runs.map(([col, n], i) => [col, (typeof n === "string" ? n : words(n)) + (i < runs.length - 1 && typeof runs[i + 1][1] !== "string" ? " " : "")]);
    pieces.forEach(([col, text], i) => {
      c += `${COL[col]} rg [(${esc(text)})${gapAfter(i) ? ` -${GAP}` : ""}] TJ\n`;
    });
    c += "ET\n";
    pieces.forEach(([col, text], i) => {
      const w = width(text.trimEnd());
      if (col === "r") bars.push({ kind: "strike", x0: x, x1: x + w, y: y + SIZE * 0.25, col });
      if (col === "b") bars.push({ kind: "under", x0: x, x1: x + w, y: y - 1.5, col });
      x += width(text) + (gapAfter(i) ? (GAP * SIZE) / 1000 : 0);
    });
  }
  for (const b of bars) c += `${COL[b.col]} RG 0.4 w ${b.x0.toFixed(2)} ${b.y.toFixed(2)} m ${b.x1.toFixed(2)} ${b.y.toFixed(2)} l S\n`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${c.length} >>\nstream\n${c}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
    // Page 2, the one checked, is the same page again: its pass starts while it
    // only peeks in under page 1, and the jump to it moves it mid-pass.
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 7 0 R >> >> /Contents 4 0 R >>",
    // A second font object, the same face: a switch between the two ends a text item.
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
  ];
  let s = "%PDF-1.4\n";
  const off = [];
  objs.forEach((o, i) => { off.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { pdf: Buffer.from(s, "latin1"), bars };
}

// --- The checks, run in the viewer page ---------------------------------------
// Colour classes and the canvas read are deliberately crude: the page has only
// pure red, pure blue and black ink.
const AUDIT = (bars) => `(() => {
  const DEBUG = ${process.argv.includes('--debug')};
  const pg = document.querySelector('.page[data-page-number="2"]');
  const pv = PDFViewerApplication.pdfViewer.getPageView(1);
  const cv = pv.canvas, cr = cv.getBoundingClientRect(), kx = cv.width / cr.width, ky = cv.height / cr.height;
  const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
  const cx = c2.getContext('2d'); cx.drawImage(cv, 0, 0);
  const D = cx.getImageData(0, 0, cv.width, cv.height).data;
  const px = (X, Y) => { const i = (Y * cv.width + X) * 4; return [D[i], D[i + 1], D[i + 2]]; };
  const cls = (r, g, b) => r > 150 && g < 110 && b < 110 ? 'red' : b > 150 && r < 110 && g < 110 ? 'blue' : 'n';
  // A thin bar is anti-aliased across rows, so it is told by its hue, not its depth.
  const hue = (r, g, b) => r - Math.max(g, b) > 60 ? 'red' : b - Math.max(r, g) > 60 ? 'blue' : 'n';
  const rgb = (s) => (s.match(/[0-9]+/g) || []).map(Number);
  const inkUnder = (rc) => {
    const h = { red: 0, blue: 0, n: 0 }; let ink = 0;
    const y0 = Math.round((rc.top + rc.height * 0.3 - cr.top) * ky), y1 = Math.round((rc.bottom - rc.height * 0.3 - cr.top) * ky);
    for (let Y = y0; Y < y1; Y++) for (let X = Math.round((rc.left - cr.left) * kx); X < Math.round((rc.right - cr.left) * kx); X++) {
      const [R, G, B] = px(X, Y);
      if (0.299 * R + 0.587 * G + 0.114 * B > 170) continue;
      ink++; h[cls(R, G, B)]++;
    }
    return ink < 12 ? null : h.red > ink * 0.4 ? 'red' : h.blue > ink * 0.4 ? 'blue' : 'n';
  };
  const out = { spans: 0, runs: 0, bad: [], points: 0, covered: [] };
  for (const sp of pg.querySelectorAll('.textLayer > span')) {
    const b = sp.querySelector('.fx-b');
    if (!b) continue;
    const inks = [...sp.querySelectorAll('fx-ink')];
    if (!inks.length) {
      const got = inkUnder(sp.getBoundingClientRect());
      if (!got) continue;
      out.spans++;
      const want = cls(...rgb(getComputedStyle(b).color));
      if (want !== got) out.bad.push(['span', sp.textContent.slice(0, 20), want, got]);
      continue;
    }
    for (const el of inks) {
      // The run as a whole: emphasis splits it into fragments, and a one-letter
      // fragment read alone lands on the gap beside its ink.
      for (const rc of [el.getBoundingClientRect()]) {
        if (rc.width < 12 || el.textContent.trim().length < 3) continue;
        const got = inkUnder(rc);
        if (!got) continue;
        out.runs++;
        const want = cls(...rgb(el.style.color || getComputedStyle(el).color));
        if (want !== got) {
          out.bad.push(['run', el.textContent.slice(0, 20), want, got]);
          if (DEBUG && !out.cdbg) {
            const words = []; const tw = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT); let n;
            while ((n = tw.nextNode())) { const re = /[^ ]+/g; let m; while ((m = re.exec(n.data))) { const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length); words.push([m[0], inkUnder(rg.getBoundingClientRect())]); } }
            out.cdbg = { span: sp.textContent, inks: inks.map((q) => [q.textContent, q.style.color]), words };
          }
        }
      }
    }
  }
  // Bars: find each one's ink on the canvas near where the page put it — a row
  // its colour runs along, not a glyph's stroke — then ask whether a mask covers it.
  const masks = [...pg.querySelectorAll('.fx-mask > div')].map((m) => m.getBoundingClientRect());
  const vp = pv.viewport;
  for (const bar of ${JSON.stringify(bars)}) {
    const want = bar.col === 'r' ? 'red' : 'blue';
    for (let f = 0.1; f < 0.95; f += 0.1) {
      const [vx, vy] = vp.convertToViewportPoint(bar.x0 + (bar.x1 - bar.x0) * f, bar.y);
      const X = Math.round(vx * cv.width / vp.width);
      const yc = vy * cv.height / vp.height;
      let best = null;
      for (let Y = Math.floor(yc - 6 * ky); Y <= Math.ceil(yc + 6 * ky); Y++) {
        if (Y < 0 || Y >= cv.height || X < 0 || X >= cv.width) continue;
        // A bar, not a glyph: its colour runs along the row.
        let run = 0;
        for (let d = -4; d <= 4; d++) { const q = px(X + d, Y); if (hue(q[0], q[1], q[2]) === want) run++; }
        if (run < 8) continue;
        if (best === null || Math.abs(Y - yc) < Math.abs(best - yc)) best = Y;
      }
      if (best === null) continue;
      out.points++;
      const sx = cr.left + (X + 0.5) / kx, sy = cr.top + (best + 0.5) / ky;
      if (masks.some((m) => sx >= m.left && sx <= m.right && sy >= m.top && sy <= m.bottom)) {
        out.covered.push([bar.kind, Math.round(bar.y * 10) / 10, Math.round(f * 10) / 10]);
        if (DEBUG && !out.dbg) {
          const m = masks.find((q) => sx >= q.left && sx <= q.right && sy >= q.top && sy <= q.bottom);
          const near = [...pg.querySelectorAll('.textLayer > span')].map((q) => [q, q.getBoundingClientRect()]).filter(([, r]) => r.top - 12 < sy && r.bottom + 12 > sy && r.left - 5 < sx && r.right + 5 > sx).map(([q, r]) => [q.textContent.slice(0, 24), q.dataset.fxWhy || '', !!q.querySelector('.fx-b'), [r.left, r.top, r.right, r.bottom].map(Math.round)]);
          const tl = pg.querySelector('.textLayer').getBoundingClientRect();
          const col = masks.filter((q) => sx >= q.left && sx <= q.right && q.bottom > sy - 25 && q.top < sy + 25).map((q) => [q.top, q.bottom].map((v) => Math.round(v * 10) / 10));
          out.dbg = { bar, expectY: Math.round((tl.top + vy) * 10) / 10, canvasY: Math.round(sy * 10) / 10, point: [Math.round(sx), Math.round(sy * 10) / 10], col, near };
        }
      }
    }
  }
  return JSON.stringify(out);
})()`;

// --- Run ------------------------------------------------------------------------
const { pdf, bars } = buildPdf();
const pdfOut = arg("pdf-out", null);
if (pdfOut) { (await import("node:fs")).writeFileSync(pdfOut, pdf); console.log(`wrote ${pdfOut}`); process.exit(0); }
const server = createServer((req, res) => {
  if (req.url !== "/latexdiff.pdf") { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": pdf.length, "Access-Control-Allow-Origin": "*" });
  res.end(pdf);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pdfUrl = `http://127.0.0.1:${server.address().port}/latexdiff.pdf`;

const udd = profileDir("latexdiff");
const since = Date.now();
const browser = spawn(browserPath("edge"), [
  "--remote-debugging-port=0", "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-sync", "--window-size=1400,2000", `--user-data-dir=${udd}`,
  `--load-extension=${extensionDir}`, `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });

let failed = 0;
try {
  const port = await devtoolsPort(udd, since);
  const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${port}${p}`, { method: m })).json();
  let sw;
  for (let i = 0; i < 100 && !sw; i++) {
    sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (!sw) await sleep(200);
  }
  if (!sw) throw new Error("extension service worker never appeared");
  const ext = new URL(sw.url).hostname;

  const runs = [...ZOOMS.map((z) => ({ zoom: z, jitter: 0 })), { zoom: 1, jitter: 45 }, { zoom: 1.5, jitter: 45 }];
  for (const run of runs) {
    const tab = await http(`/json/new?chrome-extension://${ext}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`, "PUT");
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const send = (method, params = {}) => new Promise((res, rej) => {
      const my = ++id;
      const h = (e) => { const m = JSON.parse(e.data); if (m.id === my) { ws.removeEventListener("message", h); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
      ws.addEventListener("message", h);
      ws.send(JSON.stringify({ id: my, method, params }));
    });
    const ev = async (x) => {
      const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300));
      return r.result.value;
    };
    for (let i = 0; i < 60; i++) { if (await ev("!!window.PDFViewerApplication?.pdfDocument")) break; await sleep(250); }
    await ev("globalThis.__fxDebug = true; new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))");
    await ev(`PDFViewerApplication.pdfViewer.currentScale = ${run.zoom}; PDFViewerApplication.page = 1; 1`);
    if (run.jitter) {
      // Page 2 starts its pass while it peeks in under page 1 — then jump to it.
      for (let i = 0; i < 150; i++) {
        if (await ev(`document.querySelectorAll('.page[data-page-number="2"] span[data-fx-done]').length > 0`)) break;
        await sleep(30);
      }
    }
    await ev("PDFViewerApplication.page = 2; 1");
    if (run.jitter) {
      // Scroll back and forth while the pass runs, and end 37 px from where it
      // started: every batch after the first then sees the page moved.
      await ev(`(() => { const c = document.getElementById('viewerContainer'); let n = 0; const t = setInterval(() => { c.scrollTop += (n % 2 ? -${run.jitter} : ${run.jitter}); if (++n >= 120) { clearInterval(t); c.scrollTop += 37; } }, 17); return 1; })()`);
    }
    // Settled: the span count of the page stops changing, and a few more seconds
    // for the colour and mask passes behind it.
    let last = -1, stable = 0;
    for (let i = 0; i < 80 && stable < 4; i++) {
      await sleep(400);
      const n = await ev(`document.querySelectorAll('.page[data-page-number="2"] span[data-fx-done]').length`);
      stable = n === last && n > 0 ? stable + 1 : 0;
      last = n;
    }
    await sleep(2500);
    const out = JSON.parse(await ev(AUDIT(bars)));
    if (process.argv.includes('--debug')) console.log('   passes', await ev(`JSON.stringify((globalThis.__fxTiming || []).filter((t) => t.page === 2).map((t) => [t.total, t.chunks.filter((c) => c > 0).length, t.chunks.join(',')]))`));
    const label = `zoom ${run.zoom}${run.jitter ? ", scrolling" : ""}`;
    const ok = out.spans + out.runs > 20 && out.points > 40 && !out.bad.length && !out.covered.length;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label}: colour ${out.spans} spans + ${out.runs} runs, ${out.bad.length} wrong; bars ${out.points} points, ${out.covered.length} covered`);
    for (const b of out.bad.slice(0, 6)) console.log("   colour", JSON.stringify(b));
    for (const b of out.covered.slice(0, 6)) console.log("   covered", JSON.stringify(b));
    if (out.dbg) console.log("   debug", JSON.stringify(out.dbg));
    if (out.cdbg) console.log("   colour debug", JSON.stringify(out.cdbg));
    ws.close();
    await http(`/json/close/${tab.id}`).catch(() => {});
  }
} catch (e) {
  failed++;
  console.log("FAIL (harness):", e.message);
} finally {
  killBrowser(browser);
  server.close();
  await sleep(500);
  if (!process.argv.includes("--keep")) try { rmSync(udd, { recursive: true, force: true }); } catch { /* still held */ }
}
console.log(failed ? `latexdiff: ${failed} FAIL` : "latexdiff: PASS");
process.exit(failed ? 1 : 0);
