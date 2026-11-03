import './style.css';
import { AudioEngine } from './audio';
import { DevPanel } from './devpanel';
import { TextEditor } from './editor';
import { Engine } from './engine';
import { ProjectSession } from './project';
import { BrowserProjectStore } from './projectstore';
import { StoryEditor } from './storyeditor';
import { applyScriptDefaults, settings } from './settings';
import { urlParam } from './util';
import { AdvView } from './view';
import { VoiceDesk } from './voicedesk';

async function boot() {
  const app = document.getElementById('app')!;
  const store = new BrowserProjectStore();
  let session: ProjectSession | null = null;
  try {
    // 開過專案檔就用瀏覽器裡的專案；網址加 ?site=1 可以暫時略過，看網站原本的遊戲
    const started = await ProjectSession.start(store, `${import.meta.env.BASE_URL}script.json`, !!urlParam('site'));
    session = started.session;
    const script = started.script;
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
      view.titleNote = `本機專案（存在${store.label}裡）`;
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
    // 給測試與主控台除錯用
    (window as unknown as { __vn: unknown }).__vn = { engine, view, dev, editor, story, project };
    engine.toTitle();
  } catch (err) {
    app.textContent = `載入失敗：${(err as Error).message}`;
    // 本機專案壞掉時要有路可以回去
    if (session?.mode === 'local') {
      const back = document.createElement('button');
      back.type = 'button';
      back.textContent = '關閉本機專案，回到網站版';
      back.onclick = () => void store.clear().then(() => location.reload());
      app.append(document.createElement('br'), back);
    }
  }
}

void boot();
