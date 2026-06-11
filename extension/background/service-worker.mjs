// FixatePDF background service worker: redirects PDF navigations into the
// bundled viewer using declarativeNetRequest session rules (Chrome 128+,
// responseHeaders conditions), with a webNavigation fallback for file:// and
// a context-menu fallback for anything else.

const VIEWER = chrome.runtime.getURL("vendor/pdfjs/web/viewer.html");

// Rule ids. 2xx = redirects, 3xx+ = per-origin user bypass,
// 9xx = transient bypass-once.
const RULE_REDIRECT_PDF = 201;
const RULE_REDIRECT_OCTET = 202;
const BYPASS_ORIGIN_BASE = 300;
const BYPASS_ONCE_BASE = 900;

async function registerRules() {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const staticIds = existing
    .map((r) => r.id)
    .filter((id) => id < BYPASS_ONCE_BASE);
  const rules = [
    // Top-level navigations that return a PDF — including ones served with
    // Content-Disposition: attachment. Nothing is ever saved to disk just by
    // opening a link; the viewer's toolbar download button is the explicit
    // way to save a copy.
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
  ];
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: staticIds,
    addRules: rules,
  });
}

async function bypassOriginRules() {
  const { bypassOrigins = [] } = await chrome.storage.sync.get("bypassOrigins");
  return bypassOrigins.slice(0, 100).map((origin, i) => ({
    id: BYPASS_ORIGIN_BASE + i,
    priority: 20,
    condition: {
      resourceTypes: ["main_frame"],
      requestDomains: [origin.replace(/^https?:\/\//, "").replace(/\/.*/, "")],
    },
    action: { type: "allow" },
  }));
}

chrome.runtime.onInstalled.addListener(() => {
  registerRules();
  chrome.contextMenus.create({
    id: "fx-open-link",
    title: "Open link in FixatePDF",
    contexts: ["link"],
  });
});
chrome.runtime.onStartup.addListener(registerRules);
registerRules();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.bypassOrigins) registerRules();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "fx-open-link" && info.linkUrl) {
    chrome.tabs.create({
      url: `${VIEWER}?file=${encodeURIComponent(info.linkUrl)}`,
      index: tab ? tab.index + 1 : undefined,
    });
  }
});

// file://*.pdf — DNR can't see file: responses; rewrite the navigation.
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    if (details.frameId !== 0) return;
    if (!/^file:.*\.pdf$/i.test(details.url)) return;
    if (!(await chrome.extension.isAllowedFileSchemeAccess())) return;
    chrome.tabs.update(details.tabId, {
      url: `${VIEWER}?file=${encodeURIComponent(details.url)}`,
    });
  },
  { url: [{ schemes: ["file"], pathSuffix: ".pdf" }] },
);

// "Open in native viewer": a transient allow rule for one exact URL, then
// re-navigate. The rule is removed when the navigation completes.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "fx-bypass-once" || !msg.url) return false;
  (async () => {
    const id = BYPASS_ONCE_BASE + (Date.now() % 90);
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id,
          priority: 30,
          condition: { resourceTypes: ["main_frame"], urlFilter: msg.url },
          action: { type: "allow" },
        },
      ],
    });
    const tabId = sender.tab?.id;
    if (tabId !== undefined) await chrome.tabs.update(tabId, { url: msg.url });
    setTimeout(() => {
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
    }, 30_000);
    sendResponse({ ok: true });
  })();
  return true;
});
