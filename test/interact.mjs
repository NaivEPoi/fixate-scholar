// Focused interaction checks on one content page: internal-ref link nav
// (issue 4), citation hit-target alignment with the colored [X] (issue 5), and
// text selectability over body + citations (issue 8).
// Usage: node test/interact.mjs [template] [page]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ARGS = process.argv.slice(2);
const FILTER = ARGS[0] ?? "Two-column B";
const PAGE = parseInt(ARGS[1] ?? "10", 10);
const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "Two-column C": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "arXiv": "https://arxiv.org/pdf/2502.04915",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9345;
const userDataDir = join(tmpdir(), `fx-interact-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,1800",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const t = await http("/json/list");
    const sw = t.find((x) => x.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(250);
  }
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`;
  const tab = await http(`/json/new?${viewerUrl}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await sleep(2500);
  await ev(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 30; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 50) break; }
  await ev(`window.PDFViewerApplication.page = ${PAGE}`);
  await sleep(2500);

  const out = await ev(`(() => {
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const div = pv.textLayer.div;
    const ov = (a, b) => { const w = Math.min(a.right,b.right)-Math.max(a.left,b.left); const h = Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top); return w>0&&h>0?w*h:0; };

    // (4) Internal links: text under each, pointerEvents, overlaps a cite hit.
    const layer = pv.div.querySelector(".annotationLayer");
    const citeHits = [...pv.div.querySelectorAll(".fx-cite-hit")].map((a) => a.getBoundingClientRect());
    const links = [];
    if (layer) for (const a of layer.querySelectorAll("a")) {
      const href = a.getAttribute("href") || "";
      const internal = !/^(https?|mailto|tel):/i.test(href);
      const r = a.getBoundingClientRect();
      if (!r.width) continue;
      // text under the link rect
      let txt = "";
      for (const s of div.querySelectorAll("span")) { if (s.querySelector("span")) continue; const sr = s.getBoundingClientRect(); if (ov(sr, r) > 0.3*sr.width*sr.height) txt += s.textContent; }
      const overlapsCite = citeHits.some((h) => ov(h, r) > 0.3*r.width*r.height);
      links.push({ internal, pe: a.style.pointerEvents || "auto", overlapsCite, txt: txt.trim().slice(0, 24) });
    }
    const internalLinks = links.filter((l) => l.internal);
    const figTableLinks = internalLinks.filter((l) => /\\b(Figure|Fig|Table|Tab|Section|Sec|Algorithm)\\b/i.test(l.txt));
    const refNavOk = figTableLinks.length === 0 || figTableLinks.every((l) => l.pe !== "none");
    const citeLinksDisabled = internalLinks.filter((l) => l.overlapsCite).every((l) => l.pe === "none");

    // (5) Citation alignment: each cite-hit vs nearest cite-c overlap fraction.
    const citeCs = [...div.querySelectorAll(".fx-cite-c")].map((c) => c.getBoundingClientRect());
    const hitAlign = [];
    for (const h of citeHits) {
      let best = 0; for (const c of citeCs) best = Math.max(best, ov(h, c) / Math.max(1, h.width*h.height));
      hitAlign.push(+best.toFixed(2));
    }
    const aligned = hitAlign.filter((x) => x >= 0.4).length;
    const citeColoredCount = citeCs.length;

    // (8) Selectability: programmatic selection over a processed span, and
    // elementFromPoint hit-tests over body, a citation, and a colored ref.
    const done = [...div.querySelectorAll("span[data-fx-done]")];
    let selText = "";
    const target = done.find((s) => s.textContent.trim().length > 8);
    if (target) {
      const range = document.createRange();
      range.selectNodeContents(target);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      selText = sel.toString().trim().slice(0, 30); sel.removeAllRanges();
    }
    const hitTest = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const e = document.elementFromPoint((r.left+r.right)/2, (r.top+r.bottom)/2); return e ? (e.closest('.textLayer') ? 'textLayer' : (e.className||e.tagName)) : null; };
    const bodyHit = hitTest(target);
    const citeC = div.querySelector(".fx-cite-c");
    const refC = div.querySelector(".fx-ref-c");
    const citeHitTest = hitTest(citeC);
    const refHitTest = hitTest(refC);

    return {
      page: ${PAGE},
      links: { internalCount: internalLinks.length, figTableCount: figTableLinks.length, refNavOk, citeLinksDisabled,
        figTableSample: figTableLinks.slice(0,5), internalSample: internalLinks.slice(0,6) },
      cites: { hits: citeHits.length, citeColoredCount, aligned, alignDist: hitAlign.slice(0,12) },
      select: { selText, bodyHit, citeHitTest, refHitTest },
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error("interact error:", e);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
