// 配音（v3）：列出腳本裡所有有配音的句子。腳本檢查、開發者頁面「配音總表」與測試共用，不碰 DOM。
import { isChoice, isText, type Script } from './types.ts';

export type VoiceKind = 'line' | 'prompt' | 'truth';

export interface VoiceEntry {
  /** 配音編號，也是檔名（不含副檔名）。 */
  id: string;
  kind: VoiceKind;
  /** 所在場景；truth 是物件所在的場景。 */
  scene: string;
  /** 說話的人（角色 id、narrator 或 player）。prompt 與 truth 從編號末段取得。 */
  speaker: string;
  /** 唸的文字：台詞、prompt 或 truth。 */
  text: string;
  /** 在腳本裡的位置，例如 a1_s01.lines[3]。 */
  where: string;
  /** truth 用：物件 id。 */
  objectId?: string;
}

/** 依腳本順序列出所有配音句。 */
export function voiceEntries(script: Script): VoiceEntry[] {
  const out: VoiceEntry[] = [];
  for (const scene of script.scenes) {
    scene.lines.forEach((line, i) => {
      const where = `${scene.id}.lines[${i}]`;
      if (isChoice(line)) {
        if (line.voice) {
          const speaker = line.voice.slice(scene.id.length + 4) || '';
          out.push({ id: line.voice, kind: 'prompt', scene: scene.id, speaker, text: line.prompt ?? '', where });
        }
      } else if (isText(line) && line.voice) {
        out.push({ id: line.voice, kind: 'line', scene: scene.id, speaker: line.speaker, text: line.text, where });
      }
    });
    (scene.objects ?? []).forEach((obj, j) => {
      if (!obj.truthVoice) return;
      const speaker = obj.truthVoice.startsWith(`mr_${obj.id}_`) ? obj.truthVoice.slice(obj.id.length + 4) : '';
      out.push({
        id: obj.truthVoice,
        kind: 'truth',
        scene: scene.id,
        speaker,
        text: obj.truth ?? '',
        where: `${scene.id}.objects[${j}]`,
        objectId: obj.id,
      });
    });
  }
  return out;
}

/** 編號格式：台詞與 prompt 是 {場景id}_{兩位序號}_{speaker}，truth 是 mr_{物件id}_{speaker}。 */
export function voiceIdLooksRight(e: VoiceEntry, speakers: Set<string>): boolean {
  if (e.kind === 'truth') {
    const m = e.id.match(new RegExp(`^mr_${escape(e.objectId ?? '')}_(.+)$`));
    return !!m && speakers.has(m[1]);
  }
  const m = e.id.match(new RegExp(`^${escape(e.scene)}_(\\d{2})_(.+)$`));
  if (!m || !speakers.has(m[2])) return false;
  return e.kind === 'prompt' || m[2] === e.speaker;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
