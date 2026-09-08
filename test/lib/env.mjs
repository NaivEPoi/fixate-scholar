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

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
 * Chromium builds that still load an UNPACKED extension from the command line.
 *
 * Branded Google Chrome no longer does. It refuses the switch outright —
 * `--load-extension is not allowed in Google Chrome, ignoring`
 * (chrome/browser/extensions/extension_service.cc) — and the extension is
 * simply never installed: `chrome-extension://<id>/manifest.json` comes back
 * ERR_BLOCKED_BY_CLIENT and no service-worker target ever appears. Measured on
 * Chrome 152; neither `--enable-unsafe-extension-debugging` (with or without
 * `--remote-debugging-pipe`) nor
 * `--disable-features=DisableLoadExtensionCommandLineSwitch` brings it back.
 *
 * So anything that needs the extension in the browser must run on an unbranded
 * Chromium (Chrome for Testing, Chromium) or on Edge — which is what the rest
 * of the suite already uses. Chrome for Testing is preferred when present
 * because it is the closest thing to Chrome itself.
 */
function extensionCandidates() {
  const cft = [];
  // Chrome for Testing, as @puppeteer/browsers installs it.
  const cache = join(homedir(), ".cache", "puppeteer", "chrome");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache)) {
      cft.push(
        join(cache, dir, "chrome-win64", "chrome.exe"),
        join(cache, dir, "chrome-linux64", "chrome"),
        join(cache, dir, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        join(cache, dir, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      );
    }
  }
  return [
    ...cft,
    "C:/Program Files/Chromium/Application/chrome.exe",
    join(homedir(), "AppData/Local/Chromium/Application/chrome.exe"),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    ...CANDIDATES.edge,
  ];
}

/**
 * Resolve a browser that can actually run the unpacked extension.
 *
 * Same override semantics as `browserPath`: an explicit path — CLI argument or
 * FX_BROWSER / FX_CHROME / FX_EDGE — always wins, so asking for a specific
 * binary (including branded Chrome, to watch it refuse) still works. Otherwise
 * the first installed entry from `extensionCandidates()` is used; branded
 * Chrome is never chosen on its own, because with it the run cannot succeed.
 */
export function extensionBrowserPath(override) {
  const explicit =
    override || process.env.FX_BROWSER || process.env.FX_CHROME || process.env.FX_EDGE;
  if (explicit) return explicit;
  const candidates = extensionCandidates();
  return candidates.find((p) => existsSync(p)) ?? browserPath("edge");
}

/**
 * Read a browser's own log and report, in one line, that it refused to load the
 * extension — or null if it never said so.
 *
 * Worth the few lines: without it the symptom is a harness timing out on "no
 * service-worker target", which reads as a broken extension or a slow machine
 * and sent this project looking in the wrong place. The browser says exactly
 * what happened; it just says it on stderr, which needs `--enable-logging=stderr`
 * and a piped stdio to see.
 */
export function extensionLoadRefusal(log) {
  // Both switches are refused, and only ONE of the two warnings is printed:
  // with both on the command line Chrome complains about
  // --disable-extensions-except and never gets as far as --load-extension. So
  // match either, or the message would appear only in the variant nobody runs.
  const REFUSED = /--(load-extension|disable-extensions-except) is not allowed/;
  const line = String(log).split(/\r?\n/).find((l) => REFUSED.test(l));
  if (!line) return null;
  return (
    "this browser refuses command-line extension loading: " +
    line.slice(line.indexOf("--")).trim() +
    " — run it on Edge, Chromium, or Chrome for Testing (see extensionBrowserPath)"
  );
}

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
