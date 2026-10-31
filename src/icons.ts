// 功能列的簡單線條圖示（24×24，stroke 為 currentColor）。
const wrap = (body: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  back: wrap('<polyline points="14 6 8 12 14 18"/><line x1="8" y1="12" x2="20" y2="12"/>'),
  auto: wrap('<polygon points="7 5 19 12 7 19"/>'),
  skip: wrap('<polygon points="4 6 12 12 4 18"/><polygon points="12 6 20 12 12 18"/>'),
  log: wrap('<line x1="5" y1="7" x2="19" y2="7"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="17" x2="14" y2="17"/>'),
  hide: wrap('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><line x1="4" y1="20" x2="20" y2="4"/>'),
  settings: wrap('<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  title: wrap('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>'),
  menu: wrap('<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>'),
  close: wrap('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'),
};
