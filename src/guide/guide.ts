// 引導網站（需求書 5.1）：線上版首頁與離線版「開始.html」。
// - 首頁：可以直接玩的 Demo 片段、一句話說明、開始按鈕、流程總覽、題材包與範例、製作紀錄。
// - 開始：從空白或從範例開始（建立本機專案）。
// - 步驟頁：一步一步，永遠看得到「第幾步、還剩幾步」；記得做到哪裡；可以回上一步、跳過、切到故事編輯器或試玩。
import makingOf from '../../guide/making-of.md?raw';
import { EMBED } from '../embed';
import { listPacks } from '../packloader';
import { DEFAULT_PROJECT } from '../paths';
import type { ProjectStore, StoredProject } from '../projectstore';
import { loadScript } from '../script';
import type { Script } from '../types';
import { el } from '../util';
import { gameHref } from './links';
import { loadGuideState, newGuideState, saveGuideState, type GuideState } from './state';
import { LESSON_MINUTES, LESSONS } from './lessons';
import { flushPending } from './pending';
import { STEPS, type StepDef } from './steps';
import { renderTeacher } from './teacher';
import { renderRoles } from './rolespage';
import { renderShowcase } from './showcase';
import { renderTeacherDoc } from './teacherdocs';
import './guide.css';

const BLANK = 'templates/空白';
const CLIP = { scene: 'a4_s14', from: '6' };

/** 某一步的內容（引導流程的各步驟在之後的 PR 填入）。 */
export type StepBody = (ctx: StepContext) => HTMLElement;

export interface StepContext {
  step: StepDef;
  index: number;
  state: GuideState;
  store: ProjectStore;
  project: StoredProject;
  /** 存檔（步驟填的內容改了以後呼叫）。 */
  save: () => Promise<void>;
  /** 重畫這一頁。 */
  refresh: () => void;
  /** 這一步可不可以進下一步（檢查通過才行）；不行時顯示原因。「先跳過」不受影響。 */
  setReady: (ok: boolean, why?: string) => void;
  /** 把劇本存進本機專案。 */
  applyScript: (script: Script) => Promise<void>;
}

const bodies = new Map<string, StepBody>();

/** 登記某一步的內容。 */
export function registerStep(id: string, body: StepBody): void {
  bodies.set(id, body);
}

/** 不在九個步驟裡、但可以嵌進任務卡或步驟頁的工具（例如「照格子填」）。 */
const tools = new Map<string, StepDef>();

export function registerTool(def: StepDef, body: StepBody): void {
  tools.set(def.id, def);
  bodies.set(def.id, body);
}

interface ProjectEntry {
  dir: string;
  kind: 'example' | 'template';
  title: string;
}

async function loadProjectScript(dir: string): Promise<Script> {
  const embedded = EMBED?.projects[dir]?.script;
  if (embedded) return JSON.parse(JSON.stringify(embedded)) as Script;
  return loadScript(`${import.meta.env.BASE_URL}${dir.split('/').map(encodeURIComponent).join('/')}/script.json`);
}

async function listProjects(): Promise<ProjectEntry[]> {
  if (EMBED) return Object.entries(EMBED.projects).map(([dir, p]) => ({ dir, kind: p.kind, title: p.title }));
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}projects.json`, { cache: 'no-cache' });
    if (res.ok) return (await res.json()) as ProjectEntry[];
  } catch {
    /* 讀不到 */
  }
  return [];
}

/** 很小的 Markdown：標題、清單、段落、粗體。 */
function markdown(src: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  let list: HTMLElement | null = null;
  const inline = (t: string): (Node | string)[] =>
    t.split(/(\*\*[^*]+\*\*)/).map((part) => (part.startsWith('**') && part.endsWith('**') ? el('strong', {}, [part.slice(2, -2)]) : part));
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) {
      list = null;
      continue;
    }
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) {
      list = null;
      out.push(el(h[1].length === 1 ? 'h3' : 'h4', {}, inline(h[2])));
      continue;
    }
    if (line.startsWith('- ')) {
      if (!list) {
        list = el('ul', {});
        out.push(list);
      }
      list.append(el('li', {}, inline(line.slice(2))));
      continue;
    }
    list = null;
    out.push(el('p', {}, inline(line)));
  }
  return out;
}

export class Guide {
  private state: GuideState | null = null;
  private project: StoredProject | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: ProjectStore,
  ) {
    root.classList.add('guide');
    window.addEventListener('hashchange', () => {
      flushPending();
      void this.route();
    });
  }

  async start(): Promise<void> {
    await this.reload();
    await this.route();
  }

  private async reload(): Promise<void> {
    this.project = await this.store.load().catch(() => null);
    this.state = this.project ? await loadGuideState(this.store) : null;
  }

  private async route(): Promise<void> {
    const hash = location.hash.replace(/^#\/?/, '');
    const m = hash.match(/^step\/(\d+)$/);
    const l = hash.match(/^lesson\/(\d+)$/);
    window.scrollTo(0, 0);
    if (m && this.state && this.project) return this.renderStep(Math.min(STEPS.length, Math.max(1, Number(m[1]))));
    if (l && this.state && this.project) return this.renderLesson(Math.min(LESSONS.length, Math.max(1, Number(l[1]))));
    if (hash === 'start') return this.renderStart();
    if (hash === 'teacher') return renderTeacher(this.root);
    if (hash === 'roles') return renderRoles(this.root);
    if (hash === 'showcase') return renderShowcase(this.root);
    const d = hash.match(/^docs(?:\/(\w+))?$/);
    if (d) return renderTeacherDoc(this.root, d[1] ?? '');
    return this.renderHome();
  }

  private go(hash: string): void {
    // 換頁前把延遲中的存檔寫出去
    flushPending();
    if (location.hash === `#/${hash}`) void this.route();
    else location.hash = `#/${hash}`;
  }

  // ───────── 首頁 ─────────

  private renderHome(): void {
    const s = this.state;
    const resume =
      s && this.project
        ? s.mode === 'class'
          ? el('a', { class: 'g-btn primary', href: `#/lesson/${s.lesson ?? 1}`, 'data-guide': 'resume' }, [
              `繼續做《${this.project.script.meta.title}》（第 ${s.lesson ?? 1} 堂）`,
            ])
          : el('a', { class: 'g-btn primary', href: `#/step/${s.step}`, 'data-guide': 'resume' }, [
              `繼續做《${this.project.script.meta.title}》（第 ${s.step} 步）`,
            ])
        : null;
    const begin = el('a', { class: `g-btn ${resume ? '' : 'primary'}`, href: '#/start', 'data-guide': 'begin' }, [resume ? '開始一個新的遊戲' : '開始做我的遊戲']);
    const playFull = el('a', { class: 'g-btn', href: gameHref({ project: DEFAULT_PROJECT, site: '1' }), 'data-guide': 'play-demo' }, ['玩《寫給未來的我》完整版']);

    const clip = el('iframe', {
      class: 'g-clip',
      title: '試玩片段',
      src: gameHref({ project: DEFAULT_PROJECT, site: '1', clip: CLIP.scene, from: CLIP.from }),
      allow: 'autoplay',
      loading: 'lazy',
    });

    const steps = el(
      'ol',
      { class: 'g-overview' },
      STEPS.map((st, i) =>
        el('li', {}, [
          el('span', { class: 'g-num' }, [String(i + 1)]),
          el('div', {}, [
            el('strong', {}, [st.title]),
            el('p', {}, [st.what]),
            el('p', { class: 'g-meta' }, [st.time, st.ai ? '・需要 AI' : '・不用 AI']),
          ]),
        ]),
      ),
    );

    const packs = el('div', { class: 'g-cards', 'data-guide': 'packs' }, ['讀取中…']);
    void Promise.all([listPacks(), listProjects()]).then(([packList, projects]) => {
      const examples = projects.filter((p) => p.kind === 'example');
      packs.replaceChildren(
        ...packList.map((p) =>
          el('div', { class: 'g-card' }, [
            el('strong', {}, [p.name]),
            el('p', {}, [p.description]),
            ...(p.id === 'dementia'
              ? examples.map((e) => el('a', { href: gameHref({ project: e.dir, site: '1' }) }, [`範例：玩《${e.title}》`]))
              : []),
          ]),
        ),
      );
    });

    this.root.replaceChildren(
      el('header', { class: 'g-hero' }, [
        el('p', { class: 'g-kicker' }, ['同理體驗視覺小說']),
        el('h1', {}, ['跟著步驟走，做出讓人「從裡面體會」的遊戲']),
        el('p', { class: 'g-lead' }, [
          '玩家用第一人稱經歷一種處境（失智、聽損、轉學……），介面會跟著處境一起「崩壞」。不用會寫程式、不用有圖或配音，每一步都有保底的做法。',
        ]),
        el('div', { class: 'g-actions' }, [...(resume ? [resume] : []), begin, playFull]),
        el('p', { class: 'g-meta', 'data-guide': 'class-hint' }, ['老師帶學生？按「開始做我的遊戲」後選「課堂模式」：6 堂課，每堂一張可以列印的任務卡。學生不能自己用 AI 時，可以用頁面最下方的「老師工作台」代貼提示詞。']),
      ]),
      el('section', { class: 'g-section' }, [
        el('h2', {}, ['先玩一分鐘']),
        el('p', {}, ['《寫給未來的我》的一個片段：婚禮當天的休息室。注意看選項。']),
        el('div', { class: 'g-clip-box' }, [clip]),
      ]),
      el('section', { class: 'g-section' }, [el('h2', {}, ['怎麼做：九個步驟']), steps]),
      el('section', { class: 'g-section' }, [el('h2', {}, ['題材包與範例']), packs]),
      el('section', { class: 'g-section' }, [
        el('details', { class: 'g-making' }, [el('summary', {}, ['製作紀錄：《寫給未來的我》是怎麼做出來的']), ...markdown(makingOf)]),
      ]),
      el('section', { class: 'g-section', 'data-guide': 'maker' }, [
        el('h2', {}, ['製作者入口']),
        el('p', { class: 'g-meta' }, ['打開《寫給未來的我》原版（網站上的版本，不是你在這裡做的遊戲）的製作工具。']),
        el('div', { class: 'g-actions' }, [
          el('a', { class: 'g-btn', href: gameHref({ project: DEFAULT_PROJECT, site: '1', dev: '1' }), 'data-guide': 'maker-dev' }, ['開發者面板']),
          el('a', { class: 'g-btn', href: gameHref({ project: DEFAULT_PROJECT, site: '1', voice: '1' }), 'data-guide': 'maker-voice' }, ['配音總表']),
          el('a', { class: 'g-btn', href: gameHref({ project: DEFAULT_PROJECT, site: '1', story: '1' }), 'data-guide': 'maker-story' }, ['故事編輯器']),
        ]),
      ]),
      el('footer', { class: 'g-footer' }, [
        el('a', { href: gameHref({ project: BLANK, site: '1', story: '1' }) }, ['直接打開故事編輯器（空白範本）']),
        ' ・ ',
        el('a', { href: '#/teacher', 'data-guide': 'teacher-link' }, ['老師工作台（代貼提示詞）']),
        ' ・ ',
        el('a', { href: '#/roles', 'data-guide': 'roles-link' }, ['分組角色卡']),
        ' ・ ',
        el('a', { href: '#/showcase', 'data-guide': 'showcase-link' }, ['班級展示']),
        ' ・ ',
        el('a', { href: '#/docs', 'data-guide': 'docs-link' }, ['給老師：教案、評分規準、安全守則']),
      ]),
    );
  }

  // ───────── 開始 ─────────

  private renderStart(): void {
    const existing = this.project;
    const choose = async (from: GuideState['startFrom'], mode: GuideState['mode'] = 'full') => {
      if (existing && !confirm(`這個瀏覽器裡已經有一個專案《${existing.script.meta.title}》。開始新的會取代它（沒有匯出專案檔的話會不見）。確定嗎？`)) return;
      msg.textContent = '準備中…';
      try {
        const script = await loadProjectScript(from === 'blank' ? BLANK : DEFAULT_PROJECT);
        await this.store.save({ script, files: new Map(), savedAt: Date.now() });
        const state = newGuideState(from, mode);
        await saveGuideState(this.store, state);
        await this.reload();
        this.go(mode === 'class' ? 'lesson/1' : 'step/1');
      } catch (err) {
        msg.textContent = `沒有成功：${(err as Error)?.message ?? err}`;
      }
    };
    const card = (from: GuideState['startFrom'], title: string, desc: string, mode: GuideState['mode'] = 'full') => {
      const b = el('button', { type: 'button', class: 'g-choice', 'data-guide': mode === 'class' ? 'start-class' : `start-${from}` }, [
        el('strong', {}, [title]),
        el('span', {}, [desc]),
      ]);
      b.onclick = () => void choose(from, mode);
      return b;
    };
    const msg = el('p', { class: 'g-msg', 'aria-live': 'polite' });
    this.root.replaceChildren(
      el('nav', { class: 'g-crumbs' }, [el('a', { href: '#/' }, ['← 回首頁'])]),
      el('section', { class: 'g-section' }, [
        el('h1', {}, ['從哪裡開始？']),
        el('p', {}, ['你的遊戲會存在這個瀏覽器裡（本機專案），關掉再打開還在；要換電腦時用「匯出專案檔」帶走。']),
        el('div', { class: 'g-choices' }, [
          card('blank', '從空白開始', '一個只有兩個場景的空白故事，一步一步填。適合有自己想說的故事。'),
          card('example', '從範例開始', '以《寫給未來的我》的完整劇本為底，改成你的故事。適合想先看看完整作品怎麼組成。'),
          card(
            'blank',
            '課堂模式（老師帶學生）',
            `${LESSONS.length} 堂課、每堂一張任務卡（約 ${LESSON_MINUTES} 分鐘）。做一個約 5 分鐘、2～3 個場景的小作品，每一步都可以不用 AI。`,
            'class',
          ),
        ]),
        ...(existing ? [el('p', { class: 'g-warn' }, [`注意：這個瀏覽器裡已經有《${existing.script.meta.title}》，開始新的會取代它。`])] : []),
        msg,
      ]),
    );
  }

  /** 第 5 步的另一條路：不用 AI，照格子填。 */
  /** 步驟頁下方可以展開的工具（例如第 5 步的「照格子填」）。 */
  private toolDetails(id: string, label: string, attr: string, state: GuideState, project: StoredProject): HTMLElement {
    const box = el('details', { class: 'g-alt', 'data-guide': attr }, [el('summary', {}, [label])]);
    box.addEventListener('toggle', () => {
      if (box.open && box.children.length === 1) {
        const embed = this.embedStep(id, state, project);
        if (embed) box.append(embed);
      }
    });
    return box;
  }

  /** 完整模式各步驟下方附的工具。 */
  private stepTools(stepId: string, state: GuideState, project: StoredProject): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (stepId === 'theme') out.push(this.toolDetails('sources', '查證：資料來源表（每個症狀或處境都要有來源）', 'sources-alt', state, project));
    if (stepId === 'script') out.push(this.toolDetails('grid', '不用 AI：照格子填一個短篇（2～3 個場景）', 'grid-alt', state, project));
    if (stepId === 'assets') out.push(this.toolDetails('drawings', '手繪拍照上傳・從小圖庫選', 'drawings-alt', state, project));
    if (stepId === 'playtest') out.push(this.toolDetails('stereotype', '有沒有寫成刻板印象？檢查清單', 'stereotype-alt', state, project));
    return out;
  }

  // ───────── 課堂模式 ─────────

  /** 把某一步的畫面嵌進任務卡（課堂模式不擋「下一堂」）。 */
  private embedStep(id: string, state: GuideState, project: StoredProject): HTMLElement | null {
    const k = STEPS.findIndex((x) => x.id === id);
    const def = k >= 0 ? STEPS[k] : tools.get(id);
    const body = bodies.get(id);
    if (!def || !body) return null;
    const ctx: StepContext = {
      step: def,
      index: k + 1,
      state,
      store: this.store,
      project,
      save: () => saveGuideState(this.store, state),
      refresh: () => void this.route(),
      setReady: () => {},
      applyScript: async (script) => {
        await this.store.saveScript(script);
        project.script = JSON.parse(JSON.stringify(script)) as Script;
      },
    };
    return el('section', { class: 'g-embed g-noprint', 'data-embed': id }, [el('h3', {}, [`工具：${def.title}`]), el('p', { class: 'g-meta' }, [def.what]), body(ctx)]);
  }

  private renderLesson(n: number): void {
    const state = this.state!;
    const project = this.project!;
    const lesson = LESSONS[n - 1];
    if (state.mode !== 'class' || state.lesson !== n) {
      state.mode = 'class';
      state.lesson = n;
      void saveGuideState(this.store, state);
    }
    state.done ??= [];
    const save = () => saveGuideState(this.store, state);
    const goTo = (k: number) => {
      flushPending();
      state.lesson = k;
      void save().then(() => this.go(`lesson/${k}`));
    };
    const pills = el(
      'ol',
      { class: 'g-pills lessons' },
      LESSONS.map((ls, i) => {
        const k = i + 1;
        const allDone = ls.tasks.every((t) => state.done!.includes(`${ls.id}.${t.id}`));
        return el('li', {}, [
          el('a', { href: `#/lesson/${k}`, title: ls.title, class: `${k === n ? 'current' : ''} ${allDone ? 'done' : ''}`.trim() }, [
            el('span', {}, [String(k)]),
            el('small', {}, [ls.title]),
          ]),
        ]);
      }),
    );
    const total = lesson.tasks.reduce((sum, t) => sum + t.minutes, 0);
    const tasks = el(
      'ul',
      { class: 'g-tasks' },
      lesson.tasks.map((t) => {
        const key = `${lesson.id}.${t.id}`;
        const box = el('input', { type: 'checkbox', name: 'lesson-task', 'data-task': key });
        box.checked = state.done!.includes(key);
        box.onchange = () => {
          state.done = state.done!.filter((x) => x !== key);
          if (box.checked) state.done.push(key);
          void save();
        };
        return el('li', {}, [
          el('label', { class: 'g-radio' }, [
            box,
            el('span', {}, [t.text]),
            el('small', { class: 'g-task-meta' }, [`${t.minutes} 分鐘${t.role ? `・${t.role}` : ''}`]),
          ]),
        ]);
      }),
    );
    const print = el('button', { type: 'button', class: 'g-btn g-noprint', 'data-guide': 'print' }, ['列印任務卡']);
    print.onclick = () => window.print();
    const prev = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'prev' }, ['← 上一堂']);
    prev.disabled = n === 1;
    prev.onclick = () => goTo(n - 1);
    const next = el('button', { type: 'button', class: 'g-btn primary', 'data-guide': 'next' }, [n < LESSONS.length ? '下一堂 →' : '完成']);
    next.onclick = () => (n < LESSONS.length ? goTo(n + 1) : void save().then(() => this.go('')));
    const toFull = el('a', { href: `#/step/${state.step}`, class: 'g-link', 'data-guide': 'to-full' }, ['改用完整的九個步驟']);
    toFull.onclick = () => {
      state.mode = 'full';
      void save();
    };
    const embeds = lesson.steps.map((id) => this.embedStep(id, state, project)).filter((x): x is HTMLElement => !!x);

    this.root.replaceChildren(
      el('div', { class: 'g-sticky g-noprint' }, [
        el('nav', { class: 'g-crumbs' }, [
          el('a', { href: '#/' }, ['← 首頁']),
          el('span', { class: 'g-project' }, [`《${project.script.meta.title}》`]),
          el('a', { href: gameHref({ story: '1' }), class: 'g-link', 'data-guide': 'open-editor' }, ['打開故事編輯器']),
          el('a', { href: gameHref({}), class: 'g-link', 'data-guide': 'playtest' }, ['試玩']),
        ]),
        el('div', { class: 'g-progress', 'data-guide': 'progress' }, [
          el('strong', {}, [`第 ${n} 堂，共 ${LESSONS.length} 堂`]),
          el('span', {}, [n < LESSONS.length ? `還剩 ${LESSONS.length - n} 堂` : '最後一堂']),
          toFull,
        ]),
        pills,
      ]),
      el('section', { class: 'g-section g-card-lesson', 'data-lesson': lesson.id }, [
        el('p', { class: 'g-kicker' }, [`任務卡・第 ${n} 堂${lesson.optional ? '（可以省略）' : ''}・約 ${total} 分鐘`]),
        el('h1', {}, [lesson.title]),
        el('div', { class: 'g-explain' }, [el('p', {}, [el('strong', {}, ['這堂課的目標：']), lesson.goal])]),
        el('h3', {}, ['任務']),
        tasks,
        el('details', { class: 'g-teacher', open: '' }, [el('summary', {}, ['給老師']), el('p', {}, [lesson.teacher])]),
        el('div', { class: 'g-actions g-noprint' }, [print, el('a', { class: 'g-btn', href: '#/roles', 'data-guide': 'open-roles' }, ['分組角色卡'])]),
      ]),
      ...embeds,
      el('div', { class: 'g-nav g-noprint' }, [prev, next]),
    );
  }

  // ───────── 步驟 ─────────

  private renderStep(n: number): void {
    const state = this.state!;
    const project = this.project!;
    const step = STEPS[n - 1];
    if (state.step !== n || state.maxStep < n) {
      state.step = n;
      state.maxStep = Math.max(state.maxStep, n);
      void saveGuideState(this.store, state);
    }
    const save = () => saveGuideState(this.store, state);
    const goTo = (k: number) => {
      flushPending();
      state.step = k;
      state.maxStep = Math.max(state.maxStep, k);
      void save().then(() => this.go(`step/${k}`));
    };

    const pills = el(
      'ol',
      { class: 'g-pills' },
      STEPS.map((st, i) => {
        const k = i + 1;
        const done = k < n || k <= state.maxStep;
        const a = el('a', { href: `#/step/${k}`, title: st.title, class: `${k === n ? 'current' : ''} ${done ? 'done' : ''} ${state.skipped.includes(k) ? 'skipped' : ''}`.trim() }, [
          el('span', {}, [String(k)]),
          el('small', {}, [st.title]),
        ]);
        return el('li', {}, [a]);
      }),
    );
    const progress = el('div', { class: 'g-progress', 'data-guide': 'progress' }, [
      el('strong', {}, [`第 ${n} 步，共 ${STEPS.length} 步`]),
      el('span', {}, [n < STEPS.length ? `還剩 ${STEPS.length - n} 步` : '最後一步']),
    ]);

    const next = el('button', { type: 'button', class: 'g-btn primary', 'data-guide': 'next' }, [n < STEPS.length ? '下一步 →' : '完成']);
    const nextHint = el('p', { class: 'g-next-hint', 'data-guide': 'next-hint', 'aria-live': 'polite' });
    const ctx: StepContext = {
      step,
      index: n,
      state,
      store: this.store,
      project,
      save,
      refresh: () => this.renderStep(n),
      setReady: (ok, why) => {
        next.disabled = !ok;
        nextHint.textContent = ok ? '' : (why ?? '');
      },
      applyScript: async (script) => {
        await this.store.saveScript(script);
        project.script = JSON.parse(JSON.stringify(script)) as Script;
      },
    };
    const body = bodies.get(step.id)?.(ctx) ?? el('div', { class: 'g-todo' }, [
      el('p', {}, ['這一步的操作畫面會在下一版加入。現在可以：']),
      el('ul', {}, [
        el('li', {}, ['按「先跳過，用佔位內容」繼續往下走；或']),
        el('li', {}, ['按「打開故事編輯器」自己寫，寫完再回來。']),
      ]),
    ]);

    const prev = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'prev' }, ['← 上一步']);
    prev.disabled = n === 1;
    prev.onclick = () => goTo(n - 1);
    next.onclick = () => {
      state.skipped = state.skipped.filter((k) => k !== n);
      if (n < STEPS.length) goTo(n + 1);
      else void save().then(() => this.go(''));
    };
    const skip = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'skip' }, ['先跳過，用佔位內容']);
    skip.hidden = n === STEPS.length;
    skip.onclick = () => {
      if (!state.skipped.includes(n)) state.skipped.push(n);
      goTo(n + 1);
    };

    this.root.replaceChildren(
      el('div', { class: 'g-sticky' }, [
        el('nav', { class: 'g-crumbs' }, [
          el('a', { href: '#/' }, ['← 首頁']),
          el('span', { class: 'g-project' }, [`《${project.script.meta.title}》`]),
          el('a', { href: gameHref({ story: '1' }), class: 'g-link', 'data-guide': 'open-editor' }, ['打開故事編輯器']),
          el('a', { href: gameHref({}), class: 'g-link', 'data-guide': 'playtest' }, ['試玩']),
        ]),
        progress,
        pills,
      ]),
      el('section', { class: 'g-section g-step', 'data-step': step.id }, [
        el('h1', {}, [`${n}. ${step.title}`]),
        el('p', { class: 'g-meta' }, [step.time, step.ai ? '・需要 AI（離線時：提示詞照樣能複製，到有網路的地方再貼給 AI）' : '・不用 AI']),
        el('div', { class: 'g-explain' }, [
          el('p', {}, [el('strong', {}, ['要做什麼：']), step.what]),
          el('p', {}, [el('strong', {}, ['為什麼：']), step.why]),
        ]),
        body,
        ...this.stepTools(step.id, state, project),
        el('div', { class: 'g-nav' }, [prev, skip, next]),
        nextHint,
      ]),
    );
  }
}
