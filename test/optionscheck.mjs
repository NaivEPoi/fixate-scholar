// The options page still loads (it imports lookup-cache.mjs now), and "Clear
// stored lookups" actually clears what the lookup cache wrote. Console must be
// silent — the release gate's rule, applied to the page this round touched.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { extensionBrowserPath, extensionDir, profileDir } from "./lib/env.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9331 + (process.pid % 90);
const userDataDir = profileDir("optionscheck");
const browser = spawn(extensionBrowserPath(), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync",
  `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank",
], { stdio: "ignore" });
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

let ws;
let nextId = 0;
const noise = [];
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", h);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 300));
  return r.result.value;
};

let failed = false;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(400); } }
  let sw = null;
  for (let i = 0; i < 60 && !sw; i++) {
    const t = await http("/json/list");
    sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs"));
    if (!sw) await sleep(400);
  }
  const extId = new URL(sw.url).hostname;
  const tab = await http(`/json/new?chrome-extension://${extId}/options/options.html`, "PUT");
  await sleep(1500);
  const live = (await http("/json/list")).find((t) => t.id === tab.id) ?? tab;
  ws = new WebSocket(live.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") noise.push("exception: " + JSON.stringify(m.params).slice(0, 200));
    if (m.method === "Runtime.consoleAPICalled") noise.push(m.params.type + ": " + JSON.stringify(m.params.args?.[0]?.value ?? "").slice(0, 160));
    if (m.method === "Log.entryAdded") noise.push(m.params.entry.level + ": " + m.params.entry.text.slice(0, 160));
  });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Page.reload");
  await sleep(2500);

  check(await ev(`!!document.getElementById("enabled")`), "options page rendered");
  check(await ev(`!!document.getElementById("clearLookups")`), "clear-lookups control present");

  // Write two cache records the way the lookup does, then clear from the page.
  await ev(`(async () => {
    const c = await import("/viewer/references/lookup-cache.mjs");
    await c.writeCached("q one", { title: "T1" });
    await c.writeCached("q two", null);
    return true;
  })()`);
  const before = await ev(`(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith("fx.cite.")).length)()`);
  check(before === 3, "cache wrote two records and an index", `keys=${before}`);
  const readBack = await ev(`(async () => {
    const c = await import("/viewer/references/lookup-cache.mjs");
    return [await c.readCached("q one"), await c.readCached("q two") === null, await c.readCached("never asked") === undefined];
  })()`);
  check(readBack[0]?.title === "T1" && readBack[1] && readBack[2], "match, remembered miss and never-asked read back distinctly", JSON.stringify(readBack));

  await ev(`document.getElementById("clearLookups").click()`);
  await sleep(600);
  const after = await ev(`(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith("fx.cite.")).length)()`);
  check(after === 0, "clear-lookups emptied the cache", `keys=${after}`);
  check(
    (await ev(`document.getElementById("clearLookupsOut").textContent`)) === "Cleared.",
    "clear-lookups reports back",
  );
  check(noise.length === 0, "console silent on the options page", noise.join(" | ").slice(0, 300));
} catch (e) {
  check(false, "options check", e.message || String(e));
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  console.log(failed ? "\nFAILURES" : "\nALL CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
