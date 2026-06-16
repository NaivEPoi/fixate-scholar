// Zips extension/ into dist/scholar-lens-<version>.zip for Chrome Web Store upload.
// Requires extension/vendor/pdfjs to exist (run fetch-pdfjs first).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(root, "extension");
const distDir = join(root, "dist");

if (!existsSync(join(extDir, "vendor", "pdfjs", "web", "viewer.html"))) {
  console.error("extension/vendor/pdfjs missing — run `npm run fetch-pdfjs` first.");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
const zipPath = join(distDir, `scholar-lens-${version}.zip`);
mkdirSync(distDir, { recursive: true });
rmSync(zipPath, { force: true });

if (process.platform === "win32") {
  execFileSync("powershell.exe", [
    "-NoProfile", "-Command",
    `Compress-Archive -Path "${extDir}\\*" -DestinationPath "${zipPath}"`,
  ]);
} else {
  execFileSync("zip", ["-qr", zipPath, "."], { cwd: extDir });
}
console.log(`Wrote ${zipPath}`);
