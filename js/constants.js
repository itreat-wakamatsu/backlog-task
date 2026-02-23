// ストレージキー・デフォルト値（サイドパネル用）
const CACHE_KEY = "backlogCacheV2";
const API_KEY_STORAGE_KEY = "backlogApiKey";
const BACKLOG_BASE_URL_KEY = "backlogBaseUrl";
const DRAFT_STORAGE_KEY = "draft";
const SETTINGS_KEY = "backlogSettings";
const DEFAULT_BACKLOG_BASE = "";
const RECENT_PROJECTS_KEY = "recentProjects";
const RECENT_ASSIGNEES_KEY = "recentAssigneesByProject";
const RECENT_MENTIONS_KEY = "recentMentionsByProject";
const URL_PROJECT_MAP_KEY = "urlProjectMap";

const DEFAULT_SETTINGS = {
  openTaskAfterSubmit: false,
  openTaskInBackground: false,
  openInNewTab: false,
  openInPopup: false,
  debugDryRun: false,
  debugAiLog: false,
  aiEnabled: false,
  /** @deprecated 互換用。openaiApiKey / geminiApiKey を利用してください */
  aiApiKey: "",
  openaiApiKey: "",
  geminiApiKey: "",
  aiProvider: "openai",
  aiModel: "gpt-4o-mini",
  aiSuggestProjectAssignee: true
};

// 複数ファイル間で共有する状態
const BQA = { cache: null, currentProjectId: null };
