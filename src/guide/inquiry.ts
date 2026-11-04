// 分組角色卡、查證引導、刻板印象檢查清單（需求書 6-3、6-4）。
import { el } from '../util';
import { registerTool, type StepContext } from './guide';
import { STEREOTYPE_CHECKLIST } from './roles';
import { debounce } from './pending';
import type { Answers, SourceRow } from './prompts';

// ───────── 刻板印象檢查清單 ─────────

registerTool(
  {
    id: 'stereotype',
    title: '有沒有寫成刻板印象？',
    what: '試玩之後，全組一起逐條檢查。有疑問的地方，回頭查資料來源或請教老師。',
    why: '',
    time: '約 10 分鐘',
    ai: false,
  },
  (ctx: StepContext) => {
    const a = ctx.state.answers as Answers;
    const checked = new Set(a.stereotype ?? []);
    const persist = debounce(() => void ctx.save());
    const count = el('p', { class: 'g-status', 'data-guide': 'stereotype-count' });
    const update = () => {
      count.textContent = `${checked.size} / ${STEREOTYPE_CHECKLIST.length} 條確認過了${checked.size === STEREOTYPE_CHECKLIST.length ? '。' : '；沒打勾的那幾條，請全組討論怎麼改。'}`;
      count.classList.toggle('ok', checked.size === STEREOTYPE_CHECKLIST.length);
    };
    update();
    return el('div', { class: 'g-checklist', 'data-guide': 'stereotype' }, [
      ...STEREOTYPE_CHECKLIST.map((item) => {
        const box = el('input', { type: 'checkbox', name: 'stereotype-check' });
        box.checked = checked.has(item);
        box.onchange = () => {
          if (box.checked) checked.add(item);
          else checked.delete(item);
          a.stereotype = [...checked];
          update();
          persist();
        };
        return el('label', { class: 'g-radio' }, [box, item]);
      }),
      count,
    ]);
  },
);

// ───────── 查證引導：資料來源表 ─────────

function emptyRow(): SourceRow {
  return { claim: '', source: '', url: '', date: new Date().toISOString().slice(0, 10) };
}

registerTool(
  {
    id: 'sources',
    title: '查證：資料來源表',
    what: '故事裡寫到的每一個症狀或處境，都寫下資料來源。之後給 AI 的提示詞會附上這張表，請 AI 只依這些資料寫。',
    why: '',
    time: '約 10～20 分鐘',
    ai: false,
  },
  (ctx: StepContext) => {
    const a = ctx.state.answers as Answers;
    const rows = (a.sources ??= [emptyRow()]);
    const persist = debounce(() => void ctx.save());
    const root = el('div', { class: 'g-form', 'data-guide': 'sources' });
    const render = () => {
      root.replaceChildren(
        el('p', { class: 'g-meta' }, [
          '好的來源：政府機關（例如衛生福利部）、相關協會或基金會、醫院的衛教資料、專業書籍。網路論壇、影片留言、聽說的不算。查不到來源的內容，先不要寫進故事。',
        ]),
        ...rows.map((r, i) => {
          const field = (key: keyof SourceRow, placeholder: string, type = 'text') => {
            const input = el('input', { type, name: `source-${key}`, placeholder });
            input.value = r[key];
            input.oninput = () => {
              r[key] = input.value;
              persist();
            };
            return input;
          };
          const remove = el('button', { type: 'button', class: 'g-btn' }, ['刪除']);
          remove.onclick = () => {
            rows.splice(i, 1);
            if (!rows.length) rows.push(emptyRow());
            persist();
            render();
          };
          return el('fieldset', { class: 'g-fieldset', 'data-source': String(i) }, [
            el('legend', {}, [`第 ${i + 1} 筆`]),
            field('claim', '寫進故事的症狀或處境，例如：想不起熟人的名字'),
            el('div', { class: 'g-row' }, [field('source', '來源名稱，例如：台灣失智症協會'), field('url', '網址（可以空白）', 'url')]),
            el('div', { class: 'g-row' }, [el('span', { class: 'g-meta' }, ['查證日期']), field('date', '', 'date'), remove]),
          ]);
        }),
        (() => {
          const add = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'source-add' }, ['＋ 再一筆']);
          add.onclick = () => {
            rows.push(emptyRow());
            persist();
            render();
          };
          return el('div', { class: 'g-actions' }, [add]);
        })(),
      );
    };
    render();
    return root;
  },
);
