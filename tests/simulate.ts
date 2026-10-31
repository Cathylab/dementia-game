// 在 Node 端模擬所有選擇組合，找出可以抵達的結局（不經過瀏覽器）。
import { ENDING_TARGET, pickEnding } from '../src/script';
import { isChoice, type Script } from '../src/types';

interface State {
  scene: string;
  stats: Record<string, number>;
  flags: string[];
  path: string[];
}

export function reachableEndings(script: Script): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const scenes = new Map(script.scenes.map((s) => [s.id, s]));
  const range = script.meta.statRange ?? { min: -Infinity, max: Infinity };
  const stack: State[] = [{ scene: script.scenes[0].id, stats: { ...script.meta.stats }, flags: [], path: [] }];
  let guard = 0;
  while (stack.length && guard++ < 100_000) {
    const st = stack.pop()!;
    let target = st.scene;
    if (target === ENDING_TARGET) {
      const e = pickEnding(script, st.stats, st.flags);
      if (e && !found.has(e.id)) found.set(e.id, st.path);
      continue;
    }
    const scene = scenes.get(target);
    if (!scene) continue;
    if (scene.id.startsWith('end_')) {
      const e = script.endings.find((x) => x.scene === scene.id);
      if (e && !found.has(e.id)) found.set(e.id, st.path);
      continue;
    }
    const choiceIdx = scene.lines.findIndex(isChoice);
    if (choiceIdx < 0) {
      stack.push({ ...st, scene: scene.next ?? ENDING_TARGET });
      continue;
    }
    const line = scene.lines[choiceIdx];
    if (!isChoice(line)) continue;
    line.choice.forEach((opt, i) => {
      const stats = { ...st.stats };
      for (const [k, v] of Object.entries(opt.effects ?? {})) {
        stats[k] = Math.min(range.max, Math.max(range.min, (stats[k] ?? 0) + v));
      }
      const flags = [...new Set([...st.flags, ...(opt.flags ?? [])])];
      const flat = line.fx?.includes('flat_options');
      target = (flat ? line.choice[0].goto : opt.goto) ?? scene.next ?? ENDING_TARGET;
      stack.push({ scene: target, stats, flags, path: [...st.path, `${scene.id}#${i}`] });
    });
  }
  return found;
}
