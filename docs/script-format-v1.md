# 腳本格式 v1

這份文件說明 `public/script.json` 的基本格式（與 README「如何換腳本」相同）。v2 新增的欄位見 [`script-format-v2.md`](script-format-v2.md)。

讀者有兩位：照這份文件實作或維護播放器的**引擎 AI**，以及照這份文件撰寫劇本 JSON 的**劇本 AI**。

## 檔案

整個故事就是 `public/script.json` 這一個檔案。直接覆蓋它即可。

### 格式

```json
{
  "meta": {
    "title": "遊戲名稱",
    "durationMinutes": 10,
    "stats": { "trust": 0, "lucidity": 0 },
    "statRange": { "min": -4, "max": 4 }
  },
  "characters": [
    { "id": "daughter", "name": "小婷", "trait": "總是戴著紅色髮圈", "relation": "女兒" }
  ],
  "scenes": [
    {
      "id": "a1_s01",
      "act": 1,
      "title": "早餐",
      "background": "kitchen_morning",
      "music": "calm_home",
      "foreground": null,
      "ui": {},
      "lines": [
        { "speaker": "narrator", "text": "桌上有兩碗粥。", "fx": [] },
        { "speaker": "player", "text": "她在看我。", "fx": [] },
        { "speaker": "daughter", "expression": "neutral", "gaze": "camera", "distance": "normal",
          "text": "爸，今天記得吃藥。", "fx": ["name_fade"] },
        {
          "choice": [
            { "text": "我知道。", "effects": { "trust": 1 }, "flags": [], "goto": "a1_s02" },
            { "text": "什麼藥？", "effects": { "trust": -1, "lucidity": -1 }, "flags": ["asked_about_meds"], "goto": "a1_s02" }
          ],
          "mode": "list",
          "fx": []
        }
      ],
      "next": "a1_s02"
    }
  ],
  "endings": [
    { "id": "ending_a", "title": "結局名稱", "condition": "trust >= 2 && lucidity >= 1", "scene": "end_a" }
  ]
}
```

### 規則

- **speaker**：`"narrator"`（旁白）、`"player"`（主角內心獨白）或 `characters` 裡的 `id`。
- **lines** 依序播放。遇到 `choice` 會停下來等玩家選；選完套用 `effects`（數值會被夾在 `statRange` 內）與 `flags`，再依 `goto` 跳轉。
- 沒有選項的場景播完後走 **next**。
- **結局判定**：`next` 或 `goto` 寫 `"@ending"`，或非結局場景省略 `next`，就會依序判定 `endings` 的 `condition`，第一個成立者勝出；全部不成立時取最後一條（所以最後一條請寫成 fallback，例如 `"true"`）。接著跳到該結局的 `scene`。
- **結局場景**的 id 以 `end_` 開頭，播完後顯示結局畫面與「回到標題」。
- **condition** 是 JavaScript 布林表達式，可以直接用 `meta.stats` 裡的每個數值名稱（例如 `trust`、`lucidity`），以及 `flags` 陣列（例如 `flags.includes("asked_about_meds")`）。
- 角色台詞的 **expression / gaze / distance** 省略時，沿用該角色上一句的值（預設 `neutral` / `camera` / `normal`）。
- **gaze**：`"camera"` 看著我、`"away"` 轉頭看別處（立繪水平翻轉）、`"other"` 看著另一個人（立繪側移並轉身）。
- **distance**：`"near"` 約 1.25 倍並往下、`"normal"`、`"far"` 約 0.8 倍並往上。
- **choice.mode**：`"list"` 為文字選項列；`"hotspot"` 為畫面上的發光熱點，每個選項多帶 `x`、`y`（0–1，相對整個畫面）與 `r`（半徑，0–1，相對畫面寬度）。滑鼠移上或手機長按顯示選項文字，點一下選擇。
- **foreground**：手持物件圖層的檔名，`null` 表示沒有。
- **music**：字串表示播放該曲；`null` 表示靜音；省略表示沿用上一首。
- 畫面上的立繪是「最後一位說話的角色」；換場景時清空。

### 額外的可選欄位

| 欄位 | 位置 | 說明 |
| --- | --- | --- |
| `prompt` | choice 那一行 | 選項上方的提示文字 |
| `goto` 省略 | 選項 | 不跳場景，繼續播放本場景下一句 |
| `wrongObject` | 台詞 | `wrong_object` 要用的物件檔名（見下方） |
| `timeSkipTo` | 台詞 | `time_skip` 要短暫切換到的背景名稱；省略時隨機挑腳本裡另一個背景 |
| `backTarget` | 場景 | `ui.back` 為 `"wrong_scene"` 時，回上一句會跳到這個場景 |

### 效果標籤（fx）

每句台詞或選項可以掛零到多個。

| 標籤 | 作用 | 掛在 |
| --- | --- | --- |
| `name_fade` | 人名框的名字逐字變成底線，最後變成「那個人」，並露出該角色的 `trait` | 台詞 |
| `text_blur` | 這句文字部分字元缺失或被替換成亂碼方塊 | 台詞 |
| `repeat_line` | 這句播完後，隔一兩句無預警再播一次 | 台詞 |
| `choice_vanish` | 選項出現後約每三秒消失一個，剩下的重新排列（list 與 hotspot 都適用） | 選項 |
| `flat_options` | 所有選項同樣灰色、同樣語氣（句尾統一成「。」），點任何一個都走第一個選項的 `goto`（被點的那個選項的 `effects`、`flags` 仍會套用） | 選項 |
| `wrong_object` | 背景上疊一個不該出現的物件（預設 `fg/wrong_object`，可用 `wrongObject` 指定）；若場景有 foreground，改為把手持物件換成 `wrongObject`（預設 `{foreground}_wrong`）。持續到場景結束 | 台詞 |
| `time_skip` | 眨眼後背景換成另一個場景，約 3.6 秒後再眨眼切回 | 台詞 |
| `desaturate` | 從這句開始畫面飽和度降低（每次 30%），會累加，不會自己恢復（重新開始遊戲才重置） | 台詞 |
| `focus_drift` | 景深對焦從角色慢慢飄到背景，角色變糊 | 台詞 |
| `look_around` | 背景（與立繪）無目的地緩慢左右平移 | 台詞 |
| `muffle` | 音訊套低通濾波並降低音量，台詞也稍微變淡 | 台詞 |

`name_fade`、`text_blur`、`focus_drift`、`look_around`、`muffle` 只持續到下一句；要延長就在連續幾句都掛上。

### 全域退化係數

由場景的 `act` 決定：第一幕 0、第二幕 0.5、第三幕 1（第四幕以後維持 1）。它會連續影響：

- 打字速度忽快忽慢、偶爾停頓
- 文字間距隨機抖動
- 背景飽和度降低、背景景深更糊
- 視野暗角加重、畫面輕微晃動
- 音樂走音（音高漂移、節奏不穩、偶爾靜音、音量不穩、濾波）

開發者面板可以手動覆寫。

### 介面覆寫（ui）

場景的 `ui` 欄位可以改寫底部功能列，只對該場景有效，預設全部正常。

```json
{ "ui": { "log": "corrupt", "back": "wrong_scene", "skip": "disabled", "auto": "skips_lines" } }
```

| 功能 | 可用的值 |
| --- | --- |
| `back` 回上一句 | `normal`、`disabled`、`hidden`、`wrong_scene`（跳到場景的 `backTarget`） |
| `auto` 自動播放 | `normal`、`disabled`、`hidden`、`skips_lines`（自動播放時偶爾直接跳過一句） |
| `skip` 快轉 | `normal`、`disabled`（按鈕變灰不可按）、`hidden` |
| `log` 對話紀錄 | `normal`、`disabled`、`hidden`、`corrupt`（隨機刪掉幾句並對人名套 name_fade） |
| `hide` 隱藏介面 | `normal`、`disabled`、`hidden` |
| `settings` 設定 | `normal`、`disabled`、`hidden` |
| `title` 回標題 | `normal`、`disabled`、`hidden` |

## 素材檔名約定

把圖片放進 `public/assets/` 底下對應資料夾，檔名對上就會自動取代佔位圖。副檔名依序找 `.webp`、`.png`、`.jpg`，**建議用 `.webp`**：同樣畫質，檔案小十倍以上，手機才載得快（背景建議 500 KB 以內）。找不到檔案時才用佔位圖，所以可以一張一張慢慢換。

| 種類 | 路徑 | 建議 |
| --- | --- | --- |
| 背景 | `public/assets/bg/{background}.webp` | 2304×1080（畫面寬度的 1.2 倍，留給視線平移）。16:9 也可以，只是上下會被裁掉一點。手機直式時一次只看得到中間一段，玩家可以左右拖曳看整張圖 |
| 立繪 | `public/assets/char/{角色id}_{expression}.webp` | 透明背景直式圖，例如 1000×1800，腳底貼齊圖片下緣。例：`daughter_neutral.webp`、`daughter_smile.webp` |
| 前景（手持物件） | `public/assets/fg/{name}.webp` | 透明背景，物件貼齊圖片下緣，寬約 900 |
| 錯置物件 | `public/assets/fg/wrong_object.webp` 或 `wrongObject` 指定的名稱 | 透明背景，會被縮到畫面寬度約 14% 疊在背景上 |
| 換掉的手持物件 | `public/assets/fg/{foreground}_wrong.webp` 或 `wrongObject` 指定的名稱 | 同前景 |

`background` 與 `expression` 的名稱就是腳本裡寫的字串，不必另外註冊。

## 音樂

場景的 `music` 欄位對應 `public/assets/music/{music}.ogg`。

- 找不到 `.ogg` 時會再找 `.mp3`（Safari 舊版不支援 ogg，可兩種都放）。
- 兩者都沒有時，改用 Web Audio 程式合成的環境音：依曲名決定調性的長音和弦、低頻持續音、輕微房間底噪與偶爾的高音。
- 音樂會循環播放，換曲時交叉淡入淡出。
- 走音機制同時套用在合成音與真實音檔：真實音檔以播放速率漂移造成音高與速度不穩、音量不穩、低通濾波、偶爾靜音；合成音另外讓每個聲部各自走音、和弦節奏不穩。
- 瀏覽器規定要使用者點擊後才能出聲，所以音樂從按下「開始」後才開始。

---
