import type { SlideLayer } from "@/lib/generation/slide-layout";

/**
 * Jonli «yozilmoqda» effektining SOF yadrosi.
 *
 * Matn maketda qatlamlarga bo'lingan (`planSlide` → `SlideLayer[]`):
 * sarlavha, kicker, bandlar ro'yxati… Ular ekranda ustma-ust emas, MA'NO
 * TARTIBIDA yoziladi — avval sarlavha to'ladi, keyin bandlar. Shuning
 * uchun byudjet KUMULYATIV: umumiy `chars` belgi qatlamlar bo'ylab navbat
 * bilan taqsimlanadi.
 *
 * Bu yerda React ham, DOM ham, vaqt ham YO'Q — `useReveal` faqat 0..1
 * kasrni beradi, `SlideCanvas` uni belgiga aylantiradi va shu funksiyani
 * chaqiradi. Shu sababli sinov ham sof: yig'indi va tartib.
 */

/** Bitta qatlamdagi matn belgilari soni (matn bo'lmagan qatlam → 0). */
export function layerChars(layer: SlideLayer): number {
  if (layer.t !== "text") return 0;
  if (layer.lines?.length) return layer.lines.reduce((n, l) => n + l.length, 0);
  return layer.text?.length ?? 0;
}

/** Slaydning to'liq matn hajmi — `reveal` kasrini belgiga o'girish uchun. */
export function totalChars(layers: SlideLayer[]): number {
  let n = 0;
  for (const l of layers) n += layerChars(l);
  return n;
}

/**
 * `layers` bilan BIR XIL uzunlikdagi massiv: har qatlamga necha belgi
 * ko'rsatilishi. Matn bo'lmagan qatlamlar doim 0 (ular byudjet yemaydi —
 * rasm va to'rtburchaklar darhol chiziladi).
 *
 * Xossalar (sinovda tekshiriladi):
 *  - yig'indi = `min(chars, totalChars(layers))`;
 *  - tartib: i-qatlam to'lmaguncha (i+1) noldan chiqmaydi;
 *  - `chars <= 0` → hammasi 0; `chars >= total` → har qatlam to'liq.
 */
export function revealBudgets(layers: SlideLayer[], chars: number): number[] {
  let left = Number.isFinite(chars) ? Math.max(0, Math.floor(chars)) : 0;
  return layers.map((l) => {
    const n = layerChars(l);
    if (n === 0) return 0;
    const give = Math.min(n, left);
    left -= give;
    return give;
  });
}

/**
 * Ro'yxat qatlamini byudjetga qisqartirish.
 *
 * Yarim qator QOLADI (aynan shu «yozilmoqda» tuyg'usini beradi), lekin
 * bitta belgi ham tegmagan qatorlar umuman chizilmaydi: bo'sh `<li>`
 * markyorlari ro'yxat ostida osilib qolmasin.
 */
export function clipLines(lines: string[], budget: number): { line: string; i: number }[] {
  let left = Math.max(0, budget);
  const out: { line: string; i: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (left <= 0) break;
    const line = lines[i];
    out.push({ line: line.slice(0, left), i });
    left -= line.length;
  }
  return out;
}
