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

// ポップアップモード検出: ウィンドウ幅が狭い場合はポップアップと判定
(function () {
  // ポップアップは通常600px以下、サイドパネルはもっと広い
  const isPopup = window.innerWidth <= 600;
  if (isPopup) {
    document.documentElement.classList.add("popup-mode");
    document.body.classList.add("popup-mode");
  }
  // リサイズ時にも更新（念のため）
  window.addEventListener("resize", () => {
    const isPopupNow = window.innerWidth <= 600;
    document.documentElement.classList.toggle("popup-mode", isPopupNow);
    document.body.classList.toggle("popup-mode", isPopupNow);
  });
})();

const CACHE_KEY = "backlogCacheV2";
const API_KEY_STORAGE_KEY = "backlogApiKey";
const BACKLOG_BASE_URL_KEY = "backlogBaseUrl";
const DRAFT_STORAGE_KEY = "draft";
const SETTINGS_KEY = "backlogSettings";
const DEFAULT_BACKLOG_BASE = "https://itreatinc.backlog.com";
const RECENT_PROJECTS_KEY = "recentProjects";
const RECENT_ASSIGNEES_KEY = "recentAssigneesByProject";
const RECENT_MENTIONS_KEY = "recentMentionsByProject"; // { [projectId]: [userId...] }

let cache = null;
let currentProjectId = null;

function normalize(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, s =>
      String.fromCharCode(s.charCodeAt(0) - 0x60)
    ); // カタカナ→ひらがな
}

function customMatcher(params, data) {
  if (!params.term) return data;

  const term = normalize(params.term);
  const target = normalize(data.searchText || data.text);

  if (target.includes(term)) return data;
  return null;
}

async function loadCache() {
  const obj = await chrome.storage.local.get([CACHE_KEY]);
  cache = obj[CACHE_KEY];
}

async function getRecentProjects() {
  const obj = await chrome.storage.local.get([RECENT_PROJECTS_KEY]);
  return obj[RECENT_PROJECTS_KEY] ?? [];
}

async function getRecentAssignees() {
  const obj = await chrome.storage.local.get([RECENT_ASSIGNEES_KEY]);
  return obj[RECENT_ASSIGNEES_KEY] ?? {};
}

async function saveRecentProject(projectId) {
  let list = await getRecentProjects();
  list = [projectId, ...list.filter(id => id !== projectId)];
  list = list.slice(0, 5);
  await chrome.storage.local.set({ [RECENT_PROJECTS_KEY]: list });
}

async function saveRecentAssignee(projectId, userId) {
  let map = await getRecentAssignees();
  let list = map[projectId] ?? [];
  list = [userId, ...list.filter(id => id !== userId)];
  list = list.slice(0, 5);
  map[projectId] = list;
  await chrome.storage.local.set({ [RECENT_ASSIGNEES_KEY]: map });
}

async function buildProjectSelect(openOnInit = true) {
  const recent = await getRecentProjects();
  const projects = cache.projects ?? [];

  const sorted = [
    ...projects.filter(p => recent.includes(String(p.id))),
    ...projects.filter(p => !recent.includes(String(p.id)))
  ];

  const data = sorted.map(p => ({
    id: p.id,
    text: `${p.name} (${p.projectKey})`,
    searchText: `${p.name} ${p.projectKey}`
  }));

  $("#project").empty().select2({
    data,
    placeholder: "プロジェクトを選択",
    allowClear: true,
    matcher: customMatcher,
    minimumResultsForSearch: 0
  });

  $("#project").on("select2:select", async (e) => {
    const projectId = String(e.params.data.id);
    currentProjectId = projectId;
    await saveRecentProject(projectId);
    await buildAssigneeSelect(projectId);
    buildMentionUsersForProject(projectId);
  });

  $("#project").on("select2:clear", () => {
    currentProjectId = null;
    resetAssigneeSelect();
  });

  // 既に登録済みなら二重登録防止
  const focusSearchInput = () => {
    const input = document.querySelector(".select2-container--open .select2-search__field");
    if (input) {
      input.focus();
      input.select?.();
    }
  };

  $("#project").off("select2:open._focus").on("select2:open._focus", () => {
    // Select2が生成した検索inputへ確実にフォーカス（requestAnimationFrameでDOM描画後に実行）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => focusSearchInput());
    });
  });

  // Chromeサイドパネル制限: パネルを開いた直後はフォーカスが移らない。
  // ユーザーがパネル内をクリックしてフォーカスを得たときに検索ボックスへフォーカスする。
  window.addEventListener("focus", () => {
    if (document.querySelector(".select2-container--open")) {
      requestAnimationFrame(() => focusSearchInput());
    }
  });

  $("#project").val(null).trigger("change");
  resetAssigneeSelect();

  if (openOnInit) {
    setTimeout(() => {
      $("#project").select2("open");
    }, 50);
  }
}

function resetAssigneeSelect() {
  if ($("#assignee").data("select2")) {
    $("#assignee").select2("destroy");
  }
  $("#assignee").empty().select2({
    data: [],
    placeholder: "プロジェクトを選択してください",
    allowClear: false,
    minimumResultsForSearch: -1
  });
  $("#assignee").prop("disabled", true);
}

async function buildAssigneeSelect(projectId) {
  const users = cache.projectUsersByProjectId?.[projectId] ?? [];
  const recentMap = await getRecentAssignees();
  const recent = recentMap[projectId] ?? [];

  const sorted = [
    ...users.filter(u => recent.includes(String(u.id))),
    ...users.filter(u => !recent.includes(String(u.id)))
  ];

  const data = sorted.map(u => ({
    id: u.id,
    text: `${u.name}`,
    searchText: `${u.name} ${u.userId ?? ""} ${u.mailAddress ?? ""}`
  }));

  if ($("#assignee").data("select2")) {
    $("#assignee").select2("destroy");
  }

  $("#assignee").empty().select2({
    data,
    placeholder: "担当者を選択",
    allowClear: true,
    matcher: customMatcher
  });
  $("#assignee").prop("disabled", false);
  $("#assignee").val(null).trigger("change");

  $("#assignee").off("select2:select._assignee").on("select2:select._assignee", async (e) => {
    const userId = String(e.params.data.id);
    await saveRecentAssignee(projectId, userId);
  });
}

async function hasApiKey() {
  const obj = await chrome.storage.local.get([API_KEY_STORAGE_KEY]);
  const key = obj[API_KEY_STORAGE_KEY];
  return typeof key === "string" && key.trim().length > 0;
}

async function loadBacklogUrlIntoForm() {
  const obj = await chrome.storage.local.get([BACKLOG_BASE_URL_KEY]);
  const baseUrl = obj[BACKLOG_BASE_URL_KEY] || "";
  const spaceIdEl = document.getElementById("backlogSpaceId");
  const domainEl = document.getElementById("backlogDomain");
  if (!baseUrl) {
    if (spaceIdEl) spaceIdEl.value = "";
    if (domainEl) domainEl.value = "backlog.com";
    return;
  }
  try {
    const u = new URL(baseUrl);
    const host = u.hostname;
    const parts = host.split(".");
    const spaceId = parts[0] || "";
    const domain = parts.slice(1).join(".") || "backlog.com";
    if (spaceIdEl) spaceIdEl.value = spaceId;
    if (domainEl) domainEl.value = ["backlog.com", "backlog.jp", "backlogtool.com"].includes(domain) ? domain : "backlog.com";
  } catch {
    if (spaceIdEl) spaceIdEl.value = "";
    if (domainEl) domainEl.value = "backlog.com";
  }
}

async function loadBacklogUrlIntoSettingsForm() {
  const obj = await chrome.storage.local.get([BACKLOG_BASE_URL_KEY]);
  const baseUrl = obj[BACKLOG_BASE_URL_KEY] || "";
  const spaceIdEl = document.getElementById("settingsBacklogSpaceId");
  const domainEl = document.getElementById("settingsBacklogDomain");
  if (!baseUrl) {
    if (spaceIdEl) spaceIdEl.value = "";
    if (domainEl) domainEl.value = "backlog.com";
    return;
  }
  try {
    const u = new URL(baseUrl);
    const host = u.hostname;
    const parts = host.split(".");
    const spaceId = parts[0] || "";
    const domain = parts.slice(1).join(".") || "backlog.com";
    if (spaceIdEl) spaceIdEl.value = spaceId;
    if (domainEl) domainEl.value = ["backlog.com", "backlog.jp", "backlogtool.com"].includes(domain) ? domain : "backlog.com";
  } catch {
    if (spaceIdEl) spaceIdEl.value = "";
    if (domainEl) domainEl.value = "backlog.com";
  }
}

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
  loadBacklogUrlIntoForm();
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

async function initMainForm() {
  await loadCache();

  if (!cache) {
    await chrome.runtime.sendMessage({ type: "SYNC_BACKLOG_NOW" });
    await loadCache();
  }

  await buildProjectSelect();

  // ツールバーボタンをタブ順から除外（プロジェクト→件名→詳細→担当者→期日→送信の順にする）
  document.querySelectorAll(".editorToolbar .tb").forEach((el) => el.setAttribute("tabindex", "-1"));

  await applyDraftToForm();
}

async function applyDraftToForm() {
  const params = new URLSearchParams(location.search);
  const fromAction = params.get("from") === "action";

  const obj = await chrome.storage.local.get([DRAFT_STORAGE_KEY]);
  const draft = obj[DRAFT_STORAGE_KEY];
  const text = fromAction ? "" : (draft?.selectedText?.trim() ?? "");

  const descEl = document.getElementById("description");
  if (descEl) {
    descEl.value = text;
    if (isPreview) renderPreview();
  }

  if (fromAction) {
    history.replaceState(null, "", location.pathname);
  }
}

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
}

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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "DRAFT_UPDATED") {
    applyDraftToForm();
  }
});

init();


const descEl = document.getElementById("description");
const previewEl = document.getElementById("preview");
const togglePreviewBtn = document.getElementById("togglePreview");
const fileInputEl = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");

let isPreview = false;
let attachedFiles = []; // Fileオブジェクトを保持（送信時にアップロード）

function getSelectionRange(el){
  return { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
}
function replaceSelection(el, text){
  const { start, end } = getSelectionRange(el);
  const before = el.value.slice(0, start);
  const selected = el.value.slice(start, end);
  const after = el.value.slice(end);
  el.value = before + text(selected) + after;

  // カーソル位置
  const newPos = (before + text(selected)).length;
  el.focus();
  el.setSelectionRange(newPos, newPos);
}

function wrap(el, left, right){
  replaceSelection(el, (selected) => {
    const s = selected || "";
    return `${left}${s}${right}`;
  });
}

function prefixLines(el, prefix){
  const { start, end } = getSelectionRange(el);
  const value = el.value;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", end);
  const actualEnd = lineEnd === -1 ? value.length : lineEnd;

  const block = value.slice(lineStart, actualEnd);
  const newBlock = block
    .split("\n")
    .map(l => (l.trim().length ? prefix + l : l))
    .join("\n");

  el.value = value.slice(0, lineStart) + newBlock + value.slice(actualEnd);
  el.focus();
}

function insertAtCursor(el, text){
  replaceSelection(el, () => text);
}

function renderPreview(){
  const md = descEl.value || "";
  // marked + DOMPurify（改行を<br>に変換、表・チェックリスト対応）
  marked.setOptions({ breaks: true });
  const html = DOMPurify.sanitize(marked.parse(md));
  previewEl.innerHTML = html;
}

togglePreviewBtn.addEventListener("click", () => {
  isPreview = !isPreview;
  if (isPreview) {
    renderPreview();
    descEl.hidden = true;
    previewEl.hidden = false;
    togglePreviewBtn.textContent = "編集";
  } else {
    descEl.hidden = false;
    previewEl.hidden = true;
    togglePreviewBtn.textContent = "プレビュー";
    descEl.focus();
  }
});

// ツールバー
document.querySelectorAll(".tb[data-md]").forEach(btn => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.md;
    switch(kind){
      case "bold": wrap(descEl, "**", "**"); break;
      case "italic": wrap(descEl, "*", "*"); break;
      case "strike": wrap(descEl, "~~", "~~"); break;

      case "ul": prefixLines(descEl, "* "); break;
      case "ol": prefixLines(descEl, "1. "); break;
      case "task": prefixLines(descEl, "- [ ] "); break;

      case "quote": prefixLines(descEl, "> "); break;
      case "code":
        insertAtCursor(descEl, "\n```\n" + (getSelectedText(descEl) || "コード") + "\n```\n");
        break;
      case "table":
        insertAtCursor(descEl,
          "\n| 見出し1 | 見出し2 |\n|---|---|\n| 値1 | 値2 |\n"
        );
        break;
      case "link":
        // 選択文字があればそれをリンクテキストに
        replaceSelection(descEl, (selected) => {
          const text = selected || "リンクテキスト";
          return `[${text}](https://example.com)`;
        });
        break;

      case "mention": insertAtCursor(descEl, "@"); break;
      case "emoji": insertAtCursor(descEl, "😊"); break;

      case "attach": fileInputEl.click(); break;
      case "help":
        // ここは将来: Markdownヘルプ表示（モーダル）など
        alert("Markdown: **太字** *斜体* ~~打ち消し~~\n* 箇条書き\n1. 番号\n> 引用\n```コード```");
        break;
    }

    if (isPreview) renderPreview();
  });
});

function getSelectedText(el){
  const { start, end } = getSelectionRange(el);
  return el.value.slice(start, end);
}

// 添付UI
function addFiles(files) {
  const arr = Array.from(files || []);
  for (const f of arr) attachedFiles.push(f);
  renderFileList();
}

const fileDropZoneEl = document.getElementById("fileDropZone");
document.getElementById("fileSelectBtn")?.addEventListener("click", () => fileInputEl.click());
fileInputEl.addEventListener("change", () => {
  addFiles(fileInputEl.files);
  fileInputEl.value = "";
});

[ "dragenter", "dragover" ].forEach((ev) => {
  fileDropZoneEl?.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileDropZoneEl.classList.add("dragover");
  });
});
fileDropZoneEl?.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (!fileDropZoneEl.contains(e.relatedTarget)) fileDropZoneEl.classList.remove("dragover");
});
fileDropZoneEl?.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  fileDropZoneEl.classList.remove("dragover");
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

document.addEventListener("paste", (e) => {
  if (!e.clipboardData?.items?.length) return;
  const files = [];
  for (const item of e.clipboardData.items) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
});

function renderFileList() {
  fileListEl.innerHTML = "";
  attachedFiles.forEach((f, idx) => {
    const div = document.createElement("div");
    div.className = "fileItem";
    div.innerHTML = `
      <span class="fileItemName" title="${escapeHtml(f.name)}">${escapeHtml(f.name)} (${Math.ceil(f.size / 1024)} KB)</span>
      <button type="button" class="fileItemRemove" data-remove="${idx}" title="削除">×</button>
    `;
    fileListEl.appendChild(div);
  });

  fileListEl.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.remove);
      attachedFiles.splice(i, 1);
      renderFileList();
    });
  });
}

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ---- mention suggest ----
const mentionMenuEl = document.getElementById("mentionMenu");

// プロジェクトごとの参加者（cacheから作る）
let mentionUsers = []; // [{id,name,userId,mailAddress, searchText}]

function buildMentionUsersForProject(projectId){
  const users = cache?.projectUsersByProjectId?.[String(projectId)] ?? [];
  mentionUsers = users.map(u => ({
    ...u,
    searchText: `${u.name ?? ""} ${u.userId ?? ""} ${u.mailAddress ?? ""}`
  }));
  console.log("[mention] users for project", projectId, mentionUsers.length);
}

// caret位置にポップアップを出すための “だいたいの座標” を取る（textarea版）
function getCaretCoordsInTextarea(textarea){
  const { left, top } = textarea.getBoundingClientRect();
  const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight) || 18;

  // 現在のカーソル位置までの文字列
  const textBefore = textarea.value.slice(0, textarea.selectionStart);
  const lines = textBefore.split("\n");
  const currentLine = lines[lines.length - 1];

  // 簡易的な幅計算（等幅前提に近い）
  const charWidth = 8; // 調整可（だいたい13pxフォントなら7〜8px）
  const x = left + 12 + currentLine.length * charWidth;
  const y = top + 16 + (lines.length - 1) * lineHeight;

  return { left: x, top: y };
}

let mentionState = {
  active: false,
  startIndex: -1,  // @ の位置
  query: "",
  items: [],
  activeIndex: 0
};

function openMentionMenu(items){
  mentionState.items = items;
  mentionState.activeIndex = 0;

  renderMentionMenu();

  const coords = getCaretCoordsInTextarea(descEl);
  mentionMenuEl.style.left = coords.left + "px";
  mentionMenuEl.style.top  = coords.top  + "px";

  mentionMenuEl.hidden = false;
}



function closeMentionMenu(){
  mentionMenuEl.hidden = true;
  mentionState.active = false;
  mentionState.startIndex = -1;
  mentionState.query = "";
  mentionState.items = [];
  mentionState.activeIndex = 0;
}

async function renderMentionMenu(){
  // プロジェクト未選択案内
  if (!currentProjectId) {
    mentionMenuEl.innerHTML = `
      <div class="mentionHeader">プロジェクトを選択してください</div>
    `;
    return;
  }

  const recentMap = await getRecentMentionsMap();
  const recentIds = (recentMap[String(currentProjectId)] ?? []).map(String);

  const recent = mentionState.items.filter(u => recentIds.includes(String(u.id)));
  const others = mentionState.items.filter(u => !recentIds.includes(String(u.id)));

  const buildRows = (arr, baseIndex) => arr.map((u, i) => {
    const idx = baseIndex + i;
    const avatarHtml = u.iconUrl
      ? `<img class="mentionAvatarImg" src="${escapeHtml(u.iconUrl)}" alt="" />`
      : `<div class="mentionAvatar">${escapeHtml(getInitial(u.name))}</div>`;
    return `
      <div class="mentionItem ${idx===mentionState.activeIndex ? "active" : ""}" data-i="${idx}">
        <div class="mentionAvatarWrap">${avatarHtml}</div>
        <div class="mentionText">
          <div class="mentionName">${escapeHtml(u.name ?? "")}</div>
          <div class="mentionSub">${escapeHtml(u.mailAddress ?? u.userId ?? "")}</div>
        </div>
      </div>
    `;
  }).join("");

  let html = "";

  let cursor = 0;
  if (mentionState.query.length === 0 && recent.length) {
    html += `<div class="mentionHeader">最近メンション</div>`;
    html += buildRows(recent, cursor);
    cursor += recent.length;
  }

  html += `<div class="mentionHeader">このプロジェクトへの参加者</div>`;
  html += buildRows(mentionState.query.length === 0 ? others : mentionState.items, cursor);

  mentionMenuEl.innerHTML = html;

  mentionMenuEl.querySelectorAll(".mentionItem").forEach(el => {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pickMention(Number(el.dataset.i));
    });
  });

  const activeEl = mentionMenuEl.querySelector(".mentionItem.active");
  if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
}


async function pickMention(i){
  const u = mentionState.items[i];
  if (!u) return;

  // 念のためプロジェクト未選択時は何もしない
  if (!currentProjectId) {
    closeMentionMenu();
    return;
  }

  const start = mentionState.startIndex;
  const cursor = descEl.selectionStart ?? 0;

  // 安全のためインデックス再検証
  if (start < 0 || start > descEl.value.length) {
    closeMentionMenu();
    return;
  }

  const before = descEl.value.slice(0, start);
  const after  = descEl.value.slice(cursor);

  // Backlog風：@名前 の形式
  const insert = `@${u.name} `;

  // 置換
  descEl.value = before + insert + after;

  // カーソル位置を挿入後へ移動
  const newPos = before.length + insert.length;
  descEl.focus();
  descEl.setSelectionRange(newPos, newPos);

  // ✅ 最近メンション保存（プロジェクト単位）
  try {
    await saveRecentMention(String(currentProjectId), String(u.id));
  } catch (e) {
    console.warn("saveRecentMention failed", e);
  }

  // メニューを閉じる
  closeMentionMenu();

  // プレビュー更新（有効時のみ）
  if (isPreview) renderPreview();
}

async function updateMention(){
  const pos = descEl.selectionStart ?? 0;
  const text = descEl.value;

  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const upto = text.slice(lineStart, pos);
  const at = upto.lastIndexOf("@");
  if (at === -1) return closeMentionMenu();

  const startIndex = lineStart + at;
  const q = text.slice(startIndex + 1, pos);
  if (q.includes(" ")) return closeMentionMenu();

  // ✅ プロジェクト未選択なら案内を出して終了（Backlog風）
  if (!currentProjectId) {
    mentionState.active = true;
    mentionState.startIndex = startIndex;
    mentionState.query = q;
    mentionState.items = [];
    mentionState.activeIndex = 0;
    openMentionMenu([]); // renderでメッセージ表示する
    return;
  }

  const term = normalize(q);

  // ✅ 最近メンション（@だけ、または入力が短いときに強く効かせる）
  const recentMap = await getRecentMentionsMap();
  const recentIds = (recentMap[String(currentProjectId)] ?? []).map(String);

  const recentUsers = mentionUsers.filter(u => recentIds.includes(String(u.id)));

  // 通常候補
  const matchedUsers = mentionUsers
    .filter(u => normalize(u.searchText).includes(term));

  // termが空（= @だけ）なら「最近→全員」、termありなら「一致のみ」
  const items = term.length === 0
    ? [
        ...recentUsers,
        ...matchedUsers.filter(u => !recentIds.includes(String(u.id)))
      ]
    : matchedUsers;

  if (!items.length) return closeMentionMenu();

  mentionState.active = true;
  mentionState.startIndex = startIndex;
  mentionState.query = q;
  mentionState.items = items;
  mentionState.activeIndex = 0;

  openMentionMenu(items);
}


descEl.addEventListener("input", () => {
  // '@' 入力やクエリ更新でサジェスト
  updateMention();
});

descEl.addEventListener("keydown", (e) => {
  if (mentionMenuEl.hidden) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    mentionState.activeIndex = Math.min(
      mentionState.activeIndex + 1,
      mentionState.items.length - 1
    );
    renderMentionMenu();
  } 
  else if (e.key === "ArrowUp") {
    e.preventDefault();
    mentionState.activeIndex = Math.max(
      mentionState.activeIndex - 1,
      0
    );
    renderMentionMenu();
  } 
  else if (e.key === "Enter" && !e.isComposing) { // ← 重要（後述）
    e.preventDefault();
    pickMention(mentionState.activeIndex);
  } 
  else if (e.key === "Escape") {
    e.preventDefault();
    closeMentionMenu();
  }
});

// クリックで閉じる
document.addEventListener("mousedown", (e) => {
  if (mentionMenuEl.hidden) return;
  if (e.target === mentionMenuEl || mentionMenuEl.contains(e.target)) return;
  closeMentionMenu();
});

function getInitial(name){
  const s = (name ?? "").trim();
  if (!s) return "?";
  // 日本語は先頭1文字、英字は頭文字
  return s[0].toUpperCase();
}

async function getRecentMentionsMap() {
  const obj = await chrome.storage.local.get([RECENT_MENTIONS_KEY]);
  return obj[RECENT_MENTIONS_KEY] ?? {};
}

async function saveRecentMention(projectId, userId) {
  const map = await getRecentMentionsMap();
  let list = map[projectId] ?? [];
  list = [userId, ...list.filter(id => String(id) !== String(userId))].slice(0, 5);
  map[projectId] = list;
  await chrome.storage.local.set({ [RECENT_MENTIONS_KEY]: map });
}

// ---- 送信 ----
async function postAttachmentToBacklog(file) {
  const obj = await chrome.storage.local.get([API_KEY_STORAGE_KEY, BACKLOG_BASE_URL_KEY]);
  const apiKey = obj[API_KEY_STORAGE_KEY];
  const baseUrl = (obj[BACKLOG_BASE_URL_KEY] || DEFAULT_BACKLOG_BASE).replace(/\/$/, "");
  if (!apiKey?.trim()) throw new Error("APIキーが設定されていません");

  const url = new URL(`${baseUrl}/api/v2/space/attachment`);
  url.searchParams.set("apiKey", apiKey.trim());
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(url.toString(), { method: "POST", body: formData });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`添付失敗 ${res.status}: ${text.slice(0, 100)}`);
  }
  const json = await res.json();
  return json.id;
}

function setTopNotification(msg, isError = false, linkUrl = null, linkText = null) {
  const el = document.getElementById("topNotification");
  if (!el) return;
  el.hidden = !msg;
  el.className = "topNotification " + (isError ? "error" : "success");
  if (msg) {
    if (linkUrl && linkText) {
      el.innerHTML = `${escapeHtml(msg)} <a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener">${escapeHtml(linkText)}</a>`;
    } else {
      el.textContent = msg;
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/** 課題の詳細から@メンションを解析し、通知対象のユーザーID一覧を返す（notifiedUserId[]用）
 * ※ name に含まれる [To:xxx] は Chatwork ID であり Backlog のユーザーIDとは無関係。
 *    Backlog のユーザーIDは API の user.id（例: 1870769）を使用する。 */
function extractMentionedUserIds(description, projectUsers) {
  if (!description || !projectUsers?.length) return [];
  const ids = new Set();
  const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const user of projectUsers) {
    const name = user.name?.trim();
    if (!name) continue;
    const regex = new RegExp(`@${escapeRegex(name)}(?=[\\s\\n]|$)`);
    if (regex.test(description)) ids.add(user.id);
  }
  return [...ids];
}

document.getElementById("submit")?.addEventListener("click", async () => {
  const projectVal = $("#project").val();
  const title = (document.getElementById("title")?.value ?? "").trim();
  const description = document.getElementById("description")?.value ?? "";
  const assigneeVal = $("#assignee").val();
  const dueVal = document.getElementById("due")?.value ?? "";

  if (!projectVal) {
    setTopNotification("プロジェクトを選択してください", true);
    return;
  }
  if (!title) {
    setTopNotification("件名を入力してください", true);
    return;
  }

  const projectId = Number(projectVal);
  const issueTypes = cache?.projectIssueTypesByProjectId?.[String(projectId)] ?? [];
  const priorities = cache?.priorities ?? [];
  const issueTypeId = issueTypes[0]?.id;
  const priorityId = priorities.find(p => p.name === "中")?.id ?? priorities[0]?.id ?? 3;

  if (!issueTypeId) {
    setTopNotification("課題種別を取得できません。プロジェクト情報を更新してください。", true);
    return;
  }

  const projectUsers = cache?.projectUsersByProjectId?.[String(projectId)] ?? [];
  const notifiedUserIds = extractMentionedUserIds(description, projectUsers);

  const submitBtn = document.getElementById("submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "送信中…";
  setTopNotification("");

  try {
    const settings = await getSettings();

    if (settings.debugDryRun) {
      // 開発用: APIを投げずリクエストを出力
      const issueData = {
        projectId,
        summary: title,
        description: description || undefined,
        issueTypeId,
        priorityId,
        assigneeId: assigneeVal ? Number(assigneeVal) : undefined,
        dueDate: dueVal || undefined,
        attachmentId: attachedFiles.length ? "(添付ファイルあり・アップロードはスキップ)" : undefined,
        notifiedUserId: notifiedUserIds.length ? notifiedUserIds : undefined
      };
      const apiParams = {
        projectId,
        summary: title,
        issueTypeId,
        priorityId,
        description: issueData.description,
        dueDate: issueData.dueDate,
        assigneeId: issueData.assigneeId,
        "attachmentId[]": attachedFiles.length ? "(スキップ)" : undefined,
        "notifiedUserId[]": notifiedUserIds.length ? notifiedUserIds : undefined
      };
      const output = {
        endpoint: "POST /api/v2/issues",
        issueData,
        apiParams: Object.fromEntries(Object.entries(apiParams).filter(([, v]) => v !== undefined))
      };
      console.log("[Backlog Quick Add] 開発モード: リクエスト出力", output);
      setTopNotification("開発モード: リクエストをコンソールに出力しました（APIは送信していません）", false);
      return;
    }

    let attachmentIds = [];
    for (const file of attachedFiles) {
      const id = await postAttachmentToBacklog(file);
      attachmentIds.push(id);
    }

    const result = await chrome.runtime.sendMessage({
      type: "ADD_ISSUE",
      issueData: {
        projectId,
        summary: title,
        description: description || undefined,
        issueTypeId,
        priorityId,
        assigneeId: assigneeVal ? Number(assigneeVal) : undefined,
        dueDate: dueVal || undefined,
        attachmentId: attachmentIds.length ? attachmentIds : undefined,
        notifiedUserId: notifiedUserIds.length ? notifiedUserIds : undefined
      }
    });

    if (!result?.ok) {
      throw new Error(result?.error ?? "送信に失敗しました");
    }

    const issue = result.issue;
    const baseUrl = cache?.baseUrl ?? (await chrome.storage.local.get([BACKLOG_BASE_URL_KEY]))[BACKLOG_BASE_URL_KEY] ?? DEFAULT_BACKLOG_BASE;
    const issueUrl = `${baseUrl.replace(/\/$/, "")}/view/${issue?.issueKey ?? ""}`;
    setTopNotification(`課題を登録しました: `, false, issueUrl, issue?.issueKey ?? "タスクを開く");

    document.getElementById("title").value = "";
    document.getElementById("description").value = "";
    $("#project").val(null).trigger("change");
    document.getElementById("due").value = "";
    attachedFiles = [];
    renderFileList();

    const settingsAfter = await getSettings();
    if (settingsAfter.openTaskAfterSubmit && issue?.issueKey) {
      if (settingsAfter.openTaskInBackground) {
        chrome.tabs.create({ url: issueUrl, active: false });
      } else {
        window.open(issueUrl, "_blank");
      }
    }
  } catch (e) {
    setTopNotification("送信エラー: " + (e?.message ?? String(e)), true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "送信";
  }
});

document.getElementById("clear")?.addEventListener("click", () => {
  document.getElementById("title").value = "";
  document.getElementById("description").value = "";
  $("#project").val(null).trigger("change");
  document.getElementById("due").value = "";
  attachedFiles = [];
  renderFileList();
  setTopNotification("");
});

// ---- 設定 ----
const DEFAULT_SETTINGS = {
  openTaskAfterSubmit: false,
  openTaskInBackground: false,
  openInNewTab: false,
  openInPopup: false,
  debugDryRun: false
};

async function getSettings() {
  const obj = await chrome.storage.local.get([SETTINGS_KEY]);
  return { ...DEFAULT_SETTINGS, ...obj[SETTINGS_KEY] };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function formatFetchedAt(ts) {
  if (!ts) return "未取得";
  const d = new Date(ts);
  return d.toLocaleString("ja-JP");
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

async function loadSettingsUI() {
  const settings = await getSettings();
  document.getElementById("openTaskAfterSubmit").checked = settings.openTaskAfterSubmit;
  document.getElementById("openTaskInBackground").checked = settings.openTaskInBackground;
  document.getElementById("openInBackgroundRow").style.opacity = settings.openTaskAfterSubmit ? "1" : "0.5";
  document.getElementById("openTaskInBackground").disabled = !settings.openTaskAfterSubmit;
  document.getElementById("openInNewTab").checked = settings.openInNewTab;
  document.getElementById("debugDryRun").checked = settings.debugDryRun;

  await loadCache();
  const fetchedAt = cache?.fetchedAt;
  document.getElementById("cacheFetchedAt").textContent =
    "最終取得: " + formatFetchedAt(fetchedAt);
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
    await loadBacklogUrlIntoSettingsForm();
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
      "最終取得: " + formatFetchedAt(cache?.fetchedAt);
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
      "最終取得: " + formatFetchedAt(cache?.fetchedAt);
  } finally {
    btn.disabled = false;
    btn.textContent = "プロジェクト情報の更新";
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

document.getElementById("openInNewTab")?.addEventListener("change", async (e) => {
  await saveSettings({ ...(await getSettings()), openInNewTab: e.target.checked });
});

document.getElementById("debugDryRun")?.addEventListener("change", async (e) => {
  await saveSettings({ ...(await getSettings()), debugDryRun: e.target.checked });
});
