import { getSelectionFromTab } from "./selection.js";
import {
  getCachedSettings,
  setCachedSettings,
  getCachedSidePanelOpen,
  updateSidePanelOpen
} from "./storage.js";
import { SETTINGS_KEY, SIDE_PANEL_OPEN_KEY, MENU_ID, MENU_ID_REFRESH, MENU_ID_OPEN_IN_POPUP } from "./constants.js";
import { syncBacklogData } from "./sync.js";

/** 設定に応じてアイコンクリックでポップアップ or サイドパネルを開くようにする */
export async function applyOpenInPopupSetting() {
  const obj = await chrome.storage.local.get([SETTINGS_KEY]);
  const settings = obj[SETTINGS_KEY] ?? {};
  setCachedSettings(settings);
  const openInPopup = !!settings.openInPopup;

  if (openInPopup) {
    await chrome.action.setPopup({ popup: "sidepanel.html" });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } else {
    await chrome.action.setPopup({ popup: "" });
  }

  await updatePopupMenuChecked();
}

async function updatePopupMenuChecked() {
  try {
    const obj = await chrome.storage.local.get([SETTINGS_KEY]);
    const settings = obj[SETTINGS_KEY] ?? {};
    const openInPopup = !!settings.openInPopup;
    await chrome.contextMenus.update(MENU_ID_OPEN_IN_POPUP, { checked: openInPopup });
  } catch (e) {
    console.debug("updatePopupMenuChecked: menu not found", e);
  }
}

function openSidePanelOrPopup(tab, info) {
  chrome.storage.local.get([SETTINGS_KEY]).then(async (obj) => {
    const settings = obj[SETTINGS_KEY] ?? {};

    const { text, url, title } = await getSelectionFromTab(tab, info);
    const draft = {
      selectedText: text,
      pageUrl: url,
      pageTitle: title,
      createdAt: Date.now(),
      openedFrom: "contextMenu"
    };
    await chrome.storage.local.set({ draft });

    if (settings.openInNewTab) {
      chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });
      chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {});
      return;
    }

    if (settings.openInPopup) {
      chrome.windows.create({
        url: chrome.runtime.getURL("sidepanel.html?popup=true"),
        type: "popup",
        width: 550,
        height: 600
      }).then(() => chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {}));
      return;
    }

    chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {});
  });
}

export function addActionClickListener(handler) {
  if (chrome.action?.onClicked) {
    chrome.action.onClicked.addListener(handler);
    return;
  }
  if (chrome.browserAction?.onClicked) {
    chrome.browserAction.onClicked.addListener(handler);
    return;
  }
  console.error("No action API available (chrome.action / chrome.browserAction not found)");
}

export function setupContextMenus(openInPopup = false) {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Backlogにタスク作成…",
    contexts: ["page", "selection"]
  });

  chrome.contextMenus.create({
    id: MENU_ID_REFRESH,
    title: "APIで情報を再取得",
    contexts: ["action"]
  });

  chrome.contextMenus.create({
    id: MENU_ID_OPEN_IN_POPUP,
    title: "ポップパネルで開く",
    contexts: ["action"],
    type: "checkbox",
    checked: openInPopup
  });
}

export function getContextMenuHandlers() {
  return {
    openSidePanelOrPopup,
    updatePopupMenuChecked
  };
}

export async function onContextMenuClick(info, tab) {
  if (info.menuItemId === MENU_ID_REFRESH) {
    void syncBacklogData("contextMenu");
    return;
  }

  if (info.menuItemId === MENU_ID_OPEN_IN_POPUP) {
    const obj = await chrome.storage.local.get([SETTINGS_KEY]);
    const settings = obj[SETTINGS_KEY] ?? {};
    const newOpenInPopup = !settings.openInPopup;
    await chrome.storage.local.set({
      [SETTINGS_KEY]: { ...settings, openInPopup: newOpenInPopup }
    });
    await applyOpenInPopupSetting();
    return;
  }

  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  const settings = getCachedSettings() ?? {};
  const useSidePanel = !settings.openInPopup && !settings.openInNewTab;
  if (useSidePanel) {
    chrome.sidePanel.open({ tabId: tab.id }).catch((e) => console.error("sidePanel.open failed", e));
  }

  openSidePanelOrPopup(tab, info);
}

export function setupActionClick(getSelectionFromTabRef) {
  addActionClickListener((tab) => {
    if (!tab?.id) return;

    const isOpen = getCachedSidePanelOpen()[tab.id] === true;

    if (isOpen) {
      updateSidePanelOpen(tab.id, false);
      chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false }).catch(() => {});
      chrome.storage.local.get([SIDE_PANEL_OPEN_KEY]).then((obj) => {
        const sidePanelOpen = obj[SIDE_PANEL_OPEN_KEY] || {};
        delete sidePanelOpen[tab.id];
        chrome.storage.local.set({ [SIDE_PANEL_OPEN_KEY]: sidePanelOpen });
      });
      setTimeout(() => {
        chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true, path: "sidepanel.html" }).catch(() => {});
      }, 100);
      return;
    }

    chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
    updateSidePanelOpen(tab.id, true);
    chrome.storage.local.get([SIDE_PANEL_OPEN_KEY]).then((obj) => {
      const sidePanelOpen = obj[SIDE_PANEL_OPEN_KEY] || {};
      sidePanelOpen[tab.id] = true;
      chrome.storage.local.set({ [SIDE_PANEL_OPEN_KEY]: sidePanelOpen });
    });

    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "sidepanel.html?from=action"
    }).catch(console.error);

    const baseDraft = {
      selectedText: "",
      pageUrl: tab.url ?? "",
      pageTitle: tab.title ?? "",
      createdAt: Date.now(),
      openedFrom: "action"
    };
    chrome.storage.local.set({ draft: baseDraft });
    chrome.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel.html" }).catch(() => {});

    getSelectionFromTabRef(tab).then(({ text, url, title }) => {
      const draft = {
        ...baseDraft,
        selectedText: text ?? "",
        pageUrl: url ?? tab.url ?? "",
        pageTitle: title ?? tab.title ?? ""
      };
      chrome.storage.local.set({ draft });
      chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {});
    });
  });
}

export function setupCommands(getSelectionFromTabRef) {
  chrome.commands?.onCommand?.addListener(async (command) => {
    if (command !== "open-task-form") return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const settings = getCachedSettings() ?? {};
    if (settings.openInPopup) {
      const baseDraft = { selectedText: "", pageUrl: tab.url ?? "", pageTitle: tab.title ?? "", createdAt: Date.now(), openedFrom: "shortcut" };
      chrome.storage.local.set({ draft: baseDraft });
      getSelectionFromTabRef(tab).then(({ text, url, title }) => {
        chrome.storage.local.set({
          draft: { ...baseDraft, selectedText: text ?? "", pageUrl: url ?? tab.url ?? "", pageTitle: title ?? tab.title ?? "" }
        });
        chrome.windows.create({
          url: chrome.runtime.getURL("sidepanel.html?popup=true"),
          type: "popup",
          width: 550,
          height: 600
        }).then(() => chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {}));
      });
      return;
    }
    if (settings.openInNewTab) {
      const { text, url, title } = await getSelectionFromTabRef(tab);
      chrome.storage.local.set({
        draft: { selectedText: text ?? "", pageUrl: url ?? tab.url ?? "", pageTitle: title ?? tab.title ?? "", createdAt: Date.now(), openedFrom: "shortcut" }
      });
      chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });
      chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {});
      return;
    }

    chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
    updateSidePanelOpen(tab.id, true);
    chrome.storage.local.get([SIDE_PANEL_OPEN_KEY]).then((obj) => {
      const sidePanelOpen = obj[SIDE_PANEL_OPEN_KEY] || {};
      sidePanelOpen[tab.id] = true;
      chrome.storage.local.set({ [SIDE_PANEL_OPEN_KEY]: sidePanelOpen });
    });
    chrome.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel.html?from=action" }).catch(() => {});
    const baseDraft = { selectedText: "", pageUrl: tab.url ?? "", pageTitle: tab.title ?? "", createdAt: Date.now(), openedFrom: "shortcut" };
    chrome.storage.local.set({ draft: baseDraft });
    chrome.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel.html" }).catch(() => {});

    getSelectionFromTabRef(tab).then(({ text, url, title }) => {
      chrome.storage.local.set({ draft: { ...baseDraft, selectedText: text ?? "", pageUrl: url ?? tab.url ?? "", pageTitle: title ?? tab.title ?? "" } });
      chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {});
    });
  });
}
