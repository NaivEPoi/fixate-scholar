// No stray C0 control byte in shipped source.
//
// This is here because one shipped. A regex written through a patch script
// became a literal BACKSPACE followed by the pattern, where a word-boundary
// escape was meant. The regex then matched nothing, the guard it belonged to
// was silently inert, and the byte was invisible in every terminal that printed
// the line — a backspace erases the character before it on display, so the line
// looked correct and was even one character short without that reading as
// wrong. It took an `od -c` to find. A unit test is cheaper than the next one.
//
// Tab, newline and carriage return are the legitimate ones; everything else in
// C0, plus DEL, is a mistake in a source file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SKIP = new Set(["node_modules", ".git", "vendor", "out", "dist"]);
const TEXT = /\.(mjs|js|json|css|html|md)$/;
// C0 minus tab (09), newline (0a), carriage return (0d), plus DEL (7f).
const BAD = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]");

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (TEXT.test(name)) yield full;
  }
}

test("no stray control bytes in shipped source", () => {
  const hits = [];
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, "utf8");
    if (!BAD.test(text)) continue;
    const line = text.split("\n").findIndex((l) => BAD.test(l)) + 1;
    const code = BAD.exec(text)[0].charCodeAt(0).toString(16).padStart(2, "0");
    hits.push(`${file.slice(root.length + 1)}:${line} (0x${code})`);
  }
  assert.deepEqual(hits, [], `control bytes found:\n  ${hits.join("\n  ")}`);
});
