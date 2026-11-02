// 開發者面板：按 ` 鍵（或 F8）開關，網址加 ?dev=1 則一開始就打開。
import type { Engine } from './engine';
import { pickEnding, validateScript } from './script';
import { ALL_FX, isChoice, type ChoiceLine, type Distance, type FxTag, type Gaze } from './types';
import { clamp, el, urlParam } from './util';
import type { AdvView } from './view';

const GAZES: Gaze[] = ['camera', 'away', 'other'];
const DISTANCES: Distance[] = ['near', 'normal', 'far'];

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

  constructor(
    private readonly engine: Engine,
    private readonly view: AdvView,
  ) {
    this.build();
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.key === '`' || e.key === 'F8') {
        e.preventDefault();
        this.toggle();
      }
    });
    if (urlParam('dev')) this.toggle(true);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  toggle(force?: boolean): void {
    this.root.classList.toggle('open', force ?? !this.isOpen);
    if (this.isOpen) this.refresh();
  }

  private section(title: string, ...children: (Node | string)[]): HTMLElement {
    return el('section', {}, [el('h3', {}, [title]), ...children]);
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
    const close = this.button('×', () => this.toggle(false), { class: 'dev-close', 'aria-label': '關閉' });

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

    const problems = validateScript(e.script);
    const problemList = problems.length
      ? el('ul', { class: 'dev-problems' }, problems.map((p) => el('li', {}, [p])))
      : el('p', { class: 'dev-ok' }, ['腳本檢查沒有問題']);

    this.root.append(
      el('header', {}, [el('h2', {}, ['開發者面板']), close]),
      this.section('目前狀態', this.status, this.stats),
      this.section('跳到場景', el('div', { class: 'dev-row' }, [this.sceneSelect, jump])),
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
      this.section('腳本檢查', problemList),
    );
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
    if (fx === 'repeat_line' && line && !isChoice(line)) {
      e.repeats.push({ line, remaining: 1 });
    }
    v.fx.trigger(fx, { line: line && !isChoice(line) ? line : undefined });
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
    }
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
