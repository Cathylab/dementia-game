// 延遲存檔（打字時不要每個字都寫一次），但換頁、換步驟、關掉頁面前一定要寫出去。
const pending = new Map<number, () => void>();
let nextId = 1;

/** 延遲執行；同一個函式在時間內再次呼叫會重新計時。flushPending() 會立刻執行所有還沒執行的。 */
export function debounce(fn: () => void, ms = 400): () => void {
  const id = nextId++;
  let timer = 0;
  return () => {
    clearTimeout(timer);
    pending.set(id, () => {
      clearTimeout(timer);
      pending.delete(id);
      fn();
    });
    timer = window.setTimeout(() => pending.get(id)?.(), ms);
  };
}

/** 立刻寫出所有延遲中的存檔。 */
export function flushPending(): void {
  for (const run of [...pending.values()]) run();
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushPending);
