// Thin wrapper over chrome.storage.sync with defaults and a change feed.
// Falls back to in-memory defaults when chrome.storage is unavailable
// (e.g. opening viewer.html directly during development).

export const DEFAULTS = Object.freeze({
  enabled: true,
  // "dynamic": whole syllables up to half the word (default)
  // "syllable": exactly the first syllable
  // "fraction": a fixed fraction of the word (the `fraction` slider)
  // "none": no emphasis at all — spans are still re-rendered (so a bundled
  //         reading font applies) but nothing is bolded
  emphasisMode: "dynamic",
  fraction: 0.4,
  saccade: 1,
  boldWeight: 650,
  fontMode: "original", // "original" | "atkinson" | "inter" | "literata"
  bypassOrigins: [],
  // Individual PDF URLs escaped to the browser's native PDF viewer.
  bypassUrls: [],
  // Master switch for PDF interception. When false the extension registers no
  // redirect rules, so PDFs open in the browser's native viewer — letting the
  // built-in PDF tools (incl. Gemini "ask about this PDF") and other PDF
  // extensions handle them. FixateScholar stays available on demand (toolbar
  // button, right-click "Open in FixateScholar"). Default on (unchanged
  // behavior). Distinct from `enabled`, which only toggles typography inside
  // the viewer.
  intercept: true,
  // Copy a paragraph and get a paragraph: the viewer rejoins the PDF's typeset
  // lines and repairs the hyphens they were broken with. Off gives PDF.js's own
  // behavior — the page's line breaks, verbatim. Independent of `enabled`; the
  // reflow is about the text, not the typography.
  flowCopy: true,
  // Where a clicked citation is looked up. Both are on by default and either
  // can be turned off; with both off, a card shows the document's own entry
  // and nothing leaves the machine.
  //
  // `scholarLookup` — Google Scholar first. It is the widest index and the one
  // that has a citation count for everything, and it answers only a request
  // carrying the reader's own Google cookies, so these lookups are visible to
  // Google the way that reader's own searches are (README, "Privacy").
  //
  // `openSources` — arXiv, Crossref, OpenAlex and OpenAIRE, which need no
  // cookie, no key and no account. Used when Scholar is off, refuses, or has
  // nothing that verifies, and to fill in the abstract Scholar never provides.
  scholarLookup: true,
  openSources: true,
  // The name written as the author (/T) of highlights and comments saved into
  // the PDF. Empty leaves the field out, which is what PDF.js does on its own.
  annotationAuthor: "",
  // When editing a local PDF (file://), save changes directly back to the local
  // file rather than saving as a new download copy.
  saveLocalFile: true,
});

const hasStorage = typeof chrome !== "undefined" && chrome.storage?.sync;

export async function getSettings() {
  if (!hasStorage) return { ...DEFAULTS };
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch) {
  if (!hasStorage) return;
  await chrome.storage.sync.set(patch);
}

/** cb receives the full new settings object on every change. */
export function onSettingsChange(cb) {
  if (!hasStorage) return;
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync") return;
    cb(await getSettings());
  });
}

export function normalizeBypassUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "file:") {
      return "";
    }
    u.hash = "";
    return u.href;
  } catch {
    const trimmed = url.split("#")[0].trim();
    if (!/^(https?|file):/i.test(trimmed)) return "";
    return trimmed;
  }
}

export function urlsMatch(a, b) {
  const na = normalizeBypassUrl(a);
  const nb = normalizeBypassUrl(b);
  if (na === nb) return true;
  if (na.startsWith("file:") && nb.startsWith("file:")) {
    try {
      return decodeURI(na).toLowerCase() === decodeURI(nb).toLowerCase();
    } catch {
      return na.toLowerCase() === nb.toLowerCase();
    }
  }
  return false;
}

