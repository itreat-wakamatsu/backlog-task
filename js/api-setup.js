function setupApiKeyChangeHandler() {
  document.getElementById("apiKeyBack")?.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("apiKeyInput").value = "";
    document.getElementById("apiKeyError").hidden = true;
    showMainForm();
    document.getElementById("headerLinks").hidden = false;
  });
}

function setupApiKeyHandlers() {
  const inputEl = document.getElementById("apiKeyInput");
  const saveBtn = document.getElementById("apiKeySave");
  const errorEl = document.getElementById("apiKeyError");
  const spaceIdEl = document.getElementById("backlogSpaceId");
  const domainEl = document.getElementById("backlogDomain");

  saveBtn.addEventListener("click", async () => {
    const spaceId = (spaceIdEl?.value ?? "").trim();
    const domain = domainEl?.value || "backlog.com";
    const key = (inputEl.value ?? "").trim();
    errorEl.hidden = true;

    if (!spaceId) {
      errorEl.textContent = "スペースIDを入力してください";
      errorEl.hidden = false;
      return;
    }
    if (!key) {
      errorEl.textContent = "APIキーを入力してください";
      errorEl.hidden = false;
      return;
    }

    const baseUrl = `https://${spaceId}.${domain}`;

    saveBtn.disabled = true;
    saveBtn.textContent = "確認中…";

    try {
      await chrome.storage.local.set({ [BACKLOG_BASE_URL_KEY]: baseUrl });
      const result = await chrome.runtime.sendMessage({ type: "VALIDATE_API_KEY", apiKey: key });
      if (!result?.ok) {
        errorEl.textContent = result?.error ?? "APIキーが無効です";
        errorEl.hidden = false;
        saveBtn.disabled = false;
        saveBtn.textContent = "保存";
        return;
      }

      saveBtn.textContent = "保存中…";
      await chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: key });
      document.getElementById("pageMeta").textContent = "APIで情報を読み込み中...";
      showMainForm();
      await chrome.runtime.sendMessage({ type: "SYNC_BACKLOG_NOW" });
      await initMainForm();
      document.getElementById("pageMeta").textContent = "タスクを入力してください";
    } catch (e) {
      errorEl.textContent = "確認に失敗しました: " + (e?.message ?? String(e));
      errorEl.hidden = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "保存";
    }
  });
}
