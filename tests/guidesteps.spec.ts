// 引導流程與提示詞產生器（需求書 5.2）。
// 驗收：用失智症題材包走一次流程，每一步的提示詞都包含前面步驟的內容；《寫給未來的我》的 script.json 貼進第 5 步能通過檢查。
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { normalizePack } from '../src/pack';
import { artPrompt, designPrompt, directionsPrompt, outlinePrompt, scriptPrompt, type Answers } from '../src/guide/prompts';
import type { Script } from '../src/types';

const ROOT = new URL('../', import.meta.url);
const DEMO_TEXT = readFileSync(new URL('examples/寫給未來的我/script.json', ROOT), 'utf8');
const demo = JSON.parse(DEMO_TEXT) as Script;
const OUT = fileURLToPath(new URL('dist-offline/', ROOT));

test('提示詞：每一步都包含前面的內容、題材包準則、格式規則只列題材包啟用的效果', async () => {
  const dementia = normalizePack(JSON.parse(await readFile(new URL('packs/dementia/pack.json', ROOT), 'utf8')), 'dementia');
  const plain = normalizePack(JSON.parse(await readFile(new URL('packs/plain/pack.json', ROOT), 'utf8')), 'plain');
  const docs = {
    guide: await readFile(new URL('packs/dementia/guide.md', ROOT), 'utf8'),
    cautions: await readFile(new URL('packs/dementia/cautions.md', ROOT), 'utf8'),
  };
  const answers: Answers = {
    theme: { title: '外婆的菜園', pack: 'dementia', goal: '目標句GOAL', length: 'short', audience: '國中生' },
    directions: { raw: '三個方向……', chosen: '選定方向DIRECTION' },
    outline: { raw: '分場大綱OUTLINE' },
    design: { raw: '設計表DESIGN' },
    art: { raw: '', style: '水彩STYLE' },
  };
  const i = { answers, pack: dementia, docs, script: demo };
  const p2 = directionsPrompt(i);
  expect(p2).toContain('外婆的菜園');
  expect(p2).toContain('目標句GOAL');
  expect(p2).toContain('國中生');
  expect(p2).toContain('症狀與效果對照');
  expect(p2).toContain('避免的寫法');
  const p3 = outlinePrompt(i);
  expect(p3).toContain('目標句GOAL');
  expect(p3).toContain('選定方向DIRECTION');
  const p4 = designPrompt(i);
  expect(p4).toContain('分場大綱OUTLINE');
  expect(p4).toContain('自我檢查');
  const p5 = scriptPrompt(i);
  for (const s of ['目標句GOAL', '分場大綱OUTLINE', '設計表DESIGN', '"pack": "dementia"', 'choice_vanish', '只輸出 JSON']) expect(p5).toContain(s);
  const p6 = artPrompt(i);
  expect(p6).toContain('kitchen_morning');
  expect(p6).toContain('水彩STYLE');
  expect(p6).toContain('生圖提示詞表');
  // 一般故事包：格式規則不列任何效果
  const plainScript = scriptPrompt({ ...i, pack: plain, docs: {} });
  expect(plainScript).not.toContain('choice_vanish');
  expect(plainScript).toContain('不要寫 fx');
});

const next = (page: Page) => page.locator('[data-guide=next]');
const prompt = (page: Page) => page.locator('[data-guide=prompt]');

test('用失智症題材包走完整個流程', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');

  // 1. 題材包與主題
  await expect(next(page)).toBeDisabled();
  await page.locator('input[name=guide-title]').fill('外婆的菜園');
  await page.locator('[data-guide=packs-choice] input[value=dementia]').check();
  await page.locator('textarea[name=guide-goal]').fill('讓玩家體會GOAL');
  await expect(next(page)).toBeEnabled();
  await next(page).click();

  // 2. 三個方向
  await expect(page.locator('[data-guide=progress]')).toContainText('第 2 步');
  await expect(page.locator('.g-project')).toHaveText('《外婆的菜園》');
  await expect(prompt(page)).toContainText('讓玩家體會GOAL');
  await expect(prompt(page)).toContainText('症狀與效果對照');
  await expect(next(page)).toBeDisabled();
  await page.locator('textarea[name=guide-paste]').fill('方向一……方向二……方向三……');
  await expect(next(page)).toBeDisabled();
  await page.locator('textarea[name=guide-chosen]').fill('選定的方向DIRECTION');
  await expect(next(page)).toBeEnabled();
  await next(page).click();

  // 3. 分場大綱
  await expect(prompt(page)).toContainText('選定的方向DIRECTION');
  await page.locator('textarea[name=guide-paste]').fill('分場大綱OUTLINE：a1_s01 早上……a1_s02 下午……結局……');
  await next(page).click();

  // 4. 設計表
  await expect(prompt(page)).toContainText('分場大綱OUTLINE');
  await page.locator('textarea[name=guide-paste]').fill('設計表DESIGN：物件、隱藏選項、效果表……完整內容');
  await page.locator('input[name=guide-check]').first().check();
  await next(page).click();

  // 5. 完整劇本：貼上 Demo（前後有說明文字）
  await expect(prompt(page)).toContainText('設計表DESIGN');
  await expect(prompt(page)).toContainText('分場大綱OUTLINE');
  await expect(prompt(page)).toContainText('"pack": "dementia"');
  await expect(next(page)).toBeDisabled();
  await page.locator('textarea[name=guide-paste]').fill(`好的，這是劇本：\n\`\`\`json\n${DEMO_TEXT}\n\`\`\``);
  await page.click('[data-guide=check]');
  await expect(page.locator('[data-guide=result]')).toContainText('沒有問題');
  await page.click('[data-guide=apply]');
  await expect(page.locator('[data-guide=applied]')).toContainText('已套用《寫給未來的我》');
  await expect(next(page)).toBeEnabled();
  await next(page).click();

  // 6. 美術需求：提示詞列出劇本需要的圖
  await page.locator('input[name=guide-style]').fill('水彩STYLE');
  await expect(prompt(page)).toContainText('水彩STYLE');
  await expect(prompt(page)).toContainText('kitchen_morning');
  await page.locator('textarea[name=guide-paste]').fill('美術說明……提示詞表……');
  await next(page).click();

  // 7. 素材
  await expect(page.locator('[data-guide=open-assets]')).toHaveAttribute('href', 'play.html?story=assets');
  await next(page).click();

  // 8. 試玩：劇本檢查沒有必須修正
  await expect(page.locator('.g-result')).toContainText('沒有問題');
  await expect(next(page)).toBeEnabled();
  await next(page).click();

  // 9. 匯出專案檔
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-guide=export-project]')]);
  expect(download.suggestedFilename()).toBe('寫給未來的我.vnproj');

  // 回到第 2 步：剛才貼的內容都還在
  await page.goto('./#/step/2');
  await expect(page.locator('textarea[name=guide-chosen]')).toHaveValue('選定的方向DIRECTION');
  // 遊戲頁開的是套用後的劇本
  await page.goto('./play.html');
  await expect(page.locator('.title-screen h1')).toHaveText('寫給未來的我');
  expect(errors).toEqual([]);
});

test('第 5 步：有必須修正的問題時不能套用，也不能下一步', async ({ page }) => {
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 1 步');
  await page.goto('./#/step/5');
  const broken = JSON.parse(DEMO_TEXT) as Script;
  broken.scenes[0].next = 'a9_s99';
  await page.locator('textarea[name=guide-paste]').fill(JSON.stringify(broken));
  await page.click('[data-guide=check]');
  await expect(page.locator('[data-guide=result]')).toContainText('必須修正 1 個');
  await expect(page.locator('[data-guide=apply]')).toBeDisabled();
  await expect(next(page)).toBeDisabled();
  await page.locator('textarea[name=guide-paste]').fill('抱歉，我無法完成');
  await page.click('[data-guide=check]');
  await expect(page.locator('[data-guide=result]')).toContainText('找不到 JSON');
  // 先跳過還是可以
  await page.click('[data-guide=skip]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 6 步');
});

test('離線版：提示詞照樣產生（題材包準則也在），並提醒到有網路的地方用 AI', async ({ page }) => {
  await page.goto(pathToFileURL(join(OUT, '開始.html')).href);
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  await page.locator('input[name=guide-title]').fill('離線作品');
  await page.locator('[data-guide=packs-choice] input[value=dementia]').check();
  await page.locator('textarea[name=guide-goal]').fill('離線目標');
  await next(page).click();
  await expect(page.locator('.g-offline')).toContainText('到有網路的地方');
  await expect(prompt(page)).toContainText('離線目標');
  await expect(prompt(page)).toContainText('症狀與效果對照');
});
