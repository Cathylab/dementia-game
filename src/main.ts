import './style.css';
import { AudioEngine } from './audio';
import { DevPanel } from './devpanel';
import { TextEditor } from './editor';
import { Engine } from './engine';
import { EMBED, embeddedScript } from './embed';
import { Guide } from './guide/guide';
import './guide/stepviews';
import './guide/gridview';
import './guide/inquiry';
import './guide/drawings';
import { GAME_PARAMS, gameHref } from './guide/links';
import { projectDir, scriptUrl } from './paths';
import { loadScript } from './script';
import { currentPack, packIdOf, setCurrentPack } from './pack';
import { loadPack } from './packloader';
import { ProjectSession, reloadWithProject } from './project';
import { BrowserProjectStore } from './projectstore';
import { showcaseDb } from './guide/review';
import { StoryEditor } from './storyeditor';
import { applyScriptDefaults, settings } from './settings';
import { el, urlParam } from './util';
import { AdvView } from './view';
import { VoiceDesk } from './voicedesk';

/** 這一頁是引導網站還是遊戲：離線版看內嵌資料，線上版看 <html data-page>。 */
function currentPage(): 'guide' | 'game' {
  return EMBED?.page ?? (document.documentElement.dataset.page === 'guide' ? 'guide' : 'game');
}

async function bootGuide() {
  const app = document.getElementById('app')!;
  // 以前分享的連結（首頁加 ?dev=1 等）轉到遊戲頁
  const params = new URLSearchParams(location.search);
  if (GAME_PARAMS.some((k) => params.has(k))) {
    location.replace(gameHref(Object.fromEntries(params), false) + location.hash);
    return;
  }
  document.title = '開始做你的遊戲｜同理體驗視覺小說';
  const guide = new Guide(app, new BrowserProjectStore());
  (window as unknown as { __guide: unknown }).__guide = guide;
  await guide.start();
}

/**
 * 試玩片段（引導網站首頁用）：?clip=場景代號&from=第幾句。
 * 按「開始」直接從那裡開始，離開這個場景時顯示「片段結束」。
 */
function setupClip(engine: Engine, view: AdvView): void {
  const clip = urlParam('clip');
  if (!clip || !engine.getScene(clip)) return;
  const from = Math.max(0, Number(urlParam('from')) || 0);
  view.titleNote = '試玩片段（約 1 分鐘）';
  const start = engine.start.bind(engine);
  engine.start = (sceneId?: string, index = 0) => start(sceneId ?? clip, sceneId ? index : from);
  const goto = engine.gotoScene.bind(engine);
  const end = el('div', { class: 'clip-end', 'data-clip': 'end' });
  view.stage.append(end);
  engine.gotoScene = async (id: string, opts: { restoring?: boolean; index?: number } = {}) => {
    if (id === clip || opts.restoring) return goto(id, opts);
    engine.phase = 'busy';
    view.audio?.stopVoice();
    const again = el('button', { type: 'button', class: 'start-button' }, ['再玩一次']);
    again.onclick = (e) => {
      e.stopPropagation();
      end.classList.remove('open');
      void engine.start();
    };
    end.replaceChildren(
      el('p', { class: 'clip-end-title' }, ['片段結束']),
      el('p', {}, ['完整的故事約 16 分鐘，有三個結局。']),
      el('div', { class: 'clip-end-actions' }, [
        again,
        el('a', { class: 'start-button', href: gameHref({ project: projectDir(), site: '1' }), target: '_top' }, ['玩完整版']),
      ]),
    );
    end.onclick = (e) => e.stopPropagation();
    end.classList.add('open');
  };
}

async function boot() {
  if (currentPage() === 'guide') return bootGuide();
  const app = document.getElementById('app')!;
  // 班級展示：?showcase=代號，讀那個作品自己的資料庫（不動到這台電腦上自己的專案）
  const showcase = urlParam('showcase');
  const store = new BrowserProjectStore(showcase ? showcaseDb(showcase) : undefined);
  let session: ProjectSession | null = null;
  try {
    // 預設永遠是網站上的原版；本機專案只在 ?local=1（引導網站的連結會帶）或班級展示時讀
    const useLocal = (!!urlParam('local') || !!showcase) && !urlParam('site') && !EMBED?.player;
    const started = await ProjectSession.start(store, () => embeddedScript(projectDir()) ?? loadScript(scriptUrl()), !useLocal);
    session = started.session;
    const script = started.script;
    const packProblems: string[] = [];
    setCurrentPack(await loadPack(packIdOf(script), packProblems));
    for (const p of packProblems) console.warn('[pack]', p);
    document.title = script.meta.title;
    // 開發者頁面「配音總表」：?voice=1
    if (urlParam('voice')) {
      new VoiceDesk(app, script);
      return;
    }
    applyScriptDefaults(script.meta.settingsDefaults);
    const engine = new Engine(script);
    const view = new AdvView(app, engine);
    view.audio = new AudioEngine(settings.volume, view.stage);
    view.audio.setVoiceVolume(settings.voiceVolume);
    engine.view = view;
    const editor = new TextEditor(engine, view);
    const project = session;
    if (project.mode === 'local') {
      editor.saveToProject = () => project.saveScript(engine.script);
      view.titleNote = showcase ? '班級展示' : `本機專案（存在${store.label}裡）`;
    }
    if (showcase) {
      app.append(el('a', { class: 'showcase-back', href: `${EMBED ? encodeURI('開始.html') : './'}#/showcase`, 'data-guide': 'showcase-back' }, ['← 回班級展示']));
    }
    const story = new StoryEditor(
      engine,
      view,
      () => editor.save(true),
      () => editor.invalidate(),
    );
    const dev = new DevPanel(
      engine,
      view,
      () => editor.open(),
      () => editor.save(),
      project,
      () => story.open(),
    );
    view.onStateChange = () => dev.refresh();
    setupClip(engine, view);
    // 給測試與主控台除錯用
    (window as unknown as { __vn: unknown }).__vn = { engine, view, dev, editor, story, project, get pack() { return currentPack(); } };
    engine.toTitle();
  } catch (err) {
    app.textContent = `載入失敗：${(err as Error).message}`;
    // 本機專案壞掉時要有路可以回去
    if (session?.mode === 'local') {
      const back = document.createElement('button');
      back.type = 'button';
      back.textContent = '關閉本機專案，回到網站版';
      back.onclick = () => void store.clear().then(() => reloadWithProject(false));
      app.append(document.createElement('br'), back);
    }
  }
}

void boot();
