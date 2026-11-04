// 開發者頁面「配音總表」（v3）：網址加 ?voice=1 打開，不出現在遊戲選單裡。
// 從 script.json 直接讀：列出所有配音句、探測音檔有無、試聽、整場試聽、匯出缺檔清單 voice-lines.json。
import { embeddedManifest } from './embed';
import { assetBase, assetFolderLabel, projectDir } from './paths';
import type { Script } from './types';
import { el } from './util';
import { voiceEntries, type VoiceEntry } from './voice';

const EXTENSIONS = ['mp3', 'ogg'];

type Status = 'checking' | 'has' | 'missing';

interface Row {
  entry: VoiceEntry;
  status: Status;
  /** 找到的音檔網址。 */
  url: string | null;
  tr: HTMLTableRowElement;
}

export class VoiceDesk {
  private readonly rows: Row[];
  private readonly names: Map<string, string>;
  private readonly speakerFilter = el('select', { name: 'vd-speaker' });
  private readonly sceneFilter = el('select', { name: 'vd-scene' });
  private readonly missingOnly = el('input', { type: 'checkbox', name: 'vd-missing-only' });
  private readonly exportMissingOnly = el('input', { type: 'checkbox', name: 'vd-export-missing' });
  private readonly summary = el('div', { class: 'vd-summary' });
  private readonly playScene = el('select', { name: 'vd-play-scene' });
  private readonly playStatus = el('span', { class: 'vd-play-status' });
  private readonly tbody = el('tbody');
  private player: HTMLAudioElement | null = null;
  private playRun = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly script: Script,
  ) {
    this.names = new Map([
      ['narrator', '旁白'],
      ['player', '主角'],
      ...(script.characters ?? []).map((c) => [c.id, c.name] as [string, string]),
    ]);
    this.rows = voiceEntries(script).map((entry) => ({ entry, status: 'checking', url: null, tr: el('tr') }));
    this.build();
    void this.probeAll();
  }

  private who(id: string): string {
    const name = this.names.get(id);
    return name && name !== id ? `${name}（${id}）` : id;
  }

  private build(): void {
    document.title = `配音總表｜${this.script.meta.title}`;
    document.body.classList.add('voice-desk-page');
    const speakers = [...new Set(this.rows.map((r) => r.entry.speaker))];
    const scenes = [...new Set(this.rows.map((r) => r.entry.scene))];
    this.speakerFilter.append(el('option', { value: '' }, ['全部角色']), ...speakers.map((s) => el('option', { value: s }, [this.who(s)])));
    this.sceneFilter.append(el('option', { value: '' }, ['全部場景']), ...scenes.map((s) => el('option', { value: s }, [s])));
    this.playScene.append(...scenes.map((s) => el('option', { value: s }, [s])));
    this.exportMissingOnly.checked = true;
    for (const f of [this.speakerFilter, this.sceneFilter, this.missingOnly]) f.addEventListener('change', () => this.applyFilter());

    const exportBtn = el('button', { type: 'button', 'data-vd': 'export' }, ['匯出 voice-lines.json']);
    exportBtn.onclick = () => this.exportList();
    const playBtn = el('button', { type: 'button', 'data-vd': 'play-scene' }, ['▶ 整場試聽']);
    playBtn.onclick = () => void this.playWholeScene();
    const stopBtn = el('button', { type: 'button', 'data-vd': 'stop' }, ['■ 停止']);
    stopBtn.onclick = () => this.stop();

    for (const row of this.rows) {
      const e = row.entry;
      const play = el('button', { type: 'button', class: 'vd-play', 'aria-label': `試聽 ${e.id}` }, ['▶']);
      play.onclick = () => this.playOne(row);
      const kind = e.kind === 'truth' ? '記憶對照' : e.kind === 'prompt' ? '選項提示' : '台詞';
      row.tr.dataset.id = e.id;
      row.tr.append(
        el('td', { class: 'vd-id' }, [e.id]),
        el('td', {}, [e.scene]),
        el('td', {}, [this.who(e.speaker)]),
        el('td', { class: 'vd-text' }, [el('span', { class: 'vd-kind' }, [kind]), e.text]),
        el('td', { class: 'vd-status' }, ['檢查中…']),
        el('td', {}, [play]),
      );
      this.tbody.append(row.tr);
    }

    this.root.replaceChildren(
      el('main', { class: 'voice-desk' }, [
        el('header', {}, [
          el('h1', {}, ['配音總表']),
          el('p', { class: 'vd-note' }, [
            `${this.script.meta.title}。音檔放在 ${assetFolderLabel('voice')}{編號}.mp3（或 .ogg）。這一頁不會出現在遊戲選單裡。`,
          ]),
        ]),
        this.summary,
        el('section', { class: 'vd-tools' }, [
          el('div', { class: 'vd-tool-row' }, [
            this.speakerFilter,
            this.sceneFilter,
            el('label', {}, [this.missingOnly, '只看缺檔']),
          ]),
          el('div', { class: 'vd-tool-row' }, [exportBtn, el('label', {}, [this.exportMissingOnly, '只匯出缺檔'])]),
          el('div', { class: 'vd-tool-row' }, ['整場試聽', this.playScene, playBtn, stopBtn, this.playStatus]),
        ]),
        el('table', { class: 'vd-table' }, [
          el('thead', {}, [el('tr', {}, ['編號', '場景', '角色', '台詞', '音檔', '試聽'].map((h) => el('th', {}, [h])))]),
          this.tbody,
        ]),
      ]),
    );
    this.renderSummary();
  }

  /** 用 HEAD 探測 .mp3、.ogg；開發伺服器找不到檔案時會回 index.html，所以也檢查內容類型。 */
  private async probe(id: string): Promise<string | null> {
    // 有內嵌清單（離線版）就照清單，不發請求
    const list = embeddedManifest(projectDir(), 'voice');
    if (list) {
      const ext = EXTENSIONS.find((e) => list.includes(`${id}.${e}`));
      return ext ? `${assetBase()}/voice/${id}.${ext}` : null;
    }
    for (const ext of EXTENSIONS) {
      const url = `${assetBase()}/voice/${id}.${ext}`;
      try {
        const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
        if (res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')) return url;
      } catch {
        /* 試下一個 */
      }
    }
    return null;
  }

  private async probeAll(): Promise<void> {
    const queue = [...this.rows];
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        row.url = await this.probe(row.entry.id);
        row.status = row.url ? 'has' : 'missing';
        row.tr.dataset.status = row.status;
        row.tr.querySelector('.vd-status')!.textContent = row.url ? `有（.${row.url.split('.').pop()}）` : '缺';
        row.tr.querySelector<HTMLButtonElement>('.vd-play')!.disabled = !row.url;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    this.root.querySelector('.voice-desk')?.setAttribute('data-ready', '1');
    this.renderSummary();
    this.applyFilter();
  }

  private renderSummary(): void {
    const total = this.rows.length;
    const has = this.rows.filter((r) => r.status === 'has').length;
    const missing = this.rows.filter((r) => r.status === 'missing').length;
    const checking = total - has - missing;
    const bySpeaker = new Map<string, { total: number; has: number }>();
    for (const r of this.rows) {
      const s = bySpeaker.get(r.entry.speaker) ?? { total: 0, has: 0 };
      s.total++;
      if (r.status === 'has') s.has++;
      bySpeaker.set(r.entry.speaker, s);
    }
    this.summary.replaceChildren(
      el('p', { class: 'vd-totals' }, [
        el('span', { 'data-count': 'total' }, [`共 ${total} 句`]),
        el('span', { 'data-count': 'has' }, [`有音檔 ${has}`]),
        el('span', { 'data-count': 'missing' }, [`缺檔 ${missing}`]),
        ...(checking ? [el('span', {}, [`檢查中 ${checking}`])] : []),
      ]),
      el(
        'table',
        { class: 'vd-by-speaker' },
        [...bySpeaker].map(([s, c]) =>
          el('tr', { 'data-speaker': s }, [el('td', {}, [this.who(s)]), el('td', {}, [`${c.has} / ${c.total}`]), el('td', {}, [`缺 ${c.total - c.has}`])]),
        ),
      ),
    );
  }

  private applyFilter(): void {
    const speaker = this.speakerFilter.value;
    const scene = this.sceneFilter.value;
    for (const r of this.rows) {
      r.tr.hidden =
        (!!speaker && r.entry.speaker !== speaker) || (!!scene && r.entry.scene !== scene) || (this.missingOnly.checked && r.status !== 'missing');
    }
  }

  /** 下載 voice-lines.json：[{ id, scene, speaker, text }]，預設只含缺檔的句子。 */
  private exportList(): void {
    const rows = this.exportMissingOnly.checked ? this.rows.filter((r) => r.status !== 'has') : this.rows;
    const data = rows.map(({ entry: e }) => ({ id: e.id, scene: e.scene, speaker: e.speaker, text: e.text }));
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
    const a = el('a', { href: url, download: 'voice-lines.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private play(url: string): Promise<void> {
    this.player?.pause();
    const audio = new Audio(url);
    this.player = audio;
    return new Promise((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.onpause = () => resolve();
      void audio.play().catch(() => resolve());
    });
  }

  private playOne(row: Row): void {
    this.stop();
    if (row.url) void this.play(row.url);
  }

  /** 依序播放這個場景所有有音檔的句子。 */
  private async playWholeScene(): Promise<void> {
    this.stop();
    const run = ++this.playRun;
    const rows = this.rows.filter((r) => r.entry.scene === this.playScene.value && r.url);
    if (!rows.length) {
      this.playStatus.textContent = '這個場景還沒有任何音檔。';
      return;
    }
    for (const [i, r] of rows.entries()) {
      if (run !== this.playRun) return;
      this.playStatus.textContent = `${i + 1} / ${rows.length}：${r.entry.id}`;
      r.tr.classList.add('playing');
      await this.play(r.url!);
      r.tr.classList.remove('playing');
      await new Promise((ok) => setTimeout(ok, 350));
    }
    if (run === this.playRun) this.playStatus.textContent = '播完了。';
  }

  private stop(): void {
    this.playRun++;
    this.player?.pause();
    this.player = null;
    for (const r of this.rows) r.tr.classList.remove('playing');
  }
}
