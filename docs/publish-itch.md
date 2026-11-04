# 把遊戲放上 itch.io

[itch.io](https://itch.io) 是獨立遊戲作者最常用的發佈網站：免費、不用寫程式，別人打開網址就能在瀏覽器玩，也可以同時放下載版。作品可以設成公開、只給有網址的人看，或設密碼（適合課堂作業先不公開）。

## 準備

在引導流程第 9 步按 **「匯出 itch.io 用的壓縮檔」**，下載 `作品名-itch.zip`。**不用解壓縮**，直接上傳這個壓縮檔。

（這個壓縮檔和「匯出可以玩的版本」不同：`index.html` 在最外層、檔名只有英數字，符合 itch.io 的規定。）

## 步驟

1. **註冊**：到 itch.io 按 Register，照指示完成（免費）。
2. **新增作品**：登入後點右上角的帳號 → **Upload new project**。
3. **基本資料**：
   - **Title**：作品名稱。
   - **Project URL**：網址的最後一段，用英文，例如 `my-game`。
   - **Kind of project**：選 **HTML**。
4. **上傳**：在 Uploads 按 **Upload files**，選 `作品名-itch.zip`，上傳完成後勾 **This file will be played in the browser**。
5. **畫面設定**（Embed options）：
   - **Viewport dimensions**：1280 × 720。
   - 勾 **Mobile friendly**（手機也能玩），Orientation 選 Landscape。
   - 勾 **Fullscreen button**（玩家可以全螢幕）。
6. **介紹**：Short description、Cover image（建議用遊戲畫面截圖）、Genre 可以選 Visual Novel。內容涉及敏感題材時，在說明裡寫上提醒。
7. **可見度**（Visibility & access）：
   - 先選 **Draft**，按 **Save & view page** 自己試玩一次。
   - 沒問題後改成 **Restricted**（只給有網址或密碼的人）或 **Public**（任何人），再按 Save。
8. **分享**：作品頁的網址就是 `https://帳號.itch.io/my-game`。

## 也提供下載版

在同一個作品頁的 Uploads 再上傳一個檔案：「匯出可以玩的版本」的壓縮檔（**不要**勾 played in the browser），玩家就能下載後離線玩。

## 之後要更新

重新匯出 itch.io 用的壓縮檔 → 到作品頁 Edit game → Uploads 刪掉舊的、上傳新的（記得再勾 played in the browser）→ Save。

## 常見問題

- **畫面空白或顯示找不到 index.html**：請上傳「itch.io 用的壓縮檔」，不是「可以玩的版本」，也不要先解壓縮再重新壓縮。
- **聲音沒有出來**：瀏覽器規定要先點一下畫面；按遊戲的「開始」後就有聲音。
- **想讓學生交作業但不公開**：用 Restricted，或在 Visibility 設密碼，把網址給老師。
