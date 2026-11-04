// 白話檢查結果的畫面：依「必須修正／建議修正」分組，每則可以跳到該場景、複製「請 AI 修正」的提示詞。
// 故事編輯器、開發者面板（之後的引導流程）共用。
import { fixAllPrompt, fixPrompt, LEVEL_LABEL, type Issue } from './checks';
import { copyText } from './clipboard';
import { el } from './util';

export interface IssueViewOptions {
  /** 有提供時，每則問題有「跳到這裡」。 */
  onJump?: (issue: Issue) => void;
  /** 最多顯示幾則（其餘收起來）。 */
  limit?: number;
}

/** 一行摘要，例如「必須修正 2 個、建議修正 3 個」。 */
export function issueSummary(issues: Issue[]): string {
  const errors = issues.filter((x) => x.level === 'error').length;
  const warnings = issues.length - errors;
  if (!issues.length) return '沒有問題';
  return [errors ? `必須修正 ${errors} 個` : '', warnings ? `建議修正 ${warnings} 個` : ''].filter(Boolean).join('、');
}

function copyButton(label: string, text: () => string, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'issue-copy', ...attrs }, [label]);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    void copyText(text()).then((ok) => {
      b.textContent = ok ? '已複製' : '複製失敗，請手動選取';
      window.setTimeout(() => (b.textContent = label), 1500);
    });
  });
  return b;
}

export function renderIssues(issues: Issue[], opts: IssueViewOptions = {}): HTMLElement {
  const root = el('div', { class: 'issues' });
  if (!issues.length) {
    root.append(el('p', { class: 'issues-ok' }, ['檢查通過，沒有問題。']));
    return root;
  }
  root.append(
    el('div', { class: 'issues-actions' }, [
      copyButton('複製「全部請 AI 修正」的提示詞', () => fixAllPrompt(issues), { 'data-issue': 'copy-all' }),
    ]),
  );
  const items = issues.map((issue) => {
    const head = el('div', { class: 'issue-head' }, [
      el('span', { class: `issue-level ${issue.level}` }, [LEVEL_LABEL[issue.level]]),
      el('span', { class: 'issue-plain' }, [issue.plain]),
    ]);
    const tools = el('div', { class: 'issue-tools' });
    if (opts.onJump && issue.scene) {
      const jump = el('button', { type: 'button', class: 'issue-jump' }, ['跳到這裡']);
      jump.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onJump!(issue);
      });
      tools.append(jump);
    }
    tools.append(copyButton('複製請 AI 修正的提示詞', () => fixPrompt(issue)));
    return el('li', { class: `issue ${issue.level}`, 'data-level': issue.level }, [
      head,
      el('p', { class: 'issue-fix' }, [issue.fix]),
      el('details', { class: 'issue-tech' }, [el('summary', {}, ['技術訊息']), el('code', {}, [issue.tech])]),
      tools,
    ]);
  });
  const limit = opts.limit ?? Infinity;
  const list = el('ul', { class: 'issue-list' }, items.slice(0, limit));
  root.append(list);
  if (items.length > limit) {
    const more = el('button', { type: 'button', class: 'issue-more' }, [`顯示其餘 ${items.length - limit} 個`]);
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      list.append(...items.slice(limit));
      more.remove();
    });
    root.append(more);
  }
  return root;
}
