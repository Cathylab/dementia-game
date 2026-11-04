// 分組角色卡頁面（#/roles，需求書 6-3）。
import { el } from '../util';
import { ROLES, roleTasks } from './roles';

/** 角色卡頁面（#/roles）：四張卡，可以列印後發給各組。 */
export function renderRoles(root: HTMLElement): void {
  const print = el('button', { type: 'button', class: 'g-btn primary g-noprint', 'data-guide': 'print-roles' }, ['列印角色卡']);
  print.onclick = () => window.print();
  root.replaceChildren(
    el('nav', { class: 'g-crumbs g-noprint' }, [el('a', { href: '#/' }, ['← 回首頁']), el('a', { href: 'javascript:history.back()' }, ['回上一頁'])]),
    el('section', { class: 'g-section g-noprint' }, [
      el('h1', {}, ['分組角色卡']),
      el('p', {}, ['每組約 4 人，一人一個角色。人數少時可以一人兼兩個角色；每個人都要參與「全組」的任務。']),
      print,
    ]),
    ...ROLES.map((r) =>
      el('section', { class: 'g-section g-role-card', 'data-role': r.id }, [
        el('p', { class: 'g-kicker' }, ['角色卡']),
        el('h2', {}, [r.title]),
        el('p', {}, [r.summary]),
        el('ul', {}, r.tips.map((t) => el('li', {}, [t]))),
        el('h3', {}, ['每一堂要做的事']),
        el(
          'ol',
          { class: 'g-role-tasks' },
          roleTasks(r.id).map((x) =>
            el('li', {}, [
              el('strong', {}, [`第 ${x.lesson} 堂・${x.title}`]),
              el('ul', {}, x.tasks.map((t) => el('li', {}, [`${t.text}（${t.minutes} 分鐘${t.role === '全組' ? '・全組' : ''}）`]))),
            ]),
          ),
        ),
      ]),
    ),
  );
}
