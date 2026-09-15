/**
 * BAHOLOVCHIGA MATN NAMUNASI (AUDIT-19 R0-A, X-4) — `sampleForJudge`.
 *
 * Baholovchi promptiga butun hujjat sig'maydi (kurs ishi 40 000+ so'z,
 * chegara ≈25 000 belgi). Kesish qoidasi:
 *
 *   1. Hammasi sig'sa — hech narsa kesilmaydi.
 *   2. Aks holda har guruh O'Z ULUSHIDA oxiridan kesiladi (proporsional,
 *      kamida `MIN_CHARS`) — ilgari boshidan N belgi olinardi va XULOSA
 *      umuman ko'rinmasdi.
 *   3. YANGI (X-4): KIRISH (birinchi) va XULOSA (oxirgi) guruhlari to'liq
 *      qoladi — ularning ulushi o'rtadagi bo'limlardan olinadi. Sabab:
 *      baholovchining «maqsad ↔ natija ↔ xulosa mosligi» va «yangilik»
 *      mezonlari aynan shu ikki bo'limga qaraydi; kurs ishida ular
 *      proporsional kesimda 2–3 % ga qisqarib, mezon ko'r qolardi.
 *      Chekka bo'limlarning o'zi byudjetga sig'masa (o'rtaga `MIN_CHARS`
 *      ham qolmasa) — 2-qoidaga qaytiladi, aks holda o'rta butunlay
 *      yo'qolardi.
 */

/** Kesilganda ham har guruhdan shuncha belgi qoladi. */
export const MIN_CHARS = 200;

export type SampleGroup = { id: string; title: string; lines: string[] };
export type SampledGroup = { id: string; title: string; text: string; truncated: boolean };

export function sampleForJudge(groups: SampleGroup[], maxChars: number): SampledGroup[] {
  const texts = groups.map((g) => g.lines.join("\n"));
  const out = (cuts: number[]): SampledGroup[] =>
    groups.map((g, i) => {
      const t = texts[i];
      const cut = cuts[i] >= t.length ? t : t.slice(0, cuts[i]);
      return { id: g.id, title: g.title, text: cut, truncated: cut.length < t.length };
    });

  const total = texts.reduce((n, t) => n + t.length, 0);
  if (total <= maxChars) return out(texts.map((t) => t.length));

  const proportional = (idx: number[], budget: number): number[] => {
    const sum = idx.reduce((n, i) => n + texts[i].length, 0);
    const scale = sum > budget ? budget / sum : 1;
    const cuts = texts.map((t) => t.length);
    for (const i of idx) cuts[i] = Math.max(MIN_CHARS, Math.floor(texts[i].length * scale));
    return cuts;
  };

  const all = texts.map((_, i) => i);
  // Chekka bo'limlarni to'liq saqlash uchun kamida bitta o'rta guruh kerak.
  if (groups.length < 3) return out(proportional(all, maxChars));
  const middle = all.slice(1, -1);
  const edges = texts[0].length + texts[texts.length - 1].length;
  if (edges + MIN_CHARS * middle.length > maxChars) return out(proportional(all, maxChars));
  return out(proportional(middle, maxChars - edges));
}
