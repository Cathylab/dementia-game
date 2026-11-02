import './style.css';
import { AudioEngine } from './audio';
import { DevPanel } from './devpanel';
import { TextEditor } from './editor';
import { Engine } from './engine';
import { loadScript } from './script';
import { applyScriptDefaults, settings } from './settings';
import { urlParam } from './util';
import { AdvView } from './view';
import { VoiceDesk } from './voicedesk';

async function boot() {
  const app = document.getElementById('app')!;
  try {
    const script = await loadScript(`${import.meta.env.BASE_URL}script.json`);
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
    const dev = new DevPanel(
      engine,
      view,
      () => editor.open(),
      () => editor.save(),
    );
    view.onStateChange = () => dev.refresh();
    // 給測試與主控台除錯用
    (window as unknown as { __vn: unknown }).__vn = { engine, view, dev, editor };
    engine.toTitle();
  } catch (err) {
    app.textContent = `載入失敗：${(err as Error).message}`;
  }
}

void boot();
