import type { SlideLayout } from "./slide-types";
import type { SlideBeat, SlideTemplate } from "./slide-templates";
import type { DocMeta } from "./types";

/**
 * Tuzilma BLOKLARI — foydalanuvchi yoqadi/o'chiradi.
 *
 * Shablon (`beats`/`fillers`) tuzilmani berardi, foydalanuvchi esa unga
 * ta'sir qila olmasdi. Endi: taqdimot turi standart bloklarni beradi
 * (`purposeDefaults`), foydalanuvchi ularni o'zgartiradi, `blocksToBeats`
 * esa shablon beats'iga kiritadi/olib tashlaydi.
 *
 * Har blok — layout + rol matni (LLM promptiga tushadi) + `anchor`
 * (dekaning qayeriga kiradi). `test` → yangi `quiz` maketi,
 * `adabiyotlar` → yangi `references` maketi, `diagramma` → `stats`
 * majburiy chart rejimida (`SlideModel.chart`).
 */
export const SLIDE_BLOCK_IDS = [
  "reja",
  "maqsadlar",
  "motivatsiya",
  "amaliyot",
  "test",
  "uyga_vazifa",
  "jadval",
  "diagramma",
  "adabiyotlar",
] as const;
export type SlideBlockId = (typeof SLIDE_BLOCK_IDS)[number];

export function isSlideBlockId(v: string): v is SlideBlockId {
  return (SLIDE_BLOCK_IDS as readonly string[]).includes(v);
}

export type SlideBlockAnchor = "after-title" | "early" | "middle" | "late" | "end";

export type SlideBlock = {
  id: SlideBlockId;
  label: string;
  layout: SlideLayout;
  role: (meta: Pick<DocMeta, "planItems" | "quizCount">) => string;
  anchor: SlideBlockAnchor;
  /** `stats` uchun: diagramma majburiy. */
  chart?: boolean;
};

export const SLIDE_BLOCKS: SlideBlock[] = [
  { id: "reja", label: "Reja", layout: "agenda", anchor: "after-title", role: (m) => `Reja — aynan ${m.planItems} ta band` },
  { id: "maqsadlar", label: "Maqsadlar", layout: "bullets", anchor: "early", role: () => "Maqsadlar — tinglovchi nimani bilib oladi (fe’l bilan)" },
  { id: "motivatsiya", label: "Motivatsiya", layout: "quote", anchor: "early", role: () => "Motivatsiya — mavzuga qiziqish uyg‘otadigan savol yoki fakt" },
  { id: "amaliyot", label: "Amaliyot", layout: "process", anchor: "middle", role: () => "Amaliyot — auditoriya bajaradigan qadamlar" },
  { id: "test", label: "Test", layout: "quiz", anchor: "late", role: (m) => `Nazorat testi — ${m.quizCount} ta savol, har birida 4 variant` },
  { id: "uyga_vazifa", label: "Uyga vazifa", layout: "bullets", anchor: "late", role: () => "Uyga vazifa — aniq topshiriq va muddat" },
  { id: "jadval", label: "Jadval", layout: "table", anchor: "middle", role: () => "Taqqoslash jadvali" },
  { id: "diagramma", label: "Diagramma", layout: "stats", anchor: "middle", chart: true, role: () => "Diagramma — bir xil birlikdagi 3–4 taqqoslanadigan ko‘rsatkich" },
  { id: "adabiyotlar", label: "Adabiyotlar", layout: "references", anchor: "end", role: () => "Adabiyotlar va manbalar" },
];

export const SLIDE_BLOCK_BY_ID = Object.fromEntries(SLIDE_BLOCKS.map((b) => [b.id, b])) as Record<SlideBlockId, SlideBlock>;

/**
 * Foydalanuvchi bloklarini shablon beats'iga KIRITADI.
 *
 * WP-0a: shartnoma va o'tkazgich — `beats` ni o'zgarishsiz qaytaradi.
 * Algoritm (anchor bo'yicha kiritish, mavjud shu layoutli beat rolini
 * almashtirish, `reja`/`agendaSlide` o'chirilsa olib tashlash, `closing`
 * oxirida, yonma-yon takror yo'q, uzunlikni `want` ga tenglashtirish)
 * WP-B da yoziladi — `tests/slide-blocks.test.mts` bilan.
 */
export function blocksToBeats(
  meta: Pick<DocMeta, "blocks" | "planItems" | "quizCount" | "agendaSlide" | "internetSearch">,
  tpl: SlideTemplate,
  beats: SlideBeat[],
  want: number,
): SlideBeat[] {
  void meta;
  void tpl;
  void want;
  return beats;
}
