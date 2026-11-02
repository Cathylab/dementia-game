// 開發者面板：按 ` 鍵（或 F8）開關，網址加 ?dev=1 則一開始就打開。
import type { Engine } from './engine';
import { neededSprites, pickEnding, spriteWarnings, validateScript } from './script';
import {
  ALL_FX,
  isText,
  TRANSITION_STYLES,
  type ChoiceLine,
  type Distance,
  type FxTag,
  type Gaze,
  type TransitionStyle,
} from './types';
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

  constructor(
    private readonly engine: Engine,
    private readonly view: AdvView,
    /** 打開文字編輯器。 */
    private readonly openEditor?: () => void,
    /** 儲存腳本（本機寫回 script.json，線上版下載），回傳結果訊息。 */
    private readonly saveScript?: () => Promise<string>,
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
      this.buildPresentation(),
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
        '文字編輯',
        el('div', { class: 'dev-row' }, [
          this.button('打開文字編輯', () => {
            this.toggle(false);
            this.openEditor?.();
          }, { 'data-dev': 'editor' }),
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
        img.src = `${import.meta.env.BASE_URL}${path}`;
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
        ? `正在用「${f.name}」試聽「${name}」（只在這次開啟的頁面有效）。確定要用的話，把檔案改名為 ${name}.mp3 或 ${name}.ogg 放進 public/assets/music/。`
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

    return this.section(
      '呈現調整',
      el('label', { class: 'dev-row' }, ['轉場', transition, preview]),
      el('label', { class: 'dev-row' }, ['物件提示', highlight]),
      el('div', { class: 'dev-row' }, ['角色', charSelect]),
      el('label', { class: 'dev-row' }, ['大小', scale, scaleOut]),
      el('label', { class: 'dev-row' }, ['上下', y, yOut]),
      el('div', { class: 'dev-row' }, [applyAll]),
      el('div', { class: 'dev-row' }, ['音樂', music, list, applyMusic]),
      el('label', { class: 'dev-row' }, ['試聽檔案', file]),
      musicStatus,
      el('div', { class: 'dev-row' }, [save]),
      saveStatus,
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
