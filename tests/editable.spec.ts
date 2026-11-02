import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { editableFields, formatScript, getAt, setAt, structureOf } from '../src/editable';
import type { Script } from '../src/types';
import { saveScript } from '../vite-plugin-script-save';
import { testScript } from './helpers';

const demo = async () => JSON.parse(await readFile(new URL('../public/script.json', import.meta.url), 'utf8')) as Script;

test.describe('文字編輯：可以改的欄位', () => {
  test('涵蓋文件列出的所有種類，且只有文字欄位', () => {
    const kinds = new Set(editableFields(testScript()).map((f) => f.kind));
    expect([...kinds].sort()).toEqual(
      ['choice.prompt', 'ending.title', 'line.text', 'memoryReview.intro', 'object.description', 'object.label', 'object.truth', 'option.text'].sort(),
    );
    for (const f of editableFields(testScript())) {
      expect(typeof getAt(testScript(), f.path)).toBe('string');
      expect(['text', 'prompt', 'label', 'description', 'truth', 'title', 'intro']).toContain(f.path[f.path.length - 1]);
    }
  });

  test('只改文字時結構相同；改了結構就不同', () => {
    const a = testScript();
    const b = testScript();
    for (const f of editableFields(b)) setAt(b, f.path, '改過的文字');
    expect(structureOf(b)).toBe(structureOf(a));
    const c = testScript();
    (c.scenes[0].lines[0] as { if?: string }).if = 'trust > 0';
    expect(structureOf(c)).not.toBe(structureOf(a));
    const d = testScript();
    d.scenes[0].next = 'flat_b';
    expect(structureOf(d)).not.toBe(structureOf(a));
  });

  test('formatScript 輸出合法 JSON，內容與原本相同', async () => {
    for (const s of [testScript(), await demo()]) {
      const text = formatScript(s);
      expect(JSON.parse(text)).toEqual(s);
      expect(text.endsWith('\n')).toBe(true);
    }
  });
});

test.describe('文字編輯：寫回 script.json（開發伺服器端）', () => {
  async function tempScript(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'vn-save-'));
    const file = join(dir, 'script.json');
    await writeFile(file, JSON.stringify(testScript()));
    return file;
  }

  test('只改文字：寫入並格式化', async () => {
    const file = await tempScript();
    const s = testScript();
    (s.scenes[0].lines[0] as { text: string }).text = '新的第一句。';
    const r = await saveScript(file, JSON.stringify(s));
    expect(r.status).toBe(200);
    const written = await readFile(file, 'utf8');
    expect(JSON.parse(written)).toEqual(s);
    expect(written).toBe(formatScript(s));
  });

  test('結構不同：拒絕寫入（409）', async () => {
    const file = await tempScript();
    const s = testScript();
    s.scenes.pop();
    const r = await saveScript(file, JSON.stringify(s));
    expect(r.status).toBe(409);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(testScript());
  });

  test('不是 JSON：拒絕寫入（400）', async () => {
    const file = await tempScript();
    expect((await saveScript(file, '{ broken')).status).toBe(400);
  });
});
