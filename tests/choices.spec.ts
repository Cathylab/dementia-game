// 試玩回饋第 2 項：選項的提問放進對話框、選項在對話框右上方（手機直式置中）、開發者面板可調位置與大小。
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { ChoiceLine, Script } from '../src/types';
import { advance, currentText, jumpTo, openWithTestScript } from './helpers';

const scene = (s: Script, id: string) => s.scenes.find((x) => x.id === id)!;

/** obj_scene 的第 3 句是角色台詞，第 5 句是沒有 prompt 的選項。 */
function setup(s: Script) {
  const sc = scene(s, 'obj_scene');
  sc.lines[3] = { speaker: 'amin', text: '妳要怎麼做？' };
  delete sc.lines[3].if;
}

async function toChoice(page: Page) {
  await jumpTo(page, 'obj_scene');
  for (let i = 0; i < 4 && !(await page.locator('.choices.open').count()); i++) await advance(page);
  await expect(page.locator('.choices.open')).toBeVisible();
}

test('沒有 prompt：選項出現時對話框保留前一句台詞與人名', async ({ page }) => {
  await openWithTestScript(page, 'timescale=0.2', { mutate: (s) => {
    setup(s);
    // 獨白那句拿掉，讓選項前一句是角色的提問
    scene(s, 'obj_scene').lines.splice(4, 1);
  } });
  await toChoice(page);
  await expect(page.locator('.dialog')).not.toHaveClass(/empty/);
  await expect(currentText(page)).toHaveText('妳要怎麼做？');
  await expect(page.locator('.dialog .name')).toHaveText('阿明哥');
});

test('有 prompt：提問顯示在對話框裡，不在選項上方', async ({ page }) => {
  await openWithTestScript(page, 'timescale=0.2', { mutate: (s) => ((scene(s, 'obj_scene').lines[5] as ChoiceLine).prompt = '要選哪一個？') });
  await toChoice(page);
  await expect(page.locator('.dialog .choice-prompt')).toHaveText('要選哪一個？');
  await expect(page.locator('.choices .choice-prompt')).toHaveCount(0);
});

test('電腦橫式：選項在對話框右上方；手機直式：置中', async ({ page }) => {
  await openWithTestScript(page);
  await toChoice(page);
  const choices = page.locator('.choices.open');
  await expect(choices).toHaveAttribute('data-layout', 'right');
  const vw = page.viewportSize()!.width;
  const box = (await choices.boundingBox())!;
  expect(box.x).toBeGreaterThan(vw / 2);
  const dialog = (await page.locator('.dialog .text').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(dialog.y + 2);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const b = (await choices.boundingBox())!;
      return Math.abs(b.x + b.width / 2 - 195);
    })
    .toBeLessThan(4);
});

test('開發者面板：選項位置、寬度、大小，存進 meta.choiceStyle', async ({ page }) => {
  await openWithTestScript(page);
  await toChoice(page);
  await page.keyboard.press('Backquote');
  await page.selectOption('select[name=dev-choice-position]', 'center');
  await expect(page.locator('.choices.open')).toHaveAttribute('data-layout', 'center');
  await page.locator('input[name=dev-choice-width]').fill('0.5');
  await page.locator('input[name=dev-choice-scale]').fill('1');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-dev=save-presentation]')]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8')) as Script;
  expect(saved.meta.choiceStyle).toEqual({ position: 'center', width: 0.5, scale: 1 });
});
