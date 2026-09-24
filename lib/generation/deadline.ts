/**
 * ISH MUDDATI yordamchilari (audit EXT-03, W3 shartnomasi).
 *
 * Qoida (barcha dvigatellar uchun bir xil):
 *  - `buildArtifact` dan kelgan ISH muddati (`opts.deadline`, epoch ms)
 *    har LLM chaqiruviga (`complete`/`llmComplete`/`llmStream`) `deadline`
 *    sifatida uzatiladi — zanjir urinish/qayta urinish/zaxirani muddatdan
 *    oshirmaydi va vaqt tugasa `DeadlineError` otadi;
 *  - ASOSIY yozuv (hujjat matni) `DeadlineError` ni YUTMAYDI — ish aniq
 *    «vaqt tugadi» bilan yiqiladi va pul qaytadi, yarim hujjat
 *    `COMPLETED` bo'lib chiqmaydi;
 *  - IXTIYORIY bosqich (tadqiqot, baholovchi, sayqal) o'zining mavjud
 *    «vaqt yo'q — o'tkazib yuboramiz» yo'lini saqlaydi: u yerda
 *    `DeadlineError` ham o'sha yo'lga tushadi (hujjat to'liq, faqat
 *    sayqalsiz/hisobotsiz).
 *  - BOSQICH ichki byudjeti (masalan slayd matniga ajratilgan ulush)
 *    tugashi — eski yumshoq xatti-harakat; faqat ISH muddati tugashi xato.
 */
import { CHAIN_MIN_ATTEMPT_MS, CHAIN_SAFETY_MS, DeadlineError } from "./llm/chain";

export { DeadlineError };

/** Yangi LLM chaqiruvi uchun ish muddatigacha kamida shuncha vaqt kerak (zanjir bilan bir xil). */
export const JOB_MIN_CALL_MS = CHAIN_MIN_ATTEMPT_MS + CHAIN_SAFETY_MS;

export function isDeadlineError(e: unknown): e is DeadlineError {
  return e instanceof DeadlineError || (e instanceof Error && e.name === "DeadlineError");
}

/**
 * `.catch(nullUnlessDeadline)` — ixtiyoriy/qayta urinishli chaqiruvning
 * oddiy xatosi `null` («model javob bermadi»), ish muddati tugashi esa
 * YUQORIGA otiladi.
 */
export function nullUnlessDeadline(e: unknown): null {
  if (isDeadlineError(e)) throw e;
  return null;
}

/**
 * Ish muddatida yangi chaqiruvga joy qolmagan bo'lsa `DeadlineError`.
 * Muddat berilmagan (so'rov yo'li, testlar) — hech narsa qilmaydi.
 */
export function assertJobTime(deadline: number | undefined, role: string, minMs: number = JOB_MIN_CALL_MS): void {
  if (deadline === undefined) return;
  const left = deadline - Date.now();
  if (left < minMs) throw new DeadlineError(role, left);
}
