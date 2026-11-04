// 引導網站連到遊戲的網址：線上版是 play.html?…；離線版是對應專案的 html（例如「玩 Demo.html」）。
import { EMBED } from '../embed';
import { DEFAULT_PROJECT } from '../paths';

/**
 * 遊戲頁的網址。params 例如 { story: '1' }、{ project: 'templates/空白' }。
 * 遊戲頁預設永遠是網站上的原版；沒指定 project／site／showcase 的連結（引導網站裡「試玩」「打開故事編輯器」）
 * 是要開自己做的本機專案，所以自動加 local=1（ownProject=false 時不加，例如以前分享的連結）。
 */
export function gameHref(params: Record<string, string> = {}, ownProject = true): string {
  const p = { ...params };
  if (ownProject && !('project' in p) && !('site' in p) && !('showcase' in p) && !('local' in p)) p.local = '1';
  let file = 'play.html';
  if (EMBED) {
    const project = p.project ?? DEFAULT_PROJECT;
    file = EMBED.pages?.[project] ?? EMBED.pages?.[DEFAULT_PROJECT] ?? '玩 Demo.html';
    // 離線版每個 html 預設載入自己的專案，網址參數只在不一樣時才需要
    if (EMBED.pages?.[project] === file) delete p.project;
  }
  const q = new URLSearchParams(p).toString();
  return `${encodeURI(file)}${q ? `?${q}` : ''}`;
}

/** 這些網址參數是給遊戲的；首頁收到時轉到遊戲頁（以前分享的連結照樣能用）。 */
export const GAME_PARAMS = ['showcase', 'dev', 'story', 'edit', 'voice', 'project', 'site', 'local', 'timescale', 'clip'];
