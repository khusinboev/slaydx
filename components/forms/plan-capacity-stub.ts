// AUDIT-25: P1 merge'da lib/generation/slide-params.ts dan import qilinadi
/**
 * VAQTINCHALIK LOKAL taxminiy `planCapacity` — P1 (dvigatel paketi,
 * `lib/generation/slide-params.ts`) hali shu qatorlar bilan merge
 * bo'lmagani uchun shu fayl ular bilan bitta shartnoma (imzo) ostida
 * ishlaydi:
 *
 *   type PlanCapacityInput = {
 *     slideCount: unknown; blocks?: unknown; quizCount?: unknown;
 *     agendaSlide?: unknown; titleSlide?: unknown; speakerNotes?: unknown;
 *     internetSearch?: unknown; slidePurpose?: unknown;
 *   };
 *   function planCapacity(v: PlanCapacityInput): number; // >= 1
 *
 * Taxmin (AUDIT-25.md qaror 3): `max(1, slideCount - 2
 * - (agendaSlide!==false ? 1 : 0) - nonYieldingBlocks)`, bunda
 * `nonYieldingBlocks` — `blocks` dagi {test, adabiyotlar, diagramma}
 * kesishmasi, ustiga `quizCount > 0` bo'lsa "test", `internetSearch`
 * yoqilgan bo'lsa "adabiyotlar" qo'shiladi (dublikat hisoblanmaydi —
 * to'plam).
 *
 * ORKESTRATOR MERGE PAYTIDA: shu faylni o'chiradi va
 * `components/forms/slide-fields.tsx` dagi importni
 * `@/lib/generation/slide-params`ga almashtiradi (nom bir xil —
 * boshqa hech narsa o'zgarmaydi).
 */

/** `test`/`adabiyotlar`/`diagramma` — sig'imni "yemaydigan" bloklar (har doim o'z slaydini talab qiladi). */
const NON_YIELDING_BLOCK_IDS = new Set(["test", "adabiyotlar", "diagramma"]);

export type PlanCapacityInput = {
  slideCount: unknown;
  blocks?: unknown;
  quizCount?: unknown;
  agendaSlide?: unknown;
  titleSlide?: unknown;
  speakerNotes?: unknown;
  internetSearch?: unknown;
  slidePurpose?: unknown;
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function decodeBlockIds(v: unknown): string[] {
  return String(v ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Berilgan brif parametrlari uchun nechta reja bandi (`planItems`) sig'adi — kamida 1. */
export function planCapacity(v: PlanCapacityInput): number {
  // AUDIT-25: taxminiy chegaralar — P1 haqiqiy dvigatel bilan almashtiradi.
  const slideCount = clampInt(v.slideCount, 4, 30, 10);
  const nonYielding = new Set(decodeBlockIds(v.blocks).filter((id) => NON_YIELDING_BLOCK_IDS.has(id)));
  if (Number(v.quizCount) > 0) nonYielding.add("test");
  if (v.internetSearch === true) nonYielding.add("adabiyotlar");
  const agendaSlide = v.agendaSlide !== false; // standart — yoqilgan
  const reserved = 2 + (agendaSlide ? 1 : 0) + nonYielding.size;
  return Math.max(1, slideCount - reserved);
}
