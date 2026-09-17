/**
 * SARALASH O'YINI PROMPTLARI (AUDIT-22 WP-D) — `flashcards/prompts.ts` naqshi.
 *
 * Ko'rsatmalar INGLIZCHA, birinchi qator `languageDirective`: tuzilma
 * qoidalarini (JSON sxemasi, belgi chegaralari) model inglizcha
 * ko'rsatmada ishonchliroq bajaradi, chiqish tilini esa birinchi qator
 * qat'iy belgilaydi.
 *
 * ── BIR MA'NOLILIK — bu oilaning markaziy qoidasi
 *
 * `sorting-game.md` §5 dagi yomon misol aynan shu haqda: «Hayvonlar»,
 * «Uy hayvonlari», «Yovvoyi hayvonlar» toifalarida «mushuk» IKKITA
 * toifaga tegishli bo'lib qoladi va o'yin YECHILMAYDIGAN bo'ladi —
 * o'quvchi to'g'ri javob bergan bo'lsa ham qizil belgi oladi. Shuning
 * uchun prompt modelga elementni O'Z toifasiga emas, HAR toifaga
 * solishtirib ko'rishni buyuradi, hisobot esa buni `itemSingleCategory`
 * (deterministik) va `unambiguity` (baholovchi) bilan IKKI marta
 * tekshiradi.
 *
 * FAYL REJIMI YO'Q: `lib/tools.ts` da saralash vositasida `modes`
 * e'lon qilinmagan, ya'ni `worker.ts sourceForJob` bu vositaga manba
 * fayl umuman bermaydi (kartalar bilan bir xil holat).
 */
import { languageDirective } from "../../i18n";
import { GAME_LIMITS } from "../types";
import type { SortingTypeSpec } from "../registry";
import type { SortingInput } from "./input";

export type SortingContext = {
  spec: SortingTypeSpec;
  input: SortingInput;
};

/* ══════════════════════════ tizim prompti ══════════════════════════ */

export function sortingSystemPrompt(ctx: SortingContext): string {
  const { input, spec } = ctx;
  const [nameMin, nameMax] = spec.limits.nameChars;
  const [itemMin, itemMax] = spec.limits.itemChars;
  const lines = [
    languageDirective(input.language),
    "You are an experienced Uzbek subject teacher preparing a sorting game: the pupil sees a pile of items and drops each one into the category it belongs to.",
    `Topic: «${input.topic}». Subject: ${input.subject || "infer from the topic"}.`,
    `Game type: ${spec.label.en} (${spec.id}).`,
    "RULES (strict):",
    "1. ONE CATEGORY PER ITEM — the decisive rule. Before you write an item, check it against EVERY category on the list, not only the one you are filling. If a pupil could defend putting it in a second category, the game becomes unwinnable: the pupil answers correctly and the screen marks it red. Replace such an item.",
    "2. SAME LEVEL: the categories must sit at the SAME level of abstraction («mammals»/«birds», never «animals»/«pet animals»). Overlapping levels are the most common way rule 1 is broken.",
    "3. HONESTY: never invent a statistic, a count, a date or a textbook reference. A sorting game needs only ordinary classification knowledge — if you are not sure an item belongs, leave it out.",
    `4. AUDIENCE: ${input.grade > 0 ? `grade ${input.grade}` : "the stated level"} — every item must be one this pupil has actually met, not a specialist example they would have to guess.`,
    `5. LENGTH IS PHYSICAL: a category name is a button on a phone screen (${nameMin}–${nameMax} characters) and an item is a small draggable chip (${itemMin}–${itemMax} characters, one or two words). A sentence does not fit and turns the game into reading practice.`,
    "6. Output: return ONLY the JSON requested — no markdown fences, no commentary, no explanation before or after.",
    `TYPE RULES (${spec.label.en}):`,
    ...spec.guidance.map((g, i) => `${i + 1}. ${g}`),
  ];
  if (input.extra) lines.push(`TEACHER'S ADDITIONAL REQUEST (follow it unless it conflicts with the rules above): ${input.extra}`);
  return lines.filter(Boolean).join("\n");
}

/* ══════════════════════════ yozish ══════════════════════════ */

/**
 * Toifalarni so'rash.
 *
 * `already` — allaqachon olingan ELEMENTLAR: yetishmagan toifalar uchun
 * IKKINCHI so'rov yuborilganda model o'sha so'zlarni qaytadan bermasin
 * (`uniqueItems` qoidasi bir xil elementni butun to'plamda — toifalar
 * ICHIDA ham, ORASIDA ham — rad etadi).
 */
export function sortingUserPrompt(ctx: SortingContext, categories: number, already: readonly string[]): string {
  const i = ctx.input;
  const [nameMin, nameMax] = ctx.spec.limits.nameChars;
  const [itemMin, itemMax] = ctx.spec.limits.itemChars;
  const lines = [
    "Write the sorting game. Return ONLY this JSON:",
    '{"categories":[{"name":"","items":["",""]}]}',
    `EXACTLY ${categories} categories on «${i.topic}»${i.subject && i.subject !== i.topic ? ` (subject: ${i.subject})` : ""}${i.grade > 0 ? `, at grade ${i.grade} level` : ""}, with EXACTLY ${i.itemsPerCategory} items in each.`,
    `name: the category, ${nameMin}–${nameMax} characters — a noun phrase the pupil already knows, clearly different from every other category name.`,
    `items: ${itemMin}–${itemMax} characters each, one or two words, no article, no explanation, no trailing punctuation.`,
    "Every item must be different from every other item in the WHOLE game, and must belong to exactly ONE of the categories you list. Re-read the finished list once and replace any item that could be defended in a second category.",
    already.length ? `ALREADY WRITTEN — do NOT repeat these items:\n${already.join("; ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/* ══════════════════════════ qayta yozish (sayqal) ══════════════════════════ */

/**
 * Sayqal so'rovi — o'yin MODEL SHAKLIDA qaytariladi, nasr sifatida EMAS
 * (AUDIT-20 glossariy va AUDIT-21 karta saboqi).
 *
 * Umumiy nasr yo'li (`blocksFromLlm`) toifa nomlarini sarlavha deb yeb
 * qo'yardi va butun o'yin bitta paragrafga aylanardi; maket esa
 * (`planGame` jadvalni MODELDAN chizadi) eski toifalarni ko'rsatishda
 * davom etardi. Shuning uchun model AYNAN shuncha toifa va shuncha
 * element qaytarishi, tartib esa SAQLANISHI talab qilinadi.
 */
export function sortingRewritePrompt(ctx: SortingContext, categories: readonly { name: string; items: readonly string[] }[], instruction: string): string {
  const [nameMin, nameMax] = ctx.spec.limits.nameChars;
  const [itemMin, itemMax] = ctx.spec.limits.itemChars;
  return [
    "Improve the sorting game below. Return ONLY this JSON:",
    '{"categories":[{"name":"","items":["",""]}]}',
    `EXACTLY ${categories.length} categories, in the SAME ORDER as given, each with EXACTLY the same number of items as now. Keep every category about the same thing it is about now — this is a revision, not a new game.`,
    `name: ${nameMin}–${nameMax} characters. items: ${itemMin}–${itemMax} characters each.`,
    `Every item stays unique across the whole game and must belong to exactly ONE category (maximum ${GAME_LIMITS.categoryCountMax} categories are ever shown together).`,
    `WHAT TO FIX: ${instruction}`,
    "CURRENT GAME:",
    ...categories.map((c, n) => `${n + 1}. ${c.name}: ${c.items.join(", ")}`),
  ]
    .filter(Boolean)
    .join("\n");
}
