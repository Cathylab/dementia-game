// 白話的檢查關卡（需求書 5.3）：白話訊息、兩級、抓出 JSON、修正提示詞，以及故事編輯器的「貼上劇本」。
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { checkPastedScript, checkScript, extractJson, fixAllPrompt, fixPrompt, hasBlocking } from '../src/checks';
import { LEGACY_PACK, PLAIN_PACK } from '../src/pack';
import { isChoice, type ChoiceLine, type Script, type TextLine } from '../src/types';
import { openWithTestScript, testScript } from './helpers';

const DEMO_TEXT = readFileSync(new URL('../examples/寫給未來的我/script.json', import.meta.url), 'utf8');
const demo = () => JSON.parse(DEMO_TEXT) as Script;
const FALLBACK = '請照訊息修正';

test.describe('白話訊息', () => {
  test('需求書的例子：第二幕〈點名〉的選項跳到不存在的場景', () => {
    const s = demo();
    const scene = s.scenes.find((x) => x.id === 'a2_s07')!;
    const i = scene.lines.findIndex(isChoice);
    (scene.lines[i] as ChoiceLine).choice[1].goto = 'a2_s99';
    const issues = checkScript(s, LEGACY_PACK);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('error');
    expect(issues[0].plain).toMatch(new RegExp(`^第二幕〈點名〉第 ${i + 1} 句的第 2 個選項「.+」，會跳到一個不存在的場景。$`));
    expect(issues[0].fix).toContain('請把它改成要去的場景，或刪掉這個跳轉');
    expect(issues[0].scene).toBe('a2_s07');
    expect(issues[0].line).toBe(i);
    expect(hasBlocking(issues)).toBe(true);
  });

  test('Demo 與空白範本沒有任何問題', () => {
    expect(checkScript(demo(), LEGACY_PACK)).toEqual([]);
    const blank = JSON.parse(readFileSync(new URL('../templates/空白/script.json', import.meta.url), 'utf8')) as Script;
    expect(checkScript(blank, PLAIN_PACK)).toEqual([]);
  });

  test('各種問題都有白話說明，必須修正排在前面', () => {
    const s = testScript();
    s.meta.title = '';
    (s.scenes[0].lines[0] as TextLine).speaker = 'nobody';
    (s.scenes[0].lines[1] as TextLine).fx = ['teleport' as never];
    (s.scenes[0].lines[1] as TextLine).expression = 'laughing';
    s.scenes[0].next = 'missing_scene';
    s.scenes[0].lines.push({ speaker: 'narrator', text: 'x', if: 'trust >=' });
    s.scenes[0].lines.push({ speaker: 'narrator', text: 'y', if: 'has("never_set")' });
    const obj = s.scenes.find((x) => x.objects?.length)!.objects![0];
    obj.x = 0.97;
    obj.label = '';
    s.endings[0].scene = 'nowhere';
    const issues = checkScript(s, PLAIN_PACK);
    expect(issues.length).toBeGreaterThan(8);
    for (const x of issues) expect(x.fix, x.tech).not.toContain(FALLBACK);
    const levels = issues.map((x) => x.level);
    expect(levels.indexOf('warning')).toBeGreaterThan(levels.lastIndexOf('error'));
    const text = issues.map((x) => x.plain).join('\n');
    expect(text).toContain('遊戲沒有名稱');
    expect(text).toContain('說話的人「nobody」不存在');
    expect(text).toContain('條件寫錯了');
    expect(text).toContain('旗標「never_set」');
    expect(text).toContain('位置太靠左右邊緣');
    expect(text).toContain('結局「結局X」');
    expect(text).toContain('題材包「一般故事」沒有啟用效果');
    // 建議修正不會擋住下一步
    expect(hasBlocking(issues.filter((x) => x.level === 'warning'))).toBe(false);
  });

  test('「請 AI 修正」的提示詞包含問題、修法，並要求只輸出 JSON', () => {
    const s = testScript();
    s.scenes[0].next = 'missing_scene';
    const [issue] = checkScript(s, LEGACY_PACK);
    const p = fixPrompt(issue);
    expect(p).toContain(issue.plain);
    expect(p).toContain(issue.fix);
    expect(p).toContain('只輸出 JSON');
    expect(fixAllPrompt([issue, issue])).toContain('2.【必須修正】');
  });
});

test.describe('抓出 JSON', () => {
  test('前後有說明文字、用 ``` 包起來、中文引號與多餘逗號', () => {
    expect(extractJson('{"a":1}')).toMatchObject({ ok: true, value: { a: 1 } });
    expect(extractJson('好的，這是劇本：\n```json\n{"a":1}\n```\n希望有幫助！')).toMatchObject({ ok: true, value: { a: 1 } });
    expect(extractJson('以下是結果 {"a":{"b":"有 } 括號"}} 以上')).toMatchObject({ ok: true, value: { a: { b: '有 } 括號' } } });
    expect(extractJson('{“a”: 1, "b": [1, 2,],}')).toMatchObject({ ok: true, value: { a: 1, b: [1, 2] } });
  });

  test('抓不到時給出原因與修正提示詞', () => {
    for (const bad of ['', '我沒辦法寫', '{"meta": {"title": "被截斷了"', '{"a": 1 "b": 2}']) {
      const r = extractJson(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) {
        expect(r.error.length).toBeGreaterThan(0);
        expect(r.prompt).toContain('只輸出 JSON');
      }
    }
  });

  test('貼回來的劇本：Demo 加上前後說明也能通過；不是劇本的 JSON 被擋下', () => {
    const r = checkPastedScript(`這是完整的劇本：\n\n\`\`\`json\n${DEMO_TEXT}\n\`\`\`\n\n有需要再告訴我。`, LEGACY_PACK);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.issues).toEqual([]);
      expect(r.note).toContain('說明文字');
      expect(r.script.meta.title).toBe('寫給未來的我');
    }
    const notScript = checkPastedScript('{"name": "not a script"}');
    expect(notScript.ok).toBe(false);
  });
});

const openStory = async (page: Page) => {
  await page.keyboard.press('Backquote');
  await page.click('[data-dev=story]');
  await expect(page.locator('.story.open')).toBeVisible();
};

test.describe('畫面', () => {
  test('故事編輯器的檢查結果：白話、兩級、跳到這裡', async ({ page }) => {
    await openWithTestScript(page, 'timescale=0.2', {
      mutate: (s) => {
        s.scenes.find((x) => x.id === 'pose')!.next = 'missing_scene';
      },
    });
    await openStory(page);
    const panel = page.locator('.story-problems');
    await expect(panel.locator(':scope > summary')).toContainText('必須修正 1 個');
    await panel.locator(':scope > summary').click();
    await expect(panel.locator('.issue.error .issue-plain')).toContainText('〈pose〉，播完後會跳到一個不存在的場景');
    await panel.locator('.issue-jump').first().click();
    await expect(page.locator('.story-scene-item.selected')).toHaveAttribute('data-scene', 'pose');
  });

  test('貼上劇本：前後有說明也能讀；有必須修正時不能套用；修好後套用', async ({ page }) => {
    await openWithTestScript(page);
    await openStory(page);
    await page.click('[data-tab=paste]');
    const broken = demo();
    broken.scenes[0].next = 'a9_s99';
    await page.locator('textarea[name=story-paste]').fill(`好的！\n${JSON.stringify(broken)}\n以上。`);
    await page.click('[data-story=paste-check]');
    await expect(page.locator('.story-paste-result')).toContainText('必須修正 1 個');
    await expect(page.locator('[data-story=paste-apply]')).toBeDisabled();

    await page.locator('textarea[name=story-paste]').fill('我寫不出來');
    await page.click('[data-story=paste-check]');
    await expect(page.locator('.story-paste-result')).toContainText('找不到 JSON');
    await expect(page.locator('.story-prompt')).toContainText('只輸出 JSON');

    await page.locator('textarea[name=story-paste]').fill(`\`\`\`json\n${DEMO_TEXT}\n\`\`\``);
    await page.click('[data-story=paste-check]');
    await expect(page.locator('.story-paste-result')).toContainText('沒有問題');
    page.on('dialog', (d) => void d.accept());
    await page.click('[data-story=paste-apply]');
    await expect(page.locator('.story-scene-item[data-scene=a1_s01]')).toBeVisible();
    const title = await page.evaluate(() => (window as unknown as { __vn: { engine: { script: Script } } }).__vn.engine.script.meta.title);
    expect(title).toBe('寫給未來的我');
    // 可以復原回原本的劇本
    await page.click('[data-story=undo]');
    await expect(page.locator('.story-scene-item[data-scene=t_start]')).toBeVisible();
  });

  test('開發者面板的腳本檢查也是白話', async ({ page }) => {
    await openWithTestScript(page, 'timescale=0.2', { mutate: (s) => ((s.scenes[0].lines[0] as TextLine).speaker = 'ghost') });
    await page.keyboard.press('Backquote');
    const section = page.locator('details[data-section=腳本檢查]');
    await expect(section).toContainText('必須修正 1 個');
    await expect(section).toContainText('說話的人「ghost」不存在');
  });
});
