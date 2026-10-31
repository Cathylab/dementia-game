import { resolveImage } from './assets';
import type { ChoiceLine, FxTag, TextLine } from './types';
import { clamp, pick, rand, shuffle, sleep, T } from './util';
import type { AdvView } from './view';

/** 只在單句台詞期間生效、下一句就清除的效果 class。 */
const LINE_CLASSES = ['fx-text-blur', 'fx-focus-drift', 'fx-look-around', 'fx-muffle', 'fx-repeat-line'];
const GLITCH_CHARS = ['▯', '▒', '░', '□', '■', '▚', '▞'];
const SKIP_CHARS = /[\s，。、！？…「」『』（）,.!?~～—\-]/;

/** 十一個效果標籤的實作。每個效果都會在 #stage（或對應元素）留下 fx-* class，方便測試與除錯。 */
export class Effects {
  private nameTimer = 0;
  private vanishTimer = 0;
  /** 每次換場景加一，讓 time_skip 等延遲動作知道場景已換。 */
  private sceneSeq = 0;

  constructor(private readonly v: AdvView) {}

  private get stage(): HTMLElement {
    return this.v.stage;
  }

  // ───────── 生命週期 ─────────

  clearLine(): void {
    clearInterval(this.nameTimer);
    this.stage.classList.remove(...LINE_CLASSES);
    this.v.nameBox.classList.remove('fx-name-fade');
    delete this.v.nameBox.dataset.faded;
    this.v.dialog.classList.remove('fx-repeat');
    this.v.audio?.setMuffle(false);
  }

  clearScene(): void {
    this.sceneSeq++;
    this.clearLine();
    this.stopChoiceFx();
    this.stage.classList.remove('fx-wrong-object', 'fx-time-skip');
    this.v.bgPan.querySelectorAll('.wrong-object').forEach((n) => n.remove());
    delete this.v.fg.dataset.wrong;
  }

  stopChoiceFx(): void {
    clearInterval(this.vanishTimer);
  }

  // ───────── 台詞層級 ─────────

  applyLine(line: TextLine, spans: HTMLSpanElement[], repeated: boolean): void {
    if (repeated) this.markRepeat();
    for (const fx of line.fx ?? []) this.trigger(fx, { line, spans });
  }

  /** 觸發單一效果。開發者面板也會呼叫這裡。 */
  trigger(fx: FxTag, ctx: { line?: TextLine; spans?: HTMLSpanElement[] } = {}): void {
    switch (fx) {
      case 'name_fade':
        return this.nameFade();
      case 'text_blur':
        return this.textBlur(ctx.spans ?? [...this.v.textEl.querySelectorAll<HTMLSpanElement>('.ch')]);
      case 'repeat_line':
        // 重播排程由引擎處理；這裡只做視覺標記
        this.stage.classList.add('fx-repeat-line');
        return;
      case 'wrong_object':
        void this.wrongObject(ctx.line?.wrongObject);
        return;
      case 'time_skip':
        void this.timeSkip(ctx.line?.timeSkipTo);
        return;
      case 'desaturate':
        return this.desaturate();
      case 'focus_drift':
        this.stage.classList.add('fx-focus-drift');
        return;
      case 'look_around':
        this.stage.classList.add('fx-look-around');
        return;
      case 'muffle':
        this.stage.classList.add('fx-muffle');
        this.v.audio?.setMuffle(true);
        return;
      case 'choice_vanish':
      case 'flat_options':
        // 選項效果在 applyChoice 處理
        return;
    }
  }

  private markRepeat(): void {
    this.v.dialog.classList.add('fx-repeat');
  }

  /** name_fade：人名逐字變成底線，最後變成「那個人」，並露出角色特徵。 */
  nameFade(): void {
    const box = this.v.nameBox;
    const nameEl = this.v.nameEl;
    const full = nameEl.textContent ?? '';
    if (!full) return;
    clearInterval(this.nameTimer);
    box.classList.add('fx-name-fade');
    const chars = [...full];
    const order = shuffle(chars.map((_, i) => i));
    let k = 0;
    this.nameTimer = window.setInterval(() => {
      if (k < order.length) {
        chars[order[k++]] = '＿';
        nameEl.textContent = chars.join('');
        return;
      }
      clearInterval(this.nameTimer);
      nameEl.textContent = '那個人';
      box.dataset.faded = '1';
      const trait = this.v.engine.getChar(this.v.engine.lastChar)?.trait;
      if (trait) box.querySelector('.trait')?.replaceChildren(trait);
    }, T(480));
  }

  /** text_blur：部分字元缺失或被亂碼方塊取代。 */
  textBlur(spans: HTMLSpanElement[]): void {
    this.stage.classList.add('fx-text-blur');
    const candidates = spans.filter((s) => !SKIP_CHARS.test(s.textContent ?? ''));
    const count = Math.max(1, Math.round(candidates.length * rand(0.25, 0.4)));
    for (const s of shuffle([...candidates]).slice(0, count)) {
      if (Math.random() < 0.5) {
        s.classList.add('glitch-missing');
      } else {
        s.dataset.orig = s.textContent ?? '';
        s.textContent = pick(GLITCH_CHARS);
        s.classList.add('glitch-block');
      }
    }
  }

  /** wrong_object：背景上多一個不該出現的東西；有前景時改為把手持物件換掉。 */
  async wrongObject(name?: string): Promise<void> {
    const seq = this.sceneSeq;
    this.stage.classList.add('fx-wrong-object');
    const fgName = this.v.fg.dataset.name;
    if (fgName && !this.v.fg.hidden) {
      const target = name ?? `${fgName}_wrong`;
      const url = await resolveImage('fg', target);
      if (seq !== this.sceneSeq) return;
      this.v.fg.src = url;
      this.v.fg.dataset.wrong = target;
      return;
    }
    const target = name ?? 'wrong_object';
    const url = await resolveImage('fg', target);
    if (seq !== this.sceneSeq) return;
    const img = document.createElement('img');
    img.className = 'wrong-object';
    img.alt = '';
    img.src = url;
    img.dataset.name = target;
    img.style.left = `${rand(18, 62)}%`;
    img.style.top = `${rand(30, 52)}%`;
    this.v.bgPan.append(img);
  }

  /** time_skip：眨眼後背景換成另一個場景，數秒後再眨眼切回。 */
  async timeSkip(to?: string): Promise<void> {
    const seq = this.sceneSeq;
    const original = this.v.bg.dataset.name ?? '';
    const target = to ?? this.randomOtherBackground(original);
    if (!target) return;
    const url = await resolveImage('bg', target);
    const back = original ? await resolveImage('bg', original) : '';
    this.stage.classList.add('fx-time-skip');
    await this.v.blink(() => this.v.setBackground(target, url), 200);
    await sleep(T(3600));
    if (seq !== this.sceneSeq) return;
    await this.v.blink(() => {
      if (seq === this.sceneSeq) this.v.setBackground(original, back);
    }, 200);
    if (seq === this.sceneSeq) this.stage.classList.remove('fx-time-skip');
  }

  private randomOtherBackground(current: string): string {
    const all = new Set(this.v.engine.script.scenes.map((s) => s.background).filter((b): b is string => !!b && b !== current));
    return all.size ? pick([...all]) : '';
  }

  /** desaturate：飽和度降低並累積，不會自己恢復。 */
  desaturate(): void {
    const e = this.v.engine;
    e.desat = clamp(e.desat + 0.3, 0, 1);
    this.applyGlobal();
  }

  /** 依退化係數與 desaturate 累積量更新畫面（飽和度、暗角、景深）。 */
  applyGlobal(): void {
    const e = this.v.engine;
    const d = e.degradation;
    const sat = clamp((1 - 0.45 * d) * (1 - 0.85 * e.desat), 0.03, 1);
    this.stage.style.setProperty('--sat', sat.toFixed(3));
    this.stage.style.setProperty('--vignette', (0.2 + 0.7 * d).toFixed(3));
    this.stage.style.setProperty('--degradation', d.toFixed(2));
    this.stage.dataset.degradation = d.toFixed(2);
    this.stage.classList.toggle('fx-desaturate', e.desat > 0);
    this.stage.dataset.desat = e.desat.toFixed(2);
    this.v.audio?.setDegradation(d);
  }

  // ───────── 選項層級 ─────────

  /** 套用選項效果。items 為選項元素（list 為按鈕、hotspot 為熱點）。 */
  applyChoice(line: ChoiceLine, container: HTMLElement, items: HTMLElement[]): void {
    const fx = line.fx ?? [];
    if (fx.includes('flat_options')) this.flatOptions(container, items);
    if (fx.includes('choice_vanish')) this.choiceVanish(container, items, line.mode === 'hotspot');
  }

  /** flat_options：所有選項同樣灰色、同樣語氣；點哪個都走第一個選項的 goto（引擎處理）。 */
  flatOptions(container: HTMLElement, items: HTMLElement[]): void {
    container.classList.add('fx-flat-options');
    for (const item of items) {
      const label = item.querySelector<HTMLElement>('.label') ?? item;
      label.textContent = (label.textContent ?? '').replace(/[。！？!?…，、.~～]+$/u, '') + '。';
    }
  }

  /** choice_vanish：約每三秒消失一個選項，剩下的重新排列。 */
  choiceVanish(container: HTMLElement, items: HTMLElement[], hotspot: boolean): void {
    container.classList.add('fx-choice-vanish');
    const alive = [...items];
    container.dataset.remaining = String(alive.length);
    clearInterval(this.vanishTimer);
    this.vanishTimer = window.setInterval(() => {
      if (alive.length <= 1 || !container.isConnected) {
        clearInterval(this.vanishTimer);
        return;
      }
      const [gone] = alive.splice(Math.floor(Math.random() * alive.length), 1);
      gone.classList.add('vanishing');
      gone.setAttribute('aria-hidden', 'true');
      (gone as HTMLButtonElement).disabled = true;
      container.dataset.remaining = String(alive.length);
      window.setTimeout(() => {
        gone.remove();
        if (hotspot) {
          // 熱點：剩下的互換位置
          const spots = alive.map((h) => [h.style.left, h.style.top]);
          spots.push(spots.shift()!);
          alive.forEach((h, i) => {
            h.style.left = spots[i][0];
            h.style.top = spots[i][1];
          });
        } else {
          for (const b of shuffle([...alive])) container.append(b);
        }
      }, T(600));
    }, T(3000));
  }
}
