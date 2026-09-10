import "server-only";
import { ApiError, readJson } from "./api";
import { transaction } from "./db";
import {
  getGeneration,
  getGenerationForEdit,
  getGenerationForRestore,
  getVersions,
  markFileVersion,
  restoreGenerationDoc,
  updateGenerationDoc,
} from "./jobs";
import { assetImageResolver } from "./assets";
import { buildPreview } from "./preview";
import { hasGenerationFile, putGenerationFile } from "./storage";
import { applyDocOps, parseDocOps } from "../generation/slide-edit";
import type { DocOp } from "../generation/slide-edit";
import { renderHtml } from "../generation/render-html";
import { renderPptx } from "../generation/render-pptx";
import { renderPptxWithTemplate } from "../generation/render-pptx-template";
import { getTemplate } from "./template-upload";
import type { AcademicDoc } from "../generation/types";
import type { JobStatus } from "../types";

/**
 * Tahrir serverining YADROSI (E4).
 *
 * Route'lar (`doc`, `rebuild`, `file`) atayin YUPQA: ular faqat
 * autentifikatsiya (`requireUser`), rate limit va id shaklini
 * tekshiradi, qolgan hamma narsa shu modulda. Sabab `tests/logo.test.mts`
 * dagi bilan bir xil — Next.js `cookies()` faqat so'rov konteksti ICHIDA
 * ishlaydi, shuning uchun route funksiyasining o'zini testdan chaqirib
 * bo'lmaydi; sessiyadan ajratilgan funksiyani esa haqiqiy `Request`
 * bilan chaqirsa bo'ladi va route AYNAN shuni chaqiradi.
 *
 * Uchta qat'iy qoida bu yerda saqlanadi:
 *
 *   1) **Egalik va holat SQL predikatida.** `getGenerationForEdit`
 *      `WHERE id = $1 AND user_id = $2`, yozish esa `updateGenerationDoc`
 *      `AND status = 'COMPLETED' AND doc_version = $6` bilan. Route
 *      darajasidagi tekshiruv YETARLI EMAS deb hisoblanadi (`CLAUDE.md`).
 *   2) **PATCH atomar.** `applyDocOps` yiqilsa (422) bazaga hech narsa
 *      yozilmaydi; `doc_version` mos kelmasa (409) ham.
 *   3) **Eskirgan fayl HECH QACHON berilmaydi.** `GET …/file`
 *      `file_version < doc_version` bo'lsa avval qayta yasaydi, va
 *      render yiqilsa bayt ham, `file_version` ham o'zgarmaydi.
 */

/** Tahrir qilinadigan vositalar. Boshqa vosita hujjatida `doc.slides` yo'q. */
const EDIT_TOOLS = new Set(["slide", "pro-slide"]);

/** `PATCH …/doc` tanasining chegarasi — 50 op × 4000 belgi + zaxira. */
export const DOC_PATCH_MAX_BYTES = 300 * 1024;

export type EditableGeneration = {
  doc: AcademicDoc & { slides: NonNullable<AcademicDoc["slides"]> };
  docVersion: number;
  fileVersion: number;
  imageRedraws: number;
  toolId: string;
  fileName: string;
  topic: string;
  status: JobStatus;
};

/**
 * Tahrir uchun hujjatni oladi va uch xil «yo'q» ni ajratadi:
 *
 *   - qator yo'q **yoki begona** → 404 (egalik SQL da — begona id bilan
 *     kelgan so'rov 403 emas, 404 oladi: hujjat borligi ham oshkor
 *     bo'lmasin);
 *   - hali tayyor emas (`QUEUED`/`IN_PROGRESS`/`FAILED`) → 409 `status`;
 *   - slayd vositasi emas yoki `doc.slides` yo'q (eski deka) → 409 `legacy`.
 */
export async function loadDocForEdit(id: string, userId: string): Promise<EditableGeneration> {
  const row = await getGenerationForEdit(id, userId);
  if (!row) throw new ApiError("Topilmadi", 404);
  if (row.status !== "COMPLETED") {
    throw new ApiError("Hujjat hali tayyor emas", 409, { code: "status", status: row.status });
  }
  if (!EDIT_TOOLS.has(row.toolId) || !row.doc?.slides?.length) {
    throw new ApiError("Bu hujjat eski formatda — tahrirlash uchun qaytadan yarating", 409, {
      code: "legacy",
    });
  }
  return { ...row, doc: row.doc as EditableGeneration["doc"] };
}

/** Javob shakli `GET /api/generations/{id}` bilan AYNAN bir xil (`GenerationDetail`). */
async function detail(id: string, userId: string) {
  const gen = await getGeneration(id, userId);
  if (!gen) throw new ApiError("Topilmadi", 404);
  const hasFile = await hasGenerationFile(id, userId);
  return { ...gen, hasFile };
}

/**
 * Operatsiyalarni qo'llaydi va yozadi.
 *
 * `baseVersion` ni oldindan solishtirish faqat TEZ yo'l — haqiqiy qulf
 * `updateGenerationDoc` ning `doc_version = $6` predikatida: ikki tab
 * bir vaqtda yozsa, ikkinchisi 0 qator yangilaydi va 409 oladi.
 * Shuning uchun bu yerdagi solishtirishni olib tashlash xavfsizlikni
 * buzmaydi, SQL shartini olib tashlash esa BUZADI.
 *
 * `html` va `preview` doc bilan BIR TRANZAKSIYADA yoziladi — aks holda
 * ko'ruvchi yangi dokni, ro'yxat kartochkasi esa eski matnni ko'rsatardi.
 */
export async function commitDocOps(id: string, userId: string, baseVersion: number, ops: DocOp[]) {
  const cur = await loadDocForEdit(id, userId);
  if (baseVersion !== cur.docVersion) {
    throw new ApiError("Hujjat boshqa joyda o'zgargan — yangilab qayta urinib ko'ring", 409, {
      code: "version",
      docVersion: cur.docVersion,
    });
  }

  const applied = applyDocOps(cur.doc, ops, { genId: id });
  if (!applied.ok) throw new ApiError(applied.error, 422, { at: applied.at });
  const doc = applied.doc;

  // Render TRANZAKSIYADAN OLDIN: sof funksiyalar, ulanishni ushlab
  // turishning hojati yo'q.
  const html = renderHtml(doc);
  const preview = buildPreview(doc);

  const next = await transaction((client) =>
    // `doc_version = 0` — hujjatning ILK tahriri: `doc_prev` shu paytdagi
    // (hali tahrirlanmagan) dokni saqlab qoladi, «Asl holatga qaytarish»
    // shuni o'qiydi (`014_doc_prev.sql`).
    updateGenerationDoc(client, id, userId, baseVersion, { doc, html, preview }, { keepPrev: cur.docVersion === 0 }),
  );
  if (next == null) {
    // 0 qator: versiya oshib ketgan, egalik yo'qolgan yoki status
    // `COMPLETED` emas. Klientga eng yangi versiyani beramiz — u shu
    // bilan qayta yuklab, steklarini tozalaydi.
    const fresh = await getGenerationForEdit(id, userId);
    throw new ApiError("Hujjat boshqa joyda o'zgargan — yangilab qayta urinib ko'ring", 409, {
      code: "version",
      docVersion: fresh?.docVersion ?? cur.docVersion,
    });
  }
  return detail(id, userId);
}

/**
 * Dekani BIRINCHI tahrirdan OLDINGI holatga qaytaradi («Asl holatga
 * qaytarish»). `baseVersion` qabul qilmaydi — bitta tugma, keyingi
 * bosishlar oxirgi `doc_prev`ga baribir qaytaradi (u `commitDocOps`da
 * bir marta yozilgach o'zgarmaydi).
 *
 * `doc_prev` yo'q bo'lsa (hech qachon tahrirlanmagan yoki eski qator) —
 * 409 `{code:"no_prev"}`. Render (`renderHtml`/`buildPreview`) TRANZAKSIYADAN
 * OLDIN — `commitDocOps` bilan bir xil sabab (sof funksiya, ulanish
 * ushlab turilmaydi).
 */
export async function restoreDoc(id: string, userId: string) {
  const pre = await getGenerationForRestore(id, userId);
  if (!pre) throw new ApiError("Topilmadi", 404);
  if (pre.status !== "COMPLETED") {
    throw new ApiError("Hujjat hali tayyor emas", 409, { code: "status", status: pre.status });
  }
  if (!pre.docPrev) throw new ApiError("Asl holat saqlanmagan", 409, { code: "no_prev" });

  const html = renderHtml(pre.docPrev);
  const preview = buildPreview(pre.docPrev);

  const next = await transaction((client) => restoreGenerationDoc(client, id, userId, { html, preview }));
  if (next == null) {
    // Shu ikki so'rov orasida `status` COMPLETED bo'lmay qoldi yoki
    // (nazariy) `doc_prev` NULL bo'lib qoldi — SQL predikati qaytadan
    // tekshiradi, chaqiruvchiga 409 aynan shu sabab bilan qaytadi.
    throw new ApiError("Asl holatni qaytarib bo'lmadi — qaytadan urinib ko'ring", 409, { code: "no_prev" });
  }
  return detail(id, userId);
}

export type RebuildResult = { fileVersion: number; docVersion: number; rebuilt: boolean };

/**
 * Render seami — standarti `renderPptx`.
 *
 * Test uchun kerak: `renderPptx` PPTX ni haqiqatan yasaydi (sekin) va
 * uni ATAYLAB yiqitib bo'lmaydi, holbuki eng muhim kafolat aynan shu —
 * «render yiqilsa bazaga hech narsa yozilmaydi». Route'lar bu
 * parametrni HECH QACHON bermaydi, ya'ni ishlab turgan yo'l bitta.
 */
export type RebuildDeps = { render?: typeof renderPptx };

/**
 * PPTX ni joriy `doc` dan qayta yasaydi.
 *
 * Tartib QAT'IY:
 *
 *   1) `file_version >= doc_version` → hech narsa qilinmaydi (klient
 *      debounce dan keyin ortiqcha chaqirsa ham render qilinmaydi);
 *   2) `renderPptx` — TRANZAKSIYADAN TASHQARIDA (bir necha soniya davom
 *      etadi; ulanishni shuncha ushlab turish hovuzni quritardi);
 *   3) tranzaksiya ichida `pg_advisory_xact_lock` → `markFileVersion`
 *      (`file_version < $3` predikati bilan) → `putGenerationFile`.
 *
 * Render yiqilsa (2) da xato tashlanadi va bazaga HECH NARSA yozilmaydi
 * — eski, lekin butun fayl joyida qoladi.
 *
 * Advisory lock parallel ikki rebuild ni ketma-ket qo'yadi; `file_version
 * < $3` esa sekinroq tugagan ESKI render yangisini orqaga surmasligini
 * ta'minlaydi (bunda bayt ham yozilmaydi).
 */
export async function rebuildFile(
  id: string,
  userId: string,
  deps: RebuildDeps = {},
): Promise<RebuildResult> {
  const cur = await loadDocForEdit(id, userId);
  if (cur.fileVersion >= cur.docVersion) {
    return { fileVersion: cur.fileVersion, docVersion: cur.docVersion, rebuilt: false };
  }
  const target = cur.docVersion;

  const render = deps.render ?? renderPptx;
  // Rasm faqat SHU generatsiyaning aktivlaridan olinadi (egalik SQL
  // da, `getAsset`) — tashqi URL yuklanmaydi, ya'ni SSRF yo'q.
  const resolveImage = assetImageResolver(id, userId);
  // «O'z shablonim»: namuna bayti hali bazada bo'lsa — o'sha yo'l; o'chirilgan
  // bo'lsa ichki renderer (deka yo'qolmaydi, faqat ko'rinishi o'zgaradi).
  const custom = cur.doc.customTemplate ? await getTemplate(userId, cur.doc.customTemplate.assetId).catch(() => null) : null;
  const built = custom
    ? await renderPptxWithTemplate(cur.doc, cur.fileName, custom.bytes, custom.template.profile, { resolveImage })
    : await render(cur.doc, cur.fileName, { resolveImage });

  const written = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [id]);
    const v = await markFileVersion(client, id, userId, target);
    if (v == null) return null;
    await putGenerationFile(
      id,
      { bytes: built.bytes, mime: built.mime, fileName: built.fileName },
      client,
    );
    return v;
  });

  if (written == null) {
    const v = await getVersions(id, userId);
    return {
      fileVersion: v?.fileVersion ?? cur.fileVersion,
      docVersion: v?.docVersion ?? target,
      rebuilt: false,
    };
  }
  return { fileVersion: written, docVersion: target, rebuilt: true };
}

/**
 * `GET …/file` uchun: eskirgan faylni bermaslik kafolati.
 *
 * Slayd bo'lmagan vositalarda `doc_version` ham, `file_version` ham 0 —
 * shart hech qachon bajarilmaydi va eski yo'l o'zgarmaydi.
 */
export async function ensureFreshFile(
  id: string,
  userId: string,
  deps: RebuildDeps = {},
): Promise<void> {
  const v = await getVersions(id, userId);
  if (!v) return; // Yo'q yoki begona — 404 ni fayl yo'lining o'zi beradi.
  if (v.status !== "COMPLETED") return;
  if (!EDIT_TOOLS.has(v.toolId)) return;
  if (v.fileVersion >= v.docVersion) return;
  await rebuildFile(id, userId, deps);
}

/**
 * `PATCH …/doc` tanasi → `commitDocOps`.
 *
 * Shakl xatosi 400 (bu yerda), mazmun xatosi 422 (`applyDocOps`),
 * hajm 413 (`readJson`) — API jadvalidagi taqsimot aynan shunday.
 */
export async function patchDocFromRequest(req: Request, id: string, userId: string) {
  const body = await readJson<Record<string, unknown>>(req, DOC_PATCH_MAX_BYTES);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("So'rov tanasi obyekt bo'lishi kerak", 400);
  }
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) {
    throw new ApiError("«baseVersion» yaroqsiz", 400);
  }
  const parsed = parseDocOps(body.ops);
  if (!parsed.ok) throw new ApiError(parsed.error, 400);
  return commitDocOps(id, userId, baseVersion, parsed.ops);
}
