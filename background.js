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
    title: "Backlogにタスク作成…（Side Panel）",
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

  // 設定を確認して、ポップパネル or サイドパネルを開く
  chrome.storage.local.get([SETTINGS_KEY]).then(async (obj) => {
    const settings = obj[SETTINGS_KEY] ?? {};
    
    // 選択テキストを取得
    const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION_TEXT" }).catch(() => null);
    const meta = res?.meta ?? {
      text: info.selectionText ?? "",
      url: tab.url ?? "",
      title: tab.title ?? ""
    };
    const draft = {
      selectedText: meta.text,
      pageUrl: meta.url,
      pageTitle: meta.title,
      createdAt: Date.now()
    };
    await chrome.storage.local.set({ draft });
    
    if (settings.openInNewTab) {
      // 新規タブで開く
      chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });
      chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {});
      return;
    }
    
    if (settings.openInPopup) {
      // ポップアップウィンドウで開く
      chrome.windows.create({
        url: chrome.runtime.getURL("sidepanel.html"),
        type: "popup",
        width: 550,
        height: 600
      }).then(() => {
        chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {});
      });
      return;
    }
    
    // サイドパネルで開く
    chrome.sidePanel.open({ tabId: tab.id }).catch((e) => {
      console.error("sidePanel.open failed", e);
    });
    chrome.runtime.sendMessage({ type: "DRAFT_UPDATED" }).catch(() => {});
  });
});

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

addActionClickListener(async (tab) => {
  if (!tab?.id) return;
  // openInPopup が true のときは popup が表示されるため onClicked は呼ばれない
  // ここに来るのはサイドパネルモードのときのみ
  
  // ユーザージェスチャーのコンテキスト内で sidePanel.open() を先に呼び出す
  // （setOptions は後で実行しても問題ない）
  chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
  
  // その後、オプションとドラフトを設定
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: "sidepanel.html?from=action"
  }).catch(console.error);

  chrome.storage.local.get([SETTINGS_KEY]).then((obj) => {
    const settings = obj[SETTINGS_KEY] ?? {};
    const emptyDraft = {
      selectedText: "",
      pageUrl: tab.url ?? "",
      pageTitle: tab.title ?? "",
      createdAt: Date.now()
    };
    
    if (settings.openInNewTab) {
      chrome.storage.local.set({ draft: emptyDraft });
      chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html?from=action") });
      return;
    }
    
    chrome.storage.local.set({ draft: emptyDraft });
    chrome.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel.html" }).catch(() => {});
  });
});

// 拡張リロード時などに設定を反映
void applyOpenInPopupSetting();
