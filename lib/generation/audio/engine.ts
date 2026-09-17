/**
 * AUDIO DVIGATELI (AUDIT-22) — `buildAudioArtifact`.
 *
 * R0 da bu fayl SHARTNOMA: imzo va `null` xulqi qulflanadi, TANASI esa
 * WP-A da (kalitlar kelgach) to'ladi. Aynan shu naqsh AUDIT-20/21 R0 da
 * ishlagan: dispatch, byudjet, ko'ruvchi va forma dvigateldan OLDIN
 * ulanadi, shuning uchun WP lar bir-birini kutmasdan ketadi.
 *
 * Nega `BuiltFile` (boshqa oilalardagi `AcademicDoc` emas): chiqish
 * DOCX emas, MP3 — `renderDocx` yo'li bu oilaga umuman tegishli emas.
 * `image`/`infographic` bilan ayni naqsh: dvigatel baytni O'ZI beradi,
 * `index.ts` esa faqat xato matnini biladi.
 *
 * Rejalashtirilgan bosqichlar (`onStage` foizlari, WP-A):
 *   1 kirish       0→8    forma → `AudioInput` (rejim, janr, daqiqa)
 *   2 ssenariy     8→45   LLM: skelet bo'yicha replikalar (150 so'z/daq)
 *   3 hisobot     45→60   `review.ts` (qoidalar + baholovchi)
 *   4 sayqal      60→68   `polish.ts`
 *   5 sintez      68→95   `tts/chain.ts`: bo'laklar → MP3 birlashtirish
 *
 * `null` — dvigatel ishlamadi (TTS/LLM kaliti yo'q, model javob
 * bermadi, sifat darvozasidan o'tmadi). Chaqiruvchi (`index.ts`) shunda
 * MAVJUD xulqni beradi: «Audio yaratilmadi» xatosi va kredit qaytishi.
 * Yangi «dvigatel hali yo'q» matni ATAYLAB kiritilmadi — u
 * foydalanuvchiga hech narsa bermaydi.
 */
import type { FormValues, ToolConfig } from "../../types";
import type { BuiltFile, DocMeta } from "../types";
import type { TranslationSource } from "../source-types";
import type { CompleteFn } from "../research/pipeline";
import type { CostMeter, LlmUsage } from "../llm-roles";
import { audioKindOf } from "./registry";

/* ────────────────────────── shartnoma ────────────────────────── */

/** `GameStage`/`TeacherStage` bilan AYNI shakl — chaqiruvchi bittasini uzatadi. */
export type AudioStage = { progress: number; step: string };

export type AudioBuildOpts = {
  deadline: number;
  /** Fayl rejimi (podkast): yuklangan manba (`worker.ts sourceForJob`). */
  source?: TranslationSource;
  onStage?: (ev: AudioStage) => void;
  /** LLM + TTS sarfi — chaqiruvchi uni `BuiltFile.cost` ga yozadi. */
  onCost?: (cost: AudioCost) => void;
  onUsage?: (u: LlmUsage) => void;
  /** Testlar modelni shu orqali almashtiradi (`games/engine.ts` naqshi). */
  complete?: CompleteFn;
  /** `false` — baholovchi chaqirilmaydi (testlar, tez rejim). */
  judge?: boolean;
  /** `false` — avto-sayqal o'tkazib yuboriladi. */
  polish?: boolean;
  now?: Date;
};

export type AudioCost = ReturnType<CostMeter["toJson"]>;

/**
 * Dvigatelning SHARTNOMASI — R0 da qulflangan imzo (WP-A shunga
 * tayanadi); tanasi o'sha WP da to'ladi.
 *
 * `BuiltFile.delivered` VA'DA qilingan daqiqa bo'yicha hisoblanadi
 * (`AudioModel.seconds` ↔ `durationMin × 60`): «5 daqiqa» deb to'lagan
 * foydalanuvchi 2 daqiqalik fayl olsa farq qaytariladi.
 */
export type AudioBuilder = (tool: ToolConfig, meta: DocMeta, values: FormValues, opts: AudioBuildOpts) => Promise<BuiltFile | null>;

/* ────────────────────────── dispatch ────────────────────────── */

/**
 * Vosita id → kind → o'sha kindning dvigateli.
 *
 * R0 da TANA YO'Q va u ATAYLAB `null` qaytaradi: TTS kalitlari kelmagan
 * (`tts.md` §6), ya'ni sintez bosqichini bugun yozish sinovsiz kod
 * bo'lardi. Shox WP-A da shu yerga qo'shiladi (`audio/podcast.ts`,
 * `audio/greeting.ts` → `tts/chain.ts`), imzo esa o'zgarmaydi.
 *
 * Kind tekshiruvi HOZIRDAN bor: boshqa oilaning vositasi bu yo'lga
 * kirib qolsa (dispatch xatosi) u jimgina audio quvuriga tushmaydi.
 */
export const buildAudioArtifact: AudioBuilder = async (tool, meta) => {
  const kind = audioKindOf(String(meta.toolId ?? tool.id));
  if (!kind) return null;
  return null;
};
