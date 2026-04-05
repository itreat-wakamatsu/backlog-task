function customMatcher(params, data) {
  if (!params.term) return data;
  const term = normalize(params.term);
  const target = normalize(data.searchText || data.text);
  if (target.includes(term)) return data;
  return null;
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

function resetIssueTypeSelect() {
  if ($("#issueType").data("select2")) {
    $("#issueType").select2("destroy");
  }
  $("#issueType").empty().select2({
    data: [],
    placeholder: "プロジェクトを選択してください",
    allowClear: false,
    minimumResultsForSearch: -1
  });
  $("#issueType").prop("disabled", true);
}

function resetCategorySelect() {
  if ($("#category").data("select2")) {
    $("#category").select2("destroy");
  }
  $("#category").empty().select2({
    data: [],
    placeholder: "プロジェクトを選択してください",
    allowClear: true,
    minimumResultsForSearch: -1
  });
  $("#category").prop("disabled", true);
}

function buildIssueTypeSelect(projectId) {
  const issueTypes = BQA.cache?.projectIssueTypesByProjectId?.[projectId] ?? [];
  const data = issueTypes.map(t => ({ id: t.id, text: t.name }));

  if ($("#issueType").data("select2")) {
    $("#issueType").select2("destroy");
  }

  $("#issueType").empty().select2({
    data,
    placeholder: "種別を選択",
    allowClear: false,
    minimumResultsForSearch: -1
  });
  $("#issueType").prop("disabled", false);

  // 最初の種別を自動選択
  if (data.length > 0) {
    $("#issueType").val(String(data[0].id)).trigger("change");
  } else {
    $("#issueType").val(null).trigger("change");
  }
}

function buildCategorySelect(projectId) {
  const categories = BQA.cache?.projectCategoriesByProjectId?.[projectId] ?? [];
  const data = categories.map(c => ({ id: c.id, text: c.name }));

  if ($("#category").data("select2")) {
    $("#category").select2("destroy");
  }

  $("#category").empty().select2({
    data,
    placeholder: "カテゴリを選択 (任意)",
    allowClear: true,
    minimumResultsForSearch: -1
  });
  $("#category").prop("disabled", false);
  $("#category").val(null).trigger("change");
}

async function buildProjectSelect(openOnInit = true) {
  const recent = await getRecentProjects();
  const projects = (BQA.cache?.projects ?? []);

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
    BQA.currentProjectId = projectId;
    await saveRecentProject(projectId);
    await buildAssigneeSelect(projectId);
    buildIssueTypeSelect(projectId);
    buildCategorySelect(projectId);
    buildMentionUsersForProject(projectId);
  });

  $("#project").on("select2:clear", () => {
    BQA.currentProjectId = null;
    resetAssigneeSelect();
    resetIssueTypeSelect();
    resetCategorySelect();
  });

  const focusSearchInput = () => {
    const input = document.querySelector(".select2-container--open .select2-search__field");
    if (input) {
      input.focus();
      input.select?.();
    }
  };

  $("#project").off("select2:open._focus").on("select2:open._focus", () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => focusSearchInput());
    });
  });

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

async function buildAssigneeSelect(projectId) {
  const currentAssigneeId = $("#assignee").val();
  const users = BQA.cache?.projectUsersByProjectId?.[projectId] ?? [];
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

  const keepAssignee = currentAssigneeId && users.some(u => String(u.id) === String(currentAssigneeId));

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
  $("#assignee").val(keepAssignee ? String(currentAssigneeId) : null).trigger("change");

  $("#assignee").off("select2:select._assignee").on("select2:select._assignee", async (e) => {
    const userId = String(e.params.data.id);
    await saveRecentAssignee(projectId, userId);
  });
}
