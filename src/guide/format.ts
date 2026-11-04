// 給 AI 的劇本格式說明（精簡版）。完整規格在 docs/script-format-v1.md、v2、v3-voice。
// 只列出題材包啟用的效果，避免 AI 用了不會出現的效果。
import type { Pack } from '../pack';
import type { FxTag } from '../types';

const FX_HELP: Record<FxTag, string> = {
  name_fade: '人名框的名字逐字變成底線，最後變成「那個人」（台詞）',
  text_blur: '這句文字部分字元缺失或變成亂碼（台詞；物件說明也可以用）',
  repeat_line: '這句播完後，隔一兩句無預警再播一次（台詞）',
  choice_vanish: '選項出現後約每三秒消失一個（選項那一行）',
  flat_options: '所有選項同樣語氣，點哪個都走第一個選項的去向（選項那一行）',
  wrong_object: '背景上疊一個不該出現的物件，用 wrongObject 指定物件圖名稱（台詞）',
  time_skip: '畫面短暫切到另一個背景再切回，用 timeSkipTo 指定背景名稱（台詞）',
  desaturate: '畫面顏色變淡，會累加、不會恢復（台詞）',
  focus_drift: '焦點從角色飄到背景，角色變糊（台詞）',
  look_around: '視線無目的地左右移動（台詞）',
  muffle: '聲音變悶、台詞變淡（台詞）',
};

export function formatRules(pack: Pack): string {
  const fx = pack.effects.length
    ? pack.effects.map((f) => `  - ${f}：${FX_HELP[f]}`).join('\n')
    : '  （這個題材包沒有特殊效果，不要寫 fx）';
  return `【script.json 格式】
只輸出一個 JSON 物件，結構如下：
{
  "meta": { "title": "遊戲名稱", "pack": "${pack.id}", "durationMinutes": 5, "stats": { "數值名稱": 0 } },
  "characters": [ { "id": "英文代號", "name": "名字", "trait": "外表特徵", "relation": "和主角的關係", "expressions": ["neutral", "smile"] } ],
  "scenes": [
    {
      "id": "a1_s01", "act": 1, "title": "時間・地點（例如：婚禮前半年・廚房）",
      "background": "背景圖名稱（英文小寫與底線，例如 kitchen_morning）",
      "music": "曲名（可省略；null＝靜音）",
      "lines": [
        { "speaker": "narrator", "text": "旁白" },
        { "speaker": "player", "text": "主角心裡的話" },
        { "speaker": "角色代號", "expression": "smile", "text": "角色說的話", "fx": ["效果"] },
        { "prompt": "選項上方的提示（可省略）", "choice": [
          { "text": "選項一", "effects": { "數值名稱": 1 }, "flags": ["旗標"], "goto": "要跳去的場景 id（省略＝繼續這個場景）" },
          { "text": "選項二" }
        ] }
      ],
      "objects": [ { "id": "整份唯一的物件代號", "label": "名稱", "x": 0.5, "y": 0.6, "image": "物件圖名稱", "description": "主角口吻的說明", "truth": "真相" } ],
      "next": "播完後的下一個場景 id；最後一個場景寫 \\"@ending\\"（判定結局）"
    },
    { "id": "end_a", "act": 1, "title": "結局名稱", "background": "…", "lines": [ { "speaker": "narrator", "text": "結局內容" } ] }
  ],
  "endings": [ { "id": "ending_a", "title": "結局名稱", "condition": "數值名稱 >= 1", "scene": "end_a" }, { "id": "ending_b", "title": "…", "condition": "true", "scene": "end_b" } ]
}

規則：
- speaker 只能是 narrator（旁白）、player（主角內心）或 characters 裡的 id。
- 場景 id、角色 id、物件 id、背景與圖片名稱都用英文小寫、數字與底線。
- 結局場景的 id 以 end_ 開頭；endings 由上往下判斷，第一個條件成立的就是結局，最後一個寫 "true" 當保底。
- 條件可以用數值名稱（例如 trust >= 2）、has("旗標")、seen("物件代號")，用 && 與 || 組合。
- 物件的 x、y 是在背景圖上的位置（0 到 1），x 放在 0.1～0.9、y 放在 0.92 以下。物件說明可以不可靠，但 image 與 truth 永遠是真相。
- 要先點過物件才出現的隱藏選項：選項加 "requires": "物件代號"，旗標用 hidden_ 開頭，而且同一組至少還要有兩個一般選項。
- 每一幕的第一個場景，title 寫成「時間・地點」，「・」前面會顯示在章節卡上。
- 效果寫在 "fx": [ ... ]，這個題材包可以用的效果：
${fx}`;
}
