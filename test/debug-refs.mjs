// Diagnose reference parsing on a given paper: dumps heading candidates and
// the lines around the chosen heading.
// Usage: node test/debug-refs.mjs <pdf-url> [browser-path]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PDF_URL = process.argv[2] ?? "https://yilud.me/usenixsecurity24-tu.pdf";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9338;
const userDataDir = join(tmpdir(), `fx-refdbg-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(
  process.argv[3] || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    `--remote-debugging-port=${PORT}`,
    "--headless=new",
    "--no-first-run",
    "--disable-sync",
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      await sleep(250);
    }
  }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const sw = targets.find((t) => t.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(250);
  }
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(PDF_URL)}`;
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${viewerUrl}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 0;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === id) {
          ws.removeEventListener("message", h);
          resolve(m.result);
        }
      };
      ws.addEventListener("message", h);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await sleep(10000);
  const r = await send("Runtime.evaluate", {
    returnByValue: true,
    awaitPromise: true,
    expression: `(async () => {
      const { extractLines } = await import('/viewer/references/extractor.mjs');
      const { parseReferences } = await import('/viewer/references/parser.mjs');
      const lines = await extractLines(window.PDFViewerApplication.pdfDocument);
      const cands = [];
      lines.forEach((l, i) => {
        if (/referen/i.test(l.text)) cands.push({ i, page: l.page, col: l.column, x: Math.round(l.x), h: l.h, text: l.text.slice(0, 90) });
      });
      const last = cands.at(-1);
      const around = last
        ? lines.slice(last.i, last.i + 12).map(l => ({ page: l.page, col: l.column, x: Math.round(l.x), text: l.text.slice(0, 90) }))
        : [];
      const { findReferencesBody } = await import('/viewer/references/parser.mjs');
      const { body } = findReferencesBody(lines);
      const lastBody = body.at(-1);
      const startIdx = lines.lastIndexOf(lines.find((l, i) => /^references$/i.test(l.text) && i > lines.length / 2) ?? null);
      const breakZone = startIdx >= 0
        ? lines.slice(startIdx + body.length - 1, startIdx + body.length + 5).map(l =>
            ({ page: l.page, col: l.column, y: Math.round(l.y), h: Math.round(l.h * 100) / 100, text: l.text.slice(0, 60) }))
        : [];
      const afterBody = lines.filter(l =>
        lastBody && (l.page > lastBody.page || (l.page === lastBody.page && l.y < lastBody.y - 5)));
      return {
        totalLines: lines.length,
        entries: parseReferences(lines).length,
        refPages: globalThis.__fxRefPages,
        bodyLines: body.length,
        lastBodyLine: lastBody ? { page: lastBody.page, y: Math.round(lastBody.y), text: lastBody.text.slice(0, 70) } : null,
        breakZone,
        firstAfterBody: afterBody.slice(0, 10).map(l => ({ page: l.page, y: Math.round(l.y), text: l.text.slice(0, 70) })),
        candidates: cands.slice(-8),
        around: around.slice(0, 4),
      };
    })()`,
  });
  console.log(JSON.stringify(r.result.value ?? r.result, null, 2));
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
