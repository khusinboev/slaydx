/**
 * Sahifadan uzun matnli bandlarni Word kabi bo'lib ko'rsatish.
 *
 * Brauzer ko'ruvchisi har varaqni alohida `word-sheet` (qat'iy balandlik)
 * sifatida chizadi. Word/LibreOffice esa uzun paragrafni sahifalar orasida
 * bo'lib turadi — ko'ruvchi buni qila olmasa, `.word-sheet{overflow:hidden}`
 * matnning past qismini jim kesib tashlaydi (AUDIT-6 3-band).
 *
 * Yechim: o'lchov bosqichida `h > limit` bo'lgan matnli band so'zlar
 * bo'yicha ikkiga bo'linadi — `head` sig'adi, `tail` keyingi varaqda
 * davom etadi. Bo'laklarning balandligi o'lchovdan keyingi aylanishda
 * qayta o'lchanadi (iterativ), shuning uchun `cutWords` taxminiy bo'lishi
 * yetarli — og'ish keyingi aylanishda to'g'rilanadi.
 */

export type TextSplitter<T> = {
  /** Bandni matnga aylantiradi. Matnli band emas (jadval, rasm) — `null`. */
  takeText: (item: T) => string | null;
  /**
   * Matnning bir qismidan yangi band yasaydi.
   *
   * `index` — global bo'linish tartibi; ko'ruvchi band `id` si noyob
   * qolishi uchun ishlatishi mumkin (bir `id` ikki marta DOM kaliti
   * bo'lmasligi kerak).
   */
  makePart: (item: T, part: string, index: number) => T;
};

/**
 * Matnni sig'adigan qismga nisbatan ikkiga bo'ladi.
 *
 * `ratio` — sig'adigan ulush (`limit / o'lchangan balandlik`). Balandlik
 * so'z soniga chiziqli emas, shuning uchun 0.97 omil marja beradi — ortiqcha
 * kesilgan bo'lak keyingi iteratsiyada yana bo'linishi mumkin emas, aks holda
 * ikki bo'lak ham juda kichrayib ketardi. Bo'linmaydigan (bitta so'zli) —
 * `null`.
 */
export function cutWords(text: string, ratio: number): [string, string] | null {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;
  // Kamida yarmi (0.5): juda uzun band bo'lsa ham tez sig'adigan bo'lak
  // chiqadi, kolgani keyingi aylanishda bo'linadi. 0.97 — satr uzunliklari
  // farqiga marja.
  const frac = Math.max(0.5, Math.min(0.97, ratio));
  const cut = Math.max(1, Math.round(words.length * frac));
  if (cut >= words.length) return null;
  const head = words.slice(0, cut).join(" ");
  const tail = words.slice(cut).join(" ");
  return tail ? [head, tail] : null;
}

/**
 * Sahifadan uzun matnli bandlarni bo'lib, yangi ro'yxat qaytaradi.
 *
 * `changed` — kamida bitta band bo'lingan bo'lsa `true`. Chaqiruvchi bu
 * ro'yxatni o'lchash DOM'iga qo'yib, keyingi aylanishda funksiyani yana
 * chaqirishi kerak (bo'laklar ham sig'masa — ular yana bo'linadi).
 * Bo'linmaydigan uzun band (bitta uzun so'z, jadval) o'z holida qoladi —
 * bunday holatda kesilishdan boshqa iloj yo'q.
 */
export function splitByHeight<T>(
  items: T[],
  heights: number[],
  limit: number,
  split: TextSplitter<T>,
): { list: T[]; changed: boolean } {
  const out: T[] = [];
  let changed = false;
  let partIndex = 0;
  items.forEach((item, i) => {
    const h = Math.max(8, heights[i] ?? 24);
    if (h <= limit) {
      out.push(item);
      return;
    }
    const text = split.takeText(item);
    if (!text) {
      out.push(item);
      return;
    }
    const parts = cutWords(text, limit / h);
    if (!parts) {
      out.push(item);
      return;
    }
    out.push(split.makePart(item, parts[0], ++partIndex));
    out.push(split.makePart(item, parts[1], ++partIndex));
    changed = true;
  });
  return { list: out, changed };
}