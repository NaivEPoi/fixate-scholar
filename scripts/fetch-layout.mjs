// Fetch the layout model option's runtime and model into extension/vendor/
// layout (git-ignored, like the PDF.js build): ONNX Runtime Web's
// distribution files from the npm registry and the PP-DocLayout-S ONNX model.
//
//   node scripts/fetch-layout.mjs            # both
//   node scripts/fetch-layout.mjs --runtime  # the runtime only
//   node scripts/fetch-layout.mjs --model    # the model only
//
// Nothing here is loaded by the extension unless the "layout model" option is
// on (settings-client.mjs `layoutModel`); without these files the option does
// nothing. Licences: ONNX Runtime (MIT), PP-DocLayout-S (PaddleOCR, Apache
// License 2.0) — both are copied beside the files.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "extension", "vendor", "layout");
const ORT_VERSION = "1.30.0";
// The files the worker loads (layout-model.mjs): the ESM entry and the
// WebAssembly build it picks at run time (SIMD + threads, with the WebGPU
// and WebNN providers compiled in).
const ORT_FILES = [
  "ort.min.mjs",
  "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm",
];
// The model: PP-DocLayout-S (PaddlePaddle/PP-DocLayout-S on Hugging Face,
// Apache License 2.0) exported to ONNX with paddle2onnx — the two-input GFL
// graph (image [1,3,480,480], scale_factor [1,2]) with MultiClassNMS inside,
// outputs [M,6] rows of class, score, x1, y1, x2, y2 and the count of valid
// rows. The publisher's own files are Paddle 3's inference.json +
// inference.pdiparams, and paddle2onnx has no wheel for Python 3.13 (its
// onnx dependency fails to build), so the export published alongside it is
// fetched and checked against the SHA-256 its model card states; a file
// whose hash differs is refused. Set FX_LAYOUT_MODEL_URL (and
// FX_LAYOUT_MODEL_SHA256, or "skip") to fetch another export.
const MODEL_URL = process.env.FX_LAYOUT_MODEL_URL || "https://huggingface.co/stefanj0/PP-DocLayout-S-ONNX/resolve/main/pp_doclayout_s.onnx";
const MODEL_SHA256 = process.env.FX_LAYOUT_MODEL_SHA256 || (process.env.FX_LAYOUT_MODEL_URL ? "skip" : "33688dbee1c23e34b81777e97cb428eb40f24b242c02b5f623484959e830aec8");
const MODEL_FILE = "pp-doclayout-s.onnx";

const want = (f) => process.argv.length <= 2 || process.argv.includes(f);
mkdirSync(join(dest, "ort"), { recursive: true });

async function fetchTo(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(file));
  console.log(`fetched ${file} (${(readFileSync(file).length / 1e6).toFixed(1)} MB)`);
}

if (want("--runtime")) {
  // One tarball, the files picked out of it: npm's registry serves
  // onnxruntime-web-<v>.tgz with dist/ inside.
  const tgz = join(dest, "ort", `onnxruntime-web-${ORT_VERSION}.tgz`);
  if (!existsSync(tgz)) await fetchTo(`https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-${ORT_VERSION}.tgz`, tgz);
  // Untar without a dependency: a minimal reader of ustar headers.
  const data = await new Promise((resolve, reject) => {
    const chunks = [];
    const gz = createGunzip();
    gz.on("data", (c) => chunks.push(c)).on("end", () => resolve(Buffer.concat(chunks))).on("error", reject);
    gz.end(readFileSync(tgz));
  });
  let off = 0, got = 0, license = null;
  while (off + 512 <= data.length) {
    const name = data.subarray(off, off + 100).toString().replace(/\0.*$/s, "");
    if (!name) break;
    const size = parseInt(data.subarray(off + 124, off + 136).toString().replace(/\0.*$/s, "").trim(), 8) || 0;
    const body = data.subarray(off + 512, off + 512 + size);
    const base = name.split("/").pop();
    if (name.startsWith("package/dist/") && ORT_FILES.includes(base)) { writeFileSync(join(dest, "ort", base), body); got++; }
    if (name === "package/LICENSE") license = body;
    off += 512 + Math.ceil(size / 512) * 512;
  }
  // The tarball ships no licence file (onnxruntime-web 1.30.0): the MIT
  // licence of the ONNX Runtime repository is written beside the files.
  writeFileSync(join(dest, "ort", "LICENSE"), license ?? [
    `ONNX Runtime Web (onnxruntime-web ${ORT_VERSION}, https://github.com/microsoft/onnxruntime)`, "", "MIT License", "", "Copyright (c) Microsoft Corporation", "",
    "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:", "",
    "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.", "",
    "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.", "",
    "(The npm tarball ships no licence file; this is the MIT licence text of the ONNX Runtime repository.)", "",
  ].join("\n"));
  console.log(`runtime: ${got}/${ORT_FILES.length} files into ${join(dest, "ort")}`);
  if (got < 3) throw new Error("the runtime's files were not found in the tarball — the dist layout changed; update ORT_FILES");
}

if (want("--model")) {
  const { createHash } = await import("node:crypto");
  const file = join(dest, MODEL_FILE);
  await fetchTo(MODEL_URL, file);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (MODEL_SHA256 !== "skip" && sha !== MODEL_SHA256) {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(file);
    throw new Error(`model: SHA-256 ${sha} is not the expected ${MODEL_SHA256} — the file was removed; the publisher's card may have changed, re-check it`);
  }
  writeFileSync(join(dest, "MODEL-SOURCE.txt"), [
    "PP-DocLayout-S — PaddlePaddle (PaddleOCR), Apache License 2.0.",
    "Original: https://huggingface.co/PaddlePaddle/PP-DocLayout-S",
    `ONNX export fetched from: ${MODEL_URL}`,
    `SHA-256: ${sha}${MODEL_SHA256 === "skip" ? " (not checked)" : " (checked)"}`,
    "Input: image float32 [1,3,480,480], RGB scaled to [0,1], mean [0.485,0.456,0.406], std [0.229,0.224,0.225]; scale_factor float32 [1,2] = [480/h, 480/w].",
    "Output: [M,6] rows of class, score, x1, y1, x2, y2 in page px (NMS inside, score ≥ 0.3), and the count of valid rows.",
    "",
  ].join("\n"));
  console.log(`model: ${MODEL_FILE} sha256 ${sha.slice(0, 12)}… ${MODEL_SHA256 === "skip" ? "(unchecked)" : "verified"}`);
}
