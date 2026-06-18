// One-off deep probe: for a page, find leaf spans matching a query and report
// each span's geometry/flags, the masks covering it, and the processed spans
// that generated each covering mask — to explain a whiteout.
// Usage: node test/probe.mjs <template> <page> <query> [--shot]

import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ARGS = process.argv.slice(2);
const FILTER = ARGS[0] ?? "Two-column B";
const PAGE = parseInt(ARGS[1] ?? "7", 10);
const QUERY = ARGS[2] ?? "Fig";
const SHOT = ARGS.includes("--shot");
const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "Two-column C": "https://yilud.me/AFC_Attacks_NSDI.pdf",
  "Two-column D": "https://yilud.me/Proteus-ccs24.pdf",
  "Two-column E": "https://yilud.me/SIB-Auth.pdf",
  "arXiv": "https://arxiv.org/pdf/2502.04915",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9343;
const userDataDir = join(tmpdir(), `fx-probe-${process.pid}`);
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
  await send("Page.enable");
  await sleep(2500);
  await ev(`chrome.storage.sync.set({ enabled: true })`);
  for (let i = 0; i < 30; i++) { await sleep(800); const b = await ev(`document.querySelectorAll('.textLayer .fx-b').length`).catch(() => 0); if (b > 50) break; }
  await ev(`window.PDFViewerApplication.page = ${PAGE}`);
  await sleep(2500);

  const result = await ev(`(() => {
    const q = ${JSON.stringify(QUERY)};
    const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
    const div = pv.textLayer.div;
    const leaves = [...div.querySelectorAll("span")].filter((s) => !s.querySelector("span"));
    const masks = [...pv.div.querySelectorAll(".fx-mask > div")].map((m, i) => ({ i, r: m.getBoundingClientRect() }));
    const flags = (s) => (s.dataset.fxDone ? "DONE" : s.dataset.fxKeep ? "KEEP" : s.dataset.fxTable ? "TABLE" : "canvas");
    const rr = (r) => ({ l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    const ov = (a, b) => { const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return w > 0 && h > 0 ? w * h : 0; };
    const hits = leaves.filter((s) => s.textContent.includes(q) && flags(s) === "canvas");
    const out = [];
    for (const s of hits.slice(0, 6)) {
      const r = s.getBoundingClientRect();
      const covering = masks.filter((m) => ov(r, m.r) / (r.width * r.height) > 0.2);
      const cov = covering.map((m) => {
        // which processed spans generated this mask (inside its rect)?
        const inside = leaves.filter((x) => { const xr = x.getBoundingClientRect(); return flags(x) !== "canvas" && ov(xr, m.r) / Math.max(1, xr.width * xr.height) > 0.5; })
          .slice(0, 4).map((x) => ({ t: x.textContent.trim().slice(0, 18), f: flags(x), r: rr(x.getBoundingClientRect()) }));
        return { mask: rr(m.r), inside };
      });
      // neighbors on same baseline
      const near = leaves.filter((x) => { const xr = x.getBoundingClientRect(); return Math.abs(xr.top - r.top) < r.height * 0.6 && Math.abs(xr.left - r.left) < r.width * 6; })
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
        .map((x) => ({ t: x.textContent.trim().slice(0, 14), f: flags(x), l: Math.round(x.getBoundingClientRect().left) }));
      out.push({ text: s.textContent.trim().slice(0, 30), flag: flags(s), rect: rr(r), covering: cov, near });
    }
    // Full dump of the first hit's baseline: every leaf span (x, flag) and
    // every mask covering that y — to see the run/gap structure exactly.
    let lineDump = null;
    if (hits[0]) {
      const hr = hits[0].getBoundingClientRect();
      const yc = (hr.top + hr.bottom) / 2;
      // ALL spans crossing the baseline (incl. wrapped ones with child <span>
      // color wrappers, which the leaf filter would hide) — mark done/wrapped.
      const all = [...div.querySelectorAll("span")].filter((s) => { const r = s.getBoundingClientRect(); return r.top < yc && r.bottom > yc && r.width > 0; });
      const onLine = all
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
        .map((s) => { const r = s.getBoundingClientRect(); return { t: s.textContent.trim().slice(0, 14) || "·", f: flags(s)[0], wrap: s.querySelector("span") ? "W" : "", x: Math.round(r.left), w: Math.round(r.width) }; });
      const lineMasks = masks.filter((m) => m.r.top < yc && m.r.bottom > yc).map((m) => ({ x: Math.round(m.r.left), w: Math.round(m.r.width) })).sort((a, b) => a.x - b.x);
      lineDump = { yc: Math.round(yc), spans: onLine, masks: lineMasks };
    }
    return { page: ${PAGE}, query: q, hitCount: hits.length, maskCount: masks.length, out, lineDump };
  })()`);
  console.log(JSON.stringify(result, null, 2));

  if (SHOT) {
    // Capture the FIRST-PASS state (no scroll → no re-process), which is what
    // the user sees when a page first renders. Only works if the hit is in the
    // viewport after navigation.
    const clip = await ev(`(() => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
      const leaves = [...pv.textLayer.div.querySelectorAll("span")].filter((s) => !s.querySelector("span"));
      const hit = leaves.find((s) => s.textContent.includes(${JSON.stringify(QUERY)}) && !s.dataset.fxDone && !s.dataset.fxKeep);
      if (!hit) return null;
      const r = hit.getBoundingClientRect();
      if (r.top < 20 || r.bottom > window.innerHeight - 20) return { offscreen: true, top: Math.round(r.top) };
      return { x: Math.max(0, r.left - 120), y: Math.max(0, r.top - 50), width: 520, height: 130 };
    })()`);
    if (clip && !clip.offscreen) {
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { ...clip, scale: 2 } });
      const out = join(root, "test", "out", `probe-p${PAGE}-${QUERY.replace(/\W+/g, "")}.png`);
      writeFileSync(out, Buffer.from(shot.data, "base64"));
      console.log("saved " + out);
    } else {
      console.log("shot skipped:", JSON.stringify(clip));
    }
  }
} catch (e) {
  console.error("probe error:", e);
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
