// 簡易文字編輯：只能改台詞、選項、物件說明、結局標題等文字，不能改結構。
// 本機開發（npm run dev）時「儲存」直接寫回 public/script.json；線上版改成下載 script.json。
import { editableFields, formatScript, getAt, setAt, type EditableField, type Path } from './editable';
import type { Engine } from './engine';
import { el, urlParam } from './util';
import type { AdvView } from './view';

interface Edit {
  path: Path;
  before: string;
  after: string;
  time: number;
}

/** 連續打字在這個時間內會併成一步復原。 */
const MERGE_MS = 800;
const SAVE_URL = '/__editor/save-script';

export class TextEditor {
  readonly root = el('section', { class: 'editor', role: 'dialog', 'aria-label': '文字編輯' });
  private readonly list = el('div', { class: 'editor-list' });
  private readonly status = el('p', { class: 'editor-status', 'aria-live': 'polite' });
  private readonly filter = el('input', { type: 'search', class: 'editor-filter', placeholder: '搜尋文字或位置', name: 'editor-filter' });
  private readonly undoBtn = el('button', { type: 'button', 'data-editor': 'undo', title: '復原（Ctrl+Z）' }, ['復原']);
  private readonly redoBtn = el('button', { type: 'button', 'data-editor': 'redo', title: '重做（Ctrl+Shift+Z）' }, ['重做']);
  private readonly saveBtn = el('button', { type: 'button', 'data-editor': 'save', class: 'primary' });
  private readonly inputs = new Map<string, HTMLTextAreaElement>();
  private undoStack: Edit[] = [];
  private redoStack: Edit[] = [];
  /** 上次儲存時，復原堆疊最上面那一步；用來判斷有沒有未儲存的變更。 */
  private savedTop: Edit | null = null;
  /** 儲存後的下一次輸入一定開新的一步，不併進已儲存的那步。 */
  private noMerge = false;
  private message = '';

  constructor(
    private readonly engine: Engine,
    private readonly view: AdvView,
  ) {
    this.saveBtn.textContent = import.meta.env.DEV ? '儲存（寫回 script.json）' : '下載 script.json';
    this.saveBtn.title = import.meta.env.DEV ? '寫回 public/script.json（Ctrl+S）' : '線上版無法直接寫檔，會下載修改後的 script.json（Ctrl+S）';
    const close = el('button', { type: 'button', 'data-editor': 'close', 'aria-label': '關閉' }, ['關閉']);
    this.undoBtn.onclick = () => this.undo();
    this.redoBtn.onclick = () => this.redo();
    this.saveBtn.onclick = () => void this.save();
    close.onclick = () => this.close();
    this.filter.oninput = () => this.applyFilter();
    this.root.append(
      el('header', { class: 'editor-header' }, [
        el('h2', {}, ['文字編輯']),
        el('div', { class: 'editor-actions' }, [this.undoBtn, this.redoBtn, this.saveBtn, close]),
        this.filter,
        this.status,
      ]),
      this.list,
    );
    this.root.addEventListener('click', (e) => e.stopPropagation());
    document.body.append(this.root);
    // 編輯器打開時攔下所有按鍵：遊戲與開發者面板都不會收到；打字照常
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('beforeunload', (e) => {
      if (this.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    if (urlParam('edit')) this.open();
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  get dirty(): boolean {
    return (this.undoStack[this.undoStack.length - 1] ?? null) !== this.savedTop;
  }

  open(): void {
    this.view.stopAuto();
    this.view.stopSkip();
    if (!this.list.childElementCount) this.build();
    this.root.classList.add('open');
    this.refresh();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  private build(): void {
    const fields = editableFields(this.engine.script);
    const groups = new Map<string, EditableField[]>();
    for (const f of fields) {
      const key = f.sceneId ?? '__endings';
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    const sections = [...groups].map(([key, items]) => {
      const scene = this.engine.getScene(key);
      const title = scene ? `${scene.id}${scene.title ? `｜${scene.title}` : ''}` : '結局標題';
      return el('section', { class: 'editor-scene', 'data-scene': key }, [el('h3', {}, [title]), ...items.map((f) => this.row(f))]);
    });
    this.list.replaceChildren(...sections);
  }

  private row(f: EditableField): HTMLElement {
    const key = f.path.join('.');
    const input = el('textarea', { rows: '1', 'aria-label': f.where, spellcheck: 'false' });
    input.value = String(getAt(this.engine.script, f.path) ?? '');
    input.addEventListener('input', () => {
      this.record(f.path, input.value);
      autosize(input);
    });
    this.inputs.set(key, input);
    const meta = el('div', { class: 'editor-meta' }, [el('span', { class: 'editor-where' }, [f.where])]);
    if (f.note) meta.append(el('code', { class: 'editor-note' }, [f.note]));
    if (f.kind === 'line.text' && f.sceneId) {
      const index = f.path[3] as number;
      const play = el('button', { type: 'button', class: 'editor-play', title: '關閉編輯器並從這一句開始播' }, ['▶ 試播']);
      play.onclick = () => this.playFrom(f.sceneId!, index);
      meta.append(play);
    }
    const row = el('div', { class: 'editor-field', 'data-path': key, 'data-kind': f.kind }, [meta, input]);
    requestAnimationFrame(() => autosize(input));
    return row;
  }

  /** 記下一次修改並立即套用到遊戲裡的腳本。 */
  private record(path: Path, value: string): void {
    const before = String(getAt(this.engine.script, path) ?? '');
    if (before === value) return;
    setAt(this.engine.script, path, value);
    const now = performance.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (!this.noMerge && top && top.path.join('.') === path.join('.') && now - top.time < MERGE_MS) {
      top.after = value;
      top.time = now;
    } else {
      this.undoStack.push({ path, before, after: value, time: now });
    }
    this.noMerge = false;
    this.redoStack = [];
    this.message = '';
    this.refresh();
  }

  undo(): void {
    const e = this.undoStack.pop();
    if (!e) return;
    this.apply(e.path, e.before);
    this.redoStack.push(e);
    this.noMerge = true;
    this.refresh();
  }

  redo(): void {
    const e = this.redoStack.pop();
    if (!e) return;
    this.apply(e.path, e.after);
    this.undoStack.push(e);
    this.noMerge = true;
    this.refresh();
  }

  private apply(path: Path, value: string): void {
    setAt(this.engine.script, path, value);
    const input = this.inputs.get(path.join('.'));
    if (input) {
      input.value = value;
      autosize(input);
      input.closest('.editor-field')?.scrollIntoView({ block: 'nearest' });
    }
  }

  /** 本機開發寫回 script.json；線上版（或寫回失敗時）下載檔案。 */
  async save(): Promise<void> {
    const text = formatScript(this.engine.script);
    if (import.meta.env.DEV) {
      try {
        const res = await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
        const body = (await res.json().catch(() => null)) as { ok: boolean; message: string } | null;
        if (res.ok && body?.ok) {
          this.markSaved('已寫回 public/script.json');
          return;
        }
        if (body?.message) {
          this.message = `沒有儲存：${body.message}`;
          this.refresh();
          return;
        }
      } catch {
        /* 開發伺服器沒有這個端點：改下載 */
      }
    }
    download(text);
    this.markSaved('已下載 script.json，請用它取代 public/script.json');
  }

  private markSaved(message: string): void {
    this.savedTop = this.undoStack[this.undoStack.length - 1] ?? null;
    this.noMerge = true;
    this.message = message;
    this.refresh();
  }

  private playFrom(sceneId: string, index: number): void {
    this.close();
    this.view.titleScreen.classList.remove('open');
    this.view.endingScreen.classList.remove('open');
    this.view.audio?.unlock();
    if (this.engine.phase === 'title' || this.engine.phase === 'ending') void this.engine.start(sceneId, index);
    else void this.engine.gotoScene(sceneId, { index });
  }

  private applyFilter(): void {
    const q = this.filter.value.trim().toLowerCase();
    for (const section of this.list.querySelectorAll<HTMLElement>('.editor-scene')) {
      let any = false;
      for (const row of section.querySelectorAll<HTMLElement>('.editor-field')) {
        const hit = !q || row.textContent!.toLowerCase().includes(q) || row.querySelector('textarea')!.value.toLowerCase().includes(q);
        row.hidden = !hit;
        any ||= hit;
      }
      section.hidden = !any;
    }
  }

  private refresh(): void {
    this.undoBtn.disabled = this.undoStack.length === 0;
    this.redoBtn.disabled = this.redoStack.length === 0;
    this.root.classList.toggle('dirty', this.dirty);
    this.status.textContent = this.message || (this.dirty ? '有未儲存的變更' : '沒有未儲存的變更');
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    e.stopPropagation();
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      this.redo();
    } else if (mod && key === 's') {
      e.preventDefault();
      void this.save();
    } else if (key === 'escape') {
      this.close();
    }
  }
}

function autosize(t: HTMLTextAreaElement): void {
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + 2}px`;
}

function download(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = el('a', { href: url, download: 'script.json' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
