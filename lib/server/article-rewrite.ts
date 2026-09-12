import "server-only";
import { ApiError } from "./api";
import { commitDocOps, loadDocForEdit } from "./slide-commit";
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

/* ────────────────────────── yozish ────────────────────────── */

export type RewriteResult = { generation: Awaited<ReturnType<typeof commitDocOps>>; ops: ArticleOp[] };

/**
 * `POST …/rewrite` yadrosi: egalik/holat (`loadDocForEdit`), versiya
 * (409 — LLM chaqirilmasdan OLDIN ham tekshiriladi: eskirgan tab 30 s
 * kutib keyin 409 olmasin), LLM → op lar → hisobot → `commitDocOps`
 * (asl qulf SQL predikatida).
 */
export async function rewriteArticle(id: string, userId: string, baseVersion: number, fix: ArticleFix, deps: RewriteDeps = {}): Promise<RewriteResult> {
  const cur = await loadDocForEdit(id, userId);
  if (cur.adapter.id !== "article") throw new ApiError("Bu hujjat maqola emas", 409, { code: "legacy" });
  if (baseVersion !== cur.docVersion) {
    throw new ApiError("Hujjat boshqa joyda o'zgargan — yangilab qayta urinib ko'ring", 409, { code: "version", docVersion: cur.docVersion });
  }
  const deadline = deps.deadline ?? Date.now() + REWRITE_TIMEOUT_MS;
  const ops = await rewriteArticleSection(cur.doc, fix, { ...deps, deadline });

  // Hisobot YANGI hujjat ustida — avval op lar mahalliy qo'llanadi (yozilmaydi).
  const applied = applyArticleOps(cur.doc, ops, { genId: id });
  if (!applied.ok) throw new ApiError(applied.error, 422, { at: applied.at });
  const review = await recomputeReview(applied.doc, cur.doc.article?.review, fix, deps.now);
  const all: ArticleOp[] = [...ops, { op: "review", review }];

  const generation = await commitDocOps(id, userId, baseVersion, all as unknown as DocOp[]);
  return { generation, ops: all };
}
