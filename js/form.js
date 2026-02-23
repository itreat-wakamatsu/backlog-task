function showApiSetup(isEditMode = false) {
  const mainForm = document.getElementById("mainForm");
  const apiSetup = document.getElementById("apiSetup");
  apiSetup.hidden = false;
  mainForm.hidden = true;
  mainForm.classList.add("hide-until-ready");
  document.getElementById("settingsPanel").hidden = true;
  document.getElementById("topNotification").hidden = true;
  document.getElementById("pageMeta").textContent = isEditMode ? "APIキーを変更" : "APIキーを設定してください";
  const backLink = document.getElementById("apiKeyBack");
  if (backLink) backLink.hidden = !isEditMode;
  document.getElementById("apiSetupTitle").textContent = isEditMode ? "APIキー設定" : "初期設定";
  loadBacklogUrlToElements("backlogSpaceId", "backlogDomain");
}

function showMainForm() {
  const mainForm = document.getElementById("mainForm");
  const apiSetup = document.getElementById("apiSetup");
  apiSetup.hidden = true;
  document.getElementById("settingsPanel").hidden = true;
  mainForm.classList.remove("hide-until-ready");
  mainForm.hidden = false;
  document.getElementById("pageMeta").textContent = "タスクを入力してください";
  document.getElementById("headerLinks").hidden = false;
}

async function applyUrlProjectFromDraft() {
  const obj = await chrome.storage.local.get([DRAFT_STORAGE_KEY, URL_PROJECT_MAP_KEY]);
  const draft = obj[DRAFT_STORAGE_KEY];
  const urlProjectMap = obj[URL_PROJECT_MAP_KEY] ?? {};
  const normalizedUrl = normalizePageUrl(draft?.pageUrl ?? "");
  const projectId = normalizedUrl ? urlProjectMap[normalizedUrl] : null;
  if (!projectId || !BQA.cache?.projects?.length) return;
  const exists = BQA.cache.projects.some((p) => String(p.id) === String(projectId));
  if (!exists) return;
  BQA.currentProjectId = String(projectId);
  $("#project").val(projectId).trigger("change");
  if (typeof saveRecentProject === "function") await saveRecentProject(projectId);
  if (typeof buildAssigneeSelect === "function") await buildAssigneeSelect(projectId);
  if (typeof buildMentionUsersForProject === "function") buildMentionUsersForProject(projectId);
}

async function updateUseProjectCheckboxState() {
  const cb = document.getElementById("useProjectForThisPage");
  if (!cb) return;
  const projectId = $("#project").val();
  cb.disabled = !projectId;
  if (cb.disabled) {
    cb.checked = false;
    return;
  }
  const obj = await chrome.storage.local.get([DRAFT_STORAGE_KEY, URL_PROJECT_MAP_KEY]);
  const draft = obj[DRAFT_STORAGE_KEY];
  const urlProjectMap = obj[URL_PROJECT_MAP_KEY] ?? {};
  const normalizedUrl = normalizePageUrl(draft?.pageUrl ?? "");
  cb.checked = !!normalizedUrl && String(urlProjectMap[normalizedUrl]) === String(projectId);
}

function setupUseProjectCheckbox() {
  const cb = document.getElementById("useProjectForThisPage");
  if (!cb) return;
  cb.addEventListener("change", async () => {
    const obj = await chrome.storage.local.get([DRAFT_STORAGE_KEY, URL_PROJECT_MAP_KEY]);
    const draft = obj[DRAFT_STORAGE_KEY];
    const urlProjectMap = obj[URL_PROJECT_MAP_KEY] ?? {};
    const normalizedUrl = normalizePageUrl(draft?.pageUrl ?? "");
    const projectId = $("#project").val();
    if (cb.checked) {
      if (normalizedUrl && projectId) {
        urlProjectMap[normalizedUrl] = String(projectId);
        await saveUrlProjectMap(urlProjectMap);
      }
    } else {
      if (normalizedUrl && urlProjectMap[normalizedUrl] !== undefined) {
        delete urlProjectMap[normalizedUrl];
        await saveUrlProjectMap(urlProjectMap);
      }
    }
  });
  $("#project").on("change.urlProject", async () => {
    const obj = await chrome.storage.local.get([DRAFT_STORAGE_KEY, URL_PROJECT_MAP_KEY]);
    const draft = obj[DRAFT_STORAGE_KEY];
    const urlProjectMap = obj[URL_PROJECT_MAP_KEY] ?? {};
    const normalizedUrl = normalizePageUrl(draft?.pageUrl ?? "");
    const newProjectId = $("#project").val();
    const savedProjectId = normalizedUrl ? urlProjectMap[normalizedUrl] : null;
    if (savedProjectId != null && String(savedProjectId) !== String(newProjectId)) {
      cb.checked = false;
      delete urlProjectMap[normalizedUrl];
      await saveUrlProjectMap(urlProjectMap);
    }
    await updateUseProjectCheckboxState();
  });
}

async function initMainForm() {
  await loadCache();

  if (!BQA.cache) {
    await chrome.runtime.sendMessage({ type: "SYNC_BACKLOG_NOW" });
    await loadCache();
  }

  await buildProjectSelect(false);
  if (typeof updateAiStatusFromSettings === "function") await updateAiStatusFromSettings();

  await applyUrlProjectFromDraft();
  await updateUseProjectCheckboxState();
  setupUseProjectCheckbox();

  const projectId = $("#project").val();
  if (!projectId) {
    setTimeout(() => {
      $("#project").select2("open");
    }, 50);
  }

  await applyDraftToForm();
  setTimeout(async () => {
    applyDraftToForm();
    await updateUseProjectCheckboxState();
    if (typeof maybeRunAiSuggestOnce === "function") await maybeRunAiSuggestOnce();
  }, 150);
}

async function applyDraftToForm() {
  const params = new URLSearchParams(location.search);
  const fromAction = params.get("from") === "action";

  const obj = await chrome.storage.local.get([DRAFT_STORAGE_KEY]);
  const draft = obj[DRAFT_STORAGE_KEY];
  const text = draft?.selectedText?.trim() ?? "";

  const descEl = document.getElementById("description");
  if (descEl) {
    descEl.value = text;
    if (typeof renderPreview === "function") renderPreview();
  }

  if (fromAction) {
    history.replaceState(null, "", location.pathname);
  }
}

async function hasApiKey() {
  const obj = await chrome.storage.local.get([API_KEY_STORAGE_KEY]);
  const key = obj[API_KEY_STORAGE_KEY];
  return typeof key === "string" && key.trim().length > 0;
}
