// ダークモード検出（CSP対応のため外部JSで実行）
(function () {
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.classList.add("dark-mode");
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    document.documentElement.classList.toggle("dark-mode", e.matches);
  });
})();

// 初回表示時、APIキー確認前にタスクフォームを確実に非表示に
(function () {
  const mainForm = document.getElementById("mainForm");
  if (mainForm) {
    mainForm.hidden = true;
    mainForm.classList.add("hide-until-ready");
  }
})();

// ポップアップモード検出
(function () {
  const params = new URLSearchParams(location.search);
  const fromActionUrl = params.get("from") === "action";
  const isPopupParam = params.get("popup") === "true";
  const isSidePanel = fromActionUrl;

  let isPopup = false;
  if (isSidePanel) {
    document.documentElement.classList.remove("popup-mode");
    document.body.classList.remove("popup-mode");
    isPopup = false;
  } else if (isPopupParam) {
    isPopup = true;
  } else {
    isPopup = window.innerWidth <= 600;
  }

  if (isPopup) {
    document.documentElement.classList.add("popup-mode");
    document.body.classList.add("popup-mode");
  }

  if (fromActionUrl || isPopup) {
    chrome.runtime.sendMessage({ type: "DRAFT_OPENED_FROM_ACTION" }).catch(() => {});
  }

  window.addEventListener("resize", () => {
    if (isSidePanel) {
      document.documentElement.classList.remove("popup-mode");
      document.body.classList.remove("popup-mode");
      return;
    }
    const isPopupNow = isPopupParam || window.innerWidth <= 600;
    document.documentElement.classList.toggle("popup-mode", isPopupNow);
    document.body.classList.toggle("popup-mode", isPopupNow);
  });
})();

async function init() {
  setupApiKeyHandlers();

  const apiKeySet = await hasApiKey();
  if (!apiKeySet) {
    showApiSetup();
    return;
  }

  showMainForm();
  await initMainForm();
  document.getElementById("headerLinks").hidden = false;
  setupApiKeyChangeHandler();

  chrome.runtime.sendMessage({ type: "SIDE_PANEL_OPENED" }).catch(() => {});

  // パネル新規ロード時: initMainForm() 完了後に contextMenu ドラフトを確認。
  // DRAFT_UPDATED / storage.onChanged を見逃した場合（ドラフトがパネルロード前に書き込まれた場合）のフォールバック。
  (async () => {
    const obj = await chrome.storage.local.get([DRAFT_STORAGE_KEY]);
    const draft = obj[DRAFT_STORAGE_KEY];
    const isRecent = draft?.createdAt && (Date.now() - draft.createdAt < 30000);
    if (draft?.openedFrom === "contextMenu" && isRecent) {
      // URL プロジェクト適用（initMainForm 時点では古いドラフトを読んでいた可能性があるため再適用）
      if (typeof applyUrlProjectFromDraft === "function") await applyUrlProjectFromDraft();
      if (typeof updateUseProjectCheckboxState === "function") await updateUseProjectCheckboxState();
      maybeRunAiSuggestForContextMenu();
    }
  })();

  window.addEventListener("beforeunload", () => {
    chrome.runtime.sendMessage({ type: "SIDE_PANEL_CLOSED" }).catch(() => {});
  });
}

/** ドラフト更新時の共通処理: フォーム反映・URLプロジェクト適用・AI自動実行 */
async function handleDraftUpdate(draft) {
  await applyDraftToForm();
  if (typeof applyUrlProjectFromDraft === "function") await applyUrlProjectFromDraft();
  if (typeof updateUseProjectCheckboxState === "function") await updateUseProjectCheckboxState();
  if (draft?.openedFrom === "contextMenu") {
    maybeRunAiSuggestForContextMenu();
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "DRAFT_UPDATED") {
    chrome.storage.local.get([DRAFT_STORAGE_KEY]).then((obj) => {
      handleDraftUpdate(obj[DRAFT_STORAGE_KEY]);
    });
  }
});

// DRAFT_UPDATED メッセージを見逃した場合（パネルが新規ロード中だったとき）のフォールバック。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[DRAFT_STORAGE_KEY]) return;
  const draft = changes[DRAFT_STORAGE_KEY].newValue;
  if (draft?.openedFrom === "contextMenu") {
    handleDraftUpdate(draft);
  }
});

init();
