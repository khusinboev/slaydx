import "server-only";
import { ApiError } from "./api";
import { commitDocOps, loadDocForEdit } from "./slide-commit";
import type { ArticleOp } from "../generation/article/edit";
import { planPolish, runPolish, type PolishResult } from "../generation/article/polish";
import { complete as completeRole } from "../generation/llm-roles";
import type { DocOp } from "../generation/slide-edit";

/**
 * «HAMMASINI TUZATISH» — natija sahifasidan avto-sayqal (Maqola 3,
 * AUDIT-18 WP-A). Dvigatel 8-bosqichi bilan AYNAN bitta mantiq
 * (`article/polish.ts runPolish`): tuzatiladigan bandlar `writer` bilan
 * qayta yoziladi, `judge` (Claude) qayta baholaydi, ball OSHSA qabul (Q-3).
 *
 * Server o'rami `article-rewrite.ts` naqshida: egalik/holat
 * (`loadDocForEdit`), versiya 409 LLM dan OLDIN, natija `commitDocOps`
 * orqali BITTA yozuvda — qabul qilinsa op lar + `review` opi; rad etilsa
 * FAQAT `review` opi (sayqal jurnali bilan — foydalanuvchi «ball
 * oshmadi, eski matn qoldi» ni ko'radi). Kredit yechilmaydi (chegara —
 * route: 3 marta/maqola/kun, 20/foydalanuvchi/kun).
 */

export type PolishDeps = {
  /** Test seam — rol bo'yicha LLM. */
  complete?: typeof completeRole;
  deadline?: number;
  now?: Date;
};

/** Butun sayqal: ≤6 tuzatish 2 to'lqinda (≤60 s) + baholovchi (≤35 s). */
export const POLISH_TIMEOUT_MS = 120_000;

export type PolishArticleResult = { generation: Awaited<ReturnType<typeof commitDocOps>>; ops: ArticleOp[]; polish: PolishResult["log"] };

export async function polishArticle(id: string, userId: string, baseVersion: number, deps: PolishDeps = {}): Promise<PolishArticleResult> {
  const cur = await loadDocForEdit(id, userId);
  if (cur.adapter.id !== "article" || !cur.doc.article) throw new ApiError("Eski maqolada sayqal yo'q — qaytadan yarating", 409, { code: "legacy" });
  if (baseVersion !== cur.docVersion) {
    throw new ApiError("Hujjat boshqa joyda o'zgargan — yangilab qayta urinib ko'ring", 409, { code: "version", docVersion: cur.docVersion });
  }
  const review = cur.doc.article.review;
  if (!review) throw new ApiError("Tayyorlik hisoboti yo'q — sayqal uchun hisobot kerak", 422, { code: "review" });
  if (!planPolish(review, cur.doc).fixes.length) throw new ApiError("Tuzatiladigan band yo'q — qolganlari sizning ma'lumotingizni kutmoqda", 422, { code: "nothing" });

  const r = await runPolish(cur.doc, review, {
    complete: deps.complete ?? completeRole,
    deadline: deps.deadline ?? Date.now() + POLISH_TIMEOUT_MS,
    now: deps.now,
    judge: true,
    genId: id,
  });
  // Bironta tuzatish ham chiqmadi (model javobsiz) — hujjat va hisobot o'zgarmaydi, foydalanuvchi qayta uradi.
  if (!r.applied.length) throw new ApiError("Model javob bermadi — qayta urinib ko‘ring", 422, { code: "llm" });

  const ops: ArticleOp[] = r.accepted ? [...r.ops, { op: "review", review: r.review }] : [{ op: "review", review: r.review }];
  const generation = await commitDocOps(id, userId, baseVersion, ops as unknown as DocOp[]);
  return { generation, ops, polish: r.log };
}
