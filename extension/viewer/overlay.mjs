// FixatePDF viewer overlay — entry point injected into the vendored PDF.js
// viewer.html (see scripts/fetch-pdfjs.mjs, patch 2). Wires the typography
// engine and the references feature to the viewer's event bus. Never touches
// PDF.js internals beyond its public application object and DOM.

import { TypographyEngine } from "./typography/engine.mjs";
import { getSettings, setSettings, onSettingsChange } from "./settings-client.mjs";
import { ReferencesFeature } from "./references/citations.mjs";

// Crisper page canvases: PDF.js rasterizes each page at devicePixelRatio.
// On standard-density displays (dpr < 2) the glyph rasterization at ~1×
// zoom is coarse enough that kept-on-canvas tokens (mono identifiers,
// inline math) show gap/dot artifacts next to the crisply DOM-rendered
// overlay. Force a minimum output scale of 2 — a page canvas grows ~4× in
// memory, well within budget, and PDF.js still caps oversized canvases via
// maxCanvasPixels at high zoom. Engine measurements are unaffected (all
// canvas reads derive their scale from canvas.width / boundingRect.width).
try {
  if ((window.devicePixelRatio || 1) < 2) {
    Object.defineProperty(window, "devicePixelRatio", {
      get: () => 2,
      configurable: true,
    });
  }
} catch {
  /* keep the native ratio */
}

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
// Each of these RE-PROCESSES rendered pages (restore wipes the citation
// coloring wraps along with the rest of the span DOM), so the citation
// annotations must be rebuilt afterwards — without this, pages annotated
// before the async extraction finished lost their citation colors for good.
references.onRefsRegion = (boxes) =>
  engine.setRefsRegion(boxes).then(() => references.reannotateRendered());
references.onContentStart = (pos) =>
  engine.setContentStart(pos).then(() => references.reannotateRendered());
references.onBodyHeight = (h) =>
  engine.setBodyHeight(h).then(() => references.reannotateRendered());

// PDF.js runs an idle cleanup 30s after the last render activity
// (CLEANUP_TIMEOUT in pdf_rendering_queue.js) whose handler calls
// `pdfDocument.cleanup()` — that evicts the document's embedded font faces.
// Our visible reading-mode spans are styled with those exact faces
// (`font-family: g_*`), so once they're gone the browser re-lays the overlay in
// a WIDER fallback font: the text outgrows its per-span masks and drifts off the
// canvas glyphs, and nothing reloads the font, so it stays broken. That is the
// "after ~30s of sitting idle the processed text doubles / goes misaligned" bug.
// While reading mode is on, run PDF.js's harmless page-view cleanup but SKIP the
// font-evicting document cleanup. Installed here, before the document loads, so
// the idle timer is only ever scheduled with this wrapper (the original handler
// is never bound into a pending timeout). Restored behaviour when fx is off.
const renderingQueue = app.pdfRenderingQueue;
if (renderingQueue && typeof renderingQueue.onIdle === "function") {
  const originalOnIdle = renderingQueue.onIdle;
  renderingQueue.onIdle = function fxIdleCleanup() {
    if (!engine.enabled) return originalOnIdle();
    // Keep memory tidy without touching the fonts the overlay depends on.
    try {
      app.pdfViewer?.cleanup();
      app.pdfThumbnailViewer?.cleanup();
    } catch (e) {
      console.warn("FixateScholar: idle cleanup failed", e);
    }
  };
}

function applyStyleVars(s) {
  const root = document.documentElement.style;
  // Bundled-face modes: the faces exist only at 400 and 700, so the weight
  // slider ramps with the nearest real face plus a hairline stroke —
  // 500/600 use the 400 face + stroke, 700 is the true bold, 800/900 add
  // stroke on the 700 face. (Stroke is paint-only: no layout impact.)
  const w = s.boldWeight;
  root.setProperty("--fx-stack-weight", w >= 700 ? "700" : "400");
  root.setProperty("--fx-stack-stroke", `${(w >= 700 ? w - 700 : w - 400) / 10000}em`);
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
  // The viewer's 30s render-queue-idle cleanup evicts the document's
  // FontFaces (pdfDocument.cleanup(false)). No font event fires on eviction,
  // so the page being read silently re-renders our overlay spans in a
  // substitute face with different metrics — the text visibly drifts up-left
  // and stays that way until something reloads the fonts. The embedded faces
  // ARE the visible document whenever the overlay is (or later becomes)
  // active, and they are small next to the page canvases (which this still
  // cleans), so always keep them.
  const doc = app.pdfDocument;
  if (doc?.cleanup && !doc.__fxCleanupWrapped) {
    doc.__fxCleanupWrapped = true;
    const origCleanup = doc.cleanup.bind(doc);
    doc.cleanup = () => origCleanup(true);
  }
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
