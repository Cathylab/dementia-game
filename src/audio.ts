// 音樂：優先播放 public/assets/music/{name}.ogg（或 .mp3），檔案不存在時改用 Web Audio 合成的環境音。
// 走音機制（音高漂移、節奏不穩、偶爾靜音、音量不穩、濾波）同時套用在兩種來源上，強度由退化係數決定。
import { clamp, rand, seeded } from './util';
import type { AudioLike } from './view';

const MUSIC_BASE = `${import.meta.env.BASE_URL}assets/music`;
const VOICE_BASE = `${import.meta.env.BASE_URL}assets/voice`;
/** 配音依序找的副檔名。 */
export const VOICE_EXTENSIONS = ['mp3', 'ogg'];
const EXTENSIONS = ['ogg', 'mp3'];

type Mode = 'file' | 'synth';

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
  private current: Track | null = null;
  private currentName: string | null = null;
  private voiceBus!: BiquadFilterNode;
  private voiceMuffleGain!: GainNode;
  private voiceMaster!: GainNode;
  private voice: { src: AudioBufferSourceNode; gain: GainNode; done: () => void } | null = null;
  private voiceSeq = 0;
  private voiceVolume = 0.9;
  private manifest: Promise<Set<string> | null> | null = null;
  private readonly voiceBuffers = new Map<string, Promise<AudioBuffer | null>>();
  /** 開發者面板上傳的配音（只在這次開啟的頁面有效）。 */
  private readonly uploadedVoices = new Set<string>();
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

  /** 停止正在播的配音（0.1 秒淡出，不硬切）。 */
  stopVoice(): void {
    this.voiceSeq++;
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
    return !!this.voice;
  }

  /** 這句配音有沒有音檔（依 manifest 判斷，不會產生 404）。 */
  async hasVoice(id: string): Promise<boolean> {
    return this.uploadedVoices.has(id) || (await this.voiceFile(id)) !== null;
  }

  /**
   * 找音檔：建置時會產生 assets/voice/manifest.json（列出實際存在的檔案），
   * 有它就只請求存在的檔案，缺檔時完全不發請求，主控台不會出現 404。
   * 沒有 manifest 時才逐一嘗試 .mp3、.ogg。
   */
  private async voiceFile(id: string): Promise<string | null> {
    const manifest = await this.voiceManifest();
    if (manifest) {
      const ext = VOICE_EXTENSIONS.find((e) => manifest.has(`${id}.${e}`));
      return ext ? `${VOICE_BASE}/${id}.${ext}` : null;
    }
    for (const ext of VOICE_EXTENSIONS) {
      const url = `${VOICE_BASE}/${id}.${ext}`;
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')) return url;
      } catch {
        /* 試下一個 */
      }
    }
    return null;
  }

  private voiceManifest(): Promise<Set<string> | null> {
    this.manifest ??= fetch(`${VOICE_BASE}/manifest.json`, { cache: 'no-cache' })
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null))
      .then((list: unknown) => (Array.isArray(list) ? new Set(list.map(String)) : null))
      .catch(() => null);
    return this.manifest;
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
   * 開發者面板上傳：把電腦裡的音檔暫時當成某句配音（只在這次開啟的頁面有效）。
   * 回傳 false 表示瀏覽器無法解碼這個檔案。
   */
  async useVoiceFile(id: string, file: Blob): Promise<boolean> {
    this.unlock();
    if (!this.ctx) return false;
    try {
      const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
      this.voiceBuffers.set(id, Promise.resolve(buffer));
      this.uploadedVoices.add(id);
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
    void this.loadBuffer(name).then((buffer) => {
      if (seq !== this.requestSeq) return;
      const track = buffer ? new FileTrack(ctx, this.bus, buffer) : new SynthTrack(ctx, this.bus, name);
      track.setDegradation(this.degradation);
      track.start(2.5);
      this.current = track;
      this.statusEl.dataset.audioMode = track.mode;
    });
  }

  private loadBuffer(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      p = (async () => {
        for (const ext of EXTENSIONS) {
          try {
            const res = await fetch(`${MUSIC_BASE}/${name}.${ext}`);
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
