/**
 * Payme webhook'i qabul qiladigan kalitlar (C11, EXT-01) — sof funksiya.
 *
 * Sinov (sandbox) kaliti FAQAT `sandbox` yoqilganda ro'yxatga kiradi.
 * Ilgari ikkalasi so'zsiz qabul qilinardi: prod `.env` da
 * `PAYME_TEST_KEY` qolib ketsa, test kassadan kelgan «to'lov» haqiqiy
 * balansga tushardi — ochiq test karta bilan cheksiz tanga.
 *
 * Alohida faylda: uni ham webhook (`payments.ts`), ham «Payme yoqilganmi»
 * (`env.ts paymentsConfigured`) o'qiydi — `env.ts` esa `payments.ts` ni
 * import qila olmaydi (u `db`/`env` ga bog'liq, aylanma import bo'lardi).
 */
export function acceptedPaymeKeys(cfg: { key: string; testKey: string; sandbox: boolean }): string[] {
  return [cfg.key, ...(cfg.sandbox ? [cfg.testKey] : [])].filter(Boolean);
}
