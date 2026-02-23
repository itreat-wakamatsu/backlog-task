/** Backlog URL をスペースID・ドメインの入力欄に反映（API設定・設定パネル共通） */
async function loadBacklogUrlToElements(spaceIdElId, domainElId) {
  const obj = await chrome.storage.local.get([BACKLOG_BASE_URL_KEY]);
  const baseUrl = obj[BACKLOG_BASE_URL_KEY] || "";
  const spaceIdEl = document.getElementById(spaceIdElId);
  const domainEl = document.getElementById(domainElId);
  if (!baseUrl) {
    if (spaceIdEl) spaceIdEl.value = "";
    if (domainEl) domainEl.value = "backlog.com";
    return;
  }
  try {
    const u = new URL(baseUrl);
    const host = u.hostname;
    const parts = host.split(".");
    const spaceId = parts[0] || "";
    const domain = parts.slice(1).join(".") || "backlog.com";
    if (spaceIdEl) spaceIdEl.value = spaceId;
    if (domainEl) domainEl.value = ["backlog.com", "backlog.jp", "backlogtool.com"].includes(domain) ? domain : "backlog.com";
  } catch {
    if (spaceIdEl) spaceIdEl.value = "";
    if (domainEl) domainEl.value = "backlog.com";
  }
}
