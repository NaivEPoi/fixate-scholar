// Pull a harness's per-page probe out of its own source.
//
// The combined runner needs the same probe bodies the standalone harnesses use.
// COPYING them would duplicate the logic, and this project has already shipped a
// defect caused by exactly that: `refcolor.mjs` kept its own copy of the
// parser's reference pattern, the copy carried the same bug as the product, and
// the harness therefore could not report the thing it existed to check. So the
// harness file stays the single source of truth and the probe is read out of it.
//
// The extraction is deliberately dumb: find the marker, then walk forward
// counting backticks that are not escaped until the template closes. If a
// harness is edited into a shape this cannot read, extraction FAILS LOUDLY and
// the caller runs that harness standalone — a combined run that silently drops
// a check is worse than a slow one.
import { readFileSync } from "node:fs";

/**
 * @param src   harness source
 * @param marker  text immediately preceding the opening backtick, e.g.
 *                "const CHECK = (p) => " or "const probe = (page) => ev("
 * @returns the template literal's CONTENTS, with no surrounding backticks
 */
export function templateAfter(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const open = src.indexOf("`", at + marker.length);
  if (open < 0) throw new Error(`no template after: ${marker}`);
  let i = open + 1;
  let depth = 0; // ${ } nesting, so a backtick inside an interpolation is safe
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "$" && src[i + 1] === "{") { depth++; i += 2; continue; }
    if (c === "}" && depth > 0) { depth--; i++; continue; }
    if (c === "`" && depth === 0) return src.slice(open + 1, i);
    i++;
  }
  throw new Error(`unterminated template after: ${marker}`);
}

/** The probe of each combinable harness, keyed by check name. */
export const PROBE_MARKERS = {
  fontkeep: { file: "fontkeep.mjs", marker: "const probe = (page) => ev(", param: "page" },
  eqkeep: { file: "eqkeep.mjs", marker: "const probe = (page) => ev(", param: "page" },
  refcolor: { file: "refcolor.mjs", marker: "const CHECK = (p) => ", param: "p" },
  tables: { file: "tables.mjs", marker: "const CHECK = (p) => ", param: "p" },
};

export function loadProbes(testDir) {
  const out = {};
  const errors = {};
  for (const [name, { file, marker, param }] of Object.entries(PROBE_MARKERS)) {
    try {
      const src = readFileSync(`${testDir}/${file}`, "utf8");
      const body = templateAfter(src, marker);
      // The page number is the ONLY interpolation this can supply. A probe that
      // also closes over harness-local variables — a CLI flag, a computed
      // constant — cannot be lifted out of its harness, and substituting only
      // the page leaves a literal `${...}` in the expression.
      //
      // That is not a theoretical concern: it happened on the first run. The
      // tables probe carries `${NOEXEMPT}`, every page threw SyntaxError, the
      // errors were swallowed, and the check reported zero offenders — a clean
      // PASS from a probe that never executed. Refusing extraction is the only
      // safe answer; the caller runs that harness standalone.
      const residual = [...body.matchAll(/\$\{[^}]*\}/g)]
        .map((m) => m[0])
        .filter((s) => s !== `\${${param}}` && s !== `\${${param} - 1}`);
      if (residual.length) {
        throw new Error(`probe closes over harness state: ${[...new Set(residual)].join(", ")}`);
      }
      out[name] = { body, param };
    } catch (e) {
      errors[name] = e.message;
    }
  }
  return { probes: out, errors };
}
