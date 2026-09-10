import "server-only";
import { applyDocOps, parseDocOps, type DocOp } from "../generation/slide-edit";
import { applyResumeOps, parseResumeOps, type ResumeOp } from "../generation/resume/edit";
import { legacyResumeModel } from "../generation/resume/model";
import { renderDocx } from "../generation/render-docx";
import { renderPptx } from "../generation/render-pptx";
import { renderPptxWithTemplate } from "../generation/render-pptx-template";
import { getTemplate } from "./template-upload";
import type { ImageBytes } from "../generation/slide-images";
import type { AcademicDoc } from "../generation/types";

/**
 * Tahrir ADAPTERLARI (Rezyume 2, AUDIT-15 — B-5/B-6/B-2).
 *
 * `slide-commit.ts` E4 dan beri butun tahrir serverini ushlab turadi:
 * egalik, optimistik qulf, atomar PATCH, eskirgan fayl kafolati. Bu
 * mantiqning HECH BIRI slaydga xos emas — slaydga xos bo'lgani atigi
 * to'rt nuqta: qaysi vosita tahrirlanadi, hujjatda model bormi,
 * operatsiyalar qanday parse/apply qilinadi va fayl nima bilan qayta
 * yasaladi. Rezyume aynan shu to'rttasi bilan farq qiladi.
 *
 * Shuning uchun ular MA'LUMOTGA aylantirildi (`slide-themes.ts` /
 * `docx-profile.ts` naqshi): yangi tahrirlanadigan hujjat turi qo'shish
 * = yangi adapter yozish, `slide-commit.ts` ga tegmasdan.
 *
 * Operatsiyalar tipi bu yerda ATAYIN `unknown[]`: yagona ishlab
 * chiqaruvchi — o'sha adapterning `parse` i, ya'ni `apply` ichidagi
 * cast `parseDocOps`/`parseResumeOps` bergan kafolatga tayanadi
 * (ilgari ham shunday edi, faqat cast route darajasida turardi).
 */

export type RenderedFile = { bytes: Uint8Array; mime: string; fileName: string };

/**
 * Render seami — standarti `renderPptx`. Test uchun kerak: haqiqiy
 * render sekin va uni ATAYLAB yiqitib bo'lmaydi, holbuki eng muhim
 * kafolat aynan «render yiqilsa bazaga hech narsa yozilmaydi».
 * Route'lar bu parametrni HECH QACHON bermaydi.
 */
export type RebuildDeps = { render?: typeof renderPptx };

export type RenderCtx = {
  id: string;
  userId: string;
  doc: AcademicDoc;
  fileName: string;
  /** Faqat SHU generatsiyaning aktivlari (`assetImageResolver`) — SSRF/IDOR yo'q. */
  resolveImage: (url: string) => Promise<ImageBytes | null>;
};

export type ParseResult = { ok: true; ops: unknown[] } | { ok: false; error: string };
export type ApplyResult = { ok: true; doc: AcademicDoc } | { ok: false; error: string; at: number };

export type EditAdapter = {
  id: "slide" | "resume";
  /** Shu adapter xizmat qiladigan vositalar (`generations.tool_id`). */
  tools: ReadonlySet<string>;
  /** Hujjatda tahrir uchun kerakli model bormi (yo'q bo'lsa 409 `legacy`). */
  hasModel: (doc: AcademicDoc | null | undefined) => boolean;
  /** Tahrirdan OLDIN hujjatni normal holatga keltiradi (eski format → model). */
  prepare: (doc: AcademicDoc) => AcademicDoc;
  parse: (raw: unknown) => ParseResult;
  apply: (doc: AcademicDoc, ops: unknown[], ctx: { genId: string }) => ApplyResult;
  render: (ctx: RenderCtx, deps: RebuildDeps) => Promise<RenderedFile>;
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const slideAdapter: EditAdapter = {
  id: "slide",
  tools: new Set(["slide", "pro-slide"]),
  hasModel: (doc) => Boolean(doc?.slides?.length),
  prepare: (doc) => doc,
  parse: (raw) => parseDocOps(raw),
  apply: (doc, ops, ctx) => applyDocOps(doc, ops as DocOp[], ctx),
  async render(ctx, deps) {
    const render = deps.render ?? renderPptx;
    /*
     * «O'z shablonim»: namuna bayti hali bazada bo'lsa — o'sha yo'l;
     * o'chirilgan bo'lsa ichki renderer (deka yo'qolmaydi, faqat
     * ko'rinishi o'zgaradi). Bu tarmoq AUDIT-13 dan qoladi.
     */
    const custom = ctx.doc.customTemplate
      ? await getTemplate(ctx.userId, ctx.doc.customTemplate.assetId).catch(() => null)
      : null;
    const built = custom
      ? await renderPptxWithTemplate(ctx.doc, ctx.fileName, custom.bytes, custom.template.profile, { resolveImage: ctx.resolveImage })
      : await render(ctx.doc, ctx.fileName, { resolveImage: ctx.resolveImage });
    return { bytes: built.bytes, mime: built.mime, fileName: built.fileName };
  },
};

export const resumeAdapter: EditAdapter = {
  id: "resume",
  tools: new Set(["resume"]),
  // Eski (Rezyume 2 dan oldingi) hujjat ham tahrirlanadi — `prepare` uni
  // `legacyResumeModel` bilan modelga ko'taradi (B-8).
  hasModel: (doc) => Boolean(doc?.resume || doc?.sections?.length),
  prepare: (doc) => (doc.resume ? doc : { ...doc, resume: legacyResumeModel(doc) }),
  parse: (raw) => parseResumeOps(raw),
  apply: (doc, ops, ctx) => applyResumeOps(doc, ops as ResumeOp[], ctx),
  async render(ctx) {
    const bytes = await renderDocx(ctx.doc, { resolveImage: ctx.resolveImage });
    return { bytes, mime: DOCX_MIME, fileName: ctx.fileName };
  },
};

/** Bitta so'rovdagi operatsiyalar soni — ikkala op tili uchun bir xil. */
export const MAX_EDIT_OPS = 50;

/**
 * Hujjat TURIDAN mustaqil ENVELOPE darvozasi.
 *
 * Adapterni tanlash uchun vositani bilish kerak, ya'ni bazaga borish
 * kerak. Yaroqsiz katta tana esa bazaga UMUMAN bormasligi lozim — aks
 * holda 10 000 operatsiyali so'rov har safar bitta o'qishni yeyardi.
 * Shuning uchun so'rov shakli avval shu yerda, arzon tekshiriladi;
 * op larning MA'NOSI keyin, adapterning `parse` ida.
 */
export function preParseOps(raw: unknown): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Operatsiyalar ro'yxati kutilgan" };
  if (!raw.length) return { ok: false, error: "Operatsiya yo'q" };
  if (raw.length > MAX_EDIT_OPS) {
    return { ok: false, error: `Bir so'rovda ${MAX_EDIT_OPS} tadan ortiq operatsiya bo'lmaydi` };
  }
  return { ok: true };
}

const ADAPTERS: EditAdapter[] = [slideAdapter, resumeAdapter];

/** Vosita uchun adapter; tahrirlanmaydigan vositada `null`. */
export function adapterFor(toolId: string): EditAdapter | null {
  return ADAPTERS.find((a) => a.tools.has(toolId)) ?? null;
}

/** Tahrirlanadigan barcha vositalar — testlar va diagnostika uchun. */
export function editableTools(): string[] {
  return ADAPTERS.flatMap((a) => [...a.tools]);
}
