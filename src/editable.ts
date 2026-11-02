// 文字編輯模式的共用邏輯（瀏覽器與 Vite 開發伺服器都會用到，所以不能碰 DOM）。
// 只能改文字，不能改結構：if、requires、effects、flags、goto、座標等都不能動。
// 這個檔案也會被 vite.config.ts 載入，所以 import 要寫副檔名。
import { isChoice, isMemoryReview, type Script } from './types.ts';

export type Path = (string | number)[];

export type FieldKind =
  | 'line.text'
  | 'choice.prompt'
  | 'option.text'
  | 'object.label'
  | 'object.description'
  | 'object.truth'
  | 'ending.title'
  | 'memoryReview.intro';

export interface EditableField {
  path: Path;
  kind: FieldKind;
  /** 所屬場景 id；結局標題為 null。 */
  sceneId: string | null;
  /** 給人看的位置說明，例如「第 3 句・小婷」。 */
  where: string;
  /** 唯讀的脈絡（例如 if 條件），只顯示不編輯。 */
  note?: string;
}

/** 列出腳本裡所有可以編輯的文字欄位（依腳本順序）。 */
export function editableFields(script: Script): EditableField[] {
  const names = new Map((script.characters ?? []).map((c) => [c.id, c.name]));
  const who = (speaker: string) => (speaker === 'narrator' ? '旁白' : speaker === 'player' ? '獨白' : names.get(speaker) ?? speaker);
  const out: EditableField[] = [];
  script.scenes.forEach((scene, si) => {
    const base: Path = ['scenes', si];
    (scene.objects ?? []).forEach((obj, oi) => {
      const p = [...base, 'objects', oi];
      const where = `物件 ${obj.id}`;
      out.push({ path: [...p, 'label'], kind: 'object.label', sceneId: scene.id, where: `${where}・名稱` });
      out.push({ path: [...p, 'description'], kind: 'object.description', sceneId: scene.id, where: `${where}・說明` });
      if (obj.truth != null) out.push({ path: [...p, 'truth'], kind: 'object.truth', sceneId: scene.id, where: `${where}・真相` });
    });
    scene.lines.forEach((line, li) => {
      const p = [...base, 'lines', li];
      const n = `第 ${li + 1} 句`;
      const note = line.if ? `if: ${line.if}` : undefined;
      if (isChoice(line)) {
        if (line.prompt != null) out.push({ path: [...p, 'prompt'], kind: 'choice.prompt', sceneId: scene.id, where: `${n}・選項提示`, note });
        line.choice.forEach((opt, oi) => {
          const extra = [opt.if ? `if: ${opt.if}` : '', opt.requires ? `requires: ${[opt.requires].flat().join(', ')}` : '']
            .filter(Boolean)
            .join('　');
          out.push({
            path: [...p, 'choice', oi, 'text'],
            kind: 'option.text',
            sceneId: scene.id,
            where: `${n}・選項 ${oi + 1}`,
            note: extra || undefined,
          });
        });
      } else if (isMemoryReview(line)) {
        if (line.memoryReview.intro != null) {
          out.push({ path: [...p, 'memoryReview', 'intro'], kind: 'memoryReview.intro', sceneId: scene.id, where: `${n}・記憶對照開頭`, note });
        }
      } else {
        out.push({ path: [...p, 'text'], kind: 'line.text', sceneId: scene.id, where: `${n}・${who(line.speaker)}`, note });
      }
    });
  });
  (script.endings ?? []).forEach((e, ei) => {
    out.push({ path: ['endings', ei, 'title'], kind: 'ending.title', sceneId: null, where: `結局 ${e.id}・標題` });
  });
  return out;
}

export function getAt(obj: unknown, path: Path): unknown {
  return path.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)?.[k], obj);
}

export function setAt(obj: unknown, path: Path, value: unknown): void {
  const parent = getAt(obj, path.slice(0, -1)) as Record<string | number, unknown>;
  parent[path[path.length - 1]] = value;
}

/** 把所有可編輯的文字換成固定值後序列化；兩份腳本結果相同，表示只改了文字。 */
export function structureOf(script: Script): string {
  const copy = structuredClone(script);
  for (const f of editableFields(copy)) setAt(copy, f.path, '');
  return JSON.stringify(copy);
}

/** 格式化成好讀的 JSON：短的物件或陣列放在同一行，長的才展開。 */
export function formatScript(script: Script, width = 110): string {
  return fmt(script, '', width) + '\n';
}

function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

function fmt(v: unknown, indent: string, width: number, prefix = 0): string {
  const one = inline(v);
  if (!v || typeof v !== 'object' || indent.length + prefix + one.length <= width) return one;
  const inner = indent + '  ';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[\n${v.map((x) => inner + fmt(x, inner, width)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  return `{\n${entries
    .map(([k, x]) => `${inner}${JSON.stringify(k)}: ${fmt(x, inner, width, JSON.stringify(k).length + 2)}`)
    .join(',\n')}\n${indent}}`;
}
