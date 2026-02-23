/** execCommand('copy') で選択をクリップボード経由で取得（Google Docs 等の canvas ベース描画に対応）。executeScript 用にインラインで定義 */
function captureSelectionViaCopyInjected() {
  return new Promise((resolve) => {
    const handler = (e) => {
      document.removeEventListener("copy", handler);
      resolve(e.clipboardData?.getData("text/plain") ?? "");
    };
    document.addEventListener("copy", handler);
    document.execCommand("copy");
    setTimeout(() => {
      document.removeEventListener("copy", handler);
      resolve("");
    }, 50);
  });
}

/** タブから選択テキストを取得。content script → executeScript → execCommand('copy') の順で試す */
export async function getSelectionFromTab(tab, fallbackInfo) {
  let text = "";
  let url = tab?.url ?? "";
  let title = tab?.title ?? "";

  const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION_TEXT" }).catch(() => null);
  if (res?.meta) {
    text = res.meta.text ?? "";
    url = res.meta.url ?? url;
    title = res.meta.title ?? title;
  }
  if (!text && fallbackInfo?.selectionText) {
    text = fallbackInfo.selectionText ?? "";
  }
  if (!text && chrome.scripting) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => (window.getSelection && window.getSelection().toString()) || "",
    }).catch(() => []);
    const found = results?.find((r) => r?.result && String(r.result).trim());
    if (found) text = String(found.result).trim();
  }
  if (!text && chrome.scripting) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: captureSelectionViaCopyInjected,
    }).catch(() => []);
    const found = results?.find((r) => r?.result && String(r.result).trim());
    if (found) text = String(found.result).trim();
  }
  return { text, url, title };
}
