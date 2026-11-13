/**
 * The examiner's short lines that both the bot (`persona.ts`, HTML messages) and the web chat
 * (components/domla/DomlaChat.tsx) say -- plain text, no HTML, no server import, so the page and the bot read ONE source.
 */
import type { Grade } from "./rules";

/** The short reaction to an answer, by score. */
export function reactionLine(score: number): string {
  if (score >= 5) return "Barakalla. To'liq javob.";
  if (score === 4) return "Yaxshi. Deyarli to'liq.";
  if (score === 3) return "Hm… qisman to'g'ri.";
  if (score === 2) return "Zaif. Yana bir oz o'ylash kerak edi.";
  if (score === 1) return "Savolga deyarli to'g'ri kelmadi.";
  return "Bu javob emas. Keyingi savolga o'tamiz.";
}

/** «Domla senga 4 qo'ydi.» and the joke that goes with the grade. */
export const HEADLINE: Record<Grade, string> = {
  5: "Domla senga 5 qo'ydi. Hatto o'zi ham hayron bo'ldi.",
  4: "Domla senga 4 qo'ydi. Yaxshi, lekin 5 ga bir qadam qoldi.",
  3: "Domla senga 3 qo'ydi. O'tding, lekin domla qoshini chimirib qoldi.",
  2: "Domla senga 2 qo'ydi. Xafa bo'lma — jurnalga yozilmaydi, qayta tayyorlanib kel.",
};

export const headline = (g: Grade): string => HEADLINE[g];
