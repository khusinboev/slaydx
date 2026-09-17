/**
 * TAYYORLIK HISOBOTI — SARALASH O'YINI (AUDIT-22 WP-D) — `reviewSorting`.
 *
 * Ikki qatlam (`flashcards/review.ts` bilan bir xil naqsh, mantiq
 * NEYTRAL qatlamda `report/`):
 *   1. QOIDALAR — deterministik bandlar, id lari `registry.ts`
 *      `GAME_RULE_IDS.sorting` da QULFLANGAN (`sorting-game.md` §4);
 *   2. BAHOLOVCHI — `judge` rol, turning `JudgeSpec` i bo'yicha 5 mezon
 *      × 0–3 (`SORTING_JUDGE_CRITERIA`).
 *
 * BALL = `report/score.ts scoreReviewFor` (60 % qoidalar + 40 %
 * baholovchi).
 *
 * Bandlar MODELDAN o'qiladi (`doc.game.sorting`), bo'lim matnidan emas:
 * bosma varaqdagi ro'yxat ARALASH (`sortingSections`), ya'ni qaysi
 * element qaysi toifaniki ekani nasrda umuman ko'rinmaydi.
 *
 * ── Ikki ma'nolilik IKKI marta tekshiriladi va bu ataylab
 *
 * `itemSingleCategory` — DETERMINISTIK evristika (element boshqa toifa
 * nomini o'z ichiga oladi), `unambiguity` — BAHOLOVCHI mezoni. Birortasi
 * yolg'iz yetarli emas: baholovchi «pomidor sabzavotmi yoki mevami»
 * degan nozik holatni ko'radi-yu, «Hayvonlar / Uy hayvonlari» kabi
 * ochiq-oydin daraja to'qnashuvini ba'zan o'tkazib yuboradi; evristika
 * esa aksincha — matnda ko'rinmagan ma'noni bilmaydi. O'yin
 * yechilmaydigan bo'lib qolishi esa bu oiladagi ENG OG'IR nuqson
 * (`sorting-game.md` §5 yomon misoli).
 */
import type { AcademicDoc } from "../../types";
import type { DocReview, JudgeResult, JudgeSpec, ReviewCheck } from "../../report/types";
import { check, rewrite, scoreReviewFor } from "../../report/score";
import { JUDGE_MIN_MS, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS, judgeChecksFor, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "../../report/judge";
import { sampleForJudge } from "../../report/text";
import { remainingMs } from "../../quality";
import type { LlmUsage } from "../../llm-roles";
import type { CompleteFn } from "../../research/pipeline";
import { GAME_RULE_IDS, gameTypeOf, type SortingTypeSpec } from "../registry";
import { GAME_LIMITS, type GameModel, type SortingCategory, type SortingModel } from "../types";
import { itemKey } from "./engine";

/* ────────────────────────── tiplar ────────────────────────── */

export type SortingJudgeResult = JudgeResult<string>;

export type SortingReviewOpts = {
  complete?: CompleteFn;
  deadline?: number;
  /** `false` — baholovchi chaqirilmaydi (testlar). */
  judge?: boolean;
  now?: Date;
  onUsage?: (u: LlmUsage) => void;
};

/** Baholovchiga beriladigan matn shu belgidan oshmaydi. */
export const JUDGE_TEXT_CHARS = 12_000;

/** Sayqal nishoni — bu oilada bitta bo'lim (o'yinning O'ZI). */
export const SORTING_TARGET = "sorting";

/**
 * Reyestrda YO'Q, lekin hisobotda BOR band.
 *
 * `categoryNameDistinct` toifa nomlarining TAKSONOMIK darajasini
 * tekshiradi: «Hayvonlar» va «Uy hayvonlari» birgalikda ko'rsatilsa,
 * HAR element ikki ma'noli bo'lib qoladi va buni element darajasidagi
 * `itemSingleCategory` faqat qisman ushlaydi. Reyestrga qo'shilmadi,
 * chunki u R0 shartnomasi (`tests/game-registry`) — bu yerda esa
 * ro'yxat OCHIQ (krossvorddagi `CROSSWORD_EXTRA_RULE_IDS` naqshi).
 */
export const SORTING_EXTRA_RULE_IDS = ["categoryNameDistinct"] as const;

const EMPTY_JUDGE = { notes: [], fixes: [] } as unknown as SortingJudgeResult;

const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

function specOf(model: GameModel): SortingTypeSpec {
  return gameTypeOf("sorting", model.type);
}

/* ────────────────────────── evristikalar ────────────────────────── */

/** Ma'noli tokenlar — qo'shimchasiz taqqoslash uchun 4+ harfli so'zlar. */
export function contentTokens(s: string): string[] {
  return itemKey(s)
    .split(" ")
    .filter((w) => w.length >= 4);
}

/**
 * Ikki token bir SO'ZNING shakllarimi (prefiks bo'yicha).
 *
 * O'zbekchada qo'shimcha so'z oxiriga qo'shiladi: «hayvonlar» va
 * «hayvonlari» — bir xil tushuncha, lekin satr sifatida teng emas.
 * Aynan shu farq `sorting-game.md` §5 dagi yomon misolni («Hayvonlar»
 * va «Uy hayvonlari») deterministik tekshiruvdan o'tkazib yuborardi.
 */
export function sameStem(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Element BIR NECHTA toifaga mos keladimi (deterministik evristika).
 *
 * IKKI signal:
 *
 *   1. MATNDA ko'rinadigan to'qnashuv — element o'zidan boshqa
 *      toifaning nomini (yoki uning ma'noli tokenini) o'z ichiga oladi:
 *      «Qushlar» toifasi ekranda turganda «Hasharotlar» ichidagi
 *      «Qushlar» elementi aynan shunday ushlanadi;
 *   2. DARAJA to'qnashuvi — ikki toifa nomi bir so'zning shakllari
 *      («Hayvonlar» / «Uy hayvonlari»), ya'ni biri ikkinchisini QAMRAB
 *      oladi. Bunda TORROQ (uzunroq nomli) toifaning HAR elementi
 *      kengrog'iga ham tegishli bo'lib qoladi va o'yin yechilmaydigan
 *      bo'ladi. Bu aynan `sorting-game.md` §5 dagi yomon misol.
 *
 * Evristika ATAYLAB tor: u faqat NOMLARDA ko'rinadigan to'qnashuvni
 * ushlaydi va yolg'on qizil bermasligi kerak — ma'noviy ikki ma'nolilik
 * baholovchining (`unambiguity`) ishi.
 */
export function ambiguousItems(categories: readonly SortingCategory[]): { item: string; owner: string; other: string }[] {
  const out: { item: string; owner: string; other: string }[] = [];
  const names = categories.map((c) => ({ name: c.name, key: itemKey(c.name), tokens: contentTokens(c.name) }));
  const add = (item: string, owner: string, other: string) => {
    if (!out.some((x) => x.item === item)) out.push({ item, owner, other });
  };

  for (const [i, cat] of categories.entries()) {
    for (const [j, other] of names.entries()) {
      if (i === j || !other.key || !names[i].key) continue;
      // 2. Daraja to'qnashuvi: TORROQ toifaning hamma elementi shubhali.
      const overlap = names[i].tokens.some((t) => other.tokens.some((o) => sameStem(t, o)));
      if (overlap && names[i].key.length > other.key.length) {
        for (const raw of cat.items) add(raw, cat.name, other.name);
        continue;
      }
      // 1. Matndagi to'qnashuv.
      for (const raw of cat.items) {
        const key = itemKey(raw);
        if (!key) continue;
        const hit =
          key === other.key ||
          key.includes(` ${other.key}`) ||
          key.startsWith(`${other.key} `) ||
          other.tokens.some((t) => key === t || key.startsWith(`${t} `) || key.includes(` ${t}`));
        if (hit) add(raw, cat.name, other.name);
      }
    }
  }
  return out;
}

/** Toifa nomlari BIR XIL daraja to'qnashuvi: umumiy ma'noli token. */
export function nameCollisions(categories: readonly SortingCategory[]): { a: string; b: string; token: string }[] {
  const out: { a: string; b: string; token: string }[] = [];
  const toks = categories.map((c) => ({ name: c.name, tokens: new Set(contentTokens(c.name)) }));
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      const shared = [...toks[i].tokens].find((t) => [...toks[j].tokens].some((o) => sameStem(t, o)));
      if (shared) out.push({ a: toks[i].name, b: toks[j].name, token: shared });
    }
  }
  return out;
}

/* ══════════════════════════ qoidalar ══════════════════════════ */

export function sortingRuleChecks(doc: AcademicDoc): ReviewCheck[] {
  const model = doc.game;
  if (!model || model.kind !== "sorting" || !model.sorting) {
    return [check("structure", "red", "Tuzilma", "Saralash modeli hujjatda yo‘q — qaytadan yarating")];
  }
  const spec = specOf(model);
  const m: SortingModel = model.sorting;
  const cats = m.categories;
  const items = cats.flatMap((c) => c.items);
  const out: ReviewCheck[] = [];
  const fix = (instruction: string) => rewrite(SORTING_TARGET, instruction);

  /* ── 1. categoryCount ── */
  {
    const n = cats.length;
    const ok = n >= GAME_LIMITS.categoryCountMin && n <= GAME_LIMITS.categoryCountMax;
    out.push(
      ok
        ? check("categoryCount", "green", "Toifalar soni", `${n} ta`)
        : check(
            "categoryCount",
            n >= 2 ? "yellow" : "red",
            "Toifalar soni",
            `${n} ta (${GAME_LIMITS.categoryCountMin}–${GAME_LIMITS.categoryCountMax} bo‘lishi kerak — farq qaytariladi)`,
          ),
    );
  }

  /* ── 2. itemsPerCategory ── */
  {
    /*
     * VA'DA qilingan son hujjatda saqlanmaydi (forma qiymatlari
     * hisobot vaqtida yo'q — u tahrirdan keyin ham qayta hisoblanadi).
     * Shuning uchun band TENGLIKNI o'lchaydi: barcha toifa bir xil
     * to'lganmi. Notekis taqsimot o'yinni ham buzadi — o'quvchi
     * qolgan elementlarni eng bo'sh tugmaga tashlab ball oladi
     * (`balance` mezoni bilan bir xil sabab).
     */
    const counts = cats.map((c) => c.items.length);
    const min = counts.length ? Math.min(...counts) : 0;
    const max = counts.length ? Math.max(...counts) : 0;
    const thin = counts.filter((n) => n < GAME_LIMITS.itemsPerCategoryMin).length;
    out.push(
      thin > 0
        ? check(
            "itemsPerCategory",
            "red",
            "Toifadagi elementlar",
            `${thin} ta toifada ${GAME_LIMITS.itemsPerCategoryMin} tadan kam element`,
            fix(`Fill every category so that each one holds the SAME number of items, at least ${GAME_LIMITS.itemsPerCategoryMin}.`),
          )
        : min === max
          ? check("itemsPerCategory", "green", "Toifadagi elementlar", `har toifada ${max} ta`)
          : check(
              "itemsPerCategory",
              "yellow",
              "Toifadagi elementlar",
              `notekis: ${min}–${max} ta`,
              fix("Balance the categories: every category must hold the same number of items, so the pupil cannot score by filling the largest one."),
            ),
    );
  }

  /* ── 3. uniqueItems ── */
  {
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const it of items) {
      const k = itemKey(it);
      if (seen.has(k)) dup.push(it);
      else seen.add(k);
    }
    out.push(
      dup.length === 0
        ? check("uniqueItems", "green", "Takrorlanmaydi", `${items.length} ta element, takror yo‘q`)
        : check(
            "uniqueItems",
            "red",
            "Takrorlanmaydi",
            `${dup.length} ta takror: ${list(dup)}`,
            fix("Replace the duplicated items with different examples from the same topic. The same item may never appear twice, in one category or in two."),
          ),
    );
  }

  /* ── 4. itemSingleCategory ── */
  {
    const bad = ambiguousItems(cats);
    out.push(
      bad.length === 0
        ? check("itemSingleCategory", "green", "Bir toifaga tegishli", "har element bitta toifaga aniq tegishli")
        : check(
            "itemSingleCategory",
            "red",
            "Bir toifaga tegishli",
            `${bad.length} ta element ikki toifaga mos: ${list(bad.map((b) => `«${b.item}» → ${b.owner}/${b.other}`))}`,
            fix(
              "Replace every item that could belong to a second category on the list with one that belongs to exactly ONE of them. An item that fits two categories makes the game unwinnable: the pupil answers correctly and the screen marks it wrong.",
            ),
          ),
    );
  }

  /* ── 5. categoryNameLength ── */
  {
    const [lo, hi] = spec.limits.nameChars;
    const bad = cats.filter((c) => c.name.length < lo || c.name.length > hi);
    out.push(
      bad.length === 0
        ? check("categoryNameLength", "green", "Toifa nomi uzunligi", `hammasi ${lo}–${hi} belgi`)
        : check(
            "categoryNameLength",
            bad.length > cats.length / 2 ? "red" : "yellow",
            "Toifa nomi uzunligi",
            `${bad.length} ta nom ${lo}–${hi} belgidan tashqarida: ${list(bad.map((c) => c.name))}`,
            fix(`Rewrite the category names that are too short or too long so that each one is ${lo}–${hi} characters — the name is a button on a phone screen.`),
          ),
    );
  }

  /* ── 6. itemLength ── */
  {
    const [lo, hi] = spec.limits.itemChars;
    const bad = items.filter((t) => t.length < lo || t.length > hi);
    out.push(
      bad.length === 0
        ? check("itemLength", "green", "Element uzunligi", `hammasi ${lo}–${hi} belgi`)
        : check(
            "itemLength",
            bad.length > items.length / 4 ? "red" : "yellow",
            "Element uzunligi",
            `${items.length} tadan ${bad.length} tasi ${lo}–${hi} belgidan tashqarida: ${list(bad)}`,
            fix(`Shorten the items that are too long to ${lo}–${hi} characters (one or two words) — a sentence does not fit on a draggable chip.`),
          ),
    );
  }

  /* ── 7. answerKey ── */
  {
    /*
     * Javob kaliti — HUJJATNING bandi, modelniki emas: u alohida betda
     * chiqadi (`planGame` `pageBreaks`) va o'qituvchi aynan shu betni
     * o'zida qoldiradi. Bo'lim yo'qolsa (eski hujjat, qo'lda tahrir)
     * o'yin javobsiz bosiladi.
     */
    const answers = doc.sections.find((s) => s.id === "answers");
    const text = (answers?.blocks ?? []).map((b) => itemKey(b.text)).join(" | ");
    const missing = cats.filter((c) => !text.includes(itemKey(c.name)));
    out.push(
      !answers || !answers.blocks.length
        ? check("answerKey", "red", "Javob kaliti", "javoblar varag‘i yo‘q — o‘qituvchi o‘yinni tekshira olmaydi")
        : missing.length
          ? check("answerKey", "yellow", "Javob kaliti", `${missing.length} ta toifa kalitda yo‘q: ${list(missing.map((c) => c.name))}`)
          : check("answerKey", "green", "Javob kaliti", `alohida betda, ${cats.length} ta toifa bo‘yicha`),
    );
  }

  /* ── 8 (qo'shimcha). categoryNameDistinct ── */
  {
    const collisions = nameCollisions(cats);
    const names = new Set(cats.map((c) => itemKey(c.name)));
    out.push(
      names.size < cats.length
        ? check(
            "categoryNameDistinct",
            "red",
            "Toifa nomlari farqli",
            "bir xil nomli toifa bor",
            fix("Give every category a different name; two categories with the same name cannot be told apart on the screen."),
          )
        : collisions.length === 0
          ? check("categoryNameDistinct", "green", "Toifa nomlari farqli", "nomlar bir xil abstraksiya darajasida")
          : check(
              "categoryNameDistinct",
              "yellow",
              "Toifa nomlari farqli",
              `nomlar bir-birini qamrab olishi mumkin: ${list(collisions.map((c) => `«${c.a}» / «${c.b}»`))}`,
              fix(
                "Rename the overlapping categories so that they sit at the SAME level of abstraction (mammals/birds, never animals/pet animals). Overlapping levels make every item ambiguous.",
              ),
            ),
    );
  }

  return out;
}

/** Kindning qoida id lari — reyestr + qo'shimcha bandlar (test qulflaydi). */
export function sortingRuleIds(): readonly string[] {
  return [...GAME_RULE_IDS.sorting, ...SORTING_EXTRA_RULE_IDS];
}

/* ══════════════════════════ baholovchi ══════════════════════════ */

function judgeSpecOf(model: GameModel): JudgeSpec<string> {
  return specOf(model).judge as JudgeSpec<string>;
}

export function sortingJudgeSystemPrompt(model: GameModel, targets: string[]): string {
  return judgeSystemPromptFor(judgeSpecOf(model), targets);
}

export function parseSortingJudge(model: GameModel, raw: string | null | undefined, targets: string[]): SortingJudgeResult | null {
  return parseJudgeFor(judgeSpecOf(model), raw, targets);
}

export function neutralSortingJudge(model: GameModel): SortingJudgeResult {
  return neutralJudgeFor(judgeSpecOf(model));
}

export function sortingJudgeChecks(model: GameModel, j: SortingJudgeResult): ReviewCheck[] {
  return judgeChecksFor(judgeSpecOf(model), j);
}

export function scoreSortingReview(rules: ReviewCheck[], model: GameModel, j: SortingJudgeResult): number {
  return scoreReviewFor(rules, j, judgeSpecOf(model).criteria);
}

/**
 * Baholovchiga beriladigan matn — TOIFA + ELEMENTLAR shaklida.
 *
 * Bosma bo'limni (`sections`) uzatish mumkin emas: u yerda ro'yxat
 * ARALASH va qaysi element qaysi toifaniki ekani ko'rinmaydi — ya'ni
 * `itemFit` va `unambiguity` mezonlari umuman baholanmasdi.
 */
export function sortingJudgeUserPrompt(doc: AcademicDoc, maxChars = JUDGE_TEXT_CHARS): string {
  const model = doc.game;
  const cats = model?.sorting?.categories ?? [];
  const lines = cats.map((c, i) => `${i + 1}. ${c.name}: ${c.items.join(", ")}`);
  const body = sampleForJudge([{ id: SORTING_TARGET, title: "sorting", lines }], maxChars)
    .map((g) => `## ${g.id}\n${g.text}${g.truncated ? "\n[…truncated]" : ""}`)
    .join("\n\n");
  return [
    `TOOL: sorting · TYPE: ${model?.type ?? "?"}`,
    `SUBJECT: ${doc.meta.subject ?? "—"} · GRADE: ${doc.meta.grade || "—"} · LANGUAGE: ${model?.language ?? doc.meta.language}`,
    `TOPIC: ${model?.topic ?? doc.meta.topic}`,
    "",
    "ALL CATEGORIES SHOWN TOGETHER ON ONE SCREEN:",
    body,
  ].join("\n");
}

/* ══════════════════════════ asosiy ══════════════════════════ */

/** Baholovchi nishonlari — bu oilada bitta bo'lim. */
export function sortingTargets(): string[] {
  return [SORTING_TARGET];
}

export async function reviewSorting(doc: AcademicDoc, opts: SortingReviewOpts = {}): Promise<DocReview> {
  const now = opts.now ?? new Date();
  const model = doc.game;
  const rules = sortingRuleChecks(doc);
  const ok = Boolean(model && model.kind === "sorting" && model.sorting);

  let judge: SortingJudgeResult | null = null;
  const judgeNotes: string[] = [];
  if (ok && model && opts.judge !== false && opts.complete) {
    const timeoutMs = Math.min(JUDGE_TIMEOUT_MS, remainingMs(opts.deadline));
    if (timeoutMs >= JUDGE_MIN_MS) {
      const ids = sortingTargets();
      try {
        const r = await opts.complete("judge", sortingJudgeSystemPrompt(model, ids), sortingJudgeUserPrompt(doc), { json: true, maxTokens: 1200, timeoutMs });
        if (r?.usage) opts.onUsage?.(r.usage);
        judge = parseSortingJudge(model, r?.text, ids);
      } catch (e) {
        console.warn("[games] saralash baholovchisi xatosi:", e instanceof Error ? e.message : e);
      }
    }
    if (!judge) judgeNotes.push(JUDGE_NO_ANSWER);
  }

  const j = judge ?? (ok && model ? neutralSortingJudge(model) : EMPTY_JUDGE);
  judgeNotes.push(...j.notes);

  return {
    score: ok && model ? scoreSortingReview(rules, model, j) : 0,
    checks: [...rules, ...(ok && model ? sortingJudgeChecks(model, j) : [])],
    judgeNotes,
    // Bu oilada manba ro'yxati yo'q — ko'rsatkichlar 0 (panel ularni ko'rsatmaydi).
    verifiedShare: 0,
    recentShare: 0,
    builtAt: now.toISOString(),
  };
}
