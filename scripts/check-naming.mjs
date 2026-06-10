// Fails the build if the trademarked brand name appears anywhere in the repo
// (outside vendored PDF.js and this guard's own constituent parts). The mark
// is assembled from fragments here so this file itself never contains it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN = new RegExp("bio" + "nic[\\s_-]*read", "i");
const SKIP_DIRS = new Set(["node_modules", ".git", "vendor", "dist"]);

const offenders = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path);
    } else if (/\.(mjs|js|json|html|css|md|txt)$/i.test(name)) {
      if (FORBIDDEN.test(readFileSync(path, "utf8"))) {
        offenders.push(relative(root, path));
      }
    }
  }
}
walk(root);

if (offenders.length) {
  console.error("Trademarked name found in:\n  " + offenders.join("\n  "));
  console.error(
    "Use generic descriptors instead: fixation typography, guided reading, biomimetic typography.",
  );
  process.exit(1);
}
console.log("Naming guard passed.");
