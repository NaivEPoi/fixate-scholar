// A local cache of real Google Scholar result pages, for testing the Scholar
// source without asking Scholar again.
//
// WHY: Scholar answers a limited number of searches before it starts serving a
// captcha to everything from that address — including a person's own tab — and
// once that happens the Scholar rung cannot be measured at all for hours. A
// recorded page is the same page, forever, at no cost, and makes the parse and
// the verification testable on a plane.
//
// WHERE: `local/scholar-cache/`. `local/` is git-ignored in BOTH `.gitignore`
// and `.git/info/exclude` — the same belt-and-braces the private review corpus
// uses — so a recorded page cannot reach the repository by editing one file.
// These pages are Google's content, fetched with the machine owner's own
// cookies: they stay on the machine that fetched them, exactly like a browser
// cache, and nothing derived from them is committed either.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { root } from "./env.mjs";

/** …/local/scholar-cache, created on demand. */
export function cacheDir() {
  const dir = join(root, "local", "scholar-cache");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A stable file name for a query: a readable slug plus a hash, because two
 *  different queries can slug to the same thing. */
export function keyFor(query) {
  const slug = String(query)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const hash = createHash("sha1").update(String(query)).digest("hex").slice(0, 10);
  return `${slug || "query"}.${hash}`;
}

/** Store one page. `meta` travels beside it so a replay can report what was
 *  recorded, when, and for which reference — without re-deriving any of it. */
export function save(query, html, meta = {}) {
  const dir = cacheDir();
  const key = keyFor(query);
  writeFileSync(join(dir, `${key}.html`), html);
  writeFileSync(
    join(dir, `${key}.json`),
    JSON.stringify({ query, recordedAt: new Date().toISOString(), bytes: html.length, ...meta }, null, 1),
  );
  return key;
}

/** The recorded page for a query, or null. */
export function load(query) {
  const file = join(cacheDir(), `${keyFor(query)}.html`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

export function has(query) {
  return existsSync(join(cacheDir(), `${keyFor(query)}.html`));
}

/** Everything recorded so far: `{key, query, recordedAt, bytes, html}`. */
export function entries() {
  const dir = cacheDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const meta = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const htmlFile = join(dir, f.replace(/\.json$/, ".html"));
      return {
        key: f.replace(/\.json$/, ""),
        ...meta,
        html: existsSync(htmlFile) ? readFileSync(htmlFile, "utf8") : "",
      };
    })
    .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
}

/** One line about the cache, for a harness to print. */
export function summary() {
  const dir = cacheDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
  if (!files.length) return `no pages recorded yet (${dir})`;
  const times = files.map((f) => statSync(join(dir, f)).mtime);
  return (
    `${files.length} page(s) in ${dir}, ` +
    `recorded ${new Date(Math.min(...times)).toISOString().slice(0, 16)} … ` +
    `${new Date(Math.max(...times)).toISOString().slice(0, 16)}`
  );
}
