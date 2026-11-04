// 開發者面板：按 ` 鍵（或 F8）開關，網址加 ?dev=1 則一開始就打開。
import type { Engine } from './engine';
import { neededSprites, pickEnding, spriteWarnings } from './script';
import {
  ALL_FX,
  isText,
  TRANSITION_STYLES,
  type ChoiceLine,
  type Distance,
  type FxTag,
  type Gaze,
  type SceneObject,
  type TransitionStyle,
} from './types';
import { buildUploadSection } from './devupload';
import { PROJECT_EXT } from './projectfile';
import { downloadBlob, reloadWithProject, timeLabel, type ProjectSession } from './project';
import { exportPlayable } from './exporter';
import { localFiles } from './localfiles';
import { assetFolderLabel, projectUrl } from './paths';
import { FILE_MODE, OFFLINE_LIMITS } from './embed';
import { checkScript } from './checks';
import { issueSummary, renderIssues } from './issueview';
import { currentPack, setCurrentPack } from './pack';
import { listPacks, loadPack } from './packloader';
import { clamp, el, urlParam } from './util';
import type { AdvView } from './view';

const GAZES: Gaze[] = ['camera', 'away', 'other'];
const TRANSITION_LABELS: Record<TransitionStyle, string> = {
  blink: '眨眼（原本）',
  blink_soft: '柔和的眨眼',
  fade: '淡入淡出',
  focus: '模糊對焦',
};
const DISTANCES: Distance[] = ['near', 'normal', 'far'];
/** 面板收合、各區塊摺疊的狀態記在瀏覽器裡（只是方便，讀不到也沒關係）。 */
const FOLD_KEY = 'dev-panel-folds';

function loadFolds(): { collapsed: boolean; closed: string[] } {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}');
    return { collapsed: v.collapsed === true, closed: Array.isArray(v.closed) ? v.closed.map(String) : [] };
  } catch {
    return { collapsed: false, closed: [] };
  }
}

function saveFolds(v: { collapsed: boolean; closed: string[] }): void {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(v));
  } catch {
    /* 不能存就算了 */
  }
}

export class DevPanel {
  readonly root = el('aside', { class: 'devpanel', 'aria-label': '開發者面板' });
  private readonly status = el('dl', { class: 'dev-status' });
  private readonly stats = el('div', { class: 'dev-stats' });
  private readonly sceneSelect = el('select', { name: 'dev-scene' });
  private readonly autoDeg = el('input', { type: 'checkbox', name: 'dev-auto-degradation' });
  private readonly degRange = el('input', { type: 'range', min: '0', max: '1', step: '0.05', name: 'dev-degradation' });
  private readonly degOut = el('output', {});
  private readonly gazeSelect = el('select', { name: 'dev-gaze' });
  private readonly distSelect = el('select', { name: 'dev-distance' });
  private lastScene = '';
  private readonly spriteList = el('div', { class: 'dev-sprites' }, ['檢查中…']);
  private readonly folds = loadFolds();

  constructor(
    private readonly engine: Engine,
    private readonly view: AdvView,
    /** 打開文字編輯器。 */
    private readonly openEditor?: () => void,
    /** 儲存腳本（本機寫回 script.json，線上版下載），回傳結果訊息。 */
    private readonly saveScript?: () => Promise<string>,
    /** 專案（網站版或本機專案），沒有就不顯示「專案」區塊。 */
    private readonly project?: ProjectSession,
    /** 打開故事編輯器。 */
    private readonly openStory?: () => void,
    /** 儲存腳本，允許改結構（新增、刪除物件），回傳結果訊息。 */
    private readonly saveStructure?: () => Promise<string>,
  ) {
    this.build();
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.key === '`' || e.key === 'F8') {
        e.preventDefault();
        // 用鍵盤打開時一律展開
        if (!this.isOpen) this.collapse(false);
        this.toggle();
      }
    });
    this.root.classList.toggle('collapsed', this.folds.collapsed);
    if (urlParam('dev')) this.toggle(true);
  }

  get isCollapsed(): boolean {
    return this.root.classList.contains('collapsed');
  }

  /** 收合成右上角的一個小標籤（遊戲畫面不會被擋住），再按一下展開。 */
  collapse(force?: boolean): void {
    const on = force ?? !this.isCollapsed;
    this.root.classList.toggle('collapsed', on);
    this.folds.collapsed = on;
    saveFolds(this.folds);
    if (!on) this.refresh();
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  toggle(force?: boolean): void {
    this.root.classList.toggle('open', force ?? !this.isOpen);
    if (this.isOpen) this.refresh();
  }

  /** 可以摺疊的區塊；點標題開關，狀態記在瀏覽器裡。 */
  private section(title: string, ...children: (Node | string)[]): HTMLElement {
    const d = el('details', { class: 'dev-section', 'data-section': title }, [
      el('summary', {}, [el('h3', {}, [title])]),
      ...children,
    ]);
    d.open = !this.folds.closed.includes(title);
    d.addEventListener('toggle', () => {
      this.folds.closed = this.folds.closed.filter((t) => t !== title);
      if (!d.open) this.folds.closed.push(title);
      saveFolds(this.folds);
    });
    return d;
  }

  private button(label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
    const b = el('button', { type: 'button', ...attrs }, [label]);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
      this.refresh();
    });
    return b;
  }

  private build(): void {
    const e = this.engine;
    const fold = this.button('', () => this.collapse(), { class: 'dev-fold', 'data-dev': 'collapse', 'aria-label': '收合／展開開發者面板' });
    const foldAll = this.button('全部摺疊', () => {
      const sections = [...this.root.querySelectorAll<HTMLDetailsElement>('details.dev-section')];
      const open = !sections.some((d) => d.open);
      for (const d of sections) d.open = open;
      foldAll.textContent = open ? '全部摺疊' : '全部展開';
    }, { class: 'dev-fold-all', 'data-dev': 'fold-all' });
    const title = el('h2', { title: '點一下收合／展開' }, ['開發者面板']);
    title.addEventListener('click', () => this.collapse());

    for (const s of e.script.scenes) {
      this.sceneSelect.append(el('option', { value: s.id }, [`${s.id}${s.title ? `｜${s.title}` : ''}`]));
    }
    const jump = this.button('跳過去', () => {
      this.view.titleScreen.classList.remove('open');
      this.view.endingScreen.classList.remove('open');
      this.view.audio?.unlock();
      if (e.phase === 'title' || e.phase === 'ending') {
        void e.start(this.sceneSelect.value);
      } else {
        void e.gotoScene(this.sceneSelect.value);
      }
    }, { 'data-dev': 'jump' });

    const fxButtons = ALL_FX.map((fx) => this.button(fx, () => this.triggerFx(fx), { 'data-fx': fx, class: 'dev-fx' }));

    this.autoDeg.checked = true;
    this.autoDeg.onchange = () => {
      e.degradationOverride = this.autoDeg.checked ? null : Number(this.degRange.value);
      this.view.fx.applyGlobal();
      this.refresh();
    };
    this.degRange.oninput = () => {
      this.autoDeg.checked = false;
      e.degradationOverride = Number(this.degRange.value);
      this.view.fx.applyGlobal();
      this.refresh();
    };

    for (const g of GAZES) this.gazeSelect.append(el('option', { value: g }, [g]));
    for (const d of DISTANCES) this.distSelect.append(el('option', { value: d }, [d]));
    const applyPose = () => {
      const char = e.getChar(e.lastChar);
      if (!char) return;
      const pose = (e.poses[char.id] = {
        ...(e.poses[char.id] ?? { expression: 'neutral', gaze: 'camera', distance: 'normal' }),
        gaze: this.gazeSelect.value as Gaze,
        distance: this.distSelect.value as Distance,
      });
      void this.view.showSprite(char, pose);
    };
    this.gazeSelect.onchange = applyPose;
    this.distSelect.onchange = applyPose;

    const issues = checkScript(e.script, currentPack());
    const problemList = el('div', { class: 'dev-problems' }, [
      el('p', { class: issues.length ? 'dev-note' : 'dev-ok' }, [issues.length ? issueSummary(issues) : '腳本檢查沒有問題']),
      ...(issues.length
        ? [
            renderIssues(issues, {
              limit: 8,
              onJump: (issue) => {
                this.toggle(false);
                this.openStory?.();
                window.dispatchEvent(new CustomEvent('vn:story-jump', { detail: issue }));
              },
            }),
          ]
        : []),
    ]);

    this.root.append(
      el('header', {}, [title, foldAll, fold]),
      ...(FILE_MODE
        ? [
            el('div', { class: 'dev-offline', 'data-dev': 'offline' }, [
              el('strong', {}, ['離線模式（直接開啟檔案）']),
              el('p', {}, ['以下功能已簡化：']),
              el('ul', {}, OFFLINE_LIMITS.map((t) => el('li', {}, [t]))),
            ]),
          ]
        : []),
      ...(this.project ? [this.buildProject(this.project)] : []),
      this.section('目前狀態', this.status, this.stats),
      this.section('跳到場景', el('div', { class: 'dev-row' }, [this.sceneSelect, jump])),
      this.buildPresentation(),
      this.buildObjects(),
      this.section('上傳素材', buildUploadSection(e, this.view, this.project?.mode === 'local')),
      this.section('觸發效果', el('div', { class: 'dev-grid' }, fxButtons)),
      this.section(
        '退化係數',
        el('label', { class: 'dev-row' }, [this.autoDeg, '依幕自動']),
        el('div', { class: 'dev-row' }, [this.degRange, this.degOut]),
      ),
      this.section(
        '目前角色的視線與距離',
        el('label', { class: 'dev-row' }, ['gaze', this.gazeSelect]),
        el('label', { class: 'dev-row' }, ['distance', this.distSelect]),
      ),
      this.section(
        '重置',
        el('div', { class: 'dev-row' }, [
          this.button('從頭開始', () => {
            this.view.titleScreen.classList.remove('open');
            this.view.endingScreen.classList.remove('open');
            this.view.audio?.unlock();
            e.degradationOverride = null;
            this.autoDeg.checked = true;
            void e.start();
          }, { 'data-dev': 'reset' }),
          this.button('回標題', () => e.toTitle()),
        ]),
      ),
      this.section(
        '編輯故事',
        el('div', { class: 'dev-row dev-wrap' }, [
          this.button('配音總表', () => window.open('?voice=1', '_blank'), { 'data-dev': 'voice-desk' }),
          this.button('打開文字編輯', () => {
            this.toggle(false);
            this.openEditor?.();
          }, { 'data-dev': 'editor' }),
          this.button('打開故事編輯', () => {
            this.toggle(false);
            this.openStory?.();
          }, { 'data-dev': 'story', class: 'dev-primary' }),
        ]),
      ),
      this.section('腳本檢查', problemList),
      this.section('立繪檢查（警告）', this.spriteList),
    );
    void this.checkSprites();
    this.root.addEventListener('click', (ev) => ev.stopPropagation());
    // 面板內的按鍵不要傳到遊戲（例如空白鍵推進台詞），但開關鍵照樣有效
    this.root.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === '`' || ev.key === 'F8') {
        ev.preventDefault();
        this.toggle(false);
      }
    });
  }

  /** 需要的表情有沒有對應的立繪檔（只是警告，缺圖會改用 neutral 或佔位圖）。 */
  private async checkSprites(): Promise<void> {
    const exists = (path: string) =>
      new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = `${projectUrl()}${path}`;
      });
    const warnings = await spriteWarnings(this.engine.script, exists);
    const total = neededSprites(this.engine.script).length;
    this.spriteList.replaceChildren(
      warnings.length
        ? el('div', {}, [
            el('p', {}, [`需要 ${total} 張立繪，缺 ${warnings.length} 張：`]),
            el('ul', { class: 'dev-warnings' }, warnings.map((w) => el('li', {}, [w]))),
          ])
        : el('p', { class: 'dev-ok' }, [`需要的 ${total} 張立繪都有檔案`]),
    );
  }

  /**
   * 呈現調整：轉場、物件提示、每個角色的大小與高度、場景音樂與試聽。
   * 改動立即反映在畫面上，按「儲存調整」寫回 script.json（線上版下載）。
   */
  private buildPresentation(): HTMLElement {
    const e = this.engine;
    const v = this.view;
    const meta = e.script.meta;

    const transition = el('select', { name: 'dev-transition' });
    for (const t of TRANSITION_STYLES) transition.append(el('option', { value: t }, [TRANSITION_LABELS[t]]));
    transition.value = meta.transition ?? 'blink';
    transition.onchange = () => {
      meta.transition = transition.value as TransitionStyle;
      v.applyTransitionStyle();
    };
    const preview = this.button('預覽', () => void v.blink(undefined, 400), { 'data-dev': 'preview-transition' });

    // 題材包：決定啟用哪些效果、退化係數的曲線
    const pack = el('select', { name: 'dev-pack' }, [el('option', { value: currentPack().id }, [currentPack().name])]);
    const packNote = el('p', { class: 'dev-note', 'data-dev': 'pack-note' });
    const describePack = () => {
      const p = currentPack();
      packNote.textContent = `${p.description} 啟用 ${p.effects.length} 種效果，退化係數 ${p.degradation.join(' → ')}。`;
    };
    describePack();
    void listPacks().then((list) => {
      if (!list.length) return;
      pack.replaceChildren(...list.map((p) => el('option', { value: p.id }, [p.name])));
      if (!list.some((p) => p.id === currentPack().id)) pack.append(el('option', { value: currentPack().id }, [currentPack().name]));
      pack.value = currentPack().id;
    });
    pack.onchange = async () => {
      const problems: string[] = [];
      setCurrentPack(await loadPack(pack.value, problems));
      meta.pack = pack.value;
      v.fx.applyGlobal();
      describePack();
      if (problems.length) packNote.textContent += ` ${problems.join('；')}`;
      this.refresh();
    };

    const highlight = el('select', { name: 'dev-highlight' }, [
      el('option', { value: 'glow' }, ['物品本身發亮']),
      el('option', { value: 'ring' }, ['圓圈']),
    ]);
    highlight.value = meta.objectHighlight ?? 'glow';
    highlight.onchange = () => {
      meta.objectHighlight = highlight.value as 'glow' | 'ring';
      v.applyHighlightStyle();
    };

    // 角色大小與高度
    const charSelect = el('select', { name: 'dev-sprite-char' });
    for (const c of e.script.characters ?? []) charSelect.append(el('option', { value: c.id }, [`${c.name}（${c.id}）`]));
    const scale = el('input', { type: 'range', min: '0.5', max: '3', step: '0.05', name: 'dev-sprite-scale' });
    const y = el('input', { type: 'range', min: '-200', max: '60', step: '1', name: 'dev-sprite-y' });
    const scaleOut = el('output', {});
    const yOut = el('output', {});
    const syncSliders = () => {
      const f = v.framingFor(charSelect.value);
      scale.value = String(f.scale);
      y.value = String(f.y);
      scaleOut.textContent = `${f.scale.toFixed(2)} 倍`;
      yOut.textContent = `${f.y}`;
    };
    /** 選到的角色不在畫面上時，先把他叫出來，才看得到調整的結果。 */
    const showChosen = () => {
      const c = e.getChar(charSelect.value);
      if (!c || v.sprite.dataset.char === c.id) return;
      void v.showSprite(c, e.poses[c.id] ?? { expression: 'neutral', gaze: 'camera', distance: 'normal' });
    };
    const applySliders = () => {
      const c = e.getChar(charSelect.value);
      if (!c) return;
      c.sprite = { scale: Number(scale.value), y: Number(y.value) };
      showChosen();
      v.applyFraming(c.id);
      syncSliders();
    };
    charSelect.onchange = () => {
      syncSliders();
      showChosen();
    };
    scale.oninput = applySliders;
    y.oninput = applySliders;
    const applyAll = this.button(
      '套用到所有角色',
      () => {
        meta.sprite = { scale: Number(scale.value), y: Number(y.value) };
        for (const c of e.script.characters ?? []) delete c.sprite;
        if (v.sprite.dataset.char) v.applyFraming(v.sprite.dataset.char);
      },
      { 'data-dev': 'sprite-all' },
    );
    this.syncSpriteChar = () => {
      if (e.lastChar && charSelect.value !== e.lastChar) charSelect.value = e.lastChar;
      syncSliders();
    };

    // 音樂
    const names = new Set<string>();
    for (const s of e.script.scenes) {
      if (s.music) names.add(s.music);
      for (const l of s.lines) if (isText(l) && l.music) names.add(l.music);
    }
    const list = el('datalist', { id: 'dev-music-names' }, [...names].map((n) => el('option', { value: n })));
    const music = el('input', { type: 'text', list: 'dev-music-names', name: 'dev-music', placeholder: '曲名（空白＝靜音）' });
    const applyMusic = this.button(
      '套用到這個場景',
      () => {
        if (!e.scene) return;
        const name = music.value.trim() || null;
        e.scene.music = name;
        v.audio?.unlock();
        v.audio?.playMusic(name);
      },
      { 'data-dev': 'apply-music' },
    );
    const file = el('input', { type: 'file', accept: 'audio/*', name: 'dev-music-file' });
    const musicStatus = el('p', { class: 'dev-note' });
    file.onchange = async () => {
      const f = file.files?.[0];
      const name = music.value.trim() || e.scene?.music || v.audio?.musicName;
      if (!f || !name || !v.audio) {
        musicStatus.textContent = '先在上面填曲名，或在有音樂的場景使用。';
        return;
      }
      const ok = await v.audio.useFile(name, f);
      if (ok) v.audio.playMusic(name);
      musicStatus.textContent = ok
        ? `正在用「${f.name}」試聽「${name}」（只在這次開啟的頁面有效）。確定要用的話，把檔案改名為 ${name}.mp3 或 ${name}.ogg 放進 ${assetFolderLabel('music')}。`
        : `這個檔案瀏覽器無法播放：${f.name}`;
      file.value = '';
    };
    this.syncMusic = () => {
      if (document.activeElement !== music) music.value = e.scene?.music ?? '';
    };

    // 儲存
    const saveStatus = el('p', { class: 'dev-note' });
    const save = this.button(
      import.meta.env.DEV ? '儲存調整（寫回 script.json）' : '儲存調整（下載 script.json）',
      () => {
        void this.saveScript?.().then((m) => (saveStatus.textContent = m));
      },
      { 'data-dev': 'save-presentation', class: 'dev-primary' },
    );

    // 選項的位置與大小（手機直式一律置中）
    const cs = () => (meta.choiceStyle ??= {});
    const choicePos = el('select', { name: 'dev-choice-position' }, [
      el('option', { value: 'right' }, ['對話框右上方']),
      el('option', { value: 'center' }, ['畫面中間']),
    ]);
    choicePos.value = meta.choiceStyle?.position ?? 'right';
    const choiceWidth = el('input', { type: 'range', name: 'dev-choice-width', min: '0.2', max: '0.8', step: '0.02', value: String(meta.choiceStyle?.width ?? 0.36) });
    const choiceScale = el('input', { type: 'range', name: 'dev-choice-scale', min: '0.6', max: '1.3', step: '0.02', value: String(meta.choiceStyle?.scale ?? 0.88) });
    const widthOut = el('output', {}, [`${Math.round(Number(choiceWidth.value) * 100)}%`]);
    const choiceScaleOut = el('output', {}, [`${Number(choiceScale.value).toFixed(2)} 倍`]);
    const applyChoice = () => {
      cs().position = choicePos.value as 'right' | 'center';
      cs().width = Number(choiceWidth.value);
      cs().scale = Number(choiceScale.value);
      widthOut.textContent = `${Math.round(cs().width! * 100)}%`;
      choiceScaleOut.textContent = `${cs().scale!.toFixed(2)} 倍`;
      v.applyChoiceStyle();
    };
    choicePos.onchange = applyChoice;
    choiceWidth.oninput = applyChoice;
    choiceScale.oninput = applyChoice;
    const previewChoice = this.button('預覽選項', () => {
      if (e.phase !== 'text' && e.phase !== 'choice') return;
      if (e.phase === 'choice') return v.applyChoiceStyle();
      const test: ChoiceLine = { choice: [{ text: '第一個選項' }, { text: '比較長一點的第二個選項' }, { text: '第三個選項' }], mode: 'list' };
      v.showChoice(test, test.choice.map((opt, index) => ({ opt, index, locked: false, missing: [] })), () => {
        v.clearChoice();
        v.stage.dataset.phase = e.phase;
      });
    }, { 'data-dev': 'preview-choice' });

    // 標題畫面：遊戲名稱、封面圖；章節卡樣式與大小
    const titleInput = el('input', { type: 'text', name: 'dev-title', value: meta.title });
    titleInput.onchange = () => {
      meta.title = titleInput.value.trim() || meta.title;
      titleInput.value = meta.title;
      document.title = meta.title;
      if (e.phase === 'title') v.showTitle();
    };
    const coverInput = el('input', { type: 'text', name: 'dev-cover', value: meta.cover ?? '', placeholder: '背景圖名稱（assets/bg/）' });
    const coverPortraitInput = el('input', { type: 'text', name: 'dev-cover-portrait', value: meta.coverPortrait ?? '', placeholder: '（選填）手機直式用' });
    const applyCover = () => {
      const c = coverInput.value.trim();
      const cp = coverPortraitInput.value.trim();
      if (c) meta.cover = c;
      else delete meta.cover;
      if (cp) meta.coverPortrait = cp;
      else delete meta.coverPortrait;
      v.applyCover();
    };
    coverInput.onchange = applyCover;
    coverPortraitInput.onchange = applyCover;
    const chapterStyle = el('select', { name: 'dev-chapter-style' }, [
      el('option', { value: 'stacked' }, ['上下兩行都清楚']),
      el('option', { value: 'bold' }, ['「第一章」最大']),
      el('option', { value: 'quiet' }, ['小而淡（舊樣式）']),
    ]);
    chapterStyle.value = meta.chapterStyle?.style ?? 'stacked';
    const chapterScale = el('input', { type: 'range', name: 'dev-chapter-scale', min: '0.6', max: '1.6', step: '0.05', value: String(meta.chapterStyle?.scale ?? 1) });
    const chapterScaleOut = el('output', {}, [`${Number(chapterScale.value).toFixed(2)} 倍`]);
    const applyChapter = () => {
      meta.chapterStyle = { style: chapterStyle.value as 'stacked' | 'bold' | 'quiet', scale: Number(chapterScale.value) };
      chapterScaleOut.textContent = `${meta.chapterStyle.scale!.toFixed(2)} 倍`;
      v.applyChapterStyle();
    };
    chapterStyle.onchange = applyChapter;
    chapterScale.oninput = applyChapter;
    const previewChapter = this.button('預覽', () => void v.previewChapterCard(), { 'data-dev': 'preview-chapter' });
    const uiStyle = el('select', { name: 'dev-ui-style' }, [
      el('option', { value: 'classic' }, ['經典（全幅漸層）']),
      el('option', { value: 'box' }, ['對話框（有邊框）']),
      el('option', { value: 'paper' }, ['紙張（米白、深色字）']),
    ]);
    uiStyle.value = meta.uiStyle ?? 'classic';
    uiStyle.onchange = () => {
      meta.uiStyle = uiStyle.value as 'classic' | 'box' | 'paper';
      v.applyUiStyle();
    };

    return this.section(
      '呈現調整',
      el('label', { class: 'dev-row' }, ['介面樣式', uiStyle]),
      el('label', { class: 'dev-row' }, ['遊戲名稱', titleInput]),
      el('label', { class: 'dev-row' }, ['封面', coverInput]),
      el('label', { class: 'dev-row' }, ['直式封面', coverPortraitInput]),
      el('label', { class: 'dev-row' }, ['章節卡', chapterStyle, previewChapter]),
      el('label', { class: 'dev-row' }, ['章節卡大小', chapterScale, chapterScaleOut]),
      el('label', { class: 'dev-row' }, ['題材包', pack]),
      packNote,
      el('label', { class: 'dev-row' }, ['轉場', transition, preview]),
      el('label', { class: 'dev-row' }, ['物件提示', highlight]),
      el('div', { class: 'dev-row' }, ['角色', charSelect]),
      el('label', { class: 'dev-row' }, ['大小', scale, scaleOut]),
      el('label', { class: 'dev-row' }, ['上下', y, yOut]),
      el('div', { class: 'dev-row' }, [applyAll]),
      el('label', { class: 'dev-row' }, ['選項位置', choicePos, previewChoice]),
      el('label', { class: 'dev-row' }, ['選項寬度', choiceWidth, widthOut]),
      el('label', { class: 'dev-row' }, ['選項大小', choiceScale, choiceScaleOut]),
      el('div', { class: 'dev-row' }, ['音樂', music, list, applyMusic]),
      el('label', { class: 'dev-row' }, ['試聽檔案', file]),
      musicStatus,
      el('div', { class: 'dev-row' }, [save]),
      saveStatus,
    );
  }

  /**
   * 專案：匯出整個遊戲成一個專案檔、開啟專案檔、把目前的遊戲存成本機專案、關閉本機專案。
   * 開啟／存成／關閉之後重新載入頁面，遊戲從頭開始。
   */
  private buildProject(project: ProjectSession): HTMLElement {
    const e = this.engine;
    const local = project.mode === 'local';
    const where = el('p', { class: 'dev-project-where', 'data-dev': 'project-mode', 'data-mode': project.mode });
    const msg = el('p', { class: 'dev-note', 'data-dev': 'project-status', 'aria-live': 'polite' });
    const showWhere = () => {
      where.textContent = local
        ? `目前：本機專案「${e.script.meta.title}」，存在${project.store.label}裡${project.savedAt ? `（最後儲存 ${timeLabel(project.savedAt)}）` : ''}。文字修改按「儲存」、上傳的素材會自動存進去。`
        : '目前：網站上的遊戲。這裡的修改和上傳只在這次開啟的頁面有效。';
      if (project.lastError) msg.textContent = project.lastError;
    };
    this.syncProject = showWhere;
    showWhere();

    const busy = (on: boolean) => {
      for (const b of buttons) b.disabled = on;
      file.disabled = on;
    };
    const progress = (verb: string) => (done: number, total: number) => {
      msg.textContent = total ? `${verb}：收集素材 ${done} / ${total}…` : `${verb}…`;
    };
    /** reload：完成後重新載入，'local' 開本機專案、'site' 回到網站上的原版。 */
    const run = async (task: () => Promise<string | void>, reload?: 'local' | 'site') => {
      busy(true);
      try {
        const text = await task();
        if (reload) {
          msg.textContent = '完成，重新載入…';
          reloadWithProject(reload === 'local');
          return;
        }
        if (text) msg.textContent = text;
      } catch (err) {
        msg.textContent = `沒有成功：${(err as Error)?.message ?? err}`;
      }
      busy(false);
      showWhere();
    };

    const playBtn = this.button(
      '匯出可以玩的版本',
      () =>
        void run(async () => {
          msg.textContent = '打包中…';
          const r = await exportPlayable(e.script, localFiles());
          downloadBlob(r.blob, r.fileName);
          return `已下載 ${r.fileName}（${r.files} 個素材）。解壓縮後雙擊 html 就能玩，也可以放到網站上。${r.note}`;
        }),
      { 'data-dev': 'export-playable' },
    );
    const exportBtn = this.button('匯出專案檔', () => void run(() => project.exportFile(e.script, progress('匯出中'))), {
      'data-dev': 'export-project',
      class: 'dev-primary',
    });
    const file = el('input', { type: 'file', name: 'dev-project-file', accept: `.${PROJECT_EXT},.zip` });
    file.onchange = () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      if (local && !confirm('開啟後會取代目前的本機專案。還沒匯出的修改會不見，確定嗎？')) return;
      void run(async () => {
        msg.textContent = `開啟「${f.name}」…`;
        await project.openFile(f);
      }, 'local');
    };
    const saveLocal = this.button(
      '存成本機專案',
      () => void run(() => project.saveAsLocal(e.script, progress('存成本機專案')), 'local'),
      { 'data-dev': 'save-local' },
    );
    const close = this.button(
      '關閉本機專案',
      () => {
        if (!confirm('關閉後會回到網站上的遊戲，這個瀏覽器裡的專案會刪掉。先匯出專案檔了嗎？')) return;
        void run(() => project.close(), 'site');
      },
      { 'data-dev': 'close-project' },
    );
    const buttons = [exportBtn, playBtn, local ? close : saveLocal];
    // 看原版時，瀏覽器裡若還有本機專案，給一個打開它的連結（遊戲網址預設不讀本機專案）
    const stored = el('p', { class: 'dev-note', 'data-dev': 'stored-project' });
    if (!local) {
      void project.store.load().then(
        (p) => {
          if (!p) return;
          const open = el('a', { href: '#', 'data-dev': 'open-stored' }, ['打開它']);
          open.onclick = (ev) => {
            ev.preventDefault();
            reloadWithProject(true);
          };
          stored.replaceChildren(`這個瀏覽器裡還有本機專案《${p.script.meta.title}》：`, open);
        },
        () => {},
      );
    }

    return this.section(
      '專案',
      where,
      stored,
      el('div', { class: 'dev-row dev-wrap' }, buttons),
      el('label', { class: 'dev-row' }, ['開啟專案檔', file]),
      msg,
      el('p', { class: 'dev-note' }, [
        `專案檔（.${PROJECT_EXT}）把劇本和所有圖片、配音、音樂裝在一個檔案裡，可以存在電腦、傳給別人。開啟後存在${project.store.label}裡，重新整理也還在；換電腦或換瀏覽器時，用專案檔帶過去。`,
      ]),
    );
  }

  private syncProject: () => void = () => {};
  private syncObjects: () => void = () => {};

  /**
   * 可以點的物件（目前場景）：新增、刪除、在畫面上拖曳位置，調大小、疊圖寬度、第幾句出現、
   * 一定要點、提醒動畫、循環音效。只保證電腦上好操作。按「儲存物件」寫回 script.json。
   */
  private buildObjects(): HTMLElement {
    const e = this.engine;
    const v = this.view;
    const select = el('select', { name: 'dev-object' });
    const editing = el('input', { type: 'checkbox', name: 'dev-object-edit' });
    const fields = el('div', { class: 'dev-object-fields', 'data-dev': 'object-fields' });
    const msg = el('p', { class: 'dev-note', 'data-dev': 'object-status', 'aria-live': 'polite' });
    let sceneId = '';
    let selected: string | null = null;

    const objects = (): SceneObject[] => e.scene?.objects ?? [];
    const current = (): SceneObject | undefined => objects().find((o) => o.id === selected);
    const redraw = () => {
      if (v.objectEdit) v.objectEdit.selected = selected;
      if (e.phase === 'text' || v.objectEdit) v.renderObjects();
    };
    const setEditing = (on: boolean) => {
      editing.checked = on;
      v.objectEdit = on
        ? {
            selected,
            onSelect: (id) => {
              selected = id;
              select.value = id;
              renderFields();
            },
            onMove: () => renderFields(true),
          }
        : null;
      v.renderObjects();
    };
    editing.onchange = () => setEditing(editing.checked);

    const num = (label: string, key: 'x' | 'y', obj: SceneObject) =>
      el('span', { class: 'dev-object-xy', 'data-dev': `object-${key}` }, [`${label} ${obj[key].toFixed(3)}`]);
    const range = (name: string, min: number, max: number, step: number, value: number, onInput: (n: number) => void) => {
      const r = el('input', { type: 'range', name, min: String(min), max: String(max), step: String(step), value: String(value) });
      r.oninput = () => onInput(Number(r.value));
      return r;
    };

    const renderFields = (onlyXY = false) => {
      const obj = current();
      if (!obj) {
        fields.replaceChildren(el('p', { class: 'dev-note' }, [objects().length ? '選一個物件。' : '這個場景還沒有物件。']));
        return;
      }
      if (onlyXY) {
        fields.querySelector('[data-dev=object-x]')?.replaceWith(num('x', 'x', obj));
        fields.querySelector('[data-dev=object-y]')?.replaceWith(num('y', 'y', obj));
        return;
      }
      const lines = e.scene?.lines.length ?? 1;
      const rOut = el('output', {}, [(obj.r ?? 0.04).toFixed(3)]);
      const owOut = el('output', {}, [obj.overlayWidth ? obj.overlayWidth.toFixed(2) : '不疊圖']);
      const at = el('input', { type: 'number', name: 'dev-object-appear', min: '0', max: String(lines - 1), value: String(obj.appearAt ?? 0) });
      at.onchange = () => {
        obj.appearAt = Math.max(0, Math.min(lines - 1, Math.round(Number(at.value) || 0)));
        at.value = String(obj.appearAt);
        redraw();
      };
      const here = this.button('目前這句', () => {
        obj.appearAt = e.index;
        at.value = String(obj.appearAt);
        redraw();
      }, { 'data-dev': 'object-appear-here' });
      const required = el('input', { type: 'checkbox', name: 'dev-object-required' });
      required.checked = !!obj.required;
      required.onchange = () => {
        if (required.checked) obj.required = true;
        else delete obj.required;
        redraw();
      };
      const attention = el('select', { name: 'dev-object-attention' }, [
        el('option', { value: '' }, ['沒有']),
        el('option', { value: 'glow' }, ['柔和發亮（glow）']),
        el('option', { value: 'ring' }, ['震動＋發亮（ring）']),
      ]);
      attention.value = obj.attention ?? '';
      attention.onchange = () => {
        if (attention.value) obj.attention = attention.value as 'glow' | 'ring';
        else delete obj.attention;
        redraw();
      };
      const sfx = el('input', { type: 'text', name: 'dev-object-sfx', value: obj.sfx ?? '', placeholder: '音效名稱（例如 phone_ring）' });
      sfx.onchange = () => {
        const name = sfx.value.trim();
        if (name) obj.sfx = name;
        else delete obj.sfx;
      };
      const label = el('input', { type: 'text', name: 'dev-object-label', value: obj.label });
      label.onchange = () => {
        obj.label = label.value.trim() || obj.label;
        refreshList();
        redraw();
      };
      fields.replaceChildren(
        el('div', { class: 'dev-row' }, [num('x', 'x', obj), num('y', 'y', obj)]),
        el('label', { class: 'dev-row' }, ['名稱', label]),
        el('label', { class: 'dev-row' }, [
          '大小',
          range('dev-object-r', 0.02, 0.15, 0.005, obj.r ?? 0.04, (n) => {
            obj.r = n;
            rOut.textContent = n.toFixed(3);
            redraw();
          }),
          rOut,
        ]),
        el('label', { class: 'dev-row' }, [
          '疊圖寬',
          range('dev-object-overlay', 0, 0.3, 0.01, obj.overlayWidth ?? 0, (n) => {
            if (n >= 0.03) obj.overlayWidth = n;
            else delete obj.overlayWidth;
            owOut.textContent = obj.overlayWidth ? n.toFixed(2) : '不疊圖';
            redraw();
          }),
          owOut,
        ]),
        el('div', { class: 'dev-row' }, [el('label', {}, ['第幾句出現（0 起算）', at]), here]),
        el('label', { class: 'dev-row' }, [required, '一定要點（required）']),
        el('label', { class: 'dev-row' }, ['提醒動畫', attention]),
        el('label', { class: 'dev-row' }, ['循環音效', sfx]),
      );
    };

    const refreshList = () => {
      const list = objects();
      if (!list.some((o) => o.id === selected)) selected = list[0]?.id ?? null;
      select.replaceChildren(...list.map((o) => el('option', { value: o.id }, [`${o.label}（${o.id}）`])));
      if (selected) select.value = selected;
      select.disabled = !list.length;
    };
    select.onchange = () => {
      selected = select.value;
      renderFields();
      redraw();
    };

    const add = this.button(
      '新增物件',
      () => {
        const scene = e.scene;
        if (!scene) return;
        const used = new Set(e.script.scenes.flatMap((s) => (s.objects ?? []).map((o) => o.id)));
        let n = 1;
        while (used.has(`${scene.id}_obj${n}`)) n++;
        const obj: SceneObject = { id: `${scene.id}_obj${n}`, label: '新物件', x: 0.5, y: 0.5, r: 0.05, appearAt: e.index, description: '（請寫說明）' };
        (scene.objects ??= []).push(obj);
        e.reindex();
        selected = obj.id;
        refreshList();
        renderFields();
        setEditing(true);
        msg.textContent = `已新增「${obj.id}」。說明文字請在文字編輯器或故事編輯器改。`;
      },
      { 'data-dev': 'object-add' },
    );
    const remove = this.button(
      '刪除',
      () => {
        const scene = e.scene;
        const obj = current();
        if (!scene || !obj || !confirm(`刪除物件「${obj.label}」？`)) return;
        scene.objects = (scene.objects ?? []).filter((o) => o !== obj);
        if (!scene.objects.length) delete scene.objects;
        e.reindex();
        refreshList();
        renderFields();
        redraw();
      },
      { 'data-dev': 'object-delete' },
    );
    const save = this.button(
      '儲存物件',
      () => {
        msg.textContent = '儲存中…';
        void (this.saveStructure ?? this.saveScript)?.().then((m) => (msg.textContent = m));
      },
      { 'data-dev': 'object-save' },
    );

    this.syncObjects = () => {
      const id = e.scene?.id ?? '';
      if (id === sceneId) return;
      sceneId = id;
      selected = null;
      refreshList();
      renderFields();
      if (v.objectEdit) v.objectEdit.selected = selected;
    };

    return this.section(
      '可以點的物件',
      el('p', { class: 'dev-note' }, ['勾「在畫面上拖曳」後，畫面上會顯示這個場景的所有物件（右上角數字是第幾句出現），直接拖曳移動。手機上可以看，拖曳請用電腦。']),
      el('div', { class: 'dev-row' }, [select, add, remove]),
      el('label', { class: 'dev-row' }, [editing, '在畫面上拖曳']),
      fields,
      el('div', { class: 'dev-row' }, [save]),
      msg,
    );
  }
  private syncSpriteChar: () => void = () => {};
  private syncMusic: () => void = () => {};

  /** 手動觸發效果：作用在目前這一句；選項類效果若畫面上沒有選項，會叫出一組測試選項。 */
  private triggerFx(fx: FxTag): void {
    const e = this.engine;
    const v = this.view;
    const line = e.currentLine;
    if (fx === 'choice_vanish' || fx === 'flat_options') {
      const current = v.choices.classList.contains('open') ? [...v.choices.querySelectorAll<HTMLElement>('.choice, .hotspot')] : [];
      if (current.length) {
        v.fx.applyChoice({ choice: [], fx: [fx], mode: v.choices.dataset.mode as 'list' | 'hotspot' }, v.choices, current);
        return;
      }
      const test: ChoiceLine = {
        prompt: '（開發者面板：測試選項）',
        choice: [{ text: '第一個選項' }, { text: '第二個選項？' }, { text: '第三個選項！' }, { text: '第四個選項' }],
        mode: 'list',
        fx: [fx],
      };
      v.showChoice(test, test.choice.map((opt, index) => ({ opt, index, locked: false, missing: [] })), () => {
        v.clearChoice();
        v.stage.dataset.phase = e.phase;
      });
      return;
    }
    if (fx === 'repeat_line' && line && isText(line)) {
      e.repeats.push({ line, remaining: 1 });
    }
    v.fx.trigger(fx, { line: line && isText(line) ? line : undefined });
  }

  refresh(): void {
    if (!this.isOpen) return;
    const e = this.engine;
    const ending = pickEnding(e.script, e.condContext);
    const rows: [string, string][] = [
      ['場景', e.scene ? `${e.scene.id}（第 ${e.scene.act ?? 1} 幕）` : '—'],
      ['句', e.scene ? `${e.index + 1} / ${e.scene.lines.length}` : '—'],
      ['狀態', e.phase],
      ['退化', `${e.degradation.toFixed(2)}${e.degradationOverride == null ? '（自動）' : '（手動）'}`],
      ['去飽和', e.desat.toFixed(2)],
      ['旗標', e.flags.length ? e.flags.join(', ') : '（無）'],
      ['看過', e.seen.length ? e.seen.join(', ') : '（無）'],
      ['目前會走向', ending ? `${ending.id}｜${ending.title}` : '—'],
    ];
    this.status.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, [k]), el('dd', {}, [v])]));

    const range = e.script.meta.statRange ?? { min: -Infinity, max: Infinity };
    this.stats.replaceChildren(
      ...Object.keys(e.stats).map((k) =>
        el('div', { class: 'dev-row dev-stat', 'data-stat': k }, [
          el('span', { class: 'dev-stat-name' }, [k]),
          this.button('−', () => (e.stats[k] = clamp(e.stats[k] - 1, range.min, range.max))),
          el('strong', {}, [String(e.stats[k])]),
          this.button('+', () => (e.stats[k] = clamp(e.stats[k] + 1, range.min, range.max))),
        ]),
      ),
    );
    // 只在場景真的換了時同步下拉選單，避免蓋掉使用者剛選的值
    if (e.scene && e.scene.id !== this.lastScene) {
      this.lastScene = e.scene.id;
      this.sceneSelect.value = e.scene.id;
      this.syncMusic();
    }
    this.syncSpriteChar();
    this.syncProject();
    this.syncObjects();
    this.degRange.value = String(e.degradation);
    this.degOut.textContent = e.degradation.toFixed(2);
    const pose = e.lastChar ? e.poses[e.lastChar] : null;
    this.gazeSelect.disabled = this.distSelect.disabled = !pose;
    if (pose) {
      this.gazeSelect.value = pose.gaze;
      this.distSelect.value = pose.distance;
    }
  }
}
