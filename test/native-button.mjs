// Native-button end-to-end: navigate to a PDF URL (http or file) -> expect
// the redirect into the viewer -> trigger fx-bypass-once (what the "native"
// button sends) -> expect the tab to land on the original URL ONCE: a reload
// and a new tab are intercepted again, and nothing is saved to bypassUrls.
// Usage: node test/native-button.mjs [pdf-url] [--full-list]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir } from "./lib/env.mjs";

const URL0 = process.argv.slice(2).find((a) => !a.startsWith("--")) || "https://yilud.me/SIB-Auth.pdf";
const EXT = extensionDir;
const PORT = 9111 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-nb-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1200,1500",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 0;
const makeClient = (webSocketDebuggerUrl) => {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { socket.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
    socket.addEventListener("message", h);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300));
    return r.result.value;
  };
  return { socket, send, ev };
};

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  // Navigate a fresh tab to the PDF URL itself — interception should engage.
  const tab = await http(`/json/new?about:blank`, "PUT");
  const client1 = makeClient(tab.webSocketDebuggerUrl);
  ws = client1.socket;
  await new Promise((r) => (client1.socket.onopen = r));
  await client1.send("Page.enable");
  await sleep(1500);
  await client1.send("Page.navigate", { url: URL0 });
  await sleep(5000);
  const at1 = await client1.ev("location.href");
  const inViewer = at1.startsWith("chrome-extension://");
  console.log("after nav:    ", inViewer ? "VIEWER (intercepted ok)" : at1.slice(0, 80));
  if (!inViewer) throw new Error("interception did not engage — cannot test the button");

  // A long-used profile: bypassUrls at the sync item cap (8 KB). The old button
  // persisted every click, and at the cap the write failed and it did nothing.
  if (process.argv.includes("--full-list")) {
    await client1.ev(`new Promise((ok) => chrome.storage.sync.set({ bypassUrls: Array.from({ length: 35 }, (_, i) => "https://example.com/" + "x".repeat(209) + i) }, ok))`);
  }
  const before = await client1.ev(`chrome.storage.sync.get("bypassUrls").then((s) => JSON.stringify(s.bypassUrls || []))`);

  // Trigger exactly what the native button sends.
  await client1.ev(`chrome.runtime.sendMessage({ type: "fx-bypass-once", url: ${JSON.stringify(URL0)} })`);
  await sleep(4000);
  const at2 = await client1.ev("location.href").catch(() => "(navigating)");
  await sleep(3000);
  const at3 = await client1.ev("location.href").catch(() => "(navigating)");
  // The original URL, or where it redirects to (http to https, a gateway):
  // the tab left the viewer for a real page.
  const ok = at3 === URL0 || decodeURIComponent(at3) === decodeURIComponent(URL0) || /^(https?|file):/.test(at3);
  console.log("after bypass: ", at2.slice(0, 90));
  console.log("native view:  ", at3.slice(0, 90));
  if (!ok) throw new Error("did not navigate to native viewer");

  // One time only: a reload is intercepted again.
  await client1.send("Page.reload");
  await sleep(5000);
  const atReload = await client1.ev("location.href").catch(() => "(navigating)");
  console.log("after reload: ", atReload.slice(0, 90));
  if (!atReload.startsWith("chrome-extension://")) throw new Error("the bypass outlived its one navigation (reload stayed native)");

  // ...and so is the same PDF in a new tab.
  const tab2 = await http(`/json/new?about:blank`, "PUT");
  const client2 = makeClient(tab2.webSocketDebuggerUrl);
  await new Promise((r) => (client2.socket.onopen = r));
  await client2.send("Page.enable");
  await client2.send("Page.navigate", { url: URL0 });
  await sleep(5000);
  const atNewTab = await client2.ev("location.href").catch(() => "(navigating)");
  console.log("new tab nav:  ", atNewTab.slice(0, 90));
  try { client2.socket.close(); } catch {}
  if (!atNewTab.startsWith("chrome-extension://")) throw new Error("a new tab stayed native — the bypass was persisted");

  // Nothing was saved: the stored list is exactly what it was.
  const after = await client1.ev(`chrome.storage.sync.get("bypassUrls").then((s) => JSON.stringify(s.bypassUrls || []))`);
  if (after !== before) throw new Error("the button wrote to bypassUrls");

  console.log("PASS — native once, intercepted again, nothing saved");
  process.exitCode = 0;
} catch (e) { console.error("nativebtn error:", e.message || e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
