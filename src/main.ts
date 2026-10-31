import './style.css';
import { Engine } from './engine';
import { loadScript } from './script';
import { BasicView } from './view';

async function boot() {
  const app = document.getElementById('app')!;
  try {
    const script = await loadScript(`${import.meta.env.BASE_URL}script.json`);
    document.title = script.meta.title;
    const engine = new Engine(script);
    engine.view = new BasicView(app, engine);
    engine.toTitle();
  } catch (err) {
    app.textContent = `載入失敗：${(err as Error).message}`;
  }
}

void boot();
