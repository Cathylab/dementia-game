// 故事編輯器：不用碰 JSON 也能做出整個故事。
// 左邊是場景列表（依幕分組，顯示會走到哪裡），右邊編輯選到的場景：基本設定、台詞、選項與去向。
// 另外有「角色」「結局」兩頁。所有修改立即套用到遊戲；可以復原；「儲存」和文字編輯器走同一條路
// （本機專案存進瀏覽器、npm run dev 寫回 script.json、線上版下載）。
import { resolveImage } from './assets';
import type { Engine } from './engine';
import { checkPastedScript, checkScript, hasBlocking, type Issue } from './checks';
import { copyText } from './clipboard';
import { ASSET_KINDS, type AssetKind } from './assetnames';
import { assetCatalog, KIND_LABEL, missingListText, type AssetItem } from './assetcatalog';
import { assetStatus, useAssetFile, type AssetStatus } from './devupload';
import { issueSummary, renderIssues } from './issueview';
import { currentPack } from './pack';
import { assetFolderLabel, projectDir } from './paths';
import { localFiles } from './localfiles';
import { ENDING_TARGET } from './script';
import {
  addCharacter,
  deleteCharacter,
  deleteScene,
  insertScene,
  moveScene,
  newChoiceLine,
  newTextLine,
  renameScene,
  sceneRefs,
  sceneTargets,
} from './storyops';
import { isChoice, isMemoryReview, isText, type ChoiceLine, type Line, type Scene, type Script, type TextLine } from './types';
import { el, urlParam } from './util';
import type { AdvView } from './view';

type Tab = 'scenes' | 'characters' | 'endings' | 'assets' | 'paste';

/** 連續打字在這個時間內併成一步復原。 */
const MERGE_MS = 800;
const SPEAKER_LABELS: Record<string, string> = { narrator: '旁白', player: '主角（內心）' };

export class StoryEditor {
  readonly root = el('section', { class: 'story', role: 'dialog', 'aria-label': '故事編輯' });
  private readonly sceneList = el('nav', { class: 'story-scenes', 'aria-label': '場景列表' });
  private readonly main = el('div', { class: 'story-main' });
  private readonly problems = el('details', { class: 'story-problems' });
  private readonly status = el('p', { class: 'story-status', 'aria-live': 'polite' });
  private readonly undoBtn = el('button', { type: 'button', 'data-story': 'undo', title: '復原（Ctrl+Z）' }, ['復原']);
  private readonly redoBtn = el('button', { type: 'button', 'data-story': 'redo', title: '重做（Ctrl+Shift+Z）' }, ['重做']);
  private readonly saveBtn = el('button', { type: 'button', 'data-story': 'save', class: 'primary' }, ['儲存']);
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'scenes';
  private selected = '';
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** 目前腳本的 JSON（上一次 commit 之後）。 */
  private current = '';
  private saved = '';
  private lastMerge = { key: '', time: 0 };
  private message = '';
  private problemsTimer = 0;

  constructor(
    private readonly engine: Engine,
    private readonly view: AdvView,
    /** 儲存腳本（允許結構改變），回傳給人看的訊息。 */
    private readonly saveScript: () => Promise<string>,
    /** 結構改了以後通知（例如讓文字編輯器重新列出欄位）。 */
    private readonly onStructureChange: () => void = () => {},
  ) {
    const close = el('button', { type: 'button', 'data-story': 'close' }, ['關閉']);
    close.onclick = () => this.close();
    this.undoBtn.onclick = () => this.undo();
    this.redoBtn.onclick = () => this.redo();
    this.saveBtn.onclick = () => void this.save();
    const tabBar = el('div', { class: 'story-tabs', role: 'tablist' });
    for (const [t, label] of [
      ['scenes', '場景與台詞'],
      ['characters', '角色'],
      ['endings', '結局'],
      ['assets', '素材'],
      ['paste', '貼上劇本'],
    ] as const) {
      const b = el('button', { type: 'button', role: 'tab', 'data-tab': t }, [label]);
      b.onclick = () => {
        this.tab = t;
        this.render();
      };
      this.tabs.set(t, b);
      tabBar.append(b);
    }
    this.problems.append(el('summary', {}, ['腳本檢查']));
    this.root.append(
      el('header', { class: 'story-header' }, [
        el('h2', {}, ['故事編輯']),
        el('div', { class: 'story-actions' }, [this.undoBtn, this.redoBtn, this.saveBtn, close]),
        tabBar,
        this.status,
      ]),
      el('div', { class: 'story-body' }, [this.sceneList, el('div', { class: 'story-pane' }, [this.problems, this.main])]),
    );
    this.root.addEventListener('click', (e) => e.stopPropagation());
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('beforeunload', (e) => {
      if (this.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    // 開發者面板的檢查結果按「跳到這裡」
    window.addEventListener('vn:story-jump', (ev) => {
      const issue = (ev as CustomEvent<Issue>).detail;
      if (issue?.scene) this.jumpTo(issue.scene, issue.line);
    });
    // ?story=1 打開故事編輯器；?story=assets 等直接打開某個分頁
    const tab = urlParam('story');
    if (tab) {
      if (['scenes', 'characters', 'endings', 'assets', 'paste'].includes(tab)) this.tab = tab as Tab;
      this.open();
    }
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  get dirty(): boolean {
    return this.saved !== '' && this.current !== this.saved;
  }

  private get script(): Script {
    return this.engine.script;
  }

  open(sceneId?: string): void {
    this.view.stopAuto();
    this.view.stopSkip();
    const json = JSON.stringify(this.script);
    // 第一次打開，或在別處（文字編輯器、開發者面板）改過：以現在的腳本為起點
    if (json !== this.current) {
      if (!this.saved) this.saved = json;
      this.current = json;
    }
    this.selected = sceneId ?? (this.engine.scene?.id && this.engine.getScene(this.engine.scene.id) ? this.engine.scene.id : this.selected);
    if (!this.engine.getScene(this.selected)) this.selected = this.script.scenes[0]?.id ?? '';
    this.root.classList.add('open');
    this.render();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  // ───────────── 修改與復原 ─────────────

  /**
   * 改腳本。mergeKey 相同、時間很近的修改（連續打字）併成一步復原。
   * rerender 為 false 時不重畫右邊（避免打字時游標跳掉），只更新場景列表與檢查結果。
   */
  private commit(mutate: () => void, opts: { mergeKey?: string; rerender?: boolean } = {}): void {
    const before = this.current;
    mutate();
    const after = JSON.stringify(this.script);
    if (after === before) return;
    const now = performance.now();
    const merge = !!opts.mergeKey && opts.mergeKey === this.lastMerge.key && now - this.lastMerge.time < MERGE_MS;
    if (!merge) this.undoStack.push(before);
    this.lastMerge = { key: opts.mergeKey ?? '', time: now };
    this.redoStack = [];
    this.current = after;
    this.message = '';
    this.afterChange(opts.rerender ?? true);
  }

  private afterChange(rerender: boolean): void {
    this.engine.reindex();
    this.onStructureChange();
    if (rerender) this.render();
    else {
      this.renderSceneList();
      this.refreshStatus();
      this.scheduleProblems();
    }
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.current);
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.current);
    this.restore(next);
  }

  private restore(json: string): void {
    const snapshot = JSON.parse(json) as Script;
    const s = this.script as unknown as Record<string, unknown>;
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, snapshot);
    this.current = json;
    this.lastMerge = { key: '', time: 0 };
    if (!this.engine.getScene(this.selected) && !this.script.scenes.some((x) => x.id === this.selected)) {
      this.selected = this.script.scenes[0]?.id ?? '';
    }
    this.afterChange(true);
  }

  async save(): Promise<void> {
    this.message = '儲存中…';
    this.refreshStatus();
    try {
      this.message = await this.saveScript();
      this.saved = this.current;
    } catch (err) {
      this.message = `沒有儲存：${(err as Error)?.message ?? err}`;
    }
    this.refreshStatus();
  }

  // ───────────── 畫面 ─────────────

  private render(): void {
    for (const [t, b] of this.tabs) b.setAttribute('aria-selected', String(t === this.tab));
    this.root.dataset.tab = this.tab;
    this.renderSceneList();
    if (this.tab === 'scenes') this.renderScene();
    else if (this.tab === 'characters') this.renderCharacters();
    else if (this.tab === 'endings') this.renderEndings();
    else if (this.tab === 'assets') this.renderAssets();
    else this.renderPaste();
    this.refreshStatus();
    this.renderProblems();
  }

  private refreshStatus(): void {
    this.undoBtn.disabled = this.undoStack.length === 0;
    this.redoBtn.disabled = this.redoStack.length === 0;
    this.root.classList.toggle('dirty', this.dirty);
    this.status.textContent = this.message || (this.dirty ? '有未儲存的變更' : '沒有未儲存的變更');
  }

  private scheduleProblems(): void {
    clearTimeout(this.problemsTimer);
    this.problemsTimer = window.setTimeout(() => this.renderProblems(), 300);
  }

  private renderProblems(): void {
    const issues = checkScript(this.script, currentPack());
    const summary = el('summary', {}, [`腳本檢查：${issueSummary(issues)}`]);
    this.problems.classList.toggle('has-errors', hasBlocking(issues));
    this.problems.replaceChildren(
      summary,
      renderIssues(issues, {
        onJump: (issue) => {
          if (issue.scene) this.jumpTo(issue.scene, issue.line);
        },
      }),
    );
  }

  private sceneLabel(id: string | null | undefined): string {
    if (!id || id === ENDING_TARGET) return '判定結局';
    const s = this.script.scenes.find((x) => x.id === id);
    return s ? `${s.id}${s.title ? `｜${s.title}` : ''}` : `（找不到 ${id}）`;
  }

  private renderSceneList(): void {
    const groups = new Map<number, Scene[]>();
    for (const s of this.script.scenes) groups.set(s.act ?? 1, [...(groups.get(s.act ?? 1) ?? []), s]);
    const items: HTMLElement[] = [];
    for (const [act, scenes] of [...groups].sort(([a], [b]) => a - b)) {
      items.push(el('h3', {}, [`第 ${act} 幕`]));
      for (const s of scenes) {
        const targets = sceneTargets(s).map((t) => (t === ENDING_TARGET ? '結局' : t));
        const b = el('button', { type: 'button', class: 'story-scene-item', 'data-scene': s.id }, [
          el('span', { class: 'story-scene-title' }, [s.title || s.id]),
          el('span', { class: 'story-scene-id' }, [s.id]),
          el('span', { class: 'story-scene-next' }, [`→ ${targets.join('、')}`]),
        ]);
        b.classList.toggle('selected', s.id === this.selected && this.tab === 'scenes');
        b.onclick = () => {
          this.selected = s.id;
          this.tab = 'scenes';
          this.render();
        };
        items.push(b);
      }
    }
    const add = el('button', { type: 'button', 'data-story': 'add-scene', class: 'primary' }, ['＋ 新增場景']);
    add.title = '加在選到的場景後面，並接進流程';
    add.onclick = () =>
      this.commit(() => {
        const s = insertScene(this.script, this.selected || null);
        this.selected = s.id;
        this.tab = 'scenes';
      });
    this.sceneList.replaceChildren(...items, el('div', { class: 'story-list-actions' }, [add]));
  }

  // ───────────── 場景 ─────────────

  private renderScene(): void {
    const scene = this.script.scenes.find((s) => s.id === this.selected);
    if (!scene) {
      this.main.replaceChildren(el('p', {}, ['左邊選一個場景。']));
      return;
    }
    const sceneIds = this.script.scenes.map((s) => s.id);

    // 基本設定
    const idInput = this.input(scene.id, { name: 'story-scene-id' });
    idInput.onchange = () => {
      const to = idInput.value.trim();
      const from = scene.id;
      let err: string | null = null;
      this.commit(() => {
        err = renameScene(this.script, from, to);
        if (!err) this.selected = to;
      });
      if (err) {
        this.message = err;
        idInput.value = from;
        this.refreshStatus();
      }
    };
    const title = this.textField(scene, 'title', 'story-scene-title', `scene:${scene.id}:title`);
    const act = el('input', { type: 'number', min: '1', max: '20', name: 'story-scene-act', value: String(scene.act ?? 1) });
    act.onchange = () => this.commit(() => (scene.act = Math.max(1, Math.round(Number(act.value) || 1))));
    const chapter = this.input(scene.chapter ?? '', { name: 'story-scene-chapter', placeholder: '空白＝取標題裡「・」前面的字' });
    chapter.oninput = () =>
      this.commit(
        () => {
          if (chapter.value.trim()) scene.chapter = chapter.value;
          else delete scene.chapter;
        },
        { mergeKey: `scene:${scene.id}:chapter`, rerender: false },
      );

    // 背景
    const bgNames = new Set<string>();
    for (const s of this.script.scenes) if (s.background) bgNames.add(s.background);
    for (const p of localFiles().keys()) if (p.startsWith('bg/')) bgNames.add(p.slice(3).replace(/\.[^.]+$/, ''));
    const bgList = el('datalist', { id: 'story-bg-names' }, [...bgNames].map((n) => el('option', { value: n })));
    const soundNames = (kind: 'sfx' | 'music') => {
      const names = new Set<string>();
      for (const s of this.script.scenes) {
        if (kind === 'music' && s.music) names.add(s.music);
        for (const l of s.lines) if (isText(l) && l[kind]) names.add(l[kind]!);
      }
      for (const p of localFiles().keys()) if (p.startsWith(`${kind}/`)) names.add(p.slice(kind.length + 1).replace(/\.[^.]+$/, ''));
      return el('datalist', { id: `story-${kind}-names` }, [...names].sort().map((n) => el('option', { value: n })));
    };
    const bg = this.input(scene.background ?? '', { name: 'story-scene-bg', list: 'story-bg-names', placeholder: '背景圖名稱' });
    const thumb = el('img', { class: 'story-thumb', alt: '' });
    const showThumb = () => {
      const name = bg.value.trim();
      thumb.hidden = !name;
      if (name) void resolveImage('bg', name).then((u) => (thumb.src = u));
    };
    showThumb();
    bg.onchange = () => {
      this.commit(() => (scene.background = bg.value.trim() || null), { rerender: false });
      showThumb();
    };

    // 音樂
    const musicMode = el('select', { name: 'story-scene-music-mode' }, [
      el('option', { value: 'keep' }, ['沿用上一首']),
      el('option', { value: 'mute' }, ['靜音']),
      el('option', { value: 'set' }, ['播放：']),
    ]);
    musicMode.value = scene.music === undefined ? 'keep' : scene.music === null ? 'mute' : 'set';
    const music = this.input(scene.music ?? '', { name: 'story-scene-music', placeholder: '曲名' });
    music.hidden = musicMode.value !== 'set';
    const applyMusic = () =>
      this.commit(
        () => {
          if (musicMode.value === 'keep') delete scene.music;
          else if (musicMode.value === 'mute') scene.music = null;
          else scene.music = music.value.trim() || null;
        },
        { rerender: false },
      );
    musicMode.onchange = () => {
      music.hidden = musicMode.value !== 'set';
      applyMusic();
    };
    music.onchange = applyMusic;

    // 下一個場景
    const next = this.sceneSelect(scene.next ?? ENDING_TARGET, { name: 'story-scene-next', exclude: scene.id });
    next.onchange = () => this.commit(() => (scene.next = next.value));

    const isEndScene = scene.id.startsWith('end_');
    const settings = el('section', { class: 'story-card story-settings' }, [
      el('h3', {}, ['場景設定']),
      this.row('標題', title),
      this.row('代號', idInput, '英文，給程式和配音檔名用；改了會一起改所有跳到這裡的地方'),
      this.row('第幾幕', act),
      this.row('章節卡', chapter, '只看每一幕的第一個場景'),
      this.row('背景', el('div', { class: 'story-inline' }, [bg, bgList, thumb])),
      this.row('音樂', el('div', { class: 'story-inline' }, [musicMode, music])),
      isEndScene
        ? this.row('播完後', el('span', {}, ['顯示結局畫面（代號 end_ 開頭的場景）']))
        : this.row('播完後到', next, '台詞都播完、沒有選項跳走時'),
    ]);

    // 台詞
    const lines = scene.lines.map((line, i) => this.lineCard(scene, line, i, sceneIds));
    const addText = el('button', { type: 'button', 'data-story': 'add-line' }, ['＋ 台詞']);
    addText.onclick = () => this.commit(() => scene.lines.push(newTextLine(lastSpeaker(scene))));
    const addChoice = el('button', { type: 'button', 'data-story': 'add-choice' }, ['＋ 選項']);
    addChoice.onclick = () => this.commit(() => scene.lines.push(newChoiceLine()));

    // 場景操作
    const refs = sceneRefs(this.script, scene.id);
    const up = this.small('↑ 上移', () => this.commit(() => moveScene(this.script, scene.id, -1)), { 'data-story': 'scene-up' });
    const down = this.small('↓ 下移', () => this.commit(() => moveScene(this.script, scene.id, 1)), { 'data-story': 'scene-down' });
    const del = this.small(
      '刪除場景',
      () => {
        const where = refs.length ? `\n會跳到這裡的 ${refs.length} 個地方，會改成跳到它的下一個場景。` : '';
        if (!confirm(`刪除「${this.sceneLabel(scene.id)}」？${where}`)) return;
        let err: string | null = null;
        const i = this.script.scenes.indexOf(scene);
        this.commit(() => {
          err = deleteScene(this.script, scene.id);
          if (!err) this.selected = this.script.scenes[Math.max(0, i - 1)]?.id ?? '';
        });
        if (err) {
          this.message = err;
          this.refreshStatus();
        }
      },
      { 'data-story': 'delete-scene', class: 'danger' },
    );
    const play = this.small('▶ 從頭試玩這個場景', () => this.playFrom(scene.id, 0), { 'data-story': 'play-scene' });

    const objects = scene.objects?.length
      ? el('section', { class: 'story-card' }, [
          el('h3', {}, [`可以點的物件（${scene.objects.length}）`]),
          el('ul', { class: 'story-objects' }, scene.objects.map((o) => el('li', {}, [`${o.label}（${o.id}）`]))),
          el('p', { class: 'story-hint' }, ['物件的位置之後可以在這裡直接拖曳；目前請在文字編輯器改說明文字。']),
        ])
      : null;

    this.main.replaceChildren(
      el('div', { class: 'story-scene-actions' }, [play, up, down, del]),
      el('p', { class: 'story-hint' }, [refs.length ? `從這些地方會來到這裡：${refs.map((r) => r.where).join('；')}` : '沒有其他地方會跳到這個場景（可能只有開頭會用到）。']),
      settings,
      el('h3', { class: 'story-lines-title' }, ['台詞']),
      el('div', { class: 'story-lines' }, lines),
      el('div', { class: 'story-add' }, [addText, addChoice]),
      ...(objects ? [objects] : []),
      soundNames('sfx'),
      soundNames('music'),
    );
  }

  private lineCard(scene: Scene, line: Line, i: number, sceneIds: string[]): HTMLElement {
    const tools = el('div', { class: 'story-line-tools' }, [
      this.small('▶', () => this.playFrom(scene.id, i), { title: '從這一句開始試玩', 'data-story': 'play-line' }),
      this.small('↑', () => this.commit(() => swap(scene.lines, i, i - 1)), { title: '上移', disabled: i === 0 ? '' : undefined }),
      this.small('↓', () => this.commit(() => swap(scene.lines, i, i + 1)), { title: '下移', disabled: i === scene.lines.length - 1 ? '' : undefined }),
      this.small('＋', () => this.commit(() => scene.lines.splice(i + 1, 0, newTextLine(isText(line) ? line.speaker : 'narrator'))), {
        title: '在下面插入一句台詞',
        'data-story': 'insert-line',
      }),
      this.small('✕', () => this.commit(() => scene.lines.splice(i, 1)), { title: '刪除這一句', 'data-story': 'delete-line', class: 'danger' }),
    ]);
    const num = el('span', { class: 'story-line-no' }, [String(i + 1)]);

    if (isChoice(line)) return this.choiceCard(scene, line, i, num, tools, sceneIds);
    if (isMemoryReview(line)) {
      return el('div', { class: 'story-line story-memory', 'data-line': String(i) }, [
        el('div', { class: 'story-line-head' }, [num, el('strong', {}, ['記憶對照']), tools]),
        el('p', { class: 'story-hint' }, ['結局時自動列出玩家點過的物件和真相。開頭的話可以在文字編輯器改。']),
      ]);
    }
    const t = line as TextLine;
    const speaker = el('select', { name: 'story-speaker', 'aria-label': '誰說的' });
    for (const [id, label] of this.speakers()) speaker.append(el('option', { value: id }, [label]));
    if (![...this.speakers()].some(([id]) => id === t.speaker)) speaker.append(el('option', { value: t.speaker }, [`（未知）${t.speaker}`]));
    speaker.value = t.speaker;
    const char = this.script.characters?.find((c) => c.id === t.speaker);
    const expr = el('select', { name: 'story-expression', 'aria-label': '表情' });
    expr.hidden = !char;
    if (char) {
      expr.append(el('option', { value: '' }, ['表情不變']));
      const list = [...(char.expressions ?? ['neutral'])];
      if (t.expression && !list.includes(t.expression)) list.push(t.expression);
      for (const x of list) expr.append(el('option', { value: x }, [x]));
      expr.value = t.expression ?? '';
    }
    speaker.onchange = () =>
      this.commit(() => {
        t.speaker = speaker.value;
        const c = this.script.characters?.find((x) => x.id === t.speaker);
        if (!c) delete t.expression;
        else if (t.expression && c.expressions && !c.expressions.includes(t.expression)) delete t.expression;
      });
    expr.onchange = () =>
      this.commit(
        () => {
          if (expr.value) t.expression = expr.value;
          else delete t.expression;
        },
        { rerender: false },
      );
    const text = el('textarea', { rows: '2', name: 'story-text', 'aria-label': `第 ${i + 1} 句`, placeholder: '台詞', spellcheck: 'false' });
    text.value = t.text;
    text.oninput = () => {
      this.commit(() => (t.text = text.value), { mergeKey: `line:${scene.id}:${i}`, rerender: false });
      autosize(text);
    };
    requestAnimationFrame(() => autosize(text));
    const { row: sound, toggle } = this.soundRow(scene, t, i);
    return el('div', { class: `story-line story-text speaker-${t.speaker === 'narrator' || t.speaker === 'player' ? t.speaker : 'char'}`, 'data-line': String(i) }, [
      el('div', { class: 'story-line-head' }, [num, speaker, expr, toggle, tools]),
      text,
      sound,
      chips(textChips(t)),
    ]);
  }

  /**
   * 這句台詞的聲音：出現時播一次的音效、從這句開始換音樂（或停止）。
   * 沒設定時收起來，按「♪ 聲音」打開。
   */
  private soundRow(scene: Scene, t: TextLine, i: number): { row: HTMLElement; toggle: HTMLButtonElement } {
    const sfx = this.input(t.sfx ?? '', { name: 'story-sfx', list: 'story-sfx-names', placeholder: '音效名稱，例如 door_bell' });
    const hear = this.small('▶ 聽', () => {
      const name = sfx.value.trim();
      if (!name || !this.view.audio) return;
      this.view.audio.unlock();
      this.view.audio.playSfx(name);
      void this.view.audio.hasSfx(name).then((ok) => {
        if (!ok) {
          this.message = `還沒有音效檔 ${name}：用開發者面板「上傳素材」的「音效」放進來，或上傳到 ${assetFolderLabel('sfx')}${name}.mp3`;
          this.refreshStatus();
        }
      });
    }, { title: '試聽這個音效', 'data-story': 'hear-sfx' });
    sfx.onchange = () =>
      this.commit(
        () => {
          const name = sfx.value.trim();
          if (name) t.sfx = name;
          else delete t.sfx;
        },
        { rerender: false },
      );

    const mode = el('select', { name: 'story-line-music-mode', 'aria-label': '音樂' }, [
      el('option', { value: 'keep' }, ['音樂不變']),
      el('option', { value: 'stop' }, ['停止音樂']),
      el('option', { value: 'set' }, ['換成：']),
    ]);
    mode.value = t.music === undefined ? 'keep' : t.music === null ? 'stop' : 'set';
    const music = this.input(t.music ?? '', { name: 'story-line-music', list: 'story-music-names', placeholder: '曲名，例如 rain_night' });
    music.hidden = mode.value !== 'set';
    const applyMusic = () =>
      this.commit(
        () => {
          if (mode.value === 'keep') delete t.music;
          else if (mode.value === 'stop') t.music = null;
          else if (music.value.trim()) t.music = music.value.trim();
          else delete t.music;
        },
        { rerender: false },
      );
    mode.onchange = () => {
      music.hidden = mode.value !== 'set';
      if (mode.value === 'set') music.focus();
      applyMusic();
    };
    music.onchange = applyMusic;

    const row = el('div', { class: 'story-sound' }, [
      el('label', { class: 'story-inline' }, [el('span', { class: 'story-sound-label' }, ['音效']), sfx, hear]),
      el('label', { class: 'story-inline' }, [el('span', { class: 'story-sound-label' }, ['從這句開始']), mode, music]),
    ]);
    const has = t.sfx !== undefined || t.music !== undefined;
    row.hidden = !has;
    const toggle = this.small(has ? '♪ 聲音 ▴' : '♪ 聲音', () => {
      row.hidden = !row.hidden;
      toggle.textContent = row.hidden ? '♪ 聲音' : '♪ 聲音 ▴';
    }, { title: '這句的音效、換音樂', 'data-story': 'sound', class: has ? 'on' : '' });
    toggle.dataset.line = `${scene.id}:${i}`;
    return { row, toggle };
  }

  private choiceCard(scene: Scene, line: ChoiceLine, i: number, num: HTMLElement, tools: HTMLElement, sceneIds: string[]): HTMLElement {
    const prompt = this.input(line.prompt ?? '', { name: 'story-prompt', placeholder: '選項上方的提示（可以空白）' });
    prompt.oninput = () =>
      this.commit(
        () => {
          if (prompt.value) line.prompt = prompt.value;
          else delete line.prompt;
        },
        { mergeKey: `prompt:${scene.id}:${i}`, rerender: false },
      );
    const options = line.choice.map((opt, j) => {
      const text = this.input(opt.text, { name: 'story-option-text', 'aria-label': `選項 ${j + 1}` });
      text.oninput = () => this.commit(() => (opt.text = text.value), { mergeKey: `opt:${scene.id}:${i}:${j}`, rerender: false });
      const go = this.sceneSelect(opt.goto ?? '', { name: 'story-option-goto', continueLabel: '繼續這個場景', ids: sceneIds });
      go.onchange = () =>
        this.commit(() => {
          if (go.value) opt.goto = go.value;
          else delete opt.goto;
        });
      const remove = this.small('✕', () => this.commit(() => line.choice.splice(j, 1)), {
        title: '刪除這個選項',
        class: 'danger',
        disabled: line.choice.length <= 1 ? '' : undefined,
      });
      const extra: string[] = [];
      if (opt.effects) extra.push(`數值 ${Object.entries(opt.effects).map(([k, v]) => `${k}${v >= 0 ? '+' : ''}${v}`).join(' ')}`);
      if (opt.flags?.length) extra.push(`旗標 ${opt.flags.join(', ')}`);
      if (opt.requires) extra.push(`要先點過 ${[opt.requires].flat().join(', ')}`);
      if (opt.if) extra.push(`條件 ${opt.if}`);
      return el('div', { class: 'story-option', 'data-option': String(j) }, [
        el('span', { class: 'story-option-mark' }, ['◇']),
        text,
        el('span', { class: 'story-arrow' }, ['→']),
        go,
        remove,
        ...(extra.length ? [chips(extra)] : []),
      ]);
    });
    const add = el('button', { type: 'button', class: 'small', 'data-story': 'add-option' }, ['＋ 選項']);
    add.onclick = () => this.commit(() => line.choice.push({ text: `選項${line.choice.length + 1}` }));
    const extra: string[] = [];
    if (line.mode === 'hotspot') extra.push('點畫面上的位置選');
    if (line.fx?.length) extra.push(`效果 ${line.fx.join(', ')}`);
    if (line.if) extra.push(`條件 ${line.if}`);
    if (line.voice) extra.push(`配音 ${line.voice}`);
    return el('div', { class: 'story-line story-choice', 'data-line': String(i) }, [
      el('div', { class: 'story-line-head' }, [num, el('strong', {}, ['選項']), tools]),
      prompt,
      el('div', { class: 'story-options' }, options),
      add,
      chips(extra),
    ]);
  }

  /** 打開某個場景，捲到某一句並閃一下。 */
  jumpTo(sceneId: string, line?: number): void {
    if (!this.isOpen) this.open(sceneId);
    this.selected = sceneId;
    this.tab = 'scenes';
    this.render();
    if (line !== undefined) {
      const row = this.main.querySelector<HTMLElement>(`.story-line[data-line="${line}"]`);
      row?.scrollIntoView({ block: 'center' });
      row?.classList.add('flash');
    }
  }

  // ───────────── 素材 ─────────────

  private assetKind: AssetKind | 'all' = 'all';
  private assetMissingOnly = false;

  /** 素材管理：劇本需要的每個素材、用在哪裡、狀態（網站有檔案／已上傳／佔位中），可以直接上傳。 */
  private renderAssets(): void {
    const items = assetCatalog(this.script);
    const kinds = ASSET_KINDS.filter((k) => items.some((x) => x.kind === k));
    const filter = el('select', { name: 'story-asset-kind' }, [
      el('option', { value: 'all' }, ['全部']),
      ...kinds.map((k) => el('option', { value: k }, [`${KIND_LABEL[k]}（${items.filter((x) => x.kind === k).length}）`])),
    ]);
    filter.value = this.assetKind;
    filter.onchange = () => {
      this.assetKind = filter.value as AssetKind | 'all';
      this.renderAssets();
    };
    const missingOnly = el('input', { type: 'checkbox', name: 'story-asset-missing' });
    missingOnly.checked = this.assetMissingOnly;
    missingOnly.onchange = () => {
      this.assetMissingOnly = missingOnly.checked;
      this.renderAssets();
    };
    const summary = el('p', { class: 'story-hint', 'data-story': 'asset-summary' }, ['檢查中…']);
    const copyMissing = el('button', { type: 'button', class: 'small', 'data-story': 'copy-missing' }, ['複製缺少的素材清單']);
    const missing: AssetItem[] = [];
    copyMissing.onclick = () =>
      void copyText(missingListText(missing, this.script.meta.title)).then((ok) => {
        copyMissing.textContent = ok ? '已複製' : '複製失敗';
        window.setTimeout(() => (copyMissing.textContent = '複製缺少的素材清單'), 1500);
      });

    const shown = items.filter((x) => this.assetKind === 'all' || x.kind === this.assetKind);
    const rows = shown.map((item) => this.assetRow(item));
    const list = el('div', { class: 'story-assets' }, rows.map((r) => r.row));
    // 狀態要非同步查（圖片、清單）
    void Promise.all(rows.map((r) => r.ready)).then((statuses) => {
      if (!list.isConnected) return;
      const counts = { site: 0, local: 0, missing: 0 };
      statuses.forEach((st, i) => {
        counts[st]++;
        if (st === 'missing') missing.push(shown[i]);
        rows[i].row.hidden = this.assetMissingOnly && st !== 'missing';
      });
      summary.textContent = `共 ${shown.length} 個：網站上有檔案 ${counts.site}、已上傳 ${counts.local}、還沒有（佔位中）${counts.missing}。沒有素材也能玩：圖片用佔位圖、音樂用合成音、配音和音效先不出聲。`;
    });
    this.main.replaceChildren(
      el('p', { class: 'story-hint' }, [
        '劇本需要的所有素材。點「上傳」就能放進遊戲（存在本機專案時會一起存）；正式放上網站要用 GitHub 上傳到 ',
        `${projectDir()}/assets/`,
        ' 底下對應的資料夾。',
      ]),
      el('div', { class: 'story-inline' }, [el('label', { class: 'story-inline' }, ['種類', filter]), el('label', {}, [missingOnly, ' 只看還沒有的']), copyMissing]),
      summary,
      list,
    );
  }

  private assetRow(item: AssetItem): { row: HTMLElement; ready: Promise<AssetStatus> } {
    const badge = el('span', { class: 'story-asset-status' }, ['…']);
    const thumb = el('div', { class: `story-asset-thumb kind-${item.kind}` });
    const input = el('input', { type: 'file', name: 'story-asset-file', accept: item.kind === 'voice' || item.kind === 'music' || item.kind === 'sfx' ? 'audio/*,.mp3,.ogg' : 'image/*' });
    input.hidden = true;
    const upload = this.small('上傳', () => input.click(), { 'data-story': 'asset-upload' });
    const msg = el('span', { class: 'story-hint' });
    const showStatus = async (): Promise<AssetStatus> => {
      const st = await assetStatus(this.view, item.kind, item.name);
      badge.textContent = { site: '網站上有檔案', local: '已上傳', missing: '佔位中' }[st];
      badge.dataset.status = st;
      row.dataset.status = st;
      if (item.kind === 'bg' || item.kind === 'char' || item.kind === 'fg') {
        const url = await resolveImage(item.kind, item.name);
        thumb.replaceChildren(el('img', { src: url, alt: '' }));
      } else {
        thumb.textContent = { voice: '🎙', music: '♪', sfx: '🔔' }[item.kind];
      }
      return st;
    };
    input.onchange = async () => {
      const f = input.files?.[0];
      input.value = '';
      if (!f) return;
      msg.textContent = '處理中…';
      try {
        const r = await useAssetFile(this.engine, this.view, item.kind, item.name, f, { preview: true });
        msg.textContent = r.note ? `已放進遊戲（${r.note}）` : '已放進遊戲';
        await showStatus();
      } catch (err) {
        msg.textContent = `沒有成功：${(err as Error)?.message ?? err}`;
      }
    };
    const jump = item.scene ? this.small('看場景', () => this.jumpTo(item.scene!), { title: '打開第一個用到它的場景' }) : null;
    const row = el('div', { class: 'story-asset', 'data-asset': `${item.kind}/${item.name}` }, [
      thumb,
      el('div', { class: 'story-asset-body' }, [
        el('div', { class: 'story-line-head' }, [el('strong', {}, [item.name]), el('span', { class: 'story-chip' }, [KIND_LABEL[item.kind]]), badge]),
        el('p', { class: 'story-asset-desc' }, [item.description || '（沒有描述）']),
        el('p', { class: 'story-hint' }, [`用在：${item.uses.join('、') || '—'}`]),
        el('p', { class: 'story-hint' }, [`規格：${item.spec}`]),
        el('div', { class: 'story-inline' }, [upload, input, ...(jump ? [jump] : []), msg]),
      ]),
    ]);
    return { row, ready: showStatus() };
  }

  // ───────────── 貼上劇本 ─────────────

  /** 把 AI 寫好的 script.json 貼進來：抓出 JSON、白話檢查，沒有「必須修正」才能套用。 */
  private renderPaste(): void {
    const area = el('textarea', {
      name: 'story-paste',
      rows: '12',
      spellcheck: 'false',
      placeholder: '把 AI 給的劇本（script.json）整段貼在這裡。前後有說明文字也沒關係，會自動抓出 JSON。',
    });
    area.value = this.pasteDraft;
    area.oninput = () => (this.pasteDraft = area.value);
    const result = el('div', { class: 'story-paste-result', 'aria-live': 'polite' });
    const check = el('button', { type: 'button', class: 'primary', 'data-story': 'paste-check' }, ['檢查']);
    check.onclick = () => {
      const r = checkPastedScript(area.value, currentPack());
      if (!r.ok) {
        result.replaceChildren(
          el('p', { class: 'story-paste-error' }, [r.error]),
          el('p', { class: 'story-hint' }, ['請 AI 重新輸出。可以把下面這段提示詞貼給它：']),
          el('pre', { class: 'story-prompt' }, [r.prompt]),
          this.copyBtn('複製提示詞', r.prompt),
        );
        return;
      }
      const blocking = hasBlocking(r.issues);
      const apply = el('button', { type: 'button', class: 'primary', 'data-story': 'paste-apply' }, ['套用這份劇本']);
      apply.disabled = blocking;
      apply.onclick = () => {
        if (!confirm('套用後會取代目前整份劇本（可以按「復原」回來）。確定嗎？')) return;
        const next = JSON.parse(JSON.stringify(r.script)) as Script;
        this.commit(() => {
          const s = this.script as unknown as Record<string, unknown>;
          for (const k of Object.keys(s)) delete s[k];
          Object.assign(s, next);
          this.selected = next.scenes[0]?.id ?? '';
          this.tab = 'scenes';
        });
        this.pasteDraft = '';
        this.message = '已套用貼上的劇本';
        this.refreshStatus();
      };
      result.replaceChildren(
        ...(r.note ? [el('p', { class: 'story-hint' }, [r.note])] : []),
        el('p', {}, [`《${r.script.meta.title ?? '未命名'}》：${r.script.scenes.length} 個場景，${issueSummary(r.issues)}。`]),
        renderIssues(r.issues),
        el('p', { class: 'story-hint' }, [blocking ? '還有「必須修正」的問題，修好之前不能套用。' : '可以套用了。']),
        apply,
      );
    };
    this.main.replaceChildren(
      el('p', { class: 'story-hint' }, ['請 AI 寫好劇本後貼回來。這裡會先檢查，有「必須修正」的問題時，會附上可以直接貼給 AI 的修正提示詞。']),
      area,
      el('div', { class: 'story-add' }, [check]),
      result,
    );
  }

  private pasteDraft = '';

  private copyBtn(label: string, text: string): HTMLButtonElement {
    const b = el('button', { type: 'button', class: 'small' }, [label]);
    b.onclick = () =>
      void copyText(text).then((ok) => {
        b.textContent = ok ? '已複製' : '複製失敗';
        window.setTimeout(() => (b.textContent = label), 1500);
      });
    return b;
  }

  // ───────────── 角色 ─────────────

  private renderCharacters(): void {
    const chars = this.script.characters ?? [];
    const rows = chars.map((c) => {
      const field = (key: 'name' | 'trait' | 'relation', label: string) => {
        const input = this.input(c[key] ?? '', { name: `story-char-${key}`, placeholder: label });
        input.oninput = () =>
          this.commit(
            () => {
              if (input.value || key === 'name') c[key] = input.value;
              else delete c[key];
            },
            { mergeKey: `char:${c.id}:${key}`, rerender: false },
          );
        return input;
      };
      const exprs = this.input((c.expressions ?? ['neutral']).join('、'), { name: 'story-char-expressions' });
      exprs.onchange = () =>
        this.commit(() => {
          const list = exprs.value
            .split(/[,、，\s]+/)
            .map((x) => x.trim())
            .filter(Boolean);
          c.expressions = list.length ? [...new Set(list)] : ['neutral'];
        });
      const del = this.small(
        '刪除',
        () => {
          let err: string | null = null;
          this.commit(() => (err = deleteCharacter(this.script, c.id)));
          if (err) {
            this.message = err;
            this.refreshStatus();
          }
        },
        { class: 'danger', 'data-story': 'delete-char' },
      );
      return el('section', { class: 'story-card story-char', 'data-char': c.id }, [
        el('div', { class: 'story-line-head' }, [el('strong', {}, [c.name || c.id]), el('code', {}, [c.id]), del]),
        this.row('名字', field('name', '名字')),
        this.row('特徵', field('trait', '例如：戴著藍色帽子'), '名字淡忘時改顯示這個'),
        this.row('關係', field('relation', '例如：女兒')),
        this.row('表情', exprs, `用頓號分開。立繪檔名是 ${c.id}_表情，例如 ${c.id}_${c.expressions?.[0] ?? 'neutral'}.webp`),
      ]);
    });
    const id = this.input('', { name: 'story-new-char-id', placeholder: '英文代號，例如 mom' });
    const name = this.input('', { name: 'story-new-char-name', placeholder: '名字，例如 媽媽' });
    const add = el('button', { type: 'button', class: 'primary', 'data-story': 'add-char' }, ['新增角色']);
    add.onclick = () => {
      let err: string | null = null;
      this.commit(() => (err = addCharacter(this.script, id.value.trim(), name.value)));
      this.message = err ?? '';
      this.refreshStatus();
    };
    this.main.replaceChildren(
      el('p', { class: 'story-hint' }, ['「旁白」和「主角（內心）」不用新增。角色的立繪放在素材的立繪類（開發者面板「上傳素材」）。']),
      ...rows,
      el('section', { class: 'story-card' }, [el('h3', {}, ['新增角色']), el('div', { class: 'story-inline' }, [id, name, add])]),
    );
  }

  // ───────────── 結局 ─────────────

  private renderEndings(): void {
    const endings = this.script.endings ?? [];
    const statNames = Object.keys(this.script.meta.stats ?? {});
    const rows = endings.map((e, i) => {
      const title = this.input(e.title, { name: 'story-ending-title' });
      title.oninput = () => this.commit(() => (e.title = title.value), { mergeKey: `ending:${i}:title`, rerender: false });
      const cond = this.input(e.condition, { name: 'story-ending-condition', placeholder: 'true' });
      cond.onchange = () => this.commit(() => (e.condition = cond.value.trim() || 'true'));
      const scene = this.sceneSelect(e.scene, { name: 'story-ending-scene', noEnding: true });
      scene.onchange = () => this.commit(() => (e.scene = scene.value));
      const up = this.small('↑', () => this.commit(() => swap(endings, i, i - 1)), { title: '優先順序往前', disabled: i === 0 ? '' : undefined });
      const edit = this.small('編輯這個結局的場景', () => {
        this.selected = e.scene;
        this.tab = 'scenes';
        this.render();
      });
      return el('section', { class: 'story-card', 'data-ending': e.id }, [
        el('div', { class: 'story-line-head' }, [el('strong', {}, [`${i + 1}. ${e.title || e.id}`]), up, edit]),
        this.row('名稱', title),
        this.row('條件', cond, '寫 true 表示一定成立'),
        this.row('結局場景', scene),
      ]);
    });
    const add = el('button', { type: 'button', class: 'primary', 'data-story': 'add-ending' }, ['＋ 新增結局']);
    add.onclick = () =>
      this.commit(() => {
        this.script.endings ??= [];
        const n = this.script.endings.length + 1;
        let sid = `end_${n}`;
        while (this.script.scenes.some((s) => s.id === sid)) sid += 'x';
        const scene: Scene = { id: sid, act: this.script.scenes[this.script.scenes.length - 1]?.act ?? 1, title: '新結局', lines: [newTextLine()] };
        this.script.scenes.push(scene);
        let eid = `ending_${n}`;
        while (this.script.endings.some((x) => x.id === eid)) eid += 'x';
        this.script.endings.push({ id: eid, title: '新結局', condition: 'true', scene: sid });
      });
    this.main.replaceChildren(
      el('p', { class: 'story-hint' }, [
        '故事走到「判定結局」時，由上往下找第一個條件成立的結局。條件可以用數值（',
        statNames.join('、') || '還沒有數值',
        '）、has("旗標")、seen("物件代號")，例如 trust >= 2 && has("kept_letter")。',
      ]),
      ...rows,
      el('div', { class: 'story-add' }, [add]),
    );
  }

  // ───────────── 小工具 ─────────────

  private speakers(): Map<string, string> {
    const m = new Map<string, string>(Object.entries(SPEAKER_LABELS));
    for (const c of this.script.characters ?? []) m.set(c.id, c.name || c.id);
    return m;
  }

  private sceneSelect(
    value: string,
    opts: { name: string; exclude?: string; continueLabel?: string; ids?: string[]; noEnding?: boolean },
  ): HTMLSelectElement {
    const s = el('select', { name: opts.name });
    if (opts.continueLabel) s.append(el('option', { value: '' }, [opts.continueLabel]));
    for (const id of opts.ids ?? this.script.scenes.map((x) => x.id)) {
      if (id === opts.exclude) continue;
      s.append(el('option', { value: id }, [this.sceneLabel(id)]));
    }
    if (!opts.noEnding) s.append(el('option', { value: ENDING_TARGET }, ['判定結局']));
    if (value && ![...s.options].some((o) => o.value === value)) s.append(el('option', { value }, [`（找不到 ${value}）`]));
    s.value = value;
    return s;
  }

  private textField(scene: Scene, key: 'title', name: string, mergeKey: string): HTMLInputElement {
    const input = this.input(scene[key] ?? '', { name });
    input.oninput = () => this.commit(() => (scene[key] = input.value), { mergeKey, rerender: false });
    return input;
  }

  private input(value: string, attrs: Record<string, string>): HTMLInputElement {
    const i = el('input', { type: 'text', spellcheck: 'false', ...attrs });
    i.value = value;
    return i;
  }

  private row(label: string, control: HTMLElement, hint?: string): HTMLElement {
    return el('label', { class: 'story-row' }, [
      el('span', { class: 'story-label' }, [label]),
      el('span', { class: 'story-control' }, [control, ...(hint ? [el('small', {}, [hint])] : [])]),
    ]);
  }

  private small(label: string, onClick: () => void, attrs: Record<string, string | undefined> = {}): HTMLButtonElement {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) clean[k] = v;
    const b = el('button', { type: 'button', ...clean, class: `small ${clean.class ?? ''}`.trim() }, [label]);
    b.onclick = (e) => {
      e.preventDefault();
      onClick();
    };
    return b;
  }

  private playFrom(sceneId: string, index: number): void {
    this.close();
    this.view.titleScreen.classList.remove('open');
    this.view.endingScreen.classList.remove('open');
    this.view.audio?.unlock();
    if (this.engine.phase === 'title' || this.engine.phase === 'ending') void this.engine.start(sceneId, index);
    else void this.engine.gotoScene(sceneId, { index });
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    e.stopPropagation();
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      this.redo();
    } else if (mod && key === 's') {
      e.preventDefault();
      void this.save();
    } else if (key === 'escape') {
      this.close();
    }
  }
}

function lastSpeaker(scene: Scene): string {
  for (let i = scene.lines.length - 1; i >= 0; i--) {
    const l = scene.lines[i];
    if (isText(l)) return l.speaker;
  }
  return 'narrator';
}

function swap<T>(arr: T[], i: number, j: number): void {
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

/** 這句台詞還有哪些進階設定（效果、配音等），顯示成唯讀小標籤，讓人知道它們還在。 */
function textChips(t: TextLine): string[] {
  const out: string[] = [];
  if (t.fx?.length) out.push(`效果 ${t.fx.join(', ')}`);
  if (t.voice) out.push(`配音 ${t.voice}`);
  if (t.if) out.push(`條件 ${t.if}`);
  if (t.gaze) out.push(`視線 ${t.gaze}`);
  if (t.distance) out.push(`距離 ${t.distance}`);
  if (t.wrongObject) out.push(`錯置物件 ${t.wrongObject}`);
  if (t.timeSkipTo) out.push(`閃回 ${t.timeSkipTo}`);
  return out;
}

function chips(list: string[]): HTMLElement {
  const box = el('div', { class: 'story-chips' }, list.map((c) => el('span', { class: 'story-chip' }, [c])));
  box.hidden = list.length === 0;
  return box;
}

function autosize(t: HTMLTextAreaElement): void {
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + 2}px`;
}
