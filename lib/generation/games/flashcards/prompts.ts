/**
 * FLESH KARTALAR PROMPTLARI (AUDIT-21 WP-B) — `teacher/prompts.ts` naqshi.
 *
 * Ko'rsatmalar INGLIZCHA, birinchi qator `languageDirective`: tuzilma
 * qoidalarini (JSON sxemasi, belgi chegaralari) model inglizcha
 * ko'rsatmada ishonchliroq bajaradi, chiqish tilini esa birinchi qator
 * qat'iy belgilaydi.
 *
 * BELGI CHEGARALARI promptda AYTILADI va hisobotda QAYTA tekshiriladi
 * (`review.ts frontLength`/`backLength`): ular maketning fizik
 * chegarasi — orqa yuz 200 belgidan oshsa, matn 92×65 mm katakdan
 * chiqib ketadi va DOCX qatori uni KESADI (`HeightRule.EXACT`).
 * Shuning uchun bu «uslub tavsiyasi» emas, qattiq talab.
 *
 * FAYL REJIMI YO'Q (AUDIT-21 §6 ochiq savol 5): kartalar faqat
 * MAVZUDAN tuziladi — `lib/tools.ts` da flesh kartalar vositasida
 * `modes` e'lon qilinmagan, ya'ni `worker.ts sourceForJob` bu vositaga
 * manba fayl umuman bermaydi. `sourceBlock` shu sababli bu faylda
 * YO'Q: chaqirilmaydigan prompt bo'lagi yozilsa, uni kim nima bilan
 * to'ldirishi noma'lum bo'lib qolardi (krossvordda u WP-A da bor).
 */
import { languageDirective } from "../../i18n";
import { GAME_LIMITS } from "../types";
import type { CardsTypeSpec } from "../registry";
import type { FlashcardsInput } from "./input";

export type FlashcardsContext = {
  spec: CardsTypeSpec;
  input: FlashcardsInput;
};

/* ══════════════════════════ tizim prompti ══════════════════════════ */

export function cardsSystemPrompt(ctx: FlashcardsContext): string {
  const { input, spec } = ctx;
  const lines = [
    languageDirective(input.language),
    "You are an experienced Uzbek subject teacher preparing a set of printable revision flashcards for your own pupils.",
    `Topic: «${input.topic}». Subject: ${input.subject || "infer from the topic"}.`,
    `Card type: ${spec.label.en} (${spec.id}).`,
    "RULES (strict):",
    "1. HONESTY: never invent a textbook page or chapter number, a standard or dictionary reference, an author name, a real organisation, a real person or a real statistic. If you are not sure a number is correct, leave it out — a card without a number is useful, a card with a wrong number is harmful.",
    "2. ONE IDEA PER CARD: the pupil holds one card at a time. A card that packs two terms or two questions cannot be learned or self-checked.",
    `3. AUDIENCE: ${input.grade > 0 ? `grade ${input.grade}` : "the stated level"} — vocabulary and difficulty must match it; no unexplained jargon on either side.`,
    "4. LENGTH IS PHYSICAL: the cards are printed 8 per A4 sheet and cut out. Text longer than the stated limits does not fit on the card and is cut off by the printer, so the limits are hard requirements, not style advice.",
    "5. Output: return ONLY the JSON requested — no markdown fences, no commentary, no explanation before or after.",
    `TYPE RULES (${spec.label.en}):`,
    ...spec.guidance.map((g, i) => `${i + 1}. ${g}`),
  ];
  if (input.extra) lines.push(`TEACHER'S ADDITIONAL REQUEST (follow it unless it conflicts with the rules above): ${input.extra}`);
  return lines.filter(Boolean).join("\n");
}

/* ══════════════════════════ yozish ══════════════════════════ */

/**
 * Kartalarni so'rash. `already` — allaqachon olingan old yuzlar:
 * yetishmagan kartalar uchun IKKINCHI so'rov yuborilganda model
 * o'sha atamalarni qaytadan bermasin (`noDuplicate` qoidasi).
 */
export function cardsUserPrompt(ctx: FlashcardsContext, count: number, already: readonly string[]): string {
  const i = ctx.input;
  const [frontMin, frontMax] = ctx.spec.limits.frontChars;
  const [backMin, backMax] = ctx.spec.limits.backChars;
  const qa = i.cardType === "qa";
  const lines = [
    "Write the flashcards. Return ONLY this JSON:",
    `{"cards":[{"front":"","back":""${i.includeExample ? ',"example":""' : ""}}]}`,
    `${count} cards on «${i.topic}»${i.subject && i.subject !== i.topic ? ` (subject: ${i.subject})` : ""}${i.grade > 0 ? `, at grade ${i.grade} level` : ""}.`,
    qa
      ? `front: ONE complete question, ${frontMin}–${frontMax} characters, ending in a question mark. It must be answerable without seeing the back.`
      : `front: the TERM only, ${frontMin}–${frontMax} characters — no article, no explanation, no trailing punctuation.`,
    qa
      ? `back: the answer, ${backMin}–${backMax} characters — state the fact and, in one short clause, why it is so.`
      : `back: the definition, ${backMin}–${backMax} characters — category first, then the distinguishing feature. NEVER start it with the term itself.`,
    i.includeExample
      ? `example: one short sentence (at most ${GAME_LIMITS.cardExampleCharsMax} characters) that USES the term in a real subject context — not a paraphrase of the back side.`
      : "",
    "Every front must be different from every other front: two cards asking about the same thing teach nothing on the second pass.",
    already.length ? `ALREADY WRITTEN — do NOT repeat these fronts:\n${already.join("; ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/* ══════════════════════════ qayta yozish (sayqal) ══════════════════════════ */

/**
 * Sayqal so'rovi — kartalar MODEL SHAKLIDA qaytariladi, nasr sifatida
 * EMAS (AUDIT-20 glossariy saboqi).
 *
 * `teacher/polish.ts` dagi umumiy nasr yo'li (`blocksFromLlm`) glossariy
 * atamalarining `h3` sarlavhalarini yeb qo'ygan edi — jonli sinovda
 * 20 atamadan 18 tasining nomi yo'qolgan. Kartada bu yanada qattiqroq
 * bo'lardi: «old yuz» va «orqa yuz» nasr ichida ajralmaydi, ya'ni butun
 * to'plam bir paragrafga aylanardi. Shuning uchun model AYNAN shuncha
 * karta qaytarishi va tartib SAQLANISHI talab qilinadi.
 */
export function cardsRewritePrompt(ctx: FlashcardsContext, cards: readonly { front: string; back: string; example?: string }[], instruction: string): string {
  const i = ctx.input;
  const [frontMin, frontMax] = ctx.spec.limits.frontChars;
  const [backMin, backMax] = ctx.spec.limits.backChars;
  return [
    "Improve the flashcard set below. Return ONLY this JSON:",
    `{"cards":[{"front":"","back":""${i.includeExample ? ',"example":""' : ""}}]}`,
    `EXACTLY ${cards.length} cards, in the SAME ORDER as given. Keep every card about the same thing it is about now — this is a revision, not a new set.`,
    `front: ${frontMin}–${frontMax} characters. back: ${backMin}–${backMax} characters.`,
    i.includeExample ? `example: at most ${GAME_LIMITS.cardExampleCharsMax} characters.` : "",
    `WHAT TO FIX: ${instruction}`,
    "CURRENT CARDS:",
    ...cards.map((c, n) => `${n + 1}. FRONT: ${c.front} | BACK: ${c.back}${c.example ? ` | EXAMPLE: ${c.example}` : ""}`),
  ]
    .filter(Boolean)
    .join("\n");
}
