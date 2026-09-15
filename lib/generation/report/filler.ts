/**
 * «SUV» IBORALAR (AUDIT-19 R0-A) — neytral ro'yxat: maqola, kurs ishi,
 * referat va insho promptlarida bir xil taqiqlanadi, qo'riqchi
 * (`report/guard.ts`) esa hisoblaydi (o'chirmaydi — hisobot uchun).
 *
 * `article/prompts.ts` shu ro'yxatni RE-EXPORT qiladi (mavjud importlar
 * o'z joyida qoladi). Ro'yxat qisqa va aniq: keng qolip («muhim») jonli
 * nasrni ham ushlab qolardi. Promptdagi indekslar (`FILLER_PHRASES[8]`,
 * `[12]`, `[16]`) TARTIBGA bog'liq — yangi ibora faqat OXIRIGA qo'shiladi.
 */
export const FILLER_PHRASES: readonly string[] = [
  "bugungi kunda",
  "ma’lumki",
  "ma'lumki",
  "shuni ta’kidlash joizki",
  "shuni ta'kidlash joizki",
  "hozirgi vaqtda",
  "muhim rol o‘ynaydi",
  "muhim rol o'ynaydi",
  "в настоящее время",
  "как известно",
  "следует отметить",
  "играет важную роль",
  "in today's world",
  "in today’s world",
  "it is worth noting",
  "it is well known",
  "plays a crucial role",
  "in the modern era",
  /*
   * Mahalliy konferensiya to'plami (2025-04-19, 797 bet, ~110 maqola —
   * `docs/research/konf-2025-uzb.md` §4) chastotasi bo'yicha: «bugungi
   * kunda» 17, «muhim ahamiyat kasb etadi» 11, «dolzarb masalalardan biri»
   * 8+, «shunday qilib» (jumla boshida) 10, «keng qamrovli» — model ham
   * shularni «tabiiy» deb takrorlaydi. Ro'yxat oxiriga — promptdagi indekslar
   * (`FILLER_PHRASES[8]`, `[12]`, `[16]`) o'zgarmaydi.
   */
  "muhim ahamiyat kasb etadi",
  "dolzarb masalalardan biri",
  "keng qamrovli",
  "o‘z navbatida",
  "o'z navbatida",
  "имеет важное значение",
  "одной из актуальных проблем",
];
