// Saving a local PDF writes back to the file the reader chose.
//
// The defect this guards: `showSaveFilePicker` needs transient user activation,
// and PDF.js spends it before the download manager is ever called — `save()`
// awaits `dispatchWillSave()` and then `saveDocument()`, which serialises the
// whole annotated document. Activation lasts about five seconds, so the picker
// opened on a small file and threw on a large one, and the thrown case fell
// through to an ordinary download. "Save to the original" worked or not
// depending on how long the document took to serialise, which is why it read as
// simply broken.
//
// So the picker must be requested BY THE CLICK, and the chosen handle
// remembered for the document. Both are asserted here.
//
// The picker is stubbed, because a real one opens a native dialog no harness
// can drive. What is NOT stubbed is the wiring: a trusted CDP click on the real
// toolbar button, the real capture-phase listener, and the real download
// override. The one thing this cannot prove is Chrome's own activation
// enforcement — that is exactly why the ordering is asserted structurally
// instead (picker requested during the click, not after the awaits).
//
// Usage: node test/savelocal.mjs [--browser=edge]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { browserPath, extensionDir, profileDir, killBrowser } from "./lib/env.mjs";

const PORT = 16500 + (process.pid % 300);
const userDataDir = profileDir(`savelocal-${PORT}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,1000",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
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
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 400));
  return r.result.value;
};

const fail = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fail.push(name);
};

try {
  let v = null;
  for (let i = 0; i < 50 && !v; i++) { try { v = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (sw) extId = new URL(sw.url).hostname; else await sleep(400);
  }
  if (!extId) throw new Error("extension did not load");

  // A file: URL the viewer cannot fetch. The document fails to load, which is
  // fine and deliberate: the download override and its click listener are wired
  // up at viewer start, and this keeps the test off the file-scheme permission
  // a fresh automation profile does not have.
  const FILE_URL = "file:///C:/fx-savelocal-fixture.pdf";
  const tab = await http(
    `/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(FILE_URL)}`,
    "PUT",
  );
  await sleep(2500);
  const live = (await http("/json/list")).find((t) => t.id === tab.id) ?? tab;
  ws = new WebSocket(live.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  await send("Page.enable");
  for (let i = 0; i < 40; i++) {
    if (await ev(`!!window.PDFViewerApplication?.downloadManager`).catch(() => false)) break;
    await sleep(400);
  }

  check("override installed",
    await ev(`window.PDFViewerApplication?.downloadManager?.download?.name === "fxLocalDownload"`));

  // Stub the picker and record when it is asked for, and what gets written.
  await ev(`(() => {
    window.__fx = { picks: 0, written: null, closed: 0, pickAtClick: null };
    window.showSaveFilePicker = async () => {
      window.__fx.picks++;
      return {
        createWritable: async () => ({
          write: async (d) => { window.__fx.written = d ? d.length ?? d.size ?? -1 : null; },
          close: async () => { window.__fx.closed++; },
        }),
      };
    };
    return true;
  })()`);

  // A TRUSTED click on the real toolbar button, through CDP.
  const box = await ev(`(() => {
    const b = document.getElementById("downloadButton");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) throw new Error("no downloadButton in the toolbar");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(400);

  check("picker requested by the click itself",
    (await ev(`window.__fx.picks`)) >= 1,
    `picks=${await ev(`window.__fx.picks`)}`);

  // Now the save that PDF.js would perform after its awaits.
  await ev(`(async () => {
    const app = window.PDFViewerApplication;
    await app.downloadManager.download(new Uint8Array([1,2,3,4,5]), ${JSON.stringify(FILE_URL)}, "fixture.pdf");
    return true;
  })()`);
  check("data written to the chosen handle", (await ev(`window.__fx.written`)) === 5,
    `wrote ${await ev(`window.__fx.written`)} bytes`);
  check("writable closed", (await ev(`window.__fx.closed`)) === 1);

  // The second save must NOT prompt again — that is the "directly" in the
  // setting's own description.
  const before = await ev(`window.__fx.picks`);
  await ev(`(async () => {
    const app = window.PDFViewerApplication;
    await app.downloadManager.download(new Uint8Array([9,9,9]), ${JSON.stringify(FILE_URL)}, "fixture.pdf");
    return true;
  })()`);
  const after = await ev(`window.__fx.picks`);
  check("second save writes through without prompting", after === before, `picks ${before} -> ${after}`);
  check("second save wrote its own bytes", (await ev(`window.__fx.written`)) === 3);

  // A remote document must never take this path.
  await ev(`(async () => {
    window.__fx.picks = 0;
    const app = window.PDFViewerApplication;
    try { await app.downloadManager.download(new Uint8Array([1]), "https://example.com/x.pdf", "x.pdf"); } catch {}
    return true;
  })()`);
  check("http documents are left to the browser's download", (await ev(`window.__fx.picks`)) === 0);

  console.log(fail.length ? `\nFAILED: ${fail.join(", ")}` : "\nPASS: local save writes back to the chosen file");
  if (fail.length) process.exitCode = 1;
} catch (e) { console.error(`savelocal error: ${e.message || e}`); process.exitCode = 1; }
finally {
  try { ws?.close(); } catch {}
  killBrowser(browser);
  await sleep(400);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
