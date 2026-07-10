// Reference-parsing diagnosis v2: waits for the document properly and surfaces
// eval exceptions. Reports the heading found (or the merged-line candidates),
// entry count, and body size. Usage: node test/debug-refs2.mjs <pdf-url>
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://yilud.me/5GShield.pdf";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9711 + (process.pid % 100);
const userDataDir = join(tmpdir(), `fx-refdbg2-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--disable-sync",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) { const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const sw = t.find((x) => x.url.includes("service-worker")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PDF_URL)}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const ev = (expr) => new Promise((res) => { const i = ++id; const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener("message", h); res(m.result); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } })); });
  for (let i = 0; i < 40; i++) { const r = await ev(`!!(window.PDFViewerApplication && window.PDFViewerApplication.pdfDocument)`); if (r.result?.value) break; await sleep(700); }
  await sleep(2000);
  const r = await ev(`(async () => {
    const { extractLines } = await import('/viewer/references/extractor.mjs');
    const { parseReferences, findReferencesBody } = await import('/viewer/references/parser.mjs');
    const lines = await extractLines(window.PDFViewerApplication.pdfDocument);
    const cands = lines.map((l, i) => ({ i, l })).filter(({ l }) => /referen/i.test(l.text)).slice(-6)
      .map(({ i, l }) => ({ i, page: l.page, col: l.column, x: Math.round(l.x), h: Math.round(l.h * 100) / 100, text: l.text.slice(0, 80) }));
    const { heading, body } = findReferencesBody(lines);
    const after = heading ? lines.slice(lines.indexOf(heading) + 1, lines.indexOf(heading) + 5).map((l) => l.text.slice(0, 70)) : [];
    const entries = parseReferences(lines);
    // Numeric-integrity check: numbered entries should be unique 1..N with no
    // spurious duplicates (a duplicate number means a mid-entry line was
    // mistaken for an entry start — citation cards could open the wrong entry).
    const nums = entries.map((e) => e.number).filter((n) => n != null);
    const dupNums = nums.filter((n, i) => nums.indexOf(n) !== i);
    const nullNum = entries.filter((e) => e.number == null).length;
    return { totalLines: lines.length, entries: entries.length, numbered: nums.length, dupNums: [...new Set(dupNums)].slice(0, 15), unnumbered: nullNum, heading: heading ? heading.text.slice(0, 60) : null, bodyLines: body.length, firstBody: after, candidates: cands.slice(-3) };
  })()`);
  console.log(JSON.stringify(r.exceptionDetails ? { EXC: (r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 400) } : r.result.value, null, 1));
  ws.close();
} finally { browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
