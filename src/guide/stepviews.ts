// 引導流程九個步驟的畫面（需求書 5.2）。每個需要 AI 的步驟：提示詞（一鍵複製）→ 貼回 AI 的回答 → 檢查 → 通過才能下一步。
import { assetCatalog, KIND_LABEL } from '../assetcatalog';
import { ASSET_KINDS } from '../assetnames';
import { checkPastedScript, checkScript, hasBlocking } from '../checks';
import { copyText } from '../clipboard';
import { FILE_MODE } from '../embed';
import { issueSummary, renderIssues } from '../issueview';
import { type Pack } from '../pack';
import { listPacks, loadPack, loadPackDocs } from '../packloader';
import { exportPlayable } from '../exporter';
import { downloadBlob } from '../project';
import { packProject, projectFileName } from '../projectfile';
import type { Script } from '../types';
import { el } from '../util';
import { registerStep, type StepContext } from './guide';
import { gameHref } from './links';
import { DESIGN_CHECKLIST, LENGTH_TEXT, promptFor, type Answers, type Length, type ThemeAnswer } from './prompts';

const answersOf = (ctx: StepContext) => ctx.state.answers as Answers;

/** 延遲存檔：連續打字時不要每個字都寫一次。 */
function debounce(fn: () => void, ms = 400): () => void {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
}

function copyButton(label: string, text: () => string, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'g-btn', ...attrs }, [label]);
  b.onclick = () =>
    void copyText(text()).then((ok) => {
      b.textContent = ok ? '已複製，去貼給 AI 吧' : '複製失敗，請手動選取上面的文字';
      window.setTimeout(() => (b.textContent = label), 2000);
    });
  return b;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el('label', { class: 'g-field' }, [el('span', { class: 'g-field-label' }, [label]), control, ...(hint ? [el('small', {}, [hint])] : [])]);
}

/** 題材包與說明文件（每一步的提示詞都要用）。 */
async function packFor(ctx: StepContext): Promise<{ pack: Pack; docs: Record<string, string> }> {
  const id = answersOf(ctx).theme?.pack ?? ctx.project.script.meta.pack ?? 'dementia';
  const packId = id === null ? 'plain' : String(id);
  const [pack, docs] = await Promise.all([loadPack(packId), loadPackDocs(packId)]);
  return { pack, docs };
}

function offlineNote(): HTMLElement | null {
  if (!FILE_MODE && navigator.onLine) return null;
  return el('p', { class: 'g-offline' }, ['目前沒有網路（或是離線版）：提示詞照樣可以複製，請到有網路的地方貼給 AI，再把回答帶回來貼上。']);
}

// ───────── 1. 選題材包與主題 ─────────

registerStep('theme', (ctx) => {
  const a = answersOf(ctx);
  const t: ThemeAnswer = (a.theme ??= {
    title: ctx.project.script.meta.title ?? '',
    pack: (ctx.project.script.meta.pack as string | undefined) ?? 'plain',
    goal: '',
    length: 'short',
  });
  const title = el('input', { type: 'text', name: 'guide-title', placeholder: '例如：寫給未來的我' });
  title.value = t.title;
  const goal = el('textarea', { name: 'guide-goal', rows: '3', placeholder: '例如：讓玩家體會「知道自己正在忘記」是什麼感覺，以及身邊的人有多努力。' });
  goal.value = t.goal;
  const audience = el('input', { type: 'text', name: 'guide-audience', placeholder: '例如：國中生、照顧者家屬、醫護人員（可以空白）' });
  audience.value = t.audience ?? '';
  const packs = el('div', { class: 'g-radios', 'data-guide': 'packs-choice' }, ['讀取中…']);
  const lengths = el('div', { class: 'g-radios' }, (['short', 'full'] as Length[]).map((len) => {
    const r = el('input', { type: 'radio', name: 'guide-length', value: len });
    r.checked = t.length === len;
    r.onchange = () => {
      t.length = len;
      changed();
    };
    return el('label', { class: 'g-radio' }, [r, LENGTH_TEXT[len]]);
  }));

  const update = () => {
    ctx.setReady(!!t.title.trim() && !!t.goal.trim(), '請先填作品名稱和「想讓玩家體會的事」。');
  };
  const persist = debounce(() => {
    void ctx.save();
    void ctx.applyScript(ctx.project.script);
  });
  const changed = () => {
    // 名稱與題材包立刻改進專案（換頁時上方就會顯示新名稱）；寫進儲存空間稍後一起做
    const script = ctx.project.script;
    script.meta.title = t.title.trim() || script.meta.title;
    script.meta.pack = t.pack;
    update();
    persist();
  };
  title.oninput = () => {
    t.title = title.value;
    changed();
  };
  goal.oninput = () => {
    t.goal = goal.value;
    changed();
  };
  audience.oninput = () => {
    t.audience = audience.value;
    changed();
  };
  void listPacks().then((list) => {
    packs.replaceChildren(
      ...list.map((p) => {
        const r = el('input', { type: 'radio', name: 'guide-pack', value: p.id });
        r.checked = t.pack === p.id;
        r.onchange = () => {
          t.pack = p.id;
          changed();
        };
        return el('label', { class: 'g-radio' }, [r, el('strong', {}, [p.name]), ` ${p.description}`]);
      }),
    );
  });
  update();
  return el('div', { class: 'g-form' }, [
    field('作品名稱', title),
    field('題材包（處境）', packs, '題材包決定可以用哪些介面效果，也會把寫作準則與注意事項放進之後的提示詞。'),
    field('想讓玩家體會的事（一句話）', goal, '之後每一步都會拿這句話來檢查。'),
    field('長度', lengths),
    field('給誰玩', audience),
  ]);
});

// ───────── 2～6. 需要 AI 的步驟 ─────────

interface AiStepOptions {
  key: 'directions' | 'outline' | 'design' | 'art';
  pasteLabel: string;
  placeholder: string;
  /** 額外的欄位（放在貼上區後面）。 */
  extra?: (ctx: StepContext, update: () => void) => HTMLElement;
  /** 可以進下一步嗎？回傳 null＝可以，字串＝原因。 */
  check: (ctx: StepContext) => string | null;
  /** 提示詞前面的欄位（例如畫風），改了會重新產生提示詞。 */
  before?: (ctx: StepContext, regenerate: () => void) => HTMLElement;
}

function aiStep(ctx: StepContext, o: AiStepOptions): HTMLElement {
  const a = answersOf(ctx) as Record<string, { raw?: string } | undefined>;
  const prompt = el('pre', { class: 'g-prompt', 'data-guide': 'prompt' }, ['產生中…']);
  let promptText = '';
  const regenerate = () =>
    void packFor(ctx).then(({ pack, docs }) => {
      promptText = promptFor(ctx.step.id, { answers: answersOf(ctx), pack, docs, script: ctx.project.script }) ?? '';
      prompt.textContent = promptText;
    });
  regenerate();
  const paste = el('textarea', { name: 'guide-paste', rows: '10', placeholder: o.placeholder, spellcheck: 'false' });
  paste.value = a[o.key]?.raw ?? '';
  const status = el('p', { class: 'g-status', 'data-guide': 'status', 'aria-live': 'polite' });
  const update = () => {
    const why = o.check(ctx);
    status.textContent = why ? '' : '✓ 可以進下一步了';
    status.classList.toggle('ok', !why);
    ctx.setReady(!why, why ?? undefined);
  };
  const persist = debounce(() => void ctx.save());
  paste.oninput = () => {
    const slot = (a[o.key] ??= { raw: '' }) as { raw: string };
    slot.raw = paste.value;
    update();
    persist();
  };
  const note = offlineNote();
  const box = el('div', { class: 'g-form' }, [
    ...(o.before ? [o.before(ctx, regenerate)] : []),
    el('h3', {}, ['① 複製這段提示詞，貼給任何 AI（例如 ChatGPT、Claude、Gemini）']),
    ...(note ? [note] : []),
    prompt,
    el('div', { class: 'g-actions' }, [copyButton('複製提示詞', () => promptText, { 'data-guide': 'copy-prompt' })]),
    el('h3', {}, [`② ${o.pasteLabel}`]),
    paste,
    ...(o.extra ? [o.extra(ctx, () => update())] : []),
    status,
  ]);
  update();
  return box;
}

registerStep('directions', (ctx) =>
  aiStep(ctx, {
    key: 'directions',
    pasteLabel: '把 AI 寫的三個方向貼在這裡',
    placeholder: '整段貼上 AI 的回答。',
    extra: (c, update) => {
      const a = answersOf(c);
      const chosen = el('textarea', { name: 'guide-chosen', rows: '5', placeholder: '把你選的方向貼在這裡，或寫下怎麼混合（例如：用方向一的主角、方向三的結局）。' });
      chosen.value = a.directions?.chosen ?? '';
      const persist = debounce(() => void c.save());
      chosen.oninput = () => {
        (a.directions ??= { raw: '', chosen: '' }).chosen = chosen.value;
        update();
        persist();
      };
      return field('③ 你選的方向（或混合）', chosen, '下一步的提示詞會用這一段。');
    },
    check: (c) => {
      const d = answersOf(c).directions;
      if (!d?.raw?.trim()) return '請先把 AI 的回答貼上來。';
      if (!d.chosen?.trim()) return '請寫下你選的方向。';
      return null;
    },
  }),
);

registerStep('outline', (ctx) =>
  aiStep(ctx, {
    key: 'outline',
    pasteLabel: '把 AI 寫的分場大綱貼在這裡（可以自己修改）',
    placeholder: '整段貼上，或貼上後直接修改。',
    check: (c) => ((answersOf(c).outline?.raw?.trim().length ?? 0) < 20 ? '請先把分場大綱貼上來。' : null),
  }),
);

registerStep('design', (ctx) =>
  aiStep(ctx, {
    key: 'design',
    pasteLabel: '把 AI 做的設計表貼在這裡（可以自己修改）',
    placeholder: '整段貼上，或貼上後直接修改。',
    extra: (c) => {
      const a = answersOf(c);
      const checks = new Set(a.design?.checks ?? []);
      const persist = debounce(() => void c.save());
      return el('div', { class: 'g-checklist' }, [
        el('h3', {}, ['③ 自我檢查（打勾不是必要的，但每一條都值得想一下）']),
        ...DESIGN_CHECKLIST.map((item) => {
          const box = el('input', { type: 'checkbox', name: 'guide-check' });
          box.checked = checks.has(item);
          box.onchange = () => {
            if (box.checked) checks.add(item);
            else checks.delete(item);
            (a.design ??= { raw: '' }).checks = [...checks];
            persist();
          };
          return el('label', { class: 'g-radio' }, [box, item]);
        }),
      ]);
    },
    check: (c) => ((answersOf(c).design?.raw?.trim().length ?? 0) < 20 ? '請先把設計表貼上來。' : null),
  }),
);

// ───────── 5. 完整劇本 ─────────

registerStep('script', (ctx) => {
  const a = answersOf(ctx);
  const draft = { raw: '' };
  const prompt = el('pre', { class: 'g-prompt', 'data-guide': 'prompt' }, ['產生中…']);
  let promptText = '';
  let pack: Pack | null = null;
  void packFor(ctx).then((p) => {
    pack = p.pack;
    promptText = promptFor('script', { answers: a, pack: p.pack, docs: p.docs, script: ctx.project.script }) ?? '';
    prompt.textContent = promptText;
  });
  const paste = el('textarea', { name: 'guide-paste', rows: '12', placeholder: '把 AI 寫的劇本（script.json）整段貼在這裡。前後有說明文字也沒關係。', spellcheck: 'false' });
  const result = el('div', { class: 'g-result', 'data-guide': 'result', 'aria-live': 'polite' });
  const applied = el('p', { class: 'g-status ok', 'data-guide': 'applied' });
  const showApplied = () => {
    applied.hidden = !a.script?.applied;
    applied.textContent = a.script?.applied ? `✓ 已套用《${a.script.title ?? ctx.project.script.meta.title}》到你的專案（${ctx.project.script.scenes.length} 個場景）。可以進下一步，也可以貼上新版本再檢查。` : '';
    ctx.setReady(!!a.script?.applied, '請先貼上劇本、檢查通過並「套用到我的專案」。');
  };
  const check = el('button', { type: 'button', class: 'g-btn primary', 'data-guide': 'check' }, ['檢查']);
  check.onclick = () => {
    draft.raw = paste.value;
    const r = checkPastedScript(paste.value, pack ?? undefined);
    if (!r.ok) {
      result.replaceChildren(
        el('p', { class: 'g-warn' }, [r.error]),
        el('p', {}, ['請 AI 重新輸出。可以把這段提示詞貼給它：']),
        el('pre', { class: 'g-prompt' }, [r.prompt]),
        copyButton('複製提示詞', () => r.prompt),
      );
      return;
    }
    const blocking = hasBlocking(r.issues);
    const apply = el('button', { type: 'button', class: 'g-btn primary', 'data-guide': 'apply' }, ['套用到我的專案']);
    apply.disabled = blocking;
    apply.onclick = async () => {
      const script: Script = r.script;
      if (a.theme?.title && !script.meta.title) script.meta.title = a.theme.title;
      await ctx.applyScript(script);
      a.script = { applied: true, title: script.meta.title };
      await ctx.save();
      result.replaceChildren();
      showApplied();
    };
    result.replaceChildren(
      ...(r.note ? [el('p', { class: 'g-meta' }, [r.note])] : []),
      el('p', {}, [`《${r.script.meta.title ?? '未命名'}》：${r.script.scenes.length} 個場景，${issueSummary(r.issues)}。`]),
      renderIssues(r.issues),
      el('p', { class: 'g-meta' }, [blocking ? '還有「必須修正」的問題：按上面的「複製請 AI 修正的提示詞」貼給 AI，把修好的劇本再貼回來。' : '檢查通過，可以套用了（會取代專案裡目前的劇本）。']),
      apply,
    );
  };
  const note = offlineNote();
  showApplied();
  return el('div', { class: 'g-form' }, [
    el('h3', {}, ['① 複製這段提示詞，貼給 AI']),
    ...(note ? [note] : []),
    prompt,
    el('div', { class: 'g-actions' }, [copyButton('複製提示詞', () => promptText, { 'data-guide': 'copy-prompt' })]),
    el('h3', {}, ['② 把 AI 寫的劇本貼回來檢查']),
    paste,
    el('div', { class: 'g-actions' }, [check]),
    result,
    applied,
  ]);
});

// ───────── 6. 美術需求 ─────────

registerStep('art', (ctx) =>
  aiStep(ctx, {
    key: 'art',
    pasteLabel: '把 AI 寫的美術說明與提示詞表貼在這裡（之後找人畫或生圖時用）',
    placeholder: '整段貼上。',
    before: (c, regenerate) => {
      const a = answersOf(c);
      const style = el('input', { type: 'text', name: 'guide-style', placeholder: '例如：淡彩手繪、溫暖的光、線條簡單（可以空白，請 AI 建議）' });
      style.value = a.art?.style ?? '';
      const persist = debounce(() => {
        void c.save();
        regenerate();
      }, 600);
      style.oninput = () => {
        (a.art ??= { raw: '', style: '' }).style = style.value;
        persist();
      };
      return field('想要的畫風', style);
    },
    extra: (c) => {
      const download = el('button', { type: 'button', class: 'g-btn', 'data-guide': 'download-art' }, ['下載成文字檔']);
      download.onclick = () => {
        const text = answersOf(c).art?.raw ?? '';
        downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${c.project.script.meta.title || '遊戲'}-美術需求.txt`);
      };
      return el('div', { class: 'g-actions' }, [download]);
    },
    check: (c) => ((answersOf(c).art?.raw?.trim().length ?? 0) < 10 ? '請先把美術說明貼上來（不需要圖的話，可以按「先跳過」）。' : null),
  }),
);

// ───────── 7. 素材 ─────────

registerStep('assets', (ctx) => {
  const items = assetCatalog(ctx.project.script);
  const counts = ASSET_KINDS.map((k) => [k, items.filter((x) => x.kind === k).length] as const).filter(([, n]) => n > 0);
  const local = ctx.project.files.size;
  ctx.setReady(true);
  return el('div', { class: 'g-form' }, [
    el('p', {}, [`你的劇本需要：${counts.map(([k, n]) => `${KIND_LABEL[k]} ${n} 個`).join('、') || '（還沒有劇本）'}。目前專案裡已上傳 ${local} 個檔案。`]),
    el('p', {}, ['沒有素材也能玩：圖片會用佔位圖、音樂用合成音、配音和音效先不出聲。素材可以之後慢慢補。']),
    el('div', { class: 'g-actions' }, [
      el('a', { class: 'g-btn primary', href: gameHref({ story: 'assets' }), 'data-guide': 'open-assets' }, ['打開素材頁（上傳或看還缺什麼）']),
    ]),
    el('p', { class: 'g-meta' }, ['素材頁會列出每個素材用在哪裡、要畫什麼、建議規格，每一個都可以直接上傳。上傳的檔案存在本機專案裡。']),
  ]);
});

// ───────── 8. 試玩與修改 ─────────

registerStep('playtest', (ctx) => {
  const result = el('div', { class: 'g-result' }, ['檢查中…']);
  void packFor(ctx).then(({ pack }) => {
    const issues = checkScript(ctx.project.script, pack);
    const blocking = hasBlocking(issues);
    result.replaceChildren(el('p', {}, [`劇本檢查：${issueSummary(issues)}。`]), renderIssues(issues));
    ctx.setReady(!blocking, '劇本還有「必須修正」的問題，請先在故事編輯器修好（或貼給 AI 修正）。');
  });
  ctx.setReady(false, '檢查中…');
  return el('div', { class: 'g-form' }, [
    el('div', { class: 'g-actions' }, [
      el('a', { class: 'g-btn primary', href: gameHref({}), 'data-guide': 'play' }, ['從頭試玩']),
      el('a', { class: 'g-btn', href: gameHref({ story: '1' }) }, ['打開故事編輯器']),
    ]),
    el('h3', {}, ['試玩時看看']),
    el('ul', {}, [
      el('li', {}, ['每一個結局都走得到嗎？（故事編輯器的「結局」分頁可以看條件）']),
      el('li', {}, ['第一幕夠正常嗎？崩壞有沒有逐漸加重？']),
      el('li', {}, ['每個選擇都有意義嗎？玩家會不會不知道自己在選什麼？']),
      el('li', {}, ['效果會不會太多、太頻繁？']),
      el('li', {}, ['找一個沒看過的人玩，他在哪裡卡住、在哪裡有感覺？']),
    ]),
    result,
  ]);
});

// ───────── 9. 匯出與發佈 ─────────

registerStep('publish', (ctx) => {
  const msg = el('p', { class: 'g-status', 'aria-live': 'polite' });
  const exportProject = el('button', { type: 'button', class: 'g-btn primary', 'data-guide': 'export-project' }, ['匯出專案檔（.vnproj）']);
  exportProject.onclick = async () => {
    const blob = await packProject({ script: ctx.project.script, files: ctx.project.files });
    const name = projectFileName(ctx.project.script.meta.title ?? '');
    downloadBlob(blob, name);
    msg.textContent = `已下載 ${name}。換電腦或給別人繼續編輯時，用遊戲頁開發者面板的「開啟專案檔」。`;
  };
  const playMsg = el('p', { class: 'g-status', 'data-guide': 'play-status', 'aria-live': 'polite' });
  const exportPlay = el('button', { type: 'button', class: 'g-btn primary', 'data-guide': 'export-playable' }, ['匯出可以玩的版本（.zip）']);
  exportPlay.onclick = async () => {
    exportPlay.disabled = true;
    playMsg.textContent = '打包中…';
    try {
      const r = await exportPlayable(ctx.project.script, ctx.project.files);
      downloadBlob(r.blob, r.fileName);
      playMsg.textContent = `已下載 ${r.fileName}（${r.files} 個素材）。${r.note}`;
    } catch (err) {
      playMsg.textContent = `沒有成功：${(err as Error)?.message ?? err}`;
    }
    exportPlay.disabled = false;
  };
  ctx.setReady(true);
  return el('div', { class: 'g-form' }, [
    el('h3', {}, ['專案檔：之後繼續編輯']),
    el('p', {}, ['把劇本和你上傳的素材裝在一個檔案裡，存在電腦或雲端硬碟。這個瀏覽器的資料被清掉時，可以用它找回來。']),
    el('div', { class: 'g-actions' }, [exportProject]),
    msg,
    el('h3', {}, ['可以玩的版本：給別人玩']),
    el('p', {}, ['一個壓縮檔：解壓縮後雙擊 html 就能玩（不需要網路），也可以整個放到學校、單位的網站或 GitHub Pages。']),
    el('div', { class: 'g-actions' }, [exportPlay]),
    playMsg,
    el('h3', {}, ['發佈到 GitHub Pages（免費、不用寫程式）']),
    el('ol', { class: 'g-howto' }, [
      el('li', {}, ['按上面的「匯出可以玩的版本」，下載後先解壓縮。']),
      el('li', {}, ['到 github.com 註冊帳號（免費）。']),
      el('li', {}, ['按右上角「＋」→ New repository，名稱用英文（例如 my-game），選 Public，按 Create repository。']),
      el('li', {}, ['按 uploading an existing file，把解壓縮後資料夾「裡面」的所有檔案和 game 資料夾一起拖進去，按 Commit changes。']),
      el('li', {}, ['到 Settings → Pages：Source 選 Deploy from a branch，Branch 選 main、資料夾選 / (root)，按 Save。']),
      el('li', {}, ['等一兩分鐘，Pages 設定頁上方會出現網址（https://帳號.github.io/my-game/），打開就能玩。']),
    ]),
    el('p', { class: 'g-meta' }, ['之後要更新：重新匯出、解壓縮，再上傳一次覆蓋。完整說明與常見問題見 docs/publish-github-pages.md。']),
  ]);
});
