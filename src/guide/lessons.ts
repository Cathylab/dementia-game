// 課堂模式（需求書 6-1）：老師帶學生，4 到 6 堂課，每堂一張任務卡。
// 和完整的九個步驟共用同一份作品與填寫內容；任務卡只是把步驟依「一堂課做得完」重新分組，並加上課堂活動。
export interface LessonTask {
  /** 存勾選狀態用的代號（同一堂課裡唯一）。 */
  id: string;
  text: string;
  /** 建議時間（分鐘）。 */
  minutes: number;
  /** 主要負責的角色（之後的角色卡會用）。 */
  role?: '全組' | '編劇' | '美術' | '查證' | '測試員';
}

export interface LessonDef {
  id: string;
  title: string;
  /** 這堂課結束時要完成什麼。 */
  goal: string;
  tasks: LessonTask[];
  /** 這堂課要用的步驟畫面（嵌入任務卡下面）。 */
  steps: string[];
  /** 給老師的提醒。 */
  teacher: string;
  /** 可以省略的堂（課堂時間不夠時）。 */
  optional?: boolean;
}

export const LESSON_MINUTES = 45;

export const LESSONS: LessonDef[] = [
  {
    id: 'l1',
    title: '認識同理遊戲・定主題',
    goal: '每組選好處境，用一句話寫下想讓玩家體會什麼。',
    tasks: [
      { id: 'play', text: '全班一起玩首頁的一分鐘片段，討論：選項在眼前消失時，你有什麼感覺？', minutes: 10, role: '全組' },
      { id: 'roles', text: '分組（約 4 人）並分配角色：編劇、美術、查證、測試員。', minutes: 5, role: '全組' },
      { id: 'theme', text: '選題材包，寫下作品名稱與「想讓玩家體會的事」（下面的表單）。', minutes: 15, role: '編劇' },
      { id: 'source', text: '查證員找可靠的資料來源（例如衛福部、相關協會），填進下面的「資料來源表」。', minutes: 10, role: '查證' },
      { id: 'reflect', text: '每個人寫一句：我們想讓玩家「從裡面」體會到什麼？', minutes: 5, role: '全組' },
    ],
    steps: ['theme', 'sources'],
    teacher: '開始前先說明這個題材可能觸及的感受，提醒同學尊重真實的當事人與家屬。可以先讓全班決定同一個題材包，比較好帶討論。',
  },
  {
    id: 'l2',
    title: '故事骨架',
    goal: '寫出 2～3 個場景的分場大綱：每一場發生什麼、玩家在哪裡做選擇、有哪些結局。',
    tasks: [
      { id: 'hero', text: '決定主角是誰（年齡、身分、最在乎的人或事）與處境怎麼出現。', minutes: 10, role: '編劇' },
      { id: 'scenes', text: '在下面的格子寫 2～3 個場景：時間・地點、發生什麼、一個選擇（兩個選項）。', minutes: 20, role: '編劇' },
      { id: 'turn', text: '標出轉折點，決定 1～2 個結局（不要只有「失去」）。', minutes: 10, role: '全組' },
      { id: 'check', text: '查證員對照資料來源表：故事裡的症狀或處境都有來源嗎？沒有的補上或拿掉。', minutes: 5, role: '查證' },
    ],
    steps: ['grid', 'outline', 'sources'],
    teacher: '建議用「照格子填」：完全不用 AI，下一堂繼續填完就能產生劇本。若要用 AI 但學生不能自己用（未成年使用 AI 服務常有年齡限制）：學生在「分場大綱」按「請老師代貼」下載代貼單，老師在首頁最下方的「老師工作台」處理後發還回覆檔。',
  },
  {
    id: 'l3',
    title: '寫劇本',
    goal: '把分場大綱變成可以玩的劇本：每個場景有台詞，至少一個選擇。',
    tasks: [
      { id: 'write', text: '把格子的對話、選項回應、結局填完，按「產生劇本並套用到專案」。', minutes: 25, role: '編劇' },
      { id: 'choice', text: '每個場景至少放一組選項，設定每個選項會到哪裡。', minutes: 10, role: '編劇' },
      { id: 'play', text: '測試員從頭玩一次，記下讀不順或卡住的地方。', minutes: 10, role: '測試員' },
    ],
    steps: ['grid', 'script'],
    teacher: '兩種做法擇一：照格子填產生劇本（建議，不用 AI），或用「完整劇本」的提示詞請 AI 寫好再貼回來檢查。產生之後都可以打開故事編輯器繼續改台詞。',
  },
  {
    id: 'l4',
    title: '素材與效果',
    goal: '放上背景與角色圖（手繪拍照也可以），在關鍵時刻加 1～2 個效果。',
    tasks: [
      { id: 'draw', text: '美術員把背景、角色畫在白紙上，用「手繪拍照上傳」放進專案（背景、物品也可以從小圖庫選；沒有圖也可以先用佔位圖）。', minutes: 25, role: '美術' },
      { id: 'fx', text: '選 1～2 個效果，放在最想讓玩家「感覺到」的那一句（故事編輯器的效果標籤）。', minutes: 10, role: '編劇' },
      { id: 'sound', text: '（可選）幫一兩句台詞加上音效。', minutes: 10, role: '全組' },
    ],
    steps: ['drawings', 'assets'],
    teacher: '效果不要多：一個用在對的地方，比五個到處都是更有力量。提醒同學效果要對應想讓玩家體會的感受。',
  },
  {
    id: 'l5',
    title: '試玩與修改',
    goal: '組內與跨組試玩，依回饋修改，劇本檢查沒有「必須修正」。',
    tasks: [
      { id: 'self', text: '組內從頭玩到每一個結局，測試員記錄卡住的地方。', minutes: 10, role: '測試員' },
      { id: 'swap', text: '和另一組交換玩，請對方說：哪裡有感覺？哪裡看不懂？', minutes: 15, role: '全組' },
      { id: 'stereo', text: '查證員帶全組做「刻板印象檢查清單」。', minutes: 5, role: '查證' },
      { id: 'fix', text: '依回饋修改，直到下面的劇本檢查沒有「必須修正」。', minutes: 15, role: '編劇' },
    ],
    steps: ['playtest', 'stereotype'],
    teacher: '交換試玩時，請玩的人先說感受、再說建議。之後的版本會提供互評表。',
  },
  {
    id: 'l6',
    title: '發表',
    goal: '交作業（專案檔），匯出可以玩的版本，全班展示。',
    tasks: [
      { id: 'submit', text: '匯出專案檔（.vnproj）交給老師。', minutes: 5, role: '全組' },
      { id: 'export', text: '匯出可以玩的版本（或 itch.io 用的壓縮檔）。', minutes: 5, role: '全組' },
      { id: 'show', text: '全班輪流試玩各組作品，每組用一分鐘說明想讓玩家體會什麼。', minutes: 30, role: '全組' },
      { id: 'reflect', text: '寫下：做完這個遊戲，你對這個處境的想法有什麼改變？', minutes: 5, role: '全組' },
    ],
    steps: ['publish'],
    teacher: '時間不夠時可以把這堂併到第五堂後半。作業以專案檔繳交，所有內容只存在學生自己的電腦與檔案裡。',
    optional: true,
  },
];
