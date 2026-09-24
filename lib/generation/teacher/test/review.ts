/**
 * TEST TAYYORLIK HISOBOTI (AUDIT-20 WP-B) — `reviewTest`.
 *
 * Ikki qatlam (`work/review.ts` bilan AYNI naqsh):
 *   1. QOIDALAR — 20 ta deterministik band (R3 §4.1). Ular HUJJATDAN
 *      qayta hisoblanadi, chunki hisobot tahrirdan keyin ham chaqiriladi
 *      — o'shanda dvigatel yo'q. Dvigateldan faqat qayta tiklab
 *      BO'LMAYDIGAN narsa olinadi (`ask`: so'ralgan savol soni, manba
 *      matni, qiyinlik buyurtmasi).
 *   2. BAHOLOVCHI — `judge` roli, turning `JudgeSpec` i bo'yicha 5 mezon
 *      (`answerCorrectness`, `clarity`, `distractors`, `coverage`,
 *      `levelFit`), har biri 0–3.
 *
 * BALL = `report/score.ts scoreReviewFor` (60 % qoidalar + 40 % baholovchi).
 *
 * Eng qimmat nuqson — NOTO'G'RI KALIT: uni qoida bilan aniqlab bo'lmaydi
 * (savolning mazmunini bilish kerak), shuning uchun `answerCorrectness`
 * baholovchida va past ball QIZIL band beradi (R3 §4.3.4).
 */
import type { AcademicDoc } from "../../types";
import type { DocReview, JudgeResult, ReviewCheck } from "../../report/types";
import { check, rewrite, scoreReviewFor, trigrams, jaccard } from "../../report/score";
import { JUDGE_MIN_MS, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS, judgeChecksFor, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "../../report/judge";
import { remainingMs } from "../../quality";
import type { LlmUsage } from "../../llm-roles";
import { TEACHER_LIMITS, type TestDifficulty, type TestMatchPair, type TestModel, type TestQuestion } from "../types";
import { DIFFICULTY_MIX, TEST_JUDGE_CRITERIA, teacherTypeOf, type DifficultyProfileId, type TestJudgeCriterion } from "../registry";
import {
  DUPLICATE_JACCARD,
  answerLabel,
  bloomCoverage,
  difficultyCounts,
  difficultyTargets,
  hasNegation,
  isBlanketOption,
  negationMarked,
  normalizeQuote,
  omrColumns,
  omrFits,
  omrQuestions,
} from "./questions";

export type TestJudgeResult = JudgeResult<TestJudgeCriterion>;

/** Dvigateldan keladigan, hujjatdan QAYTA TIKLAB BO'LMAYDIGAN ma'lumot. */
export type TestReviewAsk = {
  /** Foydalanuvchi so'ragan savol soni. */
  count?: number;
  /** Qiyinlik profili (`aralash`, `dtm`…). */
  difficulty?: DifficultyProfileId;
  /** `mode:"file"` — manba matni (iqtiboslarni qayta tekshirish uchun). */
  sourceText?: string;
  /** Normalizatsiyada manba tasdiqlamagani uchun o'chirilgan savollar. */
  droppedBySource?: number;
};

export type TestReviewOpts = {
  ask?: TestReviewAsk;
  complete?: (role: "judge", system: string, user: string, o: { json?: boolean; maxTokens?: number; timeoutMs?: number; deadline?: number }) => Promise<{ text: string; usage?: LlmUsage } | null>;
  deadline?: number;
  /** `false` — baholovchi chaqirilmaydi (testlar). */
  judge?: boolean;
  now?: Date;
  onUsage?: (u: LlmUsage) => void;
};

/** R3 §4.1 ro'yxati — TARTIB hisobot panelidagi tartib. */
export const TEST_RULE_IDS = [
  "count",
  "oneCorrect",
  "optionCount",
  "noDuplicates",
  "noBlanketOption",
  "stemLength",
  "optionBalance",
  "keyBalance",
  "difficultyMix",
  "bloomCoverage",
  "keyMatchesVariants",
  "variantParity",
  "sourceGrounded",
  "curriculumCoverage",
  "scoreSum",
  "omrFits",
  "languagePurity",
  "negativeStem",
  "answerPresent",
  "explanationPresent",
] as const;
export type TestRuleId = (typeof TEST_RULE_IDS)[number];

/** Variant matni eng uzun/eng qisqa nisbati shundan oshmasin (S-18). */
export const OPTION_BALANCE_MAX = 2.5;
/** Baholovchi shu balldan past qo'ysa — kalitga ishonmaymiz (R3 §4.3.4). */
export const KEY_TRUST_MIN = 2;

const list = (xs: string[], max = 5) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));
const nth = (q: TestQuestion, all: readonly TestQuestion[]) => `${all.indexOf(q) + 1}-savol`;

/* ────────────────────────── qoidalar ────────────────────────── */

/**
 * 20 band — hammasi SOF funksiya: kirish `TestModel` + `ask`, chiqish
 * `ReviewCheck[]`. Shuning uchun ularni testda bitta-bitta qo'zg'atish
 * mumkin (`tests/teacher-test-review.test.mts`).
 */
export function testRuleChecks(model: TestModel, ask: TestReviewAsk = {}): ReviewCheck[] {
  const qs = model.questions;
  const out: ReviewCheck[] = [];
  const spec = teacherTypeOf("test", model.type);
  const closed = qs.filter((q) => q.kind !== "open" && q.kind !== "match");

  /* 1. count */
  const want = Math.max(1, Math.round(ask.count ?? qs.length));
  const gotShare = want ? qs.length / want : 1;
  out.push(
    check(
      "count",
      qs.length === want ? "green" : gotShare >= 0.8 ? "yellow" : "red",
      "Savollar soni",
      `${qs.length} / ${want}`,
      qs.length === want ? undefined : rewrite("questions", `So'ralgan ${want} ta savoldan ${qs.length} tasi qoldi — yetishmagan savollarni bir xil qiyinlikda qayta yozing.`),
    ),
  );

  /* 2. oneCorrect */
  const badAnswer = qs.filter((q) => !answerShapeOk(q));
  out.push(
    check(
      "oneCorrect",
      badAnswer.length ? "red" : "green",
      "Bitta to'g'ri javob",
      badAnswer.length ? `${badAnswer.map((q) => nth(q, qs)).join(", ")} javobi noto'g'ri shaklda` : "barcha savollarda javob shakli to'g'ri",
      badAnswer.length ? rewrite("questions", "Har yopiq savolda AYNAN bitta to'g'ri javob bo'lsin; ko'p javobli savolda 2–3 to'g'ri variant.") : undefined,
    ),
  );

  /* 3. optionCount */
  const wrongCount = closed.filter((q) => q.kind !== "truefalse" && q.options.length !== (model.omr?.optionCount ?? q.options.length));
  const dupOption = qs.filter((q) => {
    const keys = q.options.map((o) => normalizeQuote(o));
    return new Set(keys).size !== keys.length;
  });
  const optionBad = wrongCount.length + dupOption.length;
  const optionShare = qs.length ? 1 - optionBad / qs.length : 1;
  out.push(
    check(
      "optionCount",
      optionShare === 1 ? "green" : optionShare >= 0.9 ? "yellow" : "red",
      "Variantlar soni va takrorlanmasligi",
      optionBad ? `${optionBad} savolda variant soni yoki takror muammosi` : "hamma savolda to'g'ri",
      optionBad ? rewrite("questions", "Har yopiq savolda variantlar soni bir xil bo'lsin va bitta savol ichida variant takrorlanmasin.") : undefined,
    ),
  );

  /* 4. noDuplicates */
  const grams = qs.map((q) => trigrams(q.stem));
  const pairs: string[] = [];
  for (let i = 0; i < grams.length; i++)
    for (let j = i + 1; j < grams.length; j++) if (jaccard(grams[i], grams[j]) >= DUPLICATE_JACCARD) pairs.push(`${i + 1}↔${j + 1}`);
  out.push(
    check(
      "noDuplicates",
      pairs.length === 0 ? "green" : pairs.length === 1 ? "yellow" : "red",
      "Savollar takrorlanmasligi",
      pairs.length ? `yaqin juftliklar: ${list(pairs)}` : "takror yo'q",
      pairs.length ? rewrite("questions", `Quyidagi savollar bir-birini takrorlaydi (${list(pairs)}) — birini boshqa faktga almashtiring.`) : undefined,
    ),
  );

  /* 5. noBlanketOption */
  const blanket = qs.filter((q) => q.options.some((o) => isBlanketOption(o)));
  out.push(
    check(
      "noBlanketOption",
      blanket.length ? "red" : "green",
      "«Hammasi to'g'ri» variantlari yo'q",
      blanket.length ? `${blanket.map((q) => nth(q, qs)).join(", ")}` : "taqiqlangan variant yo'q",
      blanket.length ? rewrite("questions", "«Hammasi to'g'ri / yuqoridagilarning barchasi / hech biri» variantlarini mazmunli distraktor bilan almashtiring.") : undefined,
    ),
  );

  /* 6. stemLength */
  const badStem = qs.filter((q) => q.stem.length < TEACHER_LIMITS.stemCharsMin || q.stem.length > TEACHER_LIMITS.stemCharsMax);
  const longOption = qs.filter((q) => q.options.some((o) => o.length > TEACHER_LIMITS.optionChars));
  const lenBad = badStem.length + longOption.length;
  const lenShare = qs.length ? 1 - lenBad / qs.length : 1;
  out.push(
    check(
      "stemLength",
      lenShare === 1 ? "green" : lenShare >= 0.9 ? "yellow" : "red",
      "O'zak va variant uzunligi",
      lenBad ? `${lenBad} savolda chegara buzilgan (o'zak ${TEACHER_LIMITS.stemCharsMin}–${TEACHER_LIMITS.stemCharsMax}, variant ≤ ${TEACHER_LIMITS.optionChars})` : "chegara ichida",
      lenBad ? rewrite("questions", `O'zaklarni ${TEACHER_LIMITS.stemCharsMin}–${TEACHER_LIMITS.stemCharsMax} belgi, variantlarni ${TEACHER_LIMITS.optionChars} belgi ichida qisqartiring.`) : undefined,
    ),
  );

  /* 7. optionBalance */
  const ratios = closed
    .filter((q) => q.options.length >= 2)
    .map((q) => {
      const lens = q.options.map((o) => Math.max(1, o.length));
      return Math.max(...lens) / Math.min(...lens);
    });
  const worst = ratios.length ? Math.max(...ratios) : 1;
  out.push(
    check(
      "optionBalance",
      worst <= OPTION_BALANCE_MAX ? "green" : worst <= 3.5 ? "yellow" : "red",
      "Variantlar uzunligi balansi",
      `eng uzun / eng qisqa = ${worst.toFixed(1)}×`,
      worst > OPTION_BALANCE_MAX ? rewrite("questions", "Variantlarni bir xil uzunlikka keltiring — eng uzun variant ko'pincha to'g'ri javob bo'lib ko'rinadi.") : undefined,
    ),
  );

  /* 8. keyBalance */
  const letterSpread = spreadOfLetters(model);
  out.push(
    check(
      "keyBalance",
      letterSpread <= 1 ? "green" : letterSpread <= 2 ? "yellow" : "red",
      "To'g'ri javob harflari balansi",
      `eng ko'p va eng kam ishlatilgan harf farqi: ${letterSpread}`,
    ),
  );

  /* 9. difficultyMix */
  const profile: DifficultyProfileId = ask.difficulty ?? (spec.id === "dtm" ? "dtm" : "aralash");
  const target = difficultyTargets(qs.length, DIFFICULTY_MIX[profile] ?? spec.limits.difficultyMix);
  const actual = difficultyCounts(qs);
  const devs = (["oson", "orta", "qiyin"] as TestDifficulty[]).map((d) => Math.abs(actual[d] - target[d]));
  const maxDev = devs.length ? Math.max(...devs) : 0;
  out.push(
    check(
      "difficultyMix",
      maxDev <= 1 ? "green" : maxDev <= 2 ? "yellow" : "red",
      "Qiyinlik taqsimoti",
      `oson ${actual.oson}/${target.oson} · o'rta ${actual.orta}/${target.orta} · qiyin ${actual.qiyin}/${target.qiyin}`,
      maxDev > 1
        ? rewrite("questions", `Qiyinlik taqsimotini ${target.oson} oson / ${target.orta} o'rta / ${target.qiyin} qiyin holatiga keltiring.`)
        : undefined,
    ),
  );

  /* 10. bloomCoverage */
  const levels = bloomCoverage(qs);
  const needLevels = qs.length >= 20 ? 4 : qs.length >= 10 ? 3 : 2;
  const wrongBloom = qs.filter((q) => q.kind !== "open" && (q.bloom === "evaluate" || q.bloom === "create"));
  const missing = Math.max(0, needLevels - levels.length) + (wrongBloom.length ? 1 : 0);
  out.push(
    check(
      "bloomCoverage",
      missing === 0 ? "green" : missing === 1 ? "yellow" : "red",
      "Bloom darajalari qamrovi",
      `${levels.length} daraja (kerak ≥ ${needLevels}): ${levels.join(", ") || "—"}${wrongBloom.length ? `; yopiq savolda evaluate/create: ${wrongBloom.map((q) => nth(q, qs)).join(", ")}` : ""}`,
      missing ? rewrite("questions", `Savollarni kamida ${needLevels} xil Bloom darajasiga taqsimlang; evaluate/create faqat ochiq topshiriqda bo'lsin.`) : undefined,
    ),
  );

  /* 11. keyMatchesVariants */
  const keyErrors: string[] = [];
  for (const v of model.variants) {
    const key = model.key[v.id];
    if (!key) {
      keyErrors.push(`${v.id}: kalit yo'q`);
      continue;
    }
    if (key.length !== qs.length) keyErrors.push(`${v.id}: kalit uzunligi ${key.length} ≠ ${qs.length}`);
    v.order.forEach((qi, i) => {
      const q = qs[qi];
      if (!q) return;
      if (key[i] !== undefined && key[i] !== answerLabel(q, v.optionOrder[i] ?? [])) keyErrors.push(`${v.id}/${i + 1}`);
    });
  }
  out.push(
    check(
      "keyMatchesVariants",
      keyErrors.length ? "red" : "green",
      "Kalit variant tartibiga mos",
      keyErrors.length ? list(keyErrors) : `${model.variants.length} variant kaliti tekshirildi`,
    ),
  );

  /* 12. variantParity */
  const parity = model.variants.filter((v) => {
    const sorted = [...v.order].sort((a, b) => a - b);
    return sorted.length !== qs.length || sorted.some((x, i) => x !== i);
  });
  out.push(
    check(
      "variantParity",
      parity.length ? "red" : "green",
      "Variantlar pariteti",
      parity.length ? `${parity.map((v) => v.id).join(", ")} variantida savol to'plami farq qiladi` : "barcha variantda savollar bir xil, faqat tartib boshqa",
    ),
  );

  /* 13. sourceGrounded */
  out.push(sourceGroundedCheck(model, ask, qs));

  /* 14. curriculumCoverage */
  out.push(curriculumCoverageCheck(model, qs));

  /* 15. scoreSum */
  const sum = qs.reduce((a, q) => a + q.points, 0);
  const declared = model.scoring.total;
  const diff = Math.abs(sum - declared);
  out.push(
    check(
      "scoreSum",
      diff === 0 ? "green" : diff <= 2 ? "yellow" : "red",
      "Ball yig'indisi",
      `${sum} / e'lon qilingan ${declared}`,
      diff ? rewrite("questions", `Topshiriqlar ballini shunday taqsimlang-ki, yig'indi aynan ${declared} ball bo'lsin.`) : undefined,
    ),
  );

  /* 16. omrFits */
  const omrN = omrQuestions(qs).length;
  const fits = !model.omr || (omrFits(model.omr.count) && model.omr.count === omrN);
  out.push(
    check(
      "omrFits",
      !model.omr ? "green" : fits ? "green" : "red",
      "Javoblar varag'i sig'imi",
      model.omr
        ? `${model.omr.count} savol, ${omrColumns(model.omr.count)} ustun (chegara ${TEACHER_LIMITS.omrColumnsMax})`
        : "javob varag'i so'ralmagan",
    ),
  );

  /* 17. languagePurity */
  const impure = qs.filter((q) => mixedScript(`${q.stem} ${q.options.join(" ")}`) || /\d\.\d/.test(q.stem));
  out.push(
    check(
      "languagePurity",
      impure.length === 0 ? "green" : impure.length <= 2 ? "yellow" : "red",
      "Til tozaligi",
      impure.length ? `${impure.map((q) => nth(q, qs)).join(", ")} — yozuv aralashmasi yoki o'nlik nuqta` : "aralashma yo'q",
      impure.length ? rewrite("questions", "Savol matnini bitta yozuvda yozing (lotin/kirill aralashmasin), o'nlik kasrda VERGUL ishlating.") : undefined,
    ),
  );

  /* 18. negativeStem */
  const negatives = qs.filter((q) => hasNegation(q.stem));
  const unmarked = negatives.filter((q) => !negationMarked(q.stem));
  const negShare = negatives.length ? 1 - unmarked.length / negatives.length : 1;
  out.push(
    check(
      "negativeStem",
      negShare === 1 ? "green" : negShare >= 0.8 ? "yellow" : "red",
      "Inkor ajratilgan",
      negatives.length ? `${negatives.length} inkorli savoldan ${unmarked.length} tasida bosh harf yo'q` : "inkorli savol yo'q",
      unmarked.length ? rewrite("questions", "Inkorni BOSH HARF bilan ajrating: «eriMAYDI», «EMAS», «NOTO'G'RI».") : undefined,
    ),
  );

  /* 19. answerPresent */
  const noAnswer = qs.filter((q) => {
    if (q.kind === "open") return !String(q.answer ?? "").trim() || !(model.criteria ?? []).some((c) => c.taskRef === q.id);
    if (q.kind === "match") return !Array.isArray(q.answer) || (q.answer as TestMatchPair[]).length < TEACHER_LIMITS.matchPairsMin;
    return false;
  });
  out.push(
    check(
      "answerPresent",
      noAnswer.length ? "red" : "green",
      "Ochiq topshiriq javobi va mezoni",
      noAnswer.length ? `${noAnswer.map((q) => nth(q, qs)).join(", ")} da javob yoki baholash mezoni yo'q` : "hamma ochiq topshiriqda javob va mezon bor",
      noAnswer.length ? rewrite("questions", "Har ochiq topshiriqqa namunaviy javob va qadamma-qadam baholash mezonini (ball bilan) yozing.") : undefined,
    ),
  );

  /* 20. explanationPresent */
  const noExpl = qs.filter((q) => q.explanation.trim().length < 10);
  const explShare = qs.length ? 1 - noExpl.length / qs.length : 1;
  out.push(
    check(
      "explanationPresent",
      explShare === 1 ? "green" : explShare >= 0.8 ? "yellow" : "red",
      "Javob izohi",
      noExpl.length ? `${noExpl.length} savolda izoh yo'q` : "har savolda izoh bor",
      noExpl.length ? rewrite("questions", "Har savolga bir gaplik izoh yozing — o'qituvchi javoblarni tahlil qilganda shuni o'qiydi.") : undefined,
    ),
  );

  return out;
}

/* ────────────────────────── yordamchi qoidalar ────────────────────────── */

function answerShapeOk(q: TestQuestion): boolean {
  switch (q.kind) {
    case "single":
      return typeof q.answer === "number" && q.answer >= 0 && q.answer < q.options.length;
    case "truefalse":
      return typeof q.answer === "boolean";
    case "multi": {
      if (!Array.isArray(q.answer)) return false;
      const a = q.answer as number[];
      return (
        a.length >= TEACHER_LIMITS.multiAnswersMin &&
        a.length <= TEACHER_LIMITS.multiAnswersMax &&
        new Set(a).size === a.length &&
        a.every((i) => Number.isInteger(i) && i >= 0 && i < q.options.length)
      );
    }
    case "open":
      return typeof q.answer === "string" && q.answer.trim().length > 0;
    case "match":
      return Array.isArray(q.answer) && (q.answer as TestMatchPair[]).length >= TEACHER_LIMITS.matchPairsMin;
  }
}

/** Harflar taqsimotidagi eng katta og'ish (barcha variantlar bo'ylab). */
function spreadOfLetters(model: TestModel): number {
  let worst = 0;
  for (const v of model.variants) {
    const counts = new Map<string, number>();
    v.order.forEach((qi, i) => {
      const q = model.questions[qi];
      if (!q || q.kind !== "single") return;
      const letter = model.key[v.id]?.[i] ?? answerLabel(q, v.optionOrder[i] ?? []);
      counts.set(letter, (counts.get(letter) ?? 0) + 1);
    });
    if (!counts.size) continue;
    const optionCount = model.omr?.optionCount ?? 4;
    // Ishlatilmagan harf ham hisobga kiradi: «hech qachon D» ham nuqson.
    for (const l of ["A", "B", "C", "D"].slice(0, optionCount)) if (!counts.has(l)) counts.set(l, 0);
    const values = [...counts.values()];
    worst = Math.max(worst, Math.max(...values) - Math.min(...values));
  }
  return worst;
}

function sourceGroundedCheck(model: TestModel, ask: TestReviewAsk, qs: readonly TestQuestion[]): ReviewCheck {
  if (model.mode !== "file") return check("sourceGrounded", "green", "Manbaga bog'liqlik", "fayl rejimi emas — qoida qo'llanmaydi");
  const dropped = ask.droppedBySource ?? 0;
  const src = ask.sourceText ? normalizeQuote(ask.sourceText) : "";
  const unverified = qs.filter((q) => {
    const quote = q.source?.quote;
    if (!quote) return true;
    // Manba matni yo'q bo'lsa (tahrirdan keyingi hisobot) — faqat iqtibos BORLIGI tekshiriladi.
    return src ? !src.includes(normalizeQuote(quote)) : false;
  });
  const share = qs.length ? 1 - unverified.length / qs.length : 0;
  const detail = [
    `${qs.length - unverified.length} / ${qs.length} savol manbada tasdiqlandi`,
    dropped ? `${dropped} savol manbada tasdiqlanmagani uchun olib tashlandi` : "",
    src ? "" : "manba matni hisobot vaqtida mavjud emas — faqat iqtibos borligi tekshirildi",
  ]
    .filter(Boolean)
    .join("; ");
  return check(
    "sourceGrounded",
    share === 1 ? "green" : share >= 0.8 ? "yellow" : "red",
    "Manbaga bog'liqlik",
    detail,
    share < 1 ? rewrite("questions", "Manbada so'zma-so'z tasdiqlanmagan savollarni olib tashlang va o'rniga manbadagi boshqa bo'limlardan savol yozing.") : undefined,
  );
}

function curriculumCoverageCheck(model: TestModel, qs: readonly TestQuestion[]): ReviewCheck {
  if (model.mode !== "curriculum" || !model.topicIds.length)
    return check("curriculumCoverage", "green", "O'quv dasturi qamrovi", "darslik rejimi emas — qoida qo'llanmaydi");
  const used = new Set(qs.map((q) => q.topicId).filter(Boolean));
  const empty = model.topicIds.filter((t) => !used.has(t));
  return check(
    "curriculumCoverage",
    empty.length === 0 ? "green" : empty.length === 1 ? "yellow" : "red",
    "O'quv dasturi qamrovi",
    empty.length ? `savolsiz mavzular: ${list(empty)}` : `${model.topicIds.length} mavzuning hammasiga savol tushdi`,
    empty.length ? rewrite("questions", `Quyidagi dastur mavzularidan ham savol yozing: ${list(empty)}.`) : undefined,
  );
}

/** Lotin va kirill ARALASHMASI (formuladagi lotin harflari hisobga olinmaydi). */
export function mixedScript(text: string): boolean {
  const cyr = (text.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const lat = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  if (!cyr || !lat) return false;
  // Bitta-ikkita lotin harfi (F = ma, pH) aralashma emas.
  return Math.min(cyr, lat) > 2;
}

/* ────────────────────────── baholovchi ────────────────────────── */

/** Baholovchiga beriladigan matn — savol, variantlar va KALIT. */
export function testJudgeUserPrompt(model: TestModel, topic: string): string {
  const lines = model.questions.map((q, i) => {
    const opts = q.options.map((o, j) => `   ${"ABCDEF"[j]}) ${o}`).join("\n");
    return [
      `${i + 1}. [${q.kind} · ${q.difficulty} · ${q.bloom} · ${q.points} ball] ${q.stem}`,
      opts,
      `   KEY: ${answerLabel(q, q.options.map((_, j) => j))}${q.kind === "open" ? ` — ${String(q.answer)}` : ""}`,
      q.explanation ? `   EXPLANATION: ${q.explanation}` : "",
      q.source?.quote ? `   SOURCE QUOTE: ${q.source.quote}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [`TOPIC: ${topic}`, `TEST TYPE: ${model.type} · MODE: ${model.mode} · TOTAL: ${model.scoring.total} points`, "", "ITEMS:", ...lines].join("\n");
}

export function scoreTestReview(rules: ReviewCheck[], judge: TestJudgeResult): number {
  return scoreReviewFor(rules, judge, TEST_JUDGE_CRITERIA);
}

/**
 * Kalitga ishonch bandi — baholovchi `answerCorrectness` ni past qo'ysa
 * QIZIL ogohlantirish (R3 §4.3.4). Bu qoida EMAS, baholovchi natijasidan
 * chiqadigan xulosa, shuning uchun `judgeChecksFor` dan keyin qo'shiladi.
 */
export function keyTrustCheck(j: TestJudgeResult): ReviewCheck | null {
  if (j.answerCorrectness > KEY_TRUST_MIN) return null;
  return check(
    "keyTrust",
    j.answerCorrectness <= 1 ? "red" : "yellow",
    "Javoblar kalitiga ishonch",
    "Baholovchi kalitda xato bo'lishi mumkin deb hisobladi — javoblar kalitini o'zingiz tekshiring.",
  );
}

export async function reviewTest(doc: AcademicDoc, opts: TestReviewOpts = {}): Promise<DocReview> {
  const now = opts.now ?? new Date();
  const model = doc.teacher?.test;
  if (!model) {
    return { score: 0, checks: [], judgeNotes: ["Test modeli yo'q"], verifiedShare: 0, recentShare: 0, builtAt: now.toISOString() };
  }
  const spec = teacherTypeOf("test", model.type);
  const rules = testRuleChecks(model, opts.ask);

  let judge: TestJudgeResult | null = null;
  const judgeNotes: string[] = [];
  if (opts.judge !== false && opts.complete) {
    const timeoutMs = Math.min(JUDGE_TIMEOUT_MS, remainingMs(opts.deadline));
    if (timeoutMs >= JUDGE_MIN_MS) {
      try {
        const r = await opts.complete("judge", judgeSystemPromptFor(spec.judge, ["questions"]), testJudgeUserPrompt(model, doc.meta.topic), {
          json: true, deadline: opts.deadline,
          maxTokens: 1500,
          timeoutMs,
        });
        if (r?.usage) opts.onUsage?.(r.usage);
        judge = parseJudgeFor(spec.judge, r?.text, ["questions"]);
      } catch (e) {
        console.warn("[test] baholovchi xatosi:", e instanceof Error ? e.message : e);
      }
    }
    if (!judge) judgeNotes.push(JUDGE_NO_ANSWER);
  }
  const j = judge ?? neutralJudgeFor(spec.judge);
  judgeNotes.push(...j.notes);
  const trust = judge ? keyTrustCheck(j) : null;

  return {
    score: scoreTestReview(rules, j),
    checks: [...rules, ...judgeChecksFor(spec.judge, j), ...(trust ? [trust] : [])],
    judgeNotes,
    verifiedShare: 0,
    recentShare: 0,
    builtAt: now.toISOString(),
  };
}
