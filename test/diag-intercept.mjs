// Verify the master "Open PDFs in FixateScholar" interception switch actually
// gates the declarativeNetRequest redirect rules:
//   1. default (intercept unset → true)  → redirect rules 201/202/203 present
//   2. set intercept = false             → ALL managed redirect rules removed
//   3. set intercept = true              → redirect rules come back
// Captures service-worker console errors / exceptions throughout.
// Usage: node test/diag-intercept.mjs

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9461 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-intercept-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1200,900",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 0;
const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const redirectIds = () =>
  ev(`chrome.declarativeNetRequest.getSessionRules().then(rs => rs.map(r => r.id).sort((a,b)=>a-b))`);

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  let sw = null;
  for (let i = 0; i < 60 && !sw; i++) { const t = await http("/json/list"); sw = t.find((x) => x.url.includes("service-worker.mjs")); if (!sw) await sleep(300); }
  if (!sw) throw new Error("service worker target not found");
  console.log(`Browser: ${version.Browser}\nSW: ${sw.url}\n`);
  ws = new WebSocket(sw.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") errors.push("EXC: " + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("ERR: " + m.params.args.map((a) => a.value || a.description || "").join(" "));
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("LOG: " + m.params.entry.text);
  });
  await send("Runtime.enable");
  await send("Log.enable");
  await sleep(1500);

  const STATIC = [201, 202, 203];
  const has = (ids, set) => set.every((x) => ids.includes(x));

  const onDefault = await redirectIds();
  console.log("default (intercept unset) ids:", JSON.stringify(onDefault));
  const defaultOk = has(onDefault, STATIC);

  await ev(`chrome.storage.sync.set({ intercept: false })`);
  await sleep(1500);
  const offIds = await redirectIds();
  console.log("intercept=false ids:        ", JSON.stringify(offIds));
  // Off = no managed rules (< 900). A stray transient bypass-once id (>=900)
  // wouldn't matter, but none should exist here anyway.
  const offOk = offIds.filter((id) => id < 900).length === 0;

  await ev(`chrome.storage.sync.set({ intercept: true })`);
  await sleep(1500);
  const onIds = await redirectIds();
  console.log("intercept=true  ids:        ", JSON.stringify(onIds));
  const onOk = has(onIds, STATIC);

  console.log("\nSW errors captured:", errors.length);
  for (const e of errors.slice(0, 12)) console.log("  " + e);

  const pass = defaultOk && offOk && onOk &&
    !errors.some((e) => /unique ID|registerRules|declarativeNetRequest/i.test(e));
  console.log(`\ndefault has 201/202/203: ${defaultOk}`);
  console.log(`off removed all redirects: ${offOk}`);
  console.log(`on restored 201/202/203:  ${onOk}`);
  console.log("\n" + (pass ? "PASS — interception switch gates redirect rules" : "FAIL"));
  process.exitCode = pass ? 0 : 1;
} catch (e) { console.error("intercept diag error:", e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
