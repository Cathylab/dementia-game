# 把遊戲放上網路：GitHub Pages 教學

不用寫程式、不用安裝 git，只用瀏覽器。做完會得到一個像 `https://你的帳號.github.io/my-game/` 的網址，任何人打開就能玩。

## 準備

在引導流程第 9 步（或開發者面板「專案」）按 **「匯出可以玩的版本」**，下載 `作品名-可以玩的版本.zip`，**先解壓縮**。資料夾裡有 `index.html`、`玩 作品名.html`、`game` 資料夾與 `說明.txt`。

## 步驟

1. **建立 GitHub 帳號**：到 <https://github.com> 按 Sign up，照指示完成（免費）。
2. **建立新的儲存庫**：登入後按右上角「＋」→ **New repository**。
   - Repository name：用英文，例如 `my-game`（會出現在網址裡）。
   - 選 **Public**。
   - 按 **Create repository**。
3. **上傳檔案**：在新的儲存庫頁面按 **uploading an existing file**（或 Add file → Upload files）。
   - 打開解壓縮後的資料夾，**把裡面所有的檔案和 game 資料夾一起拖進去**（不是拖外面那一層資料夾）。
   - 等上傳完成，按 **Commit changes**。
4. **打開 GitHub Pages**：到儲存庫的 **Settings** → 左邊選 **Pages**。
   - Source 選 **Deploy from a branch**。
   - Branch 選 **main**、資料夾選 **/ (root)**，按 **Save**。
5. **等一兩分鐘**：重新整理 Pages 設定頁，上方會出現網址，例如 `https://你的帳號.github.io/my-game/`。
6. **測試**：用手機和電腦各打開一次，從頭玩到結局。

## 之後要更新

再匯出一次「可以玩的版本」，解壓縮，到儲存庫按 Add file → Upload files，把新的檔案拖進去覆蓋，Commit changes。等一兩分鐘就會更新。

## 常見問題

- **打開是 404**：確認 Pages 設定的 branch 是 main、資料夾是 /(root)，以及 `index.html` 在儲存庫的最外層（不是在另一個資料夾裡面）。
- **圖片或聲音不見**：`game` 資料夾要一起上傳，而且裡面的資料夾結構不能改。
- **想放在學校或單位的網站**：一樣把資料夾裡的全部檔案上傳到網站空間，打開 `index.html` 的網址即可。
- **不想公開**：GitHub Pages 的網站是公開的。只想給特定的人玩，可以直接傳壓縮檔，對方解壓縮後雙擊 html。
