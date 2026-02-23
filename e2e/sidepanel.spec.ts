/**
 * E2E tests for the extension side panel.
 * @see https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const sidepanelUrl = (id: string) => `chrome-extension://${id}/sidepanel.html`;

/** 拡張サイドパネルへ遷移。ERR_ABORTED が出ても表示を待って続行する */
async function gotoSidepanel(page: Page, extensionId: string): Promise<void> {
  try {
    await page.goto(sidepanelUrl(extensionId), { waitUntil: 'commit', timeout: 10000 });
  } catch (e) {
    if (String((e as Error).message).includes('ERR_ABORTED')) {
      await page.waitForSelector('body', { state: 'visible', timeout: 5000 }).catch(() => {});
    } else {
      throw e;
    }
  }
  await page.waitForSelector('#apiSetup, #mainForm, header h1', { timeout: 5000 });
}

test.describe('Backlog Quick Add - サイドパネル', () => {
  test('拡張機能を読み込み、サイドパネルページが開ける', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await gotoSidepanel(page, extensionId);
    await expect(page).toHaveTitle(/Backlog Quick Add/);
    await page.close();
  });

  test('APIキー未設定時は初期設定画面が表示される', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await gotoSidepanel(page, extensionId);

    const apiSetup = page.locator('#apiSetup');
    await expect(apiSetup).toBeVisible();

    const mainForm = page.locator('#mainForm');
    await expect(mainForm).toBeHidden();

    await expect(page.locator('#apiSetupTitle')).toHaveText(/初期設定|APIキーを設定/);
    await expect(page.locator('#backlogSpaceId')).toBeVisible();
    await expect(page.locator('#apiKeyInput')).toBeVisible();
    await expect(page.locator('#apiKeySave')).toBeVisible();

    await page.close();
  });

  test('ページメタとヘッダーが表示される', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await gotoSidepanel(page, extensionId);

    await expect(page.locator('header h1')).toHaveText(/Backlog タスク登録/);
    const pageMeta = page.locator('#pageMeta');
    await expect(pageMeta).toBeVisible();

    await page.close();
  });

  test('設定リンクは初期設定時は非表示', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await gotoSidepanel(page, extensionId);

    const headerLinks = page.locator('#headerLinks');
    await expect(headerLinks).toBeHidden();
    await page.close();
  });
});
