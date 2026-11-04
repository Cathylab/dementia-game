import { activeFx, currentPack } from './pack';
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
    for (const fx of activeFx(line.fx)) this.trigger(fx, { line, spans });
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
    if (!this.v.nameEl.textContent) return;
    clearInterval(this.nameTimer);
    box.classList.add('fx-name-fade');
    this.nameTimer = fadeText(this.v.nameEl, currentPack().texts.forgottenPerson, () => {
      box.dataset.faded = '1';
      const trait = this.v.engine.getChar(this.v.engine.lastChar)?.trait;
      if (trait) box.querySelector('.trait')?.replaceChildren(trait);
    });
  }

  /** text_blur：部分字元缺失或被亂碼方塊取代。 */
  textBlur(spans: HTMLSpanElement[]): void {
    this.stage.classList.add('fx-text-blur');
    glitchSpans(spans);
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

  /**
   * time_skip：另一個時空的背景（舊照片色調）慢慢浮上來，停幾秒再慢慢淡回去。
   * 試玩回饋：原本用眨眼切換像瞬間移動，改成柔和的交叉淡入淡出。
   */
  async timeSkip(to?: string): Promise<void> {
    const seq = this.sceneSeq;
    const original = this.v.bg.dataset.name ?? '';
    const target = to ?? this.randomOtherBackground(original);
    if (!target) return;
    const url = await resolveImage('bg', target);
    if (seq !== this.sceneSeq) return;
    this.v.bgPan.querySelector('.bg-skip')?.remove();
    const layer = document.createElement('div');
    layer.className = 'bg-skip';
    layer.dataset.name = target;
    layer.style.backgroundImage = `url("${url}")`;
    this.v.bgPan.append(layer);
    this.stage.classList.add('fx-time-skip');
    void layer.offsetWidth;
    layer.classList.add('on');
    await sleep(T(1800 + 3200));
    if (seq === this.sceneSeq) layer.classList.remove('on');
    await sleep(T(1800));
    layer.remove();
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
    const fx = activeFx(line.fx);
    if (fx.includes('flat_options')) this.flatOptions(container, items);
    if (fx.includes('choice_vanish')) this.choiceVanish(container, items, line.mode === 'hotspot');
    // 選項上的 desaturate：畫面褪色，選項本身不變淡
    if (fx.includes('desaturate')) this.desaturate();
  }

  /** flat_options：所有選項同樣灰色、同樣語氣；點哪個都走第一個選項的 goto（引擎處理）。 */
  flatOptions(container: HTMLElement, items: HTMLElement[]): void {
    container.classList.add('fx-flat-options');
    for (const item of items) {
      if (item.classList.contains('locked')) continue;
      const label = item.querySelector<HTMLElement>('.label') ?? item;
      label.textContent = (label.textContent ?? '').replace(/[。！？!?…，、.~～]+$/u, '') + '。';
    }
  }

  /**
   * choice_vanish：約每三秒消失一個選項，從第一個開始依序消失，剩下的重新排列。
   * 灰掉的隱藏選項（requires 未滿足）不會消失，也至少留下一個可以按的選項。
   */
  choiceVanish(container: HTMLElement, items: HTMLElement[], hotspot: boolean): void {
    container.classList.add('fx-choice-vanish');
    // alive 保持腳本裡的原始順序；畫面上的排列另外打亂
    const alive = [...items];
    container.dataset.remaining = String(alive.length);
    clearInterval(this.vanishTimer);
    this.vanishTimer = window.setInterval(() => {
      const pickable = alive.filter((el) => !el.classList.contains('locked'));
      if (pickable.length <= 1 || !container.isConnected) {
        clearInterval(this.vanishTimer);
        return;
      }
      const gone = pickable[0];
      alive.splice(alive.indexOf(gone), 1);
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

/** 把元素文字逐字換成底線，最後換成 finalText。回傳 interval id。 */
export function fadeText(node: HTMLElement, finalText: string, onDone?: () => void): number {
  const chars = [...(node.textContent ?? '')];
  const order = shuffle(chars.map((_, i) => i));
  let k = 0;
  const timer = window.setInterval(() => {
    if (k < order.length) {
      chars[order[k++]] = '＿';
      node.textContent = chars.join('');
      return;
    }
    clearInterval(timer);
    node.textContent = finalText;
    onDone?.();
  }, T(480));
  return timer;
}

/** 讓逐字 span 裡約三到四成的字缺失或變成亂碼方塊。 */
export function glitchSpans(spans: HTMLSpanElement[]): void {
  const candidates = spans.filter((s) => !SKIP_CHARS.test(s.textContent ?? ''));
  // 柔和：少數幾個字變淡或換成方塊（以前 25～40%，讀起來太吃力）
  const count = Math.max(1, Math.round(candidates.length * rand(0.1, 0.18)));
  for (const s of shuffle([...candidates]).slice(0, count)) {
    if (Math.random() < 0.65) {
      s.classList.add('glitch-missing');
    } else {
      s.dataset.orig = s.textContent ?? '';
      s.textContent = pick(GLITCH_CHARS);
      s.classList.add('glitch-block');
    }
  }
}

