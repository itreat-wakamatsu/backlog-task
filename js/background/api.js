import { getBacklogBaseUrl } from "./storage.js";
import { API_KEY_STORAGE_KEY } from "./constants.js";

export async function apiGet(apiBase, apiKey, path, params) {
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

export async function apiPostForm(apiBase, apiKey, path, params) {
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

/** APIキーの有効性をチェック（/users/myself で検証） */
export async function validateApiKey(apiKey) {
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

export async function addIssue(issueData) {
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

export function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let idx = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await mapper(items[i], i);
    }
  });

  return Promise.all(workers).then(() => results);
}
