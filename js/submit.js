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
  const issueTypes = BQA.cache?.projectIssueTypesByProjectId?.[String(projectId)] ?? [];
  const priorities = BQA.cache?.priorities ?? [];
  const issueTypeId = issueTypes[0]?.id;
  const priorityId = priorities.find(p => p.name === "中")?.id ?? priorities[0]?.id ?? 3;

  if (!issueTypeId) {
    setTopNotification("課題種別を取得できません。プロジェクト情報を更新してください。", true);
    return;
  }

  const projectUsers = BQA.cache?.projectUsersByProjectId?.[String(projectId)] ?? [];
  const notifiedUserIds = extractMentionedUserIds(description, projectUsers);

  const submitBtn = document.getElementById("submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "送信中…";
  setTopNotification("");

  try {
    const settings = await getSettings();

    if (settings.debugDryRun) {
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
    const baseUrl = BQA.cache?.baseUrl ?? (await chrome.storage.local.get([BACKLOG_BASE_URL_KEY]))[BACKLOG_BASE_URL_KEY] ?? DEFAULT_BACKLOG_BASE;
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
