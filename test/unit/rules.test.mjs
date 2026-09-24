// scanRules — the canvas line-art scan behind table zones and mask obstacles.
//
// The engine now scans ONE render of each page at RULE_PPU whatever the zoom
// (R47 round 2), so the product no longer depends on the scan agreeing with
// itself across resolutions. The scan is still written in page units, and the
// live-canvas fallback still hands it whatever resolution the viewer painted,
// so its contract is tested here directly: a clear rule is found, at the same
// page position, at every resolution a canvas can have — capped 180% (1.29),
// 100% and page-fit at 2x (2, 2.41), and the oracle's 3 — and a line of text
// (a thick dark band) never is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanRules } from "../../extension/viewer/typography/rules.mjs";

const W_PAGE = 400, H_PAGE = 300; // page px

/**
 * An RGBA bitmap of `rects` ({x0, y0, x1, y1, ink} in page px, ink 0-255) at
 * `k` bitmap px per page px, each pixel shaded by the area it covers — how a
 * canvas anti-aliases a stroke that does not land on the pixel grid.
 */
function raster(rects, k) {
  const W = Math.round(W_PAGE * k), H = Math.round(H_PAGE * k);
  const ink = new Float32Array(W * H);
  for (const r of rects) {
    for (let y = Math.floor(r.y0 * k); y < Math.ceil(r.y1 * k); y++) {
      const cy = Math.min(y + 1, r.y1 * k) - Math.max(y, r.y0 * k);
      for (let x = Math.floor(r.x0 * k); x < Math.ceil(r.x1 * k); x++) {
        const cx = Math.min(x + 1, r.x1 * k) - Math.max(x, r.x0 * k);
        ink[y * W + x] = Math.min(255, ink[y * W + x] + r.ink * cx * cy);
      }
    }
  }
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const v = 255 - ink[p];
    data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = v;
    data[p * 4 + 3] = 255;
  }
  return { data, W, H };
}

const SCENE = [
  { x0: 40, y0: 100.3, x1: 360, y1: 100.9, ink: 255 }, // 0.45pt table rule, off the pixel grid
  { x0: 200.2, y0: 150, x1: 200.8, y1: 280, ink: 255 }, // a vertical cell border
  { x0: 40, y0: 200, x1: 360, y1: 212, ink: 200 }, // a line's worth of dark text band
];

for (const k of [1.29, 2, 2.41, 3]) {
  test(`scanRules finds the same rules at ${k} px per page px`, () => {
    const { data, W, H } = raster(SCENE, k);
    const rules = scanRules(data, W, H, k, k).map((b) => ({
      x0: b.x0 / k, y0: b.y0 / k, x1: b.x1 / k, y1: b.y1 / k,
    }));
    const horiz = rules.filter((r) => r.x1 - r.x0 > r.y1 - r.y0);
    const vert = rules.filter((r) => r.x1 - r.x0 <= r.y1 - r.y0);
    assert.equal(horiz.length, 1, `horizontal rules: ${JSON.stringify(horiz)}`);
    assert.equal(vert.length, 1, `vertical rules: ${JSON.stringify(vert)}`);
    // Where it is, in page px, to within the pixel it rasterised into.
    const tol = 1 / k + 0.5;
    assert.ok(Math.abs(horiz[0].y0 - 100.3) <= tol && Math.abs(horiz[0].y1 - 100.9) <= tol, JSON.stringify(horiz[0]));
    assert.ok(Math.abs(horiz[0].x0 - 40) <= tol && Math.abs(horiz[0].x1 - 360) <= tol, JSON.stringify(horiz[0]));
    assert.ok(Math.abs(vert[0].x0 - 200.2) <= tol && Math.abs(vert[0].y0 - 150) <= tol && Math.abs(vert[0].y1 - 280) <= tol, JSON.stringify(vert[0]));
  });
}

test("scanRules: a blank page has no rules", () => {
  const { data, W, H } = raster([], 2);
  assert.deepEqual(scanRules(data, W, H, 2, 2), []);
});
