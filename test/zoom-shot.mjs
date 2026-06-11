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
  await sleep(6000);
  const page = parseInt(process.argv[3] ?? "1", 10);
  if (page > 1) {
    await send("Runtime.evaluate", {
      expression: `window.PDFViewerApplication.page = ${page}`,
    });
    await sleep(6000);
  }
  const probe = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const container = document.getElementById('viewerContainer');
      const b = document.querySelector('.textLayer span[data-fx-done] .fx-b');
      const cs = b ? getComputedStyle(b) : null;
      const span = b?.closest('span');
      return {
        fxFont: container.dataset.fxFont,
        stroke: cs?.webkitTextStrokeWidth,
        weight: cs?.fontWeight,
        color: cs?.color,
        sampleBold: b?.textContent,
        sampleSpan: span?.textContent.slice(0, 50),
        fontFamily: span?.style.fontFamily.slice(0, 40),
        bolded: document.querySelectorAll('.fx-b').length,
      };
    })()`,
  });
  console.log(JSON.stringify(probe.result.value, null, 2));
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 480, y: 700, width: 420, height: 160, scale: 3 },
  });
  writeFileSync(join(root, "test", "out", "abstract-zoom.png"), Buffer.from(shot.data, "base64"));
  console.log("saved test/out/abstract-zoom.png");
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  rmSync(userDataDir, { recursive: true, force: true });
}
