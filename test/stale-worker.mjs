// A background worker from an earlier install, and the viewer's way out of it.
//
// The browser stores an extension's background worker when the extension is
// installed or reloaded and keeps running THAT script: a restart does not
// re-read it, and neither does a new manifest version (a worker installed at
// 0.1.0 outlived a bump to 0.2.0 across restarts). An unpacked extension's
// files move on under it — the viewer pages load from the files as they are
// now, the worker stays as it was — and every fix to the worker is invisible
// until the extension is reloaded. One such worker, installed in July, served
// a user's "native" clicks through October: it re-intercepted every local PDF
// it let through, so the button did nothing (R53).
//
// Here: install a copy of the extension whose worker has no `fx-worker`
// listener (any worker from before the handshake) at a lower version, put the
// current files under the running browser, and check that the viewer's
// "native" button recognises the old worker, says so instead of acting, and
// that its Reload link installs the current worker — after which the button
// works. (The restart is left out: the stored worker's survival across one,
// and across a version bump, was measured once and is recorded in R53; this
// harness's command-line install did not keep a stable id across restarts.)
// Usage: node test/stale-worker.mjs [pdf-url]
import { spawn } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, devtoolsPort, extensionDir, killBrowser, profileDir } from "./lib/env.mjs";

const URL0 = process.argv.slice(2).find((a) => !a.startsWith("--")) || "https://yilud.me/SIB-Auth.pdf";
const udd = profileDir("stale");
const ext = join(tmpdir(), `fx-stale-ext-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

cpSync(extensionDir, ext, { recursive: true });
const workerFile = join(ext, "background/service-worker.mjs");
const manifestFile = join(ext, "manifest.json");
const worker = readFileSync(workerFile, "utf8");
const manifest = readFileSync(manifestFile, "utf8");
const VERSION = JSON.parse(manifest).version;

// The worker as it was before the handshake: its `fx-worker` listener removed.
function oldWorker() {
  const at = worker.indexOf('if (msg?.type !== "fx-worker")');
  if (at < 0) throw new Error("the worker has no fx-worker listener to remove");
  const start = worker.lastIndexOf("chrome.runtime.onMessage.addListener(", at);
  const close = /\r?\n\}\);\r?\n/g; // the listener's end, on either line ending
  close.lastIndex = at;
  const m = close.exec(worker);
  if (start < 0 || !m) throw new Error("could not find the fx-worker listener's bounds");
  return worker.slice(0, start) + worker.slice(m.index + m[0].length);
}
function install(old) {
  writeFileSync(workerFile, old ? oldWorker() : worker);
  writeFileSync(manifestFile, old ? manifest.replace(`"version": "${VERSION}"`, '"version": "0.0.1"') : manifest);
}

async function launch() {
  const since = Date.now();
  const child = spawn(browserPath("edge"), [
    "--remote-debugging-port=0", "--headless=new", "--no-first-run", "--no-default-browser-check",
    "--disable-sync", "--window-size=1200,1500", `--user-data-dir=${udd}`,
    `--load-extension=${ext}`, `--disable-extensions-except=${ext}`, "about:blank",
  ], { stdio: "ignore" });
  const port = await devtoolsPort(udd, since, { timeoutMs: 300000 });
  const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${port}${p}`, { method: m })).json();
  const page = async (url) => {
    const t = await http(`/json/new?${url}`, "PUT");
    const socket = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
    let n = 0;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++n;
      const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { socket.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
      socket.addEventListener("message", h);
      socket.send(JSON.stringify({ id, method, params }));
    });
    const ev = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300));
      return r.result.value;
    };
    return { id: t.id, socket, send, ev };
  };
  return { child, http, page };
}

const viewerFor = (extId) => `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`;
// The viewer on the document, once the extension is up: right after a browser
// start the page can come up before the extension and have no chrome.runtime;
// it is reloaded until it has one and the document is open.
async function openViewer(browser, extId) {
  const p = await browser.page(viewerFor(extId));
  await p.send("Page.enable");
  // An extension page requested before the extension has loaded is an error
  // page (ERR_BLOCKED_BY_CLIENT); on a loaded machine the load takes a while.
  for (let i = 0; i < 360; i++) {
    const ready = await p.ev("typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!window.PDFViewerApplication?.pdfDocument").catch(() => false);
    if (ready) { await sleep(1000); return p; }
    const blocked = await p.ev("location.href.startsWith('chrome-error://')").catch(() => false);
    if (blocked && i % 10 === 9) await p.send("Page.reload").catch(() => {});
    await sleep(500);
  }
  const state = await p.ev("JSON.stringify({ href: location.href, title: document.title, chrome: typeof chrome, runtime: typeof chrome !== 'undefined' ? typeof chrome.runtime : '-', app: typeof window.PDFViewerApplication, text: (document.body?.innerText || '').slice(0, 160) })").catch((e) => "(unreadable: " + e.message + ")");
  const targets = (await browser.http("/json/list")).map((t) => `${t.type} ${t.url.slice(0, 80)}`).join("; ");
  throw new Error(`the viewer never came up on the document: ${state}; targets: ${targets}`);
}
// What the worker answers the viewer's question with, asked from a viewer page.
const ask = (p) => p.ev(`chrome.runtime.sendMessage({ type: "fx-worker" }).then((r) => JSON.stringify(r ?? null)).catch((e) => "rejected: " + e.message)`);
async function workerTarget(http) {
  for (let i = 0; i < 600; i++) { // a loaded machine starts a browser slowly
    const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (sw) return sw;
    await sleep(300);
  }
  throw new Error("the extension's worker never appeared");
}

let browser = null;
let failed = false;
try {
  // 1. Installed with the old worker, at the old version.
  install(true);
  browser = await launch();
  const extId = new URL((await workerTarget(browser.http)).url).hostname;
  let p = await openViewer(browser, extId);
  const a1 = await ask(p);
  console.log("old install:  ", `worker answers ${a1}`);
  if (!/^rejected|^null$/.test(a1)) throw new Error("the old worker answered the handshake — the premise is gone");

  // 2. The files move on under the running browser (a pull into an unpacked
  //    checkout). The worker is the stored one still — that is the condition
  //    under test, not a failure; a restart does not change it either (R53).
  install(false);
  p = await openViewer(browser, extId);
  const a2 = await ask(p);
  console.log("files moved:  ", `worker answers ${a2} (files are ${VERSION})`);
  if (!/^rejected|^null$/.test(a2)) throw new Error("the browser picked up the current worker from disk — nothing to test");

  // 3. The button: no bounce, no bypass — the note, with its reload link.
  await p.ev(`document.getElementById("fxNativeButton").click(); true`);
  await sleep(3000);
  const where = await p.ev("location.href").catch(() => "(navigating)");
  const note = await p.ev(`document.getElementById("fxStaleWorkerNote")?.textContent || ""`);
  const links = await p.ev(`document.querySelectorAll("#fxReloadExtension").length`);
  console.log("native click: ", where.startsWith("chrome-extension://") ? `stays in viewer; note: ${note.slice(0, 70)}…` : where.slice(0, 80));
  if (!where.startsWith("chrome-extension://")) throw new Error("the button acted through the old worker");
  if (!/earlier install/.test(note) || links !== 1) throw new Error("expected the stale-worker note with one reload link");
  await p.ev(`document.getElementById("fxNativeButton").click(); true`);
  await sleep(1000);
  if ((await p.ev(`document.querySelectorAll("#fxStaleWorkerNote").length`)) !== 1) throw new Error("a second click added a second note");

  // 4. The link reloads the extension: the current worker, then the button works.
  await p.ev(`document.getElementById("fxReloadExtension").click(); true`).catch(() => {});
  await sleep(6000);
  const gone = !(await browser.http("/json/list")).some((x) => x.id === p.id);
  console.log("after reload: ", gone ? "document tab closed (as the note says)" : "document tab still open");
  const extId2 = new URL((await workerTarget(browser.http)).url).hostname;
  const p2 = await openViewer(browser, extId2);
  const a3 = await ask(p2);
  console.log("fresh worker: ", `answers ${a3}`);
  if (a3 !== JSON.stringify({ build: VERSION })) throw new Error("the reload did not install the current worker");
  await p2.ev(`document.getElementById("fxNativeButton").click(); true`);
  await sleep(5000);
  const native = await p2.ev("location.href").catch(() => "(navigating)");
  console.log("native click: ", native.slice(0, 80));
  if (native.startsWith("chrome-extension://")) throw new Error("the button still did not leave the viewer");
  console.log("PASS — the old worker is named, not used; its reload installs the current one");
} catch (e) {
  failed = true;
  console.error("stale-worker error:", e.message || e);
} finally {
  if (browser) killBrowser(browser.child);
  await sleep(500);
  for (const d of [udd, ext]) try { rmSync(d, { recursive: true, force: true }); } catch {}
}
process.exit(failed ? 1 : 0);
