// 音樂：優先播放 {專案}/assets/music/{name}.ogg（或 .mp3），檔案不存在時改用 Web Audio 合成的環境音。
// 離線模式（file://）不能用 Web Audio 讀本機音檔，音檔改用 <audio> 播放（見 ElementTrack）。
// 走音機制（音高漂移、節奏不穩、偶爾靜音、音量不穩、濾波）同時套用在兩種來源上，強度由退化係數決定。
import { clamp, rand, seeded } from './util';
import { localFileUrl } from './localfiles';
import { embeddedManifest, FILE_MODE } from './embed';
import { assetBase, projectDir } from './paths';
import type { AudioLike } from './view';

/** 配音依序找的副檔名。 */
export const VOICE_EXTENSIONS = ['mp3', 'ogg'];
export const MUSIC_EXTENSIONS = ['ogg', 'mp3'];
const EXTENSIONS = MUSIC_EXTENSIONS;

type Mode = 'file' | 'synth';

/** 目前播放中的背景音樂（Web Audio 的檔案或合成音，或離線模式的 <audio>）。 */
interface MusicTrack {
  readonly mode: Mode;
  start(fadeIn: number): void;
  stop(fadeOut: number): void;
  setDegradation(d: number): void;
}

/**
 * 離線模式（file://）的音樂：瀏覽器不准 Web Audio 讀本機音檔，改用 <audio> 播放。
 * 走音只做得到播放速度漂移（音高與速度一起不穩）、音量不穩與偶爾靜音，沒有濾波。
 */
class ElementTrack implements MusicTrack {
  readonly mode = 'file' as const;
  private readonly el: HTMLAudioElement;
  private degradation = 0;
  private drift = 0;
  private wobble = 1;
  private dropoutUntil = 0;
  private fadeFrom = 0;
  private fadeTo = 0;
  private fadeStart = 0;
  private fadeLen = 1;
  private ticks = 0;
  private timer = 0;
  private stopped = false;

  constructor(
    url: string,
    /** 音樂音量 × muffle（每次更新時讀取）。 */
    private readonly level: () => number,
  ) {
    this.el = new Audio(url);
    this.el.loop = true;
    (this.el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
    this.el.volume = 0;
  }

  start(fadeIn: number): void {
    this.fade(1, fadeIn);
    void this.el.play().catch(() => {});
    this.timer = window.setInterval(() => this.tick(), 100);
  }

  stop(fadeOut: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.fade(0, fadeOut);
    window.setTimeout(() => {
      clearInterval(this.timer);
      this.el.pause();
      this.el.removeAttribute('src');
    }, fadeOut * 1000 + 150);
  }

  setDegradation(d: number): void {
    this.degradation = clamp(d, 0, 1);
  }

  private fade(to: number, seconds: number): void {
    this.fadeFrom = this.currentFade();
    this.fadeTo = to;
    this.fadeStart = performance.now();
    this.fadeLen = Math.max(1, seconds * 1000);
  }

  private currentFade(): number {
    const k = clamp((performance.now() - this.fadeStart) / this.fadeLen, 0, 1);
    return this.fadeFrom + (this.fadeTo - this.fadeFrom) * k;
  }

  private tick(): void {
    // 每 250ms 更新一次走音（和 Web Audio 版一樣的節奏），音量每 100ms 更新
    if (++this.ticks % 3 === 0) {
      const d = this.degradation;
      const maxDrift = 45 * d;
      this.drift = clamp(this.drift + rand(-1, 1) * 9 * d, -maxDrift, maxDrift);
      this.el.playbackRate = Math.pow(2, this.drift / 1200);
      const now = performance.now();
      if (now >= this.dropoutUntil) {
        if (Math.random() < 0.035 * d) {
          this.dropoutUntil = now + rand(400, 1600);
          this.wobble = 0;
        } else {
          this.wobble = 1 - Math.random() * 0.55 * d;
        }
      }
    }
    this.el.volume = clamp(this.level() * this.currentFade() * this.wobble, 0, 1);
  }
}

/** 兩種音源共用的走音控制。output → filter → wobbleGain → destination */
abstract class Track {
  readonly output: GainNode;
  protected readonly filter: BiquadFilterNode;
  protected readonly wobble: GainNode;
  protected degradation = 0;
  /** 目前的音高漂移（cents），隨機漫步。 */
  protected drift = 0;
  private wobbleTimer = 0;
  private dropoutUntil = 0;
  stopped = false;
  abstract readonly mode: Mode;

  constructor(
    protected readonly ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.output = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.wobble = ctx.createGain();
    this.wobble.gain.value = 0;
    this.output.connect(this.filter).connect(this.wobble).connect(destination);
  }

  start(fadeIn: number): void {
    const t = this.ctx.currentTime;
    this.wobble.gain.cancelScheduledValues(t);
    this.wobble.gain.setValueAtTime(0, t);
    this.wobble.gain.linearRampToValueAtTime(1, t + fadeIn);
    this.begin();
    this.wobbleTimer = window.setInterval(() => this.tick(), 250);
  }

  stop(fadeOut: number): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.wobbleTimer);
    const t = this.ctx.currentTime;
    this.wobble.gain.cancelScheduledValues(t);
    this.wobble.gain.setValueAtTime(this.wobble.gain.value, t);
    this.wobble.gain.linearRampToValueAtTime(0, t + fadeOut);
    window.setTimeout(() => this.end(), fadeOut * 1000 + 100);
  }

  setDegradation(d: number): void {
    this.degradation = clamp(d, 0, 1);
  }

  /** 每 250ms 更新一次：音高漂移、音量不穩、濾波、偶爾整段靜音。 */
  private tick(): void {
    const d = this.degradation;
    const t = this.ctx.currentTime;
    const maxDrift = 45 * d;
    this.drift = clamp(this.drift + rand(-1, 1) * 9 * d, -maxDrift, maxDrift);
    this.applyDrift(this.drift);

    const freq = d === 0 ? 18000 : clamp(18000 - d * Math.random() * 15000, 900, 18000);
    this.filter.frequency.setTargetAtTime(freq, t, 0.4);

    const now = performance.now();
    if (now < this.dropoutUntil) return;
    if (Math.random() < 0.035 * d) {
      // 偶爾靜音
      const len = rand(400, 1600);
      this.dropoutUntil = now + len;
      this.wobble.gain.setTargetAtTime(0, t, 0.05);
      this.wobble.gain.setTargetAtTime(1, t + len / 1000, 0.3);
      return;
    }
    const vol = 1 - Math.random() * 0.55 * d;
    this.wobble.gain.setTargetAtTime(vol, t, 0.3);
  }

  protected abstract begin(): void;
  protected abstract end(): void;
  protected abstract applyDrift(cents: number): void;
}

/** 真實音檔：loop 播放。走音以 playbackRate 漂移（音高與速度一起不穩）、音量不穩與濾波達成。 */
class FileTrack extends Track {
  readonly mode = 'file' as const;
  private source: AudioBufferSourceNode | null = null;

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    private readonly buffer: AudioBuffer,
  ) {
    super(ctx, destination);
  }

  protected begin(): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.output);
    src.start();
    this.source = src;
  }

  protected end(): void {
    try {
      this.source?.stop();
    } catch {
      /* 已停止 */
    }
    this.source?.disconnect();
    this.output.disconnect();
  }

  protected applyDrift(cents: number): void {
    this.source?.playbackRate.setTargetAtTime(Math.pow(2, cents / 1200), this.ctx.currentTime, 0.5);
  }
}

const PROGRESSIONS = [
  // 大調：I maj7 → IV → vi → V
  [
    [0, 4, 7, 11],
    [5, 9, 12, 16],
    [-3, 0, 4, 7],
    [7, 11, 14, 17],
  ],
  // 小調：i7 → VI → iv → VII
  [
    [0, 3, 7, 10],
    [-4, 0, 3, 7],
    [5, 8, 12, 15],
    [-2, 2, 5, 9],
  ],
];
const ROOTS = [98, 110, 116.54, 130.81, 146.83];

/** 程式合成的環境音：幾個長音和弦＋低頻持續音＋偶爾的高音，依曲名決定調性。 */
class SynthTrack extends Track {
  readonly mode = 'synth' as const;
  private readonly rnd: () => number;
  private readonly root: number;
  private readonly progression: number[][];
  private step = 0;
  private stepTimer = 0;
  private drones: OscillatorNode[] = [];
  private voices = new Set<OscillatorNode>();
  private noise: AudioBufferSourceNode | null = null;

  constructor(ctx: AudioContext, destination: AudioNode, name: string) {
    super(ctx, destination);
    this.rnd = seeded(name);
    this.root = ROOTS[Math.floor(this.rnd() * ROOTS.length)];
    this.progression = PROGRESSIONS[Math.floor(this.rnd() * PROGRESSIONS.length)];
    this.output.gain.value = 0.9;
  }

  private freq(semi: number): number {
    return this.root * Math.pow(2, semi / 12);
  }

  protected begin(): void {
    const ctx = this.ctx;
    // 低頻持續音：兩個略微失諧的正弦波產生緩慢的拍頻
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.11;
    droneGain.connect(this.output);
    for (const [mult, det] of [
      [0.5, 0],
      [0.5, 4],
      [0.25, 0],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = this.root * mult;
      o.detune.value = det;
      o.connect(droneGain);
      o.start();
      this.drones.push(o);
    }
    // 很輕的房間底噪
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 400;
    const ng = ctx.createGain();
    ng.gain.value = 0.025;
    noise.connect(nf).connect(ng).connect(this.output);
    noise.start();
    this.noise = noise;
    this.playStep();
  }

  /** 換一個和弦；退化時節奏不穩。 */
  private playStep(): void {
    if (this.stopped) return;
    const ctx = this.ctx;
    const d = this.degradation;
    const chord = this.progression[this.step++ % this.progression.length];
    const dur = 7.5 * (1 + (Math.random() - 0.5) * 1.3 * d);
    const t = ctx.currentTime;
    const notes = [...chord].sort(() => this.rnd() - 0.5).slice(0, 3);
    for (const semi of notes) {
      const o = ctx.createOscillator();
      o.type = this.rnd() < 0.5 ? 'triangle' : 'sine';
      o.frequency.value = this.freq(semi + 12);
      // 每個聲部各自走音一點，彼此不再對齊
      o.detune.value = this.drift + rand(-1, 1) * 30 * d;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + 2.5);
      g.gain.setValueAtTime(0.045, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + 3);
      o.connect(g).connect(this.output);
      o.start(t);
      o.stop(t + dur + 3.1);
      this.voices.add(o);
      o.onended = () => {
        this.voices.delete(o);
        g.disconnect();
      };
    }
    // 偶爾一個像風鈴的高音
    if (this.rnd() < 0.45) {
      const at = t + rand(1, dur - 1);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = this.freq(chord[Math.floor(this.rnd() * chord.length)] + 24);
      o.detune.value = this.drift * 1.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.03, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 3);
      o.connect(g).connect(this.output);
      o.start(at);
      o.stop(at + 3.1);
      o.onended = () => g.disconnect();
    }
    this.stepTimer = window.setTimeout(() => this.playStep(), dur * 1000);
  }

  protected applyDrift(cents: number): void {
    const t = this.ctx.currentTime;
    this.drones.forEach((o, i) => o.detune.setTargetAtTime(cents * (i === 1 ? 1.3 : 1) + (i === 1 ? 4 : 0), t, 0.6));
    for (const o of this.voices) o.detune.setTargetAtTime(cents + rand(-1, 1) * 12 * this.degradation, t, 0.8);
  }

  protected end(): void {
    clearTimeout(this.stepTimer);
    for (const o of [...this.drones, ...this.voices]) {
      try {
        o.stop();
      } catch {
        /* 已停止 */
      }
    }
    try {
      this.noise?.stop();
    } catch {
      /* 已停止 */
    }
    this.output.disconnect();
  }
}

export class AudioEngine implements AudioLike {
  private ctx: AudioContext | null = null;
  private bus!: BiquadFilterNode;
  private muffleGain!: GainNode;
  private master!: GainNode;
  private current: MusicTrack | null = null;
  /** 離線模式的配音（<audio>）。 */
  private voiceEl: { el: HTMLAudioElement; done: () => void } | null = null;
  private currentName: string | null = null;
  private voiceBus!: BiquadFilterNode;
  private voiceMuffleGain!: GainNode;
  private voiceMaster!: GainNode;
  private voice: { src: AudioBufferSourceNode; gain: GainNode; done: () => void } | null = null;
  private voiceSeq = 0;
  private voiceVolume = 0.9;
  /** 各資料夾（voice、sfx）實際存在的檔案清單。 */
  private readonly manifests = new Map<string, Promise<Set<string> | null>>();
  private readonly sfxBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly voiceBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private requestSeq = 0;
  private degradation = 0;
  private muffled = false;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();

  constructor(
    private volume: number,
    /** 寫入 data-music / data-audio-mode / data-muffle，方便測試與除錯。 */
    private readonly statusEl: HTMLElement,
  ) {}

  /** 必須在使用者手勢（點擊）中呼叫，瀏覽器才允許出聲。 */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.bus = ctx.createBiquadFilter();
      this.bus.type = 'lowpass';
      this.bus.frequency.value = 20000;
      this.muffleGain = ctx.createGain();
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.bus.connect(this.muffleGain).connect(this.master).connect(ctx.destination);
      // 配音另走一條：不受音樂音量與退化影響，只跟著 muffle 一起悶
      this.voiceBus = ctx.createBiquadFilter();
      this.voiceBus.type = 'lowpass';
      this.voiceBus.frequency.value = this.muffled ? 650 : 20000;
      this.voiceMuffleGain = ctx.createGain();
      this.voiceMuffleGain.gain.value = this.muffled ? 0.4 : 1;
      this.voiceMaster = ctx.createGain();
      this.voiceMaster.gain.value = this.voiceVolume;
      this.voiceBus.connect(this.voiceMuffleGain).connect(this.voiceMaster).connect(ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** muffle：低通濾波＋降低音量。 */
  setMuffle(on: boolean): void {
    if (on === this.muffled) return;
    this.muffled = on;
    this.statusEl.dataset.muffle = on ? '1' : '0';
    if (this.voiceEl) this.voiceEl.el.volume = this.voiceLevel();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bus.frequency.setTargetAtTime(on ? 650 : 20000, t, on ? 0.25 : 0.6);
    this.muffleGain.gain.setTargetAtTime(on ? 0.4 : 1, t, 0.3);
    this.voiceBus.frequency.setTargetAtTime(on ? 650 : 20000, t, on ? 0.25 : 0.6);
    this.voiceMuffleGain.gain.setTargetAtTime(on ? 0.4 : 1, t, 0.3);
  }

  // ───────── 配音（v3） ─────────

  setVoiceVolume(v: number): void {
    this.voiceVolume = v;
    if (this.ctx) this.voiceMaster.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    if (this.voiceEl) this.voiceEl.el.volume = this.voiceLevel();
    if (v === 0) this.stopVoice();
  }

  /**
   * 播一句配音。回傳的 Promise 在播完、被停止、找不到檔案或配音音量為 0 時完成（不會失敗）。
   * 新的一句會先把正在播的那句在 0.1 秒內淡出。
   */
  playVoice(id: string): Promise<void> {
    this.stopVoice();
    const seq = ++this.voiceSeq;
    if (!this.ctx || this.voiceVolume === 0) return Promise.resolve();
    const ctx = this.ctx;
    this.statusEl.dataset.voice = id;
    this.statusEl.dataset.voiceState = 'loading';
    // 離線模式：沒有事先解碼好的（上傳的）就用 <audio> 播
    if (FILE_MODE && !this.voiceBuffers.has(id)) return this.playVoiceElement(id, seq);
    return this.loadVoice(id).then(
      (buffer) =>
        new Promise<void>((resolve) => {
          if (seq !== this.voiceSeq || !buffer) {
            if (seq === this.voiceSeq) this.statusEl.dataset.voiceState = 'missing';
            resolve();
            return;
          }
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          const gain = ctx.createGain();
          src.connect(gain).connect(this.voiceBus);
          const done = () => {
            if (this.voice?.src === src) {
              this.voice = null;
              this.statusEl.dataset.voiceState = 'ended';
            }
            resolve();
          };
          src.onended = done;
          this.voice = { src, gain, done };
          this.statusEl.dataset.voiceState = 'playing';
          src.start();
        }),
    );
  }

  private playVoiceElement(id: string, seq: number): Promise<void> {
    return this.findAudio('voice', id).then(
      (url) =>
        new Promise<void>((resolve) => {
          if (seq !== this.voiceSeq || !url) {
            if (seq === this.voiceSeq) this.statusEl.dataset.voiceState = 'missing';
            resolve();
            return;
          }
          const el = new Audio(url);
          el.volume = this.voiceLevel();
          const done = () => {
            if (this.voiceEl?.el === el) {
              this.voiceEl = null;
              this.statusEl.dataset.voiceState = 'ended';
            }
            resolve();
          };
          el.onended = done;
          el.onerror = () => {
            if (this.voiceEl?.el === el) this.statusEl.dataset.voiceState = 'missing';
            this.voiceEl = null;
            resolve();
          };
          this.voiceEl = { el, done };
          this.statusEl.dataset.voiceState = 'playing';
          void el.play().catch(() => done());
        }),
    );
  }

  /** 離線模式配音的音量：配音音量 × muffle。 */
  private voiceLevel(): number {
    return clamp(this.voiceVolume * (this.muffled ? 0.4 : 1), 0, 1);
  }

  /** 停止正在播的配音（0.1 秒淡出，不硬切）。 */
  stopVoice(): void {
    this.voiceSeq++;
    const ve = this.voiceEl;
    if (ve) {
      this.voiceEl = null;
      ve.el.pause();
      this.statusEl.dataset.voiceState = 'stopped';
      ve.done();
    }
    const v = this.voice;
    if (!v || !this.ctx) return;
    this.voice = null;
    const t = this.ctx.currentTime;
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + 0.1);
    try {
      v.src.stop(t + 0.11);
    } catch {
      /* 已停止 */
    }
    this.statusEl.dataset.voiceState = 'stopped';
    v.done();
  }

  get voicePlaying(): boolean {
    return !!this.voice || !!this.voiceEl;
  }

  /** 這句配音有沒有音檔（依 manifest 判斷，不會產生 404）。 */
  async hasVoice(id: string): Promise<boolean> {
    return (await this.voiceFile(id)) !== null;
  }

  /**
   * 找音檔：先看本機素材；建置時會產生 assets/{folder}/manifest.json（列出實際存在的檔案），
   * 有它就只請求存在的檔案，缺檔時完全不發請求，主控台不會出現 404。
   * 沒有 manifest 時才逐一嘗試 .mp3、.ogg。
   */
  private async findAudio(folder: 'voice' | 'sfx', id: string): Promise<string | null> {
    const local = localFileUrl(folder, id, VOICE_EXTENSIONS);
    if (local) return local;
    const manifest = await this.manifestFor(folder);
    if (manifest) {
      const ext = VOICE_EXTENSIONS.find((e) => manifest.has(`${id}.${e}`));
      return ext ? `${assetBase()}/${folder}/${id}.${ext}` : null;
    }
    if (FILE_MODE) return null;
    for (const ext of VOICE_EXTENSIONS) {
      const url = `${assetBase()}/${folder}/${id}.${ext}`;
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')) return url;
      } catch {
        /* 試下一個 */
      }
    }
    return null;
  }

  private voiceFile(id: string): Promise<string | null> {
    return this.findAudio('voice', id);
  }

  private manifestFor(folder: string): Promise<Set<string> | null> {
    let p = this.manifests.get(folder);
    const embedded = embeddedManifest(projectDir(), folder);
    if (!p && embedded) {
      p = Promise.resolve(new Set(embedded));
      this.manifests.set(folder, p);
    }
    if (!p) {
      p = fetch(`${assetBase()}/${folder}/manifest.json`, { cache: 'no-cache' })
        .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null))
        .then((list: unknown) => (Array.isArray(list) ? new Set(list.map(String)) : null))
        .catch(() => null);
      this.manifests.set(folder, p);
    }
    return p;
  }

  private loadVoice(id: string): Promise<AudioBuffer | null> {
    let p = this.voiceBuffers.get(id);
    if (!p) {
      p = this.voiceFile(id).then(async (url) => {
        if (!url || !this.ctx) return null;
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          return null;
        }
      });
      this.voiceBuffers.set(id, p);
    }
    return p;
  }

  // ───────── 音效（只播一次，不循環） ─────────

  /**
   * 播一個音效：public/assets/sfx/{name}.mp3（或 .ogg）。和音樂走同一條音軌（受音樂音量與 muffle 影響，
   * 不受退化走音影響），可以和音樂、配音同時出現。缺檔時什麼都不做。
   */
  /** 每個音效的音量倍數（meta.sfxVolume，0～1，沒寫的是 1）；main.ts 接到目前的劇本。 */
  sfxLevel: (name: string) => number = () => 1;

  private level(name: string): number {
    const v = this.sfxLevel(name);
    return typeof v === 'number' && v >= 0 ? Math.min(v, 1) : 1;
  }

  /** 這個音效接到音樂音軌，中間加一個依 sfxVolume 調整的音量。 */
  private sfxOut(ctx: AudioContext, name: string): GainNode {
    const g = ctx.createGain();
    g.gain.value = this.level(name);
    g.connect(this.bus);
    return g;
  }

  /** 調整 sfxVolume 後，正在循環的那個音效立刻換音量。 */
  refreshSfxLevel(name: string): void {
    this.loopLevels.get(name)?.(this.level(name));
  }

  playSfx(name: string): void {
    if (!this.ctx || !name) return;
    const ctx = this.ctx;
    this.statusEl.dataset.sfx = name;
    this.statusEl.dataset.sfxState = 'loading';
    this.statusEl.dataset.sfxLevel = String(this.level(name));
    if (FILE_MODE && !this.sfxBuffers.has(name)) {
      void this.findAudio('sfx', name).then((url) => {
        if (!url) {
          if (this.statusEl.dataset.sfx === name) this.statusEl.dataset.sfxState = 'missing';
          return;
        }
        const el = new Audio(url);
        el.volume = clamp(this.volume * (this.muffled ? 0.4 : 1) * this.level(name), 0, 1);
        el.onended = () => {
          if (this.statusEl.dataset.sfx === name) this.statusEl.dataset.sfxState = 'ended';
        };
        this.statusEl.dataset.sfxState = 'playing';
        void el.play().catch(() => (this.statusEl.dataset.sfxState = 'missing'));
      });
      return;
    }
    void this.loadSfx(name).then((buffer) => {
      if (!buffer) {
        if (this.statusEl.dataset.sfx === name) this.statusEl.dataset.sfxState = 'missing';
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.sfxOut(ctx, name));
      src.onended = () => {
        if (this.statusEl.dataset.sfx === name) this.statusEl.dataset.sfxState = 'ended';
      };
      this.statusEl.dataset.sfxState = 'playing';
      src.start();
    });
  }

  /** 有沒有這個音效檔。 */
  async hasSfx(name: string): Promise<boolean> {
    return (await this.findAudio('sfx', name)) !== null;
  }

  /** 開發者面板上傳：先解碼確認能播，並記住這個音效（檔案本身由呼叫端放進本機素材）。 */
  async useSfxFile(name: string, file: Blob): Promise<boolean> {
    this.unlock();
    if (!this.ctx) return false;
    try {
      const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
      this.sfxBuffers.set(name, Promise.resolve(buffer));
      return true;
    } catch {
      return false;
    }
  }

  /** 本機素材換了（上傳）：下次重新載入。 */
  forgetSfx(name: string): void {
    this.sfxBuffers.delete(name);
  }

  /** 正在循環的音效（物件的 sfx）：名稱 → 停止。 */
  private readonly sfxLoops = new Map<string, () => void>();
  /** 正在循環的音效：名稱 → 換音量（refreshSfxLevel 用）。 */
  private readonly loopLevels = new Map<string, (level: number) => void>();

  /**
   * 物件的循環音效：只留 names 裡的，其餘停止；新出現的開始循環。缺檔安靜略過。
   * 和一次性的音效一樣走音樂的音軌（受音樂音量與 muffle 影響）。
   */
  setSfxLoops(names: string[]): void {
    const want = new Set(names.filter(Boolean));
    for (const [name, stop] of this.sfxLoops) {
      if (want.has(name)) continue;
      stop();
      this.sfxLoops.delete(name);
      this.loopLevels.delete(name);
    }
    this.statusEl.dataset.sfxLoops = [...want].join(' ');
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (const name of want) {
      if (this.sfxLoops.has(name)) continue;
      let stopped = false;
      let stopNow = () => {};
      this.sfxLoops.set(name, () => {
        stopped = true;
        stopNow();
      });
      if (FILE_MODE && !this.sfxBuffers.has(name)) {
        void this.findAudio('sfx', name).then((url) => {
          if (!url || stopped) return;
          const el = new Audio(url);
          el.loop = true;
          const base = clamp(this.volume * (this.muffled ? 0.4 : 1), 0, 1);
          el.volume = clamp(base * this.level(name), 0, 1);
          this.loopLevels.set(name, (l) => (el.volume = clamp(base * l, 0, 1)));
          stopNow = () => el.pause();
          void el.play().catch(() => {});
        });
        continue;
      }
      void this.loadSfx(name).then((buffer) => {
        if (!buffer || stopped) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const out = this.sfxOut(ctx, name);
        src.connect(out);
        this.loopLevels.set(name, (l) => out.gain.setTargetAtTime(l, ctx.currentTime, 0.03));
        stopNow = () => {
          try {
            src.stop();
          } catch {
            /* 已經停了 */
          }
        };
        src.start();
      });
    }
  }

  private loadSfx(name: string): Promise<AudioBuffer | null> {
    let p = this.sfxBuffers.get(name);
    if (!p) {
      p = this.findAudio('sfx', name).then(async (url) => {
        if (!url || !this.ctx) return null;
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          return null;
        }
      });
      // 找不到的不要記住，之後上傳了還能播
      void p.then((b) => {
        if (!b && this.sfxBuffers.get(name) === p) this.sfxBuffers.delete(name);
      });
      this.sfxBuffers.set(name, p);
    }
    return p;
  }

  setDegradation(d: number): void {
    this.degradation = d;
    this.current?.setDegradation(d);
  }

  /** 目前播放的曲名（null＝靜音）。 */
  get musicName(): string | null {
    return this.currentName;
  }

  /**
   * 開發者面板試聽：把電腦裡的音樂檔暫時當成某個曲名來播（只在這次開啟的頁面有效）。
   * 回傳 false 表示瀏覽器無法解碼這個檔案。
   */
  async useFile(name: string, file: Blob): Promise<boolean> {
    this.unlock();
    if (!this.ctx) return false;
    try {
      const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
      this.buffers.set(name, Promise.resolve(buffer));
    } catch {
      return false;
    }
    if (this.currentName === name) {
      // 同一首正在播：重新開始，換成剛載入的檔案
      this.currentName = null;
      this.playMusic(name);
    }
    return true;
  }

  /**
   * 開發者面板上傳：把電腦裡的音檔當成某句配音。檔案本身由呼叫端放進本機素材（localfiles），
   * 這裡只先解碼確認瀏覽器能播。回傳 false 表示無法解碼。
   */
  async useVoiceFile(id: string, file: Blob): Promise<boolean> {
    this.unlock();
    if (!this.ctx) return false;
    try {
      const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
      this.voiceBuffers.set(id, Promise.resolve(buffer));
      return true;
    } catch {
      return false;
    }
  }

  /** 字串＝播放該曲；null＝停止；undefined＝沿用目前的曲子。 */
  playMusic(name: string | null | undefined): void {
    if (name === undefined || name === this.currentName) return;
    this.currentName = name;
    const seq = ++this.requestSeq;
    this.current?.stop(2);
    this.current = null;
    this.statusEl.dataset.music = name ?? '';
    this.statusEl.dataset.audioMode = name && this.ctx ? 'loading' : 'none';
    if (!name || !this.ctx) return;
    const ctx = this.ctx;
    if (FILE_MODE && !this.buffers.has(name)) {
      void this.musicUrl(name).then((url) => {
        if (seq !== this.requestSeq) return;
        const track: MusicTrack = url
          ? new ElementTrack(url, () => this.volume * (this.muffled ? 0.4 : 1))
          : new SynthTrack(ctx, this.bus, name);
        track.setDegradation(this.degradation);
        track.start(2.5);
        this.current = track;
        this.statusEl.dataset.audioMode = track.mode;
      });
      return;
    }
    void this.loadBuffer(name).then((buffer) => {
      if (seq !== this.requestSeq) return;
      const track = buffer ? new FileTrack(ctx, this.bus, buffer) : new SynthTrack(ctx, this.bus, name);
      track.setDegradation(this.degradation);
      track.start(2.5);
      this.current = track;
      this.statusEl.dataset.audioMode = track.mode;
    });
  }

  /** 有沒有這首音樂的檔案（沒有時會用合成音）。 */
  async hasMusic(name: string): Promise<boolean> {
    if (this.buffers.has(name) && (await this.buffers.get(name))) return true;
    return (await this.musicUrl(name)) !== null;
  }

  /** 音樂檔的網址：先看本機素材，再看清單（有清單時不請求不存在的檔案）。null＝沒有檔案。 */
  private async musicUrl(name: string): Promise<string | null> {
    const local = localFileUrl('music', name, EXTENSIONS);
    if (local) return local;
    const manifest = await this.manifestFor('music');
    const ext = EXTENSIONS.find((e) => manifest?.has(`${name}.${e}`));
    return ext ? `${assetBase()}/music/${name}.${ext}` : null;
  }

  private loadBuffer(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      p = (async () => {
        const local = localFileUrl('music', name, EXTENSIONS);
        const manifest = local ? null : await this.manifestFor('music');
        const exts = manifest ? EXTENSIONS.filter((e) => manifest.has(`${name}.${e}`)) : EXTENSIONS;
        const urls = local ? [local] : exts.map((ext) => `${assetBase()}/music/${name}.${ext}`);
        for (const url of urls) {
          try {
            const res = await fetch(url);
            const type = res.headers.get('content-type') ?? '';
            if (!res.ok || type.includes('text/html')) continue;
            return await this.ctx!.decodeAudioData(await res.arrayBuffer());
          } catch {
            /* 試下一個副檔名 */
          }
        }
        return null;
      })();
      this.buffers.set(name, p);
    }
    return p;
  }
}
