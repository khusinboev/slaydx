/**
 * TAYYORLIK HISOBOTI — TINGLASH O'YINI (AUDIT-22 WP-D) — `reviewListening`.
 *
 * Ikki qatlam (`flashcards/review.ts` naqshi, mantiq NEYTRAL qatlamda
 * `report/`):
 *   1. QOIDALAR — deterministik bandlar, id lari `registry.ts`
 *      `GAME_RULE_IDS.listening` da QULFLANGAN (`listening-game.md` §4);
 *   2. BAHOLOVCHI — `judge` rol, turning `JudgeSpec` i bo'yicha 5 mezon
 *      × 0–3 (`LISTENING_JUDGE_CRITERIA`).
 *
 * ── `answerInRange` nima uchun ENG muhim band
 *
 * `ListeningItem.answer` — INDEKS. U `options` chegarasidan chiqib
 * ketsa, o'yin HAR javobni «xato» deb sanaydi va buni faqat o'ynagan
 * o'quvchi sezadi: hujjat chiroyli, bosma varaq to'g'ri, ball esa
 * har doim nol. Deterministik band shuning uchun QIZIL (sariq emas) —
 * bunday to'plam umuman yaroqsiz.
 */
import type { AcademicDoc } from "../../types";
import type { DocReview, JudgeResult, JudgeSpec, ReviewCheck } from "../../report/types";
import { check, rewrite, scoreReviewFor } from "../../report/score";
import { JUDGE_MIN_MS, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS, judgeChecksFor, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "../../report/judge";
import { sampleForJudge } from "../../report/text";
import { remainingMs } from "../../quality";
import { langInfo } from "../../i18n";
import type { LlmUsage } from "../../llm-roles";
import type { CompleteFn } from "../../research/pipeline";
import { GAME_RULE_IDS, gameTypeOf, type ListeningTypeSpec } from "../registry";
import { GAME_LIMITS, type GameModel, type ListeningItem, type ListeningModel } from "../types";
import { textKey } from "./engine";

/* ────────────────────────── tiplar ────────────────────────── */

export type ListeningJudgeResult = JudgeResult<string>;

export type ListeningReviewOpts = {
  complete?: CompleteFn;
  deadline?: number;
  judge?: boolean;
  now?: Date;
  onUsage?: (u: LlmUsage) => void;
};

export const JUDGE_TEXT_CHARS = 12_000;

/** Sayqal nishoni — bu oilada bitta bo'lim (topshiriqlar ro'yxati). */
export const LISTENING_TARGET = "items";

/**
 * Reyestrda YO'Q, lekin hisobotda BOR band.
 *
 * `distractorSimilarity` — distraktorlar to'g'ri javob bilan BIR
 * semantik maydondanmi degan EVRISTIKA (`listening-game.md` §5 yomon
 * misoli: «library» → «quyosh», «stul», «yugurish»). Reyestrga
 * qo'shilmadi, chunki u R0 shartnomasi (`tests/game-registry`) —
 * hisobot ro'yxati esa ochiq (`CROSSWORD_EXTRA_RULE_IDS` naqshi).
 */
export const LISTENING_EXTRA_RULE_IDS = ["distractorSimilarity"] as const;

const EMPTY_JUDGE = { notes: [], fixes: [] } as unknown as ListeningJudgeResult;

const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

function specOf(model: GameModel): ListeningTypeSpec {
  return gameTypeOf("listening", model.type);
}

/* ────────────────────────── evristika ────────────────────────── */

/**
 * Distraktor to'g'ri javobga «o'lchamdosh»mi (deterministik evristika).
 *
 * Semantik maydonni kod bilimay biladi — lekin uning eng ko'rinadigan
 * IZINI o'lchay oladi: bir maydondagi so'zlar odatda bir-biriga yaqin
 * uzunlikda va bir xil so'z sonida bo'ladi («kutubxona / dorixona /
 * muzey»), begona so'z esa ajralib turadi («kutubxona / yugurish /
 * stul» — ikkitasi ot, biri fe'l, uzunliklar 2 barobar farq qiladi).
 *
 * Band SARIQ beradi, qizil emas: evristika taxmin qiladi, oxirgi so'z
 * baholovchida (`distractorQuality`).
 */
export function oddDistractors(it: ListeningItem): string[] {
  const answer = it.options[it.answer];
  if (!answer) return [];
  const len = (s: string) => Math.max(1, textKey(s).length);
  const words = (s: string) => textKey(s).split(" ").filter(Boolean).length;
  const out: string[] = [];
  for (const [i, o] of it.options.entries()) {
    if (i === it.answer) continue;
    const ratio = len(o) / len(answer);
    if (ratio > LISTENING_LEN_RATIO || ratio < 1 / LISTENING_LEN_RATIO || Math.abs(words(o) - words(answer)) > 1) out.push(o);
  }
  return out;
}

/** Uzunlik nisbati: undan uzoqlashgan variant «boshqa maydondan» deb belgilanadi. */
export const LISTENING_LEN_RATIO = 2.2;

/* ══════════════════════════ qoidalar ══════════════════════════ */

export function listeningRuleChecks(doc: AcademicDoc): ReviewCheck[] {
  const model = doc.game;
  if (!model || model.kind !== "listening" || !model.listening) {
    return [check("structure", "red", "Tuzilma", "Tinglash modeli hujjatda yo‘q — qaytadan yarating")];
  }
  const spec = specOf(model);
  const m: ListeningModel = model.listening;
  const items = m.items;
  const out: ReviewCheck[] = [];
  const fix = (instruction: string) => rewrite(LISTENING_TARGET, instruction);

  /* ── 1. itemCount ── */
  {
    const n = items.length;
    const chips = GAME_LIMITS.listeningCounts;
    const exact = chips.includes(n);
    const promised = chips.find((c) => c >= n) ?? GAME_LIMITS.listeningCountMax;
    out.push(
      exact
        ? check("itemCount", "green", "Topshiriqlar soni", `${n} ta`)
        : check("itemCount", n >= GAME_LIMITS.listeningCountMin ? "yellow" : "red", "Topshiriqlar soni", `${n} ta (so‘ralgani ${promised} ta bo‘lishi mumkin — farq qaytariladi)`),
    );
  }

  /* ── 2. optionCount ── */
  {
    const [lo, hi] = spec.limits.options;
    const bad = items.filter((it) => it.options.length < lo || it.options.length > hi);
    out.push(
      bad.length === 0
        ? check("optionCount", "green", "Variantlar soni", `har topshiriqda ${lo}–${hi} ta`)
        : check(
            "optionCount",
            "red",
            "Variantlar soni",
            `${bad.length} ta topshiriqda ${lo}–${hi} tadan tashqarida: ${list(bad.map((it) => it.text))}`,
            fix(`Give every task exactly ${hi} options: one correct meaning and ${hi - 1} wrong ones from the same semantic field.`),
          ),
    );
  }

  /* ── 3. answerInRange ── */
  {
    const bad = items.filter((it) => !Number.isInteger(it.answer) || it.answer < 0 || it.answer >= it.options.length);
    out.push(
      bad.length === 0
        ? check("answerInRange", "green", "To‘g‘ri javob belgilangan", "har topshiriqda bitta to‘g‘ri variant")
        : check(
            "answerInRange",
            "red",
            "To‘g‘ri javob belgilangan",
            `${bad.length} ta topshiriqda javob indeksi variantlar orasida emas: ${list(bad.map((it) => it.text))}`,
            fix("Mark the correct option for every task; a task whose answer is not one of its options can never be answered correctly."),
          ),
    );
  }

  /* ── 4. uniqueItems ── */
  {
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const it of items) {
      const k = textKey(it.text);
      if (seen.has(k)) dup.push(it.text);
      else seen.add(k);
    }
    out.push(
      dup.length === 0
        ? check("uniqueItems", "green", "Takrorlanmaydi", `${items.length} ta so‘z, takror yo‘q`)
        : check("uniqueItems", "red", "Takrorlanmaydi", `${dup.length} ta takror: ${list(dup)}`, fix("Replace the repeated items with different words from the same topic: a repeated item wastes a question and reveals its own answer.")),
    );
  }

  /* ── 5. uniqueOptions ── */
  {
    const bad = items.filter((it) => new Set(it.options.map((o) => textKey(o))).size !== it.options.length);
    out.push(
      bad.length === 0
        ? check("uniqueOptions", "green", "Variantlar farqli", "hech bir topshiriqda takror variant yo‘q")
        : check(
            "uniqueOptions",
            "red",
            "Variantlar farqli",
            `${bad.length} ta topshiriqda bir xil variant ikki marta: ${list(bad.map((it) => it.text))}`,
            fix("Make all options of a task different from each other; a repeated option means the task has two correct answers or a wasted button."),
          ),
    );
  }

  /* ── 6. textLength ── */
  {
    const [lo, hi] = spec.limits.textChars;
    const bad = items.filter((it) => it.text.length < lo || it.text.length > hi);
    out.push(
      bad.length === 0
        ? check("textLength", "green", "Eshitiladigan matn uzunligi", `hammasi ${lo}–${hi} belgi`)
        : check(
            "textLength",
            bad.length > items.length / 4 ? "red" : "yellow",
            "Eshitiladigan matn uzunligi",
            `${items.length} tadan ${bad.length} tasi ${lo}–${hi} belgidan tashqarida: ${list(bad.map((it) => it.text))}`,
            fix(`Shorten the heard items to ${lo}–${hi} characters — one word or a short phrase a synthesiser says in one breath.`),
          ),
    );
  }

  /* ── 7. languagePair ── */
  {
    /*
     * Ikkala til BIR XIL bo'lsa mashq ma'nosini yo'qotadi («library» →
     * «library»). Kirish bosqichi buni allaqachon tuzatadi, lekin band
     * baribir kerak: hujjat TAHRIRDAN keyin ham qayta baholanadi va
     * o'shanda forma qiymatlari yo'q.
     */
    const native = textKey(m.nativeLanguage);
    const target = textKey(m.targetLanguage);
    out.push(
      native && target && native !== target
        ? check("languagePair", "green", "Tillar jufti", `${langInfo(m.targetLanguage).native} → ${langInfo(m.nativeLanguage).native}`)
        : check("languagePair", "red", "Tillar jufti", "eshitiladigan til bilan variantlar tili bir xil — mashq ma’nosini yo‘qotadi"),
    );
  }

  /* ── 8 (qo'shimcha). distractorSimilarity ── */
  {
    const odd = items.flatMap((it) => oddDistractors(it).map((o) => `«${o}» (${it.text})`));
    out.push(
      odd.length === 0
        ? check("distractorSimilarity", "green", "Distraktorlarning yaqinligi", "noto‘g‘ri variantlar to‘g‘ri javob bilan o‘lchamdosh")
        : check(
            "distractorSimilarity",
            "yellow",
            "Distraktorlarning yaqinligi",
            `${odd.length} ta variant to‘g‘ri javobdan keskin farq qiladi: ${list(odd)}`,
            fix(
              "Replace the wrong options that stand out: all options must be translations of words from the SAME semantic field, of similar length and word count, so that the pupil has to hear the item instead of guessing by shape.",
            ),
          ),
    );
  }

  return out;
}

/** Kindning qoida id lari — reyestr + qo'shimcha bandlar (test qulflaydi). */
export function listeningRuleIds(): readonly string[] {
  return [...GAME_RULE_IDS.listening, ...LISTENING_EXTRA_RULE_IDS];
}

/* ══════════════════════════ baholovchi ══════════════════════════ */

function judgeSpecOf(model: GameModel): JudgeSpec<string> {
  return specOf(model).judge as JudgeSpec<string>;
}

export function listeningJudgeSystemPrompt(model: GameModel, targets: string[]): string {
  return judgeSystemPromptFor(judgeSpecOf(model), targets);
}

export function parseListeningJudge(model: GameModel, raw: string | null | undefined, targets: string[]): ListeningJudgeResult | null {
  return parseJudgeFor(judgeSpecOf(model), raw, targets);
}

export function neutralListeningJudge(model: GameModel): ListeningJudgeResult {
  return neutralJudgeFor(judgeSpecOf(model));
}

export function listeningJudgeChecks(model: GameModel, j: ListeningJudgeResult): ReviewCheck[] {
  return judgeChecksFor(judgeSpecOf(model), j);
}

export function scoreListeningReview(rules: ReviewCheck[], model: GameModel, j: ListeningJudgeResult): number {
  return scoreReviewFor(rules, j, judgeSpecOf(model).criteria);
}

/**
 * Baholovchiga beriladigan matn — TOPSHIRIQ + TO'G'RI JAVOB + DISTRAKTORLAR.
 *
 * Bosma bo'limni uzatib bo'lmaydi: u yerda eshitiladigan matn ATAYLAB
 * yo'q (`listeningSections`), ya'ni `translationAccuracy` va
 * `wordChoice` mezonlari baholanadigan narsasiz qolardi.
 */
export function listeningJudgeUserPrompt(doc: AcademicDoc, maxChars = JUDGE_TEXT_CHARS): string {
  const model = doc.game;
  const m = model?.listening;
  const lines = (m?.items ?? []).map(
    (it, i) => `${i + 1}. HEARD: ${it.text} | CORRECT: ${it.options[it.answer] ?? "?"} | WRONG: ${it.options.filter((_, k) => k !== it.answer).join(", ")}`,
  );
  const body = sampleForJudge([{ id: LISTENING_TARGET, title: "items", lines }], maxChars)
    .map((g) => `## ${g.id}\n${g.text}${g.truncated ? "\n[…truncated]" : ""}`)
    .join("\n\n");
  return [
    `TOOL: listening · TYPE: ${model?.type ?? "?"}`,
    `HEARD LANGUAGE: ${langInfo(m?.targetLanguage ?? "en").name} · OPTIONS LANGUAGE: ${langInfo(m?.nativeLanguage ?? "uz").name}`,
    `GRADE: ${doc.meta.grade || "—"} · TOPIC: ${model?.topic ?? doc.meta.topic}`,
    "",
    "TASK SET:",
    body,
  ].join("\n");
}

/* ══════════════════════════ asosiy ══════════════════════════ */

export function listeningTargets(): string[] {
  return [LISTENING_TARGET];
}

export async function reviewListening(doc: AcademicDoc, opts: ListeningReviewOpts = {}): Promise<DocReview> {
  const now = opts.now ?? new Date();
  const model = doc.game;
  const rules = listeningRuleChecks(doc);
  const ok = Boolean(model && model.kind === "listening" && model.listening);

  let judge: ListeningJudgeResult | null = null;
  const judgeNotes: string[] = [];
  if (ok && model && opts.judge !== false && opts.complete) {
    const timeoutMs = Math.min(JUDGE_TIMEOUT_MS, remainingMs(opts.deadline));
    if (timeoutMs >= JUDGE_MIN_MS) {
      const ids = listeningTargets();
      try {
        const r = await opts.complete("judge", listeningJudgeSystemPrompt(model, ids), listeningJudgeUserPrompt(doc), { json: true, maxTokens: 1200, timeoutMs });
        if (r?.usage) opts.onUsage?.(r.usage);
        judge = parseListeningJudge(model, r?.text, ids);
      } catch (e) {
        console.warn("[games] tinglash baholovchisi xatosi:", e instanceof Error ? e.message : e);
      }
    }
    if (!judge) judgeNotes.push(JUDGE_NO_ANSWER);
  }

  const j = judge ?? (ok && model ? neutralListeningJudge(model) : EMPTY_JUDGE);
  judgeNotes.push(...j.notes);

  return {
    score: ok && model ? scoreListeningReview(rules, model, j) : 0,
    checks: [...rules, ...(ok && model ? listeningJudgeChecks(model, j) : [])],
    judgeNotes,
    verifiedShare: 0,
    recentShare: 0,
    builtAt: now.toISOString(),
  };
}
