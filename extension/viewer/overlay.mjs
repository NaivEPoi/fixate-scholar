// FixatePDF viewer overlay — entry point injected into the vendored PDF.js
// viewer.html (see scripts/fetch-pdfjs.mjs, patch 2). Wires the typography
// engine and the references feature to the viewer's event bus. Never touches
// PDF.js internals beyond its public application object and DOM.

import { TypographyEngine } from "./typography/engine.mjs";
import { getSettings, setSettings, onSettingsChange } from "./settings-client.mjs";
import { ReferencesFeature } from "./references/citations.mjs";

// The DNR redirect appends the raw PDF URL after ?file= without encoding.
// Re-encode it so PDF.js (and the URL parser) can't be confused by &, #, etc.
function normalizeFileParam() {
  const search = window.location.search;
  const marker = "?file=";
  if (!search.startsWith(marker)) return;
  const raw = search.slice(marker.length) + window.location.hash;
  if (!raw || raw.startsWith("blob:")) return;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const normalized = "?file=" + encodeURIComponent(decoded);
  if (search + window.location.hash !== normalized) {
    history.replaceState(null, "", window.location.pathname + normalized);
  }
}

function addToolbarToggle(app, initialOn, onToggle) {
  const right = document.getElementById("toolbarViewerRight");
  if (!right) return () => {};
  const button = document.createElement("button");
  button.id = "fxToggleButton";
  button.className = "toolbarButton";
  button.type = "button";
  button.title = "Toggle fixation typography (guided reading)";
  button.textContent = "Fx";
  button.style.cssText = "font-weight:700;width:auto;padding:0 8px;";
  button.classList.toggle("toggled", initialOn);
  button.addEventListener("click", () => {
    const on = !button.classList.contains("toggled");
    button.classList.toggle("toggled", on);
    onToggle(on);
  });
  right.prepend(button);
  return (on) => button.classList.toggle("toggled", on);
}

// Escape hatch: re-open the current document in Chrome's native PDF viewer
// (the service worker installs a one-shot allow rule before re-navigating).
function addNativeViewerButton() {
  const right = document.getElementById("toolbarViewerRight");
  const search = window.location.search;
  if (!right || !search.startsWith("?file=") || typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  let url;
  try {
    url = decodeURIComponent(search.slice(6));
  } catch {
    return;
  }
  if (!/^(https?|file):/.test(url)) return;
  const button = document.createElement("button");
  button.id = "fxNativeButton";
  button.className = "toolbarButton";
  button.type = "button";
  button.title = "Open in the browser's native PDF viewer";
  button.textContent = "native";
  button.style.cssText = "width:auto;padding:0 8px;";
  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "fx-bypass-once", url });
  });
  right.prepend(button);
}

normalizeFileParam();

const app = window.PDFViewerApplication;
await app.initializedPromise;

const settings = await getSettings();
const engine = new TypographyEngine(app, settings);
const references = new ReferencesFeature(app);

// Citation hit-targets are measured from live geometry, so they must be
// (re)built after the engine finishes mutating a page.
async function applyEnabled(on) {
  await engine.setEnabled(on);
  references.reannotateRendered();
}

const syncButton = addToolbarToggle(app, settings.enabled, (on) => {
  applyEnabled(on);
  setSettings({ enabled: on });
});
addNativeViewerButton();

document.documentElement.style.setProperty("--fx-bold-weight", String(settings.boldWeight));
applyEnabled(settings.enabled);

onSettingsChange(async (next) => {
  document.documentElement.style.setProperty("--fx-bold-weight", String(next.boldWeight));
  syncButton(next.enabled);
  await engine.updateSettings(next);
  await applyEnabled(next.enabled);
});

app.eventBus.on("textlayerrendered", async (evt) => {
  if (evt.error) return;
  await engine.onTextLayerRendered(evt.source);
  references.onTextLayerRendered(evt.source);
});

app.eventBus.on("documentloaded", () => {
  references.onDocumentLoaded(app.pdfDocument);
});
