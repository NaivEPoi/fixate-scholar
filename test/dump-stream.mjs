// Dump a page's column-stream rows exactly as #classifyBlocks sees them
// (line-grouped, column-split), with per-item x extents — to debug the
// aligned-gap table pass. Usage: node test/dump-stream.mjs <paper> <page> <left|right|full> [filter]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILTER = POS[0] ?? "Two-column A";
const PAGE = parseInt(POS[1] ?? "20", 10);
const STREAM = POS[2] ?? "right";
const GREP = POS[3] ?? "";
const PAPERS = {
  "Two-column A": "https://yilud.me/usenixsecurity25-dong-yilu.pdf",
  "Two-column B": "https://yilud.me/usenixsecurity24-tu.pdf",
  "UC-Scheme": "https://yilud.me/UC_Scheme.pdf",
  "ACL": "https://yilud.me/2026.acl-long.2136.pdf",
  "5GShield": "https://yilud.me/5GShield.pdf",
  "5GCVerif": "https://yilud.me/5GCVerif-ccs23.pdf",
  "Two-column D": "https://yilud.me/Proteus-ccs24.pdf",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9811 + (process.pid % 100);
const userDataDir = join(tmpdir(), `fx-ds-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync",
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result.value; };

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PAPERS[FILTER])}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await sleep(3000);
  const rows = await ev(`(async () => {
    const pv = window.PDFViewerApplication.pdfViewer;
    for (let i = 0; i < 60 && !pv.pdfDocument; i++) await new Promise((r) => setTimeout(r, 300));
    const page = await window.PDFViewerApplication.pdfDocument.getPage(${PAGE});
    const content = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
    const fontOf = (fn) => { try { return (page.commonObjs.get(fn) || {}).name || fn; } catch { return fn; } };
    const items = content.items.filter((it) => it.str !== undefined && it.str.trim()).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: it.height || 8, f: fontOf(it.fontName) }));
    // line-group exactly like #lineGroups
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    let cur = null;
    for (const p of items) {
      if (cur && Math.abs(p.y - cur.y) < Math.max(cur.h, p.h) * 0.6) { cur.items.push(p); cur.h = Math.max(cur.h, p.h); }
      else { cur = { y: p.y, h: p.h, items: [p] }; lines.push(cur); }
    }
    for (const ln of lines) ln.items.sort((a, b) => a.x - b.x);
    const view = page.view;
    const centerX = view[0] + (view[2] - view[0]) * 0.5;
    let occupy = 0;
    for (const ln of lines) if (ln.items.some((p) => p.x < centerX && p.x + p.w > centerX)) occupy++;
    const twoColumn = lines.length > 4 && occupy < lines.length * 0.35;
    const out = [];
    for (const ln of lines) {
      const crosses = ln.items.some((p) => p.x < centerX && p.x + p.w > centerX);
      let stream = "full";
      let its = ln.items;
      if (twoColumn && !crosses) {
        const l = ln.items.filter((p) => p.x < centerX);
        const r = ln.items.filter((p) => p.x >= centerX);
        if (${JSON.stringify(STREAM)} === "left") { stream = "left"; its = l; }
        else if (${JSON.stringify(STREAM)} === "right") { stream = "right"; its = r; }
        if (!its.length) continue;
      } else if (${JSON.stringify(STREAM)} !== "full") continue;
      out.push({ y: Math.round(ln.y * 10) / 10, h: Math.round(ln.h * 10) / 10, items: its.map((p) => [Math.round(p.x), Math.round(p.x + p.w), Math.round(p.h * 10) / 10, p.str.slice(0, 28), p.f]) });
    }
    return out;
  })()`);
  const grep = GREP.toLowerCase();
  for (const r of rows) {
    const txt = r.items.map((i) => i[3]).join(" ");
    if (grep && !txt.toLowerCase().includes(grep)) continue;
    console.log(`y=${r.y} h=${r.h} :: ${r.items.map((i) => `[${i[0]}-${i[1]} h${i[2]} "${i[3]}" ${i[4] ?? ""}]`).join(" ")}`);
  }
} catch (e) { console.error("dump error:", e.message); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
