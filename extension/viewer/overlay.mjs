// FixatePDF viewer overlay — entry point injected into the vendored PDF.js
// viewer.html (see scripts/fetch-pdfjs.mjs, patch 2). Wires the typography
// engine and the references feature to the viewer's event bus. Never touches
// PDF.js internals beyond its public application object and DOM.

import { TypographyEngine } from "./typography/engine.mjs";
import { getSettings, setSettings, onSettingsChange } from "./settings-client.mjs";
import { ReferencesFeature } from "./references/citations.mjs";
import { HyphenVocabulary, installFlowCopy, loadWordList } from "./copytext.mjs";
import { extractStructureHints } from "./typography/pdfhints.mjs";
import { currentFileUrl } from "./file-param.mjs";

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

const FONT_MODES = [
  { value: "original", label: "Aa", title: "Original — the document's embedded font" },
  { value: "atkinson", label: "Atkinson", title: "Atkinson Hyperlegible — designed for low-vision readability" },
  { value: "inter", label: "Inter", title: "Inter — clean screen sans-serif" },
  { value: "literata", label: "Literata", title: "Literata — book-style reading serif" },
  { value: "lexend", label: "Lexend", title: "Lexend — visual crowding reduction for faster reading fluency" },
  { value: "source-serif-4", label: "Source Serif", title: "Source Serif 4 — academic and long-form literature serif" },
];

// Cycles fontMode through FONT_MODES on click, without a trip to the options
// page. Mirrors addToolbarToggle: same slot, same returned sync function so
// the button can be kept in step with changes made elsewhere (options page,
// popup, another tab on the same document via chrome.storage.sync).
function addFontButton(initialMode, onChange) {
  const right = document.getElementById("toolbarViewerRight");
  if (!right) return () => {};
  const button = document.createElement("button");
  button.id = "fxFontButton";
  button.className = "toolbarButton";
  button.type = "button";
  button.style.cssText = "font-weight:600;width:auto;padding:0 8px;";
  let index = Math.max(0, FONT_MODES.findIndex((m) => m.value === initialMode));
  const reflect = () => {
    const mode = FONT_MODES[index];
    button.textContent = mode.label;
    button.title = `Font: ${mode.title} — click to switch`;
    button.classList.toggle("toggled", mode.value !== "original");
  };
  reflect();
  button.addEventListener("click", () => {
    index = (index + 1) % FONT_MODES.length;
    reflect();
    onChange(FONT_MODES[index].value);
  });
  right.prepend(button);
  return (mode) => {
    const next = FONT_MODES.findIndex((m) => m.value === mode);
    if (next !== -1 && next !== index) {
      index = next;
      reflect();
    }
  };
}

// Escape hatch: re-open the current document in Chrome's native PDF viewer
// (the service worker installs a one-shot allow rule before re-navigating).
function addNativeViewerButton() {
  const right = document.getElementById("toolbarViewerRight");
  if (!right || typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  const url = currentFileUrl();
  if (!url) return;
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

const app = window.PDFViewerApplication;
await app.initializedPromise;

const settings = await getSettings();

// The name saved highlights and comments are attributed to. PDF.js writes a
// markup annotation's /T from the serialized editor's `user` field but never
// sets it (vendor patch 8 reads it from here), so without this every note a
// reviewer saves opens authorless in Acrobat, Preview or Foxit. Empty leaves
// the field out entirely, which is PDF.js's own behavior.
const publishAuthor = (s) => {
  globalThis.fxAnnotationAuthor = s.annotationAuthor || "";
};
publishAuthor(settings);

const engine = new TypographyEngine(app, settings);
const references = new ReferencesFeature(app);

// Copy a paragraph, get a paragraph. Two witnesses decide whether a line-break
// hyphen belonged to the word or joined two: the DOCUMENT's own vocabulary,
// fed from the very lines the references pass already extracts (so it costs no
// extra read of the PDF), and a general English word list for the words that
// appear in this paper exactly once — broken. The list is fetched in the
// background; `decide` is read at copy time, so a copy made before it lands
// simply falls back to the document and the shape rules.
let current = settings;
const decide = { document: new HyphenVocabulary(), words: null };
loadWordList(new URL("../vendor/words/english.txt", import.meta.url)).then((list) => {
  decide.words = list;
  globalThis.__fxWordsReady = list.ready; // test introspection
});
const attachFlowCopy = installFlowCopy(app, {
  isOn: () => current.flowCopy !== false,
  decide,
});
references.onLines = (lines) => decide.document.learn(lines.map((l) => l.text));
// Leave the bibliography exactly as the author set it (appendices after it
// are still processed), and everything before the Abstract (cover pages,
// title, authors, emails).
// Each of these RE-PROCESSES rendered pages (restore wipes the citation
// coloring wraps along with the rest of the span DOM), so the citation
// annotations must be rebuilt afterwards — without this, pages annotated
// before the async extraction finished lost their citation colors for good.
// All four land together when extraction finishes, and each used to restore
// and re-process the rendered pages and then rebuild every page's citation
// annotations — four near-identical passes over the whole rendered document
// for one final state, which is a large part of the lag right after a document
// loads. Inside the batch the engine only records them; it re-processes once at
// onAnalysisEnd, and citations.mjs re-annotates once after that. Outside a
// batch each setter still re-annotates, so a lone call keeps its guarantee.
let batchingAnalysis = false;
const afterEngineChange = () => {
  if (!batchingAnalysis) references.reannotateRendered();
};
references.onAnalysisStart = () => {
  batchingAnalysis = true;
  engine.beginBatch();
};
references.onAnalysisEnd = () => {
  batchingAnalysis = false;
  return engine.endBatch();
};
references.onRefsRegion = (boxes) => engine.setRefsRegion(boxes).then(afterEngineChange);
references.onContentStart = (pos) => engine.setContentStart(pos).then(afterEngineChange);
references.onBodyHeight = (h) => engine.setBodyHeight(h).then(afterEngineChange);
references.onFurniture = (boxes) => engine.setFurniture(boxes).then(afterEngineChange);

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
  if (on) {
    const pageViews = app.pdfViewer?._pages || [];
    for (const pv of pageViews) {
      if (pv.renderingState !== 0) colorizeHighlightAnnotations(pv);
    }
  }
}

const syncButton = addToolbarToggle(app, settings.enabled, (on) => {
  applyEnabled(on);
  setSettings({ enabled: on });
});
const syncFontButton = addFontButton(settings.fontMode, (mode) => {
  setSettings({ fontMode: mode });
});
addNativeViewerButton();

applyStyleVars(settings);
applyEnabled(settings.enabled);

// Changes apply one at a time, in the order they arrived. Each awaits the
// engine, and two handlers interleaving — reading mode switched off and on
// again while the first change was still re-processing — cancelled each
// other's work and left the document with no emphasis at all.
let settingsApplied = Promise.resolve();
onSettingsChange((next) => {
  settingsApplied = settingsApplied.then(async () => {
    current = next;
    publishAuthor(next);
    applyStyleVars(next);
    syncButton(next.enabled);
    syncFontButton(next.fontMode);
    // Off first: there is nothing to re-process for settings about to go.
    if (!next.enabled) await applyEnabled(false);
    await engine.updateSettings(next);
    await applyEnabled(next.enabled);
  }).catch((e) => console.warn("FixateScholar: applying settings failed", e));
});

app.eventBus.on("textlayerrendered", async (evt) => {
  if (evt.error) return;
  // Before anything else: PDF.js has just bound its own copy handler to this
  // text layer, so ours has to go on after it (it stops propagation, not
  // immediate propagation, so a later listener on the same element still runs).
  attachFlowCopy(evt.source);
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
async function colorizeHighlightAnnotations(pageView) {
  const div = pageView?.div || pageView?.annotationLayer?.div;
  if (!div || !pageView.pdfPage) return;
  const hls = div.querySelectorAll(".highlightAnnotation");
  if (!hls.length) return;
  try {
    const annots = await pageView.pdfPage.getAnnotations();
    const map = new Map();
    for (const a of annots) {
      if (a.subtype === "Highlight" && a.id) {
        map.set(a.id, a);
      }
    }
    for (const hl of hls) {
      const id = hl.dataset.annotationId;
      const annot = map.get(id);
      if (annot?.color && typeof annot.color[0] === "number") {
        const [r, g, b] = [annot.color[0], annot.color[1], annot.color[2]];
        const opacity =
          typeof annot.opacity === "number" && annot.opacity < 1
            ? annot.opacity
            : 1;
        hl.style.setProperty(
          "--fx-highlight-color",
          opacity < 1 ? `rgb(${r} ${g} ${b} / ${opacity})` : `rgb(${r} ${g} ${b})`,
        );
      }

      // Close horizontal seams between multiline quad rectangles.
      // In PDF.js, _createQuadrilaterals builds <rect> elements inside <clipPath>.
      // The quads have leading gaps between lines, which in reading mode reveal
      // the white canvas mask underneath as horizontal stripes.
      // Expanding each line's rects down to meet/slightly overlap the next line
      // bridges the gap seamlessly without double-multiplying (as shapes inside
      // a clipPath are unioned).
      const clipPath = hl.querySelector("clipPath");
      if (clipPath) {
        const rects = [...clipPath.querySelectorAll("rect")];
        if (rects.length > 1) {
          const lines = [];
          const sorted = rects
            .map((r) => ({
              el: r,
              x: parseFloat(r.getAttribute("x")),
              y: parseFloat(r.getAttribute("y")),
              w: parseFloat(r.getAttribute("width")),
              h: parseFloat(r.getAttribute("height")),
            }))
            .sort((a, b) => a.y - b.y);

          for (const r of sorted) {
            const match = lines.find((l) => Math.abs(l.y - r.y) < 0.05);
            if (match) {
              match.rects.push(r);
              match.bottom = Math.max(match.bottom, r.y + r.h);
            } else {
              lines.push({ y: r.y, bottom: r.y + r.h, rects: [r] });
            }
          }

          for (let i = 0; i < lines.length - 1; i++) {
            const cur = lines[i];
            const next = lines[i + 1];
            const gap = next.y - cur.bottom;
            if (gap > 0 && gap < 0.15) {
              for (const r of cur.rects) {
                r.el.setAttribute("height", next.y + 0.005 - r.y);
              }
            }
          }

          // Expand the top line up to y=0 if it is close to the top of the annotation box,
          // so the typography mask padding above the text does not cut off the top of the highlight.
          if (lines.length > 0 && lines[0].y > 0 && lines[0].y < 0.05) {
            const topOffset = lines[0].y;
            for (const r of lines[0].rects) {
              r.el.setAttribute("y", 0);
              r.el.setAttribute("height", r.h + topOffset);
            }
          }
        }
      }
    }
  } catch {
    /* fallback to default yellow from overlay.css */
  }
}

app.eventBus.on("annotationlayerrendered", (evt) => {
  const pageView = evt.pageNumber
    ? app.pdfViewer.getPageView(evt.pageNumber - 1)
    : evt.source;
  if (pageView?.div) {
    if (pageView.textLayer?.div?.childElementCount) {
      references.annotatePage(pageView);
    } else {
      references.reconcileLinks(pageView);
    }
    colorizeHighlightAnnotations(pageView);
  }
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

let lastLoadedDoc = null;
function handleDocumentLoaded() {
  const doc = app.pdfDocument;
  if (!doc || doc === lastLoadedDoc) return;
  lastLoadedDoc = doc;
  engine.onDocumentLoaded();
  // What the FILE says about its own structure, before anything is classified
  // from geometry: hyperref's named destinations for headings, float captions
  // and numbered equations (typography/pdfhints.mjs). Deliberately NOT awaited
  // — the reference analysis below must start immediately, and the hints are a
  // refinement that re-processes the rendered pages when they land, exactly as
  // the four document-wide setters already do. A document that states nothing
  // (a pre-hyperref paper) resolves to `available: false` and changes nothing.
  extractStructureHints(doc)
    .then((hints) => {
      if (app.pdfDocument !== doc) return; // a newer document won the race
      return engine.setStructureHints(hints);
    })
    .then(afterEngineChange)
    .catch((e) => console.warn("FixateScholar: structure hints failed", e));
  references.onDocumentLoaded(doc);
  // The viewer's 30s render-queue-idle cleanup evicts the document's
  // FontFaces (pdfDocument.cleanup(false)). No font event fires on eviction,
  // so the page being read silently re-renders our overlay spans in a
  // substitute face with different metrics — the text visibly drifts up-left
  // and stays that way until something reloads the fonts. The embedded faces
  // ARE the visible document whenever the overlay is (or later becomes)
  // active, and they are small next to the page canvases (which this still
  // cleans), so always keep them.
  if (doc?.cleanup && !doc.__fxCleanupWrapped) {
    doc.__fxCleanupWrapped = true;
    const origCleanup = doc.cleanup.bind(doc);
    doc.cleanup = () => origCleanup(true);
  }
}

app.eventBus.on("documentloaded", handleDocumentLoaded);
if (app.pdfDocument) {
  handleDocumentLoaded();
}

// Auth-gated or otherwise unfetchable PDFs: offer the native viewer, which
// re-navigates with the page's own cookies/session semantics.
app.eventBus.on("documenterror", () => {
  if (document.getElementById("fxLoadError")) return;
  if (!chrome.runtime?.sendMessage) return;
  const url = currentFileUrl();
  if (!url) return;
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

// Direct save to local files (file://) when editing. When saveLocalFile is on,
// saving an edited local file writes back to the file the reader chose rather
// than dropping a new copy in the downloads folder.
//
// THE FILE PICKER MUST BE OPENED BY THE CLICK ITSELF. `showSaveFilePicker`
// needs transient user activation, and PDF.js's save path spends it before we
// are ever called: `save()` awaits `dispatchWillSave()` and then
// `saveDocument()`, which serialises the whole annotated document, and only
// then calls `downloadManager.download()`. Activation lasts about five seconds,
// so on a small file the picker opened and on a large one it threw — the error
// was swallowed and the save became an ordinary download, which is the
// "saving to the original doesn't work" report. Asking during the click, and
// awaiting the handle afterwards, removes the race entirely.
//
// The handle is also REMEMBERED for the document, so the second save writes
// straight through with no dialog. That is what "save changes directly to
// local PDF files" promises, and asking again every time did not deliver it.
if (app.downloadManager && typeof app.downloadManager.download === "function") {
  const origDownload = app.downloadManager.download.bind(app.downloadManager);
  const PICK_TYPES = [
    { description: "PDF Document", accept: { "application/pdf": [".pdf"] } },
  ];
  /** file URL -> FileSystemFileHandle, for this viewer session. */
  const handles = new Map();
  /** A handle being chosen right now, awaited by the download that follows. */
  let pending = null;

  // The LIVE document first, the address bar last. A viewer tab can be handed a
  // different document without its `?file=` parameter changing — the file input
  // and drag-and-drop both do that — and trusting the parameter would arm the
  // picker for the document that is no longer open, then file the handle under
  // its URL. The next save would write one document's bytes over another's
  // file.
  const localUrl = (url) => {
    const u =
      (typeof url === "string" && url) ||
      app._downloadUrl ||
      app.url ||
      currentFileUrl() ||
      "";
    return u.startsWith("file:") ? u : null;
  };
  const suggestedName = () =>
    app._docFilename ||
    decodeURIComponent((currentFileUrl() || "").split("/").pop() || "") ||
    "document.pdf";

  /** The file URL whose picker the reader just dismissed. */
  let cancelledFor = null;

  // Capture phase, so the picker is requested before PDF.js starts serialising.
  const armPicker = () => {
    const url = localUrl(null);
    if (!url || current.saveLocalFile === false) return;
    if (typeof window.showSaveFilePicker !== "function") return;
    if (handles.has(url) || pending) return; // already have one, or asking
    cancelledFor = null;
    pending = window
      .showSaveFilePicker({ suggestedName: suggestedName(), types: PICK_TYPES })
      .then((handle) => {
        handles.set(url, handle);
        return handle;
      })
      .catch((err) => {
        // Dismissing the dialog is an instruction not to save, so it must not
        // become a download into the downloads folder — which is the very
        // outcome the reader was avoiding by cancelling. Any OTHER failure
        // still falls back, because they did ask for the file.
        if (err?.name === "AbortError") cancelledFor = url;
        return null;
      })
      .finally(() => { pending = null; });
  };
  for (const id of ["downloadButton", "secondaryDownload"]) {
    document.getElementById(id)?.addEventListener("click", armPicker, true);
  }
  // Ctrl/Cmd+S is the way most readers save, and it never touches those
  // buttons: PDF.js binds it straight to an eventBus "download" dispatch
  // (vendored viewer.mjs, `case 83`). Hooking only the toolbar left the most
  // common gesture racing the activation window exactly as before.
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "s" || e.key === "S")) armPicker();
  }, true);

  app.downloadManager.download = async function fxLocalDownload(data, url, filename) {
    const fileUrl = localUrl(url);
    if (fileUrl && current.saveLocalFile !== false && data) {
      const handle = handles.get(fileUrl) ?? (pending ? await pending : null);
      if (!handle && cancelledFor === fileUrl) {
        cancelledFor = null;
        return; // the reader dismissed the dialog: saving was declined
      }
      if (handle) {
        try {
          const writable = await handle.createWritable();
          await writable.write(data);
          await writable.close();
          return;
        } catch {
          // Permission revoked, the file moved, or the disk refused it. The
          // reader still asked to save, so fall through to the download rather
          // than losing their edits to a silent failure.
          handles.delete(fileUrl);
        }
      }
    }
    return origDownload(data, url, filename);
  };
}

