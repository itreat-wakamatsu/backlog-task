async function loadCache() {
  const obj = await chrome.storage.local.get([CACHE_KEY]);
  BQA.cache = obj[CACHE_KEY];
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

async function getUrlProjectMap() {
  const obj = await chrome.storage.local.get([URL_PROJECT_MAP_KEY]);
  return obj[URL_PROJECT_MAP_KEY] ?? {};
}

async function saveUrlProjectMap(map) {
  await chrome.storage.local.set({ [URL_PROJECT_MAP_KEY]: map });
}
