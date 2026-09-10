// End-to-end verification of new features:
// 1. Citation range parsing for separate brackets like [6]-[11].
// 2. Highlight and comment floating toolbar on text selection in reading mode.
// 3. Direct local file saving default and options toggle.
// 4. Highlight visibility with reading mode (fx-on) enabled and text selection.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { browserPath, extensionDir, profileDir } from "./lib/env.mjs";

const PORT = 9855;
const userDataDir = profileDir("feat-verify");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank"
], { stdio: "ignore" });

let ws, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => {
    const m = JSON.parse(e.data);
    if (m.id === id) {
      ws.removeEventListener("message", h);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id, method, params }));
});

const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 500));
  return r.result.value;
};

const drag = async (x0, x1, y) => {
  x0 = Math.round(x0);
  x1 = Math.round(x1);
  y = Math.round(y);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 8; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(x0 + ((x1 - x0) * i) / 8), y, button: "left", buttons: 1 });
    await sleep(45);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, button: "left", clickCount: 1 });
};

let failed = false;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

try {
  let v = null;
  for (let i = 0; i < 50 && !v; i++) {
    try { v = await http("/json/version"); } catch { await sleep(300); }
  }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) {
    const t = await http("/json/list");
    const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(300);
  }

  // 1. Verify Options Page and saveLocalFile setting
  const optTab = await http(`/json/new?chrome-extension://${extId}/options/options.html`, "PUT");
  ws = new WebSocket(optTab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  await sleep(1500);

  const optLoaded = await ev(`(() => {
    const cb = document.getElementById("saveLocalFile");
    return { present: !!cb, checked: cb?.checked };
  })()`);
  check(optLoaded.present, "options page has #saveLocalFile checkbox");
  check(optLoaded.checked === true, "saveLocalFile is checked by default");

  // Toggle setting and verify storage
  await ev(`(() => {
    const cb = document.getElementById("saveLocalFile");
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await sleep(600);
  const stored = await ev(`new Promise((r) => chrome.storage.sync.get("saveLocalFile", (res) => r(res.saveLocalFile)))`);
  check(stored === false, "saveLocalFile persisted as false when unchecked");

  // Restore to true
  await ev(`(() => {
    const cb = document.getElementById("saveLocalFile");
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await sleep(600);
  const restored = await ev(`new Promise((r) => chrome.storage.sync.get("saveLocalFile", (res) => r(res.saveLocalFile)))`);
  check(restored === true, "saveLocalFile restored to true");

  ws.close();

  // 2. Open viewer with PDF and verify floating toolbar on text selection
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent("https://yilud.me/Proteus-ccs24.pdf")}`;
  const viewTab = await http(`/json/new?${viewerUrl}`, "PUT");
  ws = new WebSocket(viewTab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Input.enable").catch(() => {});
  await sleep(3000);

  for (let i = 0; i < 30; i++) {
    await sleep(600);
    const b = await ev("document.querySelectorAll('.textLayer .fx-b').length").catch(() => 0);
    if (b > 80) break;
  }
  await ev("window.PDFViewerApplication.page = 2");
  await sleep(3500);

  // Check citation parser [6]-[11] inside viewer environment
  const citeCheck = await ev(`(async () => {
    const { findCitations } = await import("/viewer/references/parser.mjs");
    const res = findCitations("Prior works [6]-[11] explore this.");
    return {
      count: res.length,
      keys: res[0]?.keys,
      start: res[0]?.start,
      end: res[0]?.end
    };
  })()`);
  check(citeCheck.count === 1, "findCitations parsed [6]-[11] as 1 range");
  check(
    JSON.stringify(citeCheck.keys) === JSON.stringify(["6", "7", "8", "9", "10", "11"]),
    "findCitations expanded [6]-[11] to [6, 7, 8, 9, 10, 11]",
    JSON.stringify(citeCheck.keys)
  );

  // Test floating toolbar on selection in reading mode
  let toolbarFound = null;
  for (let attempt = 0; attempt < 5 && !toolbarFound; attempt++) {
    const t = await ev(`(() => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(1);
      const spans = [...pv.textLayer.div.querySelectorAll('span')].filter((s) => {
        const r = s.getBoundingClientRect();
        return (s.textContent||'').trim().split(/\\s+/).length >= 6 && r.width > 200 && r.top > 150 && r.bottom < innerHeight - 120;
      });
      const s = spans[Math.floor(spans.length * (0.3 + 0.1 * ${attempt}))] || spans[0];
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { x0: r.left + 6, x1: r.right - 6, y: (r.top + r.bottom) / 2 };
    })()`);
    if (!t) break;
    await ev("getSelection().removeAllRanges()");
    await drag(t.x0, t.x1, t.y);
    await sleep(1200);

    toolbarFound = await ev(`(() => {
      const tb = document.querySelector(".textLayer .editToolbar");
      if (!tb) return null;
      const commentBtn = tb.querySelector(".commentButton");
      const highlightBtn = tb.querySelector(".highlightButton");
      return {
        present: true,
        hasCommentButton: !!commentBtn,
        hasHighlightButton: !!highlightBtn
      };
    })()`);
  }

  check(toolbarFound?.present === true, "floating toolbar appears on text selection in reading mode");
  check(toolbarFound?.hasCommentButton === true, "floating toolbar contains comment button");
  check(toolbarFound?.hasHighlightButton === true, "floating toolbar contains highlight button");

  // Click floating comment button and check comment dialog
  if (toolbarFound?.hasCommentButton) {
    await ev(`document.querySelector(".textLayer .editToolbar .commentButton").click()`);
    await sleep(1000);
    const dlg = await ev(`(() => {
      const d = document.getElementById("commentManagerDialog");
      return { present: !!d, open: !!d?.open };
    })()`);
    check(dlg.open === true, "clicking floating comment button opens commentManagerDialog");
    await ev(`document.getElementById("commentManagerCloseButton")?.click() || document.getElementById("commentManagerDialog")?.close()`);
    await sleep(600);
  }

  // 3. Verify local save interceptor
  const saveInterceptCheck = await ev(`(async () => {
    let pickerCalled = false;
    const oldPicker = window.showSaveFilePicker;
    window.showSaveFilePicker = async () => {
      pickerCalled = true;
      throw new DOMException("Abort", "AbortError");
    };
    try {
      // Simulate download call with file: url
      await window.PDFViewerApplication.downloadManager.download(new Uint8Array([1, 2, 3]), "file:///C:/test.pdf", "test.pdf");
      return { intercepted: pickerCalled };
    } finally {
      window.showSaveFilePicker = oldPicker;
    }
  })()`);
  check(saveInterceptCheck.intercepted === true, "local file save uses showSaveFilePicker when file: url");

  // 4. Verify highlight visibility with fx-on, round-trip save, and selection
  const savedBytes = await ev(`(async () => {
    const bytes = await window.PDFViewerApplication.pdfDocument.saveDocument();
    globalThis.__saved = bytes;
    return bytes.length;
  })()`);
  check(savedBytes > 0, "PDF document saved with highlight");

  await ev(`window.PDFViewerApplication.open({ data: globalThis.__saved.slice() })`);
  await sleep(4000);
  await ev("window.PDFViewerApplication.page = 2");
  await sleep(3000);

  const hlCheck = await ev(`(() => {
    const hl = document.querySelector(".highlightAnnotation");
    if (!hl) return { found: false };
    const cs = getComputedStyle(hl);
    return {
      found: true,
      bg: cs.backgroundColor,
      blend: cs.mixBlendMode,
      fxOn: document.getElementById("viewerContainer").classList.contains("fx-on"),
    };
  })()`);
  check(hlCheck.found === true, "reopened saved document has .highlightAnnotation");
  check(hlCheck.bg && hlCheck.bg !== "rgba(0, 0, 0, 0)" && !hlCheck.bg.includes("transparent"), "highlight has visible background color in reading mode (fx-on)", hlCheck.bg);
  check(hlCheck.blend === "multiply", "highlight has multiply blend mode", hlCheck.blend);

  // Test drag selection over highlight
  const selTarget = await ev(`(() => {
    const hl = document.querySelector(".highlightAnnotation");
    const r = hl.getBoundingClientRect();
    return {
      x0: Math.round(r.left + 5),
      x1: Math.round(r.right - 5),
      y: Math.round((r.top + r.bottom) / 2)
    };
  })()`);
  await ev("getSelection().removeAllRanges()");
  await drag(selTarget.x0, selTarget.x1, selTarget.y);
  await sleep(600);
  const selText = await ev("window.getSelection().toString().trim()");
  check(selText.length > 0, "text selection over highlight succeeds in reading mode", selText);

  // Test toggling fx-off
  await ev(`document.getElementById("fxToggleButton").click()`);
  await sleep(1000);
  const fxOffHl = await ev(`(() => {
    const hl = document.querySelector(".highlightAnnotation");
    const cs = getComputedStyle(hl);
    return {
      fxOn: document.getElementById("viewerContainer").classList.contains("fx-on"),
      bg: cs.backgroundColor
    };
  })()`);
  check(fxOffHl.fxOn === false, "fx successfully toggled off");
  check(fxOffHl.bg === "rgba(0, 0, 0, 0)", "highlight background reverts to transparent when fx is off (canvas visible)");

  // Toggle fx back on
  await ev(`document.getElementById("fxToggleButton").click()`);
  await sleep(1500);
  const fxOnHl = await ev(`(() => {
    const hl = document.querySelector(".highlightAnnotation");
    const cs = getComputedStyle(hl);
    return {
      fxOn: document.getElementById("viewerContainer").classList.contains("fx-on"),
      bg: cs.backgroundColor
    };
  })()`);
  check(fxOnHl.fxOn === true, "fx successfully toggled back on");
  check(fxOnHl.bg && fxOnHl.bg !== "rgba(0, 0, 0, 0)", "highlight background visible again when fx is turned back on");

  console.log(failed ? "FEATURE VERIFICATION: FAIL" : "FEATURE VERIFICATION: PASS");
} catch (e) {
  console.error("Error during verification:", e);
  failed = true;
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(failed ? 1 : 0);
}
