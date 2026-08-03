// Shared environment resolution for the test and diagnostic scripts.
//
// No script in this repo may hardcode a path to the repo itself: every location
// below is derived from THIS file, so a clone runs from any directory on any
// machine (the scripts used to carry an absolute checkout path, which silently
// pointed at whatever tree the author happened to have).
//
// Browser BINARIES are the one thing that cannot be repo-relative — they live
// wherever the OS installed them. They are discovered from a candidate list and
// can always be overridden: a CLI argument the script passes in, or the
// FX_EDGE / FX_CHROME / FX_BROWSER environment variables.

import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** …/test — this file lives in test/lib/. */
export const testDir = dirname(dirname(fileURLToPath(import.meta.url)));
/** Repository root. */
export const root = dirname(testDir);
/** The unpacked extension to load into the browser. */
export const extensionDir = join(root, "extension");

/** test/out[/sub], created on demand. Git-ignored — safe for shots and dumps. */
export function outDir(sub = "") {
  const dir = sub ? join(testDir, "out", sub) : join(testDir, "out");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A browser profile directory under the OS temp dir.
 *
 * Default is unique per process, for scripts that delete it when they finish.
 * `persistent` gives a STABLE path reused across runs — for the interactive
 * diagnostics that deliberately keep a warm profile (so devtools state and the
 * "allow file URLs" toggle survive) and never clean up after themselves.
 */
export function profileDir(tag, { persistent = false } = {}) {
  return join(tmpdir(), persistent ? `fx-profile-${tag}` : `fx-${tag}-${process.pid}`);
}

// First existing entry wins. Ordered most-likely-first per platform.
const CANDIDATES = {
  edge: [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
  ],
  chrome: [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
  ],
};

/**
 * Resolve a browser executable.
 *
 * `kind` is "edge" or "chrome"; `override` is an explicit path (normally a CLI
 * argument). An explicit path — argument or env var — always wins even if it
 * does not exist, so a typo fails loudly instead of silently launching a
 * different browser than the one asked for. Otherwise the first installed
 * candidate is used; if none is found the first candidate is returned so the
 * spawn error names a real path rather than `undefined`.
 */
export function browserPath(kind = "edge", override) {
  const key = kind === "chrome" ? "chrome" : "edge";
  const explicit =
    override ||
    process.env[key === "chrome" ? "FX_CHROME" : "FX_EDGE"] ||
    process.env.FX_BROWSER;
  if (explicit) return explicit;
  return CANDIDATES[key].find((p) => existsSync(p)) ?? CANDIDATES[key][0];
}
