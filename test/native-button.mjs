// Native-button end-to-end: navigate to a PDF URL (http or file) -> expect
// the redirect into the viewer -> trigger fx-bypass-once (what the "native"
// button sends) -> expect the tab to land on the original URL and STAY there
// across reloads and subsequent tab navigations.
// Usage: node nativebtn.mjs <pdf-url>
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir } from "./lib/env.mjs";

const URL0 = process.argv[2] || "https://yilud.me/SIB-Auth.pdf";
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

  // Trigger exactly what the native button sends.
  await client1.ev(`chrome.runtime.sendMessage({ type: "fx-bypass-once", url: ${JSON.stringify(URL0)} })`);
  await sleep(4000);
  const at2 = await client1.ev("location.href").catch(() => "(navigating)");
  await sleep(3000);
  const at3 = await client1.ev("location.href").catch(() => "(navigating)");
  const ok = at3 === URL0 || decodeURIComponent(at3) === decodeURIComponent(URL0);
  console.log("after bypass: ", at2.slice(0, 90));
  console.log("native view:  ", at3.slice(0, 90));
  if (!ok) throw new Error("did not navigate to native viewer");

  // Verify that reloading the tab stays in the native viewer (persistent bypass)
  await client1.send("Page.reload");
  await sleep(4000);
  const atReload = await client1.ev("location.href").catch(() => "(navigating)");
  const reloadOk = atReload === URL0 || decodeURIComponent(atReload) === decodeURIComponent(URL0);
  console.log("after reload: ", atReload.slice(0, 90));
  if (!reloadOk) throw new Error("reloading PDF bounced back into FixateScholar");

  // Verify that reopening the same PDF in a new tab stays in the native viewer
  const tab2 = await http(`/json/new?about:blank`, "PUT");
  const client2 = makeClient(tab2.webSocketDebuggerUrl);
  await new Promise((r) => (client2.socket.onopen = r));
  await client2.send("Page.enable");
  await client2.send("Page.navigate", { url: URL0 });
  await sleep(4000);
  const atNewTab = await client2.ev("location.href").catch(() => "(navigating)");
  const newTabOk = atNewTab === URL0 || decodeURIComponent(atNewTab) === decodeURIComponent(URL0);
  console.log("new tab nav:  ", atNewTab.slice(0, 90));
  try { client2.socket.close(); } catch {}
  if (!newTabOk) throw new Error("reopening PDF in a new tab bounced back into FixateScholar");

  console.log("PASS — stayed in native viewer across reloads and new tabs");
  process.exitCode = 0;
} catch (e) { console.error("nativebtn error:", e.message || e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
