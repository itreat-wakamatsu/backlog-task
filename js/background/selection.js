/**
 * タブから選択テキストを取得する。
 *
 * 試行順序:
 *  1. content script (GET_SELECTION_TEXT)
 *     - 通常ページ: window.getSelection()
 *     - Google Docs: copy イベントキャッシュ → navigator.clipboard.readText()
 *  2. Chrome コンテキストメニューの info.selectionText（標準 HTML 選択がある場合に有効）
 *  3. executeScript (MAIN world) で window.getSelection() を全フレームに対して実行
 *
 * ※ Google Docs は canvas ベース描画のため DOM 選択 API が機能しない。
 *    ユーザーが Ctrl+C でコピーした内容を content script がキャッシュし、
 *    それを返す仕組みになっている。
 */
export async function getSelectionFromTab(tab, fallbackInfo) {
  let text = "";
  let url = tab?.url ?? "";
  let title = tab?.title ?? "";
  let surroundingBefore = "";
  let surroundingAfter = "";
  let documentBeginning = "";

  // Step 1: content script に問い合わせ（Google Docs 対応含む）
  const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION_TEXT" }).catch(() => null);
  if (res?.meta) {
    text = res.meta.text ?? "";
    url = res.meta.url ?? url;
    title = res.meta.title ?? title;
    surroundingBefore = res.meta.surroundingBefore ?? "";
    surroundingAfter = res.meta.surroundingAfter ?? "";
    documentBeginning = res.meta.documentBeginning ?? "";
  }

  // Step 2: Chrome コンテキストメニューの selectionText（標準 HTML テキスト選択時に有効）
  if (!text && fallbackInfo?.selectionText) {
    text = fallbackInfo.selectionText ?? "";
  }

  // Step 3: executeScript (MAIN world) で window.getSelection() を全フレームで試みる
  // MAIN world で実行することで、ページの JavaScript と同じコンテキストになる
  if (!text && chrome.scripting) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: "MAIN",
      func: () => (window.getSelection ? window.getSelection().toString() : "") || "",
    }).catch(() => []);
    const found = results?.find((r) => r?.result && String(r.result).trim());
    if (found) text = String(found.result).trim();
  }

  return { text, url, title, surroundingBefore, surroundingAfter, documentBeginning };
}
