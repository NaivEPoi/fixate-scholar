// Comment-annotation regression. Highlights were R14; this covers the note you
// attach to one, which is what a reviewer actually wants out of a highlight.
//
// Verifies, on top of the typography overlay:
//  1. the comment feature is ON (PDF.js ships it behind a false-by-default
//     preference — pdfjs-patches.mjs patch 7 flips it);
//  2. a comment can be attached to a highlight through the real UI (the
//     editor's comment button → the dialog → save);
//  3. reopening the SAVED file in reading mode shows the note, and its button
//     is still clickable — the citation hit-target layer sits above the page
//     and would otherwise swallow the click that opens it;
//  4. it saves as a STANDARD annotation other readers understand: /Highlight
//     carrying /Contents and the author's /T, plus a child /Popup whose
//     /Parent points back at it;
//  5. it survives save + reload with its text intact.
// Usage: node test/comments.mjs [url] [page]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

import { browserPath, extensionDir, profileDir } from "./lib/env.mjs";

const URL0 = process.argv[2] ?? "https://yilud.me/Proteus-ccs24.pdf";
const PAGE = parseInt(process.argv[3] ?? "2", 10);
const NOTE = "Reviewer note: check this claim against Section 4.";
const AUTHOR = "Reviewer 2";
const EXT = extensionDir;
const PORT = 9811 + (process.pid % 120);
const userDataDir = profileDir("cmt");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = "GET") => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json();
const browser = spawn(browserPath("edge"), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1400,2000",
  `--user-data-dir=${userDataDir}`, `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`, "about:blank"], { stdio: "ignore" });
let ws, nextId = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  ws.addEventListener("message", h); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text||"").slice(0,500)); return r.result.value; };
const drag = async (x0, x1, y) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 8; i++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / 8, y, button: "left", buttons: 1 }); await sleep(45); }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, button: "left", clickCount: 1 });
};
const fail = (m) => { console.error("FAIL:", m); failed = true; };
let failed = false;
try {
  let v = null; for (let i = 0; i < 50 && !v; i++) { try { v = await http("/json/version"); } catch { await sleep(300); } }
  let extId = null; for (let i = 0; i < 60 && !extId; i++) { const t = await http("/json/list"); const sw = t.find((x) => x.type === "service_worker" && x.url.includes("service-worker.mjs")); if (sw) extId = new URL(sw.url).hostname; else await sleep(300); }
  const tab = await http(`/json/new?chrome-extension://${extId}/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(URL0)}`, "PUT");
  ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  await send("Page.enable"); await send("Runtime.enable"); await send("Input.enable").catch(() => {});
  await sleep(3000);
  for (let i = 0; i < 25; i++) { const ok = await ev("!!(chrome&&chrome.storage&&chrome.storage.sync)").catch(() => false); if (ok) break; await sleep(400); }
  await ev(`new Promise((r)=>chrome.storage.sync.set({enabled:true,annotationAuthor:${JSON.stringify(AUTHOR)}},r))`); await sleep(3500);
  for (let i = 0; i < 30; i++) { await sleep(700); const b = await ev("document.querySelectorAll('.textLayer .fx-b').length").catch(() => 0); if (b > 80) break; }
  await ev(`window.PDFViewerApplication.page = ${PAGE}`); await sleep(4000);

  // (1) the feature is on: the toolbar's comment control is no longer hidden.
  const on = await ev(`(() => {
    const b = document.getElementById('editorCommentButton');
    return { present: !!b, shown: !!b && !b.parentElement.hidden };
  })()`);
  console.log("comment feature:", JSON.stringify(on));
  if (!on.shown) fail("comment feature is off (patch 7 missing from the vendored viewer?)");

  await ev(`document.getElementById('editorHighlightButton').click()`); await sleep(800);

  // (2a) a highlight to hang the comment on — synthetic drags are flaky, retry.
  let made = null;
  for (let attempt = 0; attempt < 5 && !(made && made.storage > 0); attempt++) {
    const t = await ev(`(() => {
      const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1});
      const spans = [...pv.textLayer.div.querySelectorAll('span')].filter((s) => {
        const r = s.getBoundingClientRect();
        return (s.textContent||'').trim().split(/\\s+/).length >= 6 && r.width > 200 && r.top > 150 && r.bottom < innerHeight - 120;
      });
      const s = spans[Math.floor(spans.length * (0.3 + 0.1 * ${attempt}))] || spans[0];
      if (!s) return null; const r = s.getBoundingClientRect();
      return { x0: r.left + 6, x1: r.right - 6, y: (r.top + r.bottom) / 2 };
    })()`);
    if (!t) { fail("no target span"); break; }
    await ev(`getSelection().removeAllRanges()`);
    await drag(t.x0, t.x1, t.y);
    await sleep(1300);
    made = await ev(`(() => { const pv = window.PDFViewerApplication.pdfViewer.getPageView(${PAGE - 1}); return { editors: pv.div.querySelectorAll('.highlightEditor').length, storage: window.PDFViewerApplication.pdfDocument.annotationStorage.size }; })()`);
  }
  console.log("highlight created:", JSON.stringify(made));
  if (!made || made.storage < 1) { fail("could not create a highlight after retries"); throw new Error("no highlight"); }

  // (2b) attach the note through the UI: the editor toolbar's comment button
  // opens the dialog; type; save.
  const opened = await ev(`(() => {
    const btn = document.querySelector('.highlightEditor .editToolbar button.comment, .highlightEditor button.comment, .editToolbar button.comment');
    if (!btn) return { found: false, toolbar: [...document.querySelectorAll('.editToolbar button')].map((b) => b.className).join('|') };
    btn.click();
    return { found: true };
  })()`);
  await sleep(900);
  const dialog = await ev(`(() => { const d = document.getElementById('commentManagerDialog'); return { found: !!d, open: !!d?.open }; })()`);
  console.log("comment button:", JSON.stringify(opened), "dialog:", JSON.stringify(dialog));
  if (!opened.found) fail("no comment button on the highlight's editor toolbar");
  if (!dialog.open) fail("the comment dialog did not open");
  await ev(`(() => {
    const ta = document.getElementById('commentManagerTextInput');
    ta.focus();
    ta.value = ${JSON.stringify(NOTE)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(400);
  await ev(`document.getElementById('commentManagerSaveButton').click()`);
  await sleep(1200);

  // (4) saved bytes: a standard /Highlight with /Contents and a child /Popup.
  const saved = await ev(`(async () => {
    const bytes = await window.PDFViewerApplication.pdfDocument.saveDocument();
    globalThis.__saved = bytes;
    const s = new TextDecoder('latin1').decode(bytes);
    return {
      highlight: /\\/Highlight/.test(s),
      quadPoints: /\\/QuadPoints/.test(s),
      contents: /\\/Contents/.test(s),
      popup: /\\/Subtype\\s*\\/Popup/.test(s),
      parent: /\\/Parent/.test(s),
      print: /\\/F 4/.test(s),
      appearance: /\\/AP/.test(s),
    };
  })()`);
  console.log("saved:", JSON.stringify(saved));
  for (const [k, want] of [["highlight", "/Highlight"], ["quadPoints", "/QuadPoints"], ["contents", "/Contents"], ["popup", "/Popup"], ["parent", "/Parent"], ["print", "/F 4 (prints in other readers)"], ["appearance", "/AP appearance stream (for readers that don't synthesize one)"]]) {
    if (!saved[k]) fail(`saved PDF is missing ${want}`);
  }

  // (5) round-trip: reopen the SAVED bytes in the viewer — the state a second
  // reader (or the author, tomorrow) sees — and check the note is there, is
  // attached to the highlight, and can still be opened in reading mode. The
  // citation hit-target layer sits above the page, so its click could be
  // swallowed; that is the integration this exists to catch.
  const rt = await ev(`(async () => {
    const doc = await window.pdfjsLib.getDocument({ data: globalThis.__saved.slice() }).promise;
    const annots = await (await doc.getPage(${PAGE})).getAnnotations();
    const hl = annots.filter((a) => a.subtype === 'Highlight');
    const popups = annots.filter((a) => a.subtype === 'Popup');
    return {
      highlights: hl.length,
      text: hl[0]?.contentsObj?.str ?? null,
      author: hl[0]?.titleObj?.str ?? null,
      popups: popups.length,
      popupText: popups[0]?.contentsObj?.str ?? null,
      // PopupAnnotation only fills parentRect when /Parent resolved to the
      // markup annotation — the link other readers follow to show the note.
      popupParented: popups.some((p) => Array.isArray(p.parentRect)),
    };
  })()`);
  console.log("after reload:", JSON.stringify(rt));
  if (rt.author !== AUTHOR) fail(`the annotation carries no author (/T = ${JSON.stringify(rt.author)}) — other readers show the note as anonymous`);
  if (rt.highlights < 1) fail("highlight did not survive save+reload");
  if (rt.text !== NOTE) fail(`comment text did not round-trip (got ${JSON.stringify(rt.text)})`);
  if (rt.popups < 1) fail("no /Popup annotation — other readers show no note");
  if (!rt.popupParented) fail("the /Popup is not parented to the highlight — other readers can't attach the note");

  await ev(`window.PDFViewerApplication.open({ data: globalThis.__saved.slice() })`);
  await sleep(6000);
  await ev(`window.PDFViewerApplication.page = ${PAGE}`);
  await sleep(4000);
  const reopened = await ev(`(() => {
    const b = document.querySelector('.annotationCommentButton');
    if (!b) return { found: false, fx: document.querySelectorAll('.textLayer .fx-b').length };
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      found: true,
      fx: document.querySelectorAll('.textLayer .fx-b').length,
      hits: !!el && (el === b || b.contains(el) || el.contains(b)),
      covering: el ? (el.className || el.tagName) : null,
    };
  })()`);
  console.log("reopened saved file:", JSON.stringify(reopened));
  if (!reopened.found) fail("the saved file's comment shows no button in the viewer");
  else if (!reopened.hits) fail(`the comment button is covered by ${reopened.covering} — clicking the note would do nothing`);
  else {
    await ev(`document.querySelector('.annotationCommentButton').click()`);
    await sleep(900);
    const popup = await ev(`(() => {
      const p = document.querySelector('#commentPopup, .commentPopup');
      return { found: !!p, text: (p?.textContent || '').trim().slice(0, 120) };
    })()`);
    console.log("comment popup:", JSON.stringify(popup));
    if (!popup.found || !popup.text.includes("Reviewer note")) fail("clicking the comment button did not show the note");
  }

  console.log(failed ? "COMMENTS: FAIL" : "COMMENTS: PASS");
} catch (e) { console.error("comments error:", e.message || e); failed = true; }
finally { try { ws?.close(); } catch {} browser.kill(); await sleep(500); try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} process.exit(failed ? 1 : 0); }
