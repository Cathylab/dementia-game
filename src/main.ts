import './style.css';
import { AudioEngine } from './audio';
import { Engine } from './engine';
import { loadScript } from './script';
import { settings } from './settings';
import { AdvView } from './view';

async function boot() {
  const app = document.getElementById('app')!;
  try {
    const script = await loadScript(`${import.meta.env.BASE_URL}script.json`);
    document.title = script.meta.title;
    const engine = new Engine(script);
    const view = new AdvView(app, engine);
    view.audio = new AudioEngine(settings.volume, view.stage);
    engine.view = view;
    engine.toTitle();
  } catch (err) {
    app.textContent = `載入失敗：${(err as Error).message}`;
  }
}

void boot();
