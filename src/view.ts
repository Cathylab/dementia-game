import { imageSize, resolveImage, resolveSprite, type ImageKind } from './assets';
import { Effects, fadeText, glitchSpans } from './fx';
import type { CharPose, Engine, ShownOption, View } from './engine';
import { ICONS } from './icons';
import { activeFx, currentPack } from './pack';
import { saveTimeLabel, type SaveData, type SaveStore } from './saves';
import { setSetting, settings, type MemoryReviewMode } from './settings';
import { Typewriter } from './typewriter';
import type {
  Character,
  ChoiceLine,
  ChoiceOption,
  Ending,
  Scene,
  SceneObject,
  SpriteFraming,
  TextLine,
  TransitionStyle,
  UiKey,
} from './types';
import { el, shuffle, sleep, T } from './util';

/** 聲音模組需提供的介面（見 audio.ts）。 */
export interface AudioLike {
  setMuffle(on: boolean): void;
  /** 物件的循環音效：只留這些名稱，其餘停止。 */
  setSfxLoops(names: string[]): void;
  setDegradation(d: number): void;
  setVolume(v: number): void;
  playMusic(name: string | null | undefined): void;
  unlock(): void;
  /** 目前播放的曲名。 */
  readonly musicName: string | null;
  /** 把電腦裡的音樂檔暫時當成某個曲名來播（開發者面板試聽用）。 */
  useFile(name: string, file: Blob): Promise<boolean>;
  /** 把電腦裡的音檔暫時當成某句配音（開發者面板上傳用）。 */
  useVoiceFile(id: string, file: Blob): Promise<boolean>;
  /** 播一句配音；播完、被停止或缺檔時完成。 */
  playVoice(id: string): Promise<void>;
  stopVoice(): void;
  /** 這句配音有沒有音檔。 */
  hasVoice(id: string): Promise<boolean>;
  setVoiceVolume(v: number): void;
  /** 有沒有這首音樂的檔案。 */
  hasMusic(name: string): Promise<boolean>;
  /** 播一個音效（只播一次）。 */
  playSfx(name: string): void;
  hasSfx(name: string): Promise<boolean>;
  /** 上傳了新的音效檔：忘掉之前載入的。 */
  forgetSfx(name: string): void;
  /** 把電腦裡的音檔當成某個音效（開發者面板上傳用）。 */
  useSfxFile(name: string, file: Blob): Promise<boolean>;
}

/** 依 0–1 比例座標放置熱點（hotspot 選項與可點的物件共用）。 */
function clampN(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** overlayWidth 限制在 0.03～0.3；沒寫或不是數字＝不疊圖。 */
function overlayWidthOf(obj: SceneObject): number {
  const w = obj.overlayWidth;
  return typeof w === 'number' && w > 0 ? Math.min(0.3, Math.max(0.03, w)) : 0;
}

function placeSpot(b: HTMLElement, x = 0.5, y = 0.5, r = 0.04): void {
  b.style.left = `${x * 100}%`;
  b.style.top = `${y * 100}%`;
  b.style.setProperty('--r', String(r));
}

/**
 * 點一下執行 onTap；長按（手機）執行 onLongPress，且不觸發 onTap。
 * ignore 回傳 true 時（例如正在拖曳畫面）兩者都不觸發。
 */
function bindPress(b: HTMLElement, onTap: () => void, onLongPress: () => void, ignore: () => boolean = () => false): void {
  let pressTimer = 0;
  let longPressed = false;
  b.addEventListener('pointerdown', () => {
    longPressed = false;
    pressTimer = window.setTimeout(() => {
      if (ignore()) return;
      longPressed = true;
      onLongPress();
    }, 450);
  });
  const cancel = () => clearTimeout(pressTimer);
  b.addEventListener('pointerup', cancel);
  b.addEventListener('pointerleave', cancel);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (longPressed || ignore()) {
      longPressed = false;
      return;
    }
    onTap();
  });
}

const TOOLBAR: { key: UiKey; label: string }[] = [
  { key: 'back', label: '回上一句' },
  { key: 'auto', label: '自動' },
  { key: 'skip', label: '快轉' },
  { key: 'log', label: '紀錄' },
  { key: 'hide', label: '隱藏' },
  { key: 'settings', label: '設定' },
  { key: 'pause', label: '暫停' },
];

/** 經典 ADV 版面：全螢幕背景、置中立繪、下方三分之一的漸層台詞區、底部功能列。 */
export class AdvView implements View {
  readonly stage = el('div', { class: 'stage', id: 'stage' });
  readonly layers = el('div', { class: 'scene-layers' });
  readonly bgLayer = el('div', { class: 'bg-layer' });
  readonly bgPan = el('div', { class: 'bg-pan' });
  readonly bg = el('div', { class: 'bg' });
  readonly charLayer = el('div', { class: 'char-layer' });
  readonly sprite = el('img', { class: 'sprite', alt: '' });
  readonly fgLayer = el('div', { class: 'fg-layer' });
  readonly fg = el('img', { class: 'fg', alt: '' });
  readonly dialog = el('div', { class: 'dialog' });
  readonly nameBox = el('div', { class: 'namebox' });
  readonly nameEl = el('span', { class: 'name' });
  readonly traitEl = el('span', { class: 'trait' });
  readonly textEl = el('div', { class: 'text' });
  readonly choices = el('div', { class: 'choices' });
  /**
   * 物件熱點的座標是「背景圖上的位置」：外層跟著畫面晃動，中層跟著視線平移，
   * 內層（objectsBg）與背景圖同樣的框，熱點放在裡面。
   */
  readonly objectsLayer = el('div', { class: 'objects' });
  readonly objectsPan = el('div', { class: 'objects-pan' });
  readonly objectsBg = el('div', { class: 'objects-bg' });
  /** 物件在畫面外時，邊緣的提示箭頭。 */
  readonly edgeLeft = el('div', { class: 'edge-hint left', 'aria-hidden': 'true' }, ['‹']);
  readonly edgeRight = el('div', { class: 'edge-hint right', 'aria-hidden': 'true' }, ['›']);
  readonly swipeHint = el('div', { class: 'swipe-hint', 'aria-hidden': 'true' }, ['← 左右滑動看看 →']);
  /** 「找找看」時刻：提示文字＋「繼續」按鈕（點背景不會往下）。 */
  readonly exploreText = el('p', { class: 'explore-text' });
  readonly exploreSwipe = el('p', { class: 'explore-swipe' }, ['← 左右滑動看看 →']);
  readonly exploreNext = el('button', { class: 'explore-next', type: 'button', 'data-explore': 'next' }, ['繼續']);
  readonly exploreBar = el('div', { class: 'explore-bar', role: 'status' }, [
    this.exploreText,
    el('div', { class: 'explore-row' }, [this.exploreSwipe, this.exploreNext]),
  ]);
  private nudgeTimer = 0;
  /**
   * 開發者面板「物件位置」：編輯中時畫出場景裡所有物件（不管 appearAt、if），
   * 拖曳改位置、點一下選取，不會打開說明卡。
   */
  objectEdit: { selected: string | null; onSelect: (id: string) => void; onMove: (obj: SceneObject) => void } | null = null;
  private quickPanTimer = 0;
  /** 目前的視線平移（舞台寬度的百分比）。 */
  private pan = 0;
  /** 手機直式拖曳背景的狀態。 */
  private drag: { id: number; x0: number; pan0: number; moved: boolean } | null = null;
  /** 剛拖曳完：吃掉緊接著的 click，不推進台詞、不打開物件。 */
  private justDragged = false;
  readonly inspectEl = el('div', { class: 'inspect', role: 'dialog', 'aria-modal': 'true' });
  readonly memoryCard = el('div', { class: 'memory-card', 'aria-live': 'polite' });
  readonly memoryPage = el('div', { class: 'screen memory-page', role: 'dialog' });
  readonly monologueText = el('p', { class: 'monologue-text' });
  readonly monologue = el('div', { class: 'monologue', 'aria-live': 'polite' }, [this.monologueText]);
  readonly toolbar = el('nav', { class: 'toolbar', 'aria-label': '功能列' });
  readonly menuToggle = el('button', { class: 'menu-toggle', type: 'button', 'aria-label': '選單' });
  readonly blinkEl = el('div', { class: 'blink' }, [el('div', { class: 'lid top' }), el('div', { class: 'lid bottom' })]);
  /** 淡入淡出轉場用的黑幕。 */
  readonly fadeEl = el('div', { class: 'fade-curtain' });
  /** 每一幕開頭的章節卡（第一章／婚禮前半年）。 */
  readonly chapterCard = el('div', { class: 'chapter-card', 'aria-live': 'polite' });
  readonly logOverlay = el('div', { class: 'overlay log-overlay', role: 'dialog' });
  readonly settingsOverlay = el('div', { class: 'overlay settings-overlay', role: 'dialog' });
  /** 暫停選單：繼續、存檔、讀檔、設定、回到標題。 */
  readonly pauseOverlay = el('div', { class: 'overlay pause-overlay', role: 'dialog', 'aria-label': '暫停' });
  /** 存檔簿（main.ts 設定）；沒有就不顯示存檔、讀檔。 */
  saves: SaveStore | null = null;
  readonly titleScreen = el('div', { class: 'screen title-screen' });
  readonly endingScreen = el('div', { class: 'screen ending-screen' });
  readonly buttons = new Map<UiKey, HTMLButtonElement>();

  readonly typer = new Typewriter(this.textEl);
  readonly fx = new Effects(this);
  audio: AudioLike | null = null;
  auto = false;
  skip = false;
  private autoTimer = 0;
  private skipTimer = 0;
  private monologueTimer = 0;
  /** 目前這句配音播完（或沒有配音）時完成；自動模式與獨白等它。 */
  private voiceDone: Promise<void> = Promise.resolve();
  private pendingType: (() => void) | null = null;
  private pendingTimer = 0;
  private monologueStay = 0;
  private inspectTimer = 0;
  /** 標題畫面下方的小字（例如「本機專案」），空字串＝不顯示。 */
  titleNote = '';
  /** 上一個顯示過的幕；換幕時才出現章節卡。回標題時清掉。 */
  private lastAct: number | null = null;
  private skipChapter: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    readonly engine: Engine,
  ) {
    this.build();
  }

  // ───────────────────────── 建立 DOM ─────────────────────────

  private build(): void {
    this.bgPan.append(this.bg);
    this.bgLayer.append(this.bgPan);
    this.charLayer.append(this.sprite);
    this.fgLayer.append(this.fg);
    this.layers.append(this.bgLayer, this.charLayer, this.fgLayer);
    this.nameBox.append(this.nameEl, this.traitEl);
    this.dialog.append(this.nameBox, this.textEl, el('div', { class: 'next-indicator', 'aria-hidden': 'true' }, ['▼']));
    this.sprite.hidden = true;
    this.fg.hidden = true;

    for (const { key, label } of TOOLBAR) {
      const b = el('button', { class: `tool tool-${key}`, type: 'button', 'data-key': key, title: label });
      b.innerHTML = `${ICONS[key]}<span>${label}</span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stage.classList.remove('menu-open');
        this.onTool(key);
      });
      this.buttons.set(key, b);
      this.toolbar.append(b);
    }
    this.menuToggle.innerHTML = `${ICONS.menu}<span>選單</span>`;
    this.menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.stage.classList.toggle('menu-open');
    });

    this.objectsPan.append(this.objectsBg);
    this.objectsLayer.append(this.objectsPan, this.edgeLeft, this.edgeRight, this.swipeHint);
    this.stage.append(
      this.layers,
      el('div', { class: 'vignette' }),
      this.memoryCard,
      this.dialog,
      // 熱點疊在台詞區之上：背景圖下方桌上的東西也點得到
      this.objectsLayer,
      this.exploreBar,
      this.monologue,
      this.choices,
      this.toolbar,
      this.menuToggle,
      this.inspectEl,
      this.blinkEl,
      this.fadeEl,
      this.chapterCard,
      this.logOverlay,
      this.settingsOverlay,
      this.pauseOverlay,
      this.endingScreen,
      this.memoryPage,
      this.titleScreen,
    );
    this.root.replaceChildren(this.stage);

    this.stage.addEventListener('click', () => this.onStageClick());
    this.exploreNext.addEventListener('click', (e) => {
      e.stopPropagation();
      this.engine.next(true);
    });
    this.exploreBar.addEventListener('click', (e) => e.stopPropagation());
    this.bindDrag();
    this.inspectEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeInspect();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.chapterCard.addEventListener('click', (e) => {
      e.stopPropagation();
      this.skipChapter?.();
    });
  }

  private onStageClick(): void {
    if (this.justDragged) {
      this.justDragged = false;
      return;
    }
    if (this.stage.classList.contains('menu-open')) {
      this.stage.classList.remove('menu-open');
      return;
    }
    if (this.stage.classList.contains('ui-hidden')) {
      this.stage.classList.remove('ui-hidden');
      return;
    }
    if (this.overlayOpen()) return;
    this.stopSkip();
    this.engine.advance();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (this.skipChapter && (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault();
      this.skipChapter();
      return;
    }
    if (this.inspectOpen()) {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.closeInspect();
      }
      return;
    }
    if (e.key === 'Escape') {
      // 沒有開著的視窗時，Esc 打開暫停選單
      if (!this.overlayOpen() && (this.engine.phase === 'text' || this.engine.phase === 'choice')) {
        this.openPause();
        return;
      }
      this.closeOverlays();
      this.stage.classList.remove('ui-hidden', 'menu-open');
      return;
    }
    if (this.engine.phase === 'title' || this.overlayOpen()) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.onStageClick();
    } else if (e.key === 'Backspace' || e.key === 'PageUp') {
      this.onTool('back');
    } else if (e.key === 'h' || e.key === 'H') {
      this.onTool('hide');
    }
  }

  overlayOpen(): boolean {
    return (
      this.logOverlay.classList.contains('open') ||
      this.settingsOverlay.classList.contains('open') ||
      this.pauseOverlay.classList.contains('open') ||
      this.inspectOpen()
    );
  }

  inspectOpen(): boolean {
    return this.inspectEl.classList.contains('open');
  }

  closeOverlays(): void {
    this.logOverlay.classList.remove('open');
    this.settingsOverlay.classList.remove('open');
    this.pauseOverlay.classList.remove('open');
    this.stage.querySelector('.credits-overlay')?.remove();
  }

  // ───────────────────────── 功能列 ─────────────────────────

  onTool(key: UiKey): void {
    const b = this.buttons.get(key);
    if (b?.disabled || b?.classList.contains('hidden-by-script')) return;
    if (this.engine.phase === 'title') return;
    switch (key) {
      case 'back':
        this.stopAuto();
        this.stopSkip();
        void this.engine.back();
        break;
      case 'auto':
        if (this.auto) this.stopAuto();
        else this.startAuto();
        break;
      case 'skip':
        if (this.skip) this.stopSkip();
        else this.startSkip();
        break;
      case 'log':
        this.openLog();
        break;
      case 'hide':
        this.stage.classList.add('ui-hidden');
        break;
      case 'settings':
        this.openSettings();
        break;
      case 'title':
        this.stopAuto();
        this.stopSkip();
        this.engine.toTitle();
        break;
      case 'pause':
        this.openPause();
        break;
    }
  }

  // ───────────────────────── 暫停選單與存檔 ─────────────────────────

  /** 暫停：停下自動與快轉，打開選單。 */
  openPause(view: 'menu' | 'save' | 'load' = 'menu'): void {
    this.stopAuto();
    this.stopSkip();
    this.closeOverlays();
    this.stage.classList.remove('menu-open');
    const close = () => {
      this.pauseOverlay.classList.remove('open');
      if (this.stage.classList.contains('monologue-on')) this.startMonologueTimer();
    };
    const btn = (label: string, onClick: () => void, attrs: Record<string, string> = {}) => {
      const b = el('button', { type: 'button', class: 'pause-button', ...attrs }, [label]);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    };
    const playing = this.engine.phase !== 'title' && this.engine.phase !== 'ending';
    let body: HTMLElement[];
    if (view === 'menu') {
      const titleMode = this.uiMode('title');
      const toTitle = btn('回到標題', () => {
        close();
        this.engine.toTitle();
      }, { 'data-pause': 'title' });
      toTitle.disabled = titleMode === 'disabled';
      body = [
        el('h2', {}, ['暫停']),
        btn('繼續', close, { 'data-pause': 'resume' }),
        ...(this.saves && playing ? [btn('存檔', () => this.openPause('save'), { 'data-pause': 'save' })] : []),
        ...(this.saves ? [btn('讀檔', () => this.openPause('load'), { 'data-pause': 'load' })] : []),
        btn('設定', () => {
          close();
          this.openSettings();
        }, { 'data-pause': 'settings' }),
        ...(titleMode === 'hidden' ? [] : [toTitle]),
      ];
    } else {
      body = [el('h2', {}, [view === 'save' ? '存檔' : '讀檔']), ...this.saveSlots(view, close), btn('返回', () => this.openPause('menu'), { 'data-pause': 'back' })];
    }
    this.pauseOverlay.replaceChildren(el('div', { class: 'pause-menu' }, body));
    this.pauseOverlay.dataset.view = view;
    this.pauseOverlay.classList.add('open');
    this.pauseOverlay.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  /** 存檔或讀檔的欄位：自動存檔（只能讀）＋3 個手動欄位。 */
  private saveSlots(mode: 'save' | 'load', close: () => void): HTMLElement[] {
    const saves = this.saves!;
    const book = saves.load();
    const rows: HTMLElement[] = [];
    const row = (name: string, data: SaveData | null, slot: number | 'auto') => {
      const info = data ? `${data.label}（${saveTimeLabel(data.savedAt)}）` : '（空的）';
      const b = el('button', { type: 'button', class: 'save-slot', 'data-slot': String(slot) }, [
        el('strong', {}, [name]),
        el('span', {}, [info]),
      ]);
      b.disabled = mode === 'load' ? !data : slot === 'auto';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (mode === 'save' && typeof slot === 'number') {
          const d = this.engine.saveData();
          if (!d) return;
          if (data && !confirm(`覆蓋「${name}」？`)) return;
          if (!saves.saveSlot(slot, d)) alert('沒有存成功（瀏覽器的空間可能不夠，或是在私密瀏覽模式）。');
          this.openPause('save');
          this.pauseOverlay.querySelector(`[data-slot="${slot}"]`)?.classList.add('just-saved');
        } else if (mode === 'load' && data) {
          close();
          void this.loadGame(data);
        }
      });
      rows.push(b);
    };
    row('自動存檔', book.auto, 'auto');
    book.slots.forEach((d, i) => row(`存檔 ${i + 1}`, d, i));
    return rows;
  }

  /** 讀檔（標題畫面的「繼續」也用這個）。 */
  async loadGame(data: SaveData): Promise<void> {
    this.titleScreen.classList.remove('open');
    this.endingScreen.classList.remove('open');
    this.memoryPage.classList.remove('open');
    this.audio?.unlock();
    try {
      await this.engine.loadSave(data);
    } catch (err) {
      alert(`讀不到這個存檔：${(err as Error).message}`);
      this.engine.toTitle();
    }
  }

  startAuto(): void {
    this.auto = true;
    this.buttons.get('auto')?.classList.add('active');
    this.stage.classList.add('auto-on');
    if (this.engine.phase === 'text' && this.engine.textFinished) this.scheduleAuto();
  }

  stopAuto(): void {
    this.auto = false;
    clearTimeout(this.autoTimer);
    this.buttons.get('auto')?.classList.remove('active');
    this.stage.classList.remove('auto-on');
  }

  protected scheduleAuto(): void {
    clearTimeout(this.autoTimer);
    if (!this.auto) return;
    const token = this.engine.token;
    const len = this.textEl.textContent?.length ?? 0;
    // 有配音時：聲音和文字都結束後，再加原本的停頓
    void this.voiceDone.then(() => {
      if (!this.auto || token !== this.engine.token) return;
      clearTimeout(this.autoTimer);
      this.autoTimer = window.setTimeout(() => {
        if (!this.auto || token !== this.engine.token || this.overlayOpen()) return;
        this.autoAdvance();
      }, T(1200 + len * 70));
    });
  }

  /** 播這句的配音（快轉中不播）。沒有配音就讓上一句的聲音淡出。 */
  private startVoice(id: string | undefined): void {
    if (!id || this.skip || !this.audio) {
      this.audio?.stopVoice();
      this.voiceDone = Promise.resolve();
      return;
    }
    this.voiceDone = this.audio.playVoice(id);
  }

  /** 自動播放時前進一句。ui.auto = "skips_lines" 時偶爾直接跳過一句。 */
  protected autoAdvance(): void {
    this.engine.next();
    if (this.uiMode('auto') === 'skips_lines' && this.engine.phase === 'text' && Math.random() < 0.35) {
      this.typer.complete();
      this.engine.next();
      this.stage.dataset.autoSkipped = String(Number(this.stage.dataset.autoSkipped ?? 0) + 1);
    }
  }

  /** 目前場景對某個功能的 ui 覆寫值（預設 normal）。 */
  uiMode(key: UiKey): string {
    return this.engine.scene?.ui?.[key] ?? 'normal';
  }

  /** 依場景的 ui 欄位更新功能列：disabled 變灰不可按、hidden 隱藏，其餘值記在 data-override。 */
  applyUi(): void {
    for (const [key, b] of this.buttons) {
      const mode = this.uiMode(key);
      b.disabled = mode === 'disabled';
      b.classList.toggle('hidden-by-script', mode === 'hidden');
      if (mode === 'normal') delete b.dataset.override;
      else b.dataset.override = mode;
    }
    if (this.buttons.get('skip')!.disabled) this.stopSkip();
    if (this.buttons.get('auto')!.disabled) this.stopAuto();
  }

  startSkip(): void {
    this.skip = true;
    this.audio?.stopVoice();
    this.buttons.get('skip')?.classList.add('active');
    this.stage.classList.add('skip-on');
    const tick = () => {
      if (!this.skip) return;
      if (this.engine.phase === 'choice' || this.engine.phase === 'ending' || this.engine.phase === 'title') {
        this.stopSkip();
        return;
      }
      if (this.engine.phase === 'text' && this.engine.blocked) {
        this.stopSkip();
        return;
      }
      if (this.engine.phase === 'text' && !this.overlayOpen()) {
        this.typer.complete();
        this.engine.next();
      }
      this.skipTimer = window.setTimeout(tick, T(90));
    };
    tick();
  }

  stopSkip(): void {
    this.skip = false;
    clearTimeout(this.skipTimer);
    this.buttons.get('skip')?.classList.remove('active');
    this.stage.classList.remove('skip-on');
  }

  openLog(): void {
    const entries = this.logEntries();
    const list = el(
      'ol',
      { class: 'log-list' },
      entries.map((e) => e.node),
    );
    const close = el('button', { class: 'overlay-close', type: 'button', 'aria-label': '關閉' });
    close.innerHTML = ICONS.close;
    close.onclick = (ev) => {
      ev.stopPropagation();
      this.closeOverlays();
    };
    this.logOverlay.replaceChildren(el('h2', {}, ['對話紀錄']), close, list);
    this.logOverlay.classList.add('open');
    this.logOverlay.onclick = (ev) => ev.stopPropagation();
    requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
  }

  /** 產生對話紀錄的每一列。ui.log = "corrupt" 時隨機刪掉幾句，並對人名套 name_fade。 */
  protected logEntries(): { node: HTMLElement }[] {
    const corrupt = this.uiMode('log') === 'corrupt';
    this.logOverlay.classList.toggle('corrupt', corrupt);
    let entries = this.engine.log;
    if (corrupt && entries.length > 1) {
      const drop = Math.max(1, Math.round(entries.length * 0.3));
      const dropped = new Set(shuffle(entries.map((_, i) => i)).slice(0, drop));
      entries = entries.filter((_, i) => !dropped.has(i));
    }
    return entries.map((e) => {
      const row = this.logRow(e.name, e.text, e.speaker, !!e.choice);
      if (e.voice) row.append(this.voiceButton(e.voice));
      if (corrupt && e.name) {
        const name = row.querySelector<HTMLElement>('.log-name')!;
        name.classList.add('fx-name-fade');
        name.textContent = Math.random() < 0.4 ? currentPack().texts.forgottenPerson : this.underscoreSome(e.name);
      }
      return { node: row };
    });
  }

  /** 小喇叭：點了重播那一句配音。音檔還沒有的句子不顯示喇叭。 */
  voiceButton(id: string): HTMLButtonElement {
    const b = el('button', { class: 'voice-replay', type: 'button', 'aria-label': '重播配音', title: '重播配音', 'data-voice': id });
    b.hidden = true;
    void this.audio?.hasVoice(id).then((has) => (b.hidden = !has));
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.audio?.unlock();
      void this.audio?.playVoice(id);
    });
    return b;
  }

  protected logRow(name: string, text: string, speaker: string, choice: boolean): HTMLElement {
    const cls = choice
      ? 'log-row choice'
      : speaker === 'object'
        ? 'log-row object'
        : speaker === 'player'
          ? 'log-row monologue'
          : 'log-row';
    return el('li', { class: cls }, [el('span', { class: 'log-name' }, [name]), el('span', { class: 'log-text' }, [text])]);
  }

  /** 把名字的部分字元換成底線（至少一個）。 */
  private underscoreSome(name: string): string {
    const chars = [...name];
    const keep = Math.floor(Math.random() * chars.length);
    return chars.map((c, i) => (i !== keep || chars.length === 1 ? '＿' : c)).join('');
  }

  openSettings(): void {
    const speed = el('input', { type: 'range', min: '5', max: '100', step: '5', value: String(settings.textSpeed), name: 'textSpeed' });
    const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(settings.volume), name: 'volume' });
    const speedOut = el('output', {}, [this.speedLabel(settings.textSpeed)]);
    speed.oninput = () => {
      setSetting('textSpeed', Number(speed.value));
      speedOut.textContent = this.speedLabel(settings.textSpeed);
    };
    vol.oninput = () => {
      setSetting('volume', Number(vol.value));
      this.onVolume(settings.volume);
    };
    const voice = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(settings.voiceVolume), name: 'voiceVolume' });
    voice.oninput = () => {
      setSetting('voiceVolume', Number(voice.value));
      this.audio?.setVoiceVolume(settings.voiceVolume);
    };
    const hints = el('input', { type: 'checkbox', name: 'hiddenHints', class: 'toggle' });
    hints.checked = settings.hiddenHints;
    hints.onchange = () => {
      setSetting('hiddenHints', hints.checked);
      this.choices.querySelectorAll<HTMLElement>('.locked').forEach((b) => this.updateLockedLabel(b));
    };
    const review = (value: MemoryReviewMode, text: string) => {
      const radio = el('input', { type: 'radio', name: 'memoryReview', value });
      radio.checked = settings.memoryReview === value;
      radio.onchange = () => radio.checked && setSetting('memoryReview', value);
      return el('label', { class: 'radio' }, [radio, text]);
    };
    const close = el('button', { class: 'overlay-close', type: 'button', 'aria-label': '關閉' });
    close.innerHTML = ICONS.close;
    close.onclick = (ev) => {
      ev.stopPropagation();
      this.closeOverlays();
    };
    this.settingsOverlay.replaceChildren(
      el('h2', {}, ['設定']),
      close,
      el('div', { class: 'settings-body' }, [
        el('label', { class: 'setting' }, [el('span', {}, ['文字速度']), speed, speedOut]),
        el('label', { class: 'setting' }, [el('span', {}, ['音樂與音效音量']), vol]),
        el('label', { class: 'setting' }, [el('span', {}, ['配音音量']), voice]),
        el('label', { class: 'setting setting-toggle' }, [el('span', {}, ['隱藏選項提示']), hints]),
        el('div', { class: 'setting setting-choice', role: 'radiogroup', 'aria-label': '記憶對照' }, [
          el('span', {}, ['記憶對照']),
          el('div', { class: 'radios' }, [review('inline', '融入結局'), review('page', '結局後獨立一頁')]),
        ]),
      ]),
    );
    this.settingsOverlay.onclick = (ev) => ev.stopPropagation();
    this.settingsOverlay.classList.add('open');
  }

  private speedLabel(v: number): string {
    return v >= 100 ? '瞬間' : `${v} 字／秒`;
  }

  protected onVolume(v: number): void {
    this.audio?.setVolume(v);
  }

  // ───────────────────────── 眨眼轉場 ─────────────────────────

  /** 上下眼皮合攏 → 執行 mid → 張開。 */
  /**
   * 轉場：關上 → 執行 mid → 打開。樣式由 meta.transition 決定：
   * blink 眨眼、blink_soft 柔和的眨眼、fade 淡入淡出、focus 模糊對焦。
   */
  async blink(mid?: () => void | Promise<void>, hold = 140): Promise<void> {
    const style = this.transitionStyle;
    const dur = { blink: 320, blink_soft: 700, fade: 600, focus: 700 }[style];
    this.applyTransitionStyle();
    this.stage.classList.add('transitioning');
    this.stage.dataset.blink = 'closed';
    this.setCurtain(style, true);
    await sleep(T(dur));
    await mid?.();
    await sleep(T(hold));
    this.setCurtain(style, false);
    this.stage.dataset.blink = 'open';
    await sleep(T(dur));
    this.stage.classList.remove('transitioning');
  }

  get transitionStyle(): TransitionStyle {
    return this.engine.script.meta.transition ?? 'blink';
  }

  /** 把轉場樣式寫到舞台上（CSS 依此決定眼皮或黑幕的樣子）。 */
  applyTransitionStyle(): void {
    this.stage.dataset.transition = this.transitionStyle;
  }

  private setCurtain(style: TransitionStyle, closed: boolean): void {
    this.blinkEl.classList.toggle('closed', closed && (style === 'blink' || style === 'blink_soft'));
    this.fadeEl.classList.toggle('on', closed && style === 'fade');
    this.stage.classList.toggle('focus-out', closed && style === 'focus');
  }

  /** 立繪構圖：角色自己的 sprite 覆寫 meta.sprite。 */
  framingFor(charId: string): Required<SpriteFraming> {
    const base = this.engine.script.meta.sprite ?? {};
    const own = this.engine.getChar(charId)?.sprite ?? {};
    return { scale: own.scale ?? base.scale ?? 1, y: own.y ?? base.y ?? 0 };
  }

  applyFraming(charId: string): void {
    const f = this.framingFor(charId);
    this.sprite.style.setProperty('--sprite-scale', String(f.scale));
    this.sprite.style.setProperty('--sprite-y', String(f.y));
  }

  /** 物件提示樣式：glow 物品本身發亮、ring 圓圈。 */
  applyHighlightStyle(): void {
    this.stage.dataset.highlight = this.engine.script.meta.objectHighlight ?? 'glow';
  }

  // ───────────────────────── View 介面 ─────────────────────────

  showTitle(): void {
    this.stopAuto();
    this.stopSkip();
    this.audio?.stopVoice();
    this.audio?.setSfxLoops([]);
    this.stage.classList.remove('exploring', 'required-pending');
    this.exploreBar.classList.remove('show');
    this.closeOverlays();
    this.typer.stop();
    clearTimeout(this.monologueTimer);
    this.monologue.classList.remove('show');
    this.endingScreen.classList.remove('open');
    this.inspectEl.classList.remove('open');
    this.objectsBg.replaceChildren();
    this.memoryCard.classList.remove('open');
    this.memoryPage.classList.remove('open');
    this.lastAct = null;
    this.skipChapter?.();
    clearTimeout(this.pendingTimer);
    this.pendingType = null;
    this.audio?.setMuffle(false);
    this.audio?.playMusic(null);
    const meta = this.engine.script.meta;
    const start = el('button', { class: 'start-button', type: 'button' }, ['開始']);
    start.onclick = (e) => {
      e.stopPropagation();
      this.onStart();
    };
    this.applyCover();
    this.applyUiStyle();
    const saveButtons = this.titleSaveButtons(start);
    this.titleScreen.replaceChildren(
      el('h1', {}, [meta.title]),
      el('p', { class: 'subtitle' }, [meta.durationMinutes ? `約 ${meta.durationMinutes} 分鐘 ・ 建議戴上耳機` : '建議戴上耳機']),
      ...saveButtons.top,
      start,
      ...saveButtons.bottom,
      ...(this.creditsButton() ?? []),
      ...(this.titleNote ? [el('p', { class: 'project-badge' }, [this.titleNote])] : []),
    );
    this.titleScreen.classList.add('open');
    this.stage.dataset.phase = 'title';
  }

  /**
   * 標題畫面的存檔按鈕：有自動存檔時，「繼續」放在最上面、「開始」改叫「從頭開始」；
   * 有手動存檔時，下方多一個「讀取存檔」。
   */
  private titleSaveButtons(start: HTMLButtonElement): { top: HTMLElement[]; bottom: HTMLElement[] } {
    const top: HTMLElement[] = [];
    const bottom: HTMLElement[] = [];
    if (!this.saves) return { top, bottom };
    const book = this.saves.load();
    if (book.auto) {
      const auto = book.auto;
      const b = el('button', { class: 'continue-button', type: 'button', 'data-ui': 'continue', title: auto.label }, ['繼續']);
      b.onclick = (e) => {
        e.stopPropagation();
        void this.loadGame(auto);
      };
      top.push(b, el('p', { class: 'continue-note' }, [`${auto.label}（${saveTimeLabel(auto.savedAt)}）`]));
      start.textContent = '從頭開始';
    }
    if (book.slots.some(Boolean)) {
      const b = el('button', { class: 'credits-button', type: 'button', 'data-ui': 'load' }, ['讀取存檔']);
      b.onclick = (e) => {
        e.stopPropagation();
        this.openPause('load');
      };
      bottom.push(b);
    }
    return { top, bottom };
  }

  /** 標題畫面的「製作名單」按鈕（meta.credits 有內容時才有）。 */
  private creditsButton(): HTMLElement[] | null {
    const credits = this.engine.script.meta.credits;
    if (!Array.isArray(credits) || !credits.length) return null;
    const b = el('button', { class: 'credits-button', type: 'button', 'data-ui': 'credits' }, ['製作名單']);
    b.onclick = (e) => {
      e.stopPropagation();
      this.openCredits();
    };
    return [b];
  }

  /** 製作名單：素材出處（meta.credits），連結在新分頁開啟。 */
  openCredits(): void {
    const credits = (this.engine.script.meta.credits ?? []).filter((c) => c && typeof c === 'object');
    const close = el('button', { class: 'credits-close', type: 'button' }, ['關閉']);
    const box = el('div', { class: 'credits-box', role: 'dialog', 'aria-label': '製作名單' }, [
      el('h2', {}, ['製作名單']),
      el('p', { class: 'credits-note' }, ['素材出處']),
      el(
        'ul',
        { class: 'credits-list' },
        credits.map((c) =>
          el('li', { 'data-file': c.file ?? '' }, [
            el('strong', {}, [c.title || c.file || '（未命名）']),
            ...(c.author ? [el('span', {}, [`　${c.author}`])] : []),
            ...(c.license ? [el('span', { class: 'credits-license' }, [`　${c.license}`])] : []),
            ...(c.url ? [el('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, ['出處'])] : []),
          ]),
        ),
      ),
      close,
    ]);
    const overlay = el('div', { class: 'credits-overlay open', 'data-ui': 'credits-overlay' }, [box]);
    const shut = () => overlay.remove();
    close.onclick = (e) => {
      e.stopPropagation();
      shut();
    };
    overlay.onclick = (e) => {
      e.stopPropagation();
      if (e.target === overlay) shut();
    };
    box.onclick = (e) => e.stopPropagation();
    this.stage.append(overlay);
    close.focus();
  }

  /** 介面樣式（meta.uiStyle）：classic、box、paper。 */
  applyUiStyle(): void {
    const s = this.engine.script.meta.uiStyle;
    this.stage.dataset.uiStyle = s === 'box' || s === 'paper' ? s : 'classic';
  }

  /** 封面圖：meta.cover（手機直式用 coverPortrait，沒有就用 cover，以中間為主裁切）。 */
  applyCover(): void {
    const meta = this.engine.script.meta;
    const name = (this.isPortrait() && meta.coverPortrait) || meta.cover || '';
    this.titleScreen.classList.toggle('has-cover', !!name);
    this.titleScreen.dataset.cover = name;
    if (!name) {
      this.titleScreen.style.removeProperty('background-image');
      return;
    }
    // 直接設 background-image（佔位圖的 data URL 很長，放在 CSS 變數裡瀏覽器不收）
    void resolveImage('bg', name).then((url) => {
      if (this.titleScreen.dataset.cover !== name) return;
      this.titleScreen.style.backgroundImage = `linear-gradient(to bottom, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.35) 45%, rgba(0, 0, 0, 0.78) 100%), url("${url}")`;
    });
  }

  /** 章節卡的樣式與大小（meta.chapterStyle）。 */
  applyChapterStyle(): void {
    const cs = this.engine.script.meta.chapterStyle ?? {};
    this.chapterCard.dataset.style = cs.style ?? 'stacked';
    this.chapterCard.style.setProperty('--chapter-scale', String(clampN(cs.scale ?? 1, 0.6, 1.6)));
  }

  /** 開發者面板「預覽章節卡」：在目前畫面上顯示一次。 */
  previewChapterCard(): Promise<void> {
    const act = this.engine.scene?.act ?? 1;
    return this.showChapterCard(act, this.chapterText(act) || '（這一幕沒有章節卡文字）');
  }

  protected onStart(): void {
    this.audio?.unlock();
    this.titleScreen.classList.remove('open');
    this.applyTransitionStyle();
    this.stage.classList.add('eyes-closed');
    void this.engine.start();
  }

  async enterScene(scene: Scene, opts: { restoring: boolean }): Promise<void> {
    this.typer.stop();
    this.audio?.stopVoice();
    this.audio?.setSfxLoops([]);
    // 物件圖先載入（第一次點開說明卡、疊圖不會慢半拍）
    for (const o of scene.objects ?? []) if (o.image) void resolveImage('fg', o.image);
    this.fx.clearScene();
    const bgUrl = scene.background ? await resolveImage('bg', scene.background) : '';
    const fgUrl = scene.foreground ? await resolveImage('fg', scene.foreground) : '';
    const act = scene.act ?? 1;
    const chapter = !opts.restoring && act !== this.lastAct ? this.chapterText(act) : '';
    this.lastAct = act;
    await this.blink(async () => {
      // 換幕：先在黑幕上顯示章節卡，音樂同時換成新場景的
      if (chapter) {
        this.audio?.playMusic(scene.music);
        await this.showChapterCard(act, chapter);
      }
      this.stage.classList.remove('eyes-closed');
      this.applyScene(scene, bgUrl, fgUrl);
      this.fx.applyGlobal();
      this.audio?.playMusic(scene.music);
    });
  }

  /** 這一幕章節卡的大字：該幕第一個場景的 chapter，沒有就取 title 裡「・」前面的部分。 */
  chapterText(act: number): string {
    const first = this.engine.script.scenes.find((s) => (s.act ?? 1) === act);
    if (!first) return '';
    if (first.chapter !== undefined) return first.chapter.trim();
    const title = first.title ?? '';
    const i = title.indexOf('・');
    return i > 0 ? title.slice(0, i).trim() : '';
  }

  /** 章節卡：全黑畫面上「第一章」＋大字的時間，約 3 秒；點一下或按空白鍵可以跳過。 */
  private async showChapterCard(act: number, text: string): Promise<void> {
    this.stage.classList.remove('menu-open');
    this.applyChapterStyle();
    this.chapterCard.replaceChildren(
      el('p', { class: 'chapter-no' }, [`第${chineseNumber(act)}章`]),
      el('h2', { class: 'chapter-time' }, [text]),
      el('div', { class: 'chapter-rule', 'aria-hidden': 'true' }),
    );
    this.chapterCard.dataset.act = String(act);
    this.chapterCard.classList.add('open');
    void this.chapterCard.offsetWidth;
    this.chapterCard.classList.add('show');
    let done!: () => void;
    const skipped = new Promise<void>((resolve) => (done = resolve));
    this.skipChapter = done;
    await Promise.race([sleep(T(3200)), skipped]);
    this.skipChapter = null;
    this.chapterCard.classList.remove('show');
    await sleep(T(700));
    this.chapterCard.classList.remove('open');
  }

  protected applyScene(scene: Scene, bgUrl: string, fgUrl: string): void {
    this.stage.dataset.scene = scene.id;
    this.applyHighlightStyle();
    this.stage.dataset.act = String(scene.act ?? 1);
    this.objectsBg.replaceChildren();
    this.memoryCard.classList.remove('open');
    this.applyUi();
    this.setBackground(scene.background ?? '', bgUrl);
    // 每個場景的視線起點略有不同，之後緩慢平移；有可以點的物件時不偏移，避免邊緣的物件被移出畫面
    this.panTo(scene.objects?.length ? 0 : Math.random() * 5 - 2.5);
    // 手機直式看不到整張背景：有物件的場景提示可以左右滑動
    this.swipeHint.classList.remove('show');
    if (scene.objects?.length && this.isPortrait()) {
      void this.swipeHint.offsetWidth;
      this.swipeHint.classList.add('show');
    }
    this.fg.hidden = !fgUrl;
    if (fgUrl) this.fg.src = fgUrl;
    this.fg.dataset.name = scene.foreground ?? '';
    this.stage.classList.toggle('has-fg', !!fgUrl);
    const char = this.engine.getChar(this.engine.lastChar);
    const pose = char ? this.engine.poses[char.id] : null;
    if (char && pose) void this.showSprite(char, pose);
    else this.hideSprite();
    this.nameEl.textContent = '';
    this.textEl.replaceChildren();
    this.dialog.classList.add('empty');
    this.monologue.classList.remove('show');
  }

  setBackground(name: string, url: string): void {
    this.bg.style.backgroundImage = url ? `url("${url}")` : '';
    this.bg.dataset.name = name;
    // 背景框（與熱點框）要維持背景圖的長寬比
    if (url) {
      void imageSize(url).then(({ width, height }) => {
        if (this.bg.dataset.name !== name) return;
        this.stage.style.setProperty('--bg-aspect', String(width / height));
        this.panTo(this.pan);
        this.updateEdgeHints();
      });
    }
  }

  /**
   * 視線水平平移，單位為舞台寬度的百分比。熱點跟著一起移動。
   * 可移動的範圍是背景圖超出畫面的部分（電腦橫式約 ±10%，手機直式可以看到整張圖）。
   */
  panTo(percent: number): void {
    const max = this.maxPan();
    this.pan = Math.max(-max, Math.min(max, percent));
    const pan = `${this.pan.toFixed(2)}%`;
    this.bgPan.style.setProperty('--pan', pan);
    this.objectsPan.style.setProperty('--pan', pan);
  }

  private maxPan(): number {
    const w = this.stage.clientWidth || 1;
    const h = this.stage.clientHeight;
    const aspect = Number(getComputedStyle(this.stage).getPropertyValue('--bg-aspect')) || 16 / 9;
    const imgW = Math.max(1.2 * w, h * aspect);
    return Math.max(0, ((imgW - w) / 2 / w) * 100);
  }

  private isPortrait(): boolean {
    return window.matchMedia('(orientation: portrait)').matches;
  }

  /** 手機直式：在畫面上左右拖曳來看背景的其他部分，找畫面外的物件。 */
  private bindDrag(): void {
    this.stage.addEventListener('pointerdown', (e) => {
      if (!this.isPortrait() || this.engine.phase !== 'text' || this.overlayOpen()) return;
      const target = e.target as HTMLElement;
      if (target.closest('button:not(.object-spot), .toolbar, .menu-toggle, .overlay, .screen')) return;
      this.drag = { id: e.pointerId, x0: e.clientX, pan0: this.pan, moved: false };
      this.justDragged = false;
    });
    this.stage.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x0;
      if (!d.moved && Math.abs(dx) > 10) {
        d.moved = true;
        this.stage.classList.add('dragging');
        this.stage.setPointerCapture(e.pointerId);
      }
      if (d.moved) {
        this.panTo(d.pan0 + (dx / this.stage.clientWidth) * 100);
        this.updateEdgeHints();
      }
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      if (!d.moved) return;
      this.justDragged = true;
      this.stage.classList.remove('dragging');
      this.swipeHint.classList.remove('show');
      this.updateEdgeHints();
    };
    this.stage.addEventListener('pointerup', end);
    this.stage.addEventListener('pointercancel', end);
    this.objectsPan.addEventListener('transitionend', () => this.updateEdgeHints());
    window.addEventListener('resize', () => {
      this.panTo(this.pan);
      this.updateEdgeHints();
    });
  }

  /** 有物件在畫面左右外側時，在那一側顯示提示箭頭。 */
  private updateEdgeHints(): void {
    const w = this.stage.getBoundingClientRect();
    let left = false;
    let right = false;
    for (const spot of this.objectsBg.querySelectorAll('.object-spot')) {
      const r = spot.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      if (cx < w.left) left = true;
      if (cx > w.right) right = true;
    }
    this.edgeLeft.classList.toggle('show', left);
    this.edgeRight.classList.toggle('show', right);
  }

  showText(line: TextLine, ctx: { repeated: boolean; character: Character | null; pose: CharPose | null }): void {
    clearTimeout(this.autoTimer);
    clearTimeout(this.monologueTimer);
    this.stage.dataset.phase = 'text';
    this.fx.clearLine();
    this.fx.applyGlobal();
    this.renderObjects();
    this.updateBlocked(true);
    if (line.music !== undefined) this.audio?.playMusic(line.music);
    if (line.sfx && !this.skip) this.audio?.playSfx(line.sfx);
    if (ctx.character && ctx.pose) void this.showSprite(ctx.character, ctx.pose);
    this.showMemoryCard(line);
    if (!line.memory) this.startVoice(line.voice);
    if (line.speaker === 'player' && !line.memory) {
      this.showMonologue(line, ctx.repeated);
      return;
    }
    this.monologue.classList.remove('show');
    this.stage.classList.remove('monologue-on');
    this.dialog.classList.remove('empty', 'done', 'prompt');
    this.nameEl.textContent = this.engine.speakerName(line.speaker);
    this.traitEl.textContent = '';
    this.nameBox.classList.toggle('hidden', !this.nameEl.textContent);
    this.dialog.dataset.speaker = line.speaker;
    const type = () => {
      this.pendingType = null;
      if (line.memory) this.startVoice(line.voice);
      const spans = this.typer.start(line.text, {
        cps: settings.textSpeed,
        degradation: this.engine.degradation,
        onDone: () => this.textFinished(),
      });
      this.fx.applyLine(line, spans, ctx.repeated);
    };
    clearTimeout(this.pendingTimer);
    if (line.memory) {
      // 記憶對照：先讓物件圖與當時的說明出現，再由角色說出真相
      this.textEl.replaceChildren();
      this.pendingType = type;
      this.pendingTimer = window.setTimeout(type, T(1100));
    } else {
      this.pendingType = null;
      type();
    }
  }

  /** 記憶對照的物件卡：物件圖＋劃掉的當時說明。非記憶對照的台詞會把它收起來。 */
  private showMemoryCard(line: TextLine): void {
    const m = line.memory;
    this.memoryCard.classList.toggle('open', !!m);
    if (!m) return;
    const card: HTMLElement[] = [];
    if (m.image) {
      const img = el('img', { class: 'memory-image', alt: '', 'data-name': m.image });
      void resolveImage('fg', m.image).then((url) => (img.src = url));
      card.push(img);
    }
    card.push(el('p', { class: 'memory-label' }, [m.label]), el('p', { class: 'memory-desc' }, [m.description]));
    this.memoryCard.replaceChildren(...card);
    this.memoryCard.dataset.object = m.objectId;
    this.memoryCard.classList.remove('open');
    void this.memoryCard.offsetWidth; // 重新觸發淡入
    this.memoryCard.classList.add('open');
  }

  /** 內心獨白：不顯示人名框，換字體在畫面中央偏上淡入，停留後淡出並自動前進。 */
  private showMonologue(line: TextLine, repeated: boolean): void {
    this.typer.stop();
    this.dialog.classList.add('empty');
    this.stage.classList.add('monologue-on');
    const spans = [...line.text].map((ch) => el('span', { class: 'ch on' }, [ch]));
    this.monologueText.replaceChildren(...spans);
    this.monologue.classList.remove('show', 'fading');
    void this.monologue.offsetWidth; // 重新觸發淡入動畫
    this.monologue.classList.add('show');
    this.monologue.classList.toggle('fx-repeat', repeated);
    this.fx.applyLine(line, spans, repeated);
    this.engine.textDone();
    this.monologueStay = settings.textSpeed >= 100 ? 1200 : 2200 + [...line.text].length * 110;
    this.startMonologueTimer();
  }

  /** 獨白停留 → 淡出 → 自動前進。看物件說明時會暫停，關閉後重新計時。 */
  private startMonologueTimer(): void {
    clearTimeout(this.monologueTimer);
    this.monologue.classList.remove('fading');
    // 找找看、還沒點的 required 物件：獨白留在畫面上，不自動往下
    if (this.engine.blocked) return;
    const token = this.engine.token;
    const stay = this.monologueStay;
    this.monologueTimer = window.setTimeout(async () => {
      if (token !== this.engine.token) return;
      await this.voiceDone;
      if (token !== this.engine.token) return;
      this.monologue.classList.add('fading');
      this.monologueTimer = window.setTimeout(() => {
        if (token !== this.engine.token || this.overlayOpen()) return;
        this.engine.next();
      }, T(900));
    }, T(stay));
  }

  protected textFinished(): void {
    this.engine.textDone();
    this.dialog.classList.add('done');
    if (this.auto) this.scheduleAuto();
  }

  /** 立繪：依 gaze 翻轉或偏移、依 distance 縮放與上下位置（實際數值見 style.css）。 */
  async showSprite(character: Character, pose: CharPose): Promise<void> {
    const url = await resolveSprite(character.id, pose.expression);
    this.sprite.src = url;
    this.sprite.hidden = false;
    this.sprite.dataset.char = character.id;
    this.sprite.dataset.expression = pose.expression;
    this.sprite.dataset.gaze = pose.gaze;
    this.sprite.dataset.distance = pose.distance;
    this.applyFraming(character.id);
    this.stage.classList.add('has-char');
  }

  /** 開發者面板上傳了新素材：畫面上正在用它的地方立刻換掉。 */
  async refreshAsset(kind: ImageKind, name: string): Promise<void> {
    if (kind === 'bg' && this.bg.dataset.name === name) this.setBackground(name, await resolveImage('bg', name));
    if (kind === 'fg') {
      const url = await resolveImage('fg', name);
      if (this.fg.dataset.name === name && !this.fg.hidden) this.fg.src = url;
      for (const img of this.stage.querySelectorAll<HTMLImageElement>('img[data-name]')) {
        if (img !== this.fg && img.dataset.name === name) img.src = url;
      }
    }
    if (kind === 'char' && this.sprite.dataset.char && name.startsWith(`${this.sprite.dataset.char}_`)) {
      const char = this.engine.getChar(this.sprite.dataset.char);
      const pose = char ? this.engine.poses[char.id] : null;
      if (char && pose) await this.showSprite(char, pose);
    }
  }

  hideSprite(): void {
    this.sprite.hidden = true;
    delete this.sprite.dataset.char;
    this.stage.classList.remove('has-char');
  }

  completeText(): boolean {
    if (this.pendingType) {
      clearTimeout(this.pendingTimer);
      this.pendingType();
      this.typer.complete();
      return true;
    }
    return this.typer.complete();
  }

  // ───────────────────────── 可以點的物件 ─────────────────────────

  /** 依目前句數畫出可以點的物件。熱點明顯程度隨退化係數降低。 */
  renderObjects(): void {
    const d = this.engine.degradation;
    this.objectsLayer.style.setProperty('--obj-alpha', (0.85 - 0.72 * d).toFixed(2));
    const editing = this.objectEdit;
    this.stage.classList.toggle('obj-edit', !!editing);
    const list = editing ? this.engine.scene?.objects ?? [] : this.engine.availableObjects;
    const spots = list.map((obj) => {
      const b = el('button', { class: 'object-spot', type: 'button', 'data-object': obj.id, 'aria-label': obj.label }, [
        el('span', { class: 'glow', 'aria-hidden': 'true' }),
        el('span', { class: 'label' }, [obj.label]),
      ]);
      const seen = this.engine.seen.includes(obj.id);
      b.classList.toggle('seen', seen);
      b.classList.toggle('required', !!obj.required && !seen);
      if (obj.attention && !seen) b.dataset.attention = obj.attention;
      // 座標是背景圖上的位置（0–1），半徑相對背景圖寬度
      placeSpot(b, obj.x, obj.y, obj.r);
      // 物件圖疊在背景上（像一張示意照片），寬度相對背景圖寬度
      const ow = overlayWidthOf(obj);
      if (ow && obj.image) {
        b.classList.add('has-overlay');
        b.style.setProperty('--ow', String(ow));
        const img = el('img', { class: 'object-overlay', alt: '', draggable: 'false', 'data-name': obj.image });
        void resolveImage('fg', obj.image).then((url) => (img.src = url));
        b.prepend(img);
      }
      if (editing) {
        b.classList.toggle('editing-selected', editing.selected === obj.id);
        b.dataset.appearAt = String(obj.appearAt ?? 0);
        this.bindObjectDrag(b, obj);
        return b;
      }
      bindPress(
        b,
        () => this.engine.inspect(obj.id),
        () => b.classList.add('show-label'),
        () => !!this.drag?.moved || this.justDragged,
      );
      return b;
    });
    this.objectsBg.replaceChildren(...spots);
    this.syncObjectSfx();
    requestAnimationFrame(() => this.updateEdgeHints());
  }

  /** 編輯物件位置：拖曳改 x、y（背景圖上的位置），點一下選取。 */
  private bindObjectDrag(b: HTMLElement, obj: SceneObject): void {
    b.addEventListener('click', (e) => e.stopPropagation());
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 選取：只換外框，不重畫（重畫會換掉正在拖曳的元素）
      if (this.objectEdit) this.objectEdit.selected = obj.id;
      for (const s of this.objectsBg.querySelectorAll('.object-spot')) s.classList.toggle('editing-selected', s === b);
      this.objectEdit?.onSelect(obj.id);
      b.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const r = this.objectsBg.getBoundingClientRect();
        obj.x = round3(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)));
        obj.y = round3(Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
        placeSpot(b, obj.x, obj.y, obj.r);
        this.objectEdit?.onMove(obj);
      };
      const up = () => {
        b.removeEventListener('pointermove', move);
        b.removeEventListener('pointerup', up);
        b.removeEventListener('pointercancel', up);
        this.renderObjects();
      };
      b.addEventListener('pointermove', move);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
  }

  /** 物件的循環音效：出現、還沒點過的物件有 sfx 就循環播放，點了就停。 */
  private syncObjectSfx(): void {
    const names = this.engine.phase === 'text' || this.engine.phase === 'inspect'
      ? (this.engine.scene?.objects ?? [])
          .filter((o) => o.sfx && !this.engine.seen.includes(o.id) && (o.appearAt ?? 0) <= this.engine.index && this.engine.test(o.if))
          .map((o) => o.sfx!)
      : [];
    this.audio?.setSfxLoops(this.skip ? [] : names);
  }

  /**
   * 依引擎「為什麼不能往下」更新畫面：找找看時刻顯示提示與「繼續」；
   * 一定要點的物件出現時，手機直式自動平移到它。entering＝剛換到這句。
   */
  updateBlocked(entering = false): void {
    const exploring = this.engine.exploring;
    const line = this.engine.currentLine;
    this.stage.classList.toggle('exploring', exploring);
    // 找找看的提示列自己有「左右滑動看看」，場景開頭的滑動提示收起來
    if (exploring) this.swipeHint.classList.remove('show');
    this.exploreBar.classList.toggle('show', exploring);
    if (exploring && line && 'explore' in line) {
      this.exploreText.textContent = line.explore ?? '';
      this.exploreSwipe.hidden = !this.isPortrait();
    }
    const req = this.engine.pendingRequired;
    this.stage.classList.toggle('required-pending', !!req);
    if (req && entering) this.panToObject(req);
  }

  /** 手機直式：把背景平移到讓這個物件在畫面中間（橫式整張背景都看得到，不用動）。 */
  private panToObject(obj: SceneObject): void {
    if (!this.isPortrait()) return;
    const w = this.stage.clientWidth || 1;
    const h = this.stage.clientHeight;
    const aspect = Number(getComputedStyle(this.stage).getPropertyValue('--bg-aspect')) || 16 / 9;
    const imgW = Math.max(1.2 * w, h * aspect);
    // 平常的視線平移很慢（9 秒）；這裡要讓玩家馬上看到，用較快的平移
    this.stage.classList.add('quick-pan');
    clearTimeout(this.quickPanTimer);
    this.quickPanTimer = window.setTimeout(() => this.stage.classList.remove('quick-pan'), 1500);
    this.panTo(((0.5 - obj.x) * imgW * 100) / w);
    this.swipeHint.classList.remove('show');
  }

  /** 玩家想往下但被擋住：一定要點的物件晃一下（並平移過去），或「繼續」按鈕亮一下。 */
  nudgeBlocked(reason: 'required' | 'explore'): void {
    clearTimeout(this.nudgeTimer);
    const target =
      reason === 'required'
        ? this.objectsBg.querySelector<HTMLElement>(`.object-spot[data-object="${CSS.escape(this.engine.pendingRequired?.id ?? '')}"]`)
        : this.exploreNext;
    if (reason === 'required' && this.engine.pendingRequired) this.panToObject(this.engine.pendingRequired);
    if (!target) return;
    target.classList.remove('nudge');
    void target.offsetWidth;
    target.classList.add('nudge');
    this.nudgeTimer = window.setTimeout(() => target.classList.remove('nudge'), 900);
  }

  /** 物件說明：暫停遊戲，點一下關閉。 */
  showInspect(obj: SceneObject): void {
    clearTimeout(this.monologueTimer);
    clearTimeout(this.autoTimer);
    clearInterval(this.inspectTimer);
    this.stopSkip();
    this.stage.dataset.phase = 'inspect';
    const label = el('h3', { class: 'inspect-label' }, [obj.label]);
    const spans = [...obj.description].map((ch) => el('span', { class: 'ch on' }, [ch]));
    const desc = el('p', { class: 'inspect-desc' }, spans);
    const card = el('div', { class: 'inspect-card' });
    const close = el('button', { class: 'inspect-close', type: 'button', 'aria-label': '關閉' }, ['×']);
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeInspect();
    });
    card.append(close);
    if (obj.image) {
      const img = el('img', { class: 'inspect-image', alt: obj.label, 'data-name': obj.image });
      void resolveImage('fg', obj.image).then((url) => (img.src = url));
      // 「放大」：照片佔滿畫面，再按一次縮回（不關閉說明卡）
      const zoom = el('button', { class: 'inspect-zoom', type: 'button', 'aria-label': '放大照片' }, ['放大']);
      zoom.addEventListener('click', (e) => {
        e.stopPropagation();
        const on = this.inspectEl.classList.toggle('zoomed');
        zoom.textContent = on ? '縮小' : '放大';
        zoom.setAttribute('aria-label', on ? '縮小照片' : '放大照片');
      });
      card.append(el('div', { class: 'inspect-photo' }, [img, zoom]));
    }
    card.append(label, desc, el('p', { class: 'inspect-hint' }, ['點一下關閉']));
    const fx = activeFx(obj.fx);
    card.classList.toggle('fx-text-blur', fx.includes('text_blur'));
    card.classList.toggle('fx-name-fade', fx.includes('name_fade'));
    if (fx.includes('text_blur')) glitchSpans(spans);
    if (fx.includes('name_fade')) this.inspectTimer = fadeText(label, currentPack().texts.forgottenThing);
    this.inspectEl.replaceChildren(card);
    this.inspectEl.dataset.object = obj.id;
    this.inspectEl.classList.add('open');
    this.syncObjectSfx();
  }

  closeInspect(): void {
    if (!this.inspectOpen()) return;
    clearInterval(this.inspectTimer);
    this.inspectEl.classList.remove('open', 'zoomed');
    this.stage.dataset.phase = 'text';
    this.engine.closeInspect();
    this.renderObjects();
    this.updateBlocked();
    if (this.stage.classList.contains('monologue-on')) this.startMonologueTimer();
    if (this.auto && this.engine.textFinished) this.scheduleAuto();
  }

  showChoice(line: ChoiceLine, options: ShownOption[], onPick: (opt: ChoiceOption, i: number) => void): void {
    this.objectsBg.replaceChildren();
    this.audio?.setSfxLoops([]);
    this.updateBlocked();
    this.stage.dataset.phase = 'choice';
    this.stopSkip();
    // prompt 有配音就播；沒有的話，前一句的聲音讓它播完
    if (line.voice) this.startVoice(line.voice);
    this.fx.clearLine();
    this.monologue.classList.remove('show');
    if (line.mode === 'hotspot') {
      this.showHotspots(line, options, onPick);
      return;
    }
    // 選項上方的提問放進對話框（沒有 prompt 時，對話框保留前一句台詞與人名）
    if (line.prompt) this.showPromptInDialog(line.prompt);
    const buttons = options.map((o) => {
      const { opt, index } = o;
      const b = el('button', { class: 'choice', type: 'button', 'data-index': String(index) }, [
        el('span', { class: 'label' }, [opt.text]),
      ]);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(opt, index);
      });
      this.markLocked(b, o);
      return b;
    });
    this.choices.replaceChildren(...buttons);
    this.choices.className = 'choices open';
    this.choices.dataset.mode = 'list';
    this.applyChoiceStyle();
    this.fx.applyChoice(line, this.choices, buttons);
  }

  /** 選項的提問顯示在對話框裡（像一句旁白，不打字）。 */
  private showPromptInDialog(prompt: string): void {
    this.typer.stop();
    this.monologue.classList.remove('show');
    this.stage.classList.remove('monologue-on');
    this.dialog.classList.remove('empty');
    this.dialog.classList.add('done', 'prompt');
    this.dialog.dataset.speaker = 'narrator';
    this.nameEl.textContent = '';
    this.nameBox.classList.add('hidden');
    this.textEl.replaceChildren(el('span', { class: 'choice-prompt' }, [prompt]));
  }

  /** 選項的位置與大小（meta.choiceStyle，開發者面板「呈現調整」可調）。手機直式一律置中。 */
  applyChoiceStyle(): void {
    const cs = this.engine.script.meta.choiceStyle ?? {};
    this.choices.dataset.layout = cs.position === 'center' ? 'center' : 'right';
    this.choices.style.setProperty('--choice-width', `${Math.round(clampN(cs.width ?? 0.36, 0.2, 0.8) * 100)}%`);
    this.choices.style.setProperty('--choice-scale', String(clampN(cs.scale ?? 0.88, 0.6, 1.3)));
  }

  /** 熱點選項：畫面上的發光圓點；滑鼠移上或長按顯示文字，點擊選擇。 */
  private showHotspots(line: ChoiceLine, options: ShownOption[], onPick: (opt: ChoiceOption, i: number) => void): void {
    const spots: HTMLButtonElement[] = options.map((o) => {
      const { opt, index } = o;
      const b = el('button', { class: 'hotspot', type: 'button', 'data-index': String(index), 'aria-label': opt.text }, [
        el('span', { class: 'glow', 'aria-hidden': 'true' }),
        el('span', { class: 'label' }, [opt.text]),
      ]);
      this.markLocked(b, o);
      placeSpot(b, opt.x, opt.y, opt.r);
      bindPress(
        b,
        () => onPick(opt, index),
        () => {
          spots.forEach((s) => s.classList.remove('show-label'));
          b.classList.add('show-label');
        },
      );
      return b;
    });
    const prompt = line.prompt ? [el('p', { class: 'hotspot-prompt' }, [line.prompt])] : [];
    this.choices.replaceChildren(...prompt, ...spots);
    this.choices.className = 'choices open hotspots';
    this.choices.dataset.mode = 'hotspot';
    this.fx.applyChoice(line, this.choices, spots);
  }

  /** requires 沒滿足的選項：灰掉、不能按，文字換成提示。 */
  private markLocked(b: HTMLButtonElement, o: ShownOption): void {
    if (!o.locked) return;
    b.disabled = true;
    b.classList.add('locked');
    b.dataset.missing = o.missing.join(' ');
    this.updateLockedLabel(b);
  }

  /** 依「隱藏選項提示」設定決定灰掉的選項顯示什麼。設定改變時也會呼叫。 */
  updateLockedLabel(b: HTMLElement): void {
    const missing = (b.dataset.missing ?? '').split(' ').filter(Boolean);
    const text = settings.hiddenHints
      ? missing.map((id) => `${this.engine.getObject(id)?.label ?? id}？`).join('、')
      : '你好像記得什麼，但想不起來。';
    b.querySelector('.label')!.textContent = text;
    b.setAttribute('aria-label', text);
  }

  clearChoice(): void {
    this.fx.stopChoiceFx();
    this.choices.replaceChildren();
    this.choices.className = 'choices';
  }

  showEnding(ending: Ending | null): void {
    this.stopAuto();
    this.stopSkip();
    this.stage.dataset.phase = 'ending';
    this.objectsBg.replaceChildren();
    this.audio?.setSfxLoops([]);
    this.updateBlocked();
    this.memoryCard.classList.remove('open');
    // page 模式：結局畫面之後多一頁記憶對照
    const withPage = settings.memoryReview === 'page' && this.engine.sceneHasMemoryReview;
    const again = el('button', { class: 'start-button', type: 'button' }, [withPage ? '繼續' : '回到標題']);
    again.onclick = (e) => {
      e.stopPropagation();
      if (withPage) this.showMemoryPage();
      else this.engine.toTitle();
    };
    this.endingScreen.dataset.endingId = ending?.id ?? '';
    this.endingScreen.replaceChildren(
      el('p', { class: 'ending-label' }, ['— 結局 —']),
      el('h2', { class: 'ending-title' }, [ending?.title ?? '']),
      ...(ending?.description ? [el('p', { class: 'ending-desc' }, [ending.description])] : []),
      again,
    );
    this.endingScreen.classList.add('open');
  }

  /** 記憶對照的獨立一頁：左欄當時的說明、右欄真相，可以捲動、可以略過。 */
  showMemoryPage(): void {
    const toTitle = (e: Event) => {
      e.stopPropagation();
      this.engine.toTitle();
    };
    const skip = el('button', { class: 'memory-skip', type: 'button' }, ['略過']);
    skip.onclick = toTitle;
    const done = el('button', { class: 'start-button', type: 'button' }, ['回到標題']);
    done.onclick = toTitle;
    const items = this.engine.memoryItems;
    const body = items.length
      ? el('table', { class: 'memory-table' }, [
          el('thead', {}, [el('tr', {}, [el('th', {}, ['當時記得的']), el('th', {}, ['真正的樣子'])])]),
          el(
            'tbody',
            {},
            items.map((o) =>
              el('tr', { 'data-object': o.id }, [
                el('td', { class: 'memory-before' }, [
                  el('span', { class: 'memory-label' }, [o.label]),
                  el('span', { class: 'memory-desc' }, [o.description]),
                ]),
                el('td', { class: 'memory-truth' }, [o.truth ?? '', ...(o.truthVoice ? [this.voiceButton(o.truthVoice)] : [])]),
              ]),
            ),
          ),
        ])
      : el('p', { class: 'memory-empty' }, ['你沒有留下任何記憶。']);
    this.memoryPage.replaceChildren(
      el('h2', { class: 'memory-title' }, ['記憶對照']),
      skip,
      el('div', { class: 'memory-scroll' }, [body]),
      done,
    );
    this.memoryPage.onclick = (e) => e.stopPropagation();
    this.endingScreen.classList.remove('open');
    this.memoryPage.classList.add('open');
  }

  /** 狀態變化時的回呼（開發者面板用）。 */
  onStateChange: (() => void) | null = null;

  stateChanged(): void {
    this.onStateChange?.();
  }
}

/** 1–99 的中文數字（章節卡用）。 */
function chineseNumber(n: number): string {
  const d = '〇一二三四五六七八九';
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n);
  if (n < 10) return d[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens > 1 ? d[tens] : ''}十${ones ? d[ones] : ''}`;
}
