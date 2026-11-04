// 素材清單（需求書 5.4）：劇本需要哪些素材、用在哪裡、要畫／錄什麼。不碰 DOM。
import { ASSET_KINDS, assetNames, type AssetKind } from './assetnames.ts';
import { neededSprites } from './script.ts';
import { isText, type Scene, type Script } from './types.ts';
import { voiceEntries } from './voice.ts';

export const KIND_LABEL: Record<AssetKind, string> = {
  bg: '背景',
  char: '立繪',
  fg: '物品圖',
  voice: '配音',
  music: '背景音樂',
  sfx: '音效',
};

export interface AssetItem {
  kind: AssetKind;
  /** 檔名（不含副檔名）。 */
  name: string;
  /** 用在哪裡（白話），例如「第一幕〈便利貼〉」。 */
  uses: string[];
  /** 第一個用到它的場景（可以跳過去）。 */
  scene?: string;
  /** 要畫或錄什麼（從劇本推得出來的描述）。 */
  description: string;
  /** 建議的規格。 */
  spec: string;
}

const SPEC: Record<AssetKind, string> = {
  bg: 'webp，約 2304×1080（畫面寬度的 1.2 倍，左右留給視線平移）',
  char: 'webp，透明背景直式全身圖，例如 1000×1800，腳底貼齊圖片下緣',
  fg: 'webp，透明背景，物件貼齊圖片下緣，寬約 900',
  voice: 'mp3，單聲道，每句一個檔，句尾不留長靜音',
  music: 'mp3 或 ogg，可以無縫循環',
  sfx: 'mp3，短音效，只播一次',
};

const CN = '〇一二三四五六七八九';
function cn(n: number): string {
  return n < 10 ? CN[n] : n < 20 ? `十${n % 10 ? CN[n % 10] : ''}` : String(n);
}

export function sceneName(scene: Scene): string {
  const t = scene.title ? `〈${scene.title}〉` : `〈${scene.id}〉`;
  return scene.id.startsWith('end_') ? `結局${t}` : `第${cn(scene.act ?? 1)}幕${t}`;
}

/** 整理劇本需要的所有素材。 */
export function assetCatalog(script: Script): AssetItem[] {
  const items = new Map<string, AssetItem>();
  const get = (kind: AssetKind, name: string): AssetItem => {
    const key = `${kind}/${name}`;
    let it = items.get(key);
    if (!it) {
      it = { kind, name, uses: [], description: '', spec: SPEC[kind] };
      items.set(key, it);
    }
    return it;
  };
  const use = (it: AssetItem, scene: Scene, detail = '') => {
    const u = `${sceneName(scene)}${detail}`;
    if (!it.uses.includes(u)) it.uses.push(u);
    it.scene ??= scene.id;
  };
  const describe = (it: AssetItem, text: string) => {
    if (text && !it.description.includes(text)) it.description = it.description ? `${it.description}；${text}` : text;
  };

  for (const scene of script.scenes) {
    if (scene.background) {
      const it = get('bg', scene.background);
      use(it, scene);
      const first = scene.lines.find(isText);
      describe(it, `場景「${scene.title ?? scene.id}」${first && isText(first) && first.speaker === 'narrator' ? `：${first.text.slice(0, 40)}` : ''}`);
    }
    if (scene.foreground) {
      const it = get('fg', scene.foreground);
      use(it, scene, '（拿在手上）');
      describe(it, '主角拿在手上的東西');
    }
    if (scene.music) {
      const it = get('music', scene.music);
      use(it, scene);
      describe(it, `${scene.title ?? scene.id}的氣氛`);
    }
    for (const obj of scene.objects ?? []) {
      if (!obj.image) continue;
      const it = get('fg', obj.image);
      use(it, scene, `（物件「${obj.label}」）`);
      describe(it, `${obj.label}${obj.truth ? `：${obj.truth}` : ''}（要畫真相）`);
    }
    scene.lines.forEach((line, i) => {
      if (!isText(line)) return;
      if (line.wrongObject) {
        const it = get('fg', line.wrongObject);
        use(it, scene, `第 ${i + 1} 句（錯置物件）`);
        describe(it, `不該出現的東西：${line.text.slice(0, 30)}`);
      }
      if (line.timeSkipTo) use(get('bg', line.timeSkipTo), scene, `第 ${i + 1} 句（閃回）`);
      if (line.music) use(get('music', line.music), scene, `第 ${i + 1} 句起`);
      if (line.sfx) {
        const it = get('sfx', line.sfx);
        use(it, scene, `第 ${i + 1} 句`);
        describe(it, line.text.slice(0, 40));
      }
    });
  }

  // 立繪：每個角色需要的表情
  for (const { charId, expression } of neededSprites(script)) {
    const c = (script.characters ?? []).find((x) => x.id === charId);
    const it = get('char', `${charId}_${expression}`);
    describe(it, `${c?.name ?? charId}${c?.relation ? `（${c.relation}）` : ''}，表情 ${expression}${c?.trait ? `；特徵：${c.trait}` : ''}`);
    for (const scene of script.scenes) {
      if (scene.lines.some((l) => isText(l) && l.speaker === charId && (l.expression ?? 'neutral') === expression)) use(it, scene);
    }
  }

  // 配音
  for (const v of voiceEntries(script)) {
    const it = get('voice', v.id);
    const scene = script.scenes.find((s) => s.id === v.scene);
    if (scene) use(it, scene);
    const who = v.speaker === 'narrator' ? '旁白' : v.speaker === 'player' ? '主角' : (script.characters ?? []).find((c) => c.id === v.speaker)?.name ?? v.speaker;
    describe(it, `${who}：「${v.text}」`);
  }

  // 依種類、劇本順序排列
  const order = new Map(ASSET_KINDS.map((k, i) => [k, i]));
  const named = new Map(ASSET_KINDS.map((k) => [k, assetNames(script, k)]));
  return [...items.values()].sort((a, b) => {
    const k = (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0);
    if (k) return k;
    const list = named.get(a.kind) ?? [];
    return (list.indexOf(a.name) + 1 || 1e9) - (list.indexOf(b.name) + 1 || 1e9);
  });
}

/** 缺少的素材清單（文字），可以貼給美術或生圖 AI。 */
export function missingListText(items: AssetItem[], title: string): string {
  const lines = [`《${title}》還缺這些素材：`, ''];
  for (const kind of ASSET_KINDS) {
    const list = items.filter((x) => x.kind === kind);
    if (!list.length) continue;
    lines.push(`【${KIND_LABEL[kind]}】規格：${SPEC[kind]}`);
    for (const x of list) lines.push(`- ${x.name}：${x.description || '（沒有描述）'}。用在：${x.uses.join('、') || '—'}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}
