// In-paper reference coloring check: per page, find in-paper references
// (Figure, Table, Section, Algorithm, Equation, ...) inside PROCESSED spans
// that have no .fx-ref-c coloring wrap. Reports totals plus samples.
//
// The probe and the verdict live in test/probes/refcolor.mjs, shared with the
// combined gate runner (test/allprobes.mjs); this file drives one browser.
// Usage: node test/refcolor.mjs <url> [--pages=A-B] [--zoom=Z]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { browserPath, extensionDir, killBrowser } from "./lib/env.mjs";
import { connect } from "./lib/cdp.mjs";
import * as refcolor from "./probes/refcolor.mjs";

const URL0 =
  process.argv.slice(2).find((a) => a.startsWith("--url="))?.slice(6) ??
  process.argv.slice(2).find((a) => !a.startsWith("--"));
const ZOOM = process.argv.slice(2).find((a) => a.startsWith("--zoom="))?.slice(7) ?? null;
const RANGE = (process.argv.slice(2).find((a) => a.startsWith("--pages="))?.slice(8) ?? "").split("-").map((n) => parseInt(n, 10));
const EXT = extensionDir;
const PORT = 9071 + (process.pid % 130);
const userDataDir = join(tmpdir(), `fx-rc-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();

const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });

let cdp;
const send = (method, params) => cdp.send(method, params);
const ev = (expr) => cdp.ev(expr);

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) { try { version = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null;
  for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  if (!extId) throw new Error("extension did not load");
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  cdp = connect(tab.webSocketDebuggerUrl, { where: "viewer" });
  await cdp.ready;
  await send("Page.enable"); await sleep(2500);
  let appOk = false;
  for (let i = 0; i < 30; i++) { appOk = await ev(`!!(window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer)`).catch(() => false); if (appOk) break; await sleep(500); }
  if (!appOk) throw new Error("viewer never loaded");
  // --zoom: the gate runs every check at one zoom; without it, the viewer's
  // default — what this check was validated at.
  if (ZOOM) await ev(`(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = ${JSON.stringify(ZOOM)}; return true; })()`);
  for (let i = 0; i < 40; i++) {
    await sleep(800);
    const ready = await ev(`({
      bolded: document.querySelectorAll('.textLayer .fx-b').length,
      refs: globalThis.__fxRefCount ?? -1,
      refPages: (globalThis.__fxRefPages ?? []).length
    })`).catch(() => null);
    if (ready && ready.bolded > 60 && ready.refs >= 0) break;
  }
  const pages = await ev(`window.PDFViewerApplication.pagesCount`);
  const from = RANGE[0] || 1, to = Math.min(RANGE[1] || pages, pages);
  const state = refcolor.create();
  for (let p = from; p <= to; p++) {
    await ev(`window.PDFViewerApplication.page = ${p}`);
    let prev = -1;
    for (let i = 0; i < 30; i++) {
      await sleep(600);
      const n = await ev(`(()=>{const d=window.PDFViewerApplication.pdfViewer.getPageView(${p - 1})?.textLayer?.div;return d?d.querySelectorAll('[data-fx-done]').length:0})()`).catch(() => 0);
      if (n > 0 && n === prev) break;
      prev = n;
    }
    await sleep(800);
    const r = await ev(refcolor.probe(p)).catch((e) => ({ error: String(e).slice(0, 100) }));
    const { out } = refcolor.add(state, p, r);
    for (const l of out) console.log(l);
  }
  const verdict = refcolor.summarize(state);
  for (const l of verdict.out) console.log(l);
  if (!verdict.ok) process.exitCode = 1;
} catch (e) {
  console.error("refcolor error:", e);
  process.exitCode = 1;
} finally {
  cdp?.close();
  killBrowser(browser);
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode ?? 0);
}
