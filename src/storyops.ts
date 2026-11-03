// 故事編輯器的結構操作：新增／刪除／移動場景、改場景代號、新增角色。只改腳本資料，不碰 DOM。
import { ENDING_TARGET } from './script.ts';
import { isChoice, isText, type Character, type ChoiceLine, type Scene, type Script, type TextLine } from './types.ts';

/** 指到某個場景的地方。 */
export interface SceneRef {
  where: string;
  kind: 'next' | 'goto' | 'ending' | 'backTarget' | 'timeSkipTo';
}

/** 新場景的代號：a{幕}_s{兩位數}，數字接在整份腳本最大的後面。 */
export function newSceneId(script: Script, act: number): string {
  let max = 0;
  for (const s of script.scenes) {
    const m = s.id.match(/_s(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const ids = new Set(script.scenes.map((s) => s.id));
  let n = max + 1;
  let id = `a${act}_s${String(n).padStart(2, '0')}`;
  while (ids.has(id)) id = `a${act}_s${String(++n).padStart(2, '0')}`;
  return id;
}

/** 哪些地方會跳到這個場景。 */
export function sceneRefs(script: Script, id: string): SceneRef[] {
  const out: SceneRef[] = [];
  for (const s of script.scenes) {
    if (s.next === id) out.push({ where: `${s.id} 的下一個場景`, kind: 'next' });
    if (s.backTarget === id) out.push({ where: `${s.id} 的回上一句目標`, kind: 'backTarget' });
    s.lines.forEach((l, i) => {
      if (isChoice(l)) {
        l.choice.forEach((o, j) => {
          if (o.goto === id) out.push({ where: `${s.id} 第 ${i + 1} 句的選項 ${j + 1}「${o.text}」`, kind: 'goto' });
        });
      }
    });
  }
  for (const e of script.endings ?? []) if (e.scene === id) out.push({ where: `結局 ${e.id}「${e.title}」`, kind: 'ending' });
  return out;
}

/**
 * 在 after 這個場景後面插入新場景，接進流程：after → 新場景 → after 原本的下一個。
 * after 為 null 時加在最後面。回傳新場景。
 */
export function insertScene(script: Script, after: string | null, init: Partial<Scene> = {}): Scene {
  const prev = after ? script.scenes.find((s) => s.id === after) : script.scenes[script.scenes.length - 1];
  const act = init.act ?? prev?.act ?? 1;
  const scene: Scene = {
    id: newSceneId(script, act),
    act,
    title: '新場景',
    background: prev?.background ?? null,
    lines: [{ speaker: 'narrator', text: '' }],
    ...init,
  };
  if (prev) {
    scene.next = prev.next;
    prev.next = scene.id;
    script.scenes.splice(script.scenes.indexOf(prev) + 1, 0, scene);
  } else {
    scene.next = ENDING_TARGET;
    script.scenes.push(scene);
  }
  if (scene.next === undefined) delete scene.next;
  return scene;
}

/**
 * 刪除場景。原本跳到它的地方改成跳到它的下一個場景。
 * 是某個結局的場景時不能刪（回傳原因）；成功回傳 null。
 */
export function deleteScene(script: Script, id: string): string | null {
  const i = script.scenes.findIndex((s) => s.id === id);
  if (i < 0) return `找不到場景 ${id}`;
  if (script.scenes.length === 1) return '至少要留一個場景';
  const ending = (script.endings ?? []).find((e) => e.scene === id);
  if (ending) return `這是結局「${ending.title}」的場景，不能刪除（先在結局設定換成別的場景）`;
  const scene = script.scenes[i];
  const to = scene.next ?? ENDING_TARGET;
  const replacement = to === id ? ENDING_TARGET : to;
  for (const s of script.scenes) {
    if (s.next === id) s.next = replacement;
    if (s.backTarget === id) delete s.backTarget;
    for (const l of s.lines) {
      if (isChoice(l)) for (const o of l.choice) if (o.goto === id) o.goto = replacement;
      if (isText(l) && l.timeSkipTo === id) delete l.timeSkipTo;
    }
  }
  script.scenes.splice(i, 1);
  return null;
}

/** 在列表裡上移（-1）或下移（+1）。只改順序，不改流程（下一個場景照舊）。 */
export function moveScene(script: Script, id: string, delta: -1 | 1): boolean {
  const i = script.scenes.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= script.scenes.length) return false;
  [script.scenes[i], script.scenes[j]] = [script.scenes[j], script.scenes[i]];
  return true;
}

/** 代號只能用英文字母、數字、底線（會用在檔名裡）。 */
export function isValidId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(id);
}

/** 改場景代號，所有指到它的地方一起改。回傳錯誤原因，成功回傳 null。 */
export function renameScene(script: Script, from: string, to: string): string | null {
  if (from === to) return null;
  if (!isValidId(to)) return '代號只能用英文字母開頭，接英文字母、數字或底線';
  if (script.scenes.some((s) => s.id === to)) return `已經有叫 ${to} 的場景`;
  const scene = script.scenes.find((s) => s.id === from);
  if (!scene) return `找不到場景 ${from}`;
  scene.id = to;
  for (const s of script.scenes) {
    if (s.next === from) s.next = to;
    if (s.backTarget === from) s.backTarget = to;
    for (const l of s.lines) {
      if (isChoice(l)) for (const o of l.choice) if (o.goto === from) o.goto = to;
      if (isText(l) && l.timeSkipTo === from) l.timeSkipTo = to;
    }
  }
  for (const e of script.endings ?? []) if (e.scene === from) e.scene = to;
  return null;
}

/** 新增角色。回傳錯誤原因，成功回傳 null。 */
export function addCharacter(script: Script, id: string, name: string): string | null {
  if (!isValidId(id)) return '代號只能用英文字母開頭，接英文字母、數字或底線（會用在立繪檔名）';
  if (['narrator', 'player'].includes(id)) return `${id} 是保留字（旁白、主角內心）`;
  script.characters ??= [];
  if (script.characters.some((c) => c.id === id)) return `已經有代號 ${id} 的角色`;
  if (!name.trim()) return '請填名字';
  const c: Character = { id, name: name.trim(), expressions: ['neutral'] };
  script.characters.push(c);
  return null;
}

/** 刪除角色：還有台詞是他說的就不能刪。 */
export function deleteCharacter(script: Script, id: string): string | null {
  const used = script.scenes.flatMap((s) => s.lines.filter((l) => isText(l) && l.speaker === id).map(() => s.id));
  if (used.length) return `還有 ${used.length} 句台詞是這個角色說的（例如 ${used[0]}），先改掉才能刪`;
  script.characters = (script.characters ?? []).filter((c) => c.id !== id);
  return null;
}

export function newTextLine(speaker = 'narrator'): TextLine {
  return { speaker, text: '' };
}

export function newChoiceLine(): ChoiceLine {
  return { prompt: '', choice: [{ text: '選項一' }, { text: '選項二' }] };
}

/** 這個場景會走到哪些場景（給場景列表顯示「→」）。 */
export function sceneTargets(scene: Scene): string[] {
  const out: string[] = [];
  for (const l of scene.lines) if (isChoice(l)) for (const o of l.choice) if (o.goto && !out.includes(o.goto)) out.push(o.goto);
  const next = scene.next ?? ENDING_TARGET;
  if (!out.includes(next)) out.push(next);
  return out;
}

/** 把整份腳本換成 snapshot 的內容（復原用），保留同一個物件（引擎和介面都拿著它）。 */
export function replaceScript(script: Script, snapshot: Script): void {
  for (const k of Object.keys(script)) delete (script as unknown as Record<string, unknown>)[k];
  Object.assign(script, snapshot);
}
