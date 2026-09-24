import "server-only";
import { ApiError } from "./api";
import { commitDocOps } from "./slide-commit";
import { transaction } from "./db";
import { getGeneration, getGenerationForEdit, markFileVersion, updateGenerationDoc } from "./jobs";
import { hasGenerationFile, putGenerationFile } from "./storage";
import { adapterFor, type EditAdapter } from "./edit-adapters";
import { assetImageResolver } from "./assets";
import { buildPreview } from "./preview";
import { renderDocx } from "../generation/render-docx";
import { renderHtml } from "../generation/render-html";
import type { ArticleOp } from "../generation/article/edit";
import { planPolish, runPolish } from "../generation/article/polish";
import { planEssayPolish, runEssayPolish } from "../generation/essay/polish";
import { planWorkPolish, runWorkPolish } from "../generation/work/polish";
import { planTeacherPolish, runTeacherPolish } from "../generation/teacher/polish";
import { teacherOpsFromPolish } from "../generation/teacher/edit";
import { essaySection } from "../generation/essay/review";
import { planCrosswordPolish, runCrosswordPolish } from "../generation/games/crossword/polish";
import { planFlashcardsPolish, runFlashcardsPolish } from "../generation/games/flashcards/polish";
import { planInfographicPolish, runInfographicPolish } from "../generation/infographic/polish";
import { isGameToolId } from "../generation/games/types";
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

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * FAYLNI qayta yasash (adaptersiz oilalar).
 *
 * `doc`/`html` qaytarilsa ular yozilganini almashtiradi — plakatda
 * eskiz (`doc.images[0]`) va html aynan shu chizishdan keladi.
 */
export type RebuiltFile = { bytes: Uint8Array; mime: string; html?: string; doc?: AcademicDoc };
export type RebuildFileFn = (doc: AcademicDoc, ctx: { id: string; userId: string }) => Promise<RebuiltFile | null>;

/**
 * O'YIN → DOCX. `teacherAdapter.render` bilan aynan bir xil chaqiruv;
 * alohida yozilgan, chunki o'yinlarda tahrir adapteri YO'Q (`rebuildFile`
 * marshruti ham shuning uchun ishlamaydi va fayl SHU YERDA yangilanadi).
 * To'r PNG lari `assetImageResolver` orqali — faqat SHU generatsiyaning
 * aktivlaridan (SSRF/IDOR yo'q).
 */
export const renderGameFile: RebuildFileFn = async (doc, ctx) => ({
  bytes: await renderDocx(doc, { resolveImage: assetImageResolver(ctx.id, ctx.userId) }),
  mime: DOCX_MIME,
});

/**
 * PLAKAT → PNG + html, dvigatelning O'Z chizuvchisi bilan (ikkinchi
 * chizish kodi «ekranda bitta xil, faylda boshqa xil» ni qaytarardi).
 * Import DINAMIK: dvigatel `sharp`/librsvg ni tortadi va uni modul
 * boshida yuklash o'yin sayqalini ham shunga bog'lardi.
 */
export const renderPosterFile: RebuildFileFn = async (doc) => {
  const spec = doc.infographic?.spec;
  if (!spec) return null;
  const m = await import("../generation/infographic/engine");
  const drawn = await m.renderPoster(spec);
  if (!drawn) return null;
  return { bytes: drawn.file.bytes, mime: drawn.file.mime, html: m.posterHtml(spec, drawn.preview), doc: { ...doc, images: [drawn.preview] } };
};

export type PolishDeps = {
  /** Test seam — rol bo'yicha LLM. */
  complete?: typeof completeRole;
  deadline?: number;
  now?: Date;
  /**
   * Test seam — faylni qayta yasash (o'yin DOCX i, plakat PNG i).
   * Standarti oila jadvalida (`POLISHERS[…].rebuild`); testlar buni
   * berib, `sharp`/`docx` ni chaqirmaydi.
   */
  rebuildFile?: RebuildFileFn;
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
  toOps?: (r: PolishRun) => ArticleOp[];
  /**
   * TAHRIR ADAPTERI YO'Q hujjat turlari (o'yin, plakat — AUDIT-21 WP-D).
   *
   * Ular uchun `toOps` ma'nosiz: op larni QAYTA qo'llaydigan adapter yo'q
   * (va ataylab qo'shilmagan — o'yinni «tahrirlash» to'rni buzardi).
   * Sayqal natijasi allaqachon TO'LIQ hujjat (`runPolishWith` `apply` ni
   * o'zi chaqirgan: krossvordda `applyClueOps` bo'lim + model, kartada
   * `applyCardsOps` model + `cards` bo'limi), shuning uchun bu yerda
   * faqat hisobot/jurnal modelga yoziladi va hujjat BUTUNICHA saqlanadi.
   */
  docOf?: (r: PolishRun) => AcademicDoc;
  /** `docOf` li turlarda saqlanadigan `html` (standart — `renderHtml`; `null` — eskisi qoladi). */
  htmlOf?: (doc: AcademicDoc) => string | null;
  /**
   * Qabul qilingan sayqaldan keyin FAYL ham qayta yasaladi (o'yin DOCX i,
   * plakat PNG i). `null` — yasab bo'lmadi: hujjat ham YOZILMAYDI (422
   * `render`), aks holda ekranda yangi matn, faylda eskisi qolardi.
   */
  rebuild?: RebuildFileFn;
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

/**
 * BOSMA O'YINLAR (AUDIT-21 WP-D): krossvord va flesh kartalar.
 *
 * Ikkalasi BITTA qatorda, chunki farq faqat `doc.game.kind` da: hisobot
 * ham, model ham, «Sizdan kutiladi» ham `doc.game` ichida turadi
 * (`teacher` beshta vositani bitta adapterda ushlagani bilan ayni
 * sabab). Reja/sayqal esa kind bo'yicha ajraladi.
 *
 * TAHRIR YO'Q: `edit-adapters.ts` ga adapter QO'SHILMAGAN — so'z yoki
 * karta qo'lda o'zgarsa to'r (kesishma, raqamlash, javob varag'i) va
 * A7 panjarasi hujjat bilan ajralib ketardi. Shuning uchun natija
 * sahifasida «Tahrirlash» ko'rinmaydi, «Hammasini tuzatish» esa
 * ishlaydi: sayqal FAQAT ta'rif/karta matnini almashtiradi va to'rga
 * tegmaydi (`applyClueOps` buni tekshiradi).
 */
POLISHERS.game = {
  review: (doc) => doc.game?.review,
  hasModel: (doc) => Boolean(doc.game?.crossword || doc.game?.cards),
  planned: (review, doc) => (doc.game?.kind === "crossword" ? planCrosswordPolish(review).fixes.length : planFlashcardsPolish(review, doc).fixes.length),
  run: (doc, review, deps) =>
    doc.game?.kind === "crossword"
      ? runCrosswordPolish(doc, review, { complete: deps.complete, deadline: deps.deadline, now: deps.now, judge: true })
      : runFlashcardsPolish(doc, review, { complete: deps.complete, deadline: deps.deadline, now: deps.now, judge: true }),
  docOf: (r) => (r.doc.game ? { ...r.doc, game: { ...r.doc.game, review: r.review, polish: r.log, userNeeds: r.review.userNeeds ?? [] } } : r.doc),
  rebuild: renderGameFile,
};

/**
 * INFOGRAFIKA (AUDIT-21 WP-D) — YAGONA joy, unda sayqal FAYLNI ham
 * qayta yasaydi.
 *
 * Boshqa oilalarda fayl `doc` dan keyin, alohida `rebuild` marshrutida
 * yasaladi (`file_version < doc_version` → `rebuildFile`). Plakatda
 * bunday marshrut YO'Q: `rebuildFile` tahrir adapteridan render so'raydi,
 * adapter esa yo'q. Shuning uchun yangi PNG shu yerda, hujjat bilan
 * BITTA tranzaksiyada yoziladi (`rebuildFile` ning advisory-lock naqshi
 * kerak emas: `doc_version` qulfi allaqachon bitta yozuvchini o'tkazadi).
 *
 * Chizish yiqilsa hujjat ham yozilmaydi — 422 `render`. Aks holda
 * spetsifikatsiya yangi, chop etiladigan plakat esa eski bo'lib qolardi.
 */
POLISHERS.infographic = {
  review: (doc) => doc.infographic?.review,
  hasModel: (doc) => Boolean(doc.infographic?.spec),
  planned: (review, doc) => planInfographicPolish(review, doc).fixes.length,
  run: (doc, review, deps) =>
    runInfographicPolish(doc, review, {
      complete: deps.complete,
      deadline: deps.deadline,
      now: deps.now,
      judge: true,
      want: doc.infographic?.spec.blocks.length,
    }),
  docOf: (r) => (r.doc.infographic ? { ...r.doc, infographic: { ...r.doc.infographic, review: r.review, polish: r.log, userNeeds: r.review.userNeeds ?? [] } } : r.doc),
  /*
   * Plakat html i dvigatelda yasaladi va `rebuild` bilan birga qaytadi;
   * sayqal rad etilsa hujjat MATNI o'zgarmaydi (faqat hisobot), ya'ni
   * eski html saqlanadi — `null` aynan shuni bildiradi.
   */
  htmlOf: () => null,
  rebuild: renderPosterFile,
};

export function polishableAdapters(): string[] {
  return Object.keys(POLISHERS);
}

/**
 * Vosita → sayqal qatori. Tahrirlanadigan hujjatlarda bu ADAPTER id si
 * (bitta adapter = bitta sayqal oilasi), tahrirsizlarida esa oilaning
 * o'z nomi: `game` (krossvord/kartalar) va `infographic`.
 */
export function polisherIdFor(toolId: string): string | null {
  const adapter = adapterFor(toolId);
  if (adapter) return adapter.id;
  if (isGameToolId(toolId)) return "game";
  if (toolId === "infographic") return "infographic";
  return null;
}

export type PolishTarget = {
  doc: AcademicDoc;
  docVersion: number;
  fileName: string;
  toolId: string;
  /** Sayqal oilasi: adapter id si yoki `game`/`infographic`. */
  polisherId: string;
  /** Tahrirlanadigan hujjatlarda — adapter; o'yin/plakatda `null`. */
  adapter: EditAdapter | null;
};

/**
 * `loadDocForEdit` ning hisobot-amallari varianti (sayqal va bandma-band
 * «Tuzatish» ikkalasi ham shundan yuklaydi).
 *
 * Farqi BITTA, lekin tub: tahrir adapteri SHART EMAS. `loadDocForEdit`
 * adapter topilmasa 409 `legacy` beradi — o'yin va plakat uchun bu
 * tahrir nuqtai nazaridan to'g'ri javob («tahrirlanmaydi»), lekin ular
 * sayqal QILA OLADI. Adapter BOR hujjatlarda esa darvoza AYNAN eskisi
 * (`adapter.hasModel`): eski maqola `doc.article` siz ham «Tuzatish»
 * qila olardi va bu xulq o'zgarmasligi kerak.
 */
export async function loadDocForPolish(id: string, userId: string): Promise<PolishTarget> {
  const row = await getGenerationForEdit(id, userId);
  if (!row) throw new ApiError("Topilmadi", 404);
  if (row.status !== "COMPLETED") {
    throw new ApiError("Hujjat hali tayyor emas", 409, { code: "status", status: row.status });
  }
  const polisherId = polisherIdFor(row.toolId);
  const adapter = adapterFor(row.toolId);
  const legacy = () => new ApiError("Bu hujjat eski formatda — tahrirlash uchun qaytadan yarating", 409, { code: "legacy" });
  if (!polisherId || !row.doc) throw legacy();
  if (adapter ? !adapter.hasModel(row.doc) : !POLISHERS[polisherId]?.hasModel(row.doc)) throw legacy();
  return {
    doc: adapter ? adapter.prepare(row.doc) : row.doc,
    docVersion: row.docVersion,
    fileName: row.fileName,
    toolId: row.toolId,
    polisherId,
    adapter,
  };
}

/**
 * Javob shakli `GET /api/generations/{id}` bilan AYNAN bir xil; `lean` —
 * `doc` bor qatorda `html` javobga tushmaydi (SCALE-12, `slide-commit.ts` `detail` egizagi).
 */
async function detail(id: string, userId: string) {
  const gen = await getGeneration(id, userId, { lean: true });
  if (!gen) throw new ApiError("Topilmadi", 404);
  const hasFile = await hasGenerationFile(id, userId);
  return { ...gen, hasFile };
}

/**
 * ADAPTERSIZ yozuv (o'yin, plakat) — `commitDocOps` ning egizagi.
 *
 * `commitDocOps` op larni adapter orqali QAYTA qo'llaydi; bu yerda
 * qo'llanadigan narsa yo'q — sayqal yadrosi (`runPolishWith`) hujjatni
 * allaqachon o'z `apply` i bilan yasab bergan. Qolgan hamma qoida
 * o'zgarmaydi: egalik va `doc_version` SQL PREDIKATIDA, yozuv BITTA
 * tranzaksiyada, birinchi o'zgarishda `doc_prev` saqlanadi.
 *
 * FAYL VERSIYASI HAR DOIM ko'tariladi (bayt almashsa ham, almashmasa
 * ham). Bu MAJBURIY: bu oilalarda `POST …/rebuild` ishlamaydi
 * (`rebuildFile` tahrir adapteridan render so'raydi, adapter esa yo'q),
 * ya'ni `file_version < doc_version` bo'lib qolsa natija sahifasi
 * abadiy «Fayl yangilanmoqda…» deb turar va «Yuklab olish» har bosishda
 * 409 `legacy` olardi. Matn o'zgarganda esa `file` bilan yangi bayt ham
 * SHU tranzaksiyada yoziladi — hujjat va fayl hech qachon ajralmaydi.
 */
export async function commitPolishedDoc(
  id: string,
  userId: string,
  baseVersion: number,
  doc: AcademicDoc,
  html: string,
  file: { bytes: Uint8Array; mime: string; fileName: string } | null,
) {
  const preview = buildPreview(doc);
  const next = await transaction(async (client) => {
    const v = await updateGenerationDoc(client, id, userId, baseVersion, { doc, html, preview }, { keepPrev: baseVersion === 0 });
    if (v == null) return null;
    await markFileVersion(client, id, userId, v);
    if (file) await putGenerationFile(id, file, client);
    return v;
  });
  if (next == null) {
    const fresh = await getGenerationForEdit(id, userId);
    throw new ApiError("Hujjat boshqa joyda o'zgargan — yangilab qayta urinib ko'ring", 409, { code: "version", docVersion: fresh?.docVersion ?? baseVersion });
  }
  return detail(id, userId);
}

export async function polishGeneration(id: string, userId: string, baseVersion: number, deps: PolishDeps = {}): Promise<PolishDocResult> {
  const cur = await loadDocForPolish(id, userId);
  const polisher = POLISHERS[cur.polisherId];
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

  /*
   * TAHRIRSIZ oila (o'yin, plakat): op lar emas, HUJJATNING O'ZI
   * yoziladi — qayta qo'llaydigan adapter yo'q. Javobdagi `ops` esa
   * mijoz uchun bir xil qoladi: `review` opi (panel shuni o'zlashtiradi).
   */
  if (!cur.adapter) {
    const docOf = polisher.docOf;
    if (!docOf) throw new ApiError("Bu hujjat turida sayqal yo'q", 409, { code: "legacy" });
    let doc = docOf(r);
    let html = polisher.htmlOf ? polisher.htmlOf(doc) : renderHtml(doc);
    let file: { bytes: Uint8Array; mime: string; fileName: string } | null = null;
    const rebuild = deps.rebuildFile ?? polisher.rebuild;
    /*
     * Fayl FAQAT qabul qilinganda qayta yasaladi: rad etilganda hujjat
     * matni o'zgarmagan (`runPolishWith` eski `doc` ni qaytaradi) va
     * eski bayt hamon to'g'ri.
     */
    if (r.accepted && rebuild) {
      const built = await rebuild(doc, { id, userId });
      // Yasab bo'lmasa hujjat ham yozilmaydi — yangi matn + eski fayl bo'lib qolmasin.
      if (!built) throw new ApiError("Fayl qayta yasalmadi — qayta urinib ko‘ring", 422, { code: "render" });
      if (built.doc) doc = built.doc;
      if (built.html !== undefined) html = built.html;
      file = { bytes: built.bytes, mime: built.mime, fileName: cur.fileName };
    }
    // Matn o'zgarmagan (rad etilgan sayqal) — eski html saqlanadi.
    const finalHtml = html ?? (await getGeneration(id, userId))?.html ?? "";
    const ops: ArticleOp[] = [{ op: "review", review: r.review }];
    const generation = await commitPolishedDoc(id, userId, baseVersion, doc, finalHtml, file);
    return { generation, ops, polish: r.log };
  }

  const toOps = polisher.toOps;
  if (!toOps) throw new ApiError("Bu hujjat turida sayqal yo'q", 409, { code: "legacy" });
  const ops: ArticleOp[] = r.accepted
    ? [...toOps(r), { op: "review", review: r.review }]
    : [{ op: "review", review: r.review }];
  const generation = await commitDocOps(id, userId, baseVersion, ops as unknown as DocOp[]);
  return { generation, ops, polish: r.log };
}
