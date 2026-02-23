/**
 * E2E tests for content script (selection message).
 * コンテンツスクリプトは background から GET_SELECTION_TEXT で呼ばれるため、
 * 拡張が読み込まれた状態で通常ページを開けることを確認する。
 */
import { test, expect } from './fixtures';

test.describe('Backlog Quick Add - コンテンツ', () => {
  test('拡張読み込み後、通常ページを開ける', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto('about:blank');
    await expect(page).toHaveURL('about:blank');
    await page.close();
  });

  test('data URL のページを開いてもクラッシュしない', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto('data:text/html,<h1>Hello</h1>');
    await expect(page.locator('h1')).toHaveText('Hello');
    await page.close();
  });
});
