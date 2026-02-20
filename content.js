// ページ内で選択されたテキストを、background から要求されたときに返す
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_SELECTION_TEXT") {
    const text = window.getSelection()?.toString() ?? "";
    const meta = {
      text,
      url: location.href,
      title: document.title
    };
    sendResponse({ ok: true, meta });
  }
  return true;
});

