import { BACKLOG_BASE_URL_KEY, DEFAULT_BACKLOG_BASE, SETTINGS_KEY, SIDE_PANEL_OPEN_KEY } from "./constants.js";

export let cachedSettings = null;
export let cachedSidePanelOpen = {};

export async function getBacklogBaseUrl() {
  const obj = await chrome.storage.local.get([BACKLOG_BASE_URL_KEY]);
  const base = (obj[BACKLOG_BASE_URL_KEY] || DEFAULT_BACKLOG_BASE).replace(/\/$/, "");
  return base;
}

export function setCachedSettings(value) {
  cachedSettings = value;
}

export function setCachedSidePanelOpen(value) {
  cachedSidePanelOpen = { ...value };
}

export function updateSidePanelOpen(tabId, open) {
  if (open) {
    cachedSidePanelOpen[tabId] = true;
  } else {
    delete cachedSidePanelOpen[tabId];
  }
}

export function getCachedSettings() {
  return cachedSettings;
}

export function getCachedSidePanelOpen() {
  return cachedSidePanelOpen;
}
