/**
 * AVTO-SAYQAL (Maqola 3, AUDIT-18 WP-A) — SOF, IZOMORF: sharp/DB/LLM
 * importi yo'q, `complete` tashqaridan keladi (dvigatel `engine.ts`
 * 8-bosqichda, server `article-polish.ts` «Hammasini tuzatish»da).
 *
 *   planPolish(review, doc)   → hisobotdagi TUZATILADIGAN bandlar → ≤6 fix
 *   applyPolish(doc, fixes)   → har fix `writer` bilan (mapPool 3) → op lar
 *   runPolish(doc, review)    → plan → apply → applyArticleOps → reviewArticle
 *                               (judge) → ball OSHSA qabul (Q-3), aks holda
 *                               eski hujjat; `review.polish` jurnali
 *   userNeeds(review, doc)    → «Sizdan kutiladi» (UDK, email/ORCID, natijalar)
 *
 * Qarorlar (docs/AUDIT-18.md §1):
 *   • Q-2 HALOLLIK CHEGARASI — `userFacts` bo'sh bo'lsa natija/tajriba/
 *     dastgoh/aniqlik talab qiladigan baholovchi tavsiyalari BAJARILMAYDI
 *     (`needsUserData`, inglizcha+o'zbekcha+ruscha lug'at) — `skipped`
 *     ga `reason: "user"` bilan; `udk`/`authors` doim `user`.
 *   • Q-3 — sayqal natijasi faqat ball OSHSA qabul qilinadi.
 *   • Bitta bo'limga bir nechta ko'rsatma → BITTA fix (birlashtiriladi):
 *     bo'lim ikki marta parallel qayta yozilmasin.
 *
 * «Tuzatish» (bitta fix, WP7) ning sof qismi — `rewriteFix` — ham SHU
 * yerda: `lib/server/article-rewrite.ts` uni import qiladi (ikkita nusxa
 * yo'q). Xatolar `RewriteError` (status/code) — server `ApiError` ga
 * o'giradi.
 */
import type { AcademicDoc, Block, DocSection } from "../types";
import type { ArticleReview, PolishLog, ReviewCheck, UserNeed } from "./types";
import { ARTICLE_TYPES } from "./types-registry";
import { PUBLICATION_PROFILES } from "./profiles";
import { articleLabels } from "./labels";
import { normalizeArticlePages, type ArticleInput } from "./input";
import { articleWordPlan } from "./plan";
import { abstractFromLlm, blocksFromLlm, clipWords } from "./parse";
import { abstractPrompt, abstractSystemPrompt, articleSystemPrompt, highlightsPrompt, sectionPrompt, type ArticleContext, type SectionPlan } from "./prompts";
import { guardSection, wordsOf } from "./guard";
import { verifyCitations, type Unresolved } from "../research/verify";
import { applyArticleOps, langKeyOf, type ArticleLang, type ArticleOp } from "./edit";
import {
  JUDGE_CRITERIA,
  JUDGE_NO_ANSWER,
  judgeChecks,
  neutralJudge,
  reviewArticle,
  scoreReview,
  visualCoverage,
  type CompleteFn,
  type JudgeResult,
  type ReviewGuardInput,
} from "./review";
import type { ResearchStats } from "../research/pipeline";
import type { LlmUsage } from "../llm-roles";
import { parseLlmObject } from "../json";
import { cleanText, mapPool, remainingMs } from "../quality";

/* ────────────────────────── tiplar va konstantalar ────────────────────────── */

export type ArticleFix = { op: "rewrite"; target: string; instruction: string };

export type PolishSkip = { id: string; reason: string };
export type PolishPlan = { fixes: ArticleFix[]; skipped: PolishSkip[] };

/** Bir sayqalda ko'pi bilan shuncha fix (vaqt/narx byudjeti: 2 to'lqin × 3 parallel). */
export const POLISH_MAX_FIXES = 6;
/** Bitta `writer` chaqiruvi — «Tuzatish» bilan bir xil. */
export const REWRITE_TIMEOUT_MS = 30_000;
/** Baholovchi uchun ajratib qo'yiladigan vaqt — tuzatishlar shundan oldin tugashi kerak. */
export const POLISH_JUDGE_RESERVE_MS = 40_000;
/** Tuzatishlarga shundan kam vaqt qolsa sayqal umuman boshlanmaydi. */
const POLISH_MIN_FIX_MS = 10_000;
/** Bo'lim so'zi rejadagi ulushidan shu nisbatdan kam bo'lsa «kengaytir». */
const SHORT_BELOW = 0.75;
/** Butun tana maqsaddan shu nisbatdan ko'p bo'lsa eng uzun bo'lim «qisqartir». */
const LONG_ABOVE = 1.2;

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

const RETRY_MSG = "Model javob bermadi — qayta urinib ko‘ring";

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

export type RewriteDeps = {
  complete: CompleteFn;
  /** `Date.now()` ms — chaqiruvga qolgan vaqt shundan hisoblanadi. */
  deadline?: number;
};

export type RewriteOut = { ops: ArticleOp[]; unresolved: Unresolved[]; unsourcedNumbers: string[] };

/* ────────────────────────── Q-2: foydalanuvchi ma'lumoti kerakmi ────────────────────────── */

/*
 * KUCHLI belgilar — tajriba/o'lchov/uskuna/statistika: uchrasa tavsiya
 * foydalanuvchi natijasisiz bajarilmaydi. KUCHSIZ (`methods`/`results`/
 * «natija»/«metod») — faqat «qo'sh/keltir/ko'rsat/tavsifla» kabi fe'l
 * bilan birga (aks holda «natijalarni manbalar bilan taqqosla» kabi
 * xavfsiz tavsiya ham tushib qolardi). Lookbehind — kirill/lotin so'z
 * boshi (`\b` JS da faqat ASCII).
 */
const STRONG_RE =
  /(?<![\p{L}])(experiment\w*|sample(?:\s+size)?|participants?|respondents?|data\s?sets?|measur\w*|instrument\w*|sensor\w*|equipment|apparatus|machine\s+tools?|accuracy|precision|diagnostic\w*|p-?values?|statistic\w*|confidence\s+interval|effect\s+size|quantitative|parameters?|specifications?|reproduc\w*|tajriba\w*|datchik\w*|dastgoh\w*|aniqlik\w*|tanlanma\w*|o[‘’'`]?lchov\w*|ishtirokchi\w*|statistik\w*|parametr\w*|uskuna\w*|qurilma\w*|platform\w*|software|tool\s+names?|randomi[sz]\w*|protocol\w*|hyperparameter\w*|t-?tests?|anova|platforma\w*|dasturiy\s+vosita\w*|protsedura\w*|giperparametr\w*|эксперимент\w*|датчик\w*|станк\w*|станок|точност\w*|выборк\w*|измерен\w*|участник\w*|статистич\w*|параметр\w*|оборудован\w*|платформ\w*|программ\w*|рандомиз\w*|гиперпараметр\w*)/iu;
const WEAK_RE = /(?<![\p{L}])(methods?|methodolog\w*|results?|findings|natija\w*|metod\w*|usul\w*|результат\w*|метод\w*|ko[‘’'`]?rsatkich\w*|показател\w*|numbers?|figures|raqam\w*|цифр\w*|числ\w*)/iu;
const ADD_RE = /(?<![\p{L}])(add|provide|include|report|present|describe|specify|detail|state|give|quantify|qo[‘’'`]?sh\w*|keltir\w*|ko[‘’'`]?rsat\w*|tavsifla\w*|yoz\w*|bayon\w*|добав\w*|привед\w*|укаж\w*|опиш\w*|предостав\w*|включ\w*)/iu;

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

/** Skelet id → bo'lim (erkin `body-N` ham `body` ga mos). */
const skeletonIdOf = (id: string) => id.replace(/-\d+$/, "");

/** Har bo'limning so'z mo'ljali — skelet ulushi (erkin bo'limlar teng). */
function sectionTargets(doc: AcademicDoc, wordTarget: number): Map<string, number> {
  const type = ARTICLE_TYPES[doc.article?.type ?? "imrad_oak"];
  const share = new Map(type.skeleton.map((s) => [s.id, s.sharePct]));
  const sections = doc.sections.filter((s) => s.blocks.length);
  const counts = new Map<string, number>();
  for (const s of sections) counts.set(skeletonIdOf(s.id), (counts.get(skeletonIdOf(s.id)) ?? 0) + 1);
  const out = new Map<string, number>();
  for (const s of sections) {
    const sk = skeletonIdOf(s.id);
    const pct = share.get(sk) ?? 100 / Math.max(1, sections.length);
    out.set(s.id, Math.max(60, Math.round((wordTarget * pct) / 100 / (counts.get(sk) ?? 1))));
  }
  return out;
}

const rewrite = (target: string, instruction: string): ArticleFix => ({ op: "rewrite", target, instruction });

/**
 * Hisobot → fix rejasi. Qoidalar: bandning o'z `fix` i (abstracts, keywords,
 * highlights, filler, repetition, limitations, unsourcedNumbers, userFacts)
 * + sintez qilinadiganlar: `length` (qisqa bo'limlarni kengaytirish /
 * uzunini qisqartirish), `visuals` (`[fig:id]`/`[tab:id]` havolasi).
 * Baholovchi tavsiyalari (`judge:fix:N`) — Q-2 filtr bilan. `udk`/`authors`
 * doim `user`. Bitta nishonga ko'rsatmalar birlashtiriladi; ≤6 nishon.
 */
/** Skelet roli bo'yicha bo'lim topish (id yoki `skeletonId` prefiksi). */
function sectionByRole(doc: AcademicDoc, roles: string[]): string | null {
  const sections = doc.sections.filter((s) => s.blocks.length);
  for (const role of roles) {
    const hit = sections.find((s) => s.id === role || s.id.startsWith(`${role}-`) || s.id.includes(role));
    if (hit) return hit.id;
  }
  return null;
}

/**
 * Past baholangan mezon → halol ko'rsatma (mavjud matn va manbalar bilan
 * bajariladigan; tajriba tafsiloti so'ralmaydi). `methods` faqat faktlar
 * bo'lsa — «faqat USER FACTS bilan, yo'g'ini keltirilmagan deb ayt».
 */
export function criterionFixes(review: ArticleReview, doc: AcademicDoc, hasFacts: boolean): ArticleFix[] {
  const level = (id: string) => review.checks.find((c) => c.id === `judge:${id}`)?.level;
  const low = (id: string) => level(id) === "red" || level(id) === "yellow";
  const first = doc.sections.find((s) => s.blocks.length)?.id ?? null;
  const last = [...doc.sections].reverse().find((s) => s.blocks.length)?.id ?? null;
  const intro = sectionByRole(doc, ["intro", "introduction"]) ?? first;
  const conclusion = sectionByRole(doc, ["conclusion", "conclusions", "future"]) ?? last;
  const discussion = sectionByRole(doc, ["discussion", "synthesis", "analysis", "solutions", "evaluation", "perspective"]) ?? conclusion;
  const methods = sectionByRole(doc, ["litreview_methods", "methods", "results_methods", "procedure", "protocol", "object", "search"]);
  const out: ArticleFix[] = [];
  const push = (target: string | null, instruction: string) => {
    if (target && !out.some((f) => f.target === target)) out.push({ op: "rewrite", target, instruction });
  };
  if (low("novelty")) push(intro, "State the specific contribution of this article explicitly (what it adds beyond the cited studies) using ONLY what the manuscript already does; end the introduction with a clear aim. Do not add new results.");
  if (low("overclaim") || low("chain")) push(conclusion, "Make the conclusion answer the stated aim point by point and keep every claim within what the results/USER FACTS show — remove generalisations that the results do not support.");
  if (low("comparison")) push(discussion, "Compare the findings explicitly with at least three cited SOURCES (agreement, contrast, gap) — use only sources already in the list; no new claims.");
  if (low("methods") && hasFacts) push(methods, "Describe the procedure using ONLY the details in USER FACTS and the current text; where a detail (tool, statistical test, parameter) was not reported by the author, say so explicitly instead of inventing it.");
  return out;
}

export function planPolish(review: ArticleReview, doc: AcademicDoc): PolishPlan {
  const skipped: PolishSkip[] = [];
  const candidates: ArticleFix[] = [];
  const model = doc.article;
  if (!model) return { fixes: [], skipped: [{ id: "legacy", reason: "manual" }] };
  const hasFacts = Boolean(model.userFacts?.trim());
  const sections = doc.sections.filter((s) => s.blocks.length);
  const byId = new Map(sections.map((s) => [s.id, s]));
  const type = ARTICLE_TYPES[model.type] ?? ARTICLE_TYPES.imrad_oak;
  const profile = PUBLICATION_PROFILES[model.profile] ?? PUBLICATION_PROFILES[type.defaultProfile];

  const rules = review.checks.filter((c) => !c.id.startsWith("judge:") && c.level !== "green");
  // Qizil avval — 60 % ulushda har qizil band butun yashilcha yo'qotadi.
  rules.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));

  for (const c of rules) {
    if (c.id === "udk" || c.id === "authors") {
      skipped.push({ id: c.id, reason: "user" });
      continue;
    }
    if (c.id === "length" && !type.wordRange) {
      const wordTarget = articleWordPlan(doc.meta, type, profile).body;
      const targets = sectionTargets(doc, wordTarget);
      const body = sections.reduce((n, s) => n + wordsOf(s.blocks), 0);
      if (body < wordTarget) {
        const short = sections
          .map((s) => ({ s, have: wordsOf(s.blocks), want: targets.get(s.id) ?? 0 }))
          .filter((x) => x.have < x.want * SHORT_BELOW)
          .sort((a, b) => b.want - b.have - (a.want - a.have))
          .slice(0, 2);
        for (const x of short) {
          candidates.push(
            rewrite(
              x.s.id,
              `Expand this section to about ${x.want} words (it has ${x.have}): add about ${x.want - x.have} words of NEW specific content (a mechanism, a comparison with a cited source, an implication, a limitation) — keep every existing sentence, citation ID and user fact; no new numbers without a cited source.`,
            ),
          );
        }
        if (!short.length) skipped.push({ id: c.id, reason: "manual" });
      } else if (body > wordTarget * LONG_ABOVE) {
        const long = sections.map((s) => ({ s, have: wordsOf(s.blocks), want: targets.get(s.id) ?? 0 })).sort((a, b) => b.have - b.want - (a.have - a.want))[0];
        if (long) candidates.push(rewrite(long.s.id, `Condense this section to about ${long.want} words (it has ${long.have}): remove repetition and generic sentences, keep every citation ID, user fact and specific claim.`));
      } else skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    if (c.id === "visuals") {
      const { unreferenced } = visualCoverage(doc);
      if (!unreferenced.length) {
        skipped.push({ id: c.id, reason: "manual" });
        continue;
      }
      const bySection = new Map<string, string[]>();
      for (const u of unreferenced) {
        const tok = u.kind === "figure" ? `[fig:${u.id}]` : `[tab:${u.id}]`;
        bySection.set(u.sectionId, [...(bySection.get(u.sectionId) ?? []), `${u.label} — write the token ${tok}`]);
      }
      for (const [sectionId, items] of bySection) {
        candidates.push(
          rewrite(
            sectionId,
            `Refer to the visual(s) in this section's text: ${items.join("; ")} — put each token inside a sentence that introduces the visual (e.g. "… ko‘rsatilgan ([fig:f1])"); keep the visual block and all other content unchanged.`,
          ),
        );
      }
      continue;
    }
    if (!c.fix) {
      skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    candidates.push({ op: "rewrite", target: c.fix.target, instruction: c.fix.instruction });
  }

  /*
   * Baholovchi tavsiyalari — Q-2 filtr, FAKTLAR BOR BO'LSA HAM: jonli
   * sinovda (article-oak, faktlar bilan) «statistik testlar, p-qiymatlar,
   * platforma nomini ko'rsating» tavsiyasi bajarilib, model Moodle, t-test,
   * ANOVA, stratified randomization ni O'YLAB TOPDI (faktlarda yo'q) va
   * baholovchi buni 78 → 92 deb mukofotladi. Fakt bo'lsa ham u allaqachon
   * matnda — qo'shimcha tajriba tafsiloti so'rash = yo'q ma'lumotni so'rash.
   */
  for (const c of review.checks) {
    if (!c.id.startsWith("judge:fix:") || !c.fix) continue;
    if (needsUserData(c.fix.instruction)) {
      skipped.push({ id: c.id, reason: hasFacts ? "unreported" : "user" });
      continue;
    }
    candidates.push({ op: "rewrite", target: c.fix.target, instruction: c.fix.instruction });
  }

  /*
   * Baholovchi MEZONLARIDAN halol tuzatishlar (baholovchi `fixes` bermasa
   * yoki hammasi Q-2 bilan tushib qolsa): jonli sinovda tavsiya chegarasi
   * qo'yilgach Claude 0 fix qaytardi — sayqal faqat jadval havolasini
   * tuzatib, yangilik/xulosa/taqqoslash qizil qoldi. Har mezon o'z
   * bo'limiga, faqat mavjud mazmun/manbalar bilan bajariladigan ko'rsatma.
   */
  const judgeTargets = new Set(candidates.map((f) => f.target));
  for (const f of criterionFixes(review, doc, hasFacts)) {
    if (judgeTargets.has(f.target)) continue;
    candidates.push(f);
  }

  // Nishon mavjudligi: bo'lim id | abstract:xx | keywords | highlights.
  const valid = (t: string) => byId.has(t) || /^abstract:[a-z]{2}$/i.test(t) || t === "keywords" || t === "highlights";
  // Bitta nishon → bitta fix (ko'rsatmalar birlashadi), tartib — birinchi uchrash.
  const merged = new Map<string, string[]>();
  for (const f of candidates) {
    if (!valid(f.target)) continue;
    const list = merged.get(f.target) ?? [];
    if (!list.includes(f.instruction)) list.push(f.instruction);
    merged.set(f.target, list);
  }
  const fixes: ArticleFix[] = [];
  for (const [target, list] of merged) {
    if (fixes.length >= POLISH_MAX_FIXES) {
      skipped.push({ id: target, reason: "limit" });
      continue;
    }
    fixes.push(rewrite(target, list.length === 1 ? list[0] : list.map((s, i) => `(${i + 1}) ${s}`).join(" ")));
  }
  return { fixes, skipped };
}

/* ────────────────────────── «Sizdan kutiladi» ────────────────────────── */

/**
 * AI o'ylab topmaydigan narsalar (Q-2): UDK (profil talab qilsa), email/
 * ORCID, va — `userFacts` bo'sh bo'lganda — metodlar/taqqoslash mezoni
 * qizil yoki natija talab qiladigan baholovchi tavsiyasi bo'lsa «Natijalarim».
 */
export function userNeeds(review: ArticleReview, doc: AcademicDoc): UserNeed[] {
  const out: UserNeed[] = [];
  const find = (id: string) => review.checks.find((c) => c.id === id);
  const udk = find("udk");
  if (udk && udk.level !== "green") out.push({ id: "udk", label: "UDK", hint: "Formadagi «Taklif» tugmasi bilan oling yoki jurnal talabiga ko‘ra kiriting" });
  const authors = find("authors");
  if (authors && authors.level !== "green") out.push({ id: "authors", label: "Mualliflar", hint: authors.detail ?? "Email va ORCID ni to‘ldiring" });
  if (!doc.article?.userFacts?.trim()) {
    const red = (id: string) => find(`judge:${id}`)?.level === "red";
    const dataFix = review.checks.some((c) => c.id.startsWith("judge:fix:") && c.fix && needsUserData(c.fix.instruction));
    if (red("methods") || red("comparison") || dataFix) {
      out.push({ id: "results", label: "Natijalarim", hint: "Tajriba/kuzatuv natijalaringizni (raqamlar, tanlanma, uskuna, sharoit) formadagi «Natijalarim» maydoniga kiriting — AI ularni o‘ylab topmaydi" });
    }
  }
  return out;
}

/* ────────────────────────── kontekst (rewrite) ────────────────────────── */

/**
 * Dvigatel konteksti HUJJATDAN — forma qiymatlari (`FormValues`) endi yo'q,
 * lekin promptlarga kerak bo'lgan hamma narsa `meta` va `doc.article` da.
 */
function contextOf(doc: AcademicDoc): ArticleContext {
  const model = doc.article!;
  const type = ARTICLE_TYPES[model.type] ?? ARTICLE_TYPES.imrad_oak;
  const profile = PUBLICATION_PROFILES[model.profile] ?? PUBLICATION_PROFILES[type.defaultProfile];
  const language = langKeyOf(model.language || doc.meta.language);
  const input: ArticleInput = {
    topic: doc.meta.topic,
    articleType: type.id,
    pubProfile: profile.id,
    citeStyle: model.cite,
    language,
    pages: normalizeArticlePages(type, doc.meta.pagesLabel),
    authors: model.authors,
    udk: model.udk ?? "",
    keywords: model.keywords[language] ?? [],
    userFacts: model.userFacts ?? "",
    userRefs: [],
    figureCount: doc.meta.figureCount ?? 0,
    figureKinds: doc.meta.figureKinds ?? [],
    research: Boolean(doc.meta.research),
    extra: doc.meta.extra ?? "",
    sourceText: doc.meta.sourceText ?? "",
  };
  const plan = articleWordPlan(doc.meta, type, profile);
  return { input, meta: doc.meta, type, profile, labels: articleLabels(language), wordTarget: plan.body, plan, refs: model.references };
}

/** Bo'lim qisqacha — annotatsiya/highlights uchun (dvigatel `summaryOf` bilan bir xil shakl). */
function summaries(doc: AcademicDoc): string {
  return doc.sections
    .filter((s) => s.blocks.length)
    .map((s) => {
      const text = s.blocks
        .filter((b) => b.kind === "p" || b.kind === "li")
        .map((b) => b.text)
        .join(" ");
      return `• ${s.title}: ${text.slice(0, 380)}${text.length > 380 ? "…" : ""}`;
    })
    .join("\n");
}

/* ────────────────────────── LLM chaqiruvi ────────────────────────── */

/** Bitta chaqiruv — vaqt tugasa yoki javob bo'sh bo'lsa 422 (hujjat o'zgarmaydi). */
async function ask(deps: RewriteDeps, role: "writer", system: string, user: string, maxTokens: number): Promise<string> {
  const timeoutMs = Math.max(1, Math.min(REWRITE_TIMEOUT_MS, remainingMs(deps.deadline)));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const bomb = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const r = await Promise.race([deps.complete(role, system, user, { json: true, maxTokens, timeoutMs }).catch(() => null), bomb]);
    if (!r?.text) throw new RewriteError(RETRY_MSG, 422, "llm");
    return r.text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ────────────────────────── nishonlar ────────────────────────── */

const VISUAL = new Set<Block["kind"]>(["figure", "tableRef", "formula"]);

/** Eski vizual bloklarni yangi matn ichiga (eski indeks bo'yicha) qaytaradi. */
export function keepVisuals(oldBlocks: Block[], text: Block[]): Block[] {
  const out = text.slice();
  oldBlocks.forEach((b, i) => {
    if (VISUAL.has(b.kind)) out.splice(Math.min(i, out.length), 0, { ...b });
  });
  return out;
}

async function rewriteSection(doc: AcademicDoc, section: DocSection, fix: ArticleFix, deps: RewriteDeps): Promise<RewriteOut> {
  const ctx = contextOf(doc);
  const model = doc.article!;
  const words = Math.max(120, wordsOf(section.blocks));
  const skel = ctx.type.skeleton.find((s) => section.id === s.id || section.id.startsWith(`${s.id}-`));
  const plan: SectionPlan = {
    id: section.id,
    skeletonId: skel?.id ?? section.id,
    title: section.title,
    brief: `Rewrite the existing section according to the editor's instruction: ${fix.instruction}`,
    words,
    hard: Boolean(skel?.hard),
  };
  const existing = section.blocks
    .filter((b) => !VISUAL.has(b.kind))
    .map((b) => b.text)
    .join("\n\n")
    .slice(0, 12_000);
  const user = [
    sectionPrompt(ctx, { plan, wantTable: false, wantFigure: false, wantChart: false }),
    `CURRENT TEXT of the section — rewrite it: keep its scope and every USER FACT verbatim, keep the citation IDs that still support a sentence, do not add new claims without a SOURCE:`,
    existing || "(empty)",
    `EDITOR INSTRUCTION (highest priority): ${fix.instruction}`,
    HONESTY_LIMIT,
  ].join("\n");
  const maxTokens = Math.min(8000, Math.max(1200, Math.round(words * 2.4) + 700));
  const raw = await ask(deps, "writer", articleSystemPrompt(ctx), user, maxTokens);
  const blocks = blocksFromLlm(parseLlmObject<{ blocks?: unknown }>(raw)?.blocks, raw);
  if (!blocks.length) throw new RewriteError(RETRY_MSG, 422, "llm");

  /*
   * Iqtiboslar REYESTR bilan: model «yangi» id o'ylab topsa
   * (`[W99999]`) u o'chadi — `verifyCitations` generatsiyadagi bilan
   * bir xil qoida. `guardSection` — hisob (suv, manbasiz foizlar) va
   * bo'sh natija tekshiruvi.
   */
  const verified = verifyCitations([{ id: section.id, title: section.title, blocks }], model.references);
  const clean = verified.sections[0].blocks;
  const guard = guardSection(clean, { refs: model.references, userFacts: model.userFacts });
  if (!guard.report.words) throw new RewriteError(RETRY_MSG, 422, "llm");
  if (verified.unresolved.length) console.warn(`[article] tuzatish «${section.id}»: reyestrda yo'q iqtibos o'chirildi: ${verified.unresolved.map((u) => u.id).join(", ")}`);
  if (guard.report.unsourcedNumbers.length) console.warn(`[article] tuzatish «${section.id}»: manbasiz foizlar: ${guard.report.unsourcedNumbers.join(", ")}`);

  return {
    ops: [{ op: "setSection", sectionId: section.id, blocks: keepVisuals(section.blocks, clean) }],
    unresolved: verified.unresolved,
    unsourcedNumbers: guard.report.unsourcedNumbers,
  };
}

async function rewriteAbstract(doc: AcademicDoc, lang: ArticleLang, fix: ArticleFix, deps: RewriteDeps): Promise<ArticleOp[]> {
  const ctx = contextOf(doc);
  const cur = (doc.abstracts ?? []).find((a) => langKeyOf(a.lang) === lang);
  const user = [
    abstractPrompt(ctx, lang, summaries(doc)),
    cur ? `CURRENT ABSTRACT (rewrite it according to the instruction):\n${cur.text.slice(0, 4000)}` : "",
    `EDITOR INSTRUCTION (highest priority): ${fix.instruction}`,
    HONESTY_LIMIT,
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await ask(deps, "writer", abstractSystemPrompt(ctx, lang), user, 1400);
  const r = abstractFromLlm(raw, ctx, lang);
  if (!r) throw new RewriteError(RETRY_MSG, 422, "llm");
  const ops: ArticleOp[] = [{ op: "abstract", lang, text: r.text }];
  // Kalit so'zlar shu tilda bo'lmasa — bir chaqiruvdan chiqqanini olamiz (bor bo'lsa foydalanuvchiniki qoladi).
  if (!doc.article!.keywords[lang]?.length && r.keywords.length >= ctx.profile.keywords[0]) ops.push({ op: "keywords", lang, items: r.keywords });
  return ops;
}

async function rewriteKeywords(doc: AcademicDoc, fix: ArticleFix, deps: RewriteDeps): Promise<ArticleOp[]> {
  const ctx = contextOf(doc);
  const [minK, maxK] = ctx.profile.keywords;
  const user = [
    `Provide ${minK}–${maxK} keywords for this article in EACH of the three languages (uz, ru, en): lowercase unless proper nouns, 1–3 words each, no duplicates, specific to the topic and content.`,
    `Section summaries:`,
    summaries(doc),
    `Current keywords: ${JSON.stringify(doc.article!.keywords)}`,
    `EDITOR INSTRUCTION (highest priority): ${fix.instruction}`,
    `Return JSON: {"uz":["…"],"ru":["…"],"en":["…"]}`,
  ].join("\n");
  const raw = await ask(deps, "writer", articleSystemPrompt(ctx), user, 600);
  const j = parseLlmObject<Record<string, unknown>>(raw);
  const ops: ArticleOp[] = [];
  for (const lang of ["uz", "ru", "en"] as const) {
    const list = Array.isArray(j?.[lang]) ? (j![lang] as unknown[]).map((k) => cleanText(String(k ?? "")).replace(/[.;]+$/, "")).filter(Boolean) : [];
    if (list.length >= minK) ops.push({ op: "keywords", lang, items: list.slice(0, maxK) });
  }
  if (!ops.length) throw new RewriteError(RETRY_MSG, 422, "llm");
  return ops;
}

async function rewriteHighlights(doc: AcademicDoc, fix: ArticleFix, deps: RewriteDeps): Promise<ArticleOp[]> {
  const ctx = contextOf(doc);
  const h = ctx.type.highlights ?? { min: 3, max: 5, maxChars: 85 };
  const user = [highlightsPrompt(ctx, summaries(doc)), `EDITOR INSTRUCTION (highest priority): ${fix.instruction}`].join("\n");
  const raw = await ask(deps, "writer", articleSystemPrompt(ctx), user, 500);
  const list = parseLlmObject<{ highlights?: unknown }>(raw)?.highlights;
  const items = (Array.isArray(list) ? list : [])
    .map((x) => cleanText(String(x ?? "")))
    .filter(Boolean)
    .map((x) => clipWords(x, h.maxChars))
    .slice(0, h.max);
  if (items.length < h.min) throw new RewriteError(RETRY_MSG, 422, "llm");
  return [{ op: "highlights", items }];
}

/**
 * `fix` → tahrir oplari (hujjat O'ZGARMAYDI, faqat op lar qaytadi) +
 * qo'riqchi hisobi (o'chirilgan noma'lum iqtiboslar, manbasiz foizlar).
 * Nishon: bo'lim id | `abstract:<lang>` | `keywords` | `highlights`.
 */
export async function rewriteFix(doc: AcademicDoc, fix: ArticleFix, deps: RewriteDeps): Promise<RewriteOut> {
  if (!doc.article) throw new RewriteError("Eski maqolada «Tuzatish» yo'q — qaytadan yarating", 409, "legacy");
  const m = /^abstract:([a-z]{2})$/i.exec(fix.target);
  const plain = (ops: ArticleOp[]): RewriteOut => ({ ops, unresolved: [], unsourcedNumbers: [] });
  if (m) return plain(await rewriteAbstract(doc, langKeyOf(m[1]), fix, deps));
  if (fix.target === "keywords") return plain(await rewriteKeywords(doc, fix, deps));
  if (fix.target === "highlights") return plain(await rewriteHighlights(doc, fix, deps));
  const section = doc.sections.find((s) => s.id === fix.target);
  if (!section) throw new RewriteError(`Bo'lim topilmadi: ${fix.target}`, 422, "target");
  return rewriteSection(doc, section, fix, deps);
}

/* ────────────────────────── baholovchi ballarini ko'chirish ────────────────────────── */

/** Avvalgi hisobotdan baholovchi natijasi — `judge:*` bandlaridan (bajarilgan fix chiqariladi). */
export function judgeFromReview(prev: ArticleReview | undefined, applied?: ArticleFix): JudgeResult | null {
  if (!prev) return null;
  const j = neutralJudge();
  let any = false;
  for (const c of JUDGE_CRITERIA) {
    const m = /^(\d)\/3$/.exec(prev.checks.find((x) => x.id === `judge:${c}`)?.detail ?? "");
    if (!m) continue;
    j[c] = Math.max(0, Math.min(3, Number(m[1])));
    any = true;
  }
  if (!any) return null;
  // Hisobotda bo'lmagan mezonlar — tur uchun o'tkazib yuborilgan (`ArticleType.judge.skip`, AUDIT-18 Q-7); ballga kirmaydi.
  const skipped = JUDGE_CRITERIA.filter((c) => !prev.checks.some((x) => x.id === `judge:${c}`));
  if (skipped.length) j.skipped = skipped;
  j.notes = prev.judgeNotes.filter((n) => n !== REWRITE_REVIEW_NOTE && n !== POLISH_JUDGE_NOTE && n !== JUDGE_NO_ANSWER);
  j.fixes = prev.checks
    .filter((c): c is ReviewCheck & { fix: NonNullable<ReviewCheck["fix"]> } => c.id.startsWith("judge:fix:") && Boolean(c.fix))
    .map((c) => ({ target: c.fix.target, instruction: c.fix.instruction }))
    .filter((f) => !(applied && f.target === applied.target && f.instruction === applied.instruction));
  return j;
}

/* ────────────────────────── apply ────────────────────────── */

export type ApplyPolishDeps = RewriteDeps & { concurrency?: number };
export type ApplyPolishResult = {
  ops: ArticleOp[];
  applied: ArticleFix[];
  failed: { fix: ArticleFix; reason: string }[];
  /** Qayta yozilgan bo'limlarning qo'riqchi hisobi (hisobot `guard` uchun). */
  unresolved: Unresolved[];
  rewrittenSections: string[];
};

/**
 * Fix lar PARALLEL (`mapPool`, standart 3) — hammasi ASL hujjat ustida
 * (nishonlar farqli, `planPolish` birlashtirgan). Bitta fix xatosi
 * boshqalarini to'xtatmaydi — `failed` ga tushadi.
 */
export async function applyPolish(doc: AcademicDoc, fixes: ArticleFix[], deps: ApplyPolishDeps): Promise<ApplyPolishResult> {
  const out: ApplyPolishResult = { ops: [], applied: [], failed: [], unresolved: [], rewrittenSections: [] };
  type One = { fix: ArticleFix; r: RewriteOut } | { fix: ArticleFix; error: string };
  const results = await mapPool(fixes, deps.concurrency ?? 3, async (fix): Promise<One> => {
    try {
      return { fix, r: await rewriteFix(doc, fix, deps) };
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
    for (const op of x.r.ops) if (op.op === "setSection") out.rewrittenSections.push(op.sectionId);
  }
  return out;
}

/* ────────────────────────── run ────────────────────────── */

export type PolishDeps = {
  complete: CompleteFn;
  deadline: number;
  now?: Date;
  /** `false` — baholovchi chaqirilmaydi (testlar); standart `true`. */
  judge?: boolean;
  /** Dvigateldan: qidiruv statistikasi va qo'riqchi hisobi (hisobotda saqlanadi). */
  research?: ResearchStats;
  guard?: ReviewGuardInput;
  onUsage?: (u: LlmUsage) => void;
  concurrency?: number;
  genId?: string;
};

export type PolishResult = {
  doc: AcademicDoc;
  review: ArticleReview;
  plan: PolishPlan;
  /** Qabul qilingan op lar (rad etilsa bo'sh). */
  ops: ArticleOp[];
  applied: ArticleFix[];
  failed: { fix: ArticleFix; reason: string }[];
  accepted: boolean;
  log: PolishLog;
};

/**
 * Plan → apply → `applyArticleOps` → `reviewArticle` (judge) → Q-3.
 * Baholovchi javob bermasa ballari ESKI hisobotdan ko'chiriladi (izoh
 * bilan) — neytral 2/3 bilan taqqoslash adolatsiz bo'lardi (eski qattiq
 * baho neytralga «o'sib» soxta qabulga olib kelardi).
 */
export async function runPolish(doc: AcademicDoc, review: ArticleReview, deps: PolishDeps): Promise<PolishResult> {
  const now = deps.now ?? new Date();
  const plan = planPolish(review, doc);
  const before = review.score;
  const needs = userNeeds(review, doc);
  const reject = (skipped: PolishSkip[], applied: ArticleFix[] = [], failed: PolishResult["failed"] = [], after = before): PolishResult => {
    const log: PolishLog = { before, after, applied: applied.map(({ target, instruction }) => ({ target, instruction })), skipped, accepted: false, at: now.toISOString() };
    return { doc, review: { ...review, polish: log, userNeeds: needs }, plan, ops: [], applied, failed, accepted: false, log };
  };
  if (!plan.fixes.length) return reject(plan.skipped);

  const judge = deps.judge !== false;
  const fixDeadline = deps.deadline - (judge ? POLISH_JUDGE_RESERVE_MS : 0);
  if (remainingMs(fixDeadline) < POLISH_MIN_FIX_MS) return reject([...plan.skipped, { id: "budget", reason: "budget" }]);

  const complete: CompleteFn = async (role, system, user, o) => {
    const r = await deps.complete(role, system, user, o);
    if (r?.usage) deps.onUsage?.(r.usage);
    return r;
  };
  const ap = await applyPolish(doc, plan.fixes, { complete, deadline: fixDeadline, concurrency: deps.concurrency });
  const failedSkips: PolishSkip[] = ap.failed.map((f) => ({ id: f.fix.target, reason: "error" }));
  if (!ap.applied.length) return reject([...plan.skipped, ...failedSkips], [], ap.failed);

  const res = applyArticleOps(doc, ap.ops, { genId: deps.genId ?? "polish" });
  if (!res.ok) {
    console.warn("[article] sayqal op lari qo'llanmadi:", res.error);
    return reject([...plan.skipped, ...failedSkips, { id: "ops", reason: "error" }], [], ap.failed);
  }

  const type = ARTICLE_TYPES[doc.article?.type ?? "imrad_oak"];
  const profile = PUBLICATION_PROFILES[doc.article?.profile ?? type.defaultProfile];
  const wordTarget = articleWordPlan(doc.meta, type, profile).body;
  // Qo'riqchi: qayta yozilgan bo'limlarning eski `unresolved`/`empty` yozuvi eskirgan — yangisi bilan almashadi.
  const rewritten = new Set(ap.rewrittenSections);
  const guard: ReviewGuardInput = {
    unresolved: [...(deps.guard?.unresolved ?? []).filter((u) => !rewritten.has(u.sectionId)), ...ap.unresolved],
    emptySections: (deps.guard?.emptySections ?? []).filter((id) => !rewritten.has(id)),
  };
  // `onUsage` bu yerda EMAS — `complete` o'rami har chaqiruvni allaqachon hisoblaydi (baholovchi ikki marta sanalmasin).
  let fresh = await reviewArticle(res.doc, { complete, deadline: deps.deadline, wordTarget, judge, now, research: deps.research, guard });
  if (judge && fresh.judgeNotes.includes(JUDGE_NO_ANSWER)) {
    const j = judgeFromReview(review);
    if (j) {
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      fresh = { ...fresh, score: scoreReview(rules, j), checks: [...rules, ...judgeChecks(j)], judgeNotes: [...j.notes, POLISH_JUDGE_NOTE] };
    }
  }
  const after = fresh.score;
  const accepted = after > before;
  const log: PolishLog = {
    before,
    after,
    applied: ap.applied.map(({ target, instruction }) => ({ target, instruction })),
    skipped: [...plan.skipped, ...failedSkips],
    accepted,
    at: now.toISOString(),
  };
  if (!accepted) return { doc, review: { ...review, polish: log, userNeeds: needs }, plan, ops: [], applied: ap.applied, failed: ap.failed, accepted, log };
  const newReview: ArticleReview = { ...fresh, polish: log, userNeeds: userNeeds(fresh, res.doc) };
  return { doc: res.doc, review: newReview, plan, ops: ap.ops, applied: ap.applied, failed: ap.failed, accepted, log };
}
