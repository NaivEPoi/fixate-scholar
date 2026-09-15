// Zips extension/ into dist/fixate-scholar-<version>.zip for Chrome Web Store upload.
// Requires extension/vendor/pdfjs to exist (run `npm run setup` first).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(root, "extension");
const distDir = join(root, "dist");

if (!existsSync(join(extDir, "vendor", "pdfjs", "web", "viewer.html"))) {
  console.error("extension/vendor/pdfjs missing — run `npm run setup` first.");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
const zipPath = join(distDir, `fixate-scholar-${version}.zip`);
mkdirSync(distDir, { recursive: true });
rmSync(zipPath, { force: true });

if (process.platform === "win32") {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Compress-Archive -Path (Join-Path $env:SRC '*') -DestinationPath $env:DST -Force",
    ],
    {
      env: { ...process.env, SRC: extDir, DST: zipPath },
      stdio: "inherit",
    },
  );
} else {
  let packed = false;
  // Try native zip CLI first
  try {
    execFileSync("zip", ["-qr", zipPath, "."], { cwd: extDir });
    packed = true;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  // Fallback to python3 / python zipfile module if zip CLI is not installed
  if (!packed) {
    for (const py of ["python3", "python"]) {
      try {
        execFileSync(py, ["-m", "zipfile", "-c", zipPath, "."], { cwd: extDir });
        packed = true;
        break;
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    }
  }

  // Fallback to bsdtar if available
  if (!packed) {
    try {
      execFileSync("tar", ["-a", "-cf", zipPath, "*"], { cwd: extDir });
      packed = true;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  if (!packed) {
    console.error("No zip utility found (tried zip, python3/python zipfile, tar).");
    process.exit(1);
  }
}
console.log(`Wrote ${zipPath}`);
