/**
 * O'YINLAR (AUDIT-21) FORMA PARAMETRLARI REYESTRI.
 *
 * Qoida (slayd/rezyume/maqola/talaba ishi/o'qituvchi bilan bir xil):
 * formada ko'ringan HAR maydon shu yerda e'lon qilinadi, va differensial
 * zond (`tests/game-params.test.mts`, WP-A/WP-B) uni qulflaydi —
 * parametr chiqishga ta'sir qilmasa test qizaradi («bezak maydon yo'q»,
 * mahsulot egasi qarori 14).
 *
 * R0 da bu fayl REYESTRNING O'ZI: har parametr qaysi vositalarda
 * ko'rinadi (`kinds`), nimaga ta'sir qiladi (`impacts`) va zond qaysi
 * ikki qiymatni solishtiradi (`probeA`/`probeB`). Zondning O'ZI (forma →
 * `buildGameDoc` → hujjat farqi) WP-A/WP-B da ulanadi, chunki dvigatel
 * o'sha yerda yoziladi. Bugun tekshiriladigan narsa — reyestrning
 * butunligi: id lar unikal, har parametrning egasi va ta'siri bor, va
 * `lib/tools.ts` dagi maydonlar ro'yxati bilan AYNAN mos.
 *
 * Manba: `docs/research/{crossword,flashcards}.md` §3 jadvallari.
 *
 * NARX: HECH BIR parametr narxga ta'sir qilmaydi — ikkala vosita ham
 * tekis 2 000 (mahsulot egasi qarori 6). Shuning uchun `price` ta'siri
 * bu reyestrda umuman yo'q; `tests/pricing.test.mts` buni mutatsiya
 * bilan tekshiradi.
 */
import type { FormValues } from "../types";
import { GAME_KINDS, type GameKind } from "./games/types";

export type GameParamImpact =
  /** Tizim/foydalanuvchi prompti matni. */
  | "prompt"
  /** Hujjat SKELETI — bo'limlar, jadval, blok soni. */
  | "structure"
  /** `doc.game` modeli va maket kirishi (`planGame`). */
  | "layout"
  /** To'r algoritmi (`crossword/grid.ts`) — o'lcham, joylashtirish, `dropped`. */
  | "grid"
  /** Hisobot qoidalari (`GAME_RULE_IDS`) yoki baholovchi. */
  | "review"
  /** Manba: yuklangan fayl matni. */
  | "source"
  /** `meta.language` / hujjat tili. */
  | "language"
  /** Ish byudjeti (`gameBudgetMs`). */
  | "budget";

export type GameParam = {
  id: string;
  /** Qaysi vositalarda ko'rinadi — bo'sh bo'lmasligi kerak. */
  kinds: readonly GameKind[];
  encode: "string" | "boolean" | "number";
  probeA: FormValues[string];
  probeB: FormValues[string];
  impacts: readonly GameParamImpact[];
  /** Zondni shu qiymatlar ustida o'tkazish (masalan `mode: "file"`). */
  probeWith?: FormValues;
};

const ALL = GAME_KINDS;

export const GAME_PARAMS: GameParam[] = [
  /* ── umumiy ── */
  { id: "topic", kinds: ALL, encode: "string", probeA: "Fotosintez jarayoni", probeB: "O'zbekiston tarixi: Amir Temur davri", impacts: ["prompt", "layout"] },
  { id: "language", kinds: ALL, encode: "string", probeA: "uz", probeB: "ru", impacts: ["language", "prompt", "layout"] },
  { id: "extra", kinds: ALL, encode: "string", probeA: "", probeB: "Faqat 7-sinf darsligidagi atamalardan foydalaning.", impacts: ["prompt"] },

  /* ── krossvord (crossword.md §3) ── */
  /*
   * `mode` FAQAT krossvordda: fayl rejimi `SourceFileField` va worker'ning
   * `sourceForJob` yo'lini yoqadi (`tool.modes`). Flesh kartalarda u YO'Q
   * — hisobot §2 da ham raqobatchida ham rejim tanlovi yo'q, va bizda
   * ham karta to'plami mavzudan tuziladi.
   */
  { id: "mode", kinds: ["crossword"], encode: "string", probeA: "topic", probeB: "file", impacts: ["source", "prompt", "review"] },
  {
    id: "sourceText",
    kinds: ["crossword"],
    encode: "string",
    probeA: "",
    probeB: "Fotosintez — o'simlik bargida quyosh nuri ostida organik modda hosil bo'lish jarayoni. Xlorofill yashil pigment.",
    probeWith: { mode: "file" },
    impacts: ["source", "prompt", "review"],
  },
  { id: "crosswordType", kinds: ["crossword"], encode: "string", probeA: "klassik", probeB: "tarifli", impacts: ["prompt", "structure", "review"] },
  { id: "wordCount", kinds: ["crossword"], encode: "number", probeA: 5, probeB: 20, impacts: ["prompt", "grid", "structure", "review", "budget"] },

  /* ── flesh kartalar (flashcards.md §3) ── */
  { id: "cardType", kinds: ["flashcards"], encode: "string", probeA: "term-def", probeB: "qa", impacts: ["prompt", "structure", "review", "layout"] },
  { id: "cardCount", kinds: ["flashcards"], encode: "number", probeA: 5, probeB: 20, impacts: ["prompt", "structure", "layout", "review", "budget"] },
  /*
   * `includeExample` — `chips` («Yo'q»/«Ha»), `toggle` EMAS: `FieldKind`
   * da `toggle` e'lon qilingan, lekin `FieldBlock` (`components/forms/
   * fields.tsx`) uni CHIZMAYDI — ya'ni toggle sifatida qo'yilgan maydon
   * formada ko'rinmasdi va aynan «bezak maydon» bo'lib qolardi.
   * `encode: "boolean"` esa QIYMATNING ma'nosi haqida: dvigatel uni
   * `FlashcardsModel.includeExample` bayrog'iga aylantiradi.
   */
  { id: "includeExample", kinds: ["flashcards"], encode: "boolean", probeA: false, probeB: true, impacts: ["prompt", "structure", "review"] },
];

/** Formadan yuboriladigan maydon nomlari (`lib/tools.ts` shu ro'yxatni to'ldiradi). */
export const GAME_FORM_FIELDS = GAME_PARAMS.map((p) => p.id);

/** Bitta vositaning maydonlari — forma shu tartibda chizadi. */
export function gameParamsOf(kind: GameKind): GameParam[] {
  return GAME_PARAMS.filter((p) => p.kinds.includes(kind));
}
