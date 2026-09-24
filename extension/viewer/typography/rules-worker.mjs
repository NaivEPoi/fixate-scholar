// Pixel work off the main thread, for the typography engine.
//
// A canvas readback (getImageData) of a GPU-backed page canvas is a
// synchronous GPU->CPU copy: measured on a 2x display, up to ~100 ms a page on
// the main thread — the stalls a reader felt as the pointer slowing down. The
// engine hands this worker ImageBitmaps instead (createImageBitmap does not
// block) and gets the results back:
//
//   { id, kind: "rules", bitmap, kx, ky } -> { id, rules: [[x0, y0, x1, y1], ...] }
//       the page's baseline render (engine #baselineRules), scanned for line
//       art; rules in page px. ~70 ms a page, moved off the main thread.
//   { id, kind: "pixels", bitmap } -> { id, W, H, buffer }
//       a viewer canvas's pixels for the engine's ink checks (engine
//       #prefetchPixels); the RGBA buffer is transferred back, not copied.
//
// Failures come back as { id, error }. Every bitmap is closed here. The pages
// are opaque, so no alpha is lost to premultiplication: the pixels, and so the
// rules, are the ones a main-thread readback would give.
import { scanRules } from "./rules.mjs";

function pixelsOf(bitmap) {
  const W = bitmap.width, H = bitmap.height;
  const ctx = new OffscreenCanvas(W, H).getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, W, H).data;
  ctx.canvas.width = ctx.canvas.height = 0; // its backing store, now — not at the next GC
  return { W, H, data };
}

self.onmessage = ({ data: msg }) => {
  const { id } = msg;
  try {
    const { W, H, data } = pixelsOf(msg.bitmap);
    if (msg.kind === "pixels") {
      self.postMessage({ id, W, H, buffer: data.buffer }, [data.buffer]);
      return;
    }
    const { kx, ky } = msg;
    const rules = scanRules(data, W, H, kx, ky).map((b) => [b.x0 / kx, b.y0 / ky, b.x1 / kx, b.y1 / ky]);
    self.postMessage({ id, rules });
  } catch (e) {
    try { msg.bitmap?.close(); } catch { /* already closed */ }
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
