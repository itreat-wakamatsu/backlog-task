# フィードバック機能のプロキシ設定手順

フィードバック機能は、Google Apps Script をプロキシとして使用します。
拡張機能から Apps Script の URL に POST → Apps Script が GitHub Issue を作成する仕組みです。

## 1. Google Apps Script を作成する

1. [Google Apps Script](https://script.google.com/) を開く
2. 「新しいプロジェクト」をクリック
3. プロジェクト名を「Backlog Quick Add Feedback Proxy」などに変更
4. エディタに以下のコードを貼り付ける（既存のコードは全て削除してから）:

```javascript
// GitHub の認証トークン（Issues: Read and write のみの fine-grained PAT）
// 管理者から別途共有されたトークンに置き換えてください
const GITHUB_TOKEN = "ここにGitHub PATを貼り付ける";
const GITHUB_REPO = "itreat-wakamatsu/backlog-task";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const response = UrlFetchApp.fetch(
      "https://api.github.com/repos/" + GITHUB_REPO + "/issues",
      {
        method: "post",
        headers: {
          "Authorization": "Bearer " + GITHUB_TOKEN,
          "Content-Type": "application/json",
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        payload: JSON.stringify({
          title: data.title || "(タイトルなし)",
          body: data.body || "",
          labels: [data.label || "other"],
        }),
        muteHttpExceptions: true,
      }
    );
    const ok = response.getResponseCode() === 201;
    return ContentService
      .createTextOutput(JSON.stringify({ ok: ok, status: response.getResponseCode() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

5. 保存（Ctrl+S）

## 2. ウェブアプリとしてデプロイする

1. 右上の **「デプロイ」→「新しいデプロイ」** をクリック
2. ⚙️ アイコン → **「ウェブアプリ」** を選択
3. 設定:
   - 説明: `Backlog Quick Add フィードバックプロキシ`
   - 次のユーザーとして実行: **「自分」**
   - アクセスできるユーザー: **「全員」**
4. **「デプロイ」** をクリック
5. Googleアカウントの承認を求められたら「承認」
6. 表示された **「ウェブアプリのURL」** をコピーする
   - 形式: `https://script.google.com/macros/s/AKfycb.../exec`

## 3. 拡張機能のコードにURLを設定する

`js/help.js` の先頭にある定数を更新する:

```javascript
// 変更前
const APPS_SCRIPT_URL = "";

// 変更後（実際のURLに置き換える）
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycb.../exec";
```

その後、`npm run pack:store` で ZIP を再ビルドして配布してください。

## トークンの更新について

GitHub トークンが期限切れになった場合:
1. GitHub で新しい fine-grained PAT を発行（Issues: Read and write のみ）
2. Apps Script エディタを開き、`GITHUB_TOKEN` の値を更新して保存
3. 再デプロイ（「デプロイ」→「デプロイを管理」→最新バージョンを更新）
