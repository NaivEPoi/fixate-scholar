// Native-button end-to-end: navigate to a PDF URL (http or file) -> expect
// the redirect into the viewer -> trigger fx-bypass-once (what the "native"
// button sends) -> expect the tab to land on the original URL ONCE: a reload
// and a new tab are intercepted again, and nothing is saved to bypassUrls.
//
// --no-file-access <file-url>: "Allow access to file URLs" off, the default for
// a store install. The browser then refuses every extension navigation to a
// file: URL, so the button must go BACK to the native view the popup's "Open
// in FixateScholar" left behind the viewer — and, in a tab with nothing behind
// it (the context menu's), explain the setting instead of doing nothing.
// Usage: node test/native-button.mjs [pdf-url] [--full-list] [--no-file-access]
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

// What the "native" button does, through the button itself.
const clickNative = (client, times = 1) =>
  client.ev(`(() => { const b = document.getElementById("fxNativeButton"); if (!b) throw new Error("no native button"); for (let i = 0; i < ${times}; i++) b.click(); return true; })()`);

async function noFileAccess(extId) {
  if (!URL0.startsWith("file:")) throw new Error("--no-file-access needs a file:// PDF URL");
  const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
  const page = await http(`/json/new?about:blank`, "PUT");
  const settings = makeClient(page.webSocketDebuggerUrl);
  ws = settings.socket;
  await new Promise((r) => (settings.socket.onopen = r));
  await settings.send("Page.navigate", { url: "chrome://extensions" });
  await sleep(2000);
  await settings.ev(`new Promise((ok, no) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${JSON.stringify(extId)}, fileAccess: false }, () => chrome.runtime.lastError ? no(new Error(chrome.runtime.lastError.message)) : ok()))`);
  await sleep(2000);
  // The worker restarts when the setting changes; find it again.
  let worker = null;
  for (let i = 0; i < 30 && !worker; i++) { worker = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (!worker) await sleep(300); }
  const swc = makeClient((worker || sw).webSocketDebuggerUrl);
  await new Promise((r) => (swc.socket.onopen = r));
  if (await swc.ev("chrome.extension.isAllowedFileSchemeAccess()")) throw new Error("file access is still on");
  const viewerFor = (u) => `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(u)}`;

  // 1. The popup path: the tab shows the file natively, "Open in FixateScholar"
  //    turns it into the viewer (tabs.update, as popup.mjs does).
  const tab = await http(`/json/new?about:blank`, "PUT");
  const c = makeClient(tab.webSocketDebuggerUrl);
  await new Promise((r) => (c.socket.onopen = r));
  await c.send("Page.enable");
  await c.send("Page.navigate", { url: URL0 });
  await sleep(3000);
  const native0 = await c.ev("location.href");
  console.log("no access nav:", native0.startsWith("file:") ? "native (not intercepted, as expected)" : native0.slice(0, 80));
  if (!native0.startsWith("file:")) throw new Error("a file:// PDF was intercepted without file access");
  await swc.ev(`chrome.tabs.query({}).then((ts) => chrome.tabs.update(ts.find((t) => t.url === ${JSON.stringify(native0)}).id, { url: ${JSON.stringify(viewerFor(native0))} })).then(() => true)`);
  await sleep(5000);
  const inViewer = await c.ev("location.href");
  if (!inViewer.startsWith("chrome-extension://")) throw new Error("the popup path did not open the viewer");
  // The viewer's own entries (PDF.js pushes one per jump once a document is
  // open) sit between it and the file; the step back must count them.
  await c.ev(`history.pushState(null, "", "#page=2"); history.pushState(null, "", "#page=3"); true`);
  // A double-click must still land on the file, not past it. (Here the page
  // unloads before a second reply arrives, so this passes without the
  // viewer's one-request latch too — it guards a slower worker.)
  await clickNative(c, 2);
  await sleep(3000);
  const back = await c.ev("location.href").catch(() => "(navigating)");
  console.log("popup path:   ", back.slice(0, 90));
  if (!back.startsWith("file:")) throw new Error("the button did not return to the native view behind the viewer");

  // 2. The viewer opened AGAIN from the viewer: two viewer documents now sit
  //    between it and the file, and a plain history.back() lands on the first.
  await swc.ev(`chrome.tabs.query({}).then((ts) => chrome.tabs.update(ts.find((t) => t.url === ${JSON.stringify(native0)}).id, { url: ${JSON.stringify(viewerFor(native0))} })).then(() => true)`);
  await sleep(4000);
  await c.send("Page.navigate", { url: viewerFor(native0) + "#again" });
  await sleep(1000);
  await c.send("Page.navigate", { url: viewerFor(native0) });
  await sleep(4000);
  await clickNative(c);
  await sleep(2000);
  const twice = await c.ev("location.href").catch(() => "(navigating)");
  console.log("viewer twice: ", twice.slice(0, 90));
  if (!twice.startsWith("file:")) throw new Error("with a viewer behind the viewer, the button did not reach the file");

  // 3. The context-menu path: a new tab with nothing behind the viewer. The
  //    browser allows no way to the file, so the viewer must say why.
  const tab2 = await http(`/json/new?about:blank`, "PUT");
  const c2 = makeClient(tab2.webSocketDebuggerUrl);
  await new Promise((r) => (c2.socket.onopen = r));
  await c2.send("Page.enable");
  await c2.send("Page.navigate", { url: viewerFor(native0) });
  await sleep(5000);
  const banner = await c2.ev(`document.getElementById("fxLoadError")?.textContent || ""`);
  console.log("load banner:  ", banner.slice(0, 120));
  if (!/Allow access to file URLs/.test(banner)) throw new Error("the load-error banner does not name the file-access setting");
  await clickNative(c2);
  await sleep(2000);
  const stay = await c2.ev("location.href");
  const notes = await c2.ev(`document.querySelectorAll(".fx-file-access").length`);
  console.log("menu path:    ", stay.startsWith("chrome-extension://") ? `stays in viewer, ${notes} explanation(s)` : stay.slice(0, 80));
  if (!stay.startsWith("chrome-extension://") || notes !== 1) throw new Error("expected the viewer to stay and explain the setting once");
  // ...and its link opens the page where the setting lives.
  await c2.ev(`document.querySelector(".fx-file-access a").click()`);
  await sleep(2000);
  const settingsTab = (await http("/json/list")).find((x) => x.type === "page" && /^(chrome|edge):\/\/extensions\/\?id=/.test(x.url));
  console.log("settings link:", settingsTab ? settingsTab.url : "(no extensions page opened)");
  if (!settingsTab || !settingsTab.url.endsWith(extId)) throw new Error("the settings link did not open this extension's page");
  for (const x of [c, c2, swc, settings]) try { x.socket.close(); } catch {}
  console.log("PASS — no file access: back to the native view, or the setting explained");
}

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  main: {
  if (process.argv.includes("--no-file-access")) {
    await noFileAccess(extId);
    process.exitCode = 0;
    break main;
  }
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

  await clickNative(client1);
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
  }
} catch (e) { console.error("nativebtn error:", e.message || e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
