// FixateScholar background service worker: redirects PDF navigations into the
// bundled viewer using declarativeNetRequest session rules (Chrome 128+,
// responseHeaders conditions), with a webNavigation fallback for file:// and
// a context-menu fallback for anything else.

import { clearCached } from "../viewer/references/lookup-cache.mjs";
import { normalizeBypassUrl, urlsMatch } from "../viewer/settings-client.mjs";

const VIEWER = chrome.runtime.getURL("vendor/pdfjs/web/viewer.html");

// Rule ids. 2xx = redirects, 3xx+ = per-origin user bypass,
// 5xx+ = per-URL user bypass, 9xx = transient bypass-once.
const RULE_REDIRECT_PDF = 201;
const RULE_REDIRECT_OCTET = 202;
const RULE_REDIRECT_PDF_URL = 203;
const BYPASS_ORIGIN_BASE = 300;
const BYPASS_URL_BASE = 500;
const BYPASS_ONCE_BASE = 900;

// registerRules() is triggered from several events (onInstalled, onStartup, the
// top-level call below, and storage changes) that can fire close together. Run
// concurrently, each invocation would snapshot getSessionRules() before any of
// them writes, then all try to ADD the same static rule ids — the later write
// fails with "Rule with id 203 does not have a unique ID". Serialize the calls
// so each read reflects the previous write (and so a failure can't break the
// chain or surface as an unhandled rejection).
let registerChain = Promise.resolve();
function registerRules() {
  registerChain = registerChain
    .catch(() => {})
    .then(() =>
      applyRules().catch((e) =>
        console.warn("FixateScholar: failed to register DNR rules", e),
      ),
    );
  return registerChain;
}

async function applyRules() {
  // Master switch. When interception is off we register NO redirect rules, so
  // every PDF navigation reaches the browser's native viewer (and any other
  // PDF-handling extension / the built-in Gemini reading tools). We still issue
  // an updateSessionRules whose removeRuleIds clears any managed rule left over
  // from when it was on, so flipping the switch takes effect immediately.
  const { intercept = true } = await chrome.storage.sync.get("intercept");

  const rules = !intercept ? [] : [
    // Top-level navigations to a *.pdf URL: redirect at the request stage
    // (before any response exists), so the browser never receives a PDF
    // response on the tab for a download manager (IDM, FDM, …) to grab. This
    // also avoids a race with the header-stage rule below, which fires too
    // late to keep such tools from intercepting the navigation.
    {
      id: RULE_REDIRECT_PDF_URL,
      priority: 1,
      condition: {
        resourceTypes: ["main_frame"],
        excludedRequestMethods: ["post"],
        regexFilter: "^(https?://[^?#]*\\.pdf([?#].*)?)$",
      },
      action: {
        type: "redirect",
        redirect: { regexSubstitution: `${VIEWER}?file=\\1` },
      },
    },
    // Top-level navigations that return a PDF without a .pdf extension
    // (e.g. arxiv.org/pdf/1706.03762), matched on the response Content-Type —
    // including ones served with Content-Disposition: attachment. Nothing is
    // ever saved to disk just by opening a link; the viewer's toolbar
    // download button is the explicit way to save a copy.
    {
      id: RULE_REDIRECT_PDF,
      priority: 1,
      condition: {
        resourceTypes: ["main_frame"],
        excludedRequestMethods: ["post"],
        responseHeaders: [
          { header: "content-type", values: ["application/pdf*"] },
        ],
        regexFilter: "^(https?://.*)$",
      },
      action: {
        type: "redirect",
        redirect: { regexSubstitution: `${VIEWER}?file=\\1` },
      },
    },
    // Generic byte streams that are clearly PDF files by name.
    {
      id: RULE_REDIRECT_OCTET,
      priority: 1,
      condition: {
        resourceTypes: ["main_frame"],
        excludedRequestMethods: ["post"],
        responseHeaders: [
          {
            header: "content-type",
            values: ["application/octet-stream*"],
          },
        ],
        regexFilter: "^(https?://[^?#]*\\.pdf([?#].*)?)$",
      },
      action: {
        type: "redirect",
        redirect: { regexSubstitution: `${VIEWER}?file=\\1` },
      },
    },
    ...(await bypassOriginRules()),
    ...(await bypassUrlRules()),
  ];
  // removeRuleIds must be a SUPERSET of the ids we add: updateSessionRules
  // removes the listed ids before adding, so naming an id we re-add makes it a
  // safe replace that can't collide with a copy a racing registration already
  // inserted. Existing managed ids are folded in too, clearing any stale bypass
  // rule for an origin that has since been removed.
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = [
    ...new Set([
      ...rules.map((r) => r.id),
      ...existing.map((r) => r.id).filter((id) => id < BYPASS_ONCE_BASE),
    ]),
  ];
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds,
    addRules: rules,
  });
}

async function bypassOriginRules() {
  const { bypassOrigins = [] } = await chrome.storage.sync.get("bypassOrigins");
  return bypassOrigins
    .map((origin) => {
      if (!origin || typeof origin !== "string") return null;
      const domain = origin
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/.*$/, "")
        .replace(/:\d+$/, "")
        .toLowerCase();
      return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(domain)
        ? domain
        : null;
    })
    .filter(Boolean)
    .slice(0, 100)
    .map((domain, i) => ({
      id: BYPASS_ORIGIN_BASE + i,
      priority: 20,
      condition: {
        resourceTypes: ["main_frame"],
        requestDomains: [domain],
      },
      action: { type: "allow" },
    }));
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function bypassUrlRules() {
  const { bypassUrls = [] } = await chrome.storage.sync.get("bypassUrls");
  return bypassUrls
    .map((url) => normalizeBypassUrl(url))
    .filter((url) => /^https?:/i.test(url) && url.length <= 1024)
    .slice(0, 100)
    .map((cleanUrl, i) => ({
      id: BYPASS_URL_BASE + i,
      priority: 25,
      condition: {
        resourceTypes: ["main_frame"],
        regexFilter: `^${escapeRegex(cleanUrl)}([?#].*)?$`,
      },
      action: { type: "allow" },
    }));
}

export async function clearUserCache() {
  try {
    await clearCached();
  } catch {}
}

chrome.runtime.onInstalled.addListener(async (details) => {
  registerRules();
  chrome.contextMenus.create({
    id: "fx-open-link",
    title: "Open link in FixateScholar",
    contexts: ["link"],
  });
  // Clear user cache when a new version is installed/updated to prevent breaking changes across versions.
  if (!details || details.reason === "install" || details.reason === "update") {
    await clearUserCache();
  }
});
chrome.runtime.onStartup.addListener(registerRules);
registerRules();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.bypassOrigins || changes.bypassUrls || changes.intercept))
    registerRules();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "fx-open-link" && info.linkUrl) {
    if (!/^(https?|file):/i.test(info.linkUrl)) return;
    await removeBypassUrl(info.linkUrl);
    chrome.tabs.create({
      url: `${VIEWER}?file=${encodeURIComponent(info.linkUrl)}`,
      index: tab ? tab.index + 1 : undefined,
    });
  }
});

export { normalizeBypassUrl, urlsMatch };

export async function removeBypassUrl(url) {
  const clean = normalizeBypassUrl(url);
  if (!clean || !/^(https?|file):/i.test(clean)) return;
  const { bypassUrls = [] } = await chrome.storage.sync.get("bypassUrls");
  const next = bypassUrls.filter((u) => !urlsMatch(u, clean));
  if (next.length !== bypassUrls.length) {
    await chrome.storage.sync.set({ bypassUrls: next });
  }
}

// The one navigation a "native" click lets through: that tab, that URL.
// Nothing is saved — the next open of the same PDF comes back to FixateScholar;
// a lasting bypass is the user's own entry in Options (bypassUrls).
let bypassOnce = null; // { tabId, url }

async function isBypassedUrl(url, tabId) {
  if (bypassOnce && bypassOnce.tabId === tabId && urlsMatch(bypassOnce.url, url)) return true;
  const { bypassUrls = [] } = await chrome.storage.sync.get("bypassUrls");
  return bypassUrls.some((u) => urlsMatch(u, url));
}

// file://*.pdf — DNR can't see file: responses; rewrite the navigation.
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    if (details.frameId !== 0) return;
    if (!/^file:.*\.pdf$/i.test(details.url)) return;
    // "Open in native viewer" re-navigates to the same file: URL — the DNR
    // allow rule cannot suppress this listener, so it checks the bypass here.
    if (await isBypassedUrl(details.url, details.tabId)) return;
    const { intercept = true } = await chrome.storage.sync.get("intercept");
    if (!intercept) return;
    if (!(await chrome.extension.isAllowedFileSchemeAccess())) return;
    chrome.tabs.update(details.tabId, {
      url: `${VIEWER}?file=${encodeURIComponent(details.url)}`,
    });
  },
  { url: [{ schemes: ["file"], pathSuffix: ".pdf" }] },
);

// A session allow rule for exactly this URL in exactly this tab, removed once
// the navigation commits. applyRules() keeps ids at or above BYPASS_ONCE_BASE.
async function allowOnce(url, tabId) {
  const addRules = !/^https?:/i.test(url) || url.length > 1024 ? [] : [{
    id: BYPASS_ONCE_BASE,
    priority: 30,
    condition: { resourceTypes: ["main_frame"], tabIds: [tabId], regexFilter: `^${escapeRegex(url)}([?#].*)?$` },
    action: { type: "allow" },
  }];
  await chrome.declarativeNetRequest
    .updateSessionRules({ removeRuleIds: [BYPASS_ONCE_BASE], addRules })
    .catch((e) => console.warn("FixateScholar: failed to update the one-time bypass", e));
}

// The bypassed navigation (or anything else) committed in that tab: the
// bypass is spent, so a reload or a later open is intercepted again.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || bypassOnce?.tabId !== details.tabId) return;
  bypassOnce = null;
  chrome.declarativeNetRequest
    .updateSessionRules({ removeRuleIds: [BYPASS_ONCE_BASE] })
    .catch(() => {});
});

// "Open in native viewer": escape to the browser's native viewer, once.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "fx-bypass-once" || !msg.url) return false;
  // Security: only accept messages from this extension's own pages
  if (sender.id !== chrome.runtime.id) return false;
  if (!sender.url || !sender.url.startsWith(chrome.runtime.getURL(""))) return false;

  const cleanUrl = normalizeBypassUrl(msg.url);
  const tabId = sender.tab?.id;
  if (!cleanUrl || !/^(https?|file):/i.test(cleanUrl) || tabId === undefined) return false;

  (async () => {
    bypassOnce = { tabId, url: cleanUrl };
    await allowOnce(cleanUrl, tabId);
    await chrome.tabs.update(tabId, { url: cleanUrl });
    sendResponse({ ok: true });
  })();
  return true;
});
