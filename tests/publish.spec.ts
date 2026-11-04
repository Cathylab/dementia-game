// 階段二 B-6 正式發佈：publish.json 的單位名稱與標誌（標題畫面）、結尾的資源頁。
import { expect, test, type Page } from '@playwright/test';
import { telHref, validatePublish, type Publish } from '../src/publish';
import { advance, jumpTo, openWithTestScript } from './helpers';

const PUBLISH: Publish = {
  organization: { name: '某某失智症協會', logo: 'org_logo', url: 'https://example.org' },
  resources: {
    title: '如果你需要幫忙',
    intro: '這些資訊在你需要的時候可以用。',
    items: [
      { title: '失智症關懷專線', text: '週一到週五', phone: '0800-474-580' },
      { title: '衛教資訊', url: 'https://example.org/info' },
    ],
  },
};

async function withPublish(page: Page) {
  await page.route('**/projects.json', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ dir: 'examples/寫給未來的我', kind: 'example', title: 'x', extras: ['publish.json'] }]) }),
  );
  await page.route('**/publish.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(PUBLISH) }));
  await openWithTestScript(page);
}

test('格式檢查與電話連結', () => {
  expect(validatePublish(PUBLISH)).toEqual([]);
  expect(validatePublish({ organization: { name: '' }, resources: { items: [] } }).length).toBe(2);
  expect(telHref('0800-474-580')).toBe('tel:0800474580');
});

test('標題畫面顯示製作單位（標誌、名稱、連結）', async ({ page }) => {
  await withPublish(page);
  const org = page.locator('[data-ui=organization]');
  await expect(org).toContainText('某某失智症協會');
  await expect(org.locator('img.org-logo')).toHaveAttribute('data-name', 'org_logo');
  await expect(org.locator('a')).toHaveAttribute('href', 'https://example.org');
});

test('結局之後先看到資源頁，再回到標題', async ({ page }) => {
  await withPublish(page);
  await page.click('.start-button');
  await jumpTo(page, 'end_z');
  await advance(page);
  await page.locator('.ending-screen.open .start-button').click();
  const res = page.locator('[data-ui=resources]');
  await expect(res).toContainText('如果你需要幫忙');
  await expect(res.locator('a[data-phone]')).toHaveAttribute('href', 'tel:0800474580');
  await expect(res.locator('a[target=_blank]')).toHaveAttribute('href', 'https://example.org/info');
  await res.locator('[data-ui=resources-done]').click();
  await expect(res).toHaveCount(0);
  await expect(page.locator('.title-screen')).toHaveClass(/open/);
});

test('沒有 publish.json：沒有製作單位、結局後直接回標題', async ({ page }) => {
  await openWithTestScript(page);
  await expect(page.locator('[data-ui=organization]')).toHaveCount(0);
  await jumpTo(page, 'end_z');
  await advance(page);
  await page.locator('.ending-screen.open .start-button').click();
  await expect(page.locator('.title-screen')).toHaveClass(/open/);
});
