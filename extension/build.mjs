// The version of the files this module was loaded from.
//
// Not `chrome.runtime.getManifest().version`: the browser reads the manifest
// once, and hands that one version to every page and worker of the extension —
// including a background worker it has kept from an EARLIER install. The
// worker's script is stored when the extension is installed or reloaded, and
// an unpacked extension's files move on under it: every page loads from the
// files as they are now, while the worker stays as it was stored. This
// literal, read from whichever copy of the file a module imported, tells the
// two apart (overlay.mjs, workerIsCurrent).
//
// Kept equal to manifest.json's version by test/unit/build.test.mjs.
export const BUILD = "1.4.3";
