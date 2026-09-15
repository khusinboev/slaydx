/**
 * TAYYORLIK HISOBOTI — NEYTRAL TIPLAR (Talaba ishlari 2, AUDIT-19 R0-A).
 *
 * Bu qatlam maqolaga (`lib/generation/article/`) BOG'LIQ EMAS: kurs ishi
 * (`work/`), insho (`essay/`) va maqola bitta hisobot/sayqal mantig'idan
 * foydalanadi. Maqola tiplari (`article/types.ts`) shu yerdan RE-EXPORT
 * qilinadi — mavjud importlar (`ArticleReview`, `ReviewCheck`, …) o'z
 * joyida qoladi (AUDIT-19 X-7: `article/*` xulqi zarracha o'zgarmaydi).
 *
 * Nega generik `JudgeResult<C>`/`JudgeSpec<C>`: baholovchi mezonlari
 * hujjat turiga qarab boshqacha (maqola — 6 mezon, kurs ishi — logic/
 * depth/style/aimMatch/originality, IELTS insho — TR/CC/LR/GRA). Mezon
 * ro'yxati SPETSIFIKATSIYADA, mantiq esa bitta joyda.
 */

/* ────────────────────────── tekshiruv bandlari ────────────────────────── */

export type ReviewLevel = "green" | "yellow" | "red";

export type ReviewCheck = {
  id: string;
  level: ReviewLevel;
  label: string;
  detail?: string;
  /** «Tuzatish» tugmasi — server qayta yozadi (`rewrite` op). */
  fix?: { op: "rewrite"; target: string; instruction: string };
};

/**
 * Avto-sayqal jurnali (AUDIT-18 Q-1…Q-3) — `runPolishWith` yozadi.
 * `accepted` — yangi ball eskisidan `acceptDelta` dan ko'p OSHGANDA;
 * aks holda eski hujjat qoladi, `after` — rad etilgan urinish bali.
 * `skipped[].reason` — `POLISH_SKIP` kalitlari: `user` (foydalanuvchi
 * ma'lumoti kerak, Q-2), `manual`, `limit`, `budget`, `error`.
 */
export type PolishLog = {
  before: number;
  after: number;
  applied: { target: string; instruction: string }[];
  skipped: { id: string; reason: string }[];
  accepted: boolean;
  at: string;
};

/**
 * «Sizdan kutiladi» bandi (Q-2): AI o'ylab topmaydigan ma'lumot.
 * `id` ATAYLAB keng (`string`) — maqolada `udk|authors|results`, kurs
 * ishida `refs`/`toc`/`facts` kabi bandlar qo'shiladi; panel `id` ni
 * havola jadvalida ishlatadi.
 */
export type UserNeed = { id: string; label: string; hint: string };

/** Hisobotdan QAYTA HISOBLAB BO'LMAYDIGAN qism (dvigateldan keladi). */
export type ReviewGuardInput = {
  unresolved?: { id: string; sectionId: string }[];
  emptySections?: string[];
};

/**
 * Hujjat tayyorligi hisoboti — maqolaning `ArticleReview` shakli aynan.
 * Ball 0–100: qoidalar (`RULE_WEIGHT`) + baholovchi (`JUDGE_WEIGHT`).
 */
export type DocReview = {
  /** 0–100. */
  score: number;
  checks: ReviewCheck[];
  judgeNotes: string[];
  verifiedShare: number;
  recentShare: number;
  builtAt: string;
  /** Avto-sayqal jurnali (dvigatel sayqal bosqichi yoki `POST …/polish`). */
  polish?: PolishLog;
  /** «Sizdan kutiladi» — `userNeeds` (panel o'qiydi, hisoblamaydi). */
  userNeeds?: UserNeed[];
};

/* ────────────────────────── baholovchi ────────────────────────── */

/** Baholovchi javobi: har mezon 0–3 + izohlar + tuzatishlar. */
export type JudgeResult<C extends string> = Record<C, number> & {
  notes: string[];
  fixes: { target: string; instruction: string }[];
  /** Tur uchun o'tkazib yuborilgan mezonlar — ballga va bandlarga kirmaydi. */
  skipped?: C[];
};

/**
 * Baholovchi spetsifikatsiyasi — hujjat turi beradi.
 *
 *   criteria  — BARCHA mezonlar (skip qilinganlari ham: `parseJudgeFor`
 *               ularni ham o'qiydi, ball va bandlardan keyin chiqaradi);
 *   describe  — har mezonning promptdagi ta'rifi (turga moslangan);
 *   labels    — hisobot bandining o'zbekcha yorlig'i;
 *   skip      — shu turda baholanmaydigan mezonlar;
 *   roleLine  — «You are …» (masalan «a strict peer reviewer for an
 *               academic journal» / «a university lecturer grading a
 *               course paper»);
 *   typeLabel — «(article type: …)» qavsidagi tur nomi;
 *   typeNoun  — qavsdagi so'z («article type» → «work type», «essay type»).
 */
export type JudgeSpec<C extends string> = {
  criteria: readonly C[];
  describe: Record<C, string>;
  labels: Record<C, string>;
  skip?: readonly C[];
  roleLine?: string;
  typeLabel?: string;
  typeNoun?: string;
};
