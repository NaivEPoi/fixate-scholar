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

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
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

/**
 * The debug port a harness browser chose for itself. Launched with
 * --remote-debugging-port=0 the browser binds a FREE port and writes it to
 * <profile>/DevToolsActivePort; this waits for that file (written after
 * `since`, so a stale one from an earlier run in a reused profile is ignored).
 *
 * Harnesses used to pick `base + pid % N`. With 8 lanes two of them regularly
 * landed on the same number, the second browser could not bind it, and its
 * harness silently drove the FIRST harness's browser: two documents in one
 * browser, the other's tab in front (this one hidden, so the engine paused),
 * the other harness switching reading mode off mid-measurement. The gate read
 * that as unprocessed pages, "zoom flips", documents with nothing processed and
 * emphasis that never came back after a toggle.
 */
export async function devtoolsPort(userDataDir, since = 0, { timeoutMs = 30000 } = {}) {
  const file = join(userDataDir, "DevToolsActivePort");
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (statSync(file).mtimeMs >= since - 2000) {
        const port = parseInt(readFileSync(file, "utf8").split("\n")[0], 10);
        if (port > 0) return port;
      }
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("debugger endpoint never came up (no DevToolsActivePort)");
}

/**
 * Kill a spawned browser AND the processes it spawned.
 *
 * `child.kill()` signals only the launcher. Chromium's renderer, GPU and
 * utility processes are not in that process group and survive it, holding
 * their profile directory, their remote-debugging port, and their share of
 * memory. One document leaks ~9 processes; a corpus sweep leaks hundreds.
 *
 * Measured: a full two-corpus gate run left **476 live msedge processes and
 * 1.1 GB of free RAM**, at which point new harnesses could not bind their
 * debug port and failed with "extension did not load" / `chrome.storage`
 * undefined. Several documents were recorded as product failures over it, and
 * re-ran clean once the litter was cleared. The leak is the harness's, so the
 * fix belongs here rather than in a retry loop.
 *
 * On Windows `taskkill /T` is what walks the tree; elsewhere the process group
 * does, since the child is spawned into one.
 */
export function killBrowser(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
        stdio: "ignore",
        timeout: 30000,
      });
    } else {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  } catch {
    // Already gone, or taskkill raced the exit — fall back to the plain kill so
    // this is never worse than what it replaces.
    try { child.kill(); } catch { /* nothing left to kill */ }
  }
}

/**
 * Last-resort net for the harnesses that still call `child.kill()` directly,
 * and for a run that dies before its own cleanup: at process exit, kill any
 * browser whose profile directory carries THIS process's pid.
 *
 * Every harness names its profile `fx-<tag>-<pid>` (see `profileDir`, and the
 * few that build the path inline the same way), so the pid in the path is an
 * unambiguous owner tag — this can never reach a browser belonging to another
 * run, which matters because the corpus sweeps run several lanes at once.
 * Synchronous on purpose: an exit handler cannot await.
 */
if (process.platform === "win32" && !process.env.FX_NO_REAP) {
  process.on("exit", () => {
    try {
      // The pid must END the directory name, or `fx-cp-123` would also claim
      // `fx-cp-1234`. Written `[^0-9]` rather than `\D` on purpose: this
      // pattern is interpolated into a PowerShell single-quoted string, and a
      // backslash class survives one layer of escaping less reliably than a
      // character set does.
      const own = `fx-[A-Za-z0-9-]*?-${process.pid}(?:[^0-9]|$)`;
      execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command",
         `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | ` +
         `Where-Object { $_.CommandLine -match '${own}' } | ` +
         `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
        { stdio: "ignore", timeout: 20000 },
      );
    } catch { /* nothing to reap, or the process list moved under us */ }
  });
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
