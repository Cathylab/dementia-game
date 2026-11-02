# 失智症第一視角：網頁版視覺小說引擎

讓一般人用第一人稱體驗失智症的視角：記憶錯置、時間混亂、情感逐漸淡漠。

這個 repo 是**與內容無關的引擎**。故事、圖片、音樂都放在資料檔與素材檔裡；換內容只要換檔案，不必改程式。

- 線上版：<https://cathylab.github.io/dementia-game/>
- 技術：Vite + TypeScript，純前端、無框架、無後端
- 電腦橫式與手機直式都能玩

目前 repo 裡沒有任何真實圖片或音樂：背景、立繪、前景物件都由程式畫出佔位圖，音樂由 Web Audio 即時合成。之後把檔案放進對應資料夾就會自動換上。

---

## 快速開始

```bash
npm install
```

```bash
npm run dev
```

開啟終端機顯示的網址（通常是 <http://localhost:5173/>）。

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 開發伺服器（存檔自動重新整理） |
| `npm run build` | 型別檢查並建置到 `dist/` |
| `npm run preview` | 預覽建置結果 |
| `npm run typecheck` | 只做型別檢查（含測試檔） |
| `npm test` | 跑 Playwright 測試（會自動建置並啟動預覽伺服器） |

第一次在自己電腦跑測試前，需要先下載瀏覽器：

```bash
npx playwright install chromium
```

---

## 如何換腳本

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
| `wrong_object` | 背景上疊一個不該出現的物件（預設 `fg/wrong_object.png`，可用 `wrongObject` 指定）；若場景有 foreground，改為把手持物件換成 `wrongObject`（預設 `{foreground}_wrong`）。持續到場景結束 | 台詞 |
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

### v2 新功能

完整規格見 [`docs/script-format-v2.md`](docs/script-format-v2.md)（給劇本 AI 與引擎 AI 共用的文件，最後一節是引擎對文件沒寫到的情況所做的決定）。v1 腳本不用修改也能照常執行。

#### 條件 `if`

台詞、整組 choice、單一選項都可以加 `if`，值是 JavaScript 布林表達式：

```json
{ "speaker": "husband", "text": "這件是佳穎幫妳選的。", "if": "has(\"daughter_picked_qipao\") && trust >= 1" }
```

| 可以用的名稱 | 意思 |
| --- | --- |
| 數值名稱 | `meta.stats` 裡的數值，例如 `lucidity >= 1` |
| `has("旗標")` | 是否記下過這個旗標 |
| `seen("物件id")` | 是否點過這個物件 |
| `flags` | v1 的旗標陣列，例如 `flags.includes("x")` |

- 台詞的 `if` 不成立：整句跳過，不顯示、不寫入對話紀錄、不觸發效果。「回上一句」也會跳過它。
- 選項的 `if` 不成立：這個選項不出現。整組都不成立時直接播下一句。
- 條件在播到那一句（或選項出現）的那一刻才判定。
- `has()`、`seen()` 也能用在 `endings[].condition`。

#### 可以點的物件 `objects`

掛在場景上。物件在畫面上是淡淡的圓圈，點了跳出一張說明卡（有圖、名稱、說明），不推進劇情、不算選擇，點過記為 `seen`。

```json
"objects": [
  { "id": "a1_phone", "label": "手機", "x": 0.66, "y": 0.4, "r": 0.04, "appearAt": 2,
    "image": "phone_on_table", "description": "佳穎傳來新做的指甲。", "truth": "照片下面還有一句：媽，十點喔。", "fx": [] }
]
```

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `id` | 是 | 整份腳本唯一 |
| `label` | 是 | 物件名稱 |
| `x`、`y`、`r` | 是 | 位置與半徑（0–1），規則同 hotspot。`y` 請在 0.62 以下，否則會被台詞區蓋住 |
| `appearAt` | 否 | 從本場景第幾句（0 起算）開始可以點，持續到場景結束 |
| `image` | 否 | 說明卡上的圖，`public/assets/fg/{image}.png`，找不到時用佔位圖 |
| `description` | 是 | 說明卡文字 |
| `truth` | 否 | 真相，給記憶對照用 |
| `fx` | 否 | 只支援 `text_blur`、`name_fade`（名稱變成「那個東西」） |

- 只有台詞播放時可以點；選項出現時熱點隱藏。說明卡打開時遊戲暫停，再點一下回到原本那句。
- 熱點隨退化係數越來越淡，第三幕幾乎看不出來。
- 每點一次，對話紀錄寫一列「（看了手機）」；`seen` 只記第一次，並保留順序。

#### 隱藏選項 `requires`

掛在選項上，值是一個物件 id 或 id 陣列（全部點過才解鎖）：

```json
{ "text": "先看一下手機裡的照片。", "requires": "a1_phone", "effects": { "lucidity": 1 }, "flags": ["hidden_phone_photo"] }
```

- `if` 不成立：選項完全不出現。`requires` 不成立：選項**出現但灰掉、不能按**。
- 灰掉時顯示「你好像記得什麼，但想不起來。」；設定裡打開「隱藏選項提示」時，改成顯示還沒點過的物件名稱，例如「手機？、照片？」。
- 有 `requires` 的 choice 至少要有兩個沒有 `requires` 的選項；隱藏選項要設一個 `hidden_` 開頭的旗標。
- 結局裡的專屬內容不需要新欄位，用 `"if": "has(\"hidden_phone_photo\")"` 即可。

#### 預設設定 `meta.settingsDefaults`

```json
"meta": { "title": "婚禮前一個月", "stats": { "trust": 0 }, "settingsDefaults": { "hiddenHints": false, "memoryReview": "inline" } }
```

| 設定 | 值 | 預設 | 設定畫面 |
| --- | --- | --- | --- |
| `hiddenHints` | `true`、`false` | `false` | 隱藏選項提示 |
| `memoryReview` | `"inline"`、`"page"` | `"inline"` | 記憶對照：融入結局／結局後獨立一頁 |

玩家在設定裡動過的項目會存在瀏覽器裡，以玩家為準；沒動過的項目跟著腳本預設值。

### 檢查腳本

- 開發者面板最下方的「腳本檢查」會列出找不到的場景、未知的 speaker 或效果、條件語法錯誤等問題（也會印在瀏覽器主控台）。v2 另外檢查：
  - `if` 語法錯誤
  - `has("x")` 用到沒有任何選項會設定的旗標
  - `seen("x")` 用到不存在的物件
  - 一組 choice 的所有選項都有 `if`
  - 物件 id 重複、缺少必填欄位、說明套了不支援的效果、位置太低會被台詞區蓋住
  - `requires` 指向不存在的物件，或物件在這個選項之後才出現（玩家不可能先點到）
  - 有 `requires` 的 choice，沒有 `requires` 的選項少於兩個；隱藏選項沒有 `hidden_` 旗標
- `npm test` 裡的「腳本檢查」測試會驗證 `public/script.json` 格式正確，並窮舉所有選擇組合（包含每個物件點或不點），確認**每一個結局都有路線可以走到**；狀態太多時改用隨機抽樣五千次。
- `tests/script.spec.ts` 裡的「示範腳本規格」一組只是驗證目前的示範腳本；換成正式腳本後可以整組刪掉。

---

## 如何換圖（檔名約定）

把 PNG 放進 `public/assets/` 底下對應資料夾，檔名對上就會自動取代佔位圖。找不到檔案時才用佔位圖，所以可以一張一張慢慢換。

| 種類 | 路徑 | 建議 |
| --- | --- | --- |
| 背景 | `public/assets/bg/{background}.png` | 2304×1080（畫面寬度的 1.2 倍，留給視線平移）。16:9 也可以，只是上下會被裁掉一點。手機直式時會左右裁切，重要內容請放中間 |
| 立繪 | `public/assets/char/{角色id}_{expression}.png` | 透明背景直式圖，例如 1000×1800，腳底貼齊圖片下緣。例：`daughter_neutral.png`、`daughter_smile.png` |
| 前景（手持物件） | `public/assets/fg/{name}.png` | 透明背景，物件貼齊圖片下緣，寬約 900 |
| 錯置物件 | `public/assets/fg/wrong_object.png` 或 `wrongObject` 指定的名稱 | 透明背景，會被縮到畫面寬度約 14% 疊在背景上 |
| 換掉的手持物件 | `public/assets/fg/{foreground}_wrong.png` 或 `wrongObject` 指定的名稱 | 同前景 |

`background` 與 `expression` 的名稱就是腳本裡寫的字串，不必另外註冊。

## 如何換音樂

場景的 `music` 欄位對應 `public/assets/music/{music}.ogg`。

- 找不到 `.ogg` 時會再找 `.mp3`（Safari 舊版不支援 ogg，可兩種都放）。
- 兩者都沒有時，改用 Web Audio 程式合成的環境音：依曲名決定調性的長音和弦、低頻持續音、輕微房間底噪與偶爾的高音。
- 音樂會循環播放，換曲時交叉淡入淡出。
- 走音機制同時套用在合成音與真實音檔：真實音檔以播放速率漂移造成音高與速度不穩、音量不穩、低通濾波、偶爾靜音；合成音另外讓每個聲部各自走音、和弦節奏不穩。
- 瀏覽器規定要使用者點擊後才能出聲，所以音樂從按下「開始」後才開始。

---

## 操作

設定畫面有：文字速度、音量、隱藏選項提示、記憶對照（融入結局／結局後獨立一頁）。

| 動作 | 電腦 | 手機 |
| --- | --- | --- |
| 下一句／打字中顯示全文 | 點畫面、空白鍵、Enter | 點畫面 |
| 回上一句 | 功能列、Backspace、PageUp | 選單 |
| 隱藏介面 | 功能列、H；再點畫面恢復 | 選單 |
| 關閉紀錄或設定 | Esc、右上角 × | 右上角 × |

手機直式時，功能列收合成右下角的「選單」按鈕。沒有存檔讀檔。

## 開發者面板

預設關閉。

- 按 **`` ` ``**（Esc 下方那個鍵）或 **F8** 開關。
- 網址加 `?dev=1` 會一開始就打開（手機上用這個）。

面板內容：目前場景、句數、退化係數、去飽和量、旗標、數值（可用 ± 調整）與「目前會走向哪個結局」；跳到任一場景；手動觸發十一個效果（選項類效果在沒有選項時會叫出一組測試選項）；調整退化係數（取消「依幕自動」即可手動）；切換目前角色的 gaze 與 distance；從頭開始；腳本檢查結果。

其他網址參數：`?timescale=0.2` 讓所有動畫與等待變成 0.2 倍時間（測試用）。主控台裡可以用 `__vn.engine`、`__vn.view` 直接操作。

---

## 部署

推到 `main` 時，GitHub Actions（`.github/workflows/deploy.yml`）會自動建置並發布到 GitHub Pages：<https://cathylab.github.io/dementia-game/>

第一次需要在 GitHub 上設定一次：repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。

`vite.config.ts` 用 `base: './'`，所以建置結果放在任何子路徑都能用；要放到別的主機，上傳 `dist/` 整個資料夾即可。

另外 `.github/workflows/test.yml` 會在每個 PR 與推到 `main` 時跑型別檢查與 Playwright 測試。

---

## 專案結構

```
public/
  script.json          故事腳本（換這個）
  assets/bg|char|fg|music/   素材（放真實檔案後取代佔位）
src/
  types.ts             腳本格式型別
  script.ts            載入、驗證、結局條件
  engine.ts            流程與狀態：台詞、選項、跳轉、回上一句、repeat_line
  view.ts              ADV 介面、第一視角呈現、ui 覆寫
  fx.ts                十一個效果標籤與退化係數的畫面部分
  typewriter.ts        打字機（含退化時的速度與字距抖動）
  audio.ts             音樂播放、合成音、走音、muffle
  assets.ts            圖片載入與佔位圖
  devpanel.ts          開發者面板
  style.css            全部樣式
tests/
  script.spec.ts       腳本檢查與結局可達性
  play.spec.ts         用示範腳本實際走到每個結局
  fx.spec.ts           每個效果對應的 class／DOM 變化
  ui.spec.ts           介面、ui 覆寫、第一視角元素、音樂、手機版
  fixtures/test-script.json  測試專用腳本（測試時攔截取代 script.json）
```
