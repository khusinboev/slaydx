/**
 * AVTO-SAYQAL — NEYTRAL YADRO (AUDIT-19 R0-A; mantiq AUDIT-18 WP-A dan
 * KO'CHIRILGAN, xulq o'zgarmagan).
 *
 *   applyPolishWith(doc, fixes, {rewrite})  → fix lar PARALLEL → op lar
 *   runPolishWith(doc, review, deps)        → plan → apply → hujjatga
 *                                             qo'llash → qayta hisobot →
 *                                             ball OSHSA qabul (Q-3)
 *
 * Hujjat turiga bog'liq hamma narsa DEPENDENSIYA: `plan` (qaysi bandlar
 * tuzatiladi), `rewrite` (LLM bilan qayta yozish), `apply` (op larni
 * hujjatga qo'llash), `review` (qayta hisobot), `judgeFromReview` va
 * `rescore` (baholovchi javob bermasa eski ballarni tiklash). Shuning
 * uchun `Op` generik — maqolada `ArticleOp`, kurs ishida `WorkOp`.
 *
 * Qarorlar (docs/AUDIT-18.md §1):
 *   • Q-2 HALOLLIK CHEGARASI — `needsUserData` + `HONESTY_LIMIT`: AI
 *     tajriba natijasi, dastgoh/platforma nomi, statistik test yoki
 *     aniqlik foizini O'YLAB TOPMAYDI.
 *   • Q-3 — sayqal natijasi faqat ball `acceptDelta` dan ko'p OSHSA
 *     qabul qilinadi (maqola 0; kurs ishida X-5 bo'yicha +2 bo'ladi).
 */
import { mapPool, remainingMs } from "../quality";
import type { AcademicDoc, Block } from "../types";
import type { DocReview, PolishLog, ReviewGuardInput, UserNeed } from "./types";
import { JUDGE_NO_ANSWER } from "./judge";

/* ────────────────────────── konstantalar ────────────────────────── */

/** Bir sayqalda ko'pi bilan shuncha fix (vaqt/narx byudjeti: 2 to'lqin × 3 parallel). */
export const POLISH_MAX_FIXES = 6;
/** Bitta qayta yozish chaqiruvi — «Tuzatish» bilan bir xil. */
export const REWRITE_TIMEOUT_MS = 30_000;
/** Baholovchi uchun ajratib qo'yiladigan vaqt — tuzatishlar shundan oldin tugashi kerak. */
export const POLISH_JUDGE_RESERVE_MS = 40_000;
/** Tuzatishlarga shundan kam vaqt qolsa sayqal umuman boshlanmaydi. */
export const POLISH_MIN_FIX_MS = 10_000;

/** `PolishLog.skipped[].reason` kalitlari → panel matni. */
export const POLISH_SKIP: Record<string, string> = {
  user: "sizning ma’lumotingiz kerak",
  manual: "avtomatik tuzatilmaydi",
  limit: `bir sayqalda ko‘pi bilan ${POLISH_MAX_FIXES} band`,
  budget: "vaqt byudjeti yetmadi",
  error: "model javob bermadi",
};

/** Hisobot izohi — baholovchi qayta chaqirilmaganini aytadi («Tuzatish»). */
export const REWRITE_REVIEW_NOTE =
  "Tuzatishdan keyin qoidalar qayta tekshirildi; baholovchi ballari avvalgi baholashdan — to‘liq qayta baholash uchun maqolani qaytadan yarating.";
/** Sayqalda baholovchi javob bermasa — ballari eski hisobotdan, izoh bilan. */
export const POLISH_JUDGE_NOTE = "Sayqaldan keyin baholovchi javob bermadi — ballari avvalgi baholashdan.";

/** Sof qism xatosi — server `ApiError(message, status, {code})` ga o'giradi. */
export class RewriteError extends Error {
  constructor(
    message: string,
    public readonly status: 409 | 422,
    public readonly code: "llm" | "legacy" | "target",
  ) {
    super(message);
    this.name = "RewriteError";
  }
}

/* ────────────────────────── Q-2: foydalanuvchi ma'lumoti kerakmi ────────────────────────── */

/*
 * KUCHLI belgilar — tajriba/o'lchov/uskuna/statistika: uchrasa tavsiya
 * foydalanuvchi natijasisiz bajarilmaydi. KUCHSIZ (`methods`/`results`/
 * «natija»/«metod») — faqat «qo'sh/keltir/ko'rsat/tavsifla» kabi fe'l
 * bilan birga (aks holda «natijalarni manbalar bilan taqqosla» kabi
 * xavfsiz tavsiya ham tushib qolardi). Lookbehind — kirill/lotin so'z
 * boshi (`\b` JS da faqat ASCII).
 */
export const STRONG_RE =
  /(?<![\p{L}])(experiment\w*|sample(?:\s+size)?|participants?|respondents?|data\s?sets?|measur\w*|instrument\w*|sensor\w*|equipment|apparatus|machine\s+tools?|accuracy|precision|diagnostic\w*|p-?values?|statistic\w*|confidence\s+interval|effect\s+size|quantitative|parameters?|specifications?|reproduc\w*|tajriba\w*|datchik\w*|dastgoh\w*|aniqlik\w*|tanlanma\w*|o[‘’'`]?lchov\w*|ishtirokchi\w*|statistik\w*|parametr\w*|uskuna\w*|qurilma\w*|platform\w*|software|tool\s+names?|randomi[sz]\w*|protocol\w*|hyperparameter\w*|t-?tests?|anova|platforma\w*|dasturiy\s+vosita\w*|protsedura\w*|giperparametr\w*|эксперимент\w*|датчик\w*|станк\w*|станок|точност\w*|выборк\w*|измерен\w*|участник\w*|статистич\w*|параметр\w*|оборудован\w*|платформ\w*|программ\w*|рандомиз\w*|гиперпараметр\w*)/iu;
export const WEAK_RE = /(?<![\p{L}])(methods?|methodolog\w*|results?|findings|natija\w*|metod\w*|usul\w*|результат\w*|метод\w*|ko[‘’'`]?rsatkich\w*|показател\w*|numbers?|figures|raqam\w*|цифр\w*|числ\w*)/iu;
export const ADD_RE = /(?<![\p{L}])(add|provide|include|report|present|describe|specify|detail|state|give|quantify|qo[‘’'`]?sh\w*|keltir\w*|ko[‘’'`]?rsat\w*|tavsifla\w*|yoz\w*|bayon\w*|добав\w*|привед\w*|укаж\w*|опиш\w*|предостав\w*|включ\w*)/iu;

/**
 * Q-2 ning prompt qatlami — ko'rsatma nima so'ramasin, model faqat FAKT /
 * JORIY MATN / MANBADA bor tafsilotni yozadi; yo'g'ini «keltirilmagan» deb
 * aytadi. Kalit so'z filtri o'tkazib yuborgan tavsiyalar uchun oxirgi to'siq.
 */
export const HONESTY_LIMIT =
  "HONESTY LIMIT (overrides the instruction above): every tool, platform or software name, statistical test, procedure detail, parameter, sample detail or number you write must ALREADY appear in USER FACTS, the CURRENT TEXT or a SOURCE. If the instruction asks for details the author did not report, do NOT invent them — state explicitly that they are not reported (e.g. «qo‘llanilgan aniq statistik test va platforma tadqiqotda keltirilmagan») or keep the sentence qualitative. Inventing unreported specifics is a critical error.";

/** Q-2: tavsiya natija/tajriba ma'lumotini TALAB qiladimi (foydalanuvchi faktisiz bajarilmaydi). */
export function needsUserData(instruction: string): boolean {
  const s = instruction.replace(/\s+/g, " ");
  if (STRONG_RE.test(s)) return true;
  return WEAK_RE.test(s) && ADD_RE.test(s);
}

/* ────────────────────────── reja ────────────────────────── */

export type Fix = { op: "rewrite"; target: string; instruction: string };
export type PolishSkip = { id: string; reason: string };
export type PolishPlan = { fixes: Fix[]; skipped: PolishSkip[] };

/* ────────────────────────── vizual bloklar ────────────────────────── */

const VISUAL = new Set<Block["kind"]>(["figure", "tableRef", "formula"]);

/** Eski vizual bloklarni yangi matn ichiga (eski indeks bo'yicha) qaytaradi. */
export function keepVisuals(oldBlocks: Block[], text: Block[]): Block[] {
  const out = text.slice();
  oldBlocks.forEach((b, i) => {
    if (VISUAL.has(b.kind)) out.splice(Math.min(i, out.length), 0, { ...b });
  });
  return out;
}

export const isVisualBlock = (kind: Block["kind"]): boolean => VISUAL.has(kind);

/* ────────────────────────── apply ────────────────────────── */

/** Bitta fix natijasi: op lar + qo'riqchi hisobi (hujjat O'ZGARMAYDI). */
export type RewriteOutOf<Op> = {
  ops: Op[];
  unresolved: { id: string; sectionId: string }[];
  /** Qayta yozilgan bo'lim id lari — eskirgan qo'riqchi yozuvini almashtirish uchun. */
  rewrittenSections: string[];
};

export type ApplyPolishDeps<Op> = {
  rewrite: (doc: AcademicDoc, fix: Fix) => Promise<RewriteOutOf<Op>>;
  /** Parallel chaqiruvlar soni (standart 3). */
  concurrency?: number;
};

export type ApplyPolishResultOf<Op> = {
  ops: Op[];
  applied: Fix[];
  failed: { fix: Fix; reason: string }[];
  /** Qayta yozilgan bo'limlarning qo'riqchi hisobi (hisobot `guard` uchun). */
  unresolved: { id: string; sectionId: string }[];
  rewrittenSections: string[];
};

/**
 * Fix lar PARALLEL (`mapPool`, standart 3) — hammasi ASL hujjat ustida
 * (nishonlar farqli, reja birlashtirgan). Bitta fix xatosi boshqalarini
 * to'xtatmaydi — `failed` ga tushadi.
 */
export async function applyPolishWith<Op>(doc: AcademicDoc, fixes: Fix[], deps: ApplyPolishDeps<Op>): Promise<ApplyPolishResultOf<Op>> {
  const out: ApplyPolishResultOf<Op> = { ops: [], applied: [], failed: [], unresolved: [], rewrittenSections: [] };
  type One = { fix: Fix; r: RewriteOutOf<Op> } | { fix: Fix; error: string };
  const results = await mapPool(fixes, deps.concurrency ?? 3, async (fix): Promise<One> => {
    try {
      return { fix, r: await deps.rewrite(doc, fix) };
    } catch (e) {
      return { fix, error: e instanceof Error ? e.message : String(e) };
    }
  });
  for (const x of results) {
    if ("error" in x) {
      out.failed.push({ fix: x.fix, reason: x.error });
      continue;
    }
    out.ops.push(...x.r.ops);
    out.applied.push(x.fix);
    out.unresolved.push(...x.r.unresolved);
    out.rewrittenSections.push(...x.r.rewrittenSections);
  }
  return out;
}

/* ────────────────────────── run ────────────────────────── */

export type ApplyOpsResult = { ok: true; doc: AcademicDoc } | { ok: false; error: string };

/**
 * `J` — baholovchi natijasi tipi (`JudgeResult<C>`): yadro uni OCHMAYDI,
 * faqat `judgeFromReview` dan `rescore` ga uzatadi — shuning uchun mezon
 * ro'yxati bu yerda bilinmaydi.
 */
export type RunPolishDeps<Op, J> = {
  /** Hisobot → tuzatiladigan bandlar rejasi. */
  plan: (review: DocReview, doc: AcademicDoc) => PolishPlan;
  /** «Sizdan kutiladi» — hisobotga yoziladi (qabul/rad — baribir). */
  userNeeds: (review: DocReview, doc: AcademicDoc) => UserNeed[];
  /** Bitta fix ni LLM bilan bajaradi; `deadline` — tuzatishlar uchun (baholovchi ulushisiz). */
  rewrite: (doc: AcademicDoc, fix: Fix, deadline: number) => Promise<RewriteOutOf<Op>>;
  /** Op larni hujjatga qo'llash (chuqur nusxa ustida). */
  apply: (doc: AcademicDoc, ops: Op[]) => ApplyOpsResult;
  /** Yangi hujjat bo'yicha QAYTA hisobot (baholovchi bilan). */
  review: (doc: AcademicDoc, guard: ReviewGuardInput) => Promise<DocReview>;
  /** Eski hisobotdan baholovchi ballari (javob bo'lmaganda). */
  judgeFromReview: (prev: DocReview) => J | null;
  /** Eski ballar bilan qayta hisoblangan hisobot. */
  rescore: (fresh: DocReview, j: J) => DocReview;
  /** Qabul chegarasi: `after > before + acceptDelta` (standart 0 — AUDIT-18 Q-3). */
  acceptDelta?: number;
  deadline: number;
  /** `false` — baholovchi chaqirilmaydi (testlar); standart `true`. */
  judge?: boolean;
  now?: Date;
  /** Dvigateldan: qo'riqchi hisobi (qayta yozilgan bo'limlarniki almashadi). */
  guard?: ReviewGuardInput;
  concurrency?: number;
};

export type RunPolishResult<Op> = {
  doc: AcademicDoc;
  review: DocReview;
  plan: PolishPlan;
  /** Qabul qilingan op lar (rad etilsa bo'sh). */
  ops: Op[];
  applied: Fix[];
  failed: { fix: Fix; reason: string }[];
  accepted: boolean;
  log: PolishLog;
};

/**
 * Plan → apply → hujjatga qo'llash → qayta hisobot → Q-3.
 * Baholovchi javob bermasa ballari ESKI hisobotdan ko'chiriladi (izoh
 * bilan) — neytral 2/3 bilan taqqoslash adolatsiz bo'lardi (eski qattiq
 * baho neytralga «o'sib» soxta qabulga olib kelardi).
 */
export async function runPolishWith<Op, J>(doc: AcademicDoc, review: DocReview, deps: RunPolishDeps<Op, J>): Promise<RunPolishResult<Op>> {
  const now = deps.now ?? new Date();
  const plan = deps.plan(review, doc);
  const before = review.score;
  const needs = deps.userNeeds(review, doc);
  const reject = (skipped: PolishSkip[], applied: Fix[] = [], failed: RunPolishResult<Op>["failed"] = [], after = before): RunPolishResult<Op> => {
    const log: PolishLog = { before, after, applied: applied.map(({ target, instruction }) => ({ target, instruction })), skipped, accepted: false, at: now.toISOString() };
    return { doc, review: { ...review, polish: log, userNeeds: needs }, plan, ops: [], applied, failed, accepted: false, log };
  };
  if (!plan.fixes.length) return reject(plan.skipped);

  const judge = deps.judge !== false;
  const fixDeadline = deps.deadline - (judge ? POLISH_JUDGE_RESERVE_MS : 0);
  if (remainingMs(fixDeadline) < POLISH_MIN_FIX_MS) return reject([...plan.skipped, { id: "budget", reason: "budget" }]);

  const ap = await applyPolishWith<Op>(doc, plan.fixes, { concurrency: deps.concurrency, rewrite: (d, fix) => deps.rewrite(d, fix, fixDeadline) });
  const failedSkips: PolishSkip[] = ap.failed.map((f) => ({ id: f.fix.target, reason: "error" }));
  if (!ap.applied.length) return reject([...plan.skipped, ...failedSkips], [], ap.failed);

  const res = deps.apply(doc, ap.ops);
  if (!res.ok) {
    console.warn("[report] sayqal op lari qo'llanmadi:", res.error);
    return reject([...plan.skipped, ...failedSkips, { id: "ops", reason: "error" }], [], ap.failed);
  }

  // Qo'riqchi: qayta yozilgan bo'limlarning eski `unresolved`/`empty` yozuvi eskirgan — yangisi bilan almashadi.
  const rewritten = new Set(ap.rewrittenSections);
  const guard: ReviewGuardInput = {
    unresolved: [...(deps.guard?.unresolved ?? []).filter((u) => !rewritten.has(u.sectionId)), ...ap.unresolved],
    emptySections: (deps.guard?.emptySections ?? []).filter((id) => !rewritten.has(id)),
  };
  let fresh = await deps.review(res.doc, guard);
  if (judge && fresh.judgeNotes.includes(JUDGE_NO_ANSWER)) {
    const j = deps.judgeFromReview(review);
    if (j) fresh = deps.rescore(fresh, j);
  }
  const after = fresh.score;
  const accepted = after > before + (deps.acceptDelta ?? 0);
  const log: PolishLog = {
    before,
    after,
    applied: ap.applied.map(({ target, instruction }) => ({ target, instruction })),
    skipped: [...plan.skipped, ...failedSkips],
    accepted,
    at: now.toISOString(),
  };
  if (!accepted) return { doc, review: { ...review, polish: log, userNeeds: needs }, plan, ops: [], applied: ap.applied, failed: ap.failed, accepted, log };
  const newReview: DocReview = { ...fresh, polish: log, userNeeds: deps.userNeeds(fresh, res.doc) };
  return { doc: res.doc, review: newReview, plan, ops: ap.ops, applied: ap.applied, failed: ap.failed, accepted, log };
}
