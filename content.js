// ページ内で選択されたテキストを、background から要求されたときに返す

/**
 * Google Docs は canvas ベース描画のため window.getSelection() が機能しない。
 * ユーザーが Ctrl+C などでコピーした際に copy イベントが発火するので、
 * その後クリップボードを読み取ってキャッシュする。
 */
let _googleDocsLastCopied = "";

function isGoogleDocsContext() {
  return (
    location.hostname === "docs.google.com" ||
    !!document.querySelector(".docs-texteventtarget-iframe")
  );
}

// Google Docs でユーザーがコピー操作をした際にクリップボードをキャッシュ
// copy イベントは Ctrl+C・右クリック Copy・メニューの「コピー」すべてで発火する
document.addEventListener("copy", () => {
  if (!isGoogleDocsContext()) return;
  // copy イベント直後はクリップボードが更新中のことがあるため少し待つ
  setTimeout(async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) _googleDocsLastCopied = t;
    } catch (_) {
      // clipboardRead 権限がない環境では無視
    }
  }, 80);
});

async function getSelectionText() {
  // --- 通常ページ: 標準 DOM 選択 ---
  const domSelection = window.getSelection()?.toString() ?? "";
  if (domSelection) return domSelection;

  // --- Google Docs 固有フォールバック ---
  if (!isGoogleDocsContext()) return "";

  // 1) .docs-texteventtarget-iframe の getSelection（一部環境で機能することがある）
  try {
    const iframe = document.querySelector(".docs-texteventtarget-iframe");
    if (iframe?.contentDocument) {
      const iframeSel = iframe.contentDocument.getSelection()?.toString() ?? "";
      if (iframeSel) return iframeSel;
    }
  } catch (_) {}

  // 2) copy イベントでキャッシュしたテキスト（Ctrl+C 済みの場合）
  if (_googleDocsLastCopied) return _googleDocsLastCopied;

  // 3) クリップボードを直接読み取る（content script は clipboardRead 権限を持つ）
  try {
    const clipText = await navigator.clipboard.readText();
    if (clipText) return clipText;
  } catch (_) {}

  return "";
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_SELECTION_TEXT") {
    getSelectionText().then((text) => {
      sendResponse({
        ok: true,
        meta: { text, url: location.href, title: document.title }
      });
    });
  }
  return true; // 非同期 sendResponse のためチャンネルを開いたまま
});
