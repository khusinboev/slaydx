/**
 * O'YIN DVIGATELI (AUDIT-21) — `buildGameDoc`.
 *
 * R0 da bu fayl SHARTNOMA: imzo va `null` xulqi qulflanadi, TANASI esa
 * WP-A (krossvord: `crossword/{grid,svg,prompts}.ts`) va WP-B (flesh
 * kartalar: `flashcards/{prompts,layout}.ts`) da to'ladi. Aynan shu
 * naqsh AUDIT-20 R0 da ishlagan: `write-llm.ts` dispatchi, byudjet,
 * ko'ruvchi va forma dvigateldan OLDIN ulanadi, shuning uchun WP lar
 * bir-birini kutmasdan parallel ketadi.
 *
 * Rejalashtirilgan bosqichlar (`onStage` foizlari, WP-A/WP-B):
 *   1 kirish       0→10   forma → `GameInput`, fayl manbasi (krossvord)
 *   2 yozish      10→55   LLM: so'z+savol yoki karta juftliklari
 *   3 qurish      55→75   to'r algoritmi (`grid.ts`) yoki karta varaqlari
 *   4 hisobot     75→90   `review.ts` (qoidalar + baholovchi)
 *   5 sayqal      90→96   `polish.ts`
 *
 * `null` — dvigatel ishlamadi (LLM kalitsiz muhit, model javob bermadi,
 * sifat darvozasidan o'tmadi). Chaqiruvchi (`write-llm.ts`) shunda
 * `null` qaytaradi va `buildArtifact` MAVJUD xulqni beradi: kalit bor
 * bo'lsa «Matn yozilmadi — AI javob bermadi» xatosi (kredit qaytadi),
 * kalitsiz dev muhitda esa shablon hujjat. YANGI xato matni («dvigatel
 * hali yo'q») ATAYLAB kiritilmadi — u foydalanuvchiga hech narsa
 * bermaydi va WP lar tugagach o'chirishni talab qilardi.
 */
import type { FormValues } from "../../types";
import type { AcademicDoc, Delivered, DocMeta } from "../types";
import type { TranslationSource } from "../source-types";
import type { CompleteFn } from "../research/pipeline";
import type { CostMeter, LlmUsage } from "../llm-roles";
import { gameKindOf } from "./registry";

/* ────────────────────────── shartnoma ────────────────────────── */

/** `TeacherStage`/`WorkStage` bilan AYNI shakl — `write-llm.ts` bittasini uzatadi. */
export type GameStage = { progress: number; step: string };

export type GameBuildOpts = {
  deadline: number;
  /** Fayl rejimi (faqat krossvord): yuklangan manba (`worker.ts sourceForJob`). */
  source?: TranslationSource;
  onStage?: (ev: GameStage) => void;
  /** LLM sarfi — `write-llm.ts` uni `BuiltFile.cost` ga yozadi. */
  onCost?: (cost: GameCost) => void;
  onUsage?: (u: LlmUsage) => void;
  /** Testlar modelni shu orqali almashtiradi (`teacher/engine.ts` naqshi). */
  complete?: CompleteFn;
  /** `false` — baholovchi chaqirilmaydi (testlar, tez rejim). */
  judge?: boolean;
  /** `false` — avto-sayqal o'tkazib yuboriladi. */
  polish?: boolean;
  now?: Date;
};

export type GameCost = ReturnType<CostMeter["toJson"]>;

export type GameBuilt = {
  doc: AcademicDoc;
  cost: GameCost;
  /**
   * Va'da qilingan MIQDORNING qanchasi yetkazildi.
   *
   * Krossvordda bu nazariy emas: to'rga sig'magan so'z `dropped` ga
   * tushadi (`CrosswordModel.dropped`), ya'ni «20 so'z» deb to'lagan
   * o'qituvchi 17 so'zli to'r olishi mumkin — farq qaytariladi.
   */
  delivered?: Delivered;
};

/**
 * Dvigatelning SHARTNOMASI — R0 da qulflangan imzo (WP-A/WP-B shunga
 * tayanadi); tanasi o'sha WP larda to'ladi.
 */
export type GameBuilder = (meta: DocMeta, values: FormValues, opts: GameBuildOpts) => Promise<GameBuilt | null>;

/* ────────────────────────── dispatch ────────────────────────── */

/**
 * Vosita id → kind → o'sha kindning dvigateli.
 *
 * Flesh kartalar shoxi DINAMIK import: WP-B uni parallel yozmoqda va
 * fayl hali bo'lmasligi mumkin — o'shanda `null` qaytadi (R0 ning stub
 * xulqi), ya'ni krossvord WP-B ni KUTMAYDI. Import statik bo'lsa,
 * fayl yo'qligida butun modul (krossvord bilan birga) yiqilardi.
 */
export const buildGameDoc: GameBuilder = async (meta, values, opts) => {
  const kind = gameKindOf(String(meta.toolId ?? ""));
  if (kind === "crossword") {
    const { buildCrosswordDoc } = await import("./crossword/engine");
    return buildCrosswordDoc(meta, values, opts);
  }
  if (kind === "flashcards") {
    try {
      /*
       * Yo'l O'ZGARUVCHIDA: WP-B ning fayli hali yo'q va uni STATIK
       * `import()` bilan yozsak `tsc` «modul topilmadi» deb butun
       * paketni yiqitardi (krossvord bilan birga). O'zgaruvchi bilan
       * modul bog'lanish vaqtida emas, ISHLASH vaqtida qidiriladi —
       * fayl paydo bo'lishi bilan shox o'zi ishlab ketadi.
       */
      const path = "./flashcards/engine";
      const mod = (await import(path)) as { buildFlashcardsDoc?: GameBuilder };
      return mod.buildFlashcardsDoc ? mod.buildFlashcardsDoc(meta, values, opts) : null;
    } catch {
      // WP-B hali ulanmagan — `write-llm.ts` mavjud xulqqa tushadi.
      return null;
    }
  }
  return null;
};
