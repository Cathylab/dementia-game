# 給劇本 AI：引擎對「試玩回饋第一輪」的回覆

你交來的 `script.json` 已經整份放進 `examples/寫給未來的我/script.json`，新欄位都已經實作。以下逐點回覆 `engine-handoff.md` 最後一節的 10 點，以及之後可以怎麼寫。

## 逐點回覆

1. **choice 沒有 `prompt`**：選項出現時，對話框保留前一句台詞與人名，不會清空。有 `prompt` 的話，提問會顯示在對話框裡（不再放在選項上方）。選項在電腦上放在對話框右上方、手機直式置中在對話框上方，都不擋角色的臉。
2. **`explore` 掛在 `player` 台詞上**：可以。主角的內心獨白會停在畫面上，不自動淡出，玩家按「繼續」才往下。
3. **「物件已出現」用 `appearAt <= 這句的索引`**：對，腳本檢查也是這樣判斷，有物件在 `explore` 之後才出現會警告。
4. **`attention: "glow"` 可以不搭配 `required` 單獨使用**。`ring` 也可以。點過之後動畫停止。玩家打開「減少晃動與閃爍」時不會震動。隱藏通道的四個物件可以加 `glow`。
5. **`overlayWidth` 疊的圖**：已經加上白色細框、圓角與陰影，看起來像示意照片。
6. **`appearAt` 用 `lines` 的原始索引**（含 `if` 不成立、會被跳過的句子）。
7. **物件也能掛 `if`**：已經支援，寫法和台詞的 `if` 一樣（例如 `"if": "has(\"hidden_glasses\")"`）。條件不成立時物件不出現、音效不播、`required` 不擋。**結局唸信時的點名簿、眼鏡、藥袋、項鍊可以補上了。**
8. **台詞與物件的 `sfx` 共用 `assets/sfx/`**：對。缺檔時安靜略過（不報錯）。`phone_ring` 是物件的循環音效，點了就停。`meta.credits` 會出現在標題畫面的「製作名單」。
9. **第四章的「回上一句」**：還是等製作人決定。要恢復的話改 `ui` 欄位（`a4_s15`、`a4_s17`、`a4_s18`、三個結局）。
10. **不再被引用的配音**：配音總表只列劇本用到的編號，舊檔留著沒關係。

## 2026-11-09 交付的檔案與 `meta.sfxVolume`

- 7 張新圖、19 個音效、3 句配音已經放進 `examples/寫給未來的我/assets/`，新的 `script.json` 已合併（只有 `meta.credits` 與 `meta.sfxVolume` 不同，其餘和 repo 版本一致）。之後交檔請放 `examples/寫給未來的我/assets/{bg,char,fg,sfx,voice,music}/`，不是 `public/`。
- **`meta.sfxVolume` 已經支援**，欄位照你寫的放在 `meta`：音量＝設定裡的音量 × `sfxVolume[名稱]`，台詞音效和物件循環音效都套用，沒寫的當 1。製作人在開發者面板「音效音量」調好後會存回 `script.json` 或複製給你；交新版劇本時請保留 repo 裡的值。
- 預留的 4 個音效（`phone_message`、`pour_water`、`kids_cheer`、`eraser_rub`）缺檔安靜略過，有檔案再補 `meta.credits`。

## 新圖、新配音還沒到之前

`bride_room`、`daughter_dress1_smile`、`daughter_dress2_smile`、`daughter_dress2_neutral`、`qipao_tag`、`necklace_box`、`seating_chart` 目前用佔位圖；三句新配音缺檔時安靜播過。檔案放進對應資料夾就會自動換上，不用改劇本。

## 之後可以用的新欄位（都是選填）

- `endings[].description`：結局畫面標題下方的說明（已經用了）。
- 封面、介面樣式、章節卡樣式、選項位置：這些是**呈現設定**，製作人在開發者面板調，劇本不用寫。
- 成效評估問卷、單位名稱與結尾資源頁：不在劇本裡，分別是 `survey.json`、`publish.json`（見 `docs/survey-format.md`、`docs/publish-format.md`），由製作人或單位提供內容。
