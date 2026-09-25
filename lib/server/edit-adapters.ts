import "server-only";
import { applyDocOps, parseDocOps, type DocOp } from "../generation/slide-edit";
import { applyResumeOps, parseResumeOps, type ResumeOp } from "../generation/resume/edit";
import { legacyResumeModel } from "../generation/resume/model";
import { applyArticleOps, parseArticleOps, type ArticleOp } from "../generation/article/edit";
import { applyWorkOps, parseWorkOps, type WorkOp } from "../generation/work/edit";
import { applyTeacherOps, parseTeacherOps, type TeacherOp } from "../generation/teacher/edit";
import { TEACHER_TOOL_LIST } from "../generation/teacher/types";
import { renderDocx } from "../generation/render-docx";
import { renderPptx } from "../generation/render-pptx";
import { renderPptxWithTemplate } from "../generation/render-pptx-template";
import { getTemplate } from "./template-upload";
import { ApiError } from "./api";
import { imageYieldField, type FitField } from "../generation/slide-quality";
import { buildSlideDeck } from "../generation/slides";
import type { ImageBytes } from "../generation/slide-images";
import type { SlideModel } from "../generation/slide-types";
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
  id: "slide" | "resume" | "article" | "work" | "essay" | "teacher";
  /** Shu adapter xizmat qiladigan vositalar (`generations.tool_id`). */
  tools: ReadonlySet<string>;
  /** Hujjatda tahrir uchun kerakli model bormi (yo'q bo'lsa 409 `legacy`). */
  hasModel: (doc: AcademicDoc | null | undefined) => boolean;
  /** Tahrirdan OLDIN hujjatni normal holatga keltiradi (eski format → model). */
  prepare: (doc: AcademicDoc) => AcademicDoc;
  parse: (raw: unknown) => ParseResult;
  apply: (doc: AcademicDoc, ops: unknown[], ctx: { genId: string }) => ApplyResult;
  /**
   * `apply` dan KEYINGI, faqat serverda ishlaydigan tekshiruv (ixtiyoriy):
   * `before` — bazadagi hujjat, `after` — op lar qo'llangani. Rad etsa
   * `ApiError` tashlaydi va `commitDocOps` hech narsa yozmaydi. Sabab —
   * `apply` izomorf (klient bundle ham shu kodni ishlatadi), serverga xos
   * og'ir predikatlar (`slide-quality.ts`) esa u yerga kira olmaydi.
   */
  guard?: (before: AcademicDoc, after: AcademicDoc, ops: unknown[]) => void;
  render: (ctx: RenderCtx, deps: RebuildDeps) => Promise<RenderedFile>;
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Rasm tasmasi bilan matn qutidan chiqadigan slayd — foydalanuvchiga ko'rinadigan xabar. */
export const TEXT_TOO_LONG_FOR_IMAGE = "Matn rasm bilan sig‘maydi — avval matnni qisqartiring";

/**
 * Slaydning «rasm bilan sig'adimi» holatini belgilaydigan matni — AYNAN
 * `imageYieldField` o'qiydigan maydonlar (maket + quti matnlari; ortig'i
 * zarar qilmaydi, faqat ko'proq slayd tekshiriladi). Sarlavha, izoh,
 * shrift/o'lcham, kolontitul, rasm URL i bu yerda YO'Q: ular sig'ishni
 * o'zgartirmaydi. `imageYieldField` ga yangi maydon qo'shilsa — shu
 * ro'yxatga ham (aks holda o'sha maydon tahriri «o'zgarmagan» deb
 * o'tib ketadi; `tests/slide-image-edit.test.mts` INT-03 bloki).
 */
function yieldText(s: SlideModel): string {
  return JSON.stringify([s.layout, s.bullets, s.left, s.right, s.steps, s.stats, s.table, s.quote, s.subtitle]);
}

/**
 * «Matn rasmdan ustun» qoidasining YAGONA server nuqtasi (AUDIT-25 INT-03).
 *
 * Matn va rasm to'rt yo'l bilan uchrashadi: yuklash, rasmli slaydga matn
 * yozish (`text`/`list`/`set`/`layout`), «Rasmni qaytarish»
 * (`imageRestore`) va avvalgi aktivni `image` op bilan qayta qo'yish.
 * Ilgari faqat birinchisi tekshirilardi (`uploadSlideImage`). Endi
 * hammasi `commitDocOps` → `slideAdapter.guard` → shu funksiyadan o'tadi.
 *
 * QOIDA (eng kam kutilmagan): op lardan keyingi har RASMLI slayd
 * tekshiriladi, BUNDAN MUSTASNO — uning ASL slaydi (`slideOrigins`) ham
 * rasmli edi VA quti matni (`yieldText`) o'zgarmagan. Ya'ni:
 *
 *   - tegilmagan slayd (joyi `reorder`/`delete`/`add` bilan surilgan bo'lsa
 *     ham) tekshirilmaydi — eski dekalarda oldindan sig'maydigan rasmli
 *     slayd boshqa tahrirni BLOKLAMAYDI (AUDIT-25-OLDDECKS);
 *   - quti matniga tegmaydigan tahrir (sarlavha, izoh, shrift, kolontitul)
 *     ham tekshirilmaydi;
 *   - rasmi BOR slaydda rasmni ALMASHTIRISH (yuklash yoki `image` op),
 *     matn o'zgarmagan bo'lsa — qabul: matn va rasm yonma-yon allaqachon
 *     turgan edi, almashtirish hech narsani yomonlashtirmaydi (P8 R3);
 *   - rasmsiz slaydga rasm qo'yish (`image`/`imageRestore`), rasmli slayd
 *     matnini o'zgartirish (`text`/`list`/`set`/`layout`) yoki ikkalasi,
 *     hamda YANGI kelgan rasmli slayd (`insert` — undo) — `imageYieldField`
 *     bilan tekshiriladi.
 *
 * Qaytaradi: birinchi sig'maydigan slayd indeksi va maydoni yoki `null`.
 * Deka qoidasi va vizuali `buildSlideDeck` dan — op lar ularni
 * o'zgartirmaydi (meta va shablon tahrirlanmaydi).
 */
export function imageTextOverflow(before: AcademicDoc, after: AcademicDoc, ops: readonly DocOp[]): { index: number; field: FitField } | null {
  const slides = after.slides ?? [];
  if (!slides.some((s) => s.image)) return null;
  const prev = before.slides ?? [];
  const origin = slideOrigins(prev.length, ops, slides.length);
  const deck = buildSlideDeck(after);
  for (let index = 0; index < slides.length; index++) {
    const s = slides[index];
    if (!s.image) continue;
    const o = origin?.[index];
    const was = o == null ? undefined : prev[o];
    if (was?.image && yieldText(was) === yieldText(s)) continue;
    const field = imageYieldField(s, deck.bodyType, deck.visual);
    if (field) return { index, field };
  }
  return null;
}

/**
 * Natijadagi har slayd ASL hujjatning qaysi slaydidan kelgani (yangi —
 * `null`). Faqat tuzilmani o'zgartiradigan op lar (`add`/`delete`/
 * `insert`/`reorder`) — `applyDocOps` dagi bilan AYNAN bir xil indeks
 * ma'nosi; op lar `apply` dan muvaffaqiyatli o'tgani uchun indekslar
 * yaroqli. Qolgan op lar slaydni JOYIDA o'zgartiradi — kelib chiqishi
 * saqlanadi, o'zgargani esa `yieldText` bilan aniqlanadi.
 *
 * Uzunlik natija bilan mos kelmasa (bu modul va `applyDocOps` ajralib
 * ketgan bo'lsa) — `null`: hamma rasmli slayd tekshiriladi. Ya'ni xato
 * tomoni XAVFSIZ — sig'maslik o'tib ketmaydi, faqat eski dekada ortiqcha
 * rad bo'lishi mumkin.
 */
function slideOrigins(n: number, ops: readonly DocOp[], expected: number): (number | null)[] | null {
  let o: (number | null)[] = Array.from({ length: n }, (_, i) => i);
  for (const op of ops) {
    switch (op.op) {
      case "add":
        o = [...o.slice(0, op.after + 1), null, ...o.slice(op.after + 1)];
        break;
      case "delete":
        o = o.filter((_, i) => i !== op.index);
        break;
      case "insert":
        o = [...o.slice(0, op.index), null, ...o.slice(op.index)];
        break;
      case "reorder":
        o = op.order.map((k) => o[k] ?? null);
        break;
    }
  }
  return o.length === expected ? o : null;
}

export const slideAdapter: EditAdapter = {
  id: "slide",
  tools: new Set(["slide", "pro-slide"]),
  hasModel: (doc) => Boolean(doc?.slides?.length),
  prepare: (doc) => doc,
  parse: (raw) => parseDocOps(raw),
  apply: (doc, ops, ctx) => applyDocOps(doc, ops as DocOp[], ctx),
  /*
   * Butun PATCH rad etiladi (bitta slayd emas): op lar atomar, qisman yozuv
   * yo'q. 400 `text_too_long` — ko'ruvchi xabarni ko'rsatadi, hujjatni
   * qayta yuklaydi (`useDocEdit.settleFailure`).
   */
  guard(before, after, ops) {
    const bad = imageTextOverflow(before, after, ops as DocOp[]);
    if (bad) throw new ApiError(TEXT_TOO_LONG_FOR_IMAGE, 400, { code: "text_too_long", index: bad.index, field: bad.field });
  },
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

/**
 * Maqola (Maqola 2, AUDIT-17 WP7). Eski maqola (`doc.article` yo'q) ham
 * tahrirlanadi — `applyArticleOps` unda faqat matn op larini o'tkazadi,
 * shu sababli `prepare` hech narsa qilmaydi (rezyumedan farqi: modelga
 * «ko'tarish» yo'q, `legacyArticleModel` faqat o'qish uchun).
 *
 * Render — `renderDocx`: sxema PNG lari `resolveImage` (SHU
 * generatsiyaning aktivlari) orqali qayta o'qiladi, ya'ni tahrirdan
 * keyingi DOCX da `<w:drawing>` saqlanadi.
 */
export const articleAdapter: EditAdapter = {
  id: "article",
  tools: new Set(["article", "thesis"]),
  hasModel: (doc) => Boolean(doc?.sections?.length),
  prepare: (doc) => doc,
  parse: (raw) => parseArticleOps(raw),
  apply: (doc, ops, ctx) => applyArticleOps(doc, ops as ArticleOp[], ctx),
  async render(ctx) {
    const bytes = await renderDocx(ctx.doc, { resolveImage: ctx.resolveImage });
    return { bytes, mime: DOCX_MIME, fileName: ctx.fileName };
  },
};

/**
 * TALABA ISHI (AUDIT-19 WP-C): kurs ishi, referat, mustaqil ish.
 *
 * Maqola adapteridan farqi ikkita: op tili (`work/edit.ts` — annotatsiya/
 * kalit so'z yo'q, bob daraxti bor) va MODEL TALABI. Eski talaba ishi
 * (`doc.work` yo'q) tahrirlanmaydi: uning matni bob/paragraf id lariga
 * ega emas, ya'ni op yo'llari («sections.3.blocks.1») boshqa hujjatga
 * tegib ketishi mumkin edi. Bunday hujjat 409 `legacy` bilan qaytadi va
 * ko'ruvchi tahrirsiz, avvalgidek ishlaydi (`prepare` hech narsa qilmaydi
 * — «modelga ko'tarish» yo'q).
 *
 * Render — `renderDocx`: sxema PNG lari `resolveImage` (SHU
 * generatsiyaning aktivlari) orqali qayta o'qiladi.
 */
export const workAdapter: EditAdapter = {
  id: "work",
  tools: new Set(["coursework", "referat", "mustaqil-ish"]),
  hasModel: (doc) => Boolean(doc?.work && doc.sections?.length),
  prepare: (doc) => doc,
  parse: (raw) => parseWorkOps(raw),
  apply: (doc, ops, ctx) => applyWorkOps(doc, ops as WorkOp[], ctx),
  async render(ctx) {
    const bytes = await renderDocx(ctx.doc, { resolveImage: ctx.resolveImage });
    return { bytes, mime: DOCX_MIME, fileName: ctx.fileName };
  },
};

/**
 * Insho (Talaba ishlari 2, AUDIT-19 WP-E1).
 *
 * Op tili — maqolaniki (`article/edit.ts`), lekin uning QISMI: insho
 * `doc.essay` bilan keladi, `doc.article` siz, shuning uchun
 * `applyArticleOps` unda faqat matn op larini + `setSection` + server
 * yozadigan `review` ni o'tkazadi (`ESSAY_OPS`). Alohida op tili
 * yozilmadi — tahrir qilinadigan narsa AYNAN bir xil: bo'lim bloklari.
 *
 * `hasModel` — `sections.length`: eski insho (`writeEssayWithLlm`
 * yozgan, `doc.essay` siz) ham tahrirlanadi, `applyArticleOps` uni
 * `LEGACY_OPS` bilan qabul qiladi.
 */
export const essayAdapter: EditAdapter = {
  id: "essay",
  tools: new Set(["essay"]),
  hasModel: (doc) => Boolean(doc?.sections?.length),
  prepare: (doc) => doc,
  parse: (raw) => parseArticleOps(raw),
  apply: (doc, ops, ctx) => applyArticleOps(doc, ops as ArticleOp[], ctx),
  async render(ctx) {
    const bytes = await renderDocx(ctx.doc, { resolveImage: ctx.resolveImage });
    return { bytes, mime: DOCX_MIME, fileName: ctx.fileName };
  },
};

/**
 * O'QITUVCHI HUJJATLARI (AUDIT-20 WP-D): dars rejasi, texnologik
 * xarita, glossariy, keys, test — BESHALASI bitta adapterda.
 *
 * Beshta vosita bitta op tilini baham ko'radi, chunki tahrir
 * qilinadigan narsa ularda BIR XIL shaklda: `planTeacher` bergan
 * bandlar (nasr bloki, jadval katagi, model maydoni). Farq — kind
 * modeli, u esa op tilida emas, YO'LDA (`teacher.lesson.…` va
 * `teacher.test.…`), ya'ni alohida adapter beshta deyarli aynan
 * nusxani keltirardi.
 *
 * Vositalar ro'yxati `TEACHER_TOOL_IDS` dan (`types.ts`) — reyestr
 * YAGONA manba: yangi o'qituvchi vositasi qo'shilganda bu yer
 * o'z-o'zidan to'g'ri qoladi.
 *
 * ESKI hujjat (`doc.teacher` yo'q) tahrirlanmaydi: `legacyTeacherModel`
 * modelni meta'dan TAXMIN qiladi va `teacher.lesson.stages.2.teacher`
 * yo'li boshqa maydonga tegib ketishi mumkin edi — 409 `legacy`
 * (`work/edit.ts` dagi bilan bir xil qaror).
 *
 * Render — `renderDocx`: OMR PNG i `resolveImage` (SHU generatsiyaning
 * aktivlari) orqali qayta o'qiladi.
 */
export const teacherAdapter: EditAdapter = {
  id: "teacher",
  tools: new Set<string>(TEACHER_TOOL_LIST),
  hasModel: (doc) => Boolean(doc?.teacher && doc.sections?.length),
  prepare: (doc) => doc,
  parse: (raw) => parseTeacherOps(raw),
  apply: (doc, ops, ctx) => applyTeacherOps(doc, ops as TeacherOp[], ctx),
  async render(ctx) {
    const bytes = await renderDocx(ctx.doc, { resolveImage: ctx.resolveImage });
    return { bytes, mime: DOCX_MIME, fileName: ctx.fileName };
  },
};

/** Bitta so'rovdagi operatsiyalar soni — barcha op tillari uchun bir xil. */
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

const ADAPTERS: EditAdapter[] = [slideAdapter, resumeAdapter, articleAdapter, workAdapter, essayAdapter, teacherAdapter];

/** Vosita uchun adapter; tahrirlanmaydigan vositada `null`. */
export function adapterFor(toolId: string): EditAdapter | null {
  return ADAPTERS.find((a) => a.tools.has(toolId)) ?? null;
}

/** Tahrirlanadigan barcha vositalar — testlar va diagnostika uchun. */
export function editableTools(): string[] {
  return ADAPTERS.flatMap((a) => [...a.tools]);
}
