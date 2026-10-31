import { T } from './util';

export interface TypeOptions {
  /** 每秒字數；>= 100 表示瞬間顯示。 */
  cps: number;
  /** 全域退化係數 0–1：讓打字速度不穩、字距抖動。 */
  degradation: number;
  onDone: () => void;
}

/** 把一句話拆成逐字 <span>，依速度逐字顯示。版面先排好，避免打字時換行跳動。 */
export class Typewriter {
  private timer = 0;
  private spans: HTMLSpanElement[] = [];
  private pos = 0;
  private onDone: (() => void) | null = null;
  typing = false;

  constructor(private readonly container: HTMLElement) {}

  start(text: string, opts: TypeOptions): HTMLSpanElement[] {
    this.stop();
    const d = opts.degradation;
    this.spans = [...text].map((ch) => {
      const s = document.createElement('span');
      s.className = 'ch';
      s.textContent = ch;
      if (d > 0 && ch.trim()) {
        // 字距隨機抖動
        s.style.marginRight = `${((Math.random() - 0.35) * 0.22 * d).toFixed(3)}em`;
        if (Math.random() < 0.25 * d) s.style.transform = `translateY(${((Math.random() - 0.5) * 0.12 * d).toFixed(3)}em)`;
      }
      return s;
    });
    this.container.replaceChildren(...this.spans);
    this.pos = 0;
    this.onDone = opts.onDone;
    this.typing = true;
    if (opts.cps >= 100) {
      this.complete();
      return this.spans;
    }
    const base = 1000 / opts.cps;
    const step = () => {
      if (this.pos >= this.spans.length) return this.finish();
      this.spans[this.pos++].classList.add('on');
      // 退化時速度不穩：忽快忽慢，偶爾整個停住
      let delay = base * (1 + (Math.random() * 2.2 - 0.7) * d);
      if (Math.random() < 0.06 * d) delay += 500 + Math.random() * 700;
      this.timer = window.setTimeout(step, T(Math.max(8, delay)));
    };
    step();
    return this.spans;
  }

  /** 立即顯示全部。回傳是否原本還在打字。 */
  complete(): boolean {
    if (!this.typing) return false;
    for (const s of this.spans) s.classList.add('on');
    this.finish();
    return true;
  }

  stop(): void {
    clearTimeout(this.timer);
    this.typing = false;
    this.onDone = null;
  }

  private finish(): void {
    clearTimeout(this.timer);
    this.typing = false;
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }
}
