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

// Google Docs で右クリック（コンテキストメニュー）が発生したとき、
// ユーザーの操作を起点として execCommand("copy") を呼ぶことで
// isTrusted=true の copy イベントが発火し、選択テキストがクリップボードに入る。
// これにより手動 Ctrl+C なしでも選択テキストを取得できる。
document.addEventListener("contextmenu", () => {
  if (!isGoogleDocsContext()) return;
  try { document.execCommand("copy"); } catch (_) {}
});

/**
 * Google Docs のドキュメント本文を .kix-paragraphrenderer から取得する。
 * canvas ベース描画だが accessibility ツリーにテキストが含まれている場合がある。
 */
function extractGoogleDocsText(maxChars = 3000) {
  const paragraphs = document.querySelectorAll(".kix-paragraphrenderer");
  if (paragraphs.length > 0) {
    const text = Array.from(paragraphs)
      .map((p) => (p.textContent || "").trim())
      .filter(Boolean)
      .join("\n");
    if (text.trim()) return text.slice(0, maxChars);
  }
  return (document.body?.innerText || "").trim().slice(0, maxChars);
}

/**
 * 現在の DOM 選択の前後テキストを返す。
 * Google Docs では window.getSelection() が機能しないため空を返す。
 */
function getSelectionSurroundings(charsBefore = 500, charsAfter = 500) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { before: "", after: "" };
  try {
    const range = sel.getRangeAt(0);
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(document.body);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const before = beforeRange.toString().slice(-charsBefore);
    const afterRange = document.createRange();
    afterRange.selectNodeContents(document.body);
    afterRange.setStart(range.endContainer, range.endOffset);
    const after = afterRange.toString().slice(0, charsAfter);
    return { before, after };
  } catch (_) {
    return { before: "", after: "" };
  }
}

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

  // 2) copy イベントでキャッシュしたテキスト（Ctrl+C 済みまたは contextmenu 経由の場合）
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
    (async () => {
      const text = await getSelectionText();

      let surroundingBefore = "";
      let surroundingAfter = "";
      let documentBeginning = "";

      if (isGoogleDocsContext()) {
        // Google Docs: ドキュメント全体テキストから先頭・前後を取得
        const fullDoc = extractGoogleDocsText(10000);
        documentBeginning = fullDoc.slice(0, 1500);
        if (text) {
          const idx = fullDoc.indexOf(text);
          if (idx !== -1) {
            surroundingBefore = fullDoc.slice(Math.max(0, idx - 500), idx);
            surroundingAfter = fullDoc.slice(idx + text.length, idx + text.length + 500);
          }
        }
      } else {
        // 通常ページ: Range API で前後テキストを取得
        const surroundings = getSelectionSurroundings(500, 500);
        surroundingBefore = surroundings.before;
        surroundingAfter = surroundings.after;
        documentBeginning = (document.body?.innerText || "").trim().slice(0, 1500);
      }

      sendResponse({
        ok: true,
        meta: {
          text,
          url: location.href,
          title: document.title,
          surroundingBefore,
          surroundingAfter,
          documentBeginning
        }
      });
    })();
  }
  return true; // 非同期 sendResponse のためチャンネルを開いたまま
});
