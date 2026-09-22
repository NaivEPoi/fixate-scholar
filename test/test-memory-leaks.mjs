// Comprehensive memory leak test for FixateScholar using Chrome DevTools Protocol.
// Measures heap usage, DOM node count, detached nodes, and event listeners across:
// 1. Repeated FX toggle on/off cycles (10x)
// 2. Font mode switching across all 6 modes (original + 5 reading fonts)
// 3. Citation popup open/close cycles
// 4. Page scrolling and virtualization
// Usage: node test/test-memory-leaks.mjs [--browser=edge|chrome]

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { browserPath } from "./lib/env.mjs";

const PDF_URL = "https://yilud.me/usenixsecurity24-tu.pdf";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9450 + (process.pid % 400);
const userDataDir = join(tmpdir(), "fx-mem-" + process.pid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSER_TYPE = process.argv.find((a) => a.startsWith("--browser="))?.slice(10) ?? "edge";
const EXE = browserPath(BROWSER_TYPE);

console.log("Starting memory leak test on " + BROWSER_TYPE + " (" + EXE + ")");

const browser = spawn(
  EXE,
  [
    "--remote-debugging-port=" + PORT,
    "--headless=new",
    "--no-first-run",
    "--disable-sync",
    "--window-size=1400,1000",
    "--user-data-dir=" + userDataDir,
    "--load-extension=" + EXT,
    "--disable-extensions-except=" + EXT,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let ws = null;
let nextId = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const h = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id === id) {
        ws.removeEventListener("message", h);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });

const ev = async (expr) => {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  return r?.result?.value;
};

async function forceGC() {
  try {
    await send("HeapProfiler.collectGarbage");
  } catch {}
  await sleep(400);
}

async function getMetrics() {
  await forceGC();
  const raw = await send("Performance.getMetrics");
  const m = {};
  for (const item of raw.metrics) {
    m[item.name] = item.value;
  }
  const domInfo = await ev("({" +
    "allNodes: document.querySelectorAll('*').length," +
    "fxDone: document.querySelectorAll('span[data-fx-done]').length," +
    "fxMasks: document.querySelectorAll('.fx-mask').length," +
    "citeLayers: document.querySelectorAll('.fx-cite-layer').length," +
    "popups: document.querySelectorAll('.fx-cite-popup').length," +
  "})");
  return {
    heapMB: Math.round(((m.JSHeapUsedSize || 0) / (1024 * 1024)) * 100) / 100,
    heapTotalMB: Math.round(((m.JSHeapTotalSize || 0) / (1024 * 1024)) * 100) / 100,
    nodes: m.Nodes || 0,
    listeners: m.JSEventListeners || 0,
    ...domInfo,
  };
}

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    try {
      version = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json();
    } catch {
      await sleep(250);
    }
  }

  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const targets = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
    const sw = targets.find((t) => t.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(250);
  }

  const viewerUrl = "chrome-extension://" + extId + "/vendor/pdfjs/web/viewer.html?file=" + encodeURIComponent(PDF_URL) + "#page=2";
  const tab = await (await fetch("http://127.0.0.1:" + PORT + "/json/new?" + viewerUrl, { method: "PUT" })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  await send("Performance.enable");
  await send("HeapProfiler.enable");

  // Wait for initial render of page 2
  for (let i = 0; i < 50; i++) {
    await sleep(600);
    const ready = await ev(
      "!!(window.PDFViewerApplication?.pdfViewer?.getPageView(1)?.textLayer?.div?.querySelector('span[data-fx-done]'))",
    );
    if (ready) break;
  }

  console.log("\n=== 1. Initial Baseline ===");
  const baseline = await getMetrics();
  console.log("Baseline Heap: " + baseline.heapMB + " MB, DOM Nodes: " + baseline.nodes + ", Listeners: " + baseline.listeners + ", fxDone: " + baseline.fxDone);

  // Test 1: Repeated FX Toggle (10 cycles)
  console.log("\n=== 2. Testing 10 FX Toggle Cycles (on <-> off) ===");
  // The FIRST cycle is a warm-up, and its metrics are the ones this check is
  // measured against. The initial baseline above is taken while the first page
  // is still settling, so comparing to it makes ten clean cycles land ~45 nodes
  // BELOW it — which a strict equality reads as a failure and a `<= 0` reads as
  // a pass no matter what, hiding any leak smaller than the artefact. Comparing
  // steady state to steady state removes the artefact instead of tolerating it,
  // so the assertion below can stay exact.
  await ev("chrome.storage.sync.set({ enabled: false })");
  await sleep(600);
  await ev("chrome.storage.sync.set({ enabled: true })");
  await sleep(800);
  const settled = await getMetrics();
  for (let cycle = 2; cycle <= 10; cycle++) {
    await ev("chrome.storage.sync.set({ enabled: false })");
    await sleep(600);
    await ev("chrome.storage.sync.set({ enabled: true })");
    await sleep(800);
  }
  const afterToggle = await getMetrics();
  console.log("After 10 Toggles: Heap: " + afterToggle.heapMB + " MB, DOM Nodes: " + afterToggle.nodes + ", Listeners: " + afterToggle.listeners + ", fxDone: " + afterToggle.fxDone);
  const toggleHeapDelta = afterToggle.heapMB - baseline.heapMB;
  const toggleNodeDelta = afterToggle.nodes - settled.nodes;
  console.log("Toggle Delta: Heap " + (toggleHeapDelta >= 0 ? "+" : "") + toggleHeapDelta.toFixed(2) + " MB, Nodes " + (toggleNodeDelta >= 0 ? "+" : "") + toggleNodeDelta);

  // Test 2: Font switching across all 6 modes
  console.log("\n=== 3. Testing Font Switching Across All 6 Modes ===");
  const fonts = ["atkinson", "inter", "literata", "lexend", "source-serif-4", "original"];
  for (const font of fonts) {
    await ev("chrome.storage.sync.set({ fontMode: " + JSON.stringify(font) + " })");
    await sleep(800);
  }
  const afterFonts = await getMetrics();
  console.log("After 6 Fonts: Heap: " + afterFonts.heapMB + " MB, DOM Nodes: " + afterFonts.nodes + ", Listeners: " + afterFonts.listeners + ", fxDone: " + afterFonts.fxDone);
  const fontHeapDelta = afterFonts.heapMB - afterToggle.heapMB;
  console.log("Font Switch Heap Delta: " + (fontHeapDelta >= 0 ? "+" : "") + fontHeapDelta.toFixed(2) + " MB");

  // Test 3: Citation interaction (open/close citation cards)
  console.log("\n=== 4. Testing Citation Interactions (Open & Close 10x) ===");
  for (let i = 0; i < 10; i++) {
    await ev("(() => {" +
      "const hit = document.querySelector('.fx-cite-hit');" +
      "if (hit) {" +
        "hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));" +
      "}" +
    "})()");
    await sleep(300);
    await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await sleep(200);
  }
  const afterCitations = await getMetrics();
  console.log("After Citations: Heap: " + afterCitations.heapMB + " MB, DOM Nodes: " + afterCitations.nodes + ", Listeners: " + afterCitations.listeners);

  // Test 4: Scrolling & Page Virtualization
  console.log("\n=== 5. Testing Page Scrolling & Virtualization (Pages 1 -> 5 -> 10 -> 1) ===");
  for (const p of [1, 5, 10, 1]) {
    await ev("window.PDFViewerApplication.page = " + p);
    await sleep(1200);
  }
  const afterScroll = await getMetrics();
  console.log("After Scrolling: Heap: " + afterScroll.heapMB + " MB, DOM Nodes: " + afterScroll.nodes + ", Listeners: " + afterScroll.listeners);

  // Test 5: Verify cleanup on FX toggle off across all rendered pages
  console.log("\n=== 6. Testing Complete Cleanup on Disable ===");
  await ev("chrome.storage.sync.set({ enabled: false })");
  await sleep(1000);
  const afterDisable = await getMetrics();
  console.log("After Disable: Active Masks: " + afterDisable.fxMasks + ", fxDone: " + afterDisable.fxDone);

  // Final evaluation
  console.log("\n=== Leak Verification Summary ===");
  const totalHeapDelta = afterDisable.heapMB - baseline.heapMB;
  console.log("Total Heap Growth across whole stress run: " + (totalHeapDelta >= 0 ? "+" : "") + totalHeapDelta.toFixed(2) + " MB");
  console.log("Toggle Node Delta (cycles 2-10, vs settled cycle 1): " + toggleNodeDelta);
  console.log("Font Switch Node Delta (7 font swaps): " + (afterFonts.nodes - afterToggle.nodes));
  console.log("Active Masks after disable (must be 0): " + afterDisable.fxMasks);
  console.log("Active Popups (must be <= 1): " + afterDisable.popups);

  const heapOk = totalHeapDelta < 15;
  // Measured steady-state to steady-state (cycle 1 vs cycle 10), so exact
  // equality is meaningful again: the warm-up artefact that made this fail on a
  // TIDIER DOM is gone, and a relaxed `<= 0` is not needed. Relaxing it would
  // have been the wrong repair anyway — it passes any leak smaller than the
  // artefact it was hiding, which is precisely the size of leak this looks for.
  const toggleNodesOk = toggleNodeDelta === 0;
  const fontNodesOk = (afterFonts.nodes - afterToggle.nodes) === 0;
  const masksCleaned = afterDisable.fxMasks === 0 && afterDisable.fxDone === 0;
  const popupsOk = afterDisable.popups <= 1;

  if (heapOk && toggleNodesOk && fontNodesOk && masksCleaned && popupsOk) {
    console.log("\nPASSED: Zero memory leak detected. All resources cleanly managed and bounded.");
  } else {
    console.error("\nFAILED: Potential memory leak detected (heapOk: " + heapOk + ", toggleNodesOk: " + toggleNodesOk + ", fontNodesOk: " + fontNodesOk + ", masksCleaned: " + masksCleaned + ", popupsOk: " + popupsOk + ")");
    process.exit(1);
  }
} catch (err) {
  console.error("Test error:", err);
  process.exit(1);
} finally {
  try {
    if (ws) ws.close();
  } catch {}
  try {
    browser.kill();
  } catch {}
  await sleep(400);
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
}
