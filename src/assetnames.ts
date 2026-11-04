// 腳本用到的素材名稱（不含副檔名）。開發者面板「上傳素材」與專案檔匯出共用，不碰 DOM。
import { neededSprites } from './script';
import { isText, type Script } from './types';
import { voiceEntries } from './voice';

export type AssetKind = 'voice' | 'bg' | 'char' | 'fg' | 'music' | 'sfx';
export const ASSET_KINDS: AssetKind[] = ['bg', 'char', 'fg', 'voice', 'music', 'sfx'];

/** 依腳本順序、不重複。 */
export function assetNames(script: Script, kind: AssetKind): string[] {
  const names = new Set<string>();
  // 封面放在背景圖資料夾
  if (kind === 'bg') for (const c of [script.meta?.cover, script.meta?.coverPortrait]) if (c) names.add(c);
  if (kind === 'voice') for (const v of voiceEntries(script)) names.add(v.id);
  if (kind === 'char') for (const s of neededSprites(script)) names.add(`${s.charId}_${s.expression}`);
  for (const scene of script.scenes) {
    if (kind === 'bg' && scene.background) names.add(scene.background);
    if (kind === 'fg' && scene.foreground) names.add(scene.foreground);
    if (kind === 'music' && scene.music) names.add(scene.music);
    for (const obj of scene.objects ?? []) {
      if (kind === 'fg' && obj.image) names.add(obj.image);
      if (kind === 'sfx' && obj.sfx) names.add(obj.sfx);
    }
    for (const line of scene.lines) {
      if (!isText(line)) continue;
      if (kind === 'fg' && line.wrongObject) names.add(line.wrongObject);
      if (kind === 'bg' && line.timeSkipTo) names.add(line.timeSkipTo);
      if (kind === 'music' && line.music) names.add(line.music);
      if (kind === 'sfx' && line.sfx) names.add(line.sfx);
    }
  }
  return [...names];
}
