// 老師工作台（需求書 6-6）：一次載入全班的代貼單，逐組把提示詞貼給 AI、貼回回答、下載回覆檔（或全部打包）。
// 內容只存在老師這台電腦的瀏覽器（localStorage），不送到任何地方。
import { zipSync } from 'fflate';
import { copyText } from '../clipboard';
import { downloadBlob } from '../project';
import { el } from '../util';
import { parseRequest, relayFileName, replyText, type RelayRequest } from './relay';

interface Item extends RelayRequest {
  answer: string;
}

const KEY = 'vn-teacher-relay';

function load(): Item[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Item[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function store(items: Item[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* 存不了就算了：這次頁面還是能用 */
  }
}

export function renderTeacher(root: HTMLElement): void {
  let items = load();
  const msg = el('p', { class: 'g-status', 'data-guide': 'teacher-status', 'aria-live': 'polite' });
  const list = el('div', { class: 'g-teacher-list' });

  const add = (texts: string[]) => {
    let ok = 0;
    for (const t of texts) {
      const r = parseRequest(t);
      if (!r) continue;
      // 同一組同一步驟再交一次：換成新的提示詞，保留已經貼的回答
      const old = items.find((x) => x.group === r.group && x.step === r.step && x.title === r.title);
      if (old) old.prompt = r.prompt;
      else items.push({ ...r, answer: '' });
      ok++;
    }
    store(items);
    msg.textContent = ok ? `加入 ${ok} 張代貼單。` : '沒有讀到代貼單（檔案開頭應該是「【代貼單】」）。';
    render();
  };

  const files = el('input', { type: 'file', name: 'teacher-files', accept: '.txt,text/plain', multiple: '' });
  files.onchange = async () => {
    const fs = [...(files.files ?? [])];
    files.value = '';
    add(await Promise.all(fs.map((f) => f.text())));
  };
  const pasteBox = el('textarea', { name: 'teacher-paste', rows: '4', placeholder: '或把學生複製給你的代貼單貼在這裡' });
  const pasteAdd = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'teacher-add' }, ['加入']);
  pasteAdd.onclick = () => {
    add([pasteBox.value]);
    pasteBox.value = '';
  };
  const all = el('button', { type: 'button', class: 'g-btn primary', 'data-guide': 'teacher-download-all' }, ['下載全部回覆（壓縮檔）']);
  all.onclick = () => {
    const done = items.filter((x) => x.answer.trim());
    if (!done.length) {
      msg.textContent = '還沒有任何一組有回答。';
      return;
    }
    const enc = new TextEncoder();
    const zip: Record<string, Uint8Array> = {};
    for (const x of done) zip[relayFileName('回覆', x)] = enc.encode(replyText(x));
    downloadBlob(new Blob([zipSync(zip) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), '回覆檔.zip');
    msg.textContent = `已下載 ${done.length} 份回覆。`;
  };
  const clear = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'teacher-clear' }, ['清空']);
  clear.onclick = () => {
    if (!confirm('清空所有代貼單與回答？')) return;
    items = [];
    store(items);
    render();
  };

  function render(): void {
    list.replaceChildren(
      ...(items.length
        ? items.map((x, i) => {
            const answer = el('textarea', { name: 'teacher-answer', rows: '6', placeholder: '把 AI 的回答整段貼在這裡（先看過內容適不適合學生）' });
            answer.value = x.answer;
            answer.oninput = () => {
              x.answer = answer.value;
              store(items);
              state.textContent = x.answer.trim() ? '已貼回答' : '還沒有回答';
            };
            const state = el('span', { class: 'g-meta' }, [x.answer.trim() ? '已貼回答' : '還沒有回答']);
            const copy = el('button', { type: 'button', class: 'g-btn primary', 'data-guide': 'teacher-copy' }, ['複製提示詞']);
            copy.onclick = () =>
              void copyText(x.prompt).then((ok) => {
                copy.textContent = ok ? '已複製，去貼給 AI' : '複製失敗';
                window.setTimeout(() => (copy.textContent = '複製提示詞'), 1500);
              });
            const download = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'teacher-download' }, ['下載回覆檔']);
            download.onclick = () => {
              if (!x.answer.trim()) {
                msg.textContent = `${x.group || '這一組'}還沒有回答。`;
                return;
              }
              downloadBlob(new Blob([replyText(x)], { type: 'text/plain;charset=utf-8' }), relayFileName('回覆', x));
            };
            const remove = el('button', { type: 'button', class: 'g-btn' }, ['移除']);
            remove.onclick = () => {
              items.splice(i, 1);
              store(items);
              render();
            };
            return el('section', { class: 'g-section g-relay-item', 'data-relay': `${x.group}|${x.step}` }, [
              el('h3', {}, [`${x.group || '（沒有填組別）'}・${x.stepTitle}`]),
              el('p', { class: 'g-meta' }, [`作品：${x.title || '（沒有名稱）'}　`, state]),
              el('details', {}, [el('summary', {}, ['看提示詞']), el('pre', { class: 'g-prompt' }, [x.prompt])]),
              el('div', { class: 'g-actions' }, [copy]),
              answer,
              el('div', { class: 'g-actions' }, [download, remove]),
            ]);
          })
        : [el('p', { class: 'g-meta' }, ['還沒有代貼單。'])]),
    );
  }

  render();
  root.replaceChildren(
    el('nav', { class: 'g-crumbs' }, [el('a', { href: '#/' }, ['← 回首頁']), el('a', { href: '#/showcase' }, ['班級展示']), el('a', { href: '#/docs' }, ['給老師的文件'])]),
    el('section', { class: 'g-section' }, [
      el('h1', {}, ['老師工作台：代貼提示詞']),
      el('p', {}, [
        '未成年學生使用 AI 服務常有年齡限制。學生在需要 AI 的步驟按「請老師代貼」，下載代貼單交給你；你在這裡把提示詞貼給 AI，',
        el('strong', {}, ['先看過回答適不適合學生']),
        '，再下載回覆檔還給他們。',
      ]),
      el('ol', { class: 'g-howto' }, [
        el('li', {}, ['載入學生交來的代貼單（可以一次選很多個檔案）。']),
        el('li', {}, ['每一組按「複製提示詞」，貼給 AI（ChatGPT、Claude、Gemini 等）。']),
        el('li', {}, ['把 AI 的回答貼回該組的框，看過內容。']),
        el('li', {}, ['按「下載回覆檔」，或最後按「下載全部回覆」一次打包，發還給各組。學生在同一步按「讀取老師的回覆檔」。']),
      ]),
      el('label', { class: 'g-field' }, [el('span', { class: 'g-field-label' }, ['載入代貼單']), files]),
      pasteBox,
      el('div', { class: 'g-actions' }, [pasteAdd, all, clear]),
      msg,
      el('p', { class: 'g-meta' }, ['代貼單與回答只存在這台電腦的瀏覽器裡，不會送到任何地方。']),
    ]),
    list,
  );
}
