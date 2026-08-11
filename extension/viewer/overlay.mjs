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
references.onFurniture = (boxes) =>
  engine.setFurniture(boxes).then(() => references.reannotateRendered());

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

// Hairline fake-bold as a text-shadow list, from a stroke width in `em`.
//
// This used to be `-webkit-text-stroke`, which Chrome DROPS while painting
// selected text: the ::selection highlight style never specifies
// -webkit-text-stroke-width, so it resolves to 0 and every emphasized prefix
// inside a selection rendered at plain weight. Re-declaring the stroke in
// ::selection does not help — Blink's selection paint path ignores text-stroke
// entirely (verified with both the shorthand and the longhands). text-shadow IS
// honored in ::selection, and like a stroke it is paint-only, so the engine's
// width calibration (targetW / word-spacing / --scale-x) still holds. Real
// font-weight would survive selection too, but it changes glyph advances.
//
// A centered stroke of width W thickens a glyph by W/2 on each side, and an
// axis-aligned shadow at offset D thickens it by D — so D = W/2. Four
// directions is enough at hairline widths and keeps the glyph repaints cheap.
function emphasisShadow(strokeEm) {
  const d = strokeEm / 2;
  if (!(d > 0.00001)) return "none";
  const o = d.toFixed(5);
  return `${o}em 0 currentColor, -${o}em 0 currentColor, 0 ${o}em currentColor, 0 -${o}em currentColor`;
}

function applyStyleVars(s) {
  const root = document.documentElement.style;
  // Bundled-face modes: the faces exist only at 400 and 700, so the weight
  // slider ramps with the nearest real face plus a hairline fake bold —
  // 500/600 use the 400 face + shadow, 700 is the true bold, 800/900 add
  // shadow on the 700 face.
  const w = s.boldWeight;
  root.setProperty("--fx-stack-weight", w >= 700 ? "700" : "400");
  root.setProperty(
    "--fx-stack-shadow",
    emphasisShadow((w >= 700 ? w - 700 : w - 400) / 10000),
  );
  // Emphasis strength for original-font mode: 500 → light, 900 → heavy.
  root.setProperty("--fx-shadow", emphasisShadow((w - 400) / 10000));
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

// Searching rewrites the matched text divs' contents (TextHighlighter wraps
// each match in its own span and, on clear, resets the div to the raw item
// string), which throws away the engine's <b class="fx-b"> emphasis: matched
// lines dropped back to unbolded text and stayed that way. Re-wrap the
// prefixes around the match spans once the highlighter is done. The event is
// dispatched synchronously to every listener and the highlighter's own
// listener may be registered after ours (it subscribes when its page's text
// layer renders), so defer to a microtask — by then the DOM is final.
app.eventBus.on("updatetextlayermatches", ({ pageIndex }) => {
  queueMicrotask(() => engine.reapplyEmphasis(pageIndex ?? -1));
});

// While an annotation editor is active (highlight/draw/…), the citation
// hit-target overlay must not intercept pointer events: PDF.js builds a
// highlight from a TEXT-LAYER selection, and our absolutely-positioned
// <a> hit-targets (pointer-events:auto) would otherwise swallow a mousedown
// that starts over a citation, so the drag never becomes a selection and no
// highlight is created. Drop the overlay's pointer-events whenever the
// editor is on (the user is annotating, not clicking citation cards); restore
// it when the editor turns off. AnnotationEditorType.NONE === 0.
const container =
  app.appConfig.mainContainer ?? document.getElementById("viewerContainer");
app.eventBus.on("annotationeditormodechanged", ({ mode }) => {
  container.classList.toggle("fx-editing", mode !== 0);
});

// PDF.js caps large page canvases (the base render can drop below 1× CSS
// resolution) and paints a full-resolution DETAIL canvas over the visible
// area afterwards. Ink-based decisions (hidden-text veto, duplicate-overlap
// resolution) made from a capped base read are unreliable — the engine marks
// those pages and re-processes them once, here, when their sharp pixels
// arrive. No-op for pages processed at full resolution.
app.eventBus.on("pagerendered", (evt) => {
  if (!evt.isDetailView || evt.error) return;
  const pageView = app.pdfViewer.getPageView(evt.pageNumber - 1);
  engine.onDetailRendered(pageView).then((reprocessed) => {
    if (reprocessed) references.reannotateRendered();
  });
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
// Refresh ONLY the pages that USE the newly loaded faces. loadingdone also
// fires for every page's own font subsets as the user scrolls — a blanket
// restore+reprocess of ALL rendered pages on each one is O(pages²) churn
// that leaves long papers flashing native text for seconds at a time.
if (typeof document !== "undefined" && document.fonts?.addEventListener) {
  let fontsTimer = null;
  const pendingFaces = new Set();
  document.fonts.addEventListener("loadingdone", (e) => {
    if (!engine.enabled) return;
    for (const f of e.fontfaces ?? []) pendingFaces.add(f.family);
    clearTimeout(fontsTimer);
    fontsTimer = setTimeout(async () => {
      const faces = [...pendingFaces];
      pendingFaces.clear();
      await engine.refreshFonts(faces);
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
