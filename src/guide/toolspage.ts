// 製作者工具頁：線上 tools.html（或 #/tools），離線「開始.html#/tools」。
// 只有工具的入口：每個遊戲的開發者面板、故事編輯器、配音總表。單純玩遊戲用 play.html。
import { EMBED } from '../embed';
import { DEFAULT_PROJECT } from '../paths';
import type { StoredProject } from '../projectstore';
import { el } from '../util';
import { gameHref } from './links';

export interface ToolsProject {
  dir: string;
  kind: 'example' | 'template';
  title: string;
}

/** 工具頁的網址（線上是獨立的 tools.html；離線只有「開始.html」，用 #/tools）。 */
export function toolsHref(): string {
  return EMBED ? '#/tools' : 'tools.html';
}

/** 首頁的網址（從工具頁回去）。 */
function homeHref(): string {
  return EMBED ? '#/' : './';
}

function toolRow(base: Record<string, string>, key: string, withVoice: boolean): HTMLElement {
  const link = (label: string, extra: Record<string, string>, tool: string) =>
    el('a', { class: 'g-btn', href: gameHref({ ...base, ...extra }), 'data-tool': `${key}-${tool}` }, [label]);
  return el('div', { class: 'g-actions' }, [
    link('玩', {}, 'play'),
    link('開發者面板', { dev: '1' }, 'dev'),
    link('故事編輯器', { story: '1' }, 'story'),
    link('素材', { story: 'assets' }, 'assets'),
    ...(withVoice ? [link('配音總表', { voice: '1' }, 'voice')] : []),
  ]);
}

/** 工具頁：原版與範本的工具；這個瀏覽器裡有自己的專案時也列出來。 */
export function renderTools(root: HTMLElement, projects: Promise<ToolsProject[]>, own: StoredProject | null): void {
  const list = el('div', { 'data-guide': 'tools-projects' }, ['讀取中…']);
  void projects.then((all) => {
    const items = all.length ? all : [{ dir: DEFAULT_PROJECT, kind: 'example' as const, title: '寫給未來的我' }];
    // 原版（Demo）排第一個
    items.sort((a, b) => Number(b.dir === DEFAULT_PROJECT) - Number(a.dir === DEFAULT_PROJECT) || a.kind.localeCompare(b.kind));
    list.replaceChildren(
      ...items.map((p) =>
        el('section', { class: 'g-section', 'data-tools-project': p.dir }, [
          el('h2', {}, [p.kind === 'template' ? `${p.dir.split('/').pop()}範本` : `《${p.title}》${p.dir === DEFAULT_PROJECT ? '原版' : ''}`]),
          toolRow({ project: p.dir, site: '1' }, p.dir === DEFAULT_PROJECT ? 'demo' : p.dir, p.kind === 'example'),
        ]),
      ),
    );
  });

  root.replaceChildren(
    el('nav', { class: 'g-crumbs' }, [el('a', { href: homeHref(), 'data-guide': 'tools-home' }, ['← 引導網站'])]),
    el('header', { class: 'g-section' }, [
      el('h1', {}, ['製作者工具']),
      el('p', {}, [
        '這一頁只有工具：開發者面板、故事編輯器、素材、配音總表。只想玩遊戲的人，給他們遊戲的網址就好（',
        el('a', { href: gameHref({ project: DEFAULT_PROJECT, site: '1' }), 'data-guide': 'tools-game-link' }, ['遊戲']),
        '）。',
      ]),
    ]),
    list,
    ...(own
      ? [
          el('section', { class: 'g-section', 'data-tools-project': 'local' }, [
            el('h2', {}, [`我在這個瀏覽器做的遊戲：《${own.script.meta.title}》`]),
            el('p', { class: 'g-meta' }, ['存在這台電腦的這個瀏覽器裡（本機專案）。']),
            toolRow({ local: '1' }, 'local', false),
          ]),
        ]
      : []),
  );
}
