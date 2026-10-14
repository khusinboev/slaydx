import { SLIDE_LAYOUTS } from "../slide-types";

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

const STR = { type: "STRING" } as const;
const strings = { type: "ARRAY", items: STR } as const;

/**
 * Gemini `responseSchema` (OpenAPI subset) for the same deck shape - used ONLY by the JSON-quality
 * retry (`LlmOpts.retrySchema`): the first attempt stays as it always was, and when its answer is
 * not parseable the second one is decoded against this schema, so brackets, commas and quotes cannot
 * be malformed. Fields mirror `deckJsonSchema()` one to one (`tests/slide-bad-json.test.mts` locks it);
 * only `layout` and `title` are required, the rest may be omitted like in the prompt's free form.
 */
export function deckResponseSchema(): Record<string, unknown> {
  const slide = {
    type: "OBJECT",
    properties: {
      layout: { type: "STRING", enum: [...SLIDE_LAYOUTS] },
      kicker: STR,
      title: STR,
      subtitle: STR,
      imageHint: STR,
      notes: STR,
      bullets: strings,
      leftTitle: STR,
      left: strings,
      rightTitle: STR,
      right: strings,
      quote: STR,
      quoteBy: STR,
      stats: { type: "ARRAY", items: { type: "OBJECT", properties: { value: STR, label: STR }, propertyOrdering: ["value", "label"] } },
      steps: { type: "ARRAY", items: { type: "OBJECT", properties: { n: STR, title: STR, text: STR }, propertyOrdering: ["n", "title", "text"] } },
      table: {
        type: "OBJECT",
        properties: { headers: strings, rows: { type: "ARRAY", items: strings } },
        propertyOrdering: ["headers", "rows"],
      },
      quiz: {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { q: STR, options: strings, answer: { type: "INTEGER" } }, propertyOrdering: ["q", "options", "answer"] },
      },
      refs: { type: "ARRAY", items: { type: "OBJECT", properties: { title: STR, source: STR }, propertyOrdering: ["title", "source"] } },
    },
    required: ["layout", "title"],
    propertyOrdering: ["layout", "kicker", "title", "subtitle", "imageHint", "notes", "bullets", "leftTitle", "left", "rightTitle", "right", "quote", "quoteBy", "stats", "steps", "table", "quiz", "refs"],
  };
  return { type: "OBJECT", properties: { slides: { type: "ARRAY", items: slide } }, required: ["slides"] };
}
