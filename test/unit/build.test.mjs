import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BUILD } from "../../extension/build.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("build.mjs carries the manifest's version", () => {
  const manifest = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(BUILD, manifest.version, "extension/build.mjs must be bumped with manifest.json");
  assert.equal(pkg.version, manifest.version, "package.json must be bumped with manifest.json");
});
