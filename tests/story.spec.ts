// 故事編輯器：結構操作（storyops）與瀏覽器裡的編輯、試玩、復原、儲存。
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { validateScript } from '../src/script';
import { addCharacter, deleteCharacter, deleteScene, insertScene, moveScene, newSceneId, renameScene, sceneRefs } from '../src/storyops';
import type { ChoiceLine, Script } from '../src/types';
import { currentText, openWithTestScript, testScript } from './helpers';

test.describe('結構操作', () => {
  test('新增場景：接在選到的場景後面，流程跟著接上', () => {
    const s = testScript();
    expect(newSceneId(s, 1)).toBe('a1_s01');
    const scene = insertScene(s, 't_start');
    expect(scene.id).toBe('a1_s01');
    expect(s.scenes[1]).toBe(scene);
    expect(s.scenes[0].next).toBe('a1_s01');
    expect(scene.next).toBe('t_end_choice');
    expect(scene.background).toBe('test_room');
    expect(newSceneId(s, 2)).toBe('a2_s02');
  });

  test('刪除場景：跳到它的地方改成跳到它的下一個；結局場景不能刪', () => {
    const s = testScript();
    const choice = s.scenes.find((x) => x.id === 't_end_choice')!.lines[0] as ChoiceLine;
    choice.choice[0].goto = 'fx_name';
    s.scenes.find((x) => x.id === 'fx_name')!.next = 'fx_text';
    expect(sceneRefs(s, 'fx_name').map((r) => r.kind)).toContain('goto');
    expect(deleteScene(s, 'fx_name')).toBeNull();
    expect(choice.choice[0].goto).toBe('fx_text');
    expect(s.scenes.some((x) => x.id === 'fx_name')).toBe(false);
    expect(deleteScene(s, 'end_x')).toContain('結局');
  });

  test('改代號：所有指到它的地方一起改；代號格式與重複會擋下', () => {
    const s = testScript();
    expect(renameScene(s, 't_end_choice', 'choose')).toBeNull();
    expect(s.scenes[0].next).toBe('choose');
    expect(renameScene(s, 'end_x', 'finale')).toBeNull();
    expect(s.endings[0].scene).toBe('finale');
    expect(renameScene(s, 'choose', '中文')).toContain('英文');
    expect(renameScene(s, 'choose', 'fx_name')).toContain('已經有');
    expect(validateScript(s).filter((p) => !p.startsWith('（警告）'))).toEqual(validateScript(testScript()).filter((p) => !p.startsWith('（警告）')));
  });

  test('移動場景只改順序；角色新增與刪除的檢查', () => {
    const s = testScript();
    expect(moveScene(s, 't_start', -1)).toBe(false);
    expect(moveScene(s, 't_start', 1)).toBe(true);
    expect(s.scenes[1].id).toBe('t_start');
    expect(s.scenes[1].next).toBe('t_end_choice');
    expect(addCharacter(s, 'mom', '媽媽')).toBeNull();
    expect(addCharacter(s, 'mom', '媽媽')).toContain('已經有');
    expect(addCharacter(s, 'narrator', '旁白')).toContain('保留字');
    expect(addCharacter(s, '媽媽', '媽媽')).toContain('英文');
    expect(deleteCharacter(s, 'amin')).toContain('台詞');
    expect(deleteCharacter(s, 'mom')).toBeNull();
  });
});

const script = (page: Page) => page.evaluate(() => (window as unknown as { __vn: { engine: { script: Script } } }).__vn.engine.script);

async function openStory(page: Page): Promise<void> {
  await page.keyboard.press('Backquote');
  await page.click('[data-dev=story]');
  await expect(page.locator('.story.open')).toBeVisible();
}

test.describe('故事編輯器', () => {
  test('新增場景、寫台詞、從這個場景試玩；復原與重做', async ({ page }) => {
    await openWithTestScript(page);
    await openStory(page);
    await page.click('.story-scene-item[data-scene=t_start]');
    await expect(page.locator('input[name=story-scene-title]')).toHaveValue('開始');
    await page.click('[data-story=add-scene]');
    await expect(page.locator('.story-scene-item.selected')).toHaveAttribute('data-scene', 'a1_s01');
    await page.locator('input[name=story-scene-title]').fill('我的新場景');
    await page.locator('textarea[name=story-text]').first().fill('新場景的第一句。');
    await expect(page.locator('.story-scene-item[data-scene=a1_s01]')).toContainText('我的新場景');
    await expect(page.locator('.story-scene-item[data-scene=t_start]')).toContainText('→ a1_s01');
    let s = await script(page);
    expect(s.scenes[0].next).toBe('a1_s01');
    expect(s.scenes[1]).toMatchObject({ id: 'a1_s01', title: '我的新場景', next: 't_end_choice' });

    await page.click('[data-story=play-scene]');
    await expect(page.locator('.story')).toBeHidden();
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'a1_s01');
    await expect(currentText(page)).toHaveText('新場景的第一句。');

    // 復原到加場景之前，再重做
    await openStory(page);
    await expect(page.locator('[data-story=undo]')).toBeEnabled();
    for (let i = 0; i < 3; i++) await page.click('[data-story=undo]');
    s = await script(page);
    expect(s.scenes.some((x) => x.id === 'a1_s01')).toBe(false);
    expect(s.scenes[0].next).toBe('t_end_choice');
    await expect(page.locator('[data-story=undo]')).toBeDisabled();
    await page.keyboard.press('Control+Shift+Z');
    s = await script(page);
    expect(s.scenes[1].id).toBe('a1_s01');
  });

  test('選項：新增選項、設定去向，試玩時選了就跳過去', async ({ page }) => {
    await openWithTestScript(page);
    await openStory(page);
    await page.click('.story-scene-item[data-scene=t_start]');
    await page.click('[data-story=add-scene]');
    // 新場景預設有一句空白台詞：刪掉，改成一組選項
    await page.click('.story-line[data-line="0"] [data-story=delete-line]');
    await page.click('[data-story=add-choice]');
    const option = page.locator('.story-choice .story-option').first();
    await option.locator('input[name=story-option-text]').fill('去看物件');
    await option.locator('select[name=story-option-goto]').selectOption('obj_scene');
    const s = await script(page);
    const choice = s.scenes[1].lines[0] as ChoiceLine;
    expect(choice.choice[0]).toEqual({ text: '去看物件', goto: 'obj_scene' });
    await expect(page.locator('.story-scene-item[data-scene=a1_s01]')).toContainText('→ obj_scene、t_end_choice');

    await page.click('[data-story=play-scene]');
    await expect(page.locator('.choices.open .choice')).toHaveCount(2);
    await page.locator('.choice', { hasText: '去看物件' }).click();
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'obj_scene');
  });

  test('角色：新增後可以選他說話、選表情', async ({ page }) => {
    await openWithTestScript(page);
    await openStory(page);
    await page.click('[data-tab=characters]');
    await page.locator('input[name=story-new-char-id]').fill('mom');
    await page.locator('input[name=story-new-char-name]').fill('媽媽');
    await page.click('[data-story=add-char]');
    await expect(page.locator('.story-char[data-char=mom]')).toBeVisible();
    await page.locator('.story-char[data-char=mom] input[name=story-char-expressions]').fill('neutral、smile');
    await page.locator('.story-char[data-char=mom] input[name=story-char-expressions]').press('Tab');

    await page.click('.story-scene-item[data-scene=t_start]');
    const line = page.locator('.story-line[data-line="0"]');
    await line.locator('select[name=story-speaker]').selectOption('mom');
    await line.locator('select[name=story-expression]').selectOption('smile');
    const s = await script(page);
    expect(s.characters.find((c) => c.id === 'mom')).toMatchObject({ name: '媽媽', expressions: ['neutral', 'smile'] });
    expect(s.scenes[0].lines[0]).toMatchObject({ speaker: 'mom', expression: 'smile', text: '旁白第一句。' });
    await expect(page.locator('.story-problems')).toContainText('沒有問題');
  });

  test('結局：新增結局會同時建立結局場景；儲存會下載含新結構的 script.json', async ({ page }) => {
    await openWithTestScript(page);
    await openStory(page);
    await page.click('[data-tab=endings]');
    await page.click('[data-story=add-ending]');
    await expect(page.locator('.story-card[data-ending=ending_4]')).toBeVisible();
    await page.locator('.story-card[data-ending=ending_4] input[name=story-ending-condition]').fill('lucidity >= 3');
    await page.locator('.story-card[data-ending=ending_4] input[name=story-ending-condition]').press('Tab');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-story=save]')]);
    const saved = JSON.parse(await readFile(await download.path(), 'utf8')) as Script;
    expect(saved.endings[3]).toEqual({ id: 'ending_4', title: '新結局', condition: 'lucidity >= 3', scene: 'end_4' });
    expect(saved.scenes.some((x) => x.id === 'end_4')).toBe(true);
    await expect(page.locator('.story .story-status')).toContainText('已下載');
  });

  test('刪除場景：確認後刪除，跳到它的地方接到下一個場景', async ({ page }) => {
    await openWithTestScript(page);
    await openStory(page);
    await page.click('.story-scene-item[data-scene=t_end_choice]');
    page.on('dialog', (d) => void d.accept());
    await page.click('[data-story=delete-scene]');
    await expect(page.locator('.story-scene-item[data-scene=t_end_choice]')).toHaveCount(0);
    const s = await script(page);
    expect(s.scenes[0].next).toBe('@ending');
  });
});
