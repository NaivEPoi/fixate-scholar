// The baseline rule scan, off the main thread. The engine renders each page's
// baseline once (engine #baselineRules) and hands this worker a snapshot of it
// as an ImageBitmap; the pixel readback (getImageData) and the scan — ~70 ms a
// page on the main thread, measured, and the largest single item of a cold
// scroll through a paper — happen here instead, in parallel with the viewer.
// The pixels are the render's own (an opaque page, so no alpha is lost to
// premultiplication), so the rules are the ones the main thread would find.
//
// Message in:  { id, bitmap, kx, ky }   (bitmap is transferred and closed here)
// Message out: { id, rules: [[x0, y0, x1, y1], ...] } in page px, or { id, error }
import { scanRules } from "./rules.mjs";

self.onmessage = ({ data: { id, bitmap, kx, ky } }) => {
  try {
    const W = bitmap.width, H = bitmap.height;
    const ctx = new OffscreenCanvas(W, H).getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const rules = scanRules(ctx.getImageData(0, 0, W, H).data, W, H, kx, ky)
      .map((b) => [b.x0 / kx, b.y0 / ky, b.x1 / kx, b.y1 / ky]);
    self.postMessage({ id, rules });
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
