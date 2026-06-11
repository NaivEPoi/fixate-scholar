import { getSettings, setSettings } from "../viewer/settings-client.mjs";

const $ = (id) => document.getElementById(id);

const settings = await getSettings();
$("enabled").checked = settings.enabled;
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

// Per-site bypass for the active tab's origin.
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let origin = null;
try {
  const tabUrl = new URL(tab?.url ?? "");
  if (tabUrl.protocol.startsWith("http")) origin = tabUrl.hostname;
  // Inside our viewer, offer bypassing the *document's* host.
  if (tabUrl.protocol === "chrome-extension:" && tabUrl.searchParams.get("file")) {
    origin = new URL(tabUrl.searchParams.get("file")).hostname;
  }
} catch {
  /* chrome:// pages etc. */
}

const bypassRow = $("bypassSite").closest(".row");
if (!origin) {
  bypassRow.style.display = "none";
} else {
  bypassRow.title = `Don't open PDFs from ${origin} in FixatePDF`;
  $("bypassSite").checked = settings.bypassOrigins.includes(origin);
  $("bypassSite").addEventListener("change", async (e) => {
    const { bypassOrigins = [] } = await getSettings();
    const next = e.target.checked
      ? [...new Set([...bypassOrigins, origin])]
      : bypassOrigins.filter((o) => o !== origin);
    setSettings({ bypassOrigins: next });
  });
}
