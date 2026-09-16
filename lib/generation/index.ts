import { buildAcademicDoc } from "./content";
import { deliveredCount } from "./delivered";
import { llmEnabled as llmKeyPresent } from "./llm";
import { extractMeta, minPages } from "./meta";
import { bodyWordCount, remainingMs, targetWords, wordCount } from "./quality";
import { renderDocx } from "./render-docx";
import { renderHtml } from "./render-html";
import { renderPptx } from "./render-pptx";
import { renderPptxWithTemplate } from "./render-pptx-template";
import type { CustomTemplate } from "./pptx-template";
import { buildImageArtifact } from "./image-studio";
import { buildInfographicArtifact } from "./infographic/engine";
import { buildTranslationArtifact } from "./translate/engine";
import { buildResumeDoc } from "./resume/write";
import type { SlideProgressSink } from "./slide-progress";
import type { TranslationSource } from "./source-types";
import { buildSlideAcademicDoc } from "./slide-write";
import { pdfAvailable, toPdf } from "../server/pdf";
import { scaleDoc } from "./scale";
import { hardMissing, missingStructure, needLabel } from "./structure";
import { writeWithLlm } from "./write-llm";
import { articleWordPlan } from "./article/engine";
import { SUBJECT_PROFILES, SUBJECT_PROFILE_LIST, workKindOf, workWordPlan } from "./work";
import { ARTICLE_TYPES } from "./article/types-registry";
import { PUBLICATION_PROFILES } from "./article/profiles";
import { teacherKindOf, teacherTypeOf, type LessonTypeSpec } from "./teacher/registry";
import { teacherInputFromValues } from "./teacher/input";
import { testInputFromValues } from "./teacher/test/input";
import { weeksFor } from "./teacher/guard";
import { TEACHER_LIMITS } from "./teacher/types";
import { crosswordInputFromValues } from "./games/crossword/input";
import { normalizeGameCount } from "./games/types";
import type { AcademicDoc, BuiltFile, DocMeta } from "./types";
import type { FormValues, ToolConfig } from "../types";

export type { BuiltFile } from "./types";
export {
  writerSystemPrompt,
  lessonSystemPrompt,
  glossarySystemPrompt,
  keysSystemPrompt,
} from "./prompts";
export { llmEnabled, llmModel } from "./llm";


const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const NO_SCALE = new Set([
  "glossary",
  "keys",
  "lesson-plan",
  "texnologik-xarita",
  "resume",
  "translation",
  // Maqola 2: shablon zaxirasi (kalitsiz muhit) ham «kengaytirilmaydi» —
  // maqola hajmi tur/profil bilan boshqariladi, `scaleDoc` bilan emas.
  "article",
]);

/**
 * Hajm darvozasi qo'llanadigan vositalar.
 *
 * Bular foydalanuvchiga «N bet» deb va'da beradi va narxi ham shu betga
 * bog'langan. Qolganlari (glossariy, dars rejasi, rezyume, tarjima…)
 * bet bilan emas, tuzilma bilan o'lchanadi.
 *
 * IMRAD ham darvoza ostida. Ilgari u istisno edi, chunki o'z
 * to'ldirish mexanizmi yo'q edi — darvoza uni faqat xatoga aylantirardi.
 * Endi `writeImradWithLlm` bo'lim hajmini `targetPages` dan hisoblaydi
 * va yetmasa «Natijalar»/«Muhokama» ni chuqurlashtiradi, shuning uchun
 * istisnoning sababi qolmadi.
 */
const LENGTH_GATED = new Set(["referat", "coursework", "mustaqil-ish", "article", "thesis", "essay"]);

/*
 * O'QITUVCHI VOSITALARI (AUDIT-20 WP-F) — `LENGTH_GATED` da ATAYIN YO'Q.
 *
 * Dars rejasi, texnologik xarita, glossariy, keys va test HAJM emas,
 * ELEMENT va'da qiladi: «6 bosqich, 45 daqiqa», «34 hafta», «20 atama»,
 * «5 keys», «20 savol». So'z bilan o'lchash bu yerda ikki tomonga ham
 * yolg'on javob beradi — 40 haftalik xarita jadvalda «kam so'z» bo'ladi,
 * uzun kirish matni esa savolsiz testni «yetarli» deb o'tkazardi.
 * Darvoza `teacherGateFail` da (element soni), tuzilma esa
 * `structure.ts` dagi kind shartnomasida.
 */

/** Va'da qilingan hajmning shu ulushi majburiy. */
const MIN_LENGTH_RATIO = 0.8;

/**
 * Insho (AUDIT-19) — darvoza SO'Z bilan, `doc.essay.words.min` ning shu
 * ulushi.
 *
 * Nega varaq emas: insho hajmi kontekstga qarab o'lchanadi
 * (`essay/registry.ts essayWords`) — IELTS Task 2 rasmiy minimumi 250
 * so'z, ya'ni bir betdan kam; akademik esse 500–1 000 so'z. Varaqqa
 * bog'langan `targetWords(meta.targetPages)` bunda ma'nosiz: IELTS
 * inshosi «2 varaq» paketida ham 280 so'z bo'lishi KERAK.
 *
 * Nega 0.9 va 0.8 emas: `words.min` ning o'zi allaqachon mo'ljaldan
 * past chegara (maktab inshosida `aim × 0.8`, akademikda `aim × 0.85`).
 * Uning ustidan yana 0.8 qo'llansa 250 so'zlik IELTS inshosi 180 so'zda
 * ham o'tib ketardi — bunday ish imtihonda baholanmaydi.
 */
const ESSAY_LENGTH_RATIO = 0.9;

/**
 * Insho so'z darvozasi (`null` — insho emas yoki ESKI hujjat: u holda
 * odatdagi varaq hisobi ishlaydi, ya'ni eski inshoning xulqi o'zgarmaydi).
 */
export function essayGateWords(toolId: string, doc: AcademicDoc): number | null {
  if (toolId !== "essay") return null;
  const words = doc.essay?.words;
  return words ? Math.round(words.min * ESSAY_LENGTH_RATIO) : null;
}

/**
 * Renderlangan sahifa darvozasi shu hujjatga tegishlimi.
 *
 * Eksport testlar uchun: darvoza qarori `buildArtifact` ichida bir
 * qatorda yashirin turganda, «insho istisnosi» ni faqat haqiqiy
 * LibreOffice o'girmasi bilan sinash mumkin edi. Qaror endi nomlangan.
 *
 * `false` bo'ladigan hollar: hujjat bet VA'DA QILMAYDI —
 *   • so'z oralig'i bilan o'lchanadigan maqola turi (tezis 200–300 so'z);
 *   • insho `doc.essay.words` bilan (IELTS Task 2 — 250 so'z, 1 betdan kam).
 */
export function pageGateApplies(toolId: string, doc: AcademicDoc): boolean {
  /*
   * O'qituvchi vositalari BET VA'DA QILMAYDI (AUDIT-20): dars ishlanmasi
   * 2 bet ham, 4 bet ham bo'lishi mumkin — bu bosqichlar mazmuniga bog'liq,
   * narxga emas. Shart `LENGTH_GATED` tekshiruvidan OLDIN va alohida
   * turibdi: reyestrga yangi o'qituvchi vositasi qo'shilib, kimdir uni
   * o'ylamay `LENGTH_GATED` ga ham yozib qo'ysa, bet darvozasi baribir
   * ishga tushmaydi.
   */
  if (teacherKindOf(toolId)) return false;
  if (!LENGTH_GATED.has(toolId)) return false;
  if (isArticleTool(toolId) && articleWordRange(doc)) return false;
  return essayGateWords(toolId, doc) === null;
}

/**
 * Renderlangan sahifa soni — ikkinchi, YUMSHOQROQ darvoza.
 *
 * So'z darvozasi diapazonning O'RTACHASIGA nisbatan 80% talab qiladi.
 * Kalibrlashda (jonli Gemini, referat va kurs ishi) so'z nisbati 80%
 * dan yuqori bo'lsa ham, renderlangan sahifa soni PASTKI chegaraga
 * yaqinlashib qolishi kuzatildi (masalan 92% so'z — pastki chegaradan
 * atigi 1 bet yuqori). Jadval, sarlavha va bo'sh joy so'z sonini
 * o'zgartirmay sahifa sonini kamaytirishi mumkin — bu darvoza aynan shu
 * holatni ushlaydi. Pastki chegaraning o'zi emas, 85% i talab qilinadi:
 * PDF sahifalash formatlash farqlaridan biroz o'ynashi mumkin.
 */
const PAGE_GATE_RATIO = 0.85;



export type BuildOptions = {
  /**
   * Absolyut muddat (ms) — MAJBURIY.
   *
   * Ilgari bu ixtiyoriy edi va berilmasa 105 soniyalik standart byudjet
   * ishlatilardi. Amalda uni hech kim ishlatmasdi (worker doim o'z
   * muddatini uzatadi), lekin u jim turadigan tuzoq edi: opsiyasiz
   * chaqiruvda 40 betlik kurs ishi yarim yozilib to'xtardi. Byudjet
   * chaqiruvchining ongli qarori bo'lishi kerak.
   */
  deadline: number;
  /** Slayd logotipi — `data:` URL; worker `logo_uploads` dan o'qib beradi (WP-F). */
  logo?: string;
  /** «O'z shablonim» — namuna bayti + yengil nusxa; worker `template_uploads` dan (Shablonlar 2, B). */
  template?: { bytes: Uint8Array; template: CustomTemplate };
  /**
   * Jonli generatsiya hodisalari — F1b da IMZO qabul qilinadi va
   * `buildSlideAcademicDoc` ga uzatiladi, lekin dvigatel ichida hali
   * chaqirilmaydi (L2 paketi to'ldiradi).
   */
  onProgress?: SlideProgressSink;
  /**
   * Tarjima manbasi — ASL fayl bayti (Tarjimon 2, WP1); worker
   * `source_uploads` dan o'qib beradi (`sourceForJob`).
   *
   * Berilmasa dvigatel MATN rejimida ishlaydi (`values.sourceText`).
   * Berilsa — tarjima aynan shu baytlar ustida bajariladi va chiqish
   * formati kirishga teng bo'ladi (WP3 shu tarmoqni yozadi).
   */
  source?: TranslationSource;
  /**
   * Umumiy bosqich hisoboti — slaydning `onProgress` idan FARQLI.
   *
   * `SlideProgressSink` deka hodisalarini (slayd, rasm, maket) uzatadi
   * va uni faqat slayd dvigateli chiqaradi. Tarjimada esa deka yo'q:
   * kerak bo'lgan narsa — oddiy `{progress, step}` juftligi
   * («Tarjima qilinmoqda · 12/57»). Worker uni to'g'ridan-to'g'ri
   * `setProgress` ga uzatadi va shu paytdan soxta progress egri
   * chizig'ini to'xtatadi.
   */
  onStage?: (ev: { progress: number; step: string }) => void;
  /**
   * Rezyume surati (Rezyume 2) — `data:` URL + kesish ma'lumoti; worker
   * `photo_uploads` dan o'qib beradi (`photoDataUrl`), `logo` naqshi.
   *
   * Berilmasa rezyume suratsiz chiqadi — bu xato emas: `classic` shabloni
   * umuman suratsiz, qolganlarida ham surat ixtiyoriy.
   */
  photo?: { url: string; assetId: string; shape: "circle" | "square"; crop?: { x: number; y: number; zoom: number }; originalAssetId?: string };
};

/** Maqola dvigatelidagi vositalar: maqola va (AUDIT-19 dan) tezis. */
const isArticleTool = (id: string) => id === "article" || id === "thesis";

/** Maqola turining so'z oralig'i (tezis) — bor bo'lsa hujjat bet bilan o'lchanmaydi. */
function articleWordRange(doc: AcademicDoc): [number, number] | undefined {
  const type = doc.article?.type ?? doc.meta.articleType;
  return type ? ARTICLE_TYPES[type]?.wordRange : undefined;
}

/**
 * Maqola hajm darvozasi uchun «kerak» so'z: `wordRange` li turda pastki
 * chegara (tezis 200), qolganida profil bo'yicha butun hujjat so'zi
 * (`articleWordPlan.total` — annotatsiya ×3 ham hisobda, `wordCount` kabi).
 */
/**
 * Talaba ishi (AUDIT-19): so'z maqsadi `workWordPlan.body` — titul,
 * mundarija, adabiyotlar, vizual va ilova BETLARI ayirilgan matn. Eski
 * `targetWords(targetPages)` (230 × bet) referatni 9 bet deb yiqitardi:
 * 12,5 betlik paketda matn byudjeti ≈ 2 000 so'z, 230 × 12,5 = 2 875.
 */
export function workGateWords(doc: AcademicDoc): number | null {
  const w = doc.work;
  if (!w) return null;
  const kind = workKindOf(w.genre, w.kind);
  const subject = SUBJECT_PROFILES[w.subject] ?? SUBJECT_PROFILE_LIST[0];
  return workWordPlan(doc.meta, kind, subject, { refs: w.refsMin, figures: w.figures.length, tables: (doc.tables ?? []).length }).body;
}

/* ─────────────── O'qituvchi darvozalari (AUDIT-20 WP-F) ─────────────── */

/**
 * Bosqich daqiqalari yig'indisi va'da qilingan davomiylikdan shuncha
 * og'ishi mumkin (daqiqa).
 *
 * Nega 0 emas: `guard.ts normalizeMinutes` yig'indini AYNAN `duration`
 * ga tenglashtiradi, ya'ni 0 tolerans dvigatel ishlaganda hech qachon
 * ishlamasdi va darvoza bezak bo'lib qolardi. U esa DVIGATELDAN KEYINGI
 * qadamlarni — avto-sayqal va foydalanuvchi tahririni — qo'riqlaydi:
 * sayqal bosqichni qayta yozib daqiqani o'zgartirsa, 45 daqiqalik dars
 * 60 daqiqaga aylanib ketardi va o'qituvchi buni faqat sinfda bilardi.
 * 5 daqiqa — bitta bosqichning yaxlitlash xatosi, sinfda sezilmaydi.
 */
export const TEACHER_MINUTES_TOLERANCE = 5;

/**
 * Glossariy va keys: va'da qilingan elementlarning shu ulushi MAJBURIY.
 *
 * 0.70 — `delivered` bilan bir xil floor (AUDIT-5 P1-2 qarori): pastda
 * xato + to'liq qaytarish, 0.70 bilan va'da orasida esa yetkaziladi va
 * FARQ qaytariladi (`deliveredCount`).
 */
export const TEACHER_COUNT_RATIO = 0.7;

/**
 * Test: savollarning 0.80 i. Glossariydan qattiqroq, chunki test
 * BAHOLASH quroli — 20 savolga mo'ljallangan ball shkalasi va vaqt
 * me'yori 12 savolda umuman boshqa ish bo'lib qoladi.
 */
export const TEST_COUNT_RATIO = 0.8;

/**
 * Xarita: haftalarning 0.90 i. Eng qattiq nisbat, chunki xarita YILNI
 * qoplaydi: 34 haftalik yilda 24 hafta — bu «biroz kam», emas, chorak
 * dasturi umuman yo'q degani (jonli sinovda model aynan shu qadar
 * qaytarardi, `map.ts` izohi).
 */
export const MAP_WEEK_RATIO = 0.9;

/** Darvoza yiqilgani: `rule` — testlar uchun nom, `message` — foydalanuvchiga. */
export type TeacherGateFail = { rule: string; message: string };

const short = (what: string, got: number, need: number, unit: string): string =>
  `${what} yetarli chiqmadi (${got} ${unit}, kerak: kamida ${need}). Kredit qaytariladi — qayta urinib ko‘ring.`;

/**
 * O'qituvchi hujjatining ELEMENT darvozasi — `null` bo'lsa o'tdi.
 *
 * `doc.teacher` yo'q bo'lsa darvoza ham yo'q: eski yo'l
 * (`TEACHER_ENGINE=0`, `write-specials.ts`) modelsiz hujjat qaytaradi va
 * uni yangi qoidalar bilan o'lchash butun 4 xizmatni o'chirardi.
 *
 * VA'DA `values` dan, `teacher/input.ts` orqali olinadi — dvigatel
 * ishlatgan AYNAN o'sha reyestr chegaralari bilan; hujjatdan qayta
 * hisoblansa, model kam bergan sonning o'zi «va'da» bo'lib qolardi.
 */
export function teacherGateFail(meta: DocMeta, values: FormValues, doc: AcademicDoc): TeacherGateFail | null {
  const t = doc.teacher;
  if (!t) return null;

  if (t.kind === "test") {
    const m = t.test;
    if (!m) return { rule: "test.model", message: short("Test", 0, 1, "savol") };
    const want = testInputFromValues(meta, values).count;
    const need = Math.ceil(want * TEST_COUNT_RATIO);
    if (m.questions.length < need) return { rule: "test.count", message: short("Savollar soni", m.questions.length, need, "savol") };
    /*
     * Kalit — testning YAGONA tekshirib bo'lmaydigan qismi: uni
     * o'qituvchi savollarga qarab qayta tiklay olmaydi. Uzunligi savol
     * soniga teng bo'lmasa, kalit sayqal/tahrirdan keyin ESKI ro'yxatga
     * tegishli (WP-B mutatsiyasi aynan shu edi) va butun varaq yaroqsiz.
     */
    const badKey = m.variants.filter((v) => (m.key[v.id]?.length ?? 0) !== m.questions.length).map((v) => v.id);
    if (!m.variants.length || badKey.length) {
      return { rule: "test.key", message: `Javoblar kaliti to‘liq chiqmadi${badKey.length ? ` (${badKey.join(", ")} varianti)` : ""}. Kredit qaytariladi — qayta urinib ko‘ring.` };
    }
    return null;
  }

  const input = teacherInputFromValues(meta, values, t.kind);
  switch (t.kind) {
    case "lesson": {
      const m = t.lesson;
      if (!m) return { rule: "lesson.model", message: short("Dars bosqichlari", 0, 1, "bosqich") };
      // Bosqich MINIMUMI turdan (`nazorat` darsida 4, `yangi-mavzu` da 5).
      const min = (teacherTypeOf("lesson", m.type) as LessonTypeSpec).limits.stages[0];
      if (m.stages.length < min) return { rule: "lesson.stages", message: short("Dars bosqichlari", m.stages.length, min, "bosqich") };
      const sum = m.stages.reduce((n, s) => n + (Number(s.minutes) || 0), 0);
      if (Math.abs(sum - m.durationMin) > TEACHER_MINUTES_TOLERANCE) {
        return {
          rule: "lesson.minutes",
          message: `Bosqich daqiqalari dars davomiyligiga mos kelmadi (${sum} daqiqa, kerak: ${m.durationMin} ± ${TEACHER_MINUTES_TOLERANCE}). Kredit qaytariladi — qayta urinib ko‘ring.`,
        };
      }
      return null;
    }
    case "map": {
      const m = t.map;
      if (!m) return { rule: "map.model", message: short("Xarita haftalari", 0, 1, "hafta") };
      // Choraklik xarita — TO'RTTA blok; uchtasi «yil rejasi» emas.
      if (m.type === "choraklik" && m.quarters.length !== TEACHER_LIMITS.quarters) {
        return { rule: "map.quarters", message: `Choraklik xaritada ${m.quarters.length} chorak chiqdi (kerak: ${TEACHER_LIMITS.quarters}). Kredit qaytariladi — qayta urinib ko‘ring.` };
      }
      const got = m.quarters.reduce((n, q) => n + q.weeks.length, 0);
      const need = Math.ceil(weeksFor(m.weeklyHours || input.weeklyHours, m.totalHours || input.totalHours) * MAP_WEEK_RATIO);
      if (got < need) return { rule: "map.weeks", message: short("Xarita haftalari", got, need, "hafta") };
      return null;
    }
    case "glossary": {
      const m = t.glossary;
      if (!m) return { rule: "glossary.model", message: short("Atamalar", 0, 1, "atama") };
      const need = Math.ceil(input.termCount * TEACHER_COUNT_RATIO);
      if (m.terms.length < need) return { rule: "glossary.terms", message: short("Atamalar", m.terms.length, need, "atama") };
      return null;
    }
    case "keys": {
      const m = t.keys;
      if (!m) return { rule: "keys.model", message: short("Vaziyatli topshiriqlar", 0, 1, "keys") };
      const need = Math.ceil(input.caseCount * TEACHER_COUNT_RATIO);
      if (m.cases.length < need) return { rule: "keys.cases", message: short("Vaziyatli topshiriqlar", m.cases.length, need, "keys") };
      return null;
    }
    default:
      return null;
  }
}

/**
 * Bosma o'yinlar (AUDIT-21): krossvord/kartalar ELEMENT darvozasi —
 * `teacherGateFail` bilan AYNI naqsh (glossariy/keys 0.7 ulushi).
 *
 * `doc.game` yo'q bo'lsa darvoza ham yo'q (WP-B hali ulanmagan holatda
 * dvigatel `null` qaytaradi va bu qadamga umuman yetib kelmaydi —
 * `writeWithLlm` MAVJUD «AI javob bermadi» xulqini beradi). Model BOR-u
 * elementi FLOOR dan kam bo'lsa (masalan to'rga so'zning yarmidan kami
 * sig'gan) — bu ham xato: `deliveredCount` faqat pul qaytaradi, lekin
 * juda kam so'zli/kartali hujjatni «tayyor» deb yubormaslik kerak.
 *
 * VA'DA — `deliveredCount`dagi bilan BITTA manbadan (`gameDelivered`
 * naqshi): krossvordda `crosswordInputFromValues`, kartalarda
 * `normalizeGameCount` (WP-B ning `games/flashcards/input.ts` i hali
 * yo'q, R0 ning umumiy normalizatori mustaqil ishlaydi).
 */
export const GAME_COUNT_RATIO = 0.7;

export function gameGateFail(meta: DocMeta, values: FormValues, doc: AcademicDoc): TeacherGateFail | null {
  const g = doc.game;
  if (!g) return null;

  if (g.kind === "crossword") {
    const m = g.crossword;
    if (!m) return { rule: "crossword.model", message: short("Krossvord so'zlari", 0, 1, "so'z") };
    const want = crosswordInputFromValues(meta, values).wordCount;
    const need = Math.ceil(want * GAME_COUNT_RATIO);
    if (m.words.length < need) return { rule: "crossword.words", message: short("Krossvord so'zlari", m.words.length, need, "so'z") };
    return null;
  }
  if (g.kind === "flashcards") {
    const m = g.cards;
    if (!m) return { rule: "flashcards.model", message: short("Kartalar", 0, 1, "karta") };
    const want = normalizeGameCount(values.cardCount ?? values.count);
    const need = Math.ceil(want * GAME_COUNT_RATIO);
    if (m.cards.length < need) return { rule: "flashcards.cards", message: short("Kartalar", m.cards.length, need, "karta") };
    return null;
  }
  return null;
}

/**
 * Fayl nomi qo'shimchasi — vosita bo'yicha.
 *
 * Nega kerak: o'qituvchi bitta jildga bir necha hujjat yuklaydi va
 * ularning hammasi «Fotosintez.docx» bo'lib chiqsa, brauzer ularni
 * `(1)`, `(2)` bilan raqamlaydi — qaysi biri test, qaysi biri glossariy
 * ekani nomdan ko'rinmaydi. Ilgari faqat ikkita vositada bor edi.
 */
export function fileSuffix(toolId: string): string {
  switch (toolId) {
    case "lesson-plan":
      return "-dars";
    case "texnologik-xarita":
      return "-xarita";
    case "glossary":
      return "-glossariy";
    case "keys":
      return "-keys";
    case "test":
      return "-test";
    /* AUDIT-21: o'qituvchi bitta mavzu bo'yicha bir nechta material oladi. */
    case "crossword":
      return "-krossvord";
    case "flashcards":
      return "-kartalar";
    case "infographic":
      return "-infografika";
    default:
      return "";
  }
}

function articleGateWords(doc: AcademicDoc): number {
  const typeId = doc.article?.type ?? doc.meta.articleType ?? (doc.meta.toolId === "thesis" ? "conference_thesis" : "imrad_oak");
  const type = ARTICLE_TYPES[typeId];
  if (type.wordRange) return type.wordRange[0];
  const profileId = doc.article?.profile ?? doc.meta.pubProfile ?? type.defaultProfile;
  return articleWordPlan(doc.meta, type, PUBLICATION_PROFILES[profileId]).total;
}

export async function buildArtifact(
  tool: ToolConfig,
  values: FormValues,
  opts: BuildOptions,
): Promise<BuiltFile> {
  const meta = extractMeta(tool, values);
  const deadline = opts.deadline;

  // `pro-slide` ham shu dvigatel — farqi `extractMeta` (slayder, brif) va
  // rasm provayderida (`pickProvider`), oqimda emas.
  if (tool.id === "slide" || tool.id === "pro-slide") {
    const slideDoc = await buildSlideAcademicDoc(meta, deadline, { logo: opts.logo, onProgress: opts.onProgress });
    // «O'z shablonim»: deka namuna master/layout/temasi ichiga yoziladi;
    // yengil nusxa hujjatga — ko'ruvchi ham shundan chizadi (planCustom).
    if (opts.template) slideDoc.customTemplate = opts.template.template;
    const file = opts.template
      ? await renderPptxWithTemplate(slideDoc, `${meta.fileNameHint}.pptx`, opts.template.bytes, opts.template.template.profile)
      : await renderPptx(slideDoc, `${meta.fileNameHint}.pptx`);
    file.html = renderHtml(slideDoc);
    file.doc = slideDoc;
    /*
     * Paket yorlig'i «16 slayd» deb yozadi va narx aynan shunga
     * bog'langan. Sifat darvozasi 0.85 — u «umuman yaroqlimi» degan
     * savolga javob beradi, «va'da bajarildimi» ga emas. 14 slayd
     * yetkazilganda ish `COMPLETED` bo'lar va 8 000 tanga to'liq
     * olinardi (AUDIT-5 P1-1). Endi farq qaytariladi.
     */
    file.delivered = deliveredCount(meta, slideDoc);
    // `done` — PPTX yig'ilgandan KEYIN: jonli tasma «Tayyor» deganda
    // fayl haqiqatan mavjud bo'lsin (`renderPptx` ham yiqilishi mumkin).
    opts.onProgress?.({ type: "done" });
    return file;
  }

  if (tool.id === "image") {
    return buildImageArtifact(tool, values);
  }

  /*
   * Infografika (AUDIT-21): `rasm` bilan AYNI naqsh — chiqish bitta PNG,
   * shuning uchun umumiy `AcademicDoc` yo'lidagi hajm/sahifa darvozalari
   * unga tegishli emas va dvigatel `BuiltFile` ni O'ZI qaytaradi
   * (`packImages` bilan qadoqlab).
   *
   * `null` — dvigatel ishlamadi (WP-C gacha DOIM shunday). Xato matni
   * `rasm` vositasinikidan ko'chirilgan: foydalanuvchi uchun bu «AI
   * javob bermadi, pul qaytadi» degani, «modul hali yozilmagan» emas.
   */
  if (tool.id === "infographic") {
    const built = await buildInfographicArtifact(tool, values, { deadline, ...(opts.onStage ? { onStage: opts.onStage } : {}) });
    if (!built) throw new Error("Infografika yaratilmadi. Qayta urinib ko‘ring.");
    return built;
  }

  /*
   * Tarjimon 2: o'z dvigateli — fayl (DOCX/PPTX/XLSX/…) TUZILMASI saqlanib
   * matn tugunlari almashtiriladi, matn/PDF esa `translation` profilida
   * DOCX bo'ladi. `AcademicDoc` yo'lidagi hajm/sahifa darvozalari unga
   * tegishli emas.
   */
  if (tool.id === "translation") {
    return buildTranslationArtifact(meta, values, opts);
  }

  /*
   * Rezyume 2: SURAT dvigatelga faqat shu yo'ldan kiradi (worker
   * `photo_uploads` dan `data:` URL beradi), shuning uchun rezyume
   * `writeWithLlm` orqali emas, to'g'ridan-to'g'ri chaqiriladi.
   * `null` — kalit yo'q yoki model javob bermadi: LLM'siz deterministik
   * model (`content.ts` → `draftModel`) zaxira bo'lib qoladi, chunki
   * rezyume MA'LUMOTI foydalanuvchidan keladi — matn yozilmasa ham
   * hujjat mazmunli chiqadi (maqola/referatdan farqi shu).
   */
  if (tool.id === "resume") {
    let resumeDoc = await buildResumeDoc(meta, values, { deadline, photo: opts.photo });
    if (!resumeDoc) {
      resumeDoc = buildAcademicDoc(meta, values);
      // Zaxira yo'lda ham surat qoladi: u foydalanuvchi YUKLAGAN fayl,
      // modelning ishlashiga bog'liq emas.
      if (opts.photo && resumeDoc.resume) {
        resumeDoc.resume.photo = {
          url: opts.photo.url,
          shape: opts.photo.shape,
          assetId: opts.photo.assetId,
          ...(opts.photo.originalAssetId ? { originalAssetId: opts.photo.originalAssetId } : {}),
          ...(opts.photo.crop ? { crop: opts.photo.crop } : {}),
        };
      }
    }
    const fileName = `${meta.fileNameHint}.docx`;
    return { html: renderHtml(resumeDoc), bytes: await renderDocx(resumeDoc), fileName, mime: DOCX, doc: resumeDoc };
  }

  /*
   * Maqola 2: dvigatel bosqich hisobotini (`onStage`), yuklangan faylni
   * (`source`) va LLM sarfini (`onCost` → `BuiltFile.cost`) shu yo'ldan oladi.
   */
  let cost: BuiltFile["cost"];
  const llmDoc = await writeWithLlm(meta, values, deadline, { onStage: opts.onStage, source: opts.source, onCost: (c) => (cost = c) });

  /**
   * Kalit bor, lekin AI matn yozmadi — shablonga tushmaymiz.
   *
   * `content.ts` har qanday mavzuga bir xil matn beradi («… tizimli
   * o'rganishni talab qiladigan mavzu», «… alohida fakt emas, balki
   * bog'liq tushunchalar tizimi»). Ilgari shu matn `COMPLETED` bo'lib
   * chiqardi va pul qaytmasdi. Endi xato qaytadi — worker kreditni
   * o'zi qaytaradi. Shablon faqat kalitsiz (dev/demo) muhitda qoladi.
   */
  if (!llmDoc && llmKeyPresent()) {
    throw new Error("Matn yozilmadi — AI javob bermadi. Kredit qaytariladi, qayta urinib ko‘ring.");
  }

  let academic = llmDoc ?? buildAcademicDoc(meta, values);
  if (!llmDoc && !NO_SCALE.has(tool.id)) academic = scaleDoc(academic);

  /**
   * Hajm darvozasi.
   *
   * `writeWriterWithLlm` allaqachon 90% ga yetguncha qo'shimcha tahlil
   * yozishga urinadi. Shundan keyin ham va'daning 80% i chiqmasa, ishni
   * «tayyor» deb belgilash foydalanuvchini aldash bo'lardi: u 15–20 bet
   * uchun to'lab, 9 betlik fayl olardi. Xato + kredit qaytishi halolroq.
   */
  if (llmDoc && LENGTH_GATED.has(tool.id)) {
    /*
     * Maqola: so'z maqsadi PROFILGA (shrift/interval) va TURGA bog'liq
     * (`articleWordPlan`): tezis 200–300 so'z bilan o'lchanadi, bet bilan
     * emas; IEEE (TNR 12, yakka) bir betga OAK dan 1.7 marta ko'p so'z oladi.
     */
    const want = isArticleTool(tool.id) ? articleGateWords(academic) : (workGateWords(academic) ?? targetWords(meta.targetPages));
    // Insho: so'z byudjeti hujjatning O'ZIDA (`doc.essay.words`) — varaq emas.
    const essayNeed = essayGateWords(tool.id, academic);
    const need = essayNeed ?? Math.round(want * MIN_LENGTH_RATIO);
    // Talaba ishi: reja tanasi apparaturasiz — o'lchov ham matn so'zlari bilan.
    const got = academic.work ? bodyWordCount(academic) : wordCount(academic);
    if (got < need) {
      const pages = Math.max(1, Math.round(got / 230));
      console.warn(`[gen] length gate: ${tool.id} ${got}/${need} so'z`);
      throw new Error(
        essayNeed
          ? `Insho hajmi yetarli chiqmadi (${got} so'z, kerak: kamida ${need}). ` +
            `Kredit qaytariladi — qayta urinib ko‘ring.`
          : `Matn hajmi yetarli chiqmadi (~${pages} bet, kerak: ${meta.pagesLabel} bet). ` +
            `Kredit qaytariladi — qayta urinib ko‘ring yoki kichikroq hajm tanlang.`,
      );
    }
  }

  /**
   * Tuzilma darvozasi — hajm darvozasining juftligi.
   *
   * Hajm darvozasi «yetarli yozildimi» ni so'raydi, bu esa «va'da
   * qilingan JANR chiqdimi» ni. Ilgari janr talablari FAQAT promptda
   * turardi: `writeAbstracts` ikki marta urinib ham javob olmasa,
   * maqola annotatsiyasiz `COMPLETED` bo'lardi — ya'ni jurnalga
   * yubora olmaydigan «maqola» uchun 8 000 tanga olinardi.
   *
   * Yumshoq talablar (jadval, mustaqil vazifa) faqat logga yoziladi:
   * ular bezak yoki evristik aniqlanadi, to'liq yozilgan ishni ular
   * uchun yiqitish foydalanuvchiga olganidan ko'proq zarar berardi.
   */
  /*
   * O'qituvchi darvozasi (AUDIT-20 WP-F) — ELEMENT soni bilan.
   *
   * Tuzilma darvozasidan OLDIN: «bosqichlar bo'limi bor, lekin ichida 2
   * bosqich» holatini bo'lim darvozasi ko'rmaydi, bu esa aynan shu.
   * `doc.teacher` yo'q bo'lsa (eski yo'l) `null` qaytadi.
   */
  if (llmDoc) {
    const fail = teacherGateFail(meta, values, academic);
    if (fail) {
      console.warn(`[gen] teacher gate: ${tool.id} — ${fail.rule}`);
      throw new Error(fail.message);
    }
  }

  /*
   * O'yin darvozasi (AUDIT-21) — ELEMENT soni bilan, o'qituvchi
   * darvozasi bilan bir xil o'rinda: `doc.game` yo'q bo'lsa (boshqa
   * vosita, yoki WP-B hali ulanmagan) `null` qaytadi.
   */
  if (llmDoc) {
    const fail = gameGateFail(meta, values, academic);
    if (fail) {
      console.warn(`[gen] game gate: ${tool.id} — ${fail.rule}`);
      throw new Error(fail.message);
    }
  }

  if (llmDoc) {
    const missing = missingStructure(meta, academic);
    if (missing.length) {
      console.warn(`[gen] structure: ${tool.id} — ${missing.map(needLabel).join(", ")} yo'q`);
    }
    const hard = hardMissing(meta, academic);
    if (hard.length) {
      throw new Error(
        `Hujjat tuzilmasi to'liq chiqmadi (${hard.map(needLabel).join(", ")} yo'q). ` +
          `Kredit qaytariladi — qayta urinib ko‘ring.`,
      );
    }
  }

  const bytes = await renderDocx(academic);

  /**
   * Renderlangan sahifa soni darvozasi.
   *
   * So'z darvozasi «taxminiy» hisoblaydi (`WORDS_PER_PAGE`), bu esa
   * HAQIQIY chiqishni — DOCX LibreOffice orqali PDF ga o'giriladi va
   * sahifa soni sanaladi. LibreOffice o'rnatilmagan muhitda (yoki
   * byudjet tugagan bo'lsa) darvoza JIM o'tkazib yuboriladi — bu
   * ikkilamchi tekshiruv, o'girish muvaffaqiyatsiz bo'lgani uchun
   * foydalanuvchi to'g'ri hujjatdan mahrum bo'lmasligi kerak.
   */
  /*
   * So'z bilan o'lchanadigan maqola turlari (tezis 200–300 so'z) sahifa
   * va'da qilmaydi — ular uchun renderlangan sahifa darvozasi yo'q
   * (`max(2, …)` bir sahifalik tezisni yiqitardi).
   *
   * AUDIT-19: insho ham shu qatorda — hajmi `doc.essay.words` bilan
   * o'lchangan bo'lsa sahifa darvozasi O'TKAZIB YUBORILADI. IELTS Task 2
   * (250 so'z) bir betdan kam chiqadi va `max(2, …)` uni HAR SAFAR
   * yiqitardi — foydalanuvchi to'g'ri yozilgan inshoni ololmasdi.
   */
  const pageGated = pageGateApplies(tool.id, academic);
  if (llmDoc && pageGated && pdfAvailable() && remainingMs(deadline) > 20_000) {
    const pdf = await toPdf(bytes, `${meta.fileNameHint}.docx`).catch(() => null);
    if (pdf) {
      try {
        const { getDocumentProxy } = await import("unpdf");
        const proxy = await getDocumentProxy(new Uint8Array(pdf));
        const wantMin = minPages(meta.pagesLabel, meta.targetPages);
        const gate = Math.max(2, Math.round(wantMin * PAGE_GATE_RATIO));
        if (proxy.numPages < gate) {
          console.warn(`[gen] page gate: ${tool.id} ${proxy.numPages}/${wantMin} bet (renderlangan)`);
          throw new Error(
            `Hujjat sahifa soni yetarli chiqmadi (renderlangan ${proxy.numPages} bet, kerak: ${meta.pagesLabel} bet). ` +
              `Kredit qaytariladi — qayta urinib ko‘ring yoki kichikroq hajm tanlang.`,
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Hujjat sahifa soni")) throw e;
        console.warn("[gen] page gate: PDF o‘qib bo‘lmadi", e);
      }
    }
  }

  return {
    html: renderHtml(academic),
    bytes,
    fileName: `${meta.fileNameHint}${fileSuffix(tool.id)}.docx`,
    mime: DOCX,
    doc: academic,
    ...(cost ? { cost } : {}),
    /*
     * Glossariy va texnologik xaritada ham son VA'DA qilingan:
     * «40 ta atama» tanlovi narxni belgilaydi (6/9/15 ming), haftalar
     * esa foydalanuvchi kiritgan soatlardan chiqadi. Ikkalasining ham
     * darvozasi 70% — ya'ni 40 atama uchun 15 000 to'lab 28 ta olish
     * mumkin edi (AUDIT-5 P1-2).
     *
     * AUDIT-20: keys va test ham shu ro'yxatda, va o'qituvchi
     * dvigatelining hujjatlarida miqdor MODELDAN sanaladi — `values`
     * esa VA'DANI beradi (`teacher/input.ts`, reyestr chegaralari).
     */
    delivered: deliveredCount(meta, academic, values),
  };
}
