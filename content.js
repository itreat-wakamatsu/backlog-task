// ページ内で選択されたテキストを、background から要求されたときに返す
function getSelectionText() {
  let text = window.getSelection()?.toString() ?? "";
  // Google Docs: 編集領域が iframe (.docs-texteventtarget-iframe) 内にある場合のフォールバック
  if (!text && document.querySelector(".docs-texteventtarget-iframe")) {
    try {
      const iframe = document.querySelector(".docs-texteventtarget-iframe");
      if (iframe?.contentDocument) {
        text = iframe.contentDocument.getSelection()?.toString() ?? "";
      }
    } catch (e) {
      // クロスオリジン等でアクセス不可の場合は無視
    }
  }
  return text;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_SELECTION_TEXT") {
    const text = getSelectionText();
    const meta = {
      text,
      url: location.href,
      title: document.title
    };
    sendResponse({ ok: true, meta });
  }
  return true;
});
