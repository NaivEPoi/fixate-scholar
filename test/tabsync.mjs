// Settings across tabs: two viewer tabs of one PDF; the font mode is changed
// three times from tab A while tab B is in the background, then B is brought
// forward. B must apply nothing while hidden, then exactly ONE change, straight
// to the final value. Every change used to be queued and applied in order, so a
// background tab replayed each intermediate state once it was shown.
// Usage: node test/tabsync.mjs [--url=<pdf>]   exit 1 on a replay
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { browserPath, extensionDir, profileDir, killBrowser, devtoolsPort } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";

const URL0 = process.argv.find((a) => a.startsWith("--url="))?.slice(6) ?? "https://yilud.me/SIB-Auth.pdf";
const userDataDir = profileDir("tabsync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const launched = Date.now();
let PORT = 0;
const http = async (p, m = "GET") => { PORT ||= await devtoolsPort(userDataDir, launched); return (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json(); };
const browser = spawn(browserPath("edge"), [`--remote-debugging-port=0`, "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-sync", "--window-size=1300,1500", `--user-data-dir=${userDataDir}`, `--load-extension=${extensionDir}`,
  `--disable-extensions-except=${extensionDir}`, "about:blank"], { stdio: "ignore" });
const open = async (extId) => {
  const t = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  const c = connect(t.webSocketDebuggerUrl, { where: "viewer", timeoutMs: 60000 });
  await c.ready;
  for (let i = 0; i < 40; i++) { if (await c.ev("!!window.PDFViewerApplication?.pdfDocument").catch(() => false)) break; await sleep(500); }
  return { t, c };
};
try {
  let extId = null;
  for (let i = 0; i < 80 && !extId; i++) {
    try { const sw = (await http("/json/list")).find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; } catch {}
    if (!extId) await sleep(300);
  }
  const A = await open(extId);
  const B = await open(extId);
  await sleep(4000);
  // B records every font-mode change it applies.
  await B.c.ev(`(() => { const c = document.getElementById("viewerContainer"); window.__log = [];
    new MutationObserver(() => window.__log.push([document.visibilityState, c.dataset.fxFont])).observe(c, { attributes: true, attributeFilter: ["data-fx-font"] }); return c.dataset.fxFont; })()`);
  await fetch(`http://127.0.0.1:${PORT}/json/activate/${A.t.id}`);
  await sleep(1500);
  console.log("B visibility while A is front:", await B.c.ev("document.visibilityState"));
  for (const mode of ["literata", "atkinson", "lexend"]) {
    await A.c.ev(`new Promise((r) => chrome.storage.sync.set({ fontMode: ${JSON.stringify(mode)} }, r))`);
    await sleep(700);
  }
  await sleep(3000);
  console.log("B changes while hidden:", JSON.stringify(await B.c.ev("window.__log")));
  await fetch(`http://127.0.0.1:${PORT}/json/activate/${B.t.id}`);
  await sleep(6000);
  console.log("B changes after shown:  ", JSON.stringify(await B.c.ev("window.__log")));
  const log = await B.c.ev("window.__log");
  const ok = log.length === 1 && log[0][0] === "visible" && log[0][1] === "lexend";
  console.log(ok ? "PASS — applied once, when shown, to the final value" : "FAIL — the background tab replayed or missed changes");
  if (!ok) process.exitCode = 1;
  A.c.close(); B.c.close();
} catch (e) { console.error("tabsync error:", e.message); process.exitCode = 1; }
finally { killBrowser(browser); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} process.exit(process.exitCode ?? 0); }
