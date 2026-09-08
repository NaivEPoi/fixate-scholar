// Diagnose unpacked-extension loading in a given browser: capture its stderr,
// dump every debug target, and try the flag combinations that have been
// proposed as ways to re-enable --load-extension.
//
// The answer for BRANDED Google Chrome, measured on Chrome 152, is that there
// is none. Chrome says so itself -- "--load-extension is not allowed in Google
// Chrome, ignoring" -- and chrome-extension://<id>/manifest.json then comes
// back ERR_BLOCKED_BY_CLIENT. Neither the feature-flag form nor
// --enable-unsafe-extension-debugging (with or without --remote-debugging-pipe)
// changes it. Run this against a candidate browser before assuming otherwise;
// every other harness uses extensionBrowserPath() to pick one that works.
//
// Usage: node test/chrome-load-check.mjs [browser-path]   (default: Chrome)
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { browserPath } from "./lib/env.mjs";

const CHROME = browserPath("chrome", process.argv[2]);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VARIANTS = [
  ["no extra flag", []],
  ["disable-feature flag", ["--disable-features=DisableLoadExtensionCommandLineSwitch"]],
  ["unsafe extension debugging", ["--enable-unsafe-extension-debugging"]],
  ["unsafe + debugging pipe", ["--enable-unsafe-extension-debugging", "--remote-debugging-pipe"]],
  ["headful, no extra flag", [], false],
];

for (const [label, extra, headlessOverride] of VARIANTS) {
  const PORT = 9500 + Math.floor(Math.random() * 80);
  const userDataDir = join(tmpdir(), `fx-cl-${process.pid}-${PORT}`);
  const headless = headlessOverride === false ? [] : ["--headless=new"];
  const args = [
    `--remote-debugging-port=${PORT}`, ...headless, "--no-first-run",
    "--no-default-browser-check", "--disable-sync", ...extra,
    `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`, "about:blank",
  ];
  const stderr = [];
  const browser = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"] });
  browser.stderr.on("data", (d) => stderr.push(d.toString()));
  let targets = [];
  for (let i = 0; i < 24; i++) {
    await sleep(400);
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch {}
    // Wait for OUR service worker, not for any chrome-extension:// target:
    // the browser's own component extensions show up within a second and used
    // to end this loop early, which reported "no" for a browser that does load
    // the extension, just a little later.
    if (targets.some((t) => t.url.includes("background/service-worker.mjs"))) break;
  }
  const ext = targets.filter((t) => t.url.includes("chrome-extension://"));
  // The browser ships component extensions of its own, so a non-zero count of
  // extension targets says nothing. Only OUR service worker does.
  const ours = ext.some((t) => t.url.includes("background/service-worker.mjs"));
  console.log(`\n=== ${label} (headless=${headless.length > 0}) ===`);
  console.log("OUR extension loaded:", ours ? "YES" : "no");
  console.log("extension targets:", ext.length, ext.map((t) => `${t.type}:${t.url.slice(0, 60)}`).join(" | ") || "(none)");
  console.log("all target types:", targets.map((t) => t.type).join(",") || "(none - the HTTP endpoint is off when --remote-debugging-pipe is used)");
  const err = stderr.join("");
  const relevant = err.split("\n").filter((l) => /extension|load|flag|not allowed|unsupported|developer/i.test(l)).slice(0, 5);
  if (relevant.length) console.log("stderr (relevant):\n  " + relevant.join("\n  "));
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
