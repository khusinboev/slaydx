import "server-only";
import { ApiError } from "./api";
import { commitDocOps, loadDocForEdit } from "./slide-commit";
import type { ArticleOp } from "../generation/article/edit";
import { planPolish, runPolish } from "../generation/article/polish";
import { planEssayPolish, runEssayPolish } from "../generation/essay/polish";
import { planWorkPolish, runWorkPolish } from "../generation/work/polish";
import { planTeacherPolish, runTeacherPolish } from "../generation/teacher/polish";
import { teacherOpsFromPolish } from "../generation/teacher/edit";
import { essaySection } from "../generation/essay/review";
import { complete as completeRole } from "../generation/llm-roles";
import type { DocReview, PolishLog } from "../generation/report/types";
import type { AcademicDoc } from "../generation/types";
import type { DocOp } from "../generation/slide-edit";

/**
 * «HAMMASINI TUZATISH» — natija sahifasidan avto-sayqal.
 *
 * Maqola 3 (AUDIT-18 WP-A) da bu modul `article-polish.ts` edi va
 * adapter id si QATTIQ `article` bo'lgan. Talaba ishlari 2 (AUDIT-19)
 * dan insho ham hisobot + avto-sayqal bilan keladi, shuning uchun
 * modul umumlashtirildi: SERVER qismi (egalik/holat, versiya qulfi,
 * bitta `commitDocOps` yozuvi, kreditsizlik, 409/422 kodlari) hujjat
 * turidan MUSTAQIL, farqi esa atigi uchta nuqtada — hisobot qayerda
 * turadi, rejani kim tuzadi va sayqalni kim yuritadi. Ular
 * `POLISHERS` jadvalida MA'LUMOT (`edit-adapters.ts` naqshi):
 * yangi hujjat turi = yangi qator, bu fayl tanasiga tegmasdan.
 *
 * Dvigatel bosqichi bilan AYNAN bitta mantiq ishlaydi: `runPolish` /
 * `runEssayPolish` — tuzatiladigan bandlar `writer` bilan qayta
 * yoziladi, `judge` (Claude) qayta baholaydi, ball OSHSA qabul (Q-3).
 * Rad etilsa hujjat matni O'ZGARMAYDI, faqat `review` opi yoziladi —
 * foydalanuvchi «ball oshmadi, eski matn qoldi» ni ko'radi.
 *
 * Kredit YECHILMAYDI (chegara — route: 3 marta/hujjat/kun,
 * 20/foydalanuvchi/kun).
 */

export type PolishDeps = {
  /** Test seam — rol bo'yicha LLM. */
  complete?: typeof completeRole;
  deadline?: number;
  now?: Date;
};

/** Butun sayqal: ≤6 tuzatish 2 to'lqinda (≤60 s) + baholovchi (≤35 s). */
export const POLISH_TIMEOUT_MS = 120_000;

export type PolishDocResult = { generation: Awaited<ReturnType<typeof commitDocOps>>; ops: ArticleOp[]; polish: PolishLog };

type PolishRun = {
  doc: AcademicDoc;
  review: DocReview;
  ops: unknown[];
  applied: unknown[];
  accepted: boolean;
  log: PolishLog;
};

/**
 * Hujjat turining sayqal shartnomasi — to'rtta farq nuqtasi.
 *
 * `run` HAR DOIM `{doc, review, ops, applied, accepted, log}` qaytaradi
 * (`report/polish-core.ts` `RunPolishResult`), lekin `ops` HUJJAT
 * TILIDA: maqolada `ArticleOp`, inshoda `EssayOp` (`setEssay`).
 * `commitDocOps` esa op larni ADAPTER orqali qayta qo'llaydi
 * (`essayAdapter.apply` = `applyArticleOps`), ya'ni yoziladigan op lar
 * o'sha adapter tushunadigan tilda bo'lishi SHART — `toOps` shu
 * o'girmani qiladi. Ilgari bu qadam yo'q edi, chunki maqolada ikkala
 * til bir xil edi; insho uni ochib berdi.
 */
type Polisher = {
  /** Hisobot hujjatning qayerida (maqola `doc.article`, insho `doc.essay`). */
  review: (doc: AcademicDoc) => DocReview | undefined;
  /** Model yo'q — eski hujjat (409 `legacy`). */
  hasModel: (doc: AcademicDoc) => boolean;
  /** Tuzatiladigan band bormi (422 `nothing`) — SERVER rejasi, panel taxmini emas. */
  planned: (review: DocReview, doc: AcademicDoc) => number;
  run: (doc: AcademicDoc, review: DocReview, deps: Required<Pick<PolishDeps, "complete" | "deadline">> & { now?: Date; genId: string }) => Promise<PolishRun>;
  /** Sayqal natijasi → ADAPTER tushunadigan op lar (`commitDocOps` shu bilan yozadi). */
  toOps: (r: PolishRun) => ArticleOp[];
};

const POLISHERS: Record<string, Polisher> = {
  article: {
    review: (doc) => doc.article?.review,
    hasModel: (doc) => Boolean(doc.article),
    planned: (review, doc) => planPolish(review, doc).fixes.length,
    run: (doc, review, deps) =>
      runPolish(doc, review, { complete: deps.complete, deadline: deps.deadline, now: deps.now, judge: true, genId: deps.genId }),
    // Maqolada sayqal tili = tahrir tili.
    toOps: (r) => r.ops as ArticleOp[],
  },
  essay: {
    review: (doc) => doc.essay?.review,
    /*
     * Eski insho (`writeEssayWithLlm` yozgan) da `doc.essay` yo'q va
     * hisobot ham yo'q — sayqal uchun hujjat qaytadan yaratilishi kerak.
     */
    hasModel: (doc) => Boolean(doc.essay),
    planned: (review, doc) => planEssayPolish(review, doc).fixes.length,
    run: (doc, review, deps) =>
      runEssayPolish(doc, review, { complete: deps.complete, deadline: deps.deadline, now: deps.now, judge: true }),
    /*
     * Insho sayqali `setEssay` (butun bo'lim bloklari, epigraf saqlangan
     * holda) beradi — adapter esa `setSection` ni tushunadi. Natijaviy
     * hujjatning O'ZIDAN o'qiladi: `applyEssayOps` nima yozgan bo'lsa
     * (epigraf bloki qaytarilgani ham) aynan shu bazaga tushadi.
     */
    toOps: (r) => {
      const section = essaySection(r.doc);
      return section ? [{ op: "setSection", sectionId: section.id, blocks: section.blocks }] : [];
    },
  },
};

/** Vosita sayqal qila oladimi — route va testlar uchun. */
POLISHERS.work = {
  review: (doc) => doc.work?.review,
  hasModel: (doc) => Boolean(doc.work),
  planned: (review, doc) => planWorkPolish(review, doc).fixes.length,
  run: (doc, review, deps) => runWorkPolish(doc, review, { complete: deps.complete ?? completeRole, deadline: deps.deadline ?? Date.now() + POLISH_TIMEOUT_MS, now: deps.now, judge: true }),
  // Talaba ishi sayqali `setSection` beradi — adapter tili bilan bir xil (`work/edit.ts`, WP-C).
  toOps: (r) => r.ops as ArticleOp[],
};

/**
 * O'QITUVCHI HUJJATLARI (AUDIT-20 WP-D).
 *
 * Sayqal tili (`TeacherSectionOp` — `setSection` va `setTable`) tahrir
 * tilidan FARQ QILADI: xaritada hujjatning butun mazmuni JADVALDA
 * turadi va uni bo'lim bloklari bilan qayta yozib bo'lmaydi.
 * `teacherOpsFromPolish` o'girmani qiladi (`setTable` → o'zgargan
 * kataklar uchun `cell` op lari) — insho `toOps` i bilan bir xil
 * sabab: `commitDocOps` op larni ADAPTER orqali qayta qo'llaydi,
 * ya'ni ular adapter tushunadigan tilda bo'lishi SHART.
 *
 * Op soni cheklanmaydi: `commitDocOps` op larni saqlamaydi, hujjatning
 * O'ZINI yozadi.
 */
POLISHERS.teacher = {
  review: (doc) => doc.teacher?.review,
  hasModel: (doc) => Boolean(doc.teacher),
  planned: (review, doc) => planTeacherPolish(review, doc).fixes.length,
  run: (doc, review, deps) =>
    runTeacherPolish(doc, review, {
      complete: deps.complete ?? completeRole,
      deadline: deps.deadline ?? Date.now() + POLISH_TIMEOUT_MS,
      now: deps.now,
      judge: true,
    }),
  toOps: (r) => teacherOpsFromPolish(r.ops as Parameters<typeof teacherOpsFromPolish>[0]) as unknown as ArticleOp[],
};

export function polishableAdapters(): string[] {
  return Object.keys(POLISHERS);
}

export async function polishGeneration(id: string, userId: string, baseVersion: number, deps: PolishDeps = {}): Promise<PolishDocResult> {
  const cur = await loadDocForEdit(id, userId);
  const polisher = POLISHERS[cur.adapter.id];
  if (!polisher || !polisher.hasModel(cur.doc)) {
    throw new ApiError("Eski hujjatda sayqal yo'q — qaytadan yarating", 409, { code: "legacy" });
  }
  /*
   * Versiya LLM dan OLDIN: eskirgan tab 60 s kutib, LLM pulini yeb,
   * keyin 409 olmasin.
   */
  if (baseVersion !== cur.docVersion) {
    throw new ApiError("Hujjat boshqa joyda o'zgargan — yangilab qayta urinib ko'ring", 409, { code: "version", docVersion: cur.docVersion });
  }
  const review = polisher.review(cur.doc);
  if (!review) throw new ApiError("Tayyorlik hisoboti yo'q — sayqal uchun hisobot kerak", 422, { code: "review" });
  if (!polisher.planned(review, cur.doc)) {
    throw new ApiError("Tuzatiladigan band yo'q — qolganlari sizning ma'lumotingizni kutmoqda", 422, { code: "nothing" });
  }

  const r = await polisher.run(cur.doc, review, {
    complete: deps.complete ?? completeRole,
    deadline: deps.deadline ?? Date.now() + POLISH_TIMEOUT_MS,
    ...(deps.now ? { now: deps.now } : {}),
    genId: id,
  });
  // Bironta tuzatish ham chiqmadi (model javobsiz) — hujjat va hisobot o'zgarmaydi, foydalanuvchi qayta uradi.
  if (!r.applied.length) throw new ApiError("Model javob bermadi — qayta urinib ko‘ring", 422, { code: "llm" });

  const ops: ArticleOp[] = r.accepted
    ? [...polisher.toOps(r), { op: "review", review: r.review }]
    : [{ op: "review", review: r.review }];
  const generation = await commitDocOps(id, userId, baseVersion, ops as unknown as DocOp[]);
  return { generation, ops, polish: r.log };
}
