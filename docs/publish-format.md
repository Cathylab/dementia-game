# 正式發佈資訊格式（publish.json）

給要正式發佈遊戲的單位（醫院、長照機構、協會、學校）。引擎只負責顯示；內容放在這個檔案，隨時可以替換。

## 放在哪裡

和 `script.json` 放在同一個資料夾。沒有這個檔案就不顯示。

## 格式

```json
{
  "organization": { "name": "某某失智症協會", "logo": "org_logo", "url": "https://example.org" },
  "resources": {
    "title": "如果你或身邊的人需要幫忙",
    "intro": "下面的資訊，在需要的時候可以用。",
    "items": [
      { "title": "失智症關懷專線", "text": "週一到週五 9:00–17:00", "phone": "0800-000-000" },
      { "title": "衛教資訊", "text": "認識失智症的十大警訊", "url": "https://example.org/info" }
    ]
  }
}
```

| 欄位 | 說明 |
| --- | --- |
| `organization.name` | 單位名稱，顯示在標題畫面最下方 |
| `organization.logo` | 標誌圖片名稱（不含副檔名），放在 `assets/fg/`（webp、png、jpg）。選填 |
| `organization.url` | 單位網站，點名稱會在新分頁打開。選填 |
| `resources.title`、`intro` | 資源頁的標題與開頭說明。選填 |
| `resources.items` | 每一筆：`title`（必填）、`text`、`phone`（手機上可以直接撥打）、`url`（新分頁打開） |

資源頁在結局之後、回到標題之前出現一次（有玩後問卷時，在問卷之後）。**求助專線的號碼與服務時間，發佈前請再確認一次。**

## 引擎實作補充

- 網站版：建置時 `projects.json` 的 `extras` 記下專案有 `publish.json`，遊戲頁有記號才去讀（不會 404）。離線版寫進 html；「匯出可以玩的版本」也會帶進去（連同標誌圖）。
- 本機專案（引導網站做的遊戲）目前不讀這個檔。
- 格式有問題時，主控台警告，這次不顯示。
