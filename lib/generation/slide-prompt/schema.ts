/**
 * Deck JSON sxemasi — model qaytaradigan shakl.
 *
 * `layout` enumi `SLIDE_LAYOUTS` bilan MOS bo'lishi shart: ilgari
 * `table` enumda yo'q edi va model uni hech qachon tanlamasdi. WP-C
 * `quiz`, `references`, `answers` ni qo'shadi va `normalizeSlide` bilan
 * birga qulflaydi.
 */
export function deckJsonSchema(): string {
  return `JSON sxema: {"slides":[{"layout":"title|agenda|section|bullets|twoCol|compare|quote|stats|process|table|closing","kicker":"","title":"","subtitle":"","imageHint":"","notes":"","bullets":[""],"leftTitle":"","left":[""],"rightTitle":"","right":[""],"quote":"","quoteBy":"","stats":[{"value":"","label":""}],"steps":[{"n":"1","title":"","text":""}],"table":{"headers":["",""],"rows":[["",""]]}}]}`;
}
