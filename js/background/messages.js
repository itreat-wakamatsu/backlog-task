import { validateApiKey, addIssue } from "./api.js";
import { syncBacklogData } from "./sync.js";
import { SIDE_PANEL_OPEN_KEY, SETTINGS_KEY } from "./constants.js";
import { updateSidePanelOpen } from "./storage.js";

export function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "SYNC_BACKLOG_NOW") {
      syncBacklogData("manual").then(
        () => sendResponse({ ok: true }),
        (e) => sendResponse({ ok: false, error: String(e?.message ?? e) })
      );
      return true;
    }
    if (msg?.type === "VALIDATE_API_KEY") {
      validateApiKey(msg.apiKey)
        .then((valid) => sendResponse({ ok: valid.ok, error: valid.error }))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
      return true;
    }
    if (msg?.type === "ADD_ISSUE") {
      addIssue(msg.issueData)
        .then((result) => sendResponse({ ok: true, issue: result }))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
      return true;
    }
    if (msg?.type === "DRAFT_OPENED_FROM_ACTION") {
      chrome.storage.local.get(["draft"]).then((obj) => {
        const draft = obj.draft ?? {};
        chrome.storage.local.set({
          draft: { ...draft, openedFrom: "action" }
        });
      });
      return false;
    }
    if (msg?.type === "SIDE_PANEL_OPENED") {
      const tabId = sender?.tab?.id;
      if (tabId) {
        updateSidePanelOpen(tabId, true);
        chrome.storage.local.get([SIDE_PANEL_OPEN_KEY]).then((obj) => {
          const sidePanelOpen = obj[SIDE_PANEL_OPEN_KEY] || {};
          sidePanelOpen[tabId] = true;
          chrome.storage.local.set({ [SIDE_PANEL_OPEN_KEY]: sidePanelOpen });
        });
      }
      return false;
    }
    if (msg?.type === "SIDE_PANEL_CLOSED") {
      const tabId = sender?.tab?.id;
      if (tabId) {
        updateSidePanelOpen(tabId, false);
        chrome.storage.local.get([SIDE_PANEL_OPEN_KEY]).then((obj) => {
          const sidePanelOpen = obj[SIDE_PANEL_OPEN_KEY] || {};
          delete sidePanelOpen[tabId];
          chrome.storage.local.set({ [SIDE_PANEL_OPEN_KEY]: sidePanelOpen });
        });
      }
      return false;
    }
  });
}
