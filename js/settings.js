async function getSettings() {
  const obj = await chrome.storage.local.get([SETTINGS_KEY]);
  return { ...DEFAULT_SETTINGS, ...obj[SETTINGS_KEY] };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function formatFetchedAt(ts) {
  if (!ts) return "未取得";
  return new Date(ts).toLocaleString("ja-JP");
}

function showSettingsPanel() {
  document.body.classList.add("settings-visible");
  document.getElementById("settingsPanel").hidden = false;
  document.getElementById("headerLinks").hidden = true;
  loadSettingsUI();
}

function hideSettingsPanel() {
  document.body.classList.remove("settings-visible");
  document.getElementById("settingsPanel").hidden = true;
  document.getElementById("mainForm").hidden = false;
  document.getElementById("headerLinks").hidden = false;
  document.getElementById("pageMeta").textContent = "タスクを入力してください";
}

const AI_MODELS_BY_PROVIDER = {
  openai: [
    { value: "gpt-4o-mini", label: "gpt-4o-mini（推奨）" },
    { value: "gpt-4o", label: "gpt-4o" }
  ],
  gemini: [
    { value: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite（推奨）" },
    { value: "gemini-2.0-flash", label: "gemini-2.0-flash" },
    { value: "gemini-2.5-flash", label: "gemini-2.5-flash" }
  ]
};

function setAiModelOptions(provider) {
  const sel = document.getElementById("aiModelSelect");
  if (!sel) return;
  const opts = AI_MODELS_BY_PROVIDER[provider] || AI_MODELS_BY_PROVIDER.openai;
  const current = sel.value;
  sel.innerHTML = "";
  opts.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  });
  if (opts.some((o) => o.value === current)) sel.value = current;
  else if (opts.length) sel.value = opts[0].value;
}

/**
 * 指定プロバイダ用のAPIキーを取得（未設定時は旧 aiApiKey にフォールバック）
 */
function getAiApiKeyForProvider(settings, provider) {
  const p = (provider || "openai").toLowerCase();
  if (p === "gemini") return (settings.geminiApiKey || settings.aiApiKey || "").trim();
  return (settings.openaiApiKey || settings.aiApiKey || "").trim();
}

function updateAiApiKeyPlaceholder(provider, hasKey) {
  const input = document.getElementById("aiApiKeyInput");
  if (!input) return;
  input.placeholder = hasKey ? "設定済み" : provider === "gemini" ? "APIキーを入力" : "sk-...";
}

function updateAiApiKeyLabel(provider) {
  const labelEl = document.getElementById("aiApiKeyLabel");
  if (labelEl) labelEl.textContent = provider === "gemini" ? "APIキー（Gemini用）" : "APIキー（OpenAI用）";
}

async function loadSettingsUI() {
  const settings = await getSettings();
  document.getElementById("openTaskAfterSubmit").checked = settings.openTaskAfterSubmit;
  document.getElementById("openTaskInBackground").checked = settings.openTaskInBackground;
  document.getElementById("openInBackgroundRow").style.opacity = settings.openTaskAfterSubmit ? "1" : "0.5";
  document.getElementById("openTaskInBackground").disabled = !settings.openTaskAfterSubmit;
  document.getElementById("openInPopup").checked = settings.openInPopup;
  document.getElementById("debugDryRun").checked = settings.debugDryRun;
  document.getElementById("debugAiLog").checked = settings.debugAiLog;

  document.getElementById("aiEnabled").checked = settings.aiEnabled;
  document.getElementById("aiSuggestProjectAssignee").checked = settings.aiSuggestProjectAssignee !== false;
  const provider = settings.aiProvider || "openai";
  const providerEl = document.getElementById("aiProviderSelect");
  if (providerEl) providerEl.value = provider;
  setAiModelOptions(provider);
  const aiModelEl = document.getElementById("aiModelSelect");
  if (aiModelEl) aiModelEl.value = settings.aiModel || (provider === "gemini" ? "gemini-2.5-flash-lite" : "gpt-4o-mini");
  document.getElementById("aiApiKeyInput").value = "";
  updateAiApiKeyPlaceholder(provider, !!getAiApiKeyForProvider(settings, provider));
  updateAiApiKeyLabel(provider);
  const hintEl = document.getElementById("aiApiKeyHint");
  if (hintEl) hintEl.textContent = provider === "gemini" ? "Google AI Studio で取得した API キーを設定します。キーは拡張機能内にのみ保存され、Google の API に送信されます。" : "OpenAI の API キーを設定すると、課題の内容を自動推測できます。キーは拡張機能内にのみ保存され、OpenAI の API に送信されます。";

  await loadCache();
  const fetchedAt = BQA.cache?.fetchedAt;
  document.getElementById("cacheFetchedAt").textContent = "最終取得: " + formatFetchedAt(fetchedAt);
}

document.getElementById("settingsLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  showSettingsPanel();
});

document.getElementById("settingsBack")?.addEventListener("click", () => hideSettingsPanel());

document.getElementById("settingsApiKeyChange")?.addEventListener("click", async (e) => {
  e.preventDefault();
  const form = document.getElementById("settingsApiKeyForm");
  const isShown = !form.hidden;
  form.hidden = isShown;
  if (!isShown) {
    await loadBacklogUrlToElements("settingsBacklogSpaceId", "settingsBacklogDomain");
    document.getElementById("settingsApiKeyInput").value = "";
    document.getElementById("settingsApiKeyError").hidden = true;
  }
});

async function saveSettingsApiKey() {
  const spaceIdEl = document.getElementById("settingsBacklogSpaceId");
  const domainEl = document.getElementById("settingsBacklogDomain");
  const inputEl = document.getElementById("settingsApiKeyInput");
  const saveBtn = document.getElementById("settingsApiKeySave");
  const errorEl = document.getElementById("settingsApiKeyError");
  const form = document.getElementById("settingsApiKeyForm");
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
    await chrome.runtime.sendMessage({ type: "SYNC_BACKLOG_NOW" });
    await loadCache();
    document.getElementById("cacheFetchedAt").textContent =
      "最終取得: " + formatFetchedAt(BQA.cache?.fetchedAt);
    inputEl.value = "";
    form.hidden = true;
  } catch (e) {
    errorEl.textContent = "確認に失敗しました: " + (e?.message ?? String(e));
    errorEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "保存";
  }
}

document.getElementById("settingsApiKeySave")?.addEventListener("click", saveSettingsApiKey);

document.getElementById("settingsRefreshProjects")?.addEventListener("click", async () => {
  const btn = document.getElementById("settingsRefreshProjects");
  btn.disabled = true;
  btn.textContent = "更新中…";
  try {
    await chrome.runtime.sendMessage({ type: "SYNC_BACKLOG_NOW" });
    await loadCache();
    document.getElementById("cacheFetchedAt").textContent =
      "最終取得: " + formatFetchedAt(BQA.cache?.fetchedAt);
  } finally {
    btn.disabled = false;
    btn.textContent = "プロジェクト・担当者情報の更新";
  }
});

document.getElementById("openTaskAfterSubmit")?.addEventListener("change", async (e) => {
  const checked = e.target.checked;
  document.getElementById("openInBackgroundRow").style.opacity = checked ? "1" : "0.5";
  document.getElementById("openTaskInBackground").disabled = !checked;
  if (!checked) document.getElementById("openTaskInBackground").checked = false;
  await saveSettings({
    ...(await getSettings()),
    openTaskAfterSubmit: checked,
    openTaskInBackground: checked ? (await getSettings()).openTaskInBackground : false
  });
});

document.getElementById("openTaskInBackground")?.addEventListener("change", async (e) => {
  await saveSettings({ ...(await getSettings()), openTaskInBackground: e.target.checked });
});

document.getElementById("openInPopup")?.addEventListener("change", async (e) => {
  await saveSettings({ ...(await getSettings()), openInPopup: e.target.checked });
});

document.getElementById("debugDryRun")?.addEventListener("change", async (e) => {
  await saveSettings({ ...(await getSettings()), debugDryRun: e.target.checked });
});

document.getElementById("debugAiLog")?.addEventListener("change", async (e) => {
  await saveSettings({ ...(await getSettings()), debugAiLog: e.target.checked });
});

document.getElementById("aiEnabled")?.addEventListener("change", async (e) => {
  await saveSettings({ ...(await getSettings()), aiEnabled: e.target.checked });
});

document.getElementById("aiSuggestProjectAssignee")?.addEventListener("change", async (e) => {
  await saveSettings({ ...(await getSettings()), aiSuggestProjectAssignee: e.target.checked });
});

document.getElementById("aiProviderSelect")?.addEventListener("change", async (e) => {
  const provider = e.target.value || "openai";
  setAiModelOptions(provider);
  const defaultModel = provider === "gemini" ? "gemini-2.5-flash-lite" : "gpt-4o-mini";
  const modelEl = document.getElementById("aiModelSelect");
  if (modelEl) modelEl.value = defaultModel;
  const settings = await getSettings();
  updateAiApiKeyPlaceholder(provider, !!getAiApiKeyForProvider(settings, provider));
  updateAiApiKeyLabel(provider);
  const hintEl = document.getElementById("aiApiKeyHint");
  if (hintEl) hintEl.textContent = provider === "gemini" ? "Google AI Studio で取得した API キーを設定します。キーは拡張機能内にのみ保存され、Google の API に送信されます。" : "OpenAI の API キーを設定すると、課題の内容を自動推測できます。キーは拡張機能内にのみ保存され、OpenAI の API に送信されます。";
  await saveSettings({
    ...settings,
    aiProvider: provider,
    aiModel: defaultModel
  });
});

document.getElementById("aiModelSelect")?.addEventListener("change", async (e) => {
  await saveSettings({ ...(await getSettings()), aiModel: e.target.value || "gpt-4o-mini" });
});

document.getElementById("aiApiKeySave")?.addEventListener("click", saveAiSettings);

async function saveAiSettings() {
  const inputEl = document.getElementById("aiApiKeyInput");
  const key = (inputEl?.value ?? "").trim();
  const settings = await getSettings();
  const provider = (document.getElementById("aiProviderSelect")?.value || "openai").toLowerCase();
  const defaultModel = provider === "gemini" ? "gemini-2.5-flash-lite" : "gpt-4o-mini";
  const next = {
    ...settings,
    openaiApiKey: settings.openaiApiKey ?? "",
    geminiApiKey: settings.geminiApiKey ?? "",
    aiEnabled: document.getElementById("aiEnabled")?.checked ?? settings.aiEnabled,
    aiSuggestProjectAssignee: document.getElementById("aiSuggestProjectAssignee")?.checked !== false,
    aiProvider: provider,
    aiModel: document.getElementById("aiModelSelect")?.value || defaultModel
  };
  if (key) {
    if (provider === "gemini") next.geminiApiKey = key;
    else next.openaiApiKey = key;
  }
  await saveSettings(next);
  inputEl.value = "";
  updateAiApiKeyPlaceholder(next.aiProvider, !!getAiApiKeyForProvider(next, next.aiProvider));
}
