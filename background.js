// background.js (MV3) - エントリポイント
import { SETTINGS_KEY, SIDE_PANEL_OPEN_KEY, SYNC_ALARM } from "./js/background/constants.js";
import { setCachedSettings, setCachedSidePanelOpen } from "./js/background/storage.js";
import { getSelectionFromTab } from "./js/background/selection.js";
import { ensureAlarm, syncBacklogData } from "./js/background/sync.js";
import {
  applyOpenInPopupSetting,
  setupContextMenus,
  onContextMenuClick,
  setupActionClick
} from "./js/background/ui.js";
import { setupMessageListeners } from "./js/background/messages.js";

// キャッシュをストレージと同期（sidePanel.open を同期的に呼ぶために必要）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (SETTINGS_KEY in changes) {
    setCachedSettings(changes[SETTINGS_KEY]?.newValue ?? null);
    void applyOpenInPopupSetting();
  }
  if (SIDE_PANEL_OPEN_KEY in changes) {
    setCachedSidePanelOpen(changes[SIDE_PANEL_OPEN_KEY]?.newValue ?? {});
  }
});

void chrome.storage.local.get([SETTINGS_KEY]).then((obj) => {
  setCachedSettings(obj[SETTINGS_KEY] ?? null);
});

// Validate which side panels are actually open (corrects stale storage from previous sessions)
void chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }).then((contexts) => {
  const open = {};
  for (const ctx of contexts) {
    if (ctx.tabId != null) open[ctx.tabId] = true;
  }
  setCachedSidePanelOpen(open);
  chrome.storage.local.set({ [SIDE_PANEL_OPEN_KEY]: open });
}).catch(() => {
  void chrome.storage.local.get([SIDE_PANEL_OPEN_KEY]).then((obj) => {
    setCachedSidePanelOpen(obj[SIDE_PANEL_OPEN_KEY] ?? {});
  });
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  void syncBacklogData("onInstalled");

  const obj = await chrome.storage.local.get([SETTINGS_KEY]);
  const settings = obj[SETTINGS_KEY] ?? {};
  setCachedSettings(settings);
  setupContextMenus(!!settings.openInPopup);
  await applyOpenInPopupSetting();
});

chrome.runtime.onStartup?.addListener(async () => {
  await ensureAlarm();
  await applyOpenInPopupSetting();
  void syncBacklogData("onStartup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void syncBacklogData("alarm");
});

setupMessageListeners();

chrome.contextMenus.onClicked.addListener(onContextMenuClick);

setupActionClick(getSelectionFromTab);

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get([SIDE_PANEL_OPEN_KEY]).then((obj) => {
    const sidePanelOpen = obj[SIDE_PANEL_OPEN_KEY] || {};
    if (sidePanelOpen[tabId]) {
      delete sidePanelOpen[tabId];
      chrome.storage.local.set({ [SIDE_PANEL_OPEN_KEY]: sidePanelOpen });
    }
  });
});

void applyOpenInPopupSetting();