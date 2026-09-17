/**
 * TINGLASH O'YINI PROMPTLARI (AUDIT-22 WP-D) — `flashcards/prompts.ts` naqshi.
 *
 * Ko'rsatmalar INGLIZCHA, birinchi qator `languageDirective` — lekin bu
 * yerda u ONA TILI uchun: varaqdagi matn, ko'rsatma va VARIANTLAR shu
 * tilda. Eshitiladigan matn esa `targetLanguage` da va bu prompt ichida
 * ALOHIDA aytiladi — aks holda model butun topshiriqni bitta tilga
 * o'girib qo'yardi va mashq ma'nosini yo'qotardi.
 *
 * ── Distraktorlar: nega «bir semantik maydondan» talab qilinadi
 *
 * `listening-game.md` §5 dagi yomon misol: «library» uchun distraktorlar
 * «quyosh», «stul», «yugurish» — o'quvchi so'zni UMUMAN eshitmasdan,
 * faqat «bu joy nomiga o'xshaydi» degan mulohaza bilan to'g'ri javobni
 * topadi. Shuning uchun uchala noto'g'ri variant ham AYNI toifadan
 * («shahar binosi») bo'lishi shart — lekin hech biri to'g'ri javobning
 * IKKINCHI tarjimasi bo'lmasligi kerak, aks holda topshiriqning ikkita
 * to'g'ri javobi bo'lib qolardi.
 */
import { langInfo, languageDirective } from "../../i18n";
import type { ListeningTypeSpec } from "../registry";
import type { ListeningInput } from "./input";

export type ListeningContext = {
  spec: ListeningTypeSpec;
  input: ListeningInput;
};

const nameOf = (code: string) => langInfo(code).name;

/* ══════════════════════════ tizim prompti ══════════════════════════ */

export function listeningSystemPrompt(ctx: ListeningContext): string {
  const { input, spec } = ctx;
  const [textMin, textMax] = spec.limits.textChars;
  const target = nameOf(input.targetLanguage);
  const native = nameOf(input.nativeLanguage);
  const lines = [
    languageDirective(input.nativeLanguage),
    `EXCEPTION to the line above: the field «text» is the word the pupil HEARS and must be written in ${target}. Everything else — options, headings, explanations — stays in ${native}.`,
    `You are an experienced language teacher preparing a listening exercise: the pupil hears one item in ${target} and chooses its meaning among options written in ${native}.`,
    `Topic: «${input.topic}».`,
    `Task type: ${spec.label.en} (${spec.id}).`,
    "RULES (strict):",
    `1. HEARD TEXT: ${textMin}–${textMax} characters in ${target}, written exactly as it is SPOKEN — no digits, no abbreviations, no spelling-out, no bracketed hints. A speech synthesiser reads this string aloud; anything it cannot pronounce unambiguously is a defect.`,
    `2. ONE MEANING: choose only words whose translation into ${native} is agreed and context-free. A word with a disputed or context-dependent translation gives the pupil a correct answer that the game marks wrong.`,
    "3. DISTRACTORS FROM THE SAME FIELD: the wrong options must be translations of OTHER words from the same semantic field (all places, all foods, all professions) — never unrelated words, and never a second possible translation of the heard item.",
    `4. AUDIENCE: ${input.grade > 0 ? `grade ${input.grade}` : "a beginner-to-intermediate learner"} — everyday vocabulary, not rare dictionary entries.`,
    "5. HONESTY: never invent a word or a meaning. If you are not certain of a translation, use a different word.",
    "6. Output: return ONLY the JSON requested — no markdown fences, no commentary, no explanation before or after.",
    `TYPE RULES (${spec.label.en}):`,
    ...spec.guidance.map((g, i) => `${i + 1}. ${g}`),
  ];
  if (input.extra) lines.push(`TEACHER'S ADDITIONAL REQUEST (follow it unless it conflicts with the rules above): ${input.extra}`);
  return lines.filter(Boolean).join("\n");
}

/* ══════════════════════════ yozish ══════════════════════════ */

/**
 * Topshiriqlarni so'rash.
 *
 * `answer` INDEKS emas, MATN sifatida so'raladi va dvigatel uni
 * indeksga aylantiradi (`pickItems`). Sabab oddiy: modellar raqamli
 * indeksni muntazam bir pozitsiyaga adashtiradi (0/1 dan boshlash),
 * matnni esa adashtirmaydi — va noto'g'ri indeks o'yinni jimgina
 * buzardi (`answerInRange` qoidasi buni ushlaydi, lekin to'plamni
 * yaroqsiz qilib).
 */
export function listeningUserPrompt(ctx: ListeningContext, count: number, already: readonly string[]): string {
  const i = ctx.input;
  const [textMin, textMax] = ctx.spec.limits.textChars;
  const target = nameOf(i.targetLanguage);
  const native = nameOf(i.nativeLanguage);
  const wrong = i.optionCount - 1;
  return [
    "Write the listening tasks. Return ONLY this JSON:",
    '{"items":[{"text":"","answer":"","distractors":["",""]}]}',
    `${count} tasks on «${i.topic}»${i.grade > 0 ? `, at grade ${i.grade} level` : ""}.`,
    `text: the item the pupil HEARS, in ${target}, ${textMin}–${textMax} characters.`,
    `answer: its correct meaning in ${native} — one short phrase, the translation a teacher would accept.`,
    `distractors: EXACTLY ${wrong} wrong meanings in ${native}, from the SAME semantic field as the answer, of similar length, none of them a second possible translation of «text».`,
    "Every heard item appears once in the set: a repeated item wastes a question and reveals the answer.",
    already.length ? `ALREADY WRITTEN — do NOT repeat these items:\n${already.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ══════════════════════════ qayta yozish (sayqal) ══════════════════════════ */

/**
 * Sayqal so'rovi — topshiriqlar MODEL SHAKLIDA qaytariladi.
 *
 * Bosma varaqda eshitiladigan matn UMUMAN yozilmaydi (uni o'qituvchi
 * o'qib beradi), ya'ni nasrdan modelni tiklab bo'lmaydi: umumiy nasr
 * yo'li (`blocksFromLlm`) variantlarni qayta yozar, `text` va `answer`
 * esa eski holida qolardi — o'yin javobi jimgina noto'g'ri bo'lib
 * ketardi.
 */
export function listeningRewritePrompt(
  ctx: ListeningContext,
  items: readonly { text: string; options: readonly string[]; answer: number }[],
  instruction: string,
): string {
  const i = ctx.input;
  const [textMin, textMax] = ctx.spec.limits.textChars;
  const target = nameOf(i.targetLanguage);
  const native = nameOf(i.nativeLanguage);
  return [
    "Improve the listening set below. Return ONLY this JSON:",
    '{"items":[{"text":"","answer":"","distractors":["",""]}]}',
    `EXACTLY ${items.length} tasks, in the SAME ORDER as given, each with EXACTLY ${i.optionCount - 1} distractors. Keep every task about the same item it is about now — this is a revision, not a new set.`,
    `text: ${textMin}–${textMax} characters in ${target}. answer and distractors: in ${native}.`,
    `WHAT TO FIX: ${instruction}`,
    "CURRENT SET:",
    ...items.map((it, n) => `${n + 1}. HEARD: ${it.text} | CORRECT: ${it.options[it.answer] ?? "?"} | WRONG: ${it.options.filter((_, k) => k !== it.answer).join(", ")}`),
  ]
    .filter(Boolean)
    .join("\n");
}
