/**
 * Playwright fixtures for Chrome Extension E2E testing.
 * @see https://playwright.dev/docs/chrome-extensions
 * @see https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing
 */
import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import crypto from 'crypto';

// Chromium に渡すのと同じ絶対パスで ID を算出する（trailing slash なし）
const pathToExtension = path.resolve(path.join(__dirname, '..')).replace(/\/$/, '');

/**
 * Chrome のアンパック拡張 ID をパスから算出する（service worker が取れない場合のフォールバック）。
 * @see https://chromium.googlesource.com/chromium/src/+/main/extensions/common/id_util.cc
 */
function getExtensionIdFromPath(extensionPath: string): string {
  const hash = crypto.createHash('sha256').update(extensionPath).digest('hex').slice(0, 32);
  return hash.replace(/[0-9a-f]/g, (c) => {
    const n = parseInt(c, 16);
    return String.fromCharCode(97 + n);
  });
}

const fallbackExtensionId = getExtensionIdFromPath(pathToExtension);

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const userDataDir = path.join(__dirname, '../.playwright-user-data');
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    const trigger = await context.newPage();
    await trigger.goto('about:blank', { timeout: 5000 }).catch(() => {});

    let extensionId = process.env.E2E_EXTENSION_ID ?? fallbackExtensionId;
    const workers = context.serviceWorkers();
    if (workers.length > 0) {
      const url = workers[0].url();
      extensionId = url.split('/')[2];
    }
    await trigger.close().catch(() => {});
    await use(extensionId);
  },
});

export const expect = test.expect;
