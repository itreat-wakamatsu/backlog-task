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

async function screenshotModal(id, filename, extraSetup) {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 700, deviceScaleFactor: 2 });
  const url = "file://" + join(root, "sidepanel.html");
  await page.goto(url, { waitUntil: "networkidle0" });

  // Stub chrome APIs
  await page.evaluate(() => {
    window.chrome = {
      storage: {
        local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
        sync: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
        onChanged: { addListener: () => {} },
      },
      runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => {} } },
      tabs: { create: () => {} },
      sidePanel: {},
    };
  });
  await new Promise(r => setTimeout(r, 300));

  await page.evaluate((modalId) => {
    document.querySelector("header").style.display = "none";
    document.getElementById("contentArea").style.display = "none";
    const m = document.getElementById(modalId);
    if (m) m.hidden = false;
  }, id);

  if (extraSetup) await page.evaluate(extraSetup);

  // Full height screenshot
  const card = await page.$(`.bqa-modal-card`);
  const cardBox = await card?.boundingBox();
  const totalH = cardBox ? Math.min(Math.ceil(cardBox.y + cardBox.height + 32), 1400) : 700;
  await page.setViewport({ width: 420, height: totalH, deviceScaleFactor: 2 });

  await page.screenshot({ path: join(outDir, filename), fullPage: false });
  await page.close();
}

await screenshotModal("helpModal", "modal-help.png");
await screenshotModal("feedbackModal", "modal-feedback.png");

await browser.close();
console.log("Done →", outDir);
