// 正式發佈（需求書 7-6）：單位名稱與標誌（標題畫面）、結尾的資源頁（求助專線、衛教連結、服務資訊）。
// 內容放在專案的 publish.json（可以替換的內容檔），格式見 docs/publish-format.md。這個檔案不碰 DOM。

export interface Publish {
  /** 製作或發行的單位，顯示在標題畫面下方。 */
  organization?: {
    name: string;
    /** 標誌圖片：assets/fg/{logo}（webp／png／jpg）。 */
    logo?: string;
    url?: string;
  };
  /** 結尾的資源頁：結局之後、回到標題之前顯示一頁。 */
  resources?: {
    title?: string;
    intro?: string;
    items: ResourceItem[];
  };
}

export interface ResourceItem {
  title: string;
  /** 說明（一兩句）。 */
  text?: string;
  /** 電話（手機上可以直接撥）。 */
  phone?: string;
  url?: string;
}

export function validatePublish(p: unknown): string[] {
  const problems: string[] = [];
  if (!p || typeof p !== 'object') return ['publish.json 必須是一個物件 { organization, resources }'];
  const pub = p as Publish;
  if (pub.organization !== undefined) {
    if (!pub.organization || typeof pub.organization.name !== 'string' || !pub.organization.name.trim()) problems.push('organization.name 必須是單位名稱');
    if (pub.organization?.logo !== undefined && !/^[A-Za-z0-9_-]+$/.test(pub.organization.logo)) problems.push('organization.logo 只能用英文字母、數字、底線（圖片名稱，不含副檔名）');
    if (pub.organization?.url !== undefined && !/^https?:\/\//.test(pub.organization.url)) problems.push('organization.url 必須是 http(s) 網址');
  }
  if (pub.resources !== undefined) {
    const items = pub.resources?.items;
    if (!Array.isArray(items) || !items.length) problems.push('resources.items 至少要有一筆');
    else
      items.forEach((it, i) => {
        if (!it || typeof it.title !== 'string' || !it.title.trim()) problems.push(`resources.items[${i}]：缺少 title`);
        if (it?.url !== undefined && !/^https?:\/\//.test(it.url)) problems.push(`resources.items[${i}]：url 必須是 http(s) 網址`);
      });
  }
  return problems;
}

/** 電話號碼給 tel: 連結用（只留數字、+、#、*）。 */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+#*]/g, '')}`;
}
