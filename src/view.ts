import { resolveImage } from './assets';
import type { CharPose, Engine, View } from './engine';
import { ICONS } from './icons';
import { saveSettings, settings } from './settings';
import { Typewriter } from './typewriter';
import type { Character, ChoiceLine, ChoiceOption, Ending, Scene, TextLine, UiKey } from './types';
import { el, sleep, T } from './util';

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
  readonly textEl = el('div', { class: 'text' });
  readonly choices = el('div', { class: 'choices' });
  readonly toolbar = el('nav', { class: 'toolbar', 'aria-label': '功能列' });
  readonly menuToggle = el('button', { class: 'menu-toggle', type: 'button', 'aria-label': '選單' });
  readonly blinkEl = el('div', { class: 'blink' }, [el('div', { class: 'lid top' }), el('div', { class: 'lid bottom' })]);
  readonly logOverlay = el('div', { class: 'overlay log-overlay', role: 'dialog' });
  readonly settingsOverlay = el('div', { class: 'overlay settings-overlay', role: 'dialog' });
  readonly titleScreen = el('div', { class: 'screen title-screen' });
  readonly endingScreen = el('div', { class: 'screen ending-screen' });
  readonly buttons = new Map<UiKey, HTMLButtonElement>();

  readonly typer = new Typewriter(this.textEl);
  auto = false;
  skip = false;
  private autoTimer = 0;
  private skipTimer = 0;

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
    this.nameBox.append(this.nameEl);
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
    if (b?.disabled) return;
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

  /** 自動播放時前進一句（ui.auto 覆寫在此生效）。 */
  protected autoAdvance(): void {
    this.engine.next();
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

  /** 產生對話紀錄的每一列；ui.log 覆寫會改寫這裡。 */
  protected logEntries(): { node: HTMLElement }[] {
    return this.engine.log.map((e) => ({ node: this.logRow(e.name, e.text, e.speaker, !!e.choice) }));
  }

  protected logRow(name: string, text: string, speaker: string, choice: boolean): HTMLElement {
    const cls = choice ? 'log-row choice' : speaker === 'player' ? 'log-row monologue' : 'log-row';
    return el('li', { class: cls }, [el('span', { class: 'log-name' }, [name]), el('span', { class: 'log-text' }, [text])]);
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

  protected onVolume(_v: number): void {}

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
    this.endingScreen.classList.remove('open');
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
    this.titleScreen.classList.remove('open');
    this.stage.classList.add('eyes-closed');
    void this.engine.start();
  }

  async enterScene(scene: Scene, _opts: { restoring: boolean }): Promise<void> {
    this.typer.stop();
    const bgUrl = scene.background ? await resolveImage('bg', scene.background) : '';
    const fgUrl = scene.foreground ? await resolveImage('fg', scene.foreground) : '';
    await this.blink(() => {
      this.stage.classList.remove('eyes-closed');
      this.applyScene(scene, bgUrl, fgUrl);
    });
  }

  protected applyScene(scene: Scene, bgUrl: string, fgUrl: string): void {
    this.stage.dataset.scene = scene.id;
    this.stage.dataset.act = String(scene.act ?? 1);
    this.bg.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : '';
    this.bg.dataset.name = scene.background ?? '';
    this.fg.hidden = !fgUrl;
    if (fgUrl) this.fg.src = fgUrl;
    this.fg.dataset.name = scene.foreground ?? '';
    this.sprite.hidden = !this.engine.lastChar;
    this.nameEl.textContent = '';
    this.textEl.replaceChildren();
    this.dialog.classList.add('empty');
  }

  showText(line: TextLine, ctx: { repeated: boolean; character: Character | null; pose: CharPose | null }): void {
    clearTimeout(this.autoTimer);
    this.stage.dataset.phase = 'text';
    this.dialog.classList.remove('empty');
    if (ctx.character && ctx.pose) void this.showSprite(ctx.character, ctx.pose);
    this.nameEl.textContent = this.engine.speakerName(line.speaker);
    this.nameBox.classList.toggle('hidden', !this.nameEl.textContent);
    this.dialog.dataset.speaker = line.speaker;
    this.typer.start(line.text, {
      cps: settings.textSpeed,
      degradation: 0,
      onDone: () => this.textFinished(),
    });
  }

  protected textFinished(): void {
    this.engine.textDone();
    this.dialog.classList.add('done');
    if (this.auto) this.scheduleAuto();
  }

  protected async showSprite(character: Character, pose: CharPose): Promise<void> {
    const url = await resolveImage('char', `${character.id}_${pose.expression}`);
    this.sprite.src = url;
    this.sprite.hidden = false;
    this.sprite.dataset.char = character.id;
    this.sprite.dataset.expression = pose.expression;
  }

  completeText(): boolean {
    return this.typer.complete();
  }

  showChoice(line: ChoiceLine, onPick: (opt: ChoiceOption, i: number) => void): void {
    this.stage.dataset.phase = 'choice';
    this.stopSkip();
    const prompt = line.prompt ? [el('p', { class: 'choice-prompt' }, [line.prompt])] : [];
    const buttons = line.choice.map((opt, i) => {
      const b = el('button', { class: 'choice', type: 'button', 'data-index': String(i) }, [opt.text]);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(opt, i);
      });
      return b;
    });
    this.choices.replaceChildren(...prompt, ...buttons);
    this.choices.className = 'choices open';
  }

  clearChoice(): void {
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

  stateChanged(): void {}
}
