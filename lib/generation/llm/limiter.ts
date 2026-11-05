/**
 * Provayder bo'yicha BIR VAQTDAGI so'rovlar chegarasi — audit C28
 * (EXT-09, SCALE-06).
 *
 * Muammo: parallellik faqat BITTA ish ichida cheklangan edi
 * (`mapPool(3)`, rasm yo'laklari 3–5). Worker'da bir necha ish birga
 * yursa (2 jarayon × 4 slot × 3–5 yo'lak) bitta provayderga o'nlab so'rov
 * bir paytda ketadi; kvota to'lganda Gemini 429 qaytaradi va qisqa
 * qayta urinishlardan keyin paragraf/rasm bo'sh qoladi → ish FAILED +
 * pul qaytarish. Bu yerdagi semafor ortiqcha so'rovni QISQA NAVBATGA
 * qo'yadi: hamma ish biroz sekinlashadi, lekin yiqilmaydi.
 *
 * Chegara JARAYON ichida (DB/Redis'siz). Qiymatlar — konstanta, bitta
 * joyda; ikki worker jarayoni bo'lgani uchun provayderga jami bosim
 * taxminan ikki barobar.
 */

/** Provayder → bir jarayondagi eng ko'p parallel so'rov. */
export const PROVIDER_MAX_INFLIGHT: Record<string, number> = {
  gemini: 10,
  "gemini-image": 6,
  // GPT Image: default Build tier allows 20 images per minute.
  "openai-image": 4,
  anthropic: 4,
  // Fallback text providers take Gemini's whole text load during an outage.
  qwen: 10,
  deepseek: 10,
};

/** Jadvalda yo'q provayder uchun. */
export const DEFAULT_MAX_INFLIGHT = 6;

import { Semaphore } from "../../studio-core/limiter";

export { Semaphore };

const REGISTRY = new Map<string, Semaphore>();

/** Provayder bo'yicha jarayondagi YAGONA semafor. */
export function limiterFor(name: string): Semaphore {
  let s = REGISTRY.get(name);
  if (!s) {
    s = new Semaphore(PROVIDER_MAX_INFLIGHT[name] ?? DEFAULT_MAX_INFLIGHT);
    REGISTRY.set(name, s);
  }
  return s;
}

/** State of one limiter as published in `process_heartbeats.limiters` (admin system page). */
export type LimiterSnapshot = { name: string; active: number; waiting: number; max: number };

/** Read-only snapshot of every limiter in this process, sorted by name. */
export function snapshotLimiters(): LimiterSnapshot[] {
  return [...REGISTRY.entries()]
    .map(([name, s]) => ({ name, active: s.active, waiting: s.waiting, max: s.max }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Testlar uchun: semaforlarni unutadi (keyingi `limiterFor` jadvaldan qayta o'qiydi). */
export function resetLimiters(): void {
  REGISTRY.clear();
}
