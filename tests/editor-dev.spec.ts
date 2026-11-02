// 用真的 Vite 開發伺服器測試「儲存」寫回 script.json（寫到暫存檔，不動真正的腳本）。
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { Script } from '../src/types';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5176;
let server: ViteDevServer;
let file: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  file = join(await mkdtemp(join(tmpdir(), 'vn-dev-')), 'script.json');
  await copyFile(join(ROOT, 'public/script.json'), file);
  process.env.SCRIPT_SAVE_PATH = file;
  server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
});

test.afterAll(async () => {
  await server?.close();
  delete process.env.SCRIPT_SAVE_PATH;
});

test('本機開發：儲存直接寫回 script.json', async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/?edit=1`);
  const first = page.locator('.editor-field[data-path="scenes.0.lines.0.text"] textarea');
  await expect(first).toBeVisible();
  await expect(page.locator('[data-editor=save]')).toContainText('寫回');
  await first.fill('開發模式寫回的第一句。');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.editor-status')).toHaveText('已寫回 public/script.json');
  const saved = JSON.parse(await readFile(file, 'utf8')) as Script;
  expect((saved.scenes[0].lines[0] as { text: string }).text).toBe('開發模式寫回的第一句。');
});

test('本機開發：檔案結構在別處被改過時拒絕寫入', async ({ page }) => {
  const s = JSON.parse(await readFile(file, 'utf8')) as Script;
  s.scenes[0].next = 'somewhere_else';
  await writeFile(file, JSON.stringify(s));
  await page.goto(`http://localhost:${PORT}/?edit=1`);
  await page.locator('.editor-field[data-path="scenes.0.lines.0.text"] textarea').fill('不會被寫入。');
  await page.click('[data-editor=save]');
  await expect(page.locator('.editor-status')).toContainText('沒有儲存');
  expect(await readFile(file, 'utf8')).not.toContain('不會被寫入。');
});
