// Thin wrapper over chrome.storage.sync with defaults and a change feed.
// Falls back to in-memory defaults when chrome.storage is unavailable
// (e.g. opening viewer.html directly during development).

export const DEFAULTS = Object.freeze({
  enabled: true,
  // "dynamic": whole syllables up to half the word (default)
  // "syllable": exactly the first syllable
  // "fraction": a fixed fraction of the word (the `fraction` slider)
  emphasisMode: "dynamic",
  fraction: 0.4,
  saccade: 1,
  boldWeight: 600,
  fontMode: "original", // "original" | "atkinson" | "inter" | "literata"
  bypassOrigins: [],
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
