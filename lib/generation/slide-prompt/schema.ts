/**
 * Deck JSON sxemasi — model qaytaradigan shakl.
 *
 * `layout` enumi `SLIDE_LAYOUTS` bilan MOS bo'lishi shart: ilgari
 * `table` enumda yo'q edi va model uni hech qachon tanlamasdi. WP-C
 * `quiz`, `references`, `answers` ni qo'shdi va `normalizeSlide` bilan
 * birga qulfladi:
 *
 *   quiz  — `quiz[]`, har savolda AYNAN 4 variant va `answer` indeksi
 *           (0..3). Javob slaydda chizilmaydi, u notiq izohiga tushadi.
 *   refs  — `references` maketining manbalari (nom + URL). Tadqiqot
 *           yoqilgan bo'lsa `applyResearchRefs` ularni haqiqiy manbalar
 *           bilan ALMASHTIRADI — uydirma havola dekaga tushmaydi.
 */
export function deckJsonSchema(): string {
  return `JSON sxema: {"slides":[{"layout":"title|agenda|section|bullets|twoCol|compare|quote|stats|process|table|closing|quiz|references|answers","kicker":"","title":"","subtitle":"","imageHint":"","notes":"","bullets":[""],"leftTitle":"","left":[""],"rightTitle":"","right":[""],"quote":"","quoteBy":"","stats":[{"value":"","label":""}],"steps":[{"n":"1","title":"","text":""}],"table":{"headers":["",""],"rows":[["",""]]},"quiz":[{"q":"","options":["","","",""],"answer":0}],"refs":[{"title":"","source":""}]}]}`;
}
