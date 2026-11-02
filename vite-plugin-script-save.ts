// 開發模式專用：讓瀏覽器裡的文字編輯器把修改寫回 public/script.json。
// 只接受「只改文字、沒改結構」的腳本；正式建置不包含這個端點（線上版改成下載檔案）。
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { formatScript, structureOf } from './src/editable.ts';
import type { Script } from './src/types.ts';

export const SAVE_ENDPOINT = '/__editor/save-script';

export interface SaveResult {
  status: number;
  body: { ok: boolean; message: string };
}

/** 檢查並寫入。另外匯出給測試直接呼叫。 */
export async function saveScript(file: string, text: string): Promise<SaveResult> {
  let incoming: Script;
  try {
    incoming = JSON.parse(text) as Script;
  } catch {
    return { status: 400, body: { ok: false, message: '收到的內容不是合法的 JSON' } };
  }
  let current: Script;
  try {
    current = JSON.parse(await readFile(file, 'utf8')) as Script;
  } catch (err) {
    return { status: 500, body: { ok: false, message: `讀不到 ${file}：${(err as Error).message}` } };
  }
  if (structureOf(incoming) !== structureOf(current)) {
    return {
      status: 409,
      body: { ok: false, message: '腳本結構和磁碟上的 script.json 不同（可能在別處改過檔案），為了安全沒有寫入。請重新整理後再編輯。' },
    };
  }
  await writeFile(file, formatScript(incoming), 'utf8');
  return { status: 200, body: { ok: true, message: `已寫入 ${file}` } };
}

export function scriptSavePlugin(): Plugin {
  let file = '';
  return {
    name: 'dementia-script-save',
    apply: 'serve',
    configResolved(config) {
      // 測試時可以用環境變數改寫入位置，避免動到真正的腳本
      file = process.env.SCRIPT_SAVE_PATH ?? resolve(config.publicDir, 'script.json');
    },
    configureServer(server) {
      server.middlewares.use(SAVE_ENDPOINT, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          void saveScript(file, Buffer.concat(chunks).toString('utf8')).then(({ status, body }) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(body));
          });
        });
      });
    },
  };
}
