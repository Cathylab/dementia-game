// 音樂：優先播放 public/assets/music/{name}.ogg（或 .mp3），檔案不存在時改用 Web Audio 合成的環境音。
// 走音機制（音高漂移、節奏不穩、偶爾靜音、音量不穩、濾波）同時套用在兩種來源上，強度由退化係數決定。
import { clamp, rand, seeded } from './util';
import type { AudioLike } from './view';

const MUSIC_BASE = `${import.meta.env.BASE_URL}assets/music`;
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
  }

  setDegradation(d: number): void {
    this.degradation = d;
    this.current?.setDegradation(d);
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
