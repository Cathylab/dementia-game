// 給老師的文件（需求書 6-9、6-10）：教案、評分規準、敏感題材安全守則。內容在 guide/teacher/*.md（草稿）。
import plan from '../../guide/teacher/教案.md?raw';
import rubric from '../../guide/teacher/評分規準.md?raw';
import safety from '../../guide/teacher/安全守則.md?raw';
import { el } from '../util';

export const TEACHER_DOCS: { id: string; title: string; summary: string; text: string }[] = [
  { id: 'plan', title: '教案', summary: '5～6 節課的教學流程、學習目標、課前準備與評量方式。', text: plan },
  { id: 'rubric', title: '評分規準', summary: '六個向度、四個等級；不評畫得漂不漂亮、程式厲不厲害。', text: rubric },
  { id: 'safety', title: '敏感題材的安全守則', summary: '自傷、霸凌等題材怎麼寫、怎麼引導討論、什麼時候要轉介。', text: safety },
];

const inline = (t: string): (Node | string)[] =>
  t.split(/(\*\*[^*]+\*\*)/).map((part) => (part.startsWith('**') && part.endsWith('**') ? el('strong', {}, [part.slice(2, -2)]) : part));

const cells = (line: string) =>
  line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/** 小小的 Markdown：標題、清單（兩層）、段落、粗體、表格。 */
export function teacherMarkdown(src: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  let list: HTMLElement | null = null;
  let sub: HTMLElement | null = null;
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      list = sub = null;
      continue;
    }
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) {
      list = sub = null;
      out.push(el(h[1].length === 1 ? 'h1' : h[1].length === 2 ? 'h2' : 'h3', {}, inline(h[2])));
      continue;
    }
    if (line.startsWith('|')) {
      list = sub = null;
      const head = cells(line);
      const rows: string[][] = [];
      i++;
      if (lines[i]?.trim().match(/^\|[\s:|-]+\|$/)) i++;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++].trim()));
      i--;
      out.push(
        el('div', { class: 'g-table-wrap' }, [
          el('table', { class: 'g-table' }, [
            el('thead', {}, [el('tr', {}, head.map((c) => el('th', {}, inline(c))))]),
            el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, k) => el(k === 0 ? 'th' : 'td', {}, inline(c)))))),
          ]),
        ]),
      );
      continue;
    }
    if (line.startsWith('- ')) {
      const nested = /^\s{2,}- /.test(raw);
      if (nested && list) {
        if (!sub) {
          sub = el('ul', {});
          (list.lastElementChild ?? list).append(sub);
        }
        sub.append(el('li', {}, inline(line.slice(2))));
        continue;
      }
      sub = null;
      if (!list) {
        list = el('ul', {});
        out.push(list);
      }
      list.append(el('li', {}, inline(line.slice(2))));
      continue;
    }
    list = sub = null;
    out.push(el('p', {}, inline(line)));
  }
  return out;
}

/** #/docs/{id}：一份文件，可以列印。沒有 id 時列出全部。 */
export function renderTeacherDoc(root: HTMLElement, id: string): void {
  const doc = TEACHER_DOCS.find((d) => d.id === id);
  const print = el('button', { type: 'button', class: 'g-btn primary g-noprint', 'data-guide': 'print-doc' }, ['列印']);
  print.onclick = () => window.print();
  const nav = el('nav', { class: 'g-crumbs g-noprint' }, [el('a', { href: '#/' }, ['← 回首頁']), el('a', { href: '#/docs' }, ['給老師的文件'])]);
  if (!doc) {
    root.replaceChildren(
      nav,
      el('section', { class: 'g-section' }, [
        el('h1', {}, ['給老師的文件']),
        el('p', {}, ['這些文件是草稿，還沒有經過現場老師與輔導專業審閱，請依學校的規定與班級狀況調整。']),
        el(
          'ul',
          { class: 'g-doc-list' },
          TEACHER_DOCS.map((d) => el('li', {}, [el('a', { href: `#/docs/${d.id}`, 'data-doc': d.id }, [d.title]), `：${d.summary}`])),
        ),
        el('ul', { class: 'g-doc-list' }, [
          el('li', {}, [el('a', { href: '#/roles' }, ['分組角色卡']), '：四個角色、每一堂要做的事。']),
          el('li', {}, [el('a', { href: '#/teacher' }, ['老師工作台']), '：代貼提示詞給 AI。']),
          el('li', {}, [el('a', { href: '#/showcase' }, ['班級展示']), '：一次載入全班作品輪流玩，附互評表。']),
        ]),
      ]),
    );
    return;
  }
  root.replaceChildren(nav, el('article', { class: 'g-section g-doc', 'data-teacher-doc': doc.id }, [...teacherMarkdown(doc.text), print]));
}
