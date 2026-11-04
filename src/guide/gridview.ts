// 「照格子填」的畫面（需求書 6-2）：學生照格子填完，按一下就產生可以玩的劇本，不需要 AI。
import { checkScript, hasBlocking } from '../checks';
import { renderIssues, issueSummary } from '../issueview';
import { loadPack } from '../packloader';
import type { FxTag } from '../types';
import { el } from '../util';
import { registerTool, type StepContext } from './guide';
import { emptyGrid, emptyScene, gridMissing, gridToScript, PLACES, type Grid, type Who } from './grid';
import { gameHref } from './links';
import { debounce } from './pending';
import type { Answers } from './prompts';

const FX_LABEL: Partial<Record<FxTag, string>> = {
  name_fade: '名字想不起來',
  text_blur: '字看不清楚',
  repeat_line: '同一句話說兩次',
  choice_vanish: '選項一個個消失',
  flat_options: '選什麼都一樣',
  wrong_object: '東西不在該在的地方',
  time_skip: '突然回到別的時間',
  desaturate: '世界失去顏色',
  focus_drift: '注意力飄走',
  look_around: '不知道自己在哪裡',
  muffle: '聲音變悶、聽不清楚',
};

function input(value: string, attrs: Record<string, string>, onInput: (v: string) => void): HTMLInputElement {
  const i = el('input', { type: 'text', ...attrs });
  i.value = value;
  i.oninput = () => onInput(i.value);
  return i;
}

function area(value: string, attrs: Record<string, string>, onInput: (v: string) => void): HTMLTextAreaElement {
  const t = el('textarea', { rows: '3', ...attrs });
  t.value = value;
  t.oninput = () => onInput(t.value);
  return t;
}

registerTool(
  {
    id: 'grid',
    title: '照格子填（不用 AI）',
    what: '照格子填角色、2～3 個場景（每場一個選擇）和兩個結局，按「產生劇本」就有一個可以玩的短篇。',
    why: '',
    time: '約 30～60 分鐘',
    ai: false,
  },
  (ctx: StepContext) => {
    const a = ctx.state.answers as Answers & { grid?: Grid };
    const g: Grid = (a.grid ??= emptyGrid());
    const root = el('div', { class: 'g-form g-grid', 'data-guide': 'grid' });
    const persist = debounce(() => void ctx.save());
    let effects: FxTag[] = [];
    const packId = a.theme?.pack ?? (ctx.project.script.meta.pack as string | undefined) ?? 'plain';

    const result = el('div', { class: 'g-result', 'data-guide': 'grid-result', 'aria-live': 'polite' });

    const whoSelect = (value: Who, onChange: (w: Who) => void) => {
      const s = el('select', { name: 'grid-who' });
      s.append(el('option', { value: 'narrator' }, ['旁白']), el('option', { value: 'player' }, ['主角（心裡的話）']));
      g.chars.forEach((c, i) => s.append(el('option', { value: String(i) }, [c.name.trim() || `角色 ${i + 1}`])));
      s.value = String(value);
      s.onchange = () => {
        onChange(s.value === 'narrator' || s.value === 'player' ? s.value : Number(s.value));
        persist();
      };
      return s;
    };

    const render = () => {
      const chars = el('fieldset', { class: 'g-fieldset' }, [
        el('legend', {}, ['角色（主角不用填，主角心裡的話選「主角」）']),
        ...g.chars.map((c, i) =>
          el('div', { class: 'g-row' }, [
            input(c.name, { name: 'grid-char-name', placeholder: `角色 ${i + 1} 的名字，例如 媽媽` }, (v) => {
              c.name = v;
              persist();
            }),
            input(c.relation, { name: 'grid-char-relation', placeholder: '和主角的關係，例如 女兒' }, (v) => {
              c.relation = v;
              persist();
            }),
          ]),
        ),
      ]);
      // 名字改完（離開欄位）時，更新各場「誰說的」選單
      chars.addEventListener('change', () => render());
      if (g.chars.length < 3) {
        const add = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'grid-add-char' }, ['＋ 角色']);
        add.onclick = () => {
          g.chars.push({ name: '', relation: '' });
          persist();
          render();
        };
        chars.append(add);
      }

      const count = el('select', { name: 'grid-scene-count' }, [el('option', { value: '2' }, ['2 個場景']), el('option', { value: '3' }, ['3 個場景'])]);
      count.value = String(g.scenes.length);
      count.onchange = () => {
        const n = Number(count.value);
        while (g.scenes.length < n) g.scenes.push(emptyScene(g.scenes.length));
        g.scenes.length = n;
        persist();
        render();
      };

      const scenes = g.scenes.map((s, i) => {
        const place = el('select', { name: 'grid-place' }, PLACES.map((p) => el('option', { value: p.id }, [p.label])));
        place.value = s.place;
        place.onchange = () => {
          s.place = place.value as Grid['scenes'][number]['place'];
          persist();
        };
        const effect = el('select', { name: 'grid-effect' }, [
          el('option', { value: '' }, ['不用效果']),
          ...effects.map((f) => el('option', { value: f }, [`${FX_LABEL[f] ?? f}（${f}）`])),
        ]);
        effect.value = effects.includes(s.effect as FxTag) ? s.effect : '';
        effect.onchange = () => {
          s.effect = effect.value as FxTag | '';
          persist();
        };
        const better = (k: 0 | 1) => {
          const r = el('input', { type: 'radio', name: `grid-better-${i}`, value: String(k) });
          r.checked = s.better === k;
          r.onchange = () => {
            s.better = k;
            persist();
          };
          return el('label', { class: 'g-inline' }, [r, '比較靠近的選擇']);
        };
        return el('fieldset', { class: 'g-fieldset', 'data-grid-scene': String(i) }, [
          el('legend', {}, [`第 ${i + 1} 場`]),
          el('div', { class: 'g-row' }, [
            input(s.title, { name: 'grid-title', placeholder: '時間・地點，例如 轉學第一天・教室' }, (v) => {
              s.title = v;
              persist();
            }),
            place,
          ]),
          area(s.happen, { name: 'grid-happen', placeholder: '發生什麼（旁白）：一行一句，例如\n早上八點，教室裡很吵。\n沒有人認識我。' }, (v) => {
            s.happen = v;
            persist();
          }),
          el('p', { class: 'g-meta' }, ['對話（可以空白）：']),
          ...s.lines.map((l) =>
            el('div', { class: 'g-row' }, [
              whoSelect(l.who, (w) => (l.who = w)),
              input(l.text, { name: 'grid-line', placeholder: '說了什麼' }, (v) => {
                l.text = v;
                persist();
              }),
            ]),
          ),
          el('p', { class: 'g-meta' }, ['這一場的選擇：']),
          input(s.prompt, { name: 'grid-prompt', placeholder: '選項上方的提示（可以空白），例如 你要怎麼回答？' }, (v) => {
            s.prompt = v;
            persist();
          }),
          ...s.options.map((o, k) =>
            el('div', { class: 'g-option' }, [
              input(o.text, { name: 'grid-option', placeholder: `選項 ${k + 1}` }, (v) => {
                o.text = v;
                persist();
              }),
              input(o.reply, { name: 'grid-reply', placeholder: '選了之後發生什麼（一句）' }, (v) => {
                o.reply = v;
                persist();
              }),
              better(k as 0 | 1),
            ]),
          ),
          el('label', { class: 'g-row' }, [el('span', {}, ['這一場的感覺（效果）：']), effect]),
        ]);
      });

      const endings = el('fieldset', { class: 'g-fieldset' }, [
        el('legend', {}, ['結局']),
        ...g.endings.map((e, k) =>
          el('div', { class: 'g-ending' }, [
            el('p', { class: 'g-meta' }, [k === 0 ? '結局 1：玩家多半選了「比較靠近的選擇」時' : '結局 2：其他情況']),
            input(e.title, { name: 'grid-ending-title', placeholder: '結局名稱' }, (v) => {
              e.title = v;
              persist();
            }),
            area(e.text, { name: 'grid-ending-text', placeholder: '結局內容：一行一句' }, (v) => {
              e.text = v;
              persist();
            }),
          ]),
        ),
      ]);

      const make = el('button', { type: 'button', class: 'g-btn primary', 'data-guide': 'grid-make' }, ['產生劇本並套用到專案']);
      make.onclick = () => void generate();

      root.replaceChildren(chars, el('label', { class: 'g-row' }, [el('span', {}, ['場景數：']), count]), ...scenes, endings, el('div', { class: 'g-actions' }, [make]), result);
    };

    const generate = async () => {
      const missing = gridMissing(g);
      if (missing.length) {
        result.replaceChildren(el('p', { class: 'g-warn' }, ['還有這些格子沒填：']), el('ul', {}, missing.map((m) => el('li', {}, [m]))));
        return;
      }
      const pack = await loadPack(packId);
      const script = gridToScript(g, { title: a.theme?.title || ctx.project.script.meta.title, pack: packId });
      const issues = checkScript(script, pack);
      if (hasBlocking(issues)) {
        result.replaceChildren(el('p', { class: 'g-warn' }, [`產生的劇本有問題：${issueSummary(issues)}`]), renderIssues(issues));
        return;
      }
      if (!confirm('產生的劇本會取代專案裡目前的劇本（之後可以在故事編輯器繼續改）。確定嗎？')) return;
      await ctx.applyScript(script);
      a.script = { applied: true, title: script.meta.title };
      await ctx.save();
      result.replaceChildren(
        el('p', { class: 'g-status ok', 'data-guide': 'grid-done' }, [
          `✓ 已產生《${script.meta.title}》：${g.scenes.length} 個場景、${g.scenes.length} 次選擇、2 個結局。`,
        ]),
        el('div', { class: 'g-actions' }, [
          el('a', { class: 'g-btn primary', href: gameHref({}) }, ['試玩']),
          el('a', { class: 'g-btn', href: gameHref({ story: '1' }) }, ['在故事編輯器繼續改']),
        ]),
      );
    };

    render();
    void loadPack(packId).then((p) => {
      effects = p.effects;
      render();
    });
    return root;
  },
);
