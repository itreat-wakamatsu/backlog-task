let attachedFiles = [];

function addFiles(files) {
  const arr = Array.from(files || []);
  for (const f of arr) attachedFiles.push(f);
  renderFileList();
}

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

const fileDropZoneEl = document.getElementById("fileDropZone");
document.getElementById("fileSelectBtn")?.addEventListener("click", () => fileInputEl.click());
fileInputEl.addEventListener("change", () => {
  addFiles(fileInputEl.files);
  fileInputEl.value = "";
});

["dragenter", "dragover"].forEach((ev) => {
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

async function postAttachmentToBacklog(file) {
  const obj = await chrome.storage.local.get([API_KEY_STORAGE_KEY, BACKLOG_BASE_URL_KEY]);
  const apiKey = obj[API_KEY_STORAGE_KEY];
  const baseUrl = (obj[BACKLOG_BASE_URL_KEY] || DEFAULT_BACKLOG_BASE).replace(/\/$/, "");
  if (!baseUrl?.trim()) throw new Error("BacklogのURLが設定されていません");
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
