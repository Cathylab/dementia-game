import { resolveImage } from './assets';
import { Effects } from './fx';
import type { CharPose, Engine, ShownOption, View } from './engine';
import { ICONS } from './icons';
import { saveSettings, settings } from './settings';
import { Typewriter } from './typewriter';
import type { Character, ChoiceLine, ChoiceOption, Ending, Scene, TextLine, UiKey } from './types';
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
      el('div', { class: 'vignette' }),
      this.dialog,
      this.monologue,
      this.choices,
      this.toolbar,
      this.menuToggle,
      this.blinkEl,
      this.logOverlay,
      this.settingsOverlay,
      this.endingScreen,
      this.titleScreen,
    );
    this.root.replaceChildren(this.stage);

    this.stage.addEventListener('click', () => this.onStageClick());
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
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
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
    return this.logOverlay.classList.contains('open') || this.settingsOverlay.classList.contains('open');
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
    const cls = choice ? 'log-row choice' : speaker === 'player' ? 'log-row monologue' : 'log-row';
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
      settings.textSpeed = Number(speed.value);
      speedOut.textContent = this.speedLabel(settings.textSpeed);
      saveSettings();
    };
    vol.oninput = () => {
      settings.volume = Number(vol.value);
      saveSettings();
      this.onVolume(settings.volume);
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
      el('label', { class: 'setting' }, [el('span', {}, ['文字速度']), speed, speedOut]),
      el('label', { class: 'setting' }, [el('span', {}, ['音量']), vol]),
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
    if (ctx.character && ctx.pose) void this.showSprite(ctx.character, ctx.pose);
    if (line.speaker === 'player') {
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
    const spans = this.typer.start(line.text, {
      cps: settings.textSpeed,
      degradation: this.engine.degradation,
      onDone: () => this.textFinished(),
    });
    this.fx.applyLine(line, spans, ctx.repeated);
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
    const token = this.engine.token;
    const stay = settings.textSpeed >= 100 ? 1200 : 2200 + [...line.text].length * 110;
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
    return this.typer.complete();
  }

  showChoice(line: ChoiceLine, options: ShownOption[], onPick: (opt: ChoiceOption, i: number) => void): void {
    this.stage.dataset.phase = 'choice';
    this.stopSkip();
    this.fx.clearLine();
    this.monologue.classList.remove('show');
    if (line.mode === 'hotspot') {
      this.showHotspots(line, options, onPick);
      return;
    }
    const prompt = line.prompt ? [el('p', { class: 'choice-prompt' }, [line.prompt])] : [];
    const buttons = options.map(({ opt, index }) => {
      const b = el('button', { class: 'choice', type: 'button', 'data-index': String(index) }, [
        el('span', { class: 'label' }, [opt.text]),
      ]);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(opt, index);
      });
      return b;
    });
    this.choices.replaceChildren(...prompt, ...buttons);
    this.choices.className = 'choices open';
    this.choices.dataset.mode = 'list';
    this.fx.applyChoice(line, this.choices, buttons);
  }

  /** 熱點選項：畫面上的發光圓點；滑鼠移上或長按顯示文字，點擊選擇。 */
  private showHotspots(line: ChoiceLine, options: ShownOption[], onPick: (opt: ChoiceOption, i: number) => void): void {
    const spots: HTMLButtonElement[] = options.map(({ opt, index }) => {
      const b = el('button', { class: 'hotspot', type: 'button', 'data-index': String(index), 'aria-label': opt.text }, [
        el('span', { class: 'glow', 'aria-hidden': 'true' }),
        el('span', { class: 'label' }, [opt.text]),
      ]);
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

  clearChoice(): void {
    this.fx.stopChoiceFx();
    this.choices.replaceChildren();
    this.choices.className = 'choices';
  }

  showEnding(ending: Ending | null): void {
    this.stopAuto();
    this.stopSkip();
    this.stage.dataset.phase = 'ending';
    const again = el('button', { class: 'start-button', type: 'button' }, ['回到標題']);
    again.onclick = (e) => {
      e.stopPropagation();
      this.engine.toTitle();
    };
    this.endingScreen.dataset.endingId = ending?.id ?? '';
    this.endingScreen.replaceChildren(
      el('p', { class: 'ending-label' }, ['— 結局 —']),
      el('h2', { class: 'ending-title' }, [ending?.title ?? '']),
      again,
    );
    this.endingScreen.classList.add('open');
  }

  /** 狀態變化時的回呼（開發者面板用）。 */
  onStateChange: (() => void) | null = null;

  stateChanged(): void {
    this.onStateChange?.();
  }
}
