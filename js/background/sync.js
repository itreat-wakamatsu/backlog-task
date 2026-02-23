import { getBacklogBaseUrl } from "./storage.js";
import { apiGet, mapWithConcurrency } from "./api.js";
import { API_KEY_STORAGE_KEY, CACHE_KEY, MAX_CONCURRENCY, SYNC_ALARM, SYNC_PERIOD_MINUTES } from "./constants.js";
import { applyOpenInPopupSetting } from "./ui.js";

export async function ensureAlarm() {
  const alarm = await chrome.alarms.get(SYNC_ALARM);
  if (!alarm) chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
}

/**
 * 1) プロジェクト一覧取得
 * 2) 各プロジェクト参加ユーザー取得
 * 3) storageへキャッシュ
 */
export async function syncBacklogData(reason) {
  const startedAt = Date.now();
  console.log(`[BacklogSync] start (${reason})`);

  const obj = await chrome.storage.local.get([API_KEY_STORAGE_KEY]);
  const apiKey = obj[API_KEY_STORAGE_KEY];
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return;
  }

  const apiBase = await getBacklogBaseUrl();

  const projects = await apiGet(apiBase, apiKey.trim(), "/projects", { archived: false, all: false });

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

  const priorities = await apiGet(apiBase, apiKey.trim(), "/priorities", {});

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

  chrome.runtime.sendMessage({ type: "BACKLOG_CACHE_UPDATED", cacheMeta: { fetchedAt: cache.fetchedAt } })
    .catch(() => {});

  console.log(`[BacklogSync] done projects=${projects.length} ms=${Date.now() - startedAt}`);
}
