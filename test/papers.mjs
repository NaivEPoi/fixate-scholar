// Multi-template smoke test: loads a set of real papers (USENIX, ACM, IEEE
// templates) in the extension viewer and reports per-paper typography and
// reference-parsing results.
//
// Usage: node test/papers.mjs [path-to-browser]
// (Regular Chrome ≥137 ignores --load-extension; use Edge/Chromium.)

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PAPERS = [
  { template: "USENIX Sec'25", url: "https://yilud.me/usenixsecurity25-dong-yilu.pdf" },
  { template: "USENIX Sec'24", url: "https://yilud.me/usenixsecurity24-tu.pdf" },
  { template: "USENIX NSDI'26", url: "https://yilud.me/AFC_Attacks_NSDI.pdf" },
  { template: "ACM CCS'24", url: "https://yilud.me/Proteus-ccs24.pdf" },
  { template: "ACM WiSec'25", url: "https://yilud.me/SIB-Auth.pdf" },
  { template: "EW'25 (stamped)", url: "https://yilud.me/a33-dong%20stamped.pdf" },
  { template: "IEEE (arXiv)", url: "https://arxiv.org/pdf/2502.04915" },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9337;
const userDataDir = join(tmpdir(), `fx-papers-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(path, method = "GET") {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
  return res.json();
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (msg) =>
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result),
      );
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  close() {
    this.ws.close();
  }
}

const browser = spawn(
  process.argv[2] || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    `--remote-debugging-port=${PORT}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--window-size=1400,1800",
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let failures = 0;

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    try {
      version = await http("/json/version");
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("debugger endpoint never came up");
  console.log(`Browser: ${version.Browser}\n`);

  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const targets = await http("/json/list");
    const sw = targets.find((t) => t.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(250);
  }
  if (!extId) throw new Error("extension did not load");

  const results = [];
  for (const paper of PAPERS) {
    const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(paper.url)}`;
    const tab = await http(`/json/new?${viewerUrl}`, "PUT");
    const cdp = new CDP(tab.webSocketDebuggerUrl);
    await cdp.ready;
    await sleep(1500);
    await cdp.eval(`chrome.storage.sync.set({ enabled: true })`);

    let state = null;
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      try {
        state = await cdp.eval(`(() => ({
          pages: window.PDFViewerApplication?.pagesCount ?? 0,
          spans: document.querySelectorAll('.textLayer span').length,
          bolded: document.querySelectorAll('.textLayer .fx-b').length,
          masks: document.querySelectorAll('.fx-mask > div').length,
          cites: document.querySelectorAll('.fx-cite-hit').length,
          refs: globalThis.__fxRefCount ?? 0,
          fxOn: !!document.querySelector('#viewerContainer.fx-on'),
        }))()`);
      } catch {
        continue;
      }
      if (state.bolded > 100 && state.refs > 0 && state.cites > 0) break;
    }
    cdp.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); // plain-text response

    const ok = !!state && state.pages > 0 && state.fxOn && state.bolded > 100;
    if (!ok) failures++;
    const warn =
      state && (state.refs === 0 ? " ⚠ no references parsed" : state.cites === 0 ? " ⚠ no citations linked" : "");
    results.push({ paper, state, ok, warn });
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${paper.template.padEnd(16)} ${JSON.stringify(state)}${warn}`,
    );
  }

  console.log("\nSummary:");
  console.log("Template         | pages | bolded | masks | refs | cites");
  for (const { paper, state, ok } of results) {
    const s = state ?? {};
    console.log(
      `${paper.template.padEnd(16)} | ${String(s.pages ?? "-").padStart(5)} | ${String(s.bolded ?? "-").padStart(6)} | ${String(s.masks ?? "-").padStart(5)} | ${String(s.refs ?? "-").padStart(4)} | ${String(s.cites ?? "-").padStart(5)}${ok ? "" : "  << FAIL"}`,
    );
  }
} catch (e) {
  failures++;
  console.error("papers test error:", e);
} finally {
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PAPERS PASSED");
process.exit(failures ? 1 : 0);
