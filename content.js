// ページ内で選択されたテキストを、background から要求されたときに返す

/** Google Docs 等で execCommand('copy') 経由でクリップボードからテキストを取得 */
async function captureViaClipboard() {
  // Step 1: copy イベントの clipboardData から取得を試みる
  const fromCopyEvent = await new Promise((resolve) => {
    let settled = false;
    const handler = (e) => {
      document.removeEventListener("copy", handler);
      settled = true;
      resolve(e.clipboardData?.getData("text/plain") ?? "");
    };
    document.addEventListener("copy", handler);
    try {
      document.execCommand("copy");
    } catch (_) {
      document.removeEventListener("copy", handler);
      settled = true;
      resolve("");
      return;
    }
    setTimeout(() => {
      if (!settled) {
        document.removeEventListener("copy", handler);
        resolve("");
      }
    }, 200);
  });

  if (fromCopyEvent) return fromCopyEvent;

  // Step 2: navigator.clipboard.readText() でシステムクリップボードを直接読み取る
  // (content script は clipboardRead 権限を持つため、ユーザージェスチャーなしで使用可能)
  try {
    return (await navigator.clipboard?.readText()) ?? "";
  } catch (_) {
    return "";
  }
}

async function getSelectionText() {
  let text = window.getSelection()?.toString() ?? "";

  // Google Docs: 編集領域が iframe (.docs-texteventtarget-iframe) 内にある場合のフォールバック
  if (!text && document.querySelector(".docs-texteventtarget-iframe")) {
    try {
      const iframe = document.querySelector(".docs-texteventtarget-iframe");
      if (iframe?.contentDocument) {
        text = iframe.contentDocument.getSelection()?.toString() ?? "";
      }
    } catch (_) {
      // クロスオリジン等でアクセス不可の場合は無視
    }

    // まだ取得できていない場合はクリップボード経由で試みる
    if (!text) {
      text = await captureViaClipboard();
    }
  }

  return text;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_SELECTION_TEXT") {
    getSelectionText().then((text) => {
      const meta = {
        text,
        url: location.href,
        title: document.title
      };
      sendResponse({ ok: true, meta });
    });
  }
  return true;
});
