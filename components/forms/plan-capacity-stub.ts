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
 *
 * Reviewer CHANGES-1 (2026-09-24): forma va server `planItems` bo'yicha
 * kelishmasligi (qavat 1 yoki 3?) — qaror: QAVAT 1. P1
 * `lib/generation/slide-params.ts`ga xuddi shu imzo bilan
 * `effectivePlanItems(raw, capacity)` qo'shadi; shu yerdagi nusxa
 * MERGE PAYTIDA yuqoridagi bilan birga o'chadi (import xuddi
 * `planCapacity` kabi almashtiriladi).
 *
 * P1 yakuniy hisoboti (2026-09-24, A3-01/A3-02): `quizCount`/`agendaSlide`
 * ANIQ qiymat berilsa USTUN (0/`false` ham — "aniq yo'q" degani), lekin
 * `undefined` bo'lsa taqdimot turi standartidagi `test`/`reja` bloklaridan
 * kelib chiqadi (`purposeDefaults`). Forma endi bu ikkalasini foydalanuvchi
 * tegmaguncha yubormaydi (`SlideComposer.tsx initialValues`), shu sabab
 * shu yerdagi hisob ham xuddi shu qoidani qo'llashi kerak — aks holda
 * sig'im ko'rsatkichi (`PlanItemsField` tooltip) serverga mos kelmaydi.
 */

/** `test`/`adabiyotlar`/`diagramma` — sig'imni "yemaydigan" bloklar (har doim o'z slaydini talab qiladi). */
const NON_YIELDING_BLOCK_IDS = new Set(["test", "adabiyotlar", "diagramma"]);
const PLAN_ITEMS_MAX = 6;
const PLAN_ITEMS_DEFAULT = 5;
/** `slidePurpose` → standart bloklar (AUDIT-25 P1 A3-01/A3-02 fallback manbasi) — `purposeDefaults`ning minimal nusxasi. */
const PURPOSE_BLOCKS: Record<string, readonly string[]> = {
  general: ["reja"],
  lesson: ["reja", "maqsadlar", "motivatsiya", "amaliyot", "uyga_vazifa"],
  lecture: ["reja", "maqsadlar", "adabiyotlar"],
  seminar: ["reja", "amaliyot", "jadval"],
  open_lesson: ["reja", "maqsadlar", "motivatsiya", "amaliyot", "test", "uyga_vazifa"],
  report: ["reja", "diagramma", "jadval"],
  training: ["maqsadlar", "motivatsiya", "amaliyot", "test"],
  defense: ["reja", "diagramma", "jadval", "adabiyotlar"],
  pitch: ["motivatsiya", "diagramma"],
};
function purposeBlocksOf(purpose: unknown): readonly string[] {
  return PURPOSE_BLOCKS[String(purpose ?? "general")] ?? PURPOSE_BLOCKS.general;
}

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
  const purposeBlocks = purposeBlocksOf(v.slidePurpose);
  const nonYielding = new Set(decodeBlockIds(v.blocks).filter((id) => NON_YIELDING_BLOCK_IDS.has(id)));
  // A3-01: aniq son USTUN (0 ham "aniq yo'q"); tegilmagan (`undefined`) bo'lsa taqdimot turi standartidan.
  const testActive = v.quizCount === undefined ? purposeBlocks.includes("test") : Number(v.quizCount) > 0;
  if (testActive) nonYielding.add("test");
  if (v.internetSearch === true) nonYielding.add("adabiyotlar");
  // A3-02: aniq true/false USTUN; tegilmagan bo'lsa taqdimot turi standartidan («pitch»/«training» — rejasiz).
  const agendaActive = v.agendaSlide === undefined ? purposeBlocks.includes("reja") : v.agendaSlide === true;
  const reserved = 2 + (agendaActive ? 1 : 0) + nonYielding.size;
  return Math.max(1, slideCount - reserved);
}

/**
 * Foydalanuvchi tanlagan xom `planItems` qiymatini sig'imga tushiradi —
 * QAVAT 1 (reviewer CHANGES-1 qarori): `[1, PLAN_ITEMS_MAX]`ga qisiladi,
 * so'ng `max(1, capacity)` bilan kesishadi. Forma va server AYNAN shu
 * funksiyani chaqirishi kerak — aks holda ikkalasi kelishmaydi (masalan
 * eski server qavat 3 bilan qisar, forma esa 1 ni ko'rsatardi).
 */
export function effectivePlanItems(raw: unknown, capacity: number): number {
  const clamped = clampInt(raw, 1, PLAN_ITEMS_MAX, PLAN_ITEMS_DEFAULT);
  return Math.min(clamped, Math.max(1, capacity));
}
