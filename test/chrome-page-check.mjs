// Inspect what the viewer page context actually is in headless Chrome.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9600 + (process.pid % 90);
const userDataDir = join(tmpdir(), `fx-pc-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
const HEADLESS = !process.argv.includes("--headful");

const browser = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, ...(HEADLESS ? ["--headless=new"] : []), "--no-first-run",
  "--no-default-browser-check", "--disable-sync",
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "") }; return r.result.value; };

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("chrome-extension://")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  console.log(`Browser: ${version.Browser} headless=${HEADLESS} ext=${extId}`);
  // Navigate to the PDF URL itself; the extension's DNR rule redirects it into
  // the viewer (Chrome blocks direct top-level nav to a web_accessible_resource).
  await sleep(1200); // let the SW register its DNR rules
  const pdfUrl = "https://arxiv.org/pdf/1706.03762";
  const tab = await http(`/json/new?${pdfUrl}`, "PUT");
  console.log("tab.url:", tab.url, "\ntab.type:", tab.type);
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await send("Runtime.enable");
  for (let i = 0; i < 12; i++) {
    await sleep(1500);
    const info = await ev(`({ href: location.href, ready: document.readyState, title: document.title, hasApp: typeof window.PDFViewerApplication, hasChrome: typeof chrome, hasStorage: typeof (chrome && chrome.storage), bodyLen: (document.body && document.body.innerText || '').length, err: document.querySelector('#errorWrapper:not([hidden])') ? document.querySelector('#errorMessage')?.textContent : null })`);
    console.log(`t+${(i + 1) * 1.5}s`, JSON.stringify(info));
    if (info && info.hasApp === "object") break;
  }
} catch (e) { console.error("page-check error:", e); }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
