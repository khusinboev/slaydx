/**
 * O'YIN DVIGATELI (AUDIT-21 R0, AUDIT-22 WP-D) — `buildGameDoc`.
 *
 * Bu fayl SHARTNOMA: imzo (`GameBuilder`), `GameBuildOpts` va `null`
 * xulqi shu yerda qulflangan, TANALARI esa kind papkalarida —
 * `crossword/`, `flashcards/`, `sorting/`, `listening/`. Aynan shu
 * naqsh AUDIT-20 R0 da ishlagan: `write-llm.ts` dispatchi, byudjet,
 * ko'ruvchi va forma dvigateldan OLDIN ulanadi, shuning uchun ish
 * paketlari bir-birini kutmasdan parallel ketadi.
 *
 * To'rtala dvigatelda bosqichlar BIR XIL (`onStage` foizlari):
 *   1 kirish       0→10   forma → `*Input` (+ fayl manbasi, krossvord)
 *   2 yozish      10→55   LLM: so'z+savol, karta, toifa yoki topshiriq
 *   3 qurish      55→75   to'r algoritmi, varaqlar yoki bo'limlar
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
import type { TtsProvider } from "../tts/types";
import { gameKindOf } from "./registry";
import { buildCrosswordDoc } from "./crossword/engine";
import { buildFlashcardsDoc } from "./flashcards/engine";
import { buildSortingDoc } from "./sorting/engine";
import { buildListeningDoc } from "./listening/engine";

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
  /**
   * TTS adapteri (tinglash o'yini) — SEAM, majburiy emas.
   *
   * Berilmasa dvigatel audiosiz ishlaydi va `ListeningItem.audioAssetId`
   * bo'sh qoladi: bosma varaq baribir chiqadi, interaktiv ekran esa
   * audio yo'qligini ko'rsatadi. Provayder zanjiri (`tts/chain.ts`)
   * WP-A da, kalitlar kelgach ulanadi — dvigatel esa BUGUN sinaladi
   * (testda soxta provayder beriladi).
   */
  tts?: TtsProvider;
  /**
   * Sintez qilingan baytni AKTIVGA yozadi va id qaytaradi.
   *
   * Nega alohida seam: `putAssetBytes(generationId, …)` server moduli va
   * `generationId` ni faqat chaqiruvchi (`write-llm.ts`/`worker.ts`)
   * biladi. Dvigatel izomorf bo'lib qolishi kerak — u shu funksiyani
   * chaqiradi, bazani BILMAYDI.
   */
  putAsset?: (bytes: Uint8Array, mime: string) => Promise<string>;
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
 * Importlar STATIK va bu AUDIT-21 smoke saboqi: dinamik `import()`
 * worker qadog'ida (`.next/standalone`) jimgina yiqilib, foydalanuvchiga
 * «AI javob bermadi» berardi — modul yo'li bundle'ga umuman
 * tushmagan edi. Statik importda bunday xato QURISH paytida ko'rinadi,
 * ishlab turgan navbatda emas.
 *
 * `null` — kind noma'lum (o'yin vositasi emas). Dvigatelning O'ZI ham
 * `null` qaytarishi mumkin (kalitsiz muhit, model javob bermadi, sifat
 * darvozasi) va chaqiruvchi ikkalasini bir xil ko'radi: `write-llm.ts`
 * `null` qaytaradi, `buildArtifact` esa mavjud xulqni beradi.
 */
export const buildGameDoc: GameBuilder = async (meta, values, opts) => {
  const kind = gameKindOf(String(meta.toolId ?? ""));
  if (kind === "crossword") return buildCrosswordDoc(meta, values, opts);
  if (kind === "flashcards") return buildFlashcardsDoc(meta, values, opts);
  if (kind === "sorting") return buildSortingDoc(meta, values, opts);
  if (kind === "listening") return buildListeningDoc(meta, values, opts);
  return null;
};
