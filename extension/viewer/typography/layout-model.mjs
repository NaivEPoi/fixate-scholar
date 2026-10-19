// The layout model (experimental, off by default): a small document-layout
// detector run on a page's BASELINE render, in the rules worker, whose
// regions the engine takes as evidence beside its own rules (engine.mjs, the
// first stage of a pass: a candidate inside a figure, table, caption,
// footnote, formula, header or footer region at the model's confidence is
// kept on the canvas, with the region's class as its reason). The model
// never un-keeps: a miss leaves the rules' own decision in place.
//
// Model: PP-DocLayout-S (PaddleOCR 3.x, Apache-2.0) — PicoDet-S with a GFL
// head, 4.8 MB, 23 classes, 480×480 input, trained on documents of many
// kinds; its CPU time is tens of milliseconds a page. Runtime: ONNX Runtime
// Web (MIT), WebGPU where the browser has it, WebNN (the NPU) where
// `navigator.ml` exists, WebAssembly (SIMD, threads) otherwise. Both live in
// extension/vendor/layout (git-ignored, like PDF.js: `npm run fetch-layout`);
// without them the option does nothing, silently — the console stays clean.
//
// Exported for its unit test: the pure parts (tensor preparation, output
// decoding, the class map); `detectLayout` wires them to the runtime.

/** The model's classes, in its own order (inference.yml, PP-DocLayout-S). */
export const LAYOUT_CLASSES = Object.freeze([
  "paragraph_title", "image", "text", "number", "abstract", "content", "figure_title", "formula", "table",
  "table_title", "reference", "doc_title", "footnote", "header", "algorithm", "footer", "seal", "chart_title",
  "chart", "formula_number", "header_image", "footer_image", "aside_text",
]);

/** The classes whose regions keep a candidate on the canvas, by the engine's
 *  own vocabulary of reasons. A "text", "abstract", "reference" or "content"
 *  region says nothing the rules do not already decide. */
export const KEEP_CLASSES = Object.freeze({
  image: "figure", chart: "figure", seal: "figure", header_image: "figure", footer_image: "figure",
  figure_title: "caption", table_title: "caption", chart_title: "caption",
  table: "table", footnote: "footnote", formula: "formula", formula_number: "formula", algorithm: "algorithm",
  header: "header", footer: "footer", number: "footer", aside_text: "aside",
  paragraph_title: "heading", doc_title: "heading",
});

export const MODEL_INPUT = 480;
/** A region counts at this confidence or better (the model's own NMS
 *  score threshold is 0.3; the engine wants to be surer than that). */
export const MIN_SCORE = 0.5;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/**
 * The model's input tensors from a 480×480 RGBA readback of the page
 * (stretched, keep_ratio false, as the model was trained): `image`
 * [1,3,480,480] in CHW, scaled to 0..1 and normalised per channel, and
 * `scale_factor` [1,2] = [480/H, 480/W] of the source bitmap, by which the
 * model's own post-processing maps its boxes back to the source's pixels.
 */
export function prepareInput(rgba, srcW, srcH, size = MODEL_INPUT) {
  const n = size * size;
  const image = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    image[i] = (rgba[p] / 255 - MEAN[0]) / STD[0];
    image[n + i] = (rgba[p + 1] / 255 - MEAN[1]) / STD[1];
    image[2 * n + i] = (rgba[p + 2] / 255 - MEAN[2]) / STD[2];
  }
  const scale = new Float32Array([size / srcH, size / srcW]);
  return { image, scale, dims: { image: [1, 3, size, size], scale: [1, 2] } };
}

/**
 * The regions from the model's outputs: a detector exported with its NMS
 * gives one [N,6] tensor of (class, score, x0, y0, x1, y1) in the SOURCE
 * bitmap's pixels (thanks to scale_factor) and a count. Found by shape, not
 * by name, since export names vary ("multiclass_nms3_0.tmp_0"). Boxes
 * below `minScore`, of no class the engine keeps, or degenerate are dropped;
 * coordinates come back divided by `kx`/`ky` (bitmap px per page px).
 */
export function decodeOutput(outputs, { kx = 1, ky = 1, minScore = MIN_SCORE } = {}) {
  let boxes = null, count = null;
  for (const t of Object.values(outputs)) {
    const dims = t?.dims;
    if (!dims) continue;
    if (dims.length === 2 && dims[1] === 6) boxes = t;
    else if (dims.length === 1 && dims[0] === 1 && !count) count = t;
  }
  if (!boxes) return [];
  const data = boxes.data;
  const n = count ? Math.min(Number(count.data[0]), boxes.dims[0]) : boxes.dims[0];
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const cls = Math.round(data[o]), score = data[o + 1];
    const name = LAYOUT_CLASSES[cls];
    if (!(score >= minScore) || !name || !(name in KEEP_CLASSES)) continue;
    const x0 = data[o + 2] / kx, y0 = data[o + 3] / ky, x1 = data[o + 4] / kx, y1 = data[o + 5] / ky;
    if (!(x1 > x0) || !(y1 > y0)) continue;
    out.push({ cls: name, kind: KEEP_CLASSES[name], score, x0, y0, x1, y1 });
  }
  return out.sort((a, b) => b.score - a.score);
}

let runtime = null; // Promise<{ ort, bytes, providers, ... } | null>, once
let runtimeError = null; // why the runtime is unavailable, for the diagnostics (no console message)
let forced = null; // a provider name the diagnostics force (engine → worker message)
const RUNTIME_DIR = new URL("../../vendor/layout/", import.meta.url);

/** Why the runtime or the model would not load, once loadRuntime has run;
 *  null while they load or when they loaded. Test introspection. */
export function layoutError() { return runtimeError; }

const epName = (ep) => (typeof ep === "string" ? ep : `${ep.name}/${ep.deviceType}`);

/** A session on the first provider from `from` that creates one; null with
 *  the failures recorded when none does. */
async function createSession(rt, from) {
  const failures = [];
  for (let i = from; i < rt.providers.length; i++) {
    const ep = rt.providers[i];
    try {
      rt.session = await rt.ort.InferenceSession.create(rt.bytes, { executionProviders: [ep], graphOptimizationLevel: "all" });
      rt.providerIndex = i;
      rt.provider = epName(ep);
      rt.inputs = {
        image: rt.session.inputNames.find((n) => /image/i.test(n)) ?? rt.session.inputNames[0],
        scale: rt.session.inputNames.find((n) => /scale/i.test(n)) ?? rt.session.inputNames[1],
      };
      return rt;
    } catch (e) { failures.push(`${epName(ep)}: ${String(e?.message || e).slice(0, 160)}`); }
  }
  runtimeError = `no provider: ${failures.join(" | ")}`;
  rt.session = null;
  return null;
}

/** The runtime and the model, loaded once; null (and remembered) when they
 *  are not there or will not load — no message in the console. */
function loadRuntime(force = null) {
  if (runtime && force === forced) return runtime;
  forced = force;
  runtime = (async () => {
    try {
      const ort = await import(new URL("ort/ort.min.mjs", RUNTIME_DIR).href);
      ort.env.wasm.wasmPaths = new URL("ort/", RUNTIME_DIR).href;
      // One thread: the threaded build spawns its workers from blob: URLs,
      // which the extension's CSP (script-src 'self') refuses; the SIMD
      // single-threaded path needs nothing the extension does not allow.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.logLevel = "error";
      // The providers in order of preference — the NPU and GPU through
      // WebNN, WebGPU, then WebAssembly, which runs anywhere. A forced name
      // (the diagnostics measuring one) narrows the list to it.
      let providers = [];
      if (typeof navigator !== "undefined" && navigator.ml) providers.push({ name: "webnn", deviceType: "npu" }, { name: "webnn", deviceType: "gpu" });
      if (typeof navigator !== "undefined" && navigator.gpu) providers.push("webgpu");
      providers.push("wasm");
      if (force) providers = providers.filter((ep) => epName(ep) === force || (typeof ep !== "string" && ep.name === force));
      if (!providers.length) { runtimeError = `provider ${force} is not available here`; return null; }
      const model = await fetch(new URL("pp-doclayout-s.onnx", RUNTIME_DIR));
      if (!model.ok) { runtimeError = `model: HTTP ${model.status}`; return null; }
      const bytes = new Uint8Array(await model.arrayBuffer());
      return await createSession({ ort, bytes, providers, session: null, providerIndex: -1, provider: "?", inputs: null }, 0);
    } catch (e) { runtimeError = `runtime: ${String(e?.message || e).slice(0, 200)}`; return null; }
  })();
  return runtime;
}

/**
 * The page's regions, in page px, from its baseline bitmap: the bitmap is
 * drawn into a 480×480 canvas (stretched), read back, run, decoded. `kx`,
 * `ky` are the bitmap's pixels per page px. Null when the model is not
 * available; an empty list when it found nothing to keep. A provider that
 * creates a session but fails to RUN this graph (WebGPU: a MatMul kernel's
 * "shared dimension does not match" on this export, R55) is left for the
 * next one, once, and the session stays on the one that ran.
 */
export async function detectLayout(bitmap, kx, ky, force = null) {
  let rt = await loadRuntime(force);
  if (!rt) return null;
  const size = MODEL_INPUT;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, size, size);
  const rgba = ctx.getImageData(0, 0, size, size).data;
  canvas.width = canvas.height = 0;
  const { image, scale, dims } = prepareInput(rgba, bitmap.width, bitmap.height, size);
  for (let attempt = 0; ; attempt++) {
    const feeds = {
      [rt.inputs.image]: new rt.ort.Tensor("float32", image, dims.image),
      [rt.inputs.scale]: new rt.ort.Tensor("float32", scale, dims.scale),
    };
    const t0 = performance.now();
    try {
      const outputs = await rt.session.run(feeds);
      const regions = decodeOutput(outputs, { kx, ky });
      return { regions, ms: performance.now() - t0, provider: rt.provider };
    } catch (e) {
      if (attempt > 0 || rt.providerIndex + 1 >= rt.providers.length) throw e;
      const failed = rt.provider;
      const next = await createSession(rt, rt.providerIndex + 1);
      if (!next) throw new Error(`${failed} failed to run (${String(e?.message || e).slice(0, 120)}); ${runtimeError}`);
      rt = next;
    }
  }
}
