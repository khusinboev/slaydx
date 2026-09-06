import type { FlowItem } from "./flow";

/**
 * Bandlarni A4 varaqlarga joylaydi.
 *
 * Ilgari bu mantiq `WordViewer` ichidagi `useLayoutEffect` da turardi va
 * sinovdan o'tkazib bo'lmasdi — u DOM o'lchoviga bog'langan edi. Endi
 * balandliklar ARGUMENT sifatida keladi, ya'ni qaror sof funksiyada.
 */

/** Sarlavha — o'zidan keyingi matn bilan birga turishi kerak. */
function isHeading(item: FlowItem): boolean {
  return item.type === "h1" || item.type === "h2" || item.type === "h3";
}

/**
 * «Keyingisi bilan birga» — sarlavha va undan keyingi BIRINCHI matn
 * bloki bir butun deb hisoblanadi.
 *
 * Ilgari bu yerda qattiq yozilgan zaxira turardi:
 *
 *   const need = keep ? h + 36 : h;
 *
 * 36 px — taxminan bitta qator. Lekin sarlavhadan keyin odatda 100–250 px
 * lik paragraf keladi. Natijada:
 *
 *   1. sarlavha «sig'adi» deb hisoblanardi (unga atigi 36 px kerak edi);
 *   2. keyingi paragraf ALOHIDA o'lchanar va sig'masdi;
 *   3. paragraf yangi varaqqa ko'char, sarlavha esa oldingi varaqda
 *      YOLG'IZ qolardi — ostida 150–250 px bo'sh joy bilan.
 *
 * Aynan shu «3. NATIJALAR (RESULTS)» va «FOYDALANILGAN ADABIYOTLAR»
 * sarlavhalari ostidagi bo'sh joyni keltirib chiqargan edi. DOCX da bu
 * muammo yo'q: Word va LibreOffice sarlavhani matn bilan birga ko'chiradi.
 *
 * Ketma-ket sarlavhalar zanjiri ham hisobga olinadi («I BOB» darhol
 * «1.1.» bilan boshlansa): zanjir birinchi matn blokigacha yig'iladi.
 */
function blockHeight(items: FlowItem[], heights: number[], from: number): number {
  let total = 0;
  for (let i = from; i < items.length; i++) {
    total += heights[i];
    if (!isHeading(items[i])) break;
  }
  return total;
}

export function packPages(items: FlowItem[], rawHeights: number[], limit: number): FlowItem[][] {
  // O'lchanmagan band ham joy egallaydi — nol balandlik varaqni buzardi.
  const heights = items.map((_, i) => Math.max(8, rawHeights[i] ?? 20));
  const pages: FlowItem[][] = [];
  let cur: FlowItem[] = [];
  let used = 0;
  let sawAbstract = false;

  const flush = () => {
    if (cur.length) pages.push(cur);
    cur = [];
    used = 0;
  };

  items.forEach((item, i) => {
    const h = heights[i];

    // Titul — har doim o'z varag'i.
    if (item.type === "title") {
      flush();
      pages.push([item]);
      return;
    }

    // Mundarija yangi varaqdan.
    if (item.type === "toc") flush();
    /*
     * Annotatsiya bloki yangi varaqdan boshlanadi — lekin FAQAT BIRINCHISI.
     * `annotationLangs: "all"` da uch tilli annotatsiya bo'ladi;
     * `render-docx.ts` ularni orasida sahifa uzilishisiz ketma-ket
     * chizadi. Ilgari bu yerda har biri alohida varaqqa majburlanardi va
     * ko'ruvchidagi varaq raqamlari fayldan ~2 taga siljirdi (AUDIT-6 A5).
     * Keyingi annotatsiyalar oddiy balandlik tekshiruvi bilan oqadi.
     */
    if (item.type === "abstract" && !sawAbstract) {
      flush();
      sawAbstract = true;
    }

    /*
     * Sarlavha o'zi bilan birga keyingi matnni ham talab qiladi.
     * `cur.length` sharti MAJBURIY: varaq boshidagi sarlavhani
     * ko'chirishning ma'nosi yo'q — u keyingi varaqda ham xuddi shu
     * holatga tushadi va cheksiz suriladi.
     */
    const need = isHeading(item) ? blockHeight(items, heights, i) : h;
    if (cur.length && used + need > limit) {
      flush();
      cur = [item];
      used = h;
      return;
    }

    cur.push(item);
    used += h;
  });

  if (cur.length) pages.push(cur);
  return pages.length ? pages : [items];
}
