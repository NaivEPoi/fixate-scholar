import { getSettings, setSettings } from "../viewer/settings-client.mjs";

const $ = (id) => document.getElementById(id);

const VIEWER = chrome.runtime.getURL("vendor/pdfjs/web/viewer.html");

const settings = await getSettings();
$("enabled").checked = settings.enabled;
$("intercept").checked = settings.intercept;
$("fraction").value = settings.fraction;
$("fractionOut").textContent = `${Math.round(settings.fraction * 100)}%`;
$("boldWeight").value = settings.boldWeight;
$("weightOut").textContent = settings.boldWeight;
$("emphasisMode").value = settings.emphasisMode;
$("fontMode").value = settings.fontMode;
$("fractionRow").style.display = settings.emphasisMode === "fraction" ? "" : "none";

$("enabled").addEventListener("change", (e) => setSettings({ enabled: e.target.checked }));
$("emphasisMode").addEventListener("change", (e) => {
  $("fractionRow").style.display = e.target.value === "fraction" ? "" : "none";
  setSettings({ emphasisMode: e.target.value });
});
$("fontMode").addEventListener("change", (e) => setSettings({ fontMode: e.target.value }));
$("fraction").addEventListener("input", (e) => {
  $("fractionOut").textContent = `${Math.round(e.target.value * 100)}%`;
});
$("fraction").addEventListener("change", (e) => setSettings({ fraction: Number(e.target.value) }));
$("boldWeight").addEventListener("input", (e) => {
  $("weightOut").textContent = e.target.value;
});
$("boldWeight").addEventListener("change", (e) => setSettings({ boldWeight: Number(e.target.value) }));

$("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Per-site bypass + on-demand open for the active tab.
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let origin = null;
let pdfUrl = null; // a PDF URL we could open in our viewer on demand
try {
  const tabUrl = new URL(tab?.url ?? "");
  if (tabUrl.protocol.startsWith("http")) origin = tabUrl.hostname;
  // Inside our viewer, offer bypassing the *document's* host.
  if (tabUrl.protocol === "chrome-extension:" && tabUrl.searchParams.get("file")) {
    origin = new URL(tabUrl.searchParams.get("file")).hostname;
  }
  // A native-viewer PDF tab (http(s)/file URL ending in .pdf): offer a
  // one-click open in FixateScholar, the on-demand path when interception is
  // off or the site is bypassed. We can't see the Content-Type from here, so
  // this catches extension-named PDFs; extensionless ones still use the
  // right-click "Open in FixateScholar" menu.
  if (/^(https?|file):$/.test(tabUrl.protocol) && /\.pdf($|[?#])/i.test(tabUrl.pathname + tabUrl.search)) {
    pdfUrl = tab.url;
  }
} catch {
  /* chrome:// pages etc. */
}

const bypassRow = $("bypassSite").closest(".row");
if (!origin) {
  bypassRow.style.display = "none";
} else {
  bypassRow.title = `Don't open PDFs from ${origin} in FixateScholar`;
  $("bypassSite").checked = settings.bypassOrigins.includes(origin);
  $("bypassSite").addEventListener("change", async (e) => {
    const { bypassOrigins = [] } = await getSettings();
    const next = e.target.checked
      ? [...new Set([...bypassOrigins, origin])]
      : bypassOrigins.filter((o) => o !== origin);
    setSettings({ bypassOrigins: next });
  });
}

// Master interception switch. The per-site bypass only matters while
// interception is on, so hide it (and lean on the on-demand button) when off.
function reflectIntercept(on) {
  if (origin) bypassRow.style.display = on ? "" : "none";
}
reflectIntercept(settings.intercept);
$("intercept").addEventListener("change", (e) => {
  setSettings({ intercept: e.target.checked });
  reflectIntercept(e.target.checked);
});

if (pdfUrl) {
  $("openHereRow").style.display = "";
  $("openHere").addEventListener("click", async () => {
    await chrome.tabs.update(tab.id, { url: `${VIEWER}?file=${encodeURIComponent(pdfUrl)}` });
    window.close();
  });
}
