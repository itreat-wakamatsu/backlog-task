// background.js (MV3)

const DEFAULT_BACKLOG_BASE = "https://itreatinc.backlog.com";
const BACKLOG_BASE_URL_KEY = "backlogBaseUrl";
const API_KEY_STORAGE_KEY = "backlogApiKey";

async function getBacklogBaseUrl() {
  const obj = await chrome.storage.local.get([BACKLOG_BASE_URL_KEY]);
  const base = (obj[BACKLOG_BASE_URL_KEY] || DEFAULT_BACKLOG_BASE).replace(/\/$/, "");
  return base;
}

// 更新スケジュール
const SYNC_ALARM = "backlog_sync";
const SYNC_PERIOD_MINUTES = 6 * 60; // 6時間ごと（お好みで）

// 大量プロジェクト対策: 同時実行数を制限
const MAX_CONCURRENCY = 4;

// storage keys
const CACHE_KEY = "backlogCacheV2";
const SETTINGS_KEY = "backlogSettings";
const SIDE_PANEL_OPEN_KEY = "sidePanelOpen"; // { [tabId]: true }

// sidePanel.open() はユーザージェスチャーに直接応答して呼ぶ必要があるため、
// await/.then の前に同期的に呼び出す。そのためにメモリキャッシュを使用する。
let cachedSettings = null;
let cachedSidePanelOpen = {};

/** execCommand('copy') で選択をクリップボード経由で取得（Google Docs 等の canvas ベース描画に対応）。executeScript 用にインラインで定義 */
function captureSelectionViaCopyInjected() {
  return new Promise((resolve) => {
    const handler = (e) => {
      document.removeEventListener("copy", handler);
      resolve(e.clipboardData?.getData("text/plain") ?? "");
    };
    document.addEventListener("copy", handler);
    document.execCommand("copy");
    setTimeout(() => {
      document.removeEventListener("copy", handler);
      resolve("");
    }, 50);
  });
}

/** タブから選択テキストを取得。content script → executeScript → execCommand('copy') の順で試す */
async function getSelectionFromTab(tab, fallbackInfo) {
  let text = "";
  let url = tab?.url ?? "";
  let title = tab?.title ?? "";

  const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION_TEXT" }).catch(() => null);
  if (res?.meta) {
    text = res.meta.text ?? "";
    url = res.meta.url ?? url;
    title = res.meta.title ?? title;
  }
  if (!text && fallbackInfo?.selectionText) {
    text = fallbackInfo.selectionText ?? "";
  }
  if (!text && chrome.scripting) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.getSelection && window.getSelection().toString()) || "",
      allFrames: true
    }).catch(() => []);
    const found = results?.find((r) => r?.result && String(r.result).trim());
    if (found) text = String(found.result).trim();
  }
  if (!text && chrome.scripting) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: captureSelectionViaCopyInjected,
      allFrames: true
    }).catch(() => []);
    const found = results?.find((r) => r?.result && String(r.result).trim());
    if (found) text = String(found.result).trim();
  }
  return { text, url, title };
}

// ---- install / alarms ----

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  void syncBacklogData("onInstalled");
});

chrome.runtime.onStartup?.addListener(async () => {
  await ensureAlarm();
  await applyOpenInPopupSetting();
  void syncBacklogData("onStartup");
});

// キャッシュをストレージと同期（sidePanel.open を同期的に呼ぶために必要）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (SETTINGS_KEY in changes) {
    cachedSettings = changes[SETTINGS_KEY]?.newValue ?? null;
    void applyOpenInPopupSetting();
  }
  if (SIDE_PANEL_OPEN_KEY in changes) {
    cachedSidePanelOpen = { ...(changes[SIDE_PANEL_OPEN_KEY]?.newValue ?? {}) };
  }
});
void chrome.storage.local.get([SETTINGS_KEY, SIDE_PANEL_OPEN_KEY]).then((obj) => {
  cachedSettings = obj[SETTINGS_KEY] ?? null;
  cachedSidePanelOpen = { ...(obj[SIDE_PANEL_OPEN_KEY] ?? {}) };
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void syncBacklogData("alarm");
});

// UIから「今すぐ更新」したい時に使う
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SYNC_BACKLOG_NOW") {
    syncBacklogData("manual").then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ ok: false, error: String(e?.message ?? e) })
    );
    return true; // async response
  }
  if (msg?.type === "VALIDATE_API_KEY") {
    validateApiKey(msg.apiKey)
      .then((valid) => sendResponse({ ok: valid.ok, error: valid.error }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true; // async response
  }
  if (msg?.type === "ADD_ISSUE") {
    addIssue(msg.issueData)
      .then((result) => sendResponse({ ok: true, issue: result }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true; // async response
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
      cachedSidePanelOpen[tabId] = true;
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
      delete cachedSidePanelOpen[tabId];
      chrome.storage.local.get([SIDE_PANEL_OPEN_KEY]).then((obj) => {
        const sidePanelOpen = obj[SIDE_PANEL_OPEN_KEY] || {};
        delete sidePanelOpen[tabId];
        chrome.storage.local.set({ [SIDE_PANEL_OPEN_KEY]: sidePanelOpen });
      });
    }
    return false;
  }
});

// ---- core ----

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(SYNC_ALARM);
  if (!alarm) chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
}

/** APIキーの有効性をチェック（/users/myself で検証） */
async function validateApiKey(apiKey) {
  const key = (apiKey ?? "").trim();
  if (!key) return { ok: false, error: "APIキーを入力してください" };

  try {
    const apiBase = await getBacklogBaseUrl();
    await apiGet(apiBase, key, "/users/myself", {});
    return { ok: true };
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (msg.includes("401") || msg.includes("403")) {
      return { ok: false, error: "APIキーが無効です。Backlogの「個人設定」→「API」で正しいキーを確認してください。" };
    }
    return { ok: false, error: msg };
  }
}

/**
 * 1) プロジェクト一覧取得
 * 2) 各プロジェクト参加ユーザー取得
 * 3) storageへキャッシュ
 */
async function syncBacklogData(reason) {
  const startedAt = Date.now();
  console.log(`[BacklogSync] start (${reason})`);

  const obj = await chrome.storage.local.get([API_KEY_STORAGE_KEY]);
  const apiKey = obj[API_KEY_STORAGE_KEY];
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return;
  }

  const apiBase = await getBacklogBaseUrl();

  // 1) projects
  const projects = await apiGet(apiBase, apiKey.trim(), "/projects", { archived: false, all: false });

  // 2) users, issueTypes per project (concurrency limited)
  const entries = await mapWithConcurrency(projects, MAX_CONCURRENCY, async (p) => {
    const projectIdOrKey = p.id;
    const [users, issueTypes] = await Promise.all([
      apiGet(apiBase, apiKey.trim(), `/projects/${encodeURIComponent(projectIdOrKey)}/users`, {}),
      apiGet(apiBase, apiKey.trim(), `/projects/${encodeURIComponent(projectIdOrKey)}/issueTypes`, {})
    ]);
    return [String(p.id), { users, issueTypes }];
  });

  const projectUsersByProjectId = Object.fromEntries(
    entries.map(([pid, { users }]) => [pid, users])
  );
  const projectIssueTypesByProjectId = Object.fromEntries(
    entries.map(([pid, { issueTypes }]) => [pid, issueTypes ?? []])
  );

  // 3) priorities (global)
  const priorities = await apiGet(apiBase, apiKey.trim(), "/priorities", {});

  // 4) cache store
  const cache = {
    version: 1,
    baseUrl: apiBase,
    fetchedAt: Date.now(),
    projects: projects.map(p => ({
      id: p.id,
      projectKey: p.projectKey,
      name: p.name,
      archived: p.archived
    })),
    // usersは必要最低限に整形（UIが軽くなる）
    projectUsersByProjectId: Object.fromEntries(
      Object.entries(projectUsersByProjectId).map(([pid, users]) => [
        pid,
        (users ?? []).map(u => ({
          id: u.id,
          name: u.name,
          userId: u.userId,
          mailAddress: u.mailAddress,
          iconUrl: u.nulabAccount?.iconUrl
        }))
      ])
    ),
    projectIssueTypesByProjectId: Object.fromEntries(
      Object.entries(projectIssueTypesByProjectId).map(([pid, types]) => [
        pid,
        (types ?? []).map(t => ({ id: t.id, name: t.name }))
      ])
    ),
    priorities: (priorities ?? []).map(p => ({ id: p.id, name: p.name }))
  };

  await chrome.storage.local.set({ [CACHE_KEY]: cache });

  // UIへ通知（開いているパネルがあれば更新できる）
  chrome.runtime.sendMessage({ type: "BACKLOG_CACHE_UPDATED", cacheMeta: { fetchedAt: cache.fetchedAt } })
    .catch(() => {});

  console.log(`[BacklogSync] done projects=${projects.length} ms=${Date.now() - startedAt}`);
}

async function apiGet(apiBase, apiKey, path, params) {
  const url = new URL(`${apiBase}/api/v2${path}`);
  url.searchParams.set("apiKey", apiKey);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Backlog API ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  } catch (e) {
    if (e instanceof TypeError && e.message === "Failed to fetch") {
      throw new Error(`ネットワークエラー: Backlog APIへの接続に失敗しました。URL: ${url.toString()}`);
    }
    throw e;
  }
}

async function apiPostForm(apiBase, apiKey, path, params) {
  const url = new URL(`${apiBase}/api/v2${path}`);
  url.searchParams.set("apiKey", apiKey);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) body.append(k, String(item));
    } else {
      body.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backlog API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function addIssue(issueData) {
  const obj = await chrome.storage.local.get([API_KEY_STORAGE_KEY]);
  const apiKey = obj[API_KEY_STORAGE_KEY];
  if (!apiKey?.trim()) throw new Error("APIキーが設定されていません");

  const apiBase = await getBacklogBaseUrl();

  const params = {
    projectId: issueData.projectId,
    summary: issueData.summary,
    issueTypeId: issueData.issueTypeId,
    priorityId: issueData.priorityId
  };
  if (issueData.description) params.description = issueData.description;
  if (issueData.dueDate) params.dueDate = issueData.dueDate;
  if (issueData.assigneeId) params.assigneeId = issueData.assigneeId;
  if (issueData.attachmentId?.length) params["attachmentId[]"] = issueData.attachmentId;
  if (issueData.notifiedUserId?.length) params["notifiedUserId[]"] = issueData.notifiedUserId;

  return apiPostForm(apiBase, apiKey.trim(), "/issues", params);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let idx = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await mapper(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}



const MENU_ID = "backlog_quick_add";
const MENU_ID_REFRESH = "backlog_refresh_api";
const MENU_ID_OPEN_IN_POPUP = "backlog_open_in_popup";

/** 設定に応じてアイコンクリックでポップアップ or サイドパネルを開くようにする */
async function applyOpenInPopupSetting() {
  const obj = await chrome.storage.local.get([SETTINGS_KEY]);
  const settings = obj[SETTINGS_KEY] ?? {};
  cachedSettings = settings;
  const openInPopup = !!settings.openInPopup;
  
  if (openInPopup) {
    // ポップアップモード: ポップアップを設定し、サイドパネルが開かないようにする
    await chrome.action.setPopup({ popup: "sidepanel.html" });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } else {
    // サイドパネルモード: ポップアップを解除し、action.onClicked でサイドパネルを開く
    await chrome.action.setPopup({ popup: "" });
    // openPanelOnActionClick は false のまま（デフォルト）で、action.onClicked が発火する
  }
  
  // メニューのチェック状態を更新
  await updatePopupMenuChecked();
}

/** ポップパネルメニューのチェック状態を更新 */
async function updatePopupMenuChecked() {
  try {
    const obj = await chrome.storage.local.get([SETTINGS_KEY]);
    const settings = obj[SETTINGS_KEY] ?? {};
    const openInPopup = !!settings.openInPopup;
    await chrome.contextMenus.update(MENU_ID_OPEN_IN_POPUP, {
      checked: openInPopup
    });
  } catch (e) {
    // メニューがまだ作成されていない場合は無視
    console.debug("updatePopupMenuChecked: menu not found", e);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
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

  // 現在の設定を取得してチェック状態を設定
  const obj = await chrome.storage.local.get([SETTINGS_KEY]);
  const settings = obj[SETTINGS_KEY] ?? {};
  cachedSettings = settings;
  const openInPopup = !!settings.openInPopup;

  chrome.contextMenus.create({
    id: MENU_ID_OPEN_IN_POPUP,
    title: "ポップパネルで開く",
    contexts: ["action"],
    type: "checkbox",
    checked: openInPopup
  });

  await applyOpenInPopupSetting();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_ID_REFRESH) {
    void syncBacklogData("contextMenu");
    return;
  }

  if (info.menuItemId === MENU_ID_OPEN_IN_POPUP) {
    // トグル: 現在の状態を反転
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

  // sidePanel.open() はユーザージェスチャーに直接応答して呼ぶ必要があるため、
  // await/.then の前に同期的に呼ぶ。キャッシュで設定を取得。
  const settings = cachedSettings ?? {};
  const useSidePanel = !settings.openInPopup && !settings.openInNewTab;
  if (useSidePanel) {
    chrome.sidePanel.open({ tabId: tab.id }).catch((e) => {
      console.error("sidePanel.open failed", e);
    });
  }

  openSidePanelOrPopup(tab, info);
});

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

function addActionClickListener(handler) {
  // MV3
  if (chrome.action?.onClicked) {
    chrome.action.onClicked.addListener(handler);
    return;
  }
  // MV2 fallback
  if (chrome.browserAction?.onClicked) {
    chrome.browserAction.onClicked.addListener(handler);
    return;
  }
  console.error("No action API available (chrome.action / chrome.browserAction not found)");
}

// 拡張機能アイコンクリック時の処理
addActionClickListener((tab) => {
  if (!tab?.id) return;
  console.log("addActionClickListener", tab);
  // openInPopup が true のときは popup が表示されるため onClicked は呼ばれない
  // ここに来るのはサイドパネルモードのときのみ
  // 重要: sidePanel.open() はユーザージェスチャーに直接応答して呼ぶ必要があるため、
  // await の前に同期的に呼び出す。キャッシュで開閉状態を判定する。
  const isOpen = cachedSidePanelOpen[tab.id] === true;

  if (isOpen) {
    // サイドパネルが開いている場合は閉じる（open は不要なのでユーザージェスチャー不要）
    delete cachedSidePanelOpen[tab.id];
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

  // 閉じている場合は開く - 必ず await の前に同期的に呼ぶ
  chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
  cachedSidePanelOpen[tab.id] = true;
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
  console.log("openSidePanelOrPopup", tab);

  // 選択テキストを取得してドラフトを更新（Google Docs 等の iframe 内も executeScript で検索）
  getSelectionFromTab(tab).then(({ text, url, title }) => {
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

// タブが閉じられたときにサイドパネルの状態を削除
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get([SIDE_PANEL_OPEN_KEY]).then((obj) => {
    const sidePanelOpen = obj[SIDE_PANEL_OPEN_KEY] || {};
    if (sidePanelOpen[tabId]) {
      delete sidePanelOpen[tabId];
      chrome.storage.local.set({ [SIDE_PANEL_OPEN_KEY]: sidePanelOpen });
    }
  });
});

// ショートカットキー（Ctrl+Shift+B / Cmd+Shift+B）: フォーカスを維持したまま開くため Google Docs 等で選択が取得しやすい
chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== "open-task-form") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const settings = cachedSettings ?? {};
  if (settings.openInPopup) {
    const baseDraft = { selectedText: "", pageUrl: tab.url ?? "", pageTitle: tab.title ?? "", createdAt: Date.now(), openedFrom: "shortcut" };
    chrome.storage.local.set({ draft: baseDraft });
    getSelectionFromTab(tab).then(({ text, url, title }) => {
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
    const { text, url, title } = await getSelectionFromTab(tab);
    chrome.storage.local.set({
      draft: { selectedText: text ?? "", pageUrl: url ?? tab.url ?? "", pageTitle: tab.title ?? "", createdAt: Date.now(), openedFrom: "shortcut" }
    });
    chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });
    chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {});
    return;
  }

  chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
  cachedSidePanelOpen[tab.id] = true;
  chrome.storage.local.get([SIDE_PANEL_OPEN_KEY]).then((obj) => {
    const sidePanelOpen = obj[SIDE_PANEL_OPEN_KEY] || {};
    sidePanelOpen[tab.id] = true;
    chrome.storage.local.set({ [SIDE_PANEL_OPEN_KEY]: sidePanelOpen });
  });
  chrome.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel.html?from=action" }).catch(() => {});
  const baseDraft = { selectedText: "", pageUrl: tab.url ?? "", pageTitle: tab.title ?? "", createdAt: Date.now(), openedFrom: "shortcut" };
  chrome.storage.local.set({ draft: baseDraft });
  chrome.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel.html" }).catch(() => {});

  getSelectionFromTab(tab).then(({ text, url, title }) => {
    chrome.storage.local.set({ draft: { ...baseDraft, selectedText: text ?? "", pageUrl: url ?? tab.url ?? "", pageTitle: title ?? tab.title ?? "" } });
    chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {});
  });
});

// 拡張リロード時などに設定を反映
void applyOpenInPopupSetting();
