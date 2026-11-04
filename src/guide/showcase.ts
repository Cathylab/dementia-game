// 班級展示（需求書 6-8）：一次載入全班的專案檔，輪流在大螢幕上玩；每個作品有互評表。
// 每個作品存在自己的瀏覽器資料庫（不會動到這台電腦上自己的專案）；清單與互評存在 localStorage。
import { downloadBlob } from '../project';
import { unpackProject } from '../projectfile';
import { BrowserProjectStore } from '../projectstore';
import { el } from '../util';
import { gameHref } from './links';
import { REVIEW_CRITERIA, REVIEW_PROMPTS, reviewsCsv, reviewSummary, showcaseDb, type Review, type ShowcaseWork } from './review';

const WORKS = 'vn-showcase';
const REVIEWS = 'vn-showcase-reviews';
const CURRENT = 'vn-showcase-current';

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存不了：這次頁面還是能用 */
  }
}

export function renderShowcase(root: HTMLElement): void {
  let works = read<ShowcaseWork[]>(WORKS, []);
  let reviews = read<Review[]>(REVIEWS, []);
  let current = read<string>(CURRENT, '');
  const msg = el('p', { class: 'g-status', 'data-guide': 'showcase-status', 'aria-live': 'polite' });
  const list = el('div', { class: 'g-show-list' });
  const papers = el('div', { class: 'g-review-papers' });

  const files = el('input', { type: 'file', name: 'showcase-files', accept: '.vnproj,.zip', multiple: '' });
  files.onchange = async () => {
    const fs = [...(files.files ?? [])];
    files.value = '';
    if (!fs.length) return;
    msg.classList.remove('ok');
    msg.textContent = `載入中…（${fs.length} 個檔案）`;
    const failed: string[] = [];
    let ok = 0;
    for (const f of fs) {
      try {
        const p = await unpackProject(f);
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        await new BrowserProjectStore(showcaseDb(id)).save({ script: p.script, files: p.files, savedAt: Date.now() });
        works.push({ id, title: p.script.meta?.title || f.name.replace(/\.[^.]+$/, ''), group: p.info.group ?? '', file: f.name, addedAt: Date.now() });
        ok++;
      } catch (e) {
        failed.push(`${f.name}（${e instanceof Error ? e.message : String(e)}）`);
      }
    }
    write(WORKS, works);
    if (!current && works.length) current = works[0].id;
    write(CURRENT, current);
    msg.textContent = [ok ? `載入 ${ok} 個作品。` : '', failed.length ? `沒有載入：${failed.join('、')}` : ''].join('');
    msg.classList.toggle('ok', !failed.length);
    render();
  };

  const download = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'review-download' }, ['下載互評結果（試算表）']);
  download.onclick = () => {
    if (!reviews.length) {
      msg.textContent = '還沒有任何互評。';
      return;
    }
    downloadBlob(new Blob([reviewsCsv(works, reviews)], { type: 'text/csv;charset=utf-8' }), '互評結果.csv');
    msg.textContent = `已下載 ${reviews.length} 份互評。`;
  };
  const print = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'review-print' }, ['列印紙本互評表']);
  print.onclick = () => window.print();
  const next = el('button', { type: 'button', class: 'g-btn primary', 'data-guide': 'showcase-next' }, ['下一組']);
  next.onclick = () => {
    if (!works.length) return;
    const i = works.findIndex((w) => w.id === current);
    current = works[(i + 1) % works.length].id;
    write(CURRENT, current);
    render();
  };
  const clear = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'showcase-clear' }, ['清空展示']);
  clear.onclick = async () => {
    if (!confirm('移除所有作品與互評？（學生自己的專案檔不受影響）')) return;
    for (const w of works) await BrowserProjectStore.drop(showcaseDb(w.id));
    works = [];
    reviews = [];
    current = '';
    write(WORKS, works);
    write(REVIEWS, reviews);
    write(CURRENT, current);
    render();
  };

  function reviewForm(w: ShowcaseWork): HTMLElement {
    const form = el('form', { class: 'g-review-form', 'data-guide': 'review-form' });
    const reviewer = el('input', { type: 'text', name: 'review-reviewer', placeholder: '評的人或組別，例如：第 2 組' });
    const scales = REVIEW_CRITERIA.map((c) =>
      el('fieldset', { class: 'g-scale' }, [
        el('legend', {}, [c.label]),
        ...c.levels.map((label, k) => {
          const r = el('input', { type: 'radio', name: `score-${c.id}`, value: String(k + 1) });
          return el('label', { class: 'g-radio' }, [r, `${k + 1}・${label}`]);
        }),
      ]),
    );
    const feel = el('textarea', { name: 'review-feel', rows: '2', placeholder: REVIEW_PROMPTS.feel });
    const suggest = el('textarea', { name: 'review-suggest', rows: '2', placeholder: REVIEW_PROMPTS.suggest });
    const note = el('p', { class: 'g-status', 'aria-live': 'polite' });
    const submit = el('button', { type: 'submit', class: 'g-btn primary', 'data-guide': 'review-submit' }, ['送出互評']);
    form.onsubmit = (e) => {
      e.preventDefault();
      const scores: Record<string, number> = {};
      for (const c of REVIEW_CRITERIA) {
        const v = (form.querySelector(`input[name="score-${c.id}"]:checked`) as HTMLInputElement | null)?.value;
        if (v) scores[c.id] = Number(v);
      }
      if (!feel.value.trim() && !Object.keys(scores).length) {
        note.textContent = '至少勾一個項目，或寫下最有感覺的地方。';
        return;
      }
      reviews.push({ work: w.id, reviewer: reviewer.value.trim(), scores, feel: feel.value.trim(), suggest: suggest.value.trim(), at: Date.now() });
      write(REVIEWS, reviews);
      render();
      msg.textContent = `已收到給《${w.title}》的互評。`;
      msg.classList.add('ok');
    };
    form.append(reviewer, ...scales, el('label', { class: 'g-field' }, [el('span', { class: 'g-field-label' }, [REVIEW_PROMPTS.feel]), feel]), el('label', { class: 'g-field' }, [el('span', { class: 'g-field-label' }, [REVIEW_PROMPTS.suggest]), suggest]), el('div', { class: 'g-actions' }, [submit]), note);
    return el('details', { class: 'g-review' }, [el('summary', {}, ['填互評表（先說感受，再說建議）']), form]);
  }

  function summaryText(w: ShowcaseWork): string {
    const s = reviewSummary(w.id, reviews);
    if (!s.count) return '還沒有互評';
    const avg = REVIEW_CRITERIA.map((c) => (s.avg[c.id] === null ? '' : `${c.label} ${s.avg[c.id]}`)).filter(Boolean);
    return `${s.count} 份互評${avg.length ? `・平均（1～3）：${avg.join('、')}` : ''}`;
  }

  function render(): void {
    list.replaceChildren(
      ...(works.length
        ? works.map((w, i) => {
            const group = el('input', { type: 'text', name: 'showcase-group', placeholder: '組別' });
            group.value = w.group;
            group.oninput = () => {
              w.group = group.value;
              write(WORKS, works);
            };
            const play = el('a', { class: 'g-btn primary', href: gameHref({ showcase: w.id }), 'data-guide': 'showcase-play' }, ['開始玩']);
            play.onclick = () => {
              current = w.id;
              write(CURRENT, current);
            };
            const remove = el('button', { type: 'button', class: 'g-btn' }, ['移除']);
            remove.onclick = async () => {
              if (!confirm(`移除《${w.title}》？`)) return;
              await BrowserProjectStore.drop(showcaseDb(w.id));
              works = works.filter((x) => x.id !== w.id);
              reviews = reviews.filter((r) => r.work !== w.id);
              if (current === w.id) current = works[0]?.id ?? '';
              write(WORKS, works);
              write(REVIEWS, reviews);
              write(CURRENT, current);
              render();
            };
            return el('section', { class: `g-section g-show-item${w.id === current ? ' current' : ''}`, 'data-work': w.id }, [
              el('p', { class: 'g-kicker' }, [w.id === current ? `第 ${i + 1} 個・現在輪到這一組` : `第 ${i + 1} 個`]),
              el('h3', {}, [`《${w.title}》`]),
              el('div', { class: 'g-row' }, [group, el('span', { class: 'g-meta' }, [w.file])]),
              el('div', { class: 'g-actions' }, [play, remove]),
              el('p', { class: 'g-meta', 'data-guide': 'review-summary' }, [summaryText(w)]),
              reviewForm(w),
            ]);
          })
        : [el('p', { class: 'g-meta' }, ['還沒有作品。'])]),
    );
    // 紙本互評表：每個作品一張（只在列印時出現）
    papers.replaceChildren(
      ...works.map((w) =>
        el('section', { class: 'g-review-paper' }, [
          el('h2', {}, [`互評表：《${w.title}》${w.group ? `（${w.group}）` : ''}`]),
          el('p', {}, ['評的人或組別：＿＿＿＿＿＿＿＿']),
          el('table', {}, [
            el('tr', {}, [el('th', {}, ['項目']), el('th', {}, ['1']), el('th', {}, ['2']), el('th', {}, ['3'])]),
            ...REVIEW_CRITERIA.map((c) => el('tr', {}, [el('td', {}, [c.label]), ...c.levels.map((l) => el('td', {}, [`□ ${l}`]))])),
          ]),
          el('p', {}, [REVIEW_PROMPTS.feel]),
          el('div', { class: 'g-paper-lines' }),
          el('p', {}, [REVIEW_PROMPTS.suggest]),
          el('div', { class: 'g-paper-lines' }),
        ]),
      ),
    );
  }

  render();
  root.replaceChildren(
    el('div', { class: 'g-showcase' }, [
      el('nav', { class: 'g-crumbs' }, [el('a', { href: '#/' }, ['← 回首頁']), el('a', { href: '#/teacher' }, ['老師工作台'])]),
      el('section', { class: 'g-section' }, [
        el('h1', {}, ['班級展示']),
        el('p', {}, ['把各組交來的專案檔（.vnproj）一次載入，輪流在大螢幕上玩。每個作品都可以填互評表：', el('strong', {}, ['先說感受，再說建議']), '。']),
        el('ol', { class: 'g-howto' }, [
          el('li', {}, ['各組在第 9 步「匯出專案檔」，交給老師。']),
          el('li', {}, ['在這裡載入全部的專案檔（可以一次選很多個）。']),
          el('li', {}, ['按「開始玩」；玩完用瀏覽器的「上一頁」回來，填互評表，按「下一組」。']),
          el('li', {}, ['最後「下載互評結果」，或課前「列印紙本互評表」發給各組。']),
        ]),
        el('label', { class: 'g-field' }, [el('span', { class: 'g-field-label' }, ['載入專案檔']), files]),
        el('div', { class: 'g-actions' }, [next, download, print, clear]),
        msg,
        el('p', { class: 'g-meta' }, ['作品與互評只存在這台電腦的瀏覽器裡，不會送到任何地方；學生自己的專案不受影響。']),
      ]),
      list,
    ]),
    papers,
  );
}
