import type { Engine, View } from './engine';
import type { ChoiceLine, ChoiceOption, Ending, TextLine } from './types';
import { el } from './util';

/** 第一階段的純文字畫面。 */
export class BasicView implements View {
  private readonly root: HTMLElement;
  private readonly engine: Engine;
  private readonly name = el('div', { class: 'name' });
  private readonly text = el('div', { class: 'text' });
  private readonly choices = el('div', { class: 'choices' });

  constructor(root: HTMLElement, engine: Engine) {
    this.root = root;
    this.engine = engine;
  }

  showTitle(): void {
    const start = el('button', { class: 'start' }, ['開始']);
    start.onclick = () => this.mountGame();
    this.root.replaceChildren(el('h1', {}, [this.engine.script.meta.title]), start);
  }

  private mountGame(): void {
    const box = el('div', { class: 'box' }, [this.name, this.text]);
    box.onclick = () => this.engine.advance();
    this.root.replaceChildren(box, this.choices);
    void this.engine.start();
  }

  async enterScene(): Promise<void> {}

  showText(line: TextLine): void {
    this.name.textContent = this.engine.speakerName(line.speaker);
    this.text.textContent = line.text;
    this.engine.textDone();
  }

  completeText(): boolean {
    return false;
  }

  showChoice(line: ChoiceLine, onPick: (opt: ChoiceOption, i: number) => void): void {
    this.choices.replaceChildren(
      ...line.choice.map((opt, i) => {
        const b = el('button', { class: 'choice' }, [opt.text]);
        b.onclick = () => onPick(opt, i);
        return b;
      }),
    );
  }

  clearChoice(): void {
    this.choices.replaceChildren();
  }

  showEnding(ending: Ending | null): void {
    const back = el('button', {}, ['回到標題']);
    back.onclick = () => this.engine.toTitle();
    this.root.replaceChildren(el('h2', { class: 'ending' }, [`結局：${ending?.title ?? ''}`]), back);
  }

  stateChanged(): void {}
}
