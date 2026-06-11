import { getSettings, setSettings } from "../viewer/settings-client.mjs";

const $ = (id) => document.getElementById(id);

const settings = await getSettings();
$("enabled").checked = settings.enabled;
$("fraction").value = settings.fraction;
$("fractionOut").textContent = `${Math.round(settings.fraction * 100)}%`;
$("emphasisMode").value = settings.emphasisMode;
$("fontMode").value = settings.fontMode;
$("fractionRow").style.display = settings.emphasisMode === "fraction" ? "" : "none";
$("boldWeight").value = settings.boldWeight;
$("saccade").value = settings.saccade;
$("bypassOrigins").value = settings.bypassOrigins.join("\n");

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
$("boldWeight").addEventListener("change", (e) => setSettings({ boldWeight: Number(e.target.value) }));
$("saccade").addEventListener("change", (e) =>
  setSettings({ saccade: Math.max(1, Math.min(4, Number(e.target.value) || 1)) }),
);
$("bypassOrigins").addEventListener("change", (e) => {
  const origins = e.target.value
    .split("\n")
    .map((s) => s.trim().replace(/^https?:\/\//, "").replace(/\/.*/, ""))
    .filter(Boolean);
  setSettings({ bypassOrigins: [...new Set(origins)] });
});
