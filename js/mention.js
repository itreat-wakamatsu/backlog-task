const mentionMenuEl = document.getElementById("mentionMenu");
let mentionUsers = [];

function buildMentionUsersForProject(projectId) {
  const users = BQA.cache?.projectUsersByProjectId?.[String(projectId)] ?? [];
  mentionUsers = users.map(u => ({
    ...u,
    searchText: `${u.name ?? ""} ${u.userId ?? ""} ${u.mailAddress ?? ""}`
  }));
}

function getCaretCoordsInTextarea(textarea) {
  const { left, top } = textarea.getBoundingClientRect();
  const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight) || 18;
  const textBefore = textarea.value.slice(0, textarea.selectionStart);
  const lines = textBefore.split("\n");
  const charWidth = 8;
  const x = left + 12 + (lines[lines.length - 1]?.length ?? 0) * charWidth;
  const y = top + 16 + (lines.length - 1) * lineHeight;
  return { left: x, top: y };
}

let mentionState = {
  active: false,
  startIndex: -1,
  query: "",
  items: [],
  activeIndex: 0
};

function openMentionMenu(items) {
  mentionState.items = items;
  mentionState.activeIndex = 0;
  renderMentionMenu();
  const coords = getCaretCoordsInTextarea(descEl);
  mentionMenuEl.style.left = coords.left + "px";
  mentionMenuEl.style.top = coords.top + "px";
  mentionMenuEl.hidden = false;
}

function closeMentionMenu() {
  mentionMenuEl.hidden = true;
  mentionState.active = false;
  mentionState.startIndex = -1;
  mentionState.query = "";
  mentionState.items = [];
  mentionState.activeIndex = 0;
}

async function renderMentionMenu() {
  if (!BQA.currentProjectId) {
    mentionMenuEl.innerHTML = `<div class="mentionHeader">プロジェクトを選択してください</div>`;
    return;
  }

  const recentMap = await getRecentMentionsMap();
  const recentIds = (recentMap[String(BQA.currentProjectId)] ?? []).map(String);
  const recent = mentionState.items.filter(u => recentIds.includes(String(u.id)));
  const others = mentionState.items.filter(u => !recentIds.includes(String(u.id)));

  const buildRows = (arr, baseIndex) => arr.map((u, i) => {
    const idx = baseIndex + i;
    const avatarHtml = u.iconUrl
      ? `<img class="mentionAvatarImg" src="${escapeHtml(u.iconUrl)}" alt="" />`
      : `<div class="mentionAvatar">${escapeHtml(getInitial(u.name))}</div>`;
    return `
      <div class="mentionItem ${idx === mentionState.activeIndex ? "active" : ""}" data-i="${idx}">
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

function getInitial(name) {
  const s = (name ?? "").trim();
  return s ? s[0].toUpperCase() : "?";
}

async function pickMention(i) {
  const u = mentionState.items[i];
  if (!u || !BQA.currentProjectId) {
    closeMentionMenu();
    return;
  }

  const start = mentionState.startIndex;
  const cursor = descEl.selectionStart ?? 0;
  if (start < 0 || start > descEl.value.length) {
    closeMentionMenu();
    return;
  }

  const before = descEl.value.slice(0, start);
  const after = descEl.value.slice(cursor);
  const insert = `@${u.name} `;
  descEl.value = before + insert + after;
  const newPos = before.length + insert.length;
  descEl.focus();
  descEl.setSelectionRange(newPos, newPos);

  try {
    await saveRecentMention(String(BQA.currentProjectId), String(u.id));
  } catch (e) {
    console.warn("saveRecentMention failed", e);
  }
  closeMentionMenu();
  if (isPreview) renderPreview();
}

async function updateMention() {
  const pos = descEl.selectionStart ?? 0;
  const text = descEl.value;
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const upto = text.slice(lineStart, pos);
  const at = upto.lastIndexOf("@");
  if (at === -1) return closeMentionMenu();

  const startIndex = lineStart + at;
  const q = text.slice(startIndex + 1, pos);
  if (q.includes(" ")) return closeMentionMenu();

  if (!BQA.currentProjectId) {
    mentionState.active = true;
    mentionState.startIndex = startIndex;
    mentionState.query = q;
    mentionState.items = [];
    mentionState.activeIndex = 0;
    openMentionMenu([]);
    return;
  }

  const term = normalize(q);
  const recentMap = await getRecentMentionsMap();
  const recentIds = (recentMap[String(BQA.currentProjectId)] ?? []).map(String);
  const recentUsers = mentionUsers.filter(u => recentIds.includes(String(u.id)));
  const matchedUsers = mentionUsers.filter(u => normalize(u.searchText).includes(term));
  const items = term.length === 0
    ? [...recentUsers, ...matchedUsers.filter(u => !recentIds.includes(String(u.id)))]
    : matchedUsers;

  if (!items.length) return closeMentionMenu();

  mentionState.active = true;
  mentionState.startIndex = startIndex;
  mentionState.query = q;
  mentionState.items = items;
  mentionState.activeIndex = 0;
  openMentionMenu(items);
}

descEl.addEventListener("input", () => updateMention());

descEl.addEventListener("keydown", (e) => {
  if (mentionMenuEl.hidden) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    mentionState.activeIndex = Math.min(mentionState.activeIndex + 1, mentionState.items.length - 1);
    renderMentionMenu();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    mentionState.activeIndex = Math.max(mentionState.activeIndex - 1, 0);
    renderMentionMenu();
  } else if (e.key === "Enter" && !e.isComposing) {
    e.preventDefault();
    pickMention(mentionState.activeIndex);
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeMentionMenu();
  }
});

document.addEventListener("mousedown", (e) => {
  if (mentionMenuEl.hidden) return;
  if (e.target === mentionMenuEl || mentionMenuEl.contains(e.target)) return;
  closeMentionMenu();
});
