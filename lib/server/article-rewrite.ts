import "server-only";
import { ApiError } from "./api";
import { commitDocOps } from "./slide-commit";
import { commitPolishedDoc, loadDocForPolish, renderGameFile, type RebuildFileFn } from "./doc-polish";
import { ARTICLE_EDIT_LIMITS, applyArticleOps, type ArticleOp } from "../generation/article/edit";
import { articleWordPlan } from "../generation/article/plan";
import { judgeChecks, neutralJudge, reviewArticle, scoreReview } from "../generation/article/review";
import {
  REWRITE_REVIEW_NOTE,
  REWRITE_TIMEOUT_MS,
  RewriteError,
  judgeFromReview,
  keepVisuals,
  rewriteFix,
  userNeeds,
  type ArticleFix,
} from "../generation/article/polish";
import { ARTICLE_TYPES } from "../generation/article/types-registry";
import { PUBLICATION_PROFILES } from "../generation/article/profiles";
import type { ArticleReview } from "../generation/article/types";
import { rewriteTeacherFix, teacherJudgeFromReview, teacherUserNeeds } from "../generation/teacher/polish";
import { neutralTeacherJudge, reviewTeacher, scoreTeacherReview, teacherJudgeChecks } from "../generation/teacher/review";
import { applyTeacherOps, teacherOpsFromPolish, type TeacherOp } from "../generation/teacher/edit";
import { applyClueOps, crosswordContextOf, crosswordUserNeeds, rewriteClues } from "../generation/games/crossword/polish";
import { crosswordJudgeFromReview, reviewCrossword, scoreCrosswordReview } from "../generation/games/crossword/review";
import { applyCardsOps, cardsJudgeFromReview, flashcardsUserNeeds, rewriteFlashcardsFix } from "../generation/games/flashcards/polish";
import { cardsJudgeChecks, neutralCardsJudge, reviewFlashcards, scoreCardsReview } from "../generation/games/flashcards/review";
import { judgeChecksFor, neutralJudgeFor } from "../generation/report/judge";
import { renderHtml } from "../generation/render-html";
import type { DocReview } from "../generation/report/types";
import { complete as completeRole } from "../generation/llm-roles";
import type { AcademicDoc } from "../generation/types";
import type { DocOp } from "../generation/slide-edit";

/**
 * «TUZATISH» — tayyorlik hisobotidagi `fix` ni bajarish (Maqola 2, WP7).
 *
 * Hisobot (`article/review.ts`) har bandga `{op:"rewrite", target,
 * instruction}` shartnomasini beradi; SOF qism (bo'lim/annotatsiya/kalit
 * so'z/highlights qayta yozish, `verifyCitations`, `guardSection`,
 * `keepVisuals`, 30 s timeout) — `article/polish.ts rewriteFix`
 * (AUDIT-18: avto-sayqal ham AYNAN shu funksiyani chaqiradi — ikkita
 * nusxa yo'q). Bu modul SERVER o'rami: `ApiError` ga o'girish, versiya
 * qulfi (409), hisobotni qayta hisoblash va `commitDocOps` orqali yozish
 * — ya'ni egalik (SQL), atomarlik va `doc_prev` qoidalari `PATCH …/doc`
 * bilan AYNAN bir xil.
 *
 * Qoidalar:
 *   • KREDIT YECHILMAYDI — tahrir bepul (mahsulot egasi qarori);
 *     `chargeInTx` bu modulda umuman chaqirilmaydi (test qulflaydi).
 *   • 30 s: javob bo'lmasa 422 «Qayta urinib ko'ring» — foydalanuvchi
 *     tugmani yana bosadi, hujjat o'zgarmaydi.
 *   • Hisobot qayta hisoblanadi — QOIDALAR (tez, deterministik);
 *     baholovchi (`judge`, Claude) QAYTA CHAQIRILMAYDI: uning ballari
 *     avvalgi hisobotdan ko'chiriladi va izohda aytiladi. Sabab — narx
 *     (~1 150 so'm/chaqiruv) va vaqt (35 s); to'liq qayta baholash —
 *     «Hammasini tuzatish» (`article-polish.ts`, baholovchi bilan).
 */

export type { ArticleFix };
export { REWRITE_REVIEW_NOTE, REWRITE_TIMEOUT_MS, judgeFromReview, keepVisuals };

export type RewriteDeps = {
  /** Test seam — rol bo'yicha LLM (`engine.ts` bilan bir xil). */
  complete?: typeof completeRole;
  /** `Date.now()` ms — chaqiruvga qolgan vaqt shundan hisoblanadi. */
  deadline?: number;
  now?: Date;
  /** Test seam — o'yin DOCX ini qayta yasash (standart `renderGameFile`). */
  rebuildFile?: RebuildFileFn;
};

/* ────────────────────────── kirish ────────────────────────── */

/** HTTP tanasidagi `fix` — hisobot shartnomasi bilan bir xil shakl (400 bu yerda). */
export function parseArticleFix(raw: unknown): ArticleFix {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new ApiError("«fix» obyekt bo'lishi kerak", 400);
  if (o.op !== "rewrite") throw new ApiError("«fix.op» faqat «rewrite» bo'ladi", 400);
  const target = typeof o.target === "string" ? o.target.trim() : "";
  if (!target || target.length > ARTICLE_EDIT_LIMITS.id || !/^[\w:.\-]+$/.test(target)) throw new ApiError("«fix.target» yaroqsiz", 400);
  const instruction = typeof o.instruction === "string" ? o.instruction.replace(/\s+/g, " ").trim() : "";
  if (!instruction || instruction.length > ARTICLE_EDIT_LIMITS.instruction) throw new ApiError("«fix.instruction» yaroqsiz", 400);
  return { op: "rewrite", target, instruction };
}

/** Sof qism xatosi → HTTP xatosi (`code` mashina uchun: `llm` / `legacy`). */
export function toApiError(e: unknown): unknown {
  if (e instanceof RewriteError) return new ApiError(e.message, e.status, e.code === "target" ? undefined : { code: e.code });
  return e;
}

/**
 * `fix` → tahrir oplari (hujjat O'ZGARMAYDI, faqat op lar qaytadi).
 * Nishon: bo'lim id | `abstract:<lang>` | `keywords` | `highlights`.
 */
export async function rewriteArticleSection(doc: AcademicDoc, fix: ArticleFix, deps: RewriteDeps = {}): Promise<ArticleOp[]> {
  try {
    const r = await rewriteFix(doc, fix, { complete: deps.complete ?? completeRole, deadline: deps.deadline });
    return r.ops;
  } catch (e) {
    throw toApiError(e);
  }
}

/* ────────────────────────── hisobot ────────────────────────── */

/**
 * Tahrirdan keyingi hisobot: qoidalar QAYTA (`reviewArticle`, `judge:false`),
 * baholovchi ballari avvalgi hisobotdan (`judgeFromReview`), izoh bilan.
 * Avto-sayqal jurnali (`polish`) SAQLANADI, «Sizdan kutiladi» qayta.
 */
export async function recomputeReview(doc: AcademicDoc, prev: ArticleReview | undefined, applied?: ArticleFix, now = new Date()): Promise<ArticleReview> {
  const type = ARTICLE_TYPES[doc.article?.type ?? "imrad_oak"];
  const profile = PUBLICATION_PROFILES[doc.article?.profile ?? type.defaultProfile];
  // Dvigatel bilan bir xil: «Hajm» qoidasi BO'LIM matniga qaraydi (`plan.body`), annotatsiya qo'shilmaydi.
  const wordTarget = articleWordPlan(doc.meta, type, profile).body;
  const fresh = await reviewArticle(doc, { judge: false, wordTarget, now });
  const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
  const judge = judgeFromReview(prev, applied) ?? neutralJudge();
  const out: ArticleReview = {
    ...fresh,
    score: scoreReview(rules, judge),
    checks: [...rules, ...judgeChecks(judge)],
    judgeNotes: [...judge.notes, REWRITE_REVIEW_NOTE],
    ...(prev?.polish ? { polish: prev.polish } : {}),
  };
  out.userNeeds = userNeeds(out, doc);
  return out;
}

/* ────────────────────────── o'qituvchi hujjati ────────────────────────── */

/**
 * BANDMA-BAND «TUZATISH» — o'qituvchi hujjati (AUDIT-20 WP-D).
 *
 * Maqoladan ikki farqi bor, ikkalasi ham SHAKLDA, qoidalarda emas:
 *
 *   1. NISHON. Maqolada bo'lim id / `abstract:<lang>` / `keywords`;
 *      bu yerda bo'lim id yoki `table:<n>` — chunki texnologik
 *      xaritaning butun mazmuni JADVALDA turadi va uni bo'lim
 *      bloklari bilan qayta yozib bo'lmaydi (`rewriteTeacherFix`).
 *   2. OP TILI. Sayqal `setSection`/`setTable` beradi, adapter esa
 *      `TeacherOp` ni tushunadi — `teacherOpsFromPolish` o'giradi
 *      (`doc-polish.ts` dagi bilan AYNI o'girma).
 *
 * Qolgani maqoladagidek: kredit yechilmaydi, hisobot QOIDALAR bilan
 * qayta hisoblanadi, baholovchi ballari avvalgi hisobotdan ko'chadi
 * (narx va vaqt sababli — to'liq qayta baholash «Hammasini tuzatish»
 * da), yozish `commitDocOps` orqali.
 */
async function rewriteTeacher(
  id: string,
  userId: string,
  baseVersion: number,
  fix: ArticleFix,
  doc: AcademicDoc,
  deps: RewriteDeps & { deadline: number },
): Promise<RewriteResult> {
  let sectionOps;
  try {
    const r = await rewriteTeacherFix(doc, fix, { complete: deps.complete ?? completeRole, deadline: deps.deadline });
    sectionOps = r.ops;
  } catch (e) {
    throw toApiError(e);
  }

  const ops = teacherOpsFromPolish(sectionOps);
  if (!ops.length) throw new ApiError("Model javob bermadi — qayta urinib ko‘ring", 422, { code: "llm" });

  // Hisobot YANGI hujjat ustida — avval op lar mahalliy qo'llanadi (yozilmaydi).
  const applied = applyTeacherOps(doc, ops, { genId: id });
  if (!applied.ok) throw new ApiError(applied.error, 422, { at: applied.at });

  const model = applied.doc.teacher;
  if (!model) throw new ApiError("Eski hujjatda «Tuzatish» yo'q — qaytadan yarating", 409, { code: "legacy" });
  const fresh = await reviewTeacher(applied.doc, { judge: false, now: deps.now });
  const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
  const judge = teacherJudgeFromReview(doc.teacher?.review, model) ?? neutralTeacherJudge(model);
  const review: DocReview = {
    ...fresh,
    score: scoreTeacherReview(rules, model, judge),
    checks: [...rules, ...teacherJudgeChecks(model, judge)],
    judgeNotes: [...judge.notes, REWRITE_REVIEW_NOTE],
    ...(doc.teacher?.review?.polish ? { polish: doc.teacher.review.polish } : {}),
  };
  review.userNeeds = teacherUserNeeds(review, applied.doc);

  const all: TeacherOp[] = [...ops, { op: "review", review }];
  const generation = await commitDocOps(id, userId, baseVersion, all as unknown as DocOp[]);
  return { generation, ops: all as unknown as ArticleOp[] };
}

/* ────────────────────────── bosma o'yinlar ────────────────────────── */

/**
 * BANDMA-BAND «TUZATISH» — krossvord va flesh kartalar (AUDIT-21 WP-D).
 *
 * O'qituvchi hujjatidan ikki farqi bor:
 *
 *   1. YOZISH YO'LI. Bu oilada tahrir ADAPTERI yo'q (ataylab: so'z yoki
 *      karta qo'lda o'zgarsa to'r va A7 panjarasi hujjatdan ajralib
 *      ketardi), ya'ni `commitDocOps` op larni qayta qo'llay olmaydi.
 *      Shuning uchun op lar MAHALLIY qo'llanadi va hujjatning O'ZI
 *      yoziladi (`commitPolishedDoc`) — «Hammasini tuzatish» dagi
 *      yo'lning aynan o'zi.
 *   2. NISHON BITTA. Krossvordda `clues` (ta'riflar), kartada `cards`:
 *      to'r bandlari (`grid`, `answers`) avtomatik tuzatilmaydi va
 *      hisobot ularni `manual` deb ko'rsatadi — 422 `target`.
 *
 * Qolgani oila bilan bir xil: kredit yechilmaydi, hisobot QOIDALAR
 * bilan qayta hisoblanadi, baholovchi ballari avvalgi hisobotdan
 * ko'chadi (narx/vaqt — to'liq qayta baholash «Hammasini tuzatish» da).
 */
async function rewriteGame(
  id: string,
  userId: string,
  baseVersion: number,
  fix: ArticleFix,
  doc: AcademicDoc,
  deps: RewriteDeps & { deadline: number; fileName: string },
): Promise<RewriteResult> {
  const model = doc.game;
  if (!model) throw new ApiError("Eski hujjatda «Tuzatish» yo'q — qaytadan yarating", 409, { code: "legacy" });
  const complete = deps.complete ?? completeRole;
  const prev = model.review;

  let next: AcademicDoc;
  let review: DocReview;
  try {
    if (model.kind === "crossword") {
      const ctx = crosswordContextOf(doc, prev);
      if (!ctx) throw new ApiError("Eski hujjatda «Tuzatish» yo'q — qaytadan yarating", 409, { code: "legacy" });
      /*
       * NISHON darvozasi SHU YERDA: `rewriteClues` ning o'zi nishonni
       * tekshirmaydi (sayqalda uni `planCrosswordPolish` allaqachon
       * filtrlagan bo'ladi). To'g'ridan-to'g'ri yuborilgan `grid`
       * so'rovi esa ta'riflarni bekordan-bekor qayta yozdirardi —
       * to'r bandini u baribir tuzata olmaydi.
       */
      if (fix.target !== "clues") {
        throw new ApiError("Bu band avtomatik tuzatilmaydi — krossvordni qaytadan yarating", 422, { code: "target" });
      }
      const out = await rewriteClues(doc, fix, { complete, input: ctx.input, spec: ctx.spec, deadline: deps.deadline });
      const applied = applyClueOps(doc, out.ops);
      if (!applied.ok) throw new ApiError(applied.error, 422, { code: "llm" });
      next = applied.doc;
      const fresh = await reviewCrossword(next, { ask: ctx.ask, judge: false, now: deps.now });
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      const judge = crosswordJudgeFromReview(prev ?? fresh) ?? neutralJudgeFor(ctx.spec.judge);
      review = {
        ...fresh,
        score: scoreCrosswordReview(rules, judge),
        checks: [...rules, ...judgeChecksFor(ctx.spec.judge, judge)],
        judgeNotes: [...judge.notes, REWRITE_REVIEW_NOTE],
        ...(prev?.polish ? { polish: prev.polish } : {}),
      };
      review.userNeeds = crosswordUserNeeds({ dropped: next.game?.crossword?.dropped ?? [] }, { wordCount: ctx.ask.wordCount ?? 0 });
    } else {
      const out = await rewriteFlashcardsFix(doc, fix, { complete, deadline: deps.deadline });
      const applied = applyCardsOps(doc, out.ops);
      if (!applied.ok) throw new ApiError(applied.error, 422, { code: "llm" });
      next = applied.doc;
      const nextModel = next.game!;
      const fresh = await reviewFlashcards(next, { judge: false, now: deps.now });
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      const judge = cardsJudgeFromReview(prev, nextModel) ?? neutralCardsJudge(nextModel);
      review = {
        ...fresh,
        score: scoreCardsReview(rules, nextModel, judge),
        checks: [...rules, ...cardsJudgeChecks(nextModel, judge)],
        judgeNotes: [...judge.notes, REWRITE_REVIEW_NOTE],
        ...(prev?.polish ? { polish: prev.polish } : {}),
      };
      review.userNeeds = flashcardsUserNeeds(review, next);
    }
  } catch (e) {
    throw toApiError(e);
  }

  const written: AcademicDoc = { ...next, game: { ...next.game!, review, userNeeds: review.userNeeds ?? [] } };
  /*
   * DOCX SHU YERDA qayta yasaladi. Boshqa oilalarda buni `POST …/rebuild`
   * qiladi, lekin u tahrir adapterining renderini so'raydi va o'yinda
   * adapter yo'q — fayl abadiy eski ta'riflar bilan qolardi.
   */
  const built = await (deps.rebuildFile ?? renderGameFile)(written, { id, userId });
  if (!built) throw new ApiError("Fayl qayta yasalmadi — qayta urinib ko‘ring", 422, { code: "render" });
  const generation = await commitPolishedDoc(id, userId, baseVersion, written, built.html ?? renderHtml(written), {
    bytes: built.bytes,
    mime: built.mime,
    fileName: deps.fileName,
  });
  return { generation, ops: [{ op: "review", review } as unknown as ArticleOp] };
}

/* ────────────────────────── yozish ────────────────────────── */

export type RewriteResult = { generation: Awaited<ReturnType<typeof commitDocOps>>; ops: ArticleOp[] };

/**
 * `POST …/rewrite` yadrosi: egalik/holat (`loadDocForEdit`), versiya
 * (409 — LLM chaqirilmasdan OLDIN ham tekshiriladi: eskirgan tab 30 s
 * kutib keyin 409 olmasin), LLM → op lar → hisobot → `commitDocOps`
 * (asl qulf SQL predikatida).
 */
export async function rewriteArticle(id: string, userId: string, baseVersion: number, fix: ArticleFix, deps: RewriteDeps = {}): Promise<RewriteResult> {
  /*
   * `loadDocForEdit` EMAS (AUDIT-21 WP-D): o'yinlarda tahrir adapteri
   * yo'q va u 409 `legacy` berardi, holbuki ularda hisobot ham,
   * bandma-band tuzatish ham bor. Adapterli hujjatlar uchun darvoza
   * o'zgarmaydi (`adapter.hasModel`).
   */
  const cur = await loadDocForPolish(id, userId);
  /*
   * INFOGRAFIKA (AUDIT-21): bandma-band «Tuzatish» YO'Q — 422
   * «Hammasini tuzatish» ga yo'naltiradi. Sabab inshodagi bilan bir xil
   * shaklda, lekin boshqa ildizdan: plakatda NISHON BITTA (`spec`) —
   * hisobotning har bandi butun spetsifikatsiyani qayta yozdiradi, va
   * ustiga PNG qayta chiziladi. Ya'ni bandma-band yo'l «Hammasini
   * tuzatish» ning baholovchisiz nusxasi bo'lardi. Panel ham plakatda
   * «Tuzatish» tugmalarini chizmaydi (`ResultView` `onFix` bermaydi).
   */
  if (cur.polisherId === "infographic") {
    throw new ApiError("Plakat bandma-band tuzatilmaydi — «Hammasini tuzatish» tugmasidan foydalaning (plakat qaytadan chiziladi)", 422, { code: "infographic" });
  }
  if (cur.polisherId === "game") {
    if (baseVersion !== cur.docVersion) {
      throw new ApiError("Hujjat boshqa joyda o'zgargan — yangilab qayta urinib ko'ring", 409, { code: "version", docVersion: cur.docVersion });
    }
    return rewriteGame(id, userId, baseVersion, fix, cur.doc, { ...deps, deadline: deps.deadline ?? Date.now() + REWRITE_TIMEOUT_MS, fileName: cur.fileName });
  }
  if (!cur.adapter) throw new ApiError("Bu hujjat tahrirlanmaydi", 409, { code: "legacy" });
  /*
   * Insho (AUDIT-19): BANDMA-BAND tuzatish YO'Q — 422 «Hammasini
   * tuzatish» ga yo'naltiradi.
   *
   * Sabab mahsulotda: insho `sections` da BITTA bo'lim, uning hisobot
   * bandlari ham (hajm, thesis statement, klişe, takror) butun matnga
   * tegishli — har «Tuzatish» baribir butun inshoni qayta yozardi.
   * Ya'ni bandma-band yo'l «Hammasini tuzatish» ning ikkinchi, deyarli
   * aynan nusxasi bo'lib, ballni qayta baholamas (`rewrite` baholovchini
   * chaqirmaydi) va Q-3 himoyasisiz qolardi. Panel ham inshoda
   * «Tuzatish» tugmalarini chizmaydi (`ResultView` `onFix` bermaydi) —
   * bu tekshiruv to'g'ridan-to'g'ri yuborilgan so'rov uchun.
   */
  if (cur.adapter.id === "essay") {
    throw new ApiError("Insho uchun bandma-band tuzatish yo'q — «Hammasini tuzatish» tugmasidan foydalaning", 422, { code: "essay" });
  }
  if (cur.adapter.id !== "article" && cur.adapter.id !== "teacher") {
    throw new ApiError("Bu hujjat maqola emas", 409, { code: "legacy" });
  }
  if (baseVersion !== cur.docVersion) {
    throw new ApiError("Hujjat boshqa joyda o'zgargan — yangilab qayta urinib ko'ring", 409, { code: "version", docVersion: cur.docVersion });
  }
  const deadline = deps.deadline ?? Date.now() + REWRITE_TIMEOUT_MS;
  if (cur.adapter.id === "teacher") return rewriteTeacher(id, userId, baseVersion, fix, cur.doc, { ...deps, deadline });
  const ops = await rewriteArticleSection(cur.doc, fix, { ...deps, deadline });

  // Hisobot YANGI hujjat ustida — avval op lar mahalliy qo'llanadi (yozilmaydi).
  const applied = applyArticleOps(cur.doc, ops, { genId: id });
  if (!applied.ok) throw new ApiError(applied.error, 422, { at: applied.at });
  const review = await recomputeReview(applied.doc, cur.doc.article?.review, fix, deps.now);
  const all: ArticleOp[] = [...ops, { op: "review", review }];

  const generation = await commitDocOps(id, userId, baseVersion, all as unknown as DocOp[]);
  return { generation, ops: all };
}
