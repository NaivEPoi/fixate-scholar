// Fix up the viewer's ?file= parameter BEFORE PDF.js reads it.
//
// The service worker redirects a PDF navigation with a declarativeNetRequest
// rule whose regexSubstitution is `viewer.html?file=\1` — and DNR has no way to
// percent-encode `\1`, so the target URL lands in the query string exactly as
// it appeared in the address bar. PDF.js then parses that query with
// URLSearchParams, which reads three characters as its own syntax:
//
//   * `&`  starts another parameter — `…/get.pdf?a=1&b=2` opens as `…/get.pdf?a=1`
//   * `+`  decodes to a space       — `…/a+b.pdf`        opens as `…/a b.pdf`
//   * `%…` decodes one level        — `…/a%26b.pdf`      opens as `…/a&b.pdf`
//
// Each one fetches a URL the user never asked for, the server answers 400/404,
// and the viewer shows "FixateScholar couldn't load this document". The first
// is the common one: any PDF link with more than one query parameter hits it —
// presigned S3/CloudFront links, download endpoints (`?download=true&type=pdf`),
// library-proxy URLs.
//
// Timing is why this is its own file rather than part of the overlay.
// viewer.mjs is a module script, so it evaluates only after the parser has
// finished — `document.readyState` is already "interactive" — and PDF.js
// therefore calls run(), which reads location.search, during its own
// evaluation, NOT on DOMContentLoaded. Module scripts run in document order, so
// only a script placed AHEAD of viewer.mjs can win that race; overlay.mjs,
// which patch 2 appends after it, never can. scripts/pdfjs-patches.mjs
// (patch 6) inserts the tag in the one position that works.

const MARKER = "?file=";

/**
 * True when the parameter is already a faithful encodeURIComponent() of some
 * URL — the shape produced by the context-menu and file:// paths, which encode
 * at the source. Re-escaping those would double-encode them.
 *
 * The DNR parameter can't be mistaken for one: it still holds the literal `:`
 * and `/` of a real URL, which encodeURIComponent always escapes.
 */
function isEncoded(raw) {
  try {
    return encodeURIComponent(decodeURIComponent(raw)) === raw;
  } catch {
    return false; // a `%` that isn't an escape — so, not our own output
  }
}

/**
 * Escape a raw (already URL-canonical) address so URLSearchParams hands PDF.js
 * back the same string, character for character.
 *
 * Deliberately minimal. A blanket decode-then-encodeURIComponent would also
 * round-trip the common cases, but it destroys escapes that are part of the
 * address: `…/a%26b.pdf` (an S3 key whose name contains `&`) would decode to a
 * query separator and never be re-escaped correctly. Escaping only the three
 * characters URLSearchParams treats as syntax leaves everything else untouched.
 */
function escapeForQuery(raw) {
  return raw
    .replace(/%/g, "%25")
    .replace(/&/g, "%26")
    .replace(/\+/g, "%2B");
}

/** Rewrite `?file=<raw url>` in place so PDF.js parses back the real URL. */
export function normalizeFileParam() {
  const search = window.location.search;
  if (!search.startsWith(MARKER)) return;
  const raw = search.slice(MARKER.length);
  // A blob: URL is minted by this page and is already exact; escaping it would
  // only make the address unreadable.
  if (!raw || raw.startsWith("blob:") || isEncoded(raw)) return;
  const escaped = escapeForQuery(raw);
  if (escaped === raw) return;
  // The fragment stays on `location` rather than being folded into the
  // parameter: it is the PDF open parameter (`#page=7`) that PDF.js reads from
  // `document.location.hash` once the document loads.
  window.history.replaceState(
    null,
    "",
    window.location.pathname + MARKER + escaped + window.location.hash,
  );
}

/**
 * The document URL this viewer was opened with — read exactly the way PDF.js
 * reads it, so the two can't drift apart. Null when the parameter is absent or
 * isn't an http(s)/file address.
 *
 * The fragment is deliberately NOT re-attached: the only consumers are the
 * "open in the browser's native viewer" paths, and the service worker matches
 * that URL against a declarativeNetRequest `urlFilter` and a webNavigation URL,
 * neither of which ever carries a fragment. Passing one made the bypass rule
 * miss, and the tab bounced straight back into FixateScholar.
 */
export function currentFileUrl() {
  const url = new URLSearchParams(window.location.search).get("file");
  return url && /^(https?|file):/.test(url) ? url : null;
}

// Runs on import, which is the point: the module tag sits ahead of viewer.mjs.
// Guarded only so the unit tests can import the functions under Node.
if (typeof window !== "undefined") normalizeFileParam();
