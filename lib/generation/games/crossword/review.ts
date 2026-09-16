/**
 * KROSSVORD TAYYORLIK HISOBOTI (AUDIT-21 WP-A) — QOIDALAR QATLAMI.
 *
 * `teacher/test/review.ts` naqshi, ikki qatlam:
 *   1. QOIDALAR — deterministik bandlar (`docs/research/crossword.md`
 *      §4.1). Ular HUJJATDAN qayta hisoblanadi, chunki hisobot tahrirdan
 *      keyin ham chaqiriladi — o'shanda dvigatel yo'q. Dvigateldan faqat
 *      qayta tiklab BO'LMAYDIGAN narsa olinadi (`ask`: nechta so'z
 *      so'ralgan, qanday to'r o'lchami buyurtma qilingan, javob varag'i
 *      hujjatga qo'shilganmi).
 *   2. BAHOLOVCHI — `judge` roli, 5 mezon (clueClarity, wordGrade,
 *      gridConnectedness, answerAccuracy, originality). Mezonlarning
 *      SPETSIFIKATSIYASI reyestrda (`games/registry.ts` —
 *      `CROSSWORD_JUDGE_CRITERIA`, tur bo'yicha `guidance`), bu yerda
 *      faqat CHAQIRUV: ikkinchi nusxa yozilmaydi.
 *
 * Eng qimmat nuqson — TA'RIF JAVOBNI O'Z ICHIGA OLISHI («Biologiya —
 * bu qanday fan?» = BIOLOGIYA): krossvord bir zumda yechiladi. Uni
 * qoida bilan ANIQ tutish mumkin (o'zak solishtiruvi), shuning uchun
 * baholovchiga qoldirilmaydi.
 *
 * Qoidalar SOF funksiya: kirish — joylashgan so'zlar + to'r + `ask`,
 * chiqish — `ReviewCheck[]`. Tasodif/sana YO'Q (determinizm).
 */
import { check, rewrite, scoreReviewFor } from "../../report/score";
import {
  JUDGE_MIN_MS,
  JUDGE_NEUTRAL,
  JUDGE_NO_ANSWER,
  JUDGE_TIMEOUT_MS,
  judgeChecksFor,
  judgeSystemPromptFor,
  neutralJudgeFor,
  parseJudgeFor,
} from "../../report/judge";
import type { DocReview, JudgeResult, ReviewCheck } from "../../report/types";
import type { AcademicDoc } from "../../types";
import type { LlmUsage } from "../../llm-roles";
import { remainingMs } from "../../quality";
import { CROSSWORD_JUDGE_CRITERIA, GAME_RULE_IDS, gameTypeOf, type CrosswordJudgeCriterion } from "../registry";
import type { CrosswordModel } from "../types";
import {
  isConnected,
  normalizeAnswer,
  wordLength,
  wordText,
  type CrosswordGridData,
  type DroppedWord,
  type PlacedWord,
} from "./grid";
import { CROSSWORD_LIMITS } from "./input";

/**
 * Qoida id lari — R0 `GAME_RULE_IDS.crossword` NING HAMMASI, ustiga
 * WP-A ning IKKI qo'shimchasi:
 *
 *   `clueNotContainsAnswer` — eng qimmat nuqsonni (ta'rif javobni
 *      oshkor qiladi) deterministik tutadi; baholovchining
 *      `clueClarity` mezoni uni sezmasligi mumkin, chunki bunday ta'rif
 *      «aniq» ko'rinadi;
 *   `gridConnected` — baholovchining `gridConnectedness` mezonini
 *      TEKSHIRILADIGAN qiladi (flood fill), ya'ni ball emas, fakt.
 *
 * Reyestrga qo'shish lead ning ishi (`registry.ts` WP-A egaligida emas)
 * — shu sababli ro'yxat R0 tartibini SAQLAB, qo'shimchalarni oxiriga
 * qo'yadi va `GAME_RULE_IDS` bilan mosligi testda qulflanadi.
 */
export const CROSSWORD_EXTRA_RULE_IDS = ["clueNotContainsAnswer", "gridConnected"] as const;

export const CROSSWORD_RULE_IDS = [...GAME_RULE_IDS.crossword, ...CROSSWORD_EXTRA_RULE_IDS] as const;
export type CrosswordRuleId = (typeof CROSSWORD_RULE_IDS)[number];

/** Kesishmalar soni shundan kam bo'lmasin: so'z soni × shu ulush (§4.1). */
export const MIN_CROSSING_RATIO = 0.5;
/** To'rning eng kichik mazmunli tomoni. */
export const MIN_GRID_SIDE = 5;

/** Dvigateldan keladigan, hujjatdan QAYTA TIKLAB BO'LMAYDIGAN ma'lumot. */
export type CrosswordReviewAsk = {
  /** Foydalanuvchi so'ragan so'z soni. */
  wordCount?: number;
  /** Buyurtma qilingan to'r o'lchami (eng katta tomon). */
  gridSize?: number;
  /** Javoblar bo'limi hujjatga qo'shilganmi. */
  hasAnswers?: boolean;
  /** To'rga sig'magan/tashlangan so'zlar. */
  dropped?: readonly DroppedWord[];
};

const list = (xs: string[], max = 5) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

/* ────────────────────────── ta'rif ↔ javob ────────────────────────── */

/** Solishtirish uchun: apostrof normallashadi, kichik harf, faqat harf/raqam. */
function foldText(s: string): string {
  return normalizeAnswer(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\sʻ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ta'rif javobni (yoki uning o'zagini) o'z ichiga oladimi?
 *
 * O'zbek tili agglutinativ: «hujayralarning» ham «hujayra» ni oshkor
 * qiladi, shuning uchun to'liq so'z emas, O'ZAK qidiriladi — javobning
 * birinchi ⌈0,6×uzunlik⌉ (kamida 4) harfi.
 */
export function clueContainsAnswer(clue: string, answer: string): boolean {
  const a = foldText(answer).replace(/\s+/g, "");
  const c = foldText(clue);
  if (!a || !c) return false;
  if (c.includes(a)) return true;
  const chars = [...a];
  const rootLen = Math.max(4, Math.ceil(chars.length * 0.6));
  if (chars.length <= 4 || rootLen >= chars.length) return false;
  return c.includes(chars.slice(0, rootLen).join(""));
}

/* ────────────────────────── qoidalar ────────────────────────── */

/**
 * O'nta band — hammasi SOF funksiya, testda bitta-bitta qo'zg'atiladi
 * (`tests/crossword-review.test.mts`).
 */
export function crosswordRuleChecks(words: readonly PlacedWord[], grid: CrosswordGridData, ask: CrosswordReviewAsk = {}): ReviewCheck[] {
  const out: ReviewCheck[] = [];
  const dropped = ask.dropped ?? [];

  /* 1. wordCount — va'da qilingancha so'z to'rga tushdimi. */
  const want = Math.max(1, Math.round(ask.wordCount ?? words.length));
  const share = want ? words.length / want : 1;
  out.push(
    check(
      "wordCount",
      words.length === want ? "green" : share >= 0.8 ? "yellow" : "red",
      "So'zlar soni",
      `${words.length} / ${want} so'z to'rga tushdi${dropped.length ? `; ${dropped.length} so'z tashlandi` : ""}`,
      words.length < want ? rewrite("grid", "To'rga sig'maydigan so'zlar o'rniga qisqaroq (3–6 harfli) so'zlar tanlang.") : undefined,
    ),
  );

  /* 2. gridSize — to'r buyurtma o'lchamiga va 21×21 chegarasiga sig'adimi. */
  const maxSide = Math.max(grid.rows, grid.cols);
  const limit = Math.min(21, Math.round(ask.gridSize ?? 21));
  out.push(
    check(
      "gridSize",
      maxSide <= limit && maxSide >= MIN_GRID_SIDE ? "green" : maxSide <= 21 ? "yellow" : "red",
      "To'r o'lchami",
      // To'r RAMKA bo'yicha kesiladi (§3), shuning uchun u buyurtma
      // o'lchamidan kichik bo'lishi NORMAL — kattasi nuqson.
      `${grid.rows}×${grid.cols} (buyurtma ≤ ${limit})`,
      maxSide > limit ? rewrite("grid", "To'r buyurtma o'lchamidan katta chiqdi — uzun so'zlar sonini kamaytiring.") : undefined,
    ),
  );

  /* 3. minCrossings — o'zaro bog'lanish yetarlimi. */
  const crossings = countGridCrossings(words);
  const need = Math.ceil(words.length * MIN_CROSSING_RATIO);
  out.push(
    check(
      "minCrossings",
      crossings >= need ? "green" : crossings >= Math.ceil(need / 2) ? "yellow" : "red",
      "Kesishmalar",
      `${crossings} ta kesishma (kamida ${need} kerak)`,
      crossings < need ? rewrite("grid", "So'zlarni ko'proq kesishadigan qilib tanlang: umumiy harflari ko'p so'zlar qo'shing.") : undefined,
    ),
  );

  /* 4. wordLength — har javob 3–15 katak. */
  const badLen = words.filter((w) => {
    const n = wordLength(w);
    return n < CROSSWORD_LIMITS.answerMin || n > CROSSWORD_LIMITS.answerMax;
  });
  out.push(
    check(
      "wordLength",
      badLen.length === 0 ? "green" : badLen.length <= 1 ? "yellow" : "red",
      "So'z uzunligi",
      badLen.length ? `chegaradan tashqari: ${list(badLen.map((w) => `${wordText(w.answer)} (${wordLength(w)})`))}` : `hammasi ${CROSSWORD_LIMITS.answerMin}–${CROSSWORD_LIMITS.answerMax} katak`,
      badLen.length ? rewrite("grid", `Har javob ${CROSSWORD_LIMITS.answerMin}–${CROSSWORD_LIMITS.answerMax} harfli bitta so'z bo'lsin.`) : undefined,
    ),
  );

  /* 5. clueLength — ta'rif 10–150 belgi. */
  const badClue = words.filter((w) => w.clue.trim().length < CROSSWORD_LIMITS.clueMin || w.clue.trim().length > CROSSWORD_LIMITS.clueMax);
  out.push(
    check(
      "clueLength",
      badClue.length === 0 ? "green" : badClue.length / Math.max(1, words.length) <= 0.2 ? "yellow" : "red",
      "Ta'rif uzunligi",
      badClue.length ? `${badClue.length} ta'rif ${CROSSWORD_LIMITS.clueMin}–${CROSSWORD_LIMITS.clueMax} belgi oralig'ida emas: ${list(badClue.map((w) => wordText(w.answer)))}` : "hammasi o'lchamda",
      badClue.length
        ? rewrite("clues", `Juda qisqa yoki juda uzun ta'riflarni qayta yozing (${CROSSWORD_LIMITS.clueMin}–${CROSSWORD_LIMITS.clueMax} belgi).`)
        : undefined,
    ),
  );

  /* 6. uniqueWords — dublikat javob yo'q. */
  const seen = new Map<string, number>();
  for (const w of words) {
    const k = normalizeAnswer(wordText(w.answer));
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  out.push(
    check(
      "uniqueWords",
      dupes.length === 0 ? "green" : "red",
      "Takrorlanmas so'zlar",
      dupes.length ? `takrorlangan: ${list(dupes)}` : "dublikat yo'q",
      dupes.length ? rewrite("clues", "Takrorlangan javoblarni boshqa atamalar bilan almashtiring.") : undefined,
    ),
  );

  /* 7. clueNotContainsAnswer — ta'rifda javobning o'zi/o'zagi yo'q. */
  const leaky = words.filter((w) => clueContainsAnswer(w.clue, wordText(w.answer)));
  out.push(
    check(
      "clueNotContainsAnswer",
      leaky.length === 0 ? "green" : "red",
      "Ta'rif javobni oshkor qilmaydi",
      leaky.length ? `javob ta'rifda ko'rinib turibdi: ${list(leaky.map((w) => wordText(w.answer)))}` : "hech bir ta'rifda javob yo'q",
      leaky.length
        ? rewrite("clues", "Ta'rifda javobning o'zini yoki o'zagini ishlatmang — tushunchani boshqa so'zlar bilan tavsiflang.")
        : undefined,
    ),
  );

  /* 8. gridMatchesWords — to'rdagi harflar so'zlarga mos. */
  const mismatched = words.filter((w) => !wordFitsGrid(w, grid));
  out.push(
    check(
      "gridMatchesWords",
      mismatched.length === 0 ? "green" : "red",
      "To'r so'zlarga mos",
      mismatched.length ? `to'rda mos kelmagan: ${list(mismatched.map((w) => wordText(w.answer)))}` : `${words.length} so'zning harflari to'rda o'z joyida`,
      mismatched.length ? rewrite("grid", "To'rni qayta quring — so'z harflari kataklarga mos tushmagan.") : undefined,
    ),
  );

  /* 9. gridConnected — barcha harflar bitta bo'lakda. */
  const connected = gridConnected(grid);
  out.push(
    check(
      "gridConnected",
      connected ? "green" : "red",
      "To'r bog'langan",
      connected ? "barcha so'zlar bir-biriga ulangan" : "to'r ikkiga bo'linib qolgan (ajralgan so'zlar bor)",
      connected ? undefined : rewrite("grid", "Ajralib qolgan so'zlarni boshqa so'zlar bilan kesishadigan qilib almashtiring."),
    ),
  );

  /* 10. answerSheet — javoblar varag'i hujjatda bormi. */
  const hasAnswers = ask.hasAnswers !== false;
  out.push(
    check(
      "answerSheet",
      hasAnswers ? "green" : "red",
      "Javoblar varag'i",
      hasAnswers ? "javoblar alohida betda berilgan" : "javoblar bo'limi topilmadi",
      hasAnswers ? undefined : rewrite("answers", "Javoblar varag'ini alohida betdan qo'shing."),
    ),
  );

  // Tartib — REYESTRDAN (`GAME_RULE_IDS` + qo'shimchalar): panel va
  // testlar shu tartibga tayanadi, bu yerdagi `push` ketma-ketligiga emas.
  const order = new Map(CROSSWORD_RULE_IDS.map((id, i) => [id as string, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

/* ────────────────────────── yordamchilar ────────────────────────── */

/** So'zning harflari to'rda o'z joyidami. */
export function wordFitsGrid(w: PlacedWord, grid: CrosswordGridData): boolean {
  const cells = w.answer;
  for (let i = 0; i < cells.length; i++) {
    const r = w.dir === "across" ? w.row : w.row + i;
    const c = w.dir === "across" ? w.col + i : w.col;
    if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) return false;
    if (grid.cells[r]?.[c] !== cells[i]) return false;
  }
  return true;
}

/** Ikki yo'nalishdagi so'z umumiy katakni bo'lishsa — kesishma. */
export function countGridCrossings(words: readonly PlacedWord[]): number {
  const owners = new Map<string, Set<string>>();
  for (const w of words) {
    const n = wordLength(w);
    for (let i = 0; i < n; i++) {
      const r = w.dir === "across" ? w.row : w.row + i;
      const c = w.dir === "across" ? w.col + i : w.col;
      const k = `${r}:${c}`;
      const set = owners.get(k);
      if (set) set.add(w.dir);
      else owners.set(k, new Set([w.dir]));
    }
  }
  let n = 0;
  for (const dirs of owners.values()) if (dirs.size > 1) n++;
  return n;
}

/** To'rning harfli kataklari bitta bog'langan bo'lakmi. */
export function gridConnected(grid: CrosswordGridData): boolean {
  if (!grid.rows || !grid.cols) return true;
  const size = Math.max(grid.rows, grid.cols);
  const board = {
    size,
    cell: new Array<string>(size * size).fill(""),
    across: new Int16Array(size * size).fill(-1),
    down: new Int16Array(size * size).fill(-1),
  };
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const ch = grid.cells[r]?.[c];
      if (ch) board.cell[r * size + c] = ch;
    }
  }
  return isConnected(board);
}

/* ────────────────────────── baholovchi ────────────────────────── */

export type CrosswordJudgeResult = JudgeResult<CrosswordJudgeCriterion>;

/**
 * Baholovchiga beriladigan matn: raqam, JAVOB va ta'rif.
 *
 * Javob ATAYLAB ko'rsatiladi — `answerAccuracy` va `clueClarity`
 * mezonlari ta'rif javobga mos kelishini baholaydi, javobsiz ular
 * ma'nosiz bo'lardi.
 */
export function crosswordJudgeUserPrompt(model: CrosswordModel, topic: string): string {
  const byId = new Map(model.words.map((w) => [w.id, w]));
  const line = (c: { number: number; text: string; wordId: string; length: number }, dir: string) => {
    const w = byId.get(c.wordId);
    return `${c.number}. [${dir} · ${c.length} katak] ${c.text} → ${w ? wordText(w.answer) : "?"}`;
  };
  return [
    `TOPIC: ${topic}`,
    `GRID: ${model.grid.rows}×${model.grid.cols} · WORDS: ${model.words.length} · DROPPED: ${model.dropped.length}`,
    "",
    "CLUES AND ANSWERS:",
    ...model.clues.across.map((c) => line(c, "across")),
    ...model.clues.down.map((c) => line(c, "down")),
  ].join("\n");
}

/** Hisobotdagi qoidalar + baholovchi → 0–100 ball. */
export function scoreCrosswordReview(rules: ReviewCheck[], judge: CrosswordJudgeResult): number {
  return scoreReviewFor(rules, judge, CROSSWORD_JUDGE_CRITERIA);
}

const RULE_SET = new Set<string>(CROSSWORD_RULE_IDS);

/**
 * Sayqaldan keyin: yangi hisobotning QOIDALARI + ESKI baholovchi
 * ballari (model qayta javob bermaganda). Neytral 2/3 bilan taqqoslash
 * adolatsiz bo'lardi — eski qattiq baho neytralga «o'sib» soxta qabulga
 * olib kelardi (`report/polish-core.ts` izohi).
 */
export function rescoreCrossword(fresh: DocReview, judge: CrosswordJudgeResult): DocReview {
  return { ...fresh, score: scoreCrosswordReview(fresh.checks.filter((c) => RULE_SET.has(c.id)), judge) };
}

/**
 * Eski hisobotdan baholovchi ballari (sayqalda model javob bermasa).
 * `judge:<mezon>` bandlarining `detail` i — «3/3» shaklida.
 */
export function crosswordJudgeFromReview(prev: DocReview): CrosswordJudgeResult | null {
  const scores: Partial<Record<CrosswordJudgeCriterion, number>> = {};
  let found = 0;
  for (const c of prev.checks) {
    if (!c.id.startsWith("judge:") || c.id.startsWith("judge:fix:")) continue;
    const key = c.id.slice(6) as CrosswordJudgeCriterion;
    if (!(CROSSWORD_JUDGE_CRITERIA as readonly string[]).includes(key)) continue;
    const n = Number(/^(\d)\s*\/\s*3$/.exec(c.detail ?? "")?.[1]);
    scores[key] = Number.isFinite(n) ? n : JUDGE_NEUTRAL;
    found++;
  }
  if (!found) return null;
  return {
    ...(Object.fromEntries(CROSSWORD_JUDGE_CRITERIA.map((k) => [k, scores[k] ?? JUDGE_NEUTRAL])) as Record<CrosswordJudgeCriterion, number>),
    notes: [],
    fixes: [],
  };
}

export type CrosswordReviewOpts = {
  ask?: CrosswordReviewAsk;
  complete?: (
    role: "judge",
    system: string,
    user: string,
    o: { json?: boolean; maxTokens?: number; timeoutMs?: number },
  ) => Promise<{ text: string; usage?: LlmUsage } | null>;
  deadline?: number;
  /** `false` — baholovchi chaqirilmaydi (testlar). */
  judge?: boolean;
  now?: Date;
  onUsage?: (u: LlmUsage) => void;
};

/** Hisobotning nishonlari: baholovchi faqat shu bo'limlarni ko'rsata oladi. */
const JUDGE_TARGETS = ["clues", "grid", "answers"];

/**
 * HUJJAT DARAJASIDAGI HISOBOT — qoidalar + baholovchi.
 *
 * Model hujjatdan o'qiladi (`doc.game.crossword`), chunki hisobot
 * tahrirdan keyin ham chaqiriladi va o'shanda dvigatel yo'q.
 */
export async function reviewCrossword(doc: AcademicDoc, opts: CrosswordReviewOpts = {}): Promise<DocReview> {
  const now = opts.now ?? new Date();
  const model = doc.game?.crossword;
  if (!model) {
    return { score: 0, checks: [], judgeNotes: ["Krossvord modeli yo'q"], verifiedShare: 0, recentShare: 0, builtAt: now.toISOString() };
  }
  const spec = gameTypeOf("crossword", doc.game?.type);
  const rules = crosswordRuleChecks(model.words, model.grid, {
    ...opts.ask,
    dropped: opts.ask?.dropped ?? model.dropped,
    // Javoblar bo'limi HUJJATDAN tekshiriladi (tahrirdan keyin ham to'g'ri).
    hasAnswers: opts.ask?.hasAnswers ?? doc.sections.some((s) => s.id === "answers" && s.blocks.length > 0),
  });

  let judge: CrosswordJudgeResult | null = null;
  const judgeNotes: string[] = [];
  if (opts.judge !== false && opts.complete) {
    const timeoutMs = Math.min(JUDGE_TIMEOUT_MS, remainingMs(opts.deadline));
    if (timeoutMs >= JUDGE_MIN_MS) {
      try {
        const r = await opts.complete("judge", judgeSystemPromptFor(spec.judge, JUDGE_TARGETS), crosswordJudgeUserPrompt(model, doc.meta.topic), {
          json: true,
          maxTokens: 1200,
          timeoutMs,
        });
        if (r?.usage) opts.onUsage?.(r.usage);
        judge = parseJudgeFor(spec.judge, r?.text, JUDGE_TARGETS);
      } catch (e) {
        console.warn("[crossword] baholovchi xatosi:", e instanceof Error ? e.message : e);
      }
    }
    if (!judge) judgeNotes.push(JUDGE_NO_ANSWER);
  }
  const j = judge ?? neutralJudgeFor(spec.judge);
  judgeNotes.push(...j.notes);

  return {
    score: scoreCrosswordReview(rules, j),
    checks: [...rules, ...judgeChecksFor(spec.judge, j)],
    judgeNotes,
    verifiedShare: 0,
    recentShare: 0,
    builtAt: now.toISOString(),
  };
}
