#!/usr/bin/env node
/**
 * Chrome Web Store 用 ZIP を生成する。
 * アーカイブのルートに manifest.json が直接入る（親フォルダで包まない）。
 *
 * よくある失敗: Finder で「フォルダを右クリック → 圧縮」すると
 *   backlog-task/manifest.json のようになりストアが拒否する。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

const manifestPath = join(root, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("manifest.json が見つかりません。");
  process.exit(1);
}
try {
  JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (e) {
  console.error("manifest.json が無効な JSON です。", e.message);
  process.exit(1);
}

for (const size of [16, 32, 48, 128]) {
  const p = join(root, "images", `icon${size}.png`);
  if (!existsSync(p)) {
    console.error(`アイコンがありません: ${p}\n先に実行: npm run convert-icon`);
    process.exit(1);
  }
}

const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });
const zipPath = join(outDir, "chrome-web-store.zip");
if (existsSync(zipPath)) unlinkSync(zipPath);

const zipArgs = [
  "-r",
  "-X",
  zipPath,
  "manifest.json",
  "background.js",
  "content.js",
  "sidepanel.html",
  "js",
  "vendor",
  "images",
];

execFileSync("zip", zipArgs, { cwd: root, stdio: "inherit" });
console.log(`\n作成しました: ${zipPath}`);
console.log("アップロードするのはこの zip のみ（中身をフォルダごと再圧縮しないでください）。");
