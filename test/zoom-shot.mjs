// Capture a magnified clip of the abstract area to eyeball the typography.
import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "test", "out"), { recursive: true });
const EXT = join(root, "extension");
const PORT = 9335;
const userDataDir = join(tmpdir(), `fx-zoom-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(
  process.argv[2] || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    `--remote-debugging-port=${PORT}`,
    "--headless=new",
    "--no-first-run",
    "--disable-sync",
    "--window-size=1400,1800",
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      await sleep(250);
    }
  }
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const sw = targets.find((t) => t.url.includes("service-worker"));
    if (sw) extId = new URL(sw.url).hostname;
    else await sleep(250);
  }
  const viewerUrl = `chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent("https://arxiv.org/pdf/1706.03762")}`;
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${viewerUrl}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 0;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === id) {
          ws.removeEventListener("message", h);
          resolve(m.result);
        }
      };
      ws.addEventListener("message", h);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await sleep(4000);
  await send("Runtime.evaluate", {
    expression: "chrome.storage.sync.set({ enabled: true })",
    awaitPromise: true,
  });
  await sleep(10000);
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 480, y: 520, width: 620, height: 300, scale: 2 },
  });
  writeFileSync(join(root, "test", "out", "abstract-zoom.png"), Buffer.from(shot.data, "base64"));
  console.log("saved test/out/abstract-zoom.png");
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
