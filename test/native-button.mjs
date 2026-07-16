// Native-button end-to-end: navigate to a PDF URL (http or file) -> expect
// the redirect into the viewer -> trigger fx-bypass-once (what the "native"
// button sends) -> expect the tab to land on the original URL and STAY there.
// Usage: node nativebtn.mjs <pdf-url>
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const URL0 = process.argv[2];
const EXT = "C:\\misc\\Claude_Workspace\\fixate-scholar\\extension";
const PORT = 9111 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-nb-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1200,1500",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result.value; };

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  // Navigate a fresh tab to the PDF URL itself — interception should engage.
  const tab = await http(`/json/new?about:blank`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await sleep(1500);
  await send("Page.navigate", { url: URL0 });
  await sleep(5000);
  const at1 = await ev("location.href");
  const inViewer = at1.startsWith("chrome-extension://");
  console.log("after nav:", inViewer ? "VIEWER (intercepted ok)" : at1.slice(0, 80));
  if (!inViewer) throw new Error("interception did not engage — cannot test the button");
  // Trigger exactly what the native button sends.
  await ev(`chrome.runtime.sendMessage({ type: "fx-bypass-once", url: ${JSON.stringify(URL0)} })`);
  await sleep(4000);
  const at2 = await ev("location.href").catch(() => "(navigating)");
  await sleep(5000); // would bounce back within this window if broken
  const at3 = await ev("location.href").catch(() => "(navigating)");
  const ok = at3 === URL0 || decodeURIComponent(at3) === decodeURIComponent(URL0);
  console.log("after bypass:", at2.slice(0, 90));
  console.log("5s later:   ", at3.slice(0, 90));
  console.log(ok ? "PASS — stayed in the native viewer" : "FAIL — bounced back");
  process.exitCode = ok ? 0 : 1;
} catch (e) { console.error("nativebtn error:", e.message || e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
