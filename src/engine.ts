import { ENDING_TARGET, evalCondition, pickEnding, type CondContext } from './script';
import {
  isChoice,
  requiredObjects,
  type Character,
  type ChoiceLine,
  type ChoiceOption,
  type Distance,
  type Ending,
  type Gaze,
  type Line,
  type Scene,
  type SceneObject,
  type Script,
  type TextLine,
} from './types';
import { clamp } from './util';

export interface CharPose {
  expression: string;
  gaze: Gaze;
  distance: Distance;
}

export interface LogEntry {
  speaker: string;
  name: string;
  text: string;
  choice?: boolean;
  /** 點物件留下的紀錄，例如「（看了手機）」。 */
  object?: boolean;
}

/** 每句台詞顯示前存一份，用於「回上一句」。 */
export interface Snapshot {
  sceneId: string;
  index: number;
  stats: Record<string, number>;
  flags: string[];
  poses: Record<string, CharPose>;
  lastChar: string | null;
  desat: number;
  logLength: number;
  seen: string[];
}

/** 實際顯示給玩家的一個選項。index 是它在腳本 choice 陣列裡的位置。 */
export interface ShownOption {
  opt: ChoiceOption;
  index: number;
  /** requires 還沒滿足：出現但灰掉、不能按。 */
  locked: boolean;
  /** 還沒點過的物件 id。 */
  missing: string[];
}

interface PendingRepeat {
  line: TextLine;
  remaining: number;
}

export type Phase = 'title' | 'busy' | 'text' | 'choice' | 'inspect' | 'ending';

/** 引擎只處理流程與狀態；畫面、聲音、效果由 View 實作。 */
export interface View {
  showTitle(): void;
  /** 進入新場景（含轉場）。restoring 為 true 表示從「回上一句」回來。 */
  enterScene(scene: Scene, opts: { restoring: boolean }): Promise<void>;
  /** 顯示一句台詞；打字結束時須呼叫 engine.textDone()。 */
  showText(line: TextLine, ctx: { repeated: boolean; character: Character | null; pose: CharPose | null }): void;
  /** 若仍在打字則直接顯示完整句子並回傳 true。 */
  completeText(): boolean;
  showChoice(line: ChoiceLine, options: ShownOption[], onPick: (opt: ChoiceOption, index: number) => void): void;
  clearChoice(): void;
  showEnding(ending: Ending | null): void;
  /** 顯示物件說明；玩家關閉時須呼叫 engine.closeInspect()。 */
  showInspect(obj: SceneObject): void;
  /** 狀態改變（數值、場景、旗標等）時通知，供開發者面板更新。 */
  stateChanged(): void;
}

const DEFAULT_POSE: CharPose = { expression: 'neutral', gaze: 'camera', distance: 'normal' };

export class Engine {
  readonly script: Script;
  view!: View;

  phase: Phase = 'title';
  scene!: Scene;
  index = 0;
  stats: Record<string, number> = {};
  flags: string[] = [];
  poses: Record<string, CharPose> = {};
  /** 目前畫面上的角色（最後一位說話的角色）。 */
  lastChar: string | null = null;
  /** desaturate 疊加量（0–1），不會自己恢復。 */
  desat = 0;
  /** 點過的物件 id，依第一次點的順序。 */
  seen: string[] = [];
  history: Snapshot[] = [];
  log: LogEntry[] = [];
  repeats: PendingRepeat[] = [];
  /** 自增序號：每次換句或換場景都會變，非同步流程據此判斷是否已過期。 */
  token = 0;
  textFinished = false;
  /** 目前顯示中的選項。 */
  shown: ShownOption[] = [];
  ending: Ending | null = null;
  /** 開發者面板手動覆寫的退化係數；null 表示依幕自動決定。 */
  degradationOverride: number | null = null;

  private readonly scenes = new Map<string, Scene>();
  private readonly chars = new Map<string, Character>();
  private readonly objects = new Map<string, SceneObject>();

  constructor(script: Script) {
    this.script = script;
    for (const s of script.scenes) this.scenes.set(s.id, s);
    for (const s of script.scenes) for (const o of s.objects ?? []) this.objects.set(o.id, o);
    for (const c of script.characters ?? []) this.chars.set(c.id, c);
  }

  getScene(id: string): Scene | undefined {
    return this.scenes.get(id);
  }

  getObject(id: string): SceneObject | undefined {
    return this.objects.get(id);
  }

  getChar(id: string | null): Character | null {
    return id ? this.chars.get(id) ?? null : null;
  }

  /** 全域退化係數：第一幕 0、第二幕 0.5、第三幕 1（之後依此類推並夾在 0–1）。 */
  get degradation(): number {
    if (this.degradationOverride != null) return this.degradationOverride;
    const act = this.scene?.act ?? 1;
    return clamp((act - 1) / 2, 0, 1);
  }

  /** 判定 if／結局條件用的狀態。 */
  get condContext(): CondContext {
    return { stats: this.stats, flags: this.flags, seen: this.seen };
  }

  /** 判定一段 if；省略時成立。 */
  test(cond: string | undefined): boolean {
    return evalCondition(cond, this.condContext);
  }

  get currentLine(): Line | undefined {
    return this.scene?.lines[this.index];
  }

  speakerName(speaker: string): string {
    if (speaker === 'narrator' || speaker === 'player') return '';
    return this.chars.get(speaker)?.name ?? speaker;
  }

  /** 開新遊戲。 */
  async start(sceneId?: string): Promise<void> {
    this.stats = { ...(this.script.meta.stats ?? {}) };
    this.flags = [];
    this.poses = {};
    this.lastChar = null;
    this.desat = 0;
    this.seen = [];
    this.history = [];
    this.log = [];
    this.repeats = [];
    this.ending = null;
    await this.gotoScene(sceneId ?? this.script.scenes[0].id);
  }

  toTitle(): void {
    this.token++;
    this.phase = 'title';
    this.view.clearChoice();
    this.view.showTitle();
  }

  async gotoScene(id: string, opts: { restoring?: boolean; index?: number } = {}): Promise<void> {
    if (id === ENDING_TARGET) {
      const ending = pickEnding(this.script, this.condContext);
      if (!ending) return this.finish();
      this.ending = ending;
      id = ending.scene;
    }
    const scene = this.scenes.get(id);
    if (!scene) {
      console.error('[engine] 找不到場景', id);
      return this.finish();
    }
    const token = ++this.token;
    this.phase = 'busy';
    this.view.clearChoice();
    this.scene = scene;
    this.repeats = [];
    if (!opts.restoring) this.lastChar = null;
    await this.view.enterScene(scene, { restoring: !!opts.restoring });
    if (token !== this.token) return;
    this.playLine(opts.index ?? 0);
  }

  private snapshot(): Snapshot {
    return {
      sceneId: this.scene.id,
      index: this.index,
      stats: { ...this.stats },
      flags: [...this.flags],
      poses: structuredClone(this.poses),
      lastChar: this.lastChar,
      desat: this.desat,
      logLength: this.log.length,
      seen: [...this.seen],
    };
  }

  private playLine(index: number, repeatOf?: TextLine): void {
    this.index = index;
    if (!repeatOf && index >= this.scene.lines.length) {
      this.endScene();
      return;
    }
    const line = repeatOf ?? this.scene.lines[index];
    // if 不成立：整句跳過，不顯示、不寫入紀錄、不觸發效果、不留回上一句的快照
    if (!repeatOf && !this.test(line.if)) {
      this.playLine(index + 1);
      return;
    }
    let shown: ShownOption[] = [];
    if (!repeatOf && isChoice(line)) {
      shown = line.choice
        .map((opt, i) => {
          const missing = requiredObjects(opt).filter((id) => !this.seen.includes(id));
          return { opt, index: i, locked: missing.length > 0, missing };
        })
        .filter((o) => this.test(o.opt.if));
      if (shown.length === 0) {
        console.warn('[engine] 這組選項全部不成立，直接播下一句', this.scene.id, index);
        this.playLine(index + 1);
        return;
      }
    }
    // 選項出現前，先把還沒重播的 repeat_line 補播完。
    if (!repeatOf && isChoice(line) && this.repeats.length) {
      const due = this.repeats.shift()!;
      this.playLine(index, due.line);
      return;
    }
    this.history.push(this.snapshot());
    this.token++;
    this.view.clearChoice();
    if (isChoice(line)) {
      this.phase = 'choice';
      this.shown = shown;
      this.view.showChoice(line, shown, (opt) => this.choose(line, opt));
    } else {
      this.phase = 'text';
      this.textFinished = false;
      const character = this.getChar(line.speaker);
      let pose: CharPose | null = null;
      if (character) {
        const prev = this.poses[character.id] ?? DEFAULT_POSE;
        pose = {
          expression: line.expression ?? prev.expression,
          gaze: line.gaze ?? prev.gaze,
          distance: line.distance ?? prev.distance,
        };
        this.poses[character.id] = pose;
        this.lastChar = character.id;
      }
      if (!repeatOf && line.fx?.includes('repeat_line')) {
        this.repeats.push({ line, remaining: Math.random() < 0.5 ? 1 : 2 });
      }
      this.log.push({ speaker: line.speaker, name: this.speakerName(line.speaker), text: line.text });
      this.view.showText(line, { repeated: !!repeatOf, character, pose });
    }
    this.view.stateChanged();
  }

  /** 目前這一句可以點的物件（只在台詞播放中）。 */
  get availableObjects(): SceneObject[] {
    if (this.phase !== 'text') return [];
    return (this.scene.objects ?? []).filter((o) => (o.appearAt ?? 0) <= this.index);
  }

  /** 點物件：暫停遊戲、顯示說明、記為 seen（只記第一次的順序）。不推進劇情。 */
  inspect(id: string): boolean {
    const obj = this.availableObjects.find((o) => o.id === id);
    if (!obj) return false;
    if (!this.seen.includes(id)) this.seen.push(id);
    this.log.push({ speaker: 'object', name: '', text: `（看了${obj.label}）`, object: true });
    this.phase = 'inspect';
    this.view.showInspect(obj);
    this.view.stateChanged();
    return true;
  }

  /** 關閉物件說明，回到原本那句台詞。 */
  closeInspect(): void {
    if (this.phase === 'inspect') this.phase = 'text';
    this.view.stateChanged();
  }

  /** View 在打字結束後呼叫。 */
  textDone(): void {
    this.textFinished = true;
  }

  /** 玩家點擊／按鍵：打字中則補完，否則下一句。 */
  advance(): void {
    if (this.phase !== 'text') return;
    if (this.view.completeText()) return;
    this.next();
  }

  /** 前進到下一句（略過打字判定）。 */
  next(): void {
    if (this.phase !== 'text') return;
    const due = this.repeats.findIndex((r) => r.remaining <= 0);
    if (due >= 0) {
      const [r] = this.repeats.splice(due, 1);
      this.playLine(this.index, r.line);
      return;
    }
    for (const r of this.repeats) r.remaining--;
    this.playLine(this.index + 1);
  }

  private choose(line: ChoiceLine, opt: ChoiceOption): void {
    if (this.phase !== 'choice') return;
    if (this.shown.find((o) => o.opt === opt)?.locked) return;
    // flat_options：走「第一個實際出現的選項」的 goto
    const flat = line.fx?.includes('flat_options');
    const target = flat ? (this.shown[0]?.opt ?? line.choice[0]).goto : opt.goto;
    const range = this.script.meta.statRange ?? { min: -Infinity, max: Infinity };
    for (const [k, v] of Object.entries(opt.effects ?? {})) {
      this.stats[k] = clamp((this.stats[k] ?? 0) + v, range.min, range.max);
    }
    for (const f of opt.flags ?? []) if (!this.flags.includes(f)) this.flags.push(f);
    this.log.push({ speaker: 'player', name: '', text: opt.text, choice: true });
    this.view.clearChoice();
    this.phase = 'busy';
    this.view.stateChanged();
    if (target) void this.gotoScene(target);
    else this.playLine(this.index + 1);
  }

  private endScene(): void {
    if (this.repeats.length) {
      const r = this.repeats.shift()!;
      this.playLine(this.scene.lines.length - 1, r.line);
      return;
    }
    if (this.scene.id.startsWith('end_')) {
      this.finish();
      return;
    }
    void this.gotoScene(this.scene.next ?? ENDING_TARGET);
  }

  private finish(): void {
    this.token++;
    this.phase = 'ending';
    if (!this.ending && this.scene) {
      this.ending = this.script.endings.find((e) => e.scene === this.scene.id) ?? null;
    }
    this.view.showEnding(this.ending);
    this.view.stateChanged();
  }

  /** 回上一句。回傳 false 表示沒有可回去的地方。 */
  async back(): Promise<boolean> {
    if (this.phase !== 'text' && this.phase !== 'choice') return false;
    if (this.scene.ui?.back === 'wrong_scene' && this.scene.backTarget) {
      this.history = [];
      await this.gotoScene(this.scene.backTarget, { restoring: true });
      return true;
    }
    if (this.history.length < 2) return false;
    this.history.pop();
    const snap = this.history.pop()!;
    this.stats = { ...snap.stats };
    this.flags = [...snap.flags];
    this.poses = structuredClone(snap.poses);
    this.lastChar = snap.lastChar;
    this.desat = snap.desat;
    this.seen = [...snap.seen];
    this.log.length = snap.logLength;
    this.repeats = [];
    if (snap.sceneId !== this.scene.id) {
      await this.gotoScene(snap.sceneId, { restoring: true, index: snap.index });
    } else {
      this.playLine(snap.index);
    }
    return true;
  }
}
