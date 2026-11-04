// 問卷畫面：玩前、玩後各一頁，可以略過。回答交給呼叫的人存。
import { scaleRange, type Answers, type Survey, type SurveyQuestion } from './survey';
import { el } from './util';

/** 在 parent 上蓋一頁問卷。送出或略過後移除，回傳回答（略過＝null）。 */
export function showSurveyForm(parent: HTMLElement, survey: Survey, part: 'pre' | 'post'): Promise<Answers | null> {
  const questions = survey[part] ?? [];
  return new Promise((resolve) => {
    const form = el('form', { class: 'survey-form', 'data-survey': part });
    const items = questions.map((q, i) => question(q, i));
    const error = el('p', { class: 'survey-error', role: 'alert' });
    const submit = el('button', { type: 'submit', class: 'start-button', 'data-survey-action': 'submit' }, ['送出']);
    const skip = el('button', { type: 'button', class: 'credits-button', 'data-survey-action': 'skip' }, [part === 'pre' ? '略過，直接開始' : '略過']);
    form.append(
      el('h2', {}, [survey.title || (part === 'pre' ? '開始之前' : '玩完之後')]),
      el('p', { class: 'survey-part' }, [part === 'pre' ? '玩之前的幾個問題' : '玩之後的幾個問題']),
      ...(survey.intro ? [el('p', { class: 'survey-intro' }, [survey.intro])] : []),
      ...items.map((x) => x.node),
      error,
      el('div', { class: 'survey-actions' }, [submit, skip]),
    );
    const screen = el('div', { class: 'screen survey-screen open', role: 'dialog', 'aria-label': '問卷' }, [form]);
    const done = (answers: Answers | null) => {
      screen.remove();
      resolve(answers);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const answers: Answers = {};
      const missing: string[] = [];
      items.forEach((x, i) => {
        const v = x.value();
        if (v === null || v === '') {
          if (questions[i].required) missing.push(String(i + 1));
          return;
        }
        answers[questions[i].id] = v;
      });
      if (missing.length) {
        error.textContent = `第 ${missing.join('、')} 題還沒回答。`;
        return;
      }
      done(answers);
    });
    skip.addEventListener('click', (e) => {
      e.stopPropagation();
      done(null);
    });
    screen.addEventListener('click', (e) => e.stopPropagation());
    screen.addEventListener('keydown', (e) => e.stopPropagation());
    parent.append(screen);
    form.querySelector<HTMLElement>('input, textarea, button')?.focus();
  });
}

function question(q: SurveyQuestion, i: number): { node: HTMLElement; value: () => string | number | null } {
  const name = `survey-${q.id}`;
  const title = el('legend', {}, [`${i + 1}. ${q.text}${q.required ? '（必答）' : ''}`]);
  if (q.type === 'text') {
    const input = el('textarea', { name, rows: '2', maxlength: '500' });
    return { node: el('fieldset', { class: 'survey-q', 'data-q': q.id }, [title, input]), value: () => input.value.trim() };
  }
  const [min, max] = q.type === 'scale' ? scaleRange(q) : [0, 0];
  const choices: { label: string; value: string | number }[] =
    q.type === 'scale'
      ? Array.from({ length: max - min + 1 }, (_, k) => ({ label: String(min + k), value: min + k }))
      : (q.options ?? []).map((o) => ({ label: o, value: o }));
  const radios = choices.map((c) => {
    const r = el('input', { type: 'radio', name, value: String(c.value) });
    return { r, c, node: el('label', { class: 'survey-option' }, [r, el('span', {}, [c.label])]) };
  });
  const row = el('div', { class: `survey-options ${q.type}` }, radios.map((x) => x.node));
  const ends =
    q.type === 'scale' && (q.minLabel || q.maxLabel)
      ? [el('div', { class: 'survey-ends' }, [el('span', {}, [q.minLabel ?? '']), el('span', {}, [q.maxLabel ?? ''])])]
      : [];
  return {
    node: el('fieldset', { class: 'survey-q', 'data-q': q.id }, [title, row, ...ends]),
    value: () => {
      const hit = radios.find((x) => x.r.checked);
      return hit ? hit.c.value : null;
    },
  };
}
