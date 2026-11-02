import { resolveImage } from './assets';
import { Effects, fadeText, glitchSpans } from './fx';
import type { CharPose, Engine, ShownOption, View } from './engine';
import { ICONS } from './icons';
import { setSetting, settings, type MemoryReviewMode } from './settings';
import { Typewriter } from './typewriter';
import type { Character, ChoiceLine, ChoiceOption, Ending, Scene, SceneObject, TextLine, UiKey } from './types';
import { el, shuffle, sleep, T } from './util';

/** 聲音模組需提供的介面（見 audio.ts）。 */
export interface AudioLike {
  setMuffle(on: boolean): void;
  setDegradation(d: number): void;
  setVolume(v: number): void;
  playMusic(name: string | null | undefined): void;
  unlock(): void;
}

/** 依 0–1 比例座標放置熱點（hotspot 選項與可點的物件共用）。 */
function placeSpot(b: HTMLElement, x = 0.5, y = 0.5, r = 0.04): void {
  b.style.left = `${x * 100}%`;
  b.style.top = `${y * 100}%`;
  b.style.setProperty('--r', String(r));
}

/** 點一下執行 onTap；長按（手機）執行 onLongPress，且不觸發 onTap。 */
function bindPress(b: HTMLElement, onTap: () => void, onLongPress: () => void): void {
  let pressTimer = 0;
  let longPressed = false;
  b.addEventListener('pointerdown', () => {
    longPressed = false;
    pressTimer = window.setTimeout(() => {
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
    if (longPressed) {
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
  { key: 'title', label: '標題' },
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
  readonly objectsLayer = el('div', { class: 'objects' });
  readonly inspectEl = el('div', { class: 'inspect', role: 'dialog', 'aria-modal': 'true' });
  readonly memoryCard = el('div', { class: 'memory-card', 'aria-live': 'polite' });
  readonly memoryPage = el('div', { class: 'screen memory-page', role: 'dialog' });
  readonly monologueText = el('p', { class: 'monologue-text' });
  readonly monologue = el('div', { class: 'monologue', 'aria-live': 'polite' }, [this.monologueText]);
  readonly toolbar = el('nav', { class: 'toolbar', 'aria-label': '功能列' });
  readonly menuToggle = el('button', { class: 'menu-toggle', type: 'button', 'aria-label': '選單' });
  readonly blinkEl = el('div', { class: 'blink' }, [el('div', { class: 'lid top' }), el('div', { class: 'lid bottom' })]);
  readonly logOverlay = el('div', { class: 'overlay log-overlay', role: 'dialog' });
  readonly settingsOverlay = el('div', { class: 'overlay settings-overlay', role: 'dialog' });
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
  private pendingType: (() => void) | null = null;
  private pendingTimer = 0;
  private monologueStay = 0;
  private inspectTimer = 0;

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

    this.stage.append(
      this.layers,
      this.objectsLayer,
      el('div', { class: 'vignette' }),
      this.memoryCard,
      this.dialog,
      this.monologue,
      this.choices,
      this.toolbar,
      this.menuToggle,
      this.inspectEl,
      this.blinkEl,
      this.logOverlay,
      this.settingsOverlay,
      this.endingScreen,
      this.memoryPage,
      this.titleScreen,
    );
    this.root.replaceChildren(this.stage);

    this.stage.addEventListener('click', () => this.onStageClick());
    this.inspectEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeInspect();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private onStageClick(): void {
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
    if (this.inspectOpen()) {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.closeInspect();
      }
      return;
    }
    if (e.key === 'Escape') {
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
    return this.logOverlay.classList.contains('open') || this.settingsOverlay.classList.contains('open') || this.inspectOpen();
  }

  inspectOpen(): boolean {
    return this.inspectEl.classList.contains('open');
  }

  closeOverlays(): void {
    this.logOverlay.classList.remove('open');
    this.settingsOverlay.classList.remove('open');
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
    this.autoTimer = window.setTimeout(() => {
      if (!this.auto || token !== this.engine.token || this.overlayOpen()) return;
      this.autoAdvance();
    }, T(1200 + len * 70));
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
    this.buttons.get('skip')?.classList.add('active');
    this.stage.classList.add('skip-on');
    const tick = () => {
      if (!this.skip) return;
      if (this.engine.phase === 'choice' || this.engine.phase === 'ending' || this.engine.phase === 'title') {
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
      if (corrupt && e.name) {
        const name = row.querySelector<HTMLElement>('.log-name')!;
        name.classList.add('fx-name-fade');
        name.textContent = Math.random() < 0.4 ? '那個人' : this.underscoreSome(e.name);
      }
      return { node: row };
    });
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
        el('label', { class: 'setting' }, [el('span', {}, ['音量']), vol]),
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
  async blink(mid?: () => void | Promise<void>, hold = 140): Promise<void> {
    this.blinkEl.classList.add('closed');
    this.stage.dataset.blink = 'closed';
    await sleep(T(320));
    await mid?.();
    await sleep(T(hold));
    this.blinkEl.classList.remove('closed');
    this.stage.dataset.blink = 'open';
    await sleep(T(320));
  }

  // ───────────────────────── View 介面 ─────────────────────────

  showTitle(): void {
    this.stopAuto();
    this.stopSkip();
    this.closeOverlays();
    this.typer.stop();
    clearTimeout(this.monologueTimer);
    this.monologue.classList.remove('show');
    this.endingScreen.classList.remove('open');
    this.inspectEl.classList.remove('open');
    this.objectsLayer.replaceChildren();
    this.memoryCard.classList.remove('open');
    this.memoryPage.classList.remove('open');
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
    this.titleScreen.replaceChildren(
      el('h1', {}, [meta.title]),
      el('p', { class: 'subtitle' }, [meta.durationMinutes ? `約 ${meta.durationMinutes} 分鐘 ・ 建議戴上耳機` : '建議戴上耳機']),
      start,
    );
    this.titleScreen.classList.add('open');
    this.stage.dataset.phase = 'title';
  }

  protected onStart(): void {
    this.audio?.unlock();
    this.titleScreen.classList.remove('open');
    this.stage.classList.add('eyes-closed');
    void this.engine.start();
  }

  async enterScene(scene: Scene, _opts: { restoring: boolean }): Promise<void> {
    this.typer.stop();
    this.fx.clearScene();
    const bgUrl = scene.background ? await resolveImage('bg', scene.background) : '';
    const fgUrl = scene.foreground ? await resolveImage('fg', scene.foreground) : '';
    await this.blink(() => {
      this.stage.classList.remove('eyes-closed');
      this.applyScene(scene, bgUrl, fgUrl);
      this.fx.applyGlobal();
      this.audio?.playMusic(scene.music);
    });
  }

  protected applyScene(scene: Scene, bgUrl: string, fgUrl: string): void {
    this.stage.dataset.scene = scene.id;
    this.stage.dataset.act = String(scene.act ?? 1);
    this.objectsLayer.replaceChildren();
    this.memoryCard.classList.remove('open');
    this.applyUi();
    this.setBackground(scene.background ?? '', bgUrl);
    // 每個場景的視線起點略有不同，之後緩慢平移
    this.panTo(Math.random() * 5 - 2.5);
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
  }

  /** 視線水平平移，單位為舞台寬度的百分比（背景有 1.2 倍寬，約可移動 ±8%）。 */
  panTo(percent: number): void {
    this.bgPan.style.setProperty('--pan', `${Math.max(-8, Math.min(8, percent)).toFixed(2)}%`);
  }

  showText(line: TextLine, ctx: { repeated: boolean; character: Character | null; pose: CharPose | null }): void {
    clearTimeout(this.autoTimer);
    clearTimeout(this.monologueTimer);
    this.stage.dataset.phase = 'text';
    this.fx.clearLine();
    this.fx.applyGlobal();
    this.renderObjects();
    if (ctx.character && ctx.pose) void this.showSprite(ctx.character, ctx.pose);
    this.showMemoryCard(line);
    if (line.speaker === 'player' && !line.memory) {
      this.showMonologue(line, ctx.repeated);
      return;
    }
    this.monologue.classList.remove('show');
    this.stage.classList.remove('monologue-on');
    this.dialog.classList.remove('empty', 'done');
    this.nameEl.textContent = this.engine.speakerName(line.speaker);
    this.traitEl.textContent = '';
    this.nameBox.classList.toggle('hidden', !this.nameEl.textContent);
    this.dialog.dataset.speaker = line.speaker;
    const type = () => {
      this.pendingType = null;
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
    const token = this.engine.token;
    const stay = this.monologueStay;
    this.monologueTimer = window.setTimeout(() => {
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
    const url = await resolveImage('char', `${character.id}_${pose.expression}`);
    this.sprite.src = url;
    this.sprite.hidden = false;
    this.sprite.dataset.char = character.id;
    this.sprite.dataset.expression = pose.expression;
    this.sprite.dataset.gaze = pose.gaze;
    this.sprite.dataset.distance = pose.distance;
    this.stage.classList.add('has-char');
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
    const spots = this.engine.availableObjects.map((obj) => {
      const b = el('button', { class: 'object-spot', type: 'button', 'data-object': obj.id, 'aria-label': obj.label }, [
        el('span', { class: 'glow', 'aria-hidden': 'true' }),
        el('span', { class: 'label' }, [obj.label]),
      ]);
      b.classList.toggle('seen', this.engine.seen.includes(obj.id));
      placeSpot(b, obj.x, obj.y, obj.r);
      bindPress(
        b,
        () => this.engine.inspect(obj.id),
        () => b.classList.add('show-label'),
      );
      return b;
    });
    this.objectsLayer.replaceChildren(...spots);
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
    if (obj.image) {
      const img = el('img', { class: 'inspect-image', alt: '', 'data-name': obj.image });
      void resolveImage('fg', obj.image).then((url) => (img.src = url));
      card.append(img);
    }
    card.append(label, desc, el('p', { class: 'inspect-hint' }, ['點一下關閉']));
    const fx = obj.fx ?? [];
    card.classList.toggle('fx-text-blur', fx.includes('text_blur'));
    card.classList.toggle('fx-name-fade', fx.includes('name_fade'));
    if (fx.includes('text_blur')) glitchSpans(spans);
    if (fx.includes('name_fade')) this.inspectTimer = fadeText(label, '那個東西');
    this.inspectEl.replaceChildren(card);
    this.inspectEl.dataset.object = obj.id;
    this.inspectEl.classList.add('open');
  }

  closeInspect(): void {
    if (!this.inspectOpen()) return;
    clearInterval(this.inspectTimer);
    this.inspectEl.classList.remove('open');
    this.stage.dataset.phase = 'text';
    this.engine.closeInspect();
    this.renderObjects();
    if (this.stage.classList.contains('monologue-on')) this.startMonologueTimer();
    if (this.auto && this.engine.textFinished) this.scheduleAuto();
  }

  showChoice(line: ChoiceLine, options: ShownOption[], onPick: (opt: ChoiceOption, i: number) => void): void {
    this.objectsLayer.replaceChildren();
    this.stage.dataset.phase = 'choice';
    this.stopSkip();
    this.fx.clearLine();
    this.monologue.classList.remove('show');
    if (line.mode === 'hotspot') {
      this.showHotspots(line, options, onPick);
      return;
    }
    const prompt = line.prompt ? [el('p', { class: 'choice-prompt' }, [line.prompt])] : [];
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
    this.choices.replaceChildren(...prompt, ...buttons);
    this.choices.className = 'choices open';
    this.choices.dataset.mode = 'list';
    this.fx.applyChoice(line, this.choices, buttons);
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
    this.objectsLayer.replaceChildren();
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
                el('td', { class: 'memory-truth' }, [o.truth ?? '']),
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
