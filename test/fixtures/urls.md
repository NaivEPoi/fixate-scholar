# Manual test matrix

| Case | URL | Expect |
|---|---|---|
| Content-type-only PDF (no .pdf extension), numeric citations | https://arxiv.org/pdf/1706.03762 | Opens in FixatePDF, bolding + citation popups |
| APA author-year citations | any psychology paper PDF, e.g. via Google Scholar | (Author, year) popups resolve |
| Attachment disposition | a link served with `Content-Disposition: attachment` | Downloads, NOT intercepted |
| Local file | file:///C:/...some.pdf (needs "Allow access to file URLs") | Opens in FixatePDF |
| Google Scholar results | scholar.google.com → click a [PDF] link | Opens in FixatePDF |
| Bypass | toggle "Bypass current site" in popup, reload PDF | Native viewer |
| Native escape hatch | "native" toolbar button in the viewer | Re-opens in Chrome's viewer once |

Automated smoke test: `node test/e2e.mjs [path-to-browser]`.

Note: Google Chrome stable ≥137 ignores `--load-extension`, so the automated
test defaults to Chrome but should be pointed at Edge (or Chrome for Testing /
Chromium):

```
node test/e2e.mjs "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
```

Manual loading via chrome://extensions → "Load unpacked" works fine in regular
Chrome; the flag removal only affects command-line loading.
