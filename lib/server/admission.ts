/**
 * Navbatga qabul qilish qarori (C22, `audit/designs/capacity.md`).
 *
 * Ilgari har ish navbatga qo'yilishi bilan PULI YECHILARDI va keyin
 * soatlab, ETA'siz kutishi mumkin edi; bitta foydalanuvchi esa bir necha
 * ishni ketma-ket tashlab, hamma slotni band qila olardi. Endi
 * `POST /api/generations` pul yechishdan OLDIN shu qarorni so'raydi:
 *
 *   1. foydalanuvchida QUEUED + IN_PROGRESS ishlar ≥ `userMaxInflight` → 429 `user_inflight`;
 *   2. taxminiy kutish `queued × meanServiceSec ÷ totalSlots` > `maxWaitSec` → 429 `queue_full`.
 *
 * SOF funksiya — hech narsa o'qimaydi/yozmaydi, shuning uchun chegaralar
 * bazasiz sinaladi (`tests/admission.test.mts`). Sanoqlarni chaqiruvchi
 * (`enqueueGeneration`) tranzaksiya ichida beradi.
 */

export type AdmissionLimits = {
  /** Bir foydalanuvchining bir vaqtdagi (QUEUED + IN_PROGRESS) ishlari chegarasi. */
  userMaxInflight: number;
  /** Barcha worker slotlari (`QUEUE_TOTAL_SLOTS`). */
  totalSlots: number;
  /** Bitta ishning o'rtacha davomiyligi, soniya (`QUEUE_MEAN_SERVICE_SEC`). */
  meanServiceSec: number;
  /** Shundan uzoq kutish va'da qilinmaydi — 429 (`QUEUE_MAX_WAIT_SEC`). */
  maxWaitSec: number;
};

export type AdmissionInput = AdmissionLimits & {
  /** Shu foydalanuvchining QUEUED + IN_PROGRESS ishlari. */
  userInflight: number;
  /** Butun navbatdagi QUEUED ishlar. */
  queued: number;
};

export type AdmissionReject = {
  ok: false;
  code: "queue_full" | "user_inflight";
  /** `Retry-After` sarlavhasi va javob tanasi uchun, soniya. */
  retryAfterSec: number;
  /** Foydalanuvchiga ko'rsatiladigan matn. */
  error: string;
};

export type AdmissionDecision = { ok: true; waitSec: number } | AdmissionReject;

/** Eng qisqa `Retry-After`: undan tez qayta urinish baribir foyda bermaydi. */
const MIN_RETRY_SEC = 30;

/** Slot soni 0 yoki manfiy bo'lib qolsa ham bo'lishda cheksizlik chiqmasin. */
function slotsOf(totalSlots: number): number {
  return Math.max(1, Math.floor(totalSlots) || 1);
}

/** `ahead` ta ish oldinda bo'lsa, slot bo'shashigacha taxminiy kutish (soniya). */
export function estimatedWaitSec(
  ahead: number,
  limits: Pick<AdmissionLimits, "totalSlots" | "meanServiceSec">,
): number {
  return (Math.max(0, ahead) * Math.max(0, limits.meanServiceSec)) / slotsOf(limits.totalSlots);
}

/**
 * Poll javobidagi `etaSec` — ish BOSHLANISHIGACHA taxminiy soniya.
 * `queuePosition` 1 dan boshlanadi: 1-o'rindagi ish ham bitta slot
 * bo'shashini kutadi (`meanServiceSec ÷ totalSlots`). Qabul qarori bilan
 * bir xil formula — foydalanuvchiga aytilgan va'da qabul chegarasidan
 * farq qilmasin.
 */
export function queueEtaSec(
  queuePosition: number,
  limits: Pick<AdmissionLimits, "totalSlots" | "meanServiceSec">,
): number {
  return Math.ceil(estimatedWaitSec(queuePosition, limits));
}

export function admissionDecision(input: AdmissionInput): AdmissionDecision {
  const cap = Math.max(1, Math.floor(input.userMaxInflight) || 1);
  if (input.userInflight >= cap) {
    return {
      ok: false,
      code: "user_inflight",
      retryAfterSec: Math.max(MIN_RETRY_SEC, Math.ceil(input.meanServiceSec)),
      error: `Sizda allaqachon ${input.userInflight} ta hujjat navbatda yoki tayyorlanmoqda — ulardan biri tugagach yangisini boshlang.`,
    };
  }

  const waitSec = estimatedWaitSec(input.queued, input);
  if (waitSec > input.maxWaitSec) {
    /*
     * Navbat `totalSlots ÷ meanServiceSec` ish/soniya tezlikda kamayadi,
     * ya'ni kutish har soniyada ~1 soniyaga qisqaradi: chegaraga tushish
     * uchun `waitSec − maxWaitSec` soniya kerak.
     */
    const retryAfterSec = Math.max(MIN_RETRY_SEC, Math.ceil(waitSec - input.maxWaitSec));
    const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
    return {
      ok: false,
      code: "queue_full",
      retryAfterSec,
      error: `Navbat to'la — taxminan ${minutes} daqiqadan keyin qayta urinib ko'ring. Pul yechilmadi.`,
    };
  }
  return { ok: true, waitSec };
}
