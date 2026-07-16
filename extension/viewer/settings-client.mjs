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
  // Master switch for PDF interception. When false the extension registers no
  // redirect rules, so PDFs open in the browser's native viewer — letting the
  // built-in PDF tools (incl. Gemini "ask about this PDF") and other PDF
  // extensions handle them. FixateScholar stays available on demand (toolbar
  // button, right-click "Open in FixateScholar"). Default on (unchanged
  // behavior). Distinct from `enabled`, which only toggles typography inside
  // the viewer.
  intercept: true,
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
