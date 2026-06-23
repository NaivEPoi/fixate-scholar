// Verify the DNR session-rule registration: load the extension, read the
// registered session rules (ids must be unique — the "Rule with id 203 does not
// have a unique ID" bug), then HAMMER the registration path concurrently
// (rapid storage.sync writes → many overlapping registerRules() calls) and
// confirm no duplicate-id error and the final rule set is still well-formed.
// Captures service-worker console errors / exceptions throughout.
// Usage: node test/diag-dnr.mjs

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const PORT = 9461 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-dnr-${process.pid}`);
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

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(250); } }
  // Find the extension service-worker target.
  let sw = null;
  for (let i = 0; i < 60 && !sw; i++) { const t = await http("/json/list"); sw = t.find((x) => x.url.includes("service-worker.mjs")); if (!sw) await sleep(300); }
  if (!sw) throw new Error("service worker target not found");
  console.log(`Browser: ${version.Browser}\nSW: ${sw.url}\n`);
  ws = new WebSocket(sw.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  // Capture SW console errors and uncaught exceptions.
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") errors.push("EXC: " + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("ERR: " + m.params.args.map((a) => a.value || a.description || "").join(" "));
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("LOG: " + m.params.entry.text);
  });
  await send("Runtime.enable");
  await send("Log.enable");
  await sleep(1500);

  const idsOf = (rules) => rules.map((r) => r.id).sort((a, b) => a - b);
  const dupes = (ids) => ids.filter((v, i) => ids.indexOf(v) !== i);

  const before = await ev(`chrome.declarativeNetRequest.getSessionRules().then(rs => rs.map(r => r.id))`);
  console.log("initial session-rule ids:", JSON.stringify(idsOf(before.map((id) => ({ id })))));

  // HAMMER: fire many storage writes without awaiting → overlapping
  // storage.onChanged → registerRules() calls. With the old code (snapshot
  // race) this produced the duplicate-id error.
  await ev(`(() => { for (let i = 0; i < 12; i++) chrome.storage.sync.set({ bypassOrigins: ["https://h" + i + ".example.com"] }); return true; })()`);
  await sleep(2500);

  const after = await ev(`chrome.declarativeNetRequest.getSessionRules()`);
  const ids = idsOf(after);
  const d = dupes(ids);
  console.log("after-hammer rule ids:", JSON.stringify(ids));
  console.log("duplicate ids:", JSON.stringify(d));
  const hasStatic = [201, 202, 203].every((x) => ids.includes(x));
  console.log("has 201/202/203:", hasStatic);
  console.log("\nSW errors captured:", errors.length);
  for (const e of errors.slice(0, 12)) console.log("  " + e);

  const pass = d.length === 0 && hasStatic && !errors.some((e) => /unique ID|registerRules|declarativeNetRequest/i.test(e));
  console.log("\n" + (pass ? "PASS — no duplicate-id error, rules well-formed" : "FAIL"));
  process.exitCode = pass ? 0 : 1;
} catch (e) { console.error("dnr diag error:", e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
