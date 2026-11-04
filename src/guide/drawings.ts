// 簡單素材（需求書 6-7）：手繪拍照上傳（自動去背、裁切、調整大小）與小圖庫。
// 處理好的圖存進本機專案（和素材頁上傳的一樣），遊戲頁直接用得到。
import { assetCatalog, KIND_LABEL, type AssetItem } from '../assetcatalog';
import { galleryBlob, galleryFor, svgUrl } from '../gallery';
import { processPhoto, type PhotoKind } from '../photo';
import { el } from '../util';
import { registerTool, type StepContext } from './guide';

const IMAGE_EXT = ['webp', 'png', 'jpg'];

function existing(ctx: StepContext, kind: PhotoKind, name: string): Blob | undefined {
  for (const ext of IMAGE_EXT) {
    const b = ctx.project.files.get(`${kind}/${name}.${ext}`);
    if (b) return b;
  }
  return undefined;
}

const urls = new WeakMap<Blob, string>();
function blobUrl(b: Blob): string {
  let u = urls.get(b);
  if (!u) {
    u = URL.createObjectURL(b);
    urls.set(b, u);
  }
  return u;
}

async function put(ctx: StepContext, kind: PhotoKind, name: string, blob: Blob, ext: string): Promise<void> {
  const path = `${kind}/${name}.${ext}`;
  // 同名其他副檔名的舊檔不再用（圖片依 webp、png、jpg 的順序找）
  for (const e of IMAGE_EXT) if (e !== ext) ctx.project.files.delete(`${kind}/${name}.${e}`);
  ctx.project.files.set(path, blob);
  await ctx.store.saveFile(path, blob);
}

function row(ctx: StepContext, it: AssetItem): HTMLElement {
  const kind = it.kind as PhotoKind;
  const thumb = el('div', { class: `g-thumb g-thumb-${kind}` });
  const status = el('p', { class: 'g-status', 'data-guide': 'drawing-status', 'aria-live': 'polite' });
  const showThumb = () => {
    const b = existing(ctx, kind, it.name);
    thumb.replaceChildren(b ? el('img', { src: blobUrl(b), alt: it.name }) : el('span', { class: 'g-meta' }, ['還沒有圖（遊戲裡先用佔位圖）']));
    section.classList.toggle('done', !!b);
  };
  const removeBg = el('input', { type: 'checkbox', name: 'drawing-remove-bg' });
  removeBg.checked = true;
  const file = el('input', { type: 'file', name: 'drawing-file', accept: 'image/*' });
  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    status.classList.remove('ok');
    status.textContent = '處理中…';
    try {
      const out = await processPhoto(f, kind, { removeBackground: kind === 'bg' ? false : removeBg.checked });
      await put(ctx, kind, it.name, out.blob, out.ext);
      status.textContent = `已放進專案：${it.name}.${out.ext}（${out.note}）`;
      status.classList.add('ok');
      showThumb();
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
    }
  };
  const controls: HTMLElement[] = [el('label', { class: 'g-field' }, [el('span', { class: 'g-field-label' }, ['上傳照片或圖片']), file])];
  if (kind !== 'bg') controls.push(el('label', { class: 'g-radio' }, [removeBg, '去掉白紙背景（畫在白紙上時勾著）']));
  if (kind === 'bg' || kind === 'fg') {
    const box = el('details', { class: 'g-gallery', 'data-guide': 'gallery' }, [el('summary', {}, ['或從小圖庫選一張'])]);
    box.addEventListener('toggle', () => {
      if (!box.open || box.children.length > 1) return;
      box.append(
        el(
          'div',
          { class: 'g-gallery-grid' },
          galleryFor(kind, it.name).map((g) => {
            const b = el('button', { type: 'button', class: 'g-gallery-item', 'data-gallery': g.id, title: g.title }, [el('img', { src: svgUrl(g), alt: g.title }), el('span', {}, [g.title])]);
            b.onclick = async () => {
              status.textContent = '處理中…';
              try {
                const out = await galleryBlob(g);
                await put(ctx, kind, it.name, out.blob, out.ext);
                status.textContent = `已放進專案：${it.name}.${out.ext}（圖庫：${g.title}）`;
                status.classList.add('ok');
                showThumb();
              } catch (e) {
                status.textContent = e instanceof Error ? e.message : String(e);
              }
            };
            return b;
          }),
        ),
      );
    });
    controls.push(box);
  }
  const section = el('div', { class: 'g-drawing', 'data-drawing': `${kind}/${it.name}` }, [
    thumb,
    el('div', { class: 'g-drawing-body' }, [
      el('h4', {}, [`${KIND_LABEL[it.kind]}：${it.name}`]),
      el('p', { class: 'g-meta' }, [it.description || '（劇本沒有描述）', it.uses.length ? `　用在：${it.uses.slice(0, 3).join('、')}${it.uses.length > 3 ? '…' : ''}` : '']),
      ...controls,
      status,
    ]),
  ]);
  showThumb();
  return section;
}

registerTool(
  {
    id: 'drawings',
    title: '手繪拍照上傳・小圖庫',
    what: '畫在白紙上、用手機拍照上傳，會自動去掉白紙、裁切、調整成遊戲要的大小。背景和物品也可以從小圖庫選。',
    why: '',
    time: '約 20～30 分鐘',
    ai: false,
  },
  (ctx: StepContext) => {
    const items = assetCatalog(ctx.project.script).filter((x) => x.kind === 'bg' || x.kind === 'char' || x.kind === 'fg');
    return el('div', { class: 'g-form', 'data-guide': 'drawings' }, [
      el('details', { class: 'g-tips' }, [
        el('summary', {}, ['怎麼拍比較好？']),
        el('ul', {}, [
          el('li', {}, ['畫在白紙上，用深色、粗一點的筆描邊，再上色。']),
          el('li', {}, ['光線要平均：靠窗或開燈，不要有手機或手的影子。']),
          el('li', {}, ['手機從正上方拍，讓紙佔滿畫面。']),
          el('li', {}, ['背景是橫的，左右會被裁掉一點，重要的東西畫在中間；角色畫全身，腳要畫到。']),
          el('li', {}, ['同一個角色不同表情，盡量畫一樣大、一樣的姿勢。']),
        ]),
      ]),
      ...(items.length
        ? items.map((it) => row(ctx, it))
        : [el('p', { class: 'g-meta' }, ['劇本還沒有用到任何圖片。先完成劇本，這裡就會列出要畫的背景、角色與物品。'])]),
    ]);
  },
);
