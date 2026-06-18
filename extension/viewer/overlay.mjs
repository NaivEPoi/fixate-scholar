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
// Leave the bibliography exactly as the author set it (appendices after it
// are still processed), and everything before the Abstract (cover pages,
// title, authors, emails).
references.onRefsRegion = (boxes) => engine.setRefsRegion(boxes);
references.onContentStart = (pos) => engine.setContentStart(pos);
references.onBodyHeight = (h) => engine.setBodyHeight(h);

function applyStyleVars(s) {
  const root = document.documentElement.style;
  root.setProperty("--fx-bold-weight", String(s.boldWeight));
  // Emphasis stroke width for original-font mode: 500 → light, 900 → heavy.
  root.setProperty("--fx-stroke", `${(s.boldWeight - 400) / 10000}em`);
  const container =
    app.appConfig.mainContainer ?? document.getElementById("viewerContainer");
  container.dataset.fxFont = s.fontMode ?? "original";
}

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

applyStyleVars(settings);
applyEnabled(settings.enabled);

onSettingsChange(async (next) => {
  applyStyleVars(next);
  syncButton(next.enabled);
  await engine.updateSettings(next);
  await applyEnabled(next.enabled);
});

app.eventBus.on("textlayerrendered", async (evt) => {
  if (evt.error) return;
  await engine.onTextLayerRendered(evt.source);
  references.onTextLayerRendered(evt.source);
});

// Reconcile the PDF's own in-document jump links once the annotation layer
// renders. A citation "[35]" link (whose annotation scrolls to the
// bibliography) should instead open our reference card, so we neutralise links
// our citation hit-targets cover and let the click fall through. But an
// in-paper cross-reference — "Figure 3", "Table 8", "Section 5" — must keep
// its native jump, so those links stay clickable. External links (DOI, URLs)
// are untouched. Idempotent and order-independent (annotatePage also calls it).
app.eventBus.on("annotationlayerrendered", (evt) => {
  const pageView = evt.pageNumber
    ? app.pdfViewer.getPageView(evt.pageNumber - 1)
    : evt.source;
  if (pageView?.div) references.reconcileLinks(pageView);
});

// Our typography masks the canvas glyphs and shows the text-layer spans in the
// document's embedded font. When the window is backgrounded (e.g. switching
// windows in Edge) the browser can evict those FontFaces; on return they
// re-decode asynchronously and the text momentarily renders in a fallback font
// with different metrics, which can leave our width/word-spacing corrections
// stale (collapsed spacing, "wrong font"). PDF.js doesn't re-render for this,
// so re-process from a clean state once fonts settle. Debounced — loadingdone
// also fires during the initial page load.
if (typeof document !== "undefined" && document.fonts?.addEventListener) {
  let fontsTimer = null;
  document.fonts.addEventListener("loadingdone", () => {
    if (!engine.enabled) return;
    clearTimeout(fontsTimer);
    fontsTimer = setTimeout(async () => {
      await engine.refresh();
      references.reannotateRendered();
    }, 250);
  });
}

app.eventBus.on("documentloaded", () => {
  references.onDocumentLoaded(app.pdfDocument);
});

// Auth-gated or otherwise unfetchable PDFs: offer the native viewer, which
// re-navigates with the page's own cookies/session semantics.
app.eventBus.on("documenterror", () => {
  if (document.getElementById("fxLoadError")) return;
  const search = window.location.search;
  if (!search.startsWith("?file=") || !chrome.runtime?.sendMessage) return;
  let url;
  try {
    url = decodeURIComponent(search.slice(6));
  } catch {
    return;
  }
  if (!/^(https?|file):/.test(url)) return;
  const banner = document.createElement("div");
  banner.id = "fxLoadError";
  banner.className = "fx-load-error";
  banner.append("FixateScholar couldn't load this document. ");
  const link = document.createElement("a");
  link.textContent = "Open in the browser's native viewer";
  link.href = "#";
  link.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: "fx-bypass-once", url });
  });
  banner.append(link);
  document.getElementById("outerContainer")?.prepend(banner);
});
