const descEl = document.getElementById("description");
const previewEl = document.getElementById("preview");
const togglePreviewBtn = document.getElementById("togglePreview");
const fileInputEl = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");

let isPreview = false;

function getSelectionRange(el) {
  return { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
}

function replaceSelection(el, text) {
  const { start, end } = getSelectionRange(el);
  const before = el.value.slice(0, start);
  const selected = el.value.slice(start, end);
  const after = el.value.slice(end);
  el.value = before + text(selected) + after;
  const newPos = (before + text(selected)).length;
  el.focus();
  el.setSelectionRange(newPos, newPos);
}

function wrap(el, left, right) {
  replaceSelection(el, (selected) => {
    const s = selected || "";
    return `${left}${s}${right}`;
  });
}

function prefixLines(el, prefix) {
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

function insertAtCursor(el, text) {
  replaceSelection(el, () => text);
}

function renderPreview() {
  const md = descEl.value || "";
  marked.setOptions({ breaks: true });
  const html = DOMPurify.sanitize(marked.parse(md));
  previewEl.innerHTML = html;
}

function getSelectedText(el) {
  const { start, end } = getSelectionRange(el);
  return el.value.slice(start, end);
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

document.querySelectorAll(".tb[data-md]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.md;
    switch (kind) {
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
        replaceSelection(descEl, (selected) => {
          const text = selected || "リンクテキスト";
          return `[${text}](https://example.com)`;
        });
        break;
      case "mention": insertAtCursor(descEl, "@"); break;
      case "emoji": insertAtCursor(descEl, "😊"); break;
      case "attach": fileInputEl.click(); break;
      case "help":
        alert("Markdown: **太字** *斜体* ~~打ち消し~~\n* 箇条書き\n1. 番号\n> 引用\n```コード```");
        break;
    }
    if (isPreview) renderPreview();
  });
});

document.querySelectorAll(".editorToolbar .tb").forEach((el) => el.setAttribute("tabindex", "-1"));
