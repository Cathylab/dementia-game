# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案是什麼

《寫給未來的我》：讓一般人用第一人稱體驗失智症的網頁視覺小說。repo 是**與內容無關的引擎**（Vite + TypeScript，純前端、無框架、無後端），故事全在 `public/script.json`，素材在 `public/assets/`。部署到 GitHub Pages：<https://cathylab.github.io/dementia-game/>（推到 `main` 時由 `.github/workflows/deploy.yml` 自動發布）。

使用者（Cathylab）不寫程式、用中文溝通，透過 GitHub 網頁合併 PR 與上傳檔案。劇本與美術由另一個「劇本 AI」產出，雙方以 `docs/script-format-v1.md`、`script-format-v2.md`、`script-format-v3-voice.md` 為共同規格；每份文件最後的「引擎實作補充」記錄引擎對規格沒寫到的情況所做的決定。**改引擎行為時要同步更新對應文件與 README。**

## 指令

```bash
npm run dev          # 開發伺服器（含文字編輯器寫回 script.json、voice manifest 端點）
npm run build        # tsc 型別檢查 + vite build，必須零錯誤零警告
npm run typecheck    # 同時檢查 src（tsconfig.json）與 tests／vite 設定（tsconfig.node.json）
npm test             # Playwright：自動 build 並在 4173 port 開 preview
npx playwright test tests/voice.spec.ts            # 單一檔案
npx playwright test tests/voice.spec.ts -g "缺檔"  # 單一測試
```

- `@playwright/test` 釘在 `1.63.0`，對應環境裡預裝在 `/opt/pw-browsers` 的 Chromium，不要升級、不要跑 `playwright install`。
- `playwright.config.ts` 的 webServer `reuseExistingServer`：本機若已有 4173 的 preview 在跑，會用它（記得先 `npm run build`，否則測到舊的 dist）。
- vite.config 會載入的檔案（`vite-plugin-*.ts`、`src/editable.ts`、`src/voice.ts`）的 import 必須寫 `.ts` 副檔名，否則 build 會出警告。

## 架構

- `src/main.ts`：載入 `script.json` → `Engine` + `AdvView` + `AudioEngine` + `TextEditor` + `DevPanel`。網址參數 `?voice=1` 改為渲染開發者頁面「配音總表」（`voicedesk.ts`），不啟動遊戲。`window.__vn = { engine, view, dev, editor }` 供測試與除錯。
- `src/engine.ts`：純流程與狀態（stats、flags、seen、history 快照、repeat_line 佇列、記憶對照展開的虛擬台詞）。透過 `View` 介面呼叫畫面，`engine.token` 每換句／換場景遞增，非同步流程用它判斷是否過期。`phase`：title／busy／text／choice／inspect／ending。
- `src/view.ts`：ADV 介面、轉場（`blink()`，樣式由 `meta.transition` 決定）、打字、獨白、選項與 hotspot、可點物件與說明卡、記憶對照、對話紀錄、設定、手機直式拖曳背景。`src/fx.ts` 實作 11 個效果標籤與退化係數（act 1→0、2→0.5、3 以上→1）。
- `src/script.ts`：`validateScript`（所有腳本檢查規則，警告以「（警告）」開頭）、`if`／結局條件（`new Function`，可用數值名稱、`has()`、`seen()`、`flags`）、`sceneReachability`。
- `src/audio.ts`：音樂（找不到 `.ogg`／`.mp3` 時用 Web Audio 合成，退化時走音）與配音（另一條音軌，只受 `muffle` 影響）。配音只請求 `assets/voice/manifest.json` 列出的檔案，避免缺檔產生 404。
- `src/editable.ts`：文字編輯器可改的欄位、`structureOf`（只比結構；呈現設定 `meta.transition`、`objectHighlight`、`sprite`、`characters[].sprite`、`scenes[].music` 視為可改）、JSON 排版 `formatScript`。瀏覽器與 dev server 共用。
- `vite-plugin-script-save.ts`：dev 模式 `POST /__editor/save-script` 寫回 `public/script.json`（結構不同就拒絕）。`vite-plugin-voice-manifest.ts`：dev 端點與 build 產生 `assets/voice/manifest.json`。

### 容易踩到的設計

- **物件熱點座標是「背景圖上的位置」**（0–1，`r` 相對背景圖寬），不是螢幕座標；熱點層與 `.bg` 共用同樣的框（`--bg-aspect`、1.2 倍寬、平移、look_around、晃動）。hotspot 模式的**選項**仍是螢幕座標。腳本檢查要求物件 `x` 在 0.1–0.9、`y` ≤ 0.92。
- 台詞區 `.dialog` 與功能列容器是 `pointer-events: none`（點擊交給 `#stage` 推進台詞），熱點層疊在台詞區之上。
- 圖片依序找 `.webp`、`.png`、`.jpg`，缺圖產生 canvas 佔位圖；立繪缺表情時先退回 `{id}_neutral`。
- 設定存在 localStorage 時只存玩家**動過**的項目，其餘跟著 `meta.settingsDefaults`。

## 測試慣例

- 大部分測試用 `tests/fixtures/test-script.json`（`openWithTestScript` 用 route 攔截 `script.json`），不依賴正式劇本；`play.spec.ts`、`script.spec.ts` 才用 `public/script.json`。
- `tests/helpers.ts`：`jumpTo`（經開發者面板跳場景）、`advance`（等 `engine.phase === 'text'` 才點台詞區）、`?timescale=0.2` 讓動畫變快。熱點會隨畫面晃動，點擊要用 `click({ force: true })`。
- `tests/simulate.ts` 窮舉選項與物件點擊組合檢查每個結局可達（狀態太多時隨機抽樣）；`play.spec.ts` 依它的路線在瀏覽器實際走到每個結局。
- 測試音檔／圖檔用 route 送假的 WAV／PNG；配音要同時 route `assets/voice/manifest.json`。
- 改完功能後跑完整 `npm test` 再推。

## Git 與協作流程

- 開發分支 `claude/focused-planck-vu15fw`，每輪工作開一個新 PR，由使用者在 GitHub 網頁合併後自動部署。
- PR 合併後要繼續工作：`git fetch origin` 後，若分支已全部併入就 `git merge --ff-only origin/main`；若分支還有未合併的提交，用 `git merge origin/main`（**不要 rebase 或 force push**，環境會擋）。
- 使用者常直接上傳檔案到 `main`：先 `git fetch` 檢查放的位置（曾經放到 repo 根目錄而非 `public/assets/`）與檔案大小（背景圖要轉成 webp，曾從 92 MB 壓到 6.5 MB）。
- 劇本 AI 交來的新 `script.json` 可能是從舊版改的：合併前要和 repo 版本逐欄比對，保留 repo 裡的呈現設定與已調整的座標，用 `formatScript` 寫出。
- 本環境連不到 `github.io` 與 Google Drive；驗證線上版時改用 `git worktree` 建置 `origin/main` 後在本機 preview 測。
