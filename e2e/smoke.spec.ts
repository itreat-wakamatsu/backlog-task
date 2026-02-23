/**
 * 拡張機能のファイル・マニフェストの存在チェック（Playwright ブラウザ不要）。
 * 実行: npx playwright test e2e/smoke.spec.ts
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '..');

test.describe('Backlog Quick Add - スモーク（ファイル検証）', () => {
  test('manifest.json が存在し有効', () => {
    const p = path.join(root, 'manifest.json');
    expect(fs.existsSync(p)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(p, 'utf-8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBeTruthy();
    expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
    expect(manifest.background?.service_worker).toBe('background.js');
  });

  test('サイドパネル・background・content のエントリが存在', () => {
    expect(fs.existsSync(path.join(root, 'sidepanel.html'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'background.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'content.js'))).toBe(true);
  });

  test('sidepanel.html がタイトルと主要 ID を持つ', () => {
    const html = fs.readFileSync(path.join(root, 'sidepanel.html'), 'utf-8');
    expect(html).toContain('Backlog Quick Add');
    expect(html).toContain('id="apiSetup"');
    expect(html).toContain('id="mainForm"');
  });
});
