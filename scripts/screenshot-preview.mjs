import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { mkdirSync } from "fs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "docs", "ui-screenshots");
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const url = "file://" + join(root, "sidepanel.html");

function stubChrome(page) {
  return page.evaluate(() => {
    window.chrome = {
      storage: {
        local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
        sync: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
        onChanged: { addListener: () => {} },
      },
      runtime: {
        sendMessage: () => Promise.resolve(),
        onMessage: { addListener: () => {} },
        getContexts: () => Promise.resolve([]),
      },
      tabs: { create: () => {} },
      sidePanel: {},
    };
  });
}

function applyDarkMode(page) {
  return page.evaluate(() => {
    document.documentElement.classList.add("dark-mode");
  });
}

async function captureApiSetup(suffix, dark) {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 680, deviceScaleFactor: 2 });
  if (dark) await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.goto(url, { waitUntil: "networkidle0" });
  await stubChrome(page);
  if (dark) await applyDarkMode(page);
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => {
    document.getElementById("mainForm").hidden = true;
    document.getElementById("mainForm").classList.add("hide-until-ready");
    document.getElementById("apiSetup").hidden = false;
    document.getElementById("topNotification").hidden = true;
    document.getElementById("pageMeta").textContent = "APIキーを設定してください";
    document.getElementById("apiSetupTitle").textContent = "初期設定";
    const back = document.getElementById("apiKeyBack");
    if (back) back.hidden = true;
    const sid = document.getElementById("backlogSpaceId");
    if (sid) sid.placeholder = "your-space";
  });
  await page.screenshot({ path: join(outDir, `screen-api-setup${suffix}.png`) });
  await page.close();
}

async function captureMainForm(suffix, dark) {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 800, deviceScaleFactor: 2 });
  if (dark) await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.goto(url, { waitUntil: "networkidle0" });
  await stubChrome(page);
  if (dark) await applyDarkMode(page);
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => {
    document.getElementById("apiSetup").hidden = true;
    document.getElementById("topNotification").hidden = true;
    document.getElementById("pageMeta").textContent = "タスクを入力してください";
    document.getElementById("headerLinks").hidden = false;
    const mf = document.getElementById("mainForm");
    mf.hidden = false;
    mf.classList.remove("hide-until-ready");

    const title = document.getElementById("title");
    if (title) title.value = "ログイン画面のバリデーション修正";
    const desc = document.getElementById("description");
    if (desc) desc.value = "メールアドレスの形式チェックが正しく動作していないため修正が必要。\n\n選択テキスト: 「メールアドレスの入力欄でXXX@の形式でも通過してしまう」";
    document.getElementById("settingsModal").hidden = true;
    document.getElementById("helpModal").hidden = true;
    document.getElementById("feedbackModal").hidden = true;
  });
  await page.screenshot({ path: join(outDir, `screen-main-form${suffix}.png`), fullPage: true });
  await page.close();
}

async function captureModal(modalId, name, suffix, dark) {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 700, deviceScaleFactor: 2 });
  if (dark) await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.goto(url, { waitUntil: "networkidle0" });
  await stubChrome(page);
  if (dark) await applyDarkMode(page);
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate((id) => {
    document.querySelector("header").style.display = "none";
    document.getElementById("contentArea").style.display = "none";
    document.getElementById(id).hidden = false;
  }, modalId);
  const card = await page.$(".bqa-modal-card");
  const box = await card?.boundingBox();
  const h = box ? Math.min(Math.ceil(box.y + box.height + 32), 1400) : 700;
  await page.setViewport({ width: 420, height: h, deviceScaleFactor: 2 });
  await page.screenshot({ path: join(outDir, `screen-modal-${name}${suffix}.png`) });
  await page.close();
}

for (const dark of [false, true]) {
  const suffix = dark ? "-dark" : "";
  await captureApiSetup(suffix, dark);
  await captureMainForm(suffix, dark);
  await captureModal("settingsModal", "settings", suffix, dark);
  await captureModal("helpModal", "help", suffix, dark);
}

await browser.close();
console.log("Done →", outDir);
