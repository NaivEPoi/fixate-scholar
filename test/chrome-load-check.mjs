// Diagnose Chrome unpacked-extension loading: capture Chrome stderr and dump
// every debug target, trying a few flag combinations. Tells us whether
// --load-extension is honored by this Chrome build and under which flags.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "extension");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VARIANTS = [
  ["disable-feature flag", ["--disable-features=DisableLoadExtensionCommandLineSwitch"]],
  ["no extra flag", []],
  ["headful + disable-feature", ["--disable-features=DisableLoadExtensionCommandLineSwitch"], false],
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
    if (targets.some((t) => t.url.includes("chrome-extension://"))) break;
  }
  const ext = targets.filter((t) => t.url.includes("chrome-extension://"));
  console.log(`\n=== ${label} (headless=${headless.length > 0}) ===`);
  console.log("extension targets:", ext.length, ext.map((t) => `${t.type}:${t.url.slice(0, 60)}`).join(" | ") || "(none)");
  console.log("all target types:", targets.map((t) => t.type).join(","));
  const err = stderr.join("");
  const relevant = err.split("\n").filter((l) => /extension|load|flag|not allowed|unsupported|developer/i.test(l)).slice(0, 5);
  if (relevant.length) console.log("stderr (relevant):\n  " + relevant.join("\n  "));
  browser.kill();
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
