/**
 * AI自動入力: ドラフト（選択テキスト・ページURL・タイトル）をコンテキストに
 * OpenAI / Gemini API で件名・詳細・担当者・期日を推測し、フォームに自動入力する。
 */

const OPENAI_API_BASE = "https://api.openai.com/v1";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1";

async function getDraft() {
  const obj = await chrome.storage.local.get([DRAFT_STORAGE_KEY]);
  return obj[DRAFT_STORAGE_KEY] ?? null;
}

/**
 * @param {Object} draft - { selectedText, pageUrl, pageTitle }
 * @param {Array} projectList - [{ id, projectKey, name }]
 * @param {Object} assigneesByProjectId - { [projectId]: [{ id, name }] }
 * @param {boolean} inferProjectAssignee - プロジェクト・担当者を推測するか
 * @param {string} [fixedProjectId] - このページでプロジェクト固定時はその projectId（担当者のみ推測）
 */
function buildPrompt(draft, projectList, assigneesByProjectId, inferProjectAssignee, fixedProjectId) {
  const assigneeOnly = !!fixedProjectId;
  const includeProjectAssignee = assigneeOnly || (inferProjectAssignee && projectList?.length > 0);

  // 実行時点の現在日時（ユーザー環境の「今日」）をプロンプトに含める
  const now = new Date();
  const nowIso = now.toISOString(); // 例: 2026-02-24T10:23:45.123Z
  const today = nowIso.slice(0, 10); // 例: 2026-02-24

  const baseSystem = assigneeOnly
    ? `あなたはBacklogの課題作成を助けるアシスタントです。
以下のウェブページの情報と、指定プロジェクトの担当者一覧をもとに、課題の件名・詳細・担当者・期日を推測し、指定のJSON形式のみで答えてください。
プロジェクトは固定のため推測しません。projectKey は必ず空文字 "" にしてください。担当者のみ推測してください。
推測できない項目は空文字にしてください。期日は YYYY-MM-DD 形式のみ使用してください。`
    : includeProjectAssignee
      ? `あなたはBacklogの課題作成を助けるアシスタントです。
以下のウェブページの情報と、Backlogのプロジェクト・担当者一覧をもとに、課題の件名・詳細・プロジェクト・担当者・期日を推測し、指定のJSON形式のみで答えてください。
推測できない項目は空文字にしてください。
プロジェクトと担当者の両方を推測できる場合は両方含めてください。プロジェクトのみ推測できる場合も、projectKey のみ含めて構いません。
期日は YYYY-MM-DD 形式のみ使用してください。`
      : `あなたはBacklogの課題作成を助けるアシスタントです。
以下のウェブページの情報をもとに、課題の件名・詳細・期日を推測し、指定のJSON形式のみで答えてください。
プロジェクトと担当者は推測しないでください。projectKey と assigneeName は必ず空文字 "" にしてください。
推測できない項目は空文字にしてください。期日は YYYY-MM-DD 形式のみ使用してください。`;

  const system = `${baseSystem}

現在日時は ${today} (${nowIso}) です。この日付を「今日」として扱ってください。`;

  let user = `ページタイトル: ${draft.pageTitle || "(なし)"}
URL: ${draft.pageUrl || "(なし)"}
選択テキスト:
${draft.selectedText || "(なし)"}`;

  if (assigneeOnly) {
    const users = assigneesByProjectId?.[String(fixedProjectId)] ?? [];
    const names = users.map((u) => u.name).filter(Boolean);
    user += `\n\n【このプロジェクトの担当者（名前の一覧。担当者推測では名前のみを参照してください）】\n${names.length ? names.join(", ") : "(なし)"}`;
    user += `\n※ projectKey は空 "" にしてください。上記の担当者から推測できる場合のみ assigneeName を埋めてください。`;
  } else if (includeProjectAssignee) {
    user += `\n\n【Backlog プロジェクト一覧】\n${JSON.stringify(projectList.map((p) => ({ projectKey: p.projectKey, name: p.name })), null, 0)}`;

    user += `\n\n【各プロジェクトの担当者（名前の一覧。担当者推測では名前のみを参照してください）】`;
    user += `\n※ 担当者一覧に含まれる ID はバックログと連携しているチャットワークのユーザーIDです。担当者の推測時にこの ID を考慮する必要はありません。名前で判断してください。\n`;
    for (const p of projectList) {
      const users = assigneesByProjectId?.[String(p.id)] ?? [];
      const names = users.map((u) => u.name).filter(Boolean);
      if (names.length) user += `\nプロジェクト ${p.projectKey} (${p.name}): ${names.join(", ")}`;
    }
  }

  user += `

上記をもとに、次のJSON形式のみで答えてください。他の説明は不要です。配列にはせず、単一のJSONで答えてください。
{"summary":"件名（短いタイトル）","description":"課題の詳細（Markdown可）","projectKey":"プロジェクトのprojectKeyまたは空","assigneeName":"担当者名または空","dueDate":"YYYY-MM-DDまたは空"}`;

  return { system, user };
}

function findProjectIdByKey(projectKey) {
  if (!projectKey || !BQA.cache?.projects?.length) return null;
  const key = String(projectKey).trim();
  if (!key) return null;
  const normalized = (s) => String(s).toLowerCase().replace(/\s+/g, "");
  const target = normalized(key);
  for (const p of BQA.cache.projects) {
    if (normalized(p.projectKey) === target || normalized(p.name).includes(target)) return p.id;
  }
  for (const p of BQA.cache.projects) {
    if (p.projectKey === key || p.name === key) return p.id;
  }
  return null;
}

function findAssigneeIdByName(projectId, assigneeName) {
  if (!assigneeName || !projectId) return null;
  const users = BQA.cache?.projectUsersByProjectId?.[String(projectId)] ?? [];
  const name = String(assigneeName).trim();
  if (!name) return null;
  const normalized = (s) => String(s).toLowerCase().replace(/\s+/g, "");
  const target = normalized(name);
  for (const u of users) {
    if (normalized(u.name).includes(target) || target.includes(normalized(u.name))) return u.id;
  }
  for (const u of users) {
    if (u.name === name) return u.id;
  }
  return null;
}

function isValidDateString(s) {
  if (!s || typeof s !== "string") return false;
  const trimmed = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const d = new Date(trimmed);
  return !Number.isNaN(d.getTime());
}

/**
 * @param {Object} result - AI自動入力結果 { summary, description, projectKey, assigneeName, dueDate }
 * @param {boolean} applyProjectAssignee - プロジェクト・担当者をフォームに反映するか
 * @param {string} [pageUrl] - 作成元ページURL（課題の詳細の末尾に追記する用）
 * @param {string} [fixedProjectId] - プロジェクト固定時は変更しない
 */
async function applyToForm(result, applyProjectAssignee, pageUrl = "", fixedProjectId = "") {
  const descEl = document.getElementById("description");
  const titleEl = document.getElementById("title");
  const dueEl = document.getElementById("due");

  let projectId = BQA.currentProjectId;
  if (!fixedProjectId && applyProjectAssignee && result.projectKey != null && String(result.projectKey).trim()) {
    const resolvedId = findProjectIdByKey(String(result.projectKey).trim());
    if (resolvedId != null) {
      projectId = resolvedId;
      $("#project").val(projectId).trigger("change");
      BQA.currentProjectId = projectId;
      if (typeof buildAssigneeSelect === "function") await buildAssigneeSelect(projectId);
      if (typeof saveRecentProject === "function") await saveRecentProject(projectId);
      if (typeof buildMentionUsersForProject === "function") buildMentionUsersForProject(projectId);
    }
  }
  if (fixedProjectId) projectId = fixedProjectId;

  if (applyProjectAssignee && projectId && result.assigneeName != null && String(result.assigneeName).trim()) {
    const userId = findAssigneeIdByName(projectId, result.assigneeName);
    if (userId != null && $("#assignee").data("select2")) {
      $("#assignee").val(String(userId)).trigger("change");
      if (typeof saveRecentAssignee === "function") await saveRecentAssignee(projectId, String(userId));
    }
  }

  if (result.description != null && descEl) {
    let desc = String(result.description).trim();
    desc += "\n\n※ AIによる自動生成\n作成したページ：" + (pageUrl?.trim() || "(なし)");
    descEl.value = desc;
    if (typeof renderPreview === "function") renderPreview();
  }
  if (result.summary != null && titleEl) titleEl.value = String(result.summary).trim();
  if (result.dueDate != null && dueEl && isValidDateString(result.dueDate)) dueEl.value = String(result.dueDate).trim();
}

/** レスポンスから JSON 文字列を抽出する（```json ... ``` で囲まれている場合に対応） */
function extractJsonFromContent(content) {
  const s = String(content).trim();
  const codeBlock = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  return s;
}

function updateAiStatus(text, isError = false) {
  const el = document.getElementById("aiStatus");
  if (el) {
    el.textContent = text;
    el.className = "pill" + (isError ? " error" : "");
  }
}

async function callOpenAI(apiKey, model, messages) {
  const res = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" }
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    let msg = `API エラー: ${res.status}`;
    try {
      const j = JSON.parse(errBody);
      if (j.error?.message) msg = j.error.message;
    } catch (_) {}
    throw new Error(msg);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (content == null) throw new Error("AIの応答が空です");
  return content;
}

async function callGemini(apiKey, model, messages) {
  const systemMsg = messages.find((m) => m.role === "system");
  const userMsg = messages.find((m) => m.role === "user");
  const text = [systemMsg?.content, userMsg?.content].filter(Boolean).join("\n\n");

  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model || "gemini-2.5-flash-lite")}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }]
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    let msg = `API エラー: ${res.status}`;
    try {
      const j = JSON.parse(errBody);
      if (j.error?.message) msg = j.error.message;
    } catch (_) {}
    throw new Error(msg);
  }

  const data = await res.json();
  const textPart = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (textPart == null) throw new Error("AIの応答が空です");
  return textPart.trim();
}

/**
 * 設定とプロバイダから利用するAI APIキーを取得（OpenAI/Gemini 別管理、旧 aiApiKey にフォールバック）
 */
function getAiApiKey(settings) {
  const provider = (settings.aiProvider || "openai").toLowerCase();
  const key = provider === "gemini" ? (settings.geminiApiKey || settings.aiApiKey) : (settings.openaiApiKey || settings.aiApiKey);
  return (key ?? "").trim();
}

/** フォーム表示後の自動AI実行を1回だけ行ったか */
let _aiSuggestDidRunOnce = false;

/**
 * フォーム初期表示時用。AI有効かつドラフトにコンテキストがある場合に runAiSuggest を1回だけ実行する。
 * 拡張機能アイコンクリックで開いたとき（openedFrom === "action"）は自動実行しない。
 */
async function maybeRunAiSuggestOnce() {
  if (_aiSuggestDidRunOnce) return false;
  const settings = await getSettings();
  if (!settings.aiEnabled || !getAiApiKey(settings)) return false;
  const draft = await getDraft();
  if (!draft || (!draft.selectedText?.trim() && !draft.pageUrl?.trim())) return false;
  if (draft.openedFrom === "action") return false;
  _aiSuggestDidRunOnce = true;
  return runAiSuggest();
}

/**
 * AI自動入力を実行し、結果をフォームに反映する。
 * 設定が無効またはAPIキー未設定の場合は何もしない。
 * @returns {Promise<boolean>} 実行した場合 true
 */
async function runAiSuggest() {
  const settings = await getSettings();
  const apiKey = getAiApiKey(settings);
  if (!settings.aiEnabled || !apiKey) {
    updateAiStatus("AI自動入力: オフ");
    return false;
  }

  const draft = await getDraft();
  const hasContext = draft && (draft.selectedText?.trim() || draft.pageUrl?.trim());
  if (!hasContext) {
    updateAiStatus("AI自動入力: コンテキストなし");
    return false;
  }

  const objMap = await chrome.storage.local.get([URL_PROJECT_MAP_KEY]);
  const urlProjectMap = objMap[URL_PROJECT_MAP_KEY] ?? {};
  const normalizedUrl = normalizePageUrl(draft?.pageUrl ?? "");
  const fixedProjectId = normalizedUrl && urlProjectMap[normalizedUrl] ? String(urlProjectMap[normalizedUrl]) : "";

  const projectList = (BQA.cache?.projects ?? []).map((p) => ({
    id: p.id,
    projectKey: p.projectKey,
    name: p.name
  }));
  const assigneesByProjectId = BQA.cache?.projectUsersByProjectId ?? {};
  const inferProjectAssignee = settings.aiSuggestProjectAssignee !== false;

  updateAiStatus("AI自動入力: 実行中…");
  const startMs = performance.now();

  try {
    const { system, user } = buildPrompt(draft, projectList, assigneesByProjectId, inferProjectAssignee, fixedProjectId);
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
    if (settings.debugAiLog) {
      console.log("[Backlog Quick Add / AI] プロンプト", { system, user });
    }
    const provider = (settings.aiProvider || "openai").toLowerCase();
    let model = settings.aiModel || (provider === "gemini" ? "gemini-2.5-flash-lite" : "gpt-4o-mini");
    if (provider === "gemini") {
      const m = String(model);
      if (!m.startsWith("gemini") || m.includes("1.5")) model = "gemini-2.5-flash-lite";
    }
    const content =
      provider === "gemini"
        ? await callGemini(apiKey, model, messages)
        : await callOpenAI(apiKey, model, messages);

    if (settings.debugAiLog) {
      try {
        const jsonStr = extractJsonFromContent(content);
        const parsed = JSON.parse(jsonStr);
        console.log("[Backlog Quick Add / AI] レスポンス（JSON）", parsed);
      } catch (_) {
        console.log("[Backlog Quick Add / AI] レスポンス（生テキスト）", content);
      }
    }

    let result;
    try {
      const jsonStr = extractJsonFromContent(content);
      result = JSON.parse(jsonStr);
    } catch (_) {
      throw new Error("AIの応答を解析できませんでした");
    }

    await applyToForm(result, inferProjectAssignee, draft?.pageUrl ?? "", fixedProjectId);
    const elapsedSec = ((performance.now() - startMs) / 1000).toFixed(1);
    updateAiStatus(`AI自動入力: 完了 (${elapsedSec}秒)`);
    setTopNotification("AIで課題を自動入力しました。必要に応じて編集して送信してください。", false);
    return true;
  } catch (e) {
    const raw = e?.message ?? String(e);
    const msg = toUserFriendlyAiError(raw);
    updateAiStatus("AI自動入力: エラー", true);
    setTopNotification("AI自動入力エラー: " + msg, true);
    return false;
  }
}

/**
 * OpenAI 等の API エラーメッセージをユーザー向けの日本語に変換する。
 */
function toUserFriendlyAiError(rawMessage) {
  const s = String(rawMessage).toLowerCase();
  if (s.includes("quota") || s.includes("billing") || s.includes("exceeded") || s.includes("resource_exhausted")) {
    return "APIの利用枠を超えています。利用プラン・請求情報を確認してください。";
  }
  if (
    s.includes("invalid_api_key") ||
    s.includes("incorrect api key") ||
    s.includes("authentication") ||
    s.includes("api key not valid") ||
    s.includes("invalid api key")
  ) {
    return "APIキーが無効です。設定で正しいキーを入力してください。";
  }
  if (s.includes("rate limit")) {
    return "リクエストが多すぎます。しばらく待ってから再度お試しください。";
  }
  return rawMessage;
}

/**
 * 設定に応じて #aiStatus と #aiHint の初期表示を更新する。フォーム表示時に呼ぶ。
 */
async function updateAiStatusFromSettings() {
  const statusEl = document.getElementById("aiStatus");
  const hintEl = document.getElementById("aiHint");
  if (!statusEl && !hintEl) return;
  const settings = await getSettings();
  if (!settings.aiEnabled || !getAiApiKey(settings)) {
    if (statusEl) statusEl.textContent = "AI自動入力: オフ";
    if (hintEl) hintEl.textContent = "設定で「AI自動入力を有効にする」とAPIキーを保存すると、課題の件名・詳細・担当者・期日を自動入力できます。";
    return;
  }
  if (statusEl) statusEl.textContent = "AI自動入力: 利用可能";
  if (hintEl) hintEl.textContent = "選択テキストとページ情報から課題を自動入力します。「AIで自動入力」ボタンで再実行できます。";
}

document.getElementById("aiSuggestBtn")?.addEventListener("click", () => runAiSuggest());
