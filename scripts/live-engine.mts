#!/usr/bin/env node
/**
 * DVIGATEL darajasidagi jonli tekshiruv — haqiqiy Gemini bilan.
 *
 * `scripts/eval-services.mjs` butun stekni (HTTP → navbat → worker →
 * fayl) sinaydi va ishlab turgan server talab qiladi. Bu skript esa
 * `buildArtifact` ni TO'G'RIDAN-TO'G'RI chaqiradi: server, sessiya va
 * navbat kerak emas, shuning uchun uni har o'zgarishdan keyin ishga
 * tushirish arzon.
 *
 * Nega kerak: unit testlar `fetch` ni stub qiladi, ya'ni ular MANTIQNI
 * sinaydi — modelning haqiqiy javobini emas. Byudjet, prompt sifati va
 * hajm darvozalari faqat jonli chaqiruvda o'lchanadi.
 *
 * Foydalanish:
 *   npm run live                 — barcha keyslar
 *   npm run live -- article-oak essay-dtm  — faqat nomlanganlar
 *   npm run live -- article-oak --article-type analytical --profile university  — maqola turi/profili
 *   npm run live -- essay-dtm essay-academic essay-ielts  — insho (AUDIT-19)
 *   npm run live -- article-oak --no-polish  — avto-sayqalsiz (AUDIT-18/19)
 *   npm run live -- --list       — holatlar ro'yxati, LLM chaqiruvisiz
 *   npm run live -- lesson map map-quarters glossary keys  — o'qituvchi (AUDIT-20)
 *   npm run live -- test-topic test-curriculum             — test dvigateli
 *   npm run live -- test-file --source ./namuna.docx       — test, fayl rejimi
 *   npm run live -- crossword flashcards infographic       — o'yinlar + plakat (AUDIT-21)
 *   npm run live -- crossword-file --source ./namuna.docx  — krossvord, fayl rejimi
 *
 * `GEMINI_API_KEY` shart (`--list` dan tashqari). Chiqish `eval-out/live/` ga.
 */
import { planArticle } from "../lib/generation/article/layout";
import { mkdir, writeFile } from "node:fs/promises";
import { normalizeResumeTemplate, templateHasPhoto, type ResumeTemplateId } from "../lib/generation/resume/templates.ts";
import path from "node:path";
import { buildArtifact, workGateWords } from "../lib/generation/index.ts";
import { parsePptxTemplate } from "../lib/generation/pptx-template.ts";
import { readFile } from "node:fs/promises";
import { extractMeta } from "../lib/generation/meta.ts";
import { minSummaryChars, summaryLimits } from "../lib/generation/resume/write.ts";
import type { SlideProgressEvent } from "../lib/generation/slide-progress.ts";
import { wordCount } from "../lib/generation/quality.ts";
import { slideNotes } from "../lib/generation/slide-layout.ts";
import { pdfAvailable, toPdf } from "../lib/server/pdf.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { effectivePlanItems, planCapacity } from "../lib/generation/slide-params.ts";
import { kindOf, type AcademicDoc, type BuiltFile } from "../lib/generation/types.ts";
import { verifyCitations } from "../lib/generation/research/verify.ts";
import { factNumbers } from "../lib/generation/article/guard.ts";
import { PUBLICATION_PROFILES, isPublicationProfileId } from "../lib/generation/article/profiles.ts";
import { isArticleTypeId } from "../lib/generation/article/types-registry.ts";
import { ESSAY_FILLER } from "../lib/generation/essay/prompts.ts";
import type { ArticleTypeId, PublicationProfileId } from "../lib/generation/article/types.ts";
import type { FormValues } from "../lib/types.ts";
import { countGridCrossings } from "../lib/generation/games/crossword/review.ts";
import { CROSSWORD_SECTION_IDS } from "../lib/generation/games/crossword/engine.ts";
import { GAME_LIMITS } from "../lib/generation/games/types.ts";
import { auditSlideDoc } from "./slide-audit.mts";
import sharp from "sharp";

type Check = { label: string; ok: boolean; detail: string };
type Case = {
  name: string;
  tool: keyof typeof TOOL_BY_ID;
  values: FormValues;
  budgetMs: number;
  /**
   * Faylni ko'rgandan keyin nimani da'vo qilamiz.
   *
   * `Promise<Check[]>` ham mumkin — infografika holati PNG o'lchamini
   * `sharp` bilan ASINXRON o'qiydi (AUDIT-21). Sinxron holatlar
   * o'zgarmaydi: `await syncValue` uni o'zgarishsiz qaytaradi.
   */
  checks: (file: BuiltFile, pages: number | null) => Check[] | Promise<Check[]>;
};

const OUT = path.resolve(process.cwd(), "eval-out", "live");
const ok = (label: string, cond: boolean, detail: string): Check => ({ label, ok: cond, detail });

const TRANSLATION_SAMPLE = [
  "Orol dengizi fojiasi va uni tiklash choralari",
  "Orol dengizi 1960-yillarda dunyodagi to‘rtinchi eng katta ko‘l edi: maydoni 68 000 km², suv hajmi 1 090 km³. 2024-yilga kelib uning 10 foizdan kamrog‘i qoldi. Asosiy sabab — Amudaryo va Sirdaryo suvlarining paxta dalalariga haddan tashqari ko‘p olinishi.",
  "Oqibatlar: 1 250 ta aholi punkti suv ta’minotidan ayrildi, qurigan tubdan yiliga 75 million tonnagacha tuz va chang ko‘tariladi. Tadqiqotlar (UNESCO, 2019) mintaqada nafas yo‘llari kasalliklari 30 % ga oshganini ko‘rsatadi.",
  "Choralar: saksovul ekish (2018–2024 yillarda 1,7 million gektar), tomchilatib sug‘orish, «Orolni asrash» xalqaro jamg‘armasi loyihalari. Batafsil: https://aral.uz va info@aral.uz.",
].join("\n\n");


/**
 * Rezyume 2 jonli keysi uchun KIRISH — o'zbekcha faktlar.
 *
 * Chiqish tili `--lang` bilan boshqariladi (standart `en`): asosiy
 * talab — foydalanuvchi ma'lumotni ISTALGAN tilda kiritadi, rezyume esa
 * tanlangan tilda chiqadi.
 */
const RESUME_VALUES: FormValues = {
  fullName: "Karimova Dilnoza",
  targetRole: "Moliya tahlilchisi",
  phone: "+998901234567",
  email: "dilnoza.karimova@mail.uz",
  location: "Toshkent",
  experience: JSON.stringify([
    {
      id: "e1",
      company: "Artel Electronics",
      role: "Yetakchi moliya tahlilchisi",
      start: "2022-03",
      end: "now",
      bullets: [
        "byudjet tuzganman, 14 ta bolim uchun",
        "xarajatlarni kamaytirdim, logistika 12 foiz",
        "hisobot tayyorlash 3 kundan 1 kunga tushdi",
      ],
    },
    {
      id: "e2",
      company: "Korzinka",
      role: "Moliya tahlilchisi",
      start: "2019-08",
      end: "2022-02",
      bullets: ["35 ta dokon boyicha rentabellik hisobladim", "1C da hisob bloklarini avtomatlashtirdim"],
    },
  ]),
  education: JSON.stringify([
    { id: "d1", kind: "university", institution: "Toshkent davlat iqtisodiyot universiteti", field: "Moliya va kredit", degree: "bakalavr", start: "2015", end: "2019" },
  ]),
  languages: JSON.stringify([
    { id: "l1", language: "O‘zbek", level: "ona tili" },
    { id: "l2", language: "Ingliz", level: "B2" },
  ]),
  certificates: JSON.stringify([{ id: "c1", name: "ACCA F3", issuer: "ACCA", year: "2021" }]),
  skills: "Excel,1C,Power BI,IFRS",
  about: "5 yil moliya sohasida ishlaganman, byudjet va boshqaruv hisoboti bilan.",
  tone: "professional",
};

/** Kirishda BOR yillar — model boshqa yil o'ylab topmasligi kerak. */
const RESUME_YEARS = new Set(["2015", "2019", "2021", "2022"]);

/* ═════════════ O'qituvchi vositalari (AUDIT-20 WP-F) ═════════════ */

/**
 * DOCX bet chegarasi — kind bo'yicha [min, max].
 *
 * WP-C (`teacher/layout.ts planTeacher`) maketi kelgunga qadar DOCX
 * UMUMIY shox bilan chiziladi: rasmiy shapka, albom yo'nalish va bet
 * uzilishlari hali yo'q, ya'ni bet soni maketdan keyin O'ZGARADI.
 * Chegara shuning uchun keng — u «hujjat umuman bir betlik bo'lib
 * qolmadimi yoki 40 betga cho'zilmadimi» degan savolga javob beradi.
 * Aniq paritet — R3 raundida, LibreOffice ko'zi bilan.
 */
const TEACHER_PAGES: Record<string, [number, number]> = {
  lesson: [1, 6],
  map: [1, 14],
  glossary: [1, 12],
  keys: [1, 14],
  test: [1, 16],
};

/** Beshala vositada bir xil da'volar: model, hisobot, sarf, delivered, bet. */
function teacherChecks(f: BuiltFile, pages: number | null, kind: keyof typeof TEACHER_PAGES): Check[] {
  const t = f.doc.teacher;
  const review = t?.review;
  const red = review?.checks.filter((x) => x.level === "red").map((x) => x.id) ?? [];
  const [pMin, pMax] = TEACHER_PAGES[kind];
  const d = f.delivered;
  return [
    ok("doc.teacher bor", Boolean(t) && t?.kind === kind, t ? `${t.kind}/${t.type}` : "YO'Q — eski yo'lga tushdi"),
    ok("hisobot bor (ball > 0)", (review?.score ?? 0) > 0, review ? `${review.score} ball, qizil: ${red.join(",") || "yo'q"}` : "yo'q"),
    ok("cost.calls > 0", (f.cost?.calls ?? 0) > 0, f.cost ? `${f.cost.calls} chaqiruv, ${f.cost.provider}/${f.cost.model}` : "yo'q"),
    ok("delivered va'daga mos", !d || d.got < d.want, d ? `${d.got}/${d.want} ${d.unit} → farq qaytadi` : "to'liq yetkazildi"),
    ok(`DOCX ${pMin}–${pMax} bet`, pages === null || (pages >= pMin && pages <= pMax), `${pages ?? "o'girilmadi"} bet (WP-C maketisiz — umumiy shox)`),
  ];
}

/** Fayl nomi vositani aytadimi (`fileSuffix`). */
const suffixCheck = (f: BuiltFile, want: string): Check =>
  ok("fayl nomi qo'shimchasi", f.fileName.includes(`${want}.docx`), f.fileName);

const reviewRule = (f: BuiltFile, id: string): Check => {
  const c = f.doc.teacher?.review?.checks.find((x) => x.id === id);
  return ok(`hisobot: ${id}`, Boolean(c) && c!.level !== "red", c ? `${c.level} — ${c.detail ?? ""}`.slice(0, 90) : "band yo'q");
};

const SCHOOL = { university: "15-son umumiy o'rta ta'lim maktabi", author: "Karimova Dilnoza", language: "uz" };

function teacherCases(): Case[] {
  return [
    {
      /* Dars rejasi: bosqich/daqiqa darvozasi + `doc.teacher.lesson` modeli. */
      name: "lesson",
      tool: "lesson-plan",
      budgetMs: 200_000,
      values: { ...SCHOOL, topic: "Kasrlarni qo'shish va ayirish", subject: "Matematika", grade: 5, gradeLetter: "A", duration: 45, lessonType: "yangi-mavzu", stageCount: 6, assessmentStyle: "bsb" },
      checks: (f, pages) => {
        const m = f.doc.teacher?.lesson;
        const sum = (m?.stages ?? []).reduce((n, s) => n + s.minutes, 0);
        const goals = m ? [m.goal.talim, m.goal.tarbiya, m.goal.rivoj].filter(Boolean).length : 0;
        const topicHit = f.doc.sections.some((s) => s.blocks.some((b) => /kasr/i.test(b.text)));
        return [
          ...teacherChecks(f, pages, "lesson"),
          ok("bosqichlar ≥ 5", (m?.stages.length ?? 0) >= 5, `${m?.stages.length ?? 0} bosqich`),
          ok("daqiqalar yig'indisi = 45", sum === (m?.durationMin ?? 45), `${sum} / ${m?.durationMin ?? "?"} daq`),
          ok("maqsad uchligi", goals === 3, `${goals}/3`),
          ok("bosqichda o'qituvchi+o'quvchi ustuni", (m?.stages ?? []).every((s) => s.teacher && s.student), (m?.stages ?? []).filter((s) => !s.teacher || !s.student).length + " bo'sh"),
          ok("mavzuga bog'langan", topicHit, topicHit ? "«kasr» matnda" : "MAVZU YO'Q"),
          ok("delivered YO'Q (miqdor va'dasi yo'q)", f.delivered === undefined, f.delivered ? `${f.delivered.got}/${f.delivered.want}` : "to'g'ri"),
          suffixCheck(f, "-dars"),
        ];
      },
    },
    {
      /* Texnologik xarita — yillik: 136/4 = 34 hafta, soat yig'indisi QAT'IY. */
      name: "map",
      tool: "texnologik-xarita",
      budgetMs: 320_000,
      values: { ...SCHOOL, subject: "Biologiya", topic: "Biologiya", grade: 8, weeklyHours: 4, totalHours: 136, mapType: "yillik", controlLink: "bsb-chsb" },
      checks: (f, pages) => {
        const m = f.doc.teacher?.map;
        const weeks = (m?.quarters ?? []).flatMap((q) => q.weeks);
        const hours = weeks.reduce((n, w) => n + w.hours, 0);
        const uniq = new Set(weeks.map((w) => w.topic.toLowerCase().trim())).size;
        return [
          ...teacherChecks(f, pages, "map"),
          ok("hafta soni 34", weeks.length === 34, `${weeks.length} hafta`),
          ok("yillik — bitta blok", (m?.quarters.length ?? 0) === 1, `${m?.quarters.length ?? 0} blok`),
          ok("soat yig'indisi = 136", hours === 136, `${hours} soat`),
          ok("mavzular noyob", uniq === weeks.length, `${uniq}/${weeks.length}`),
          ok("natija va nazorat ustunlari to'la", weeks.every((w) => w.result && w.control), `${weeks.filter((w) => !w.result || !w.control).length} bo'sh`),
          suffixCheck(f, "-xarita"),
        ];
      },
    },
    {
      /* Choraklik variant: AYNI soatlar, lekin TO'RTTA jadval (`map.quarters`). */
      name: "map-quarters",
      tool: "texnologik-xarita",
      budgetMs: 360_000,
      values: { ...SCHOOL, subject: "Biologiya", topic: "Biologiya", grade: 8, weeklyHours: 4, totalHours: 136, mapType: "choraklik" },
      checks: (f, pages) => {
        const m = f.doc.teacher?.map;
        const weeks = (m?.quarters ?? []).flatMap((q) => q.weeks);
        const tables = (f.doc.tables ?? []).length;
        return [
          ...teacherChecks(f, pages, "map"),
          ok("4 chorak", (m?.quarters.length ?? 0) === 4, (m?.quarters ?? []).map((q) => `${q.n}:${q.weeks.length}`).join(" ")),
          ok("4 jadval (anchor q1..q4)", tables === 4, `${tables} jadval: ${(f.doc.tables ?? []).map((t) => t.anchor).join(",")}`),
          ok("hafta soni 34", weeks.length === 34, `${weeks.length} hafta`),
          ok("delivered BARCHA choraklardan", !f.delivered, f.delivered ? `${f.delivered.got}/${f.delivered.want} — 1-jadval sanaldimi?` : "to'liq"),
        ];
      },
    },
    {
      /* Glossariy — uch tilli: 20 atama, `ru`/`en` ustunlari, alifbo tartibi. */
      name: "glossary",
      tool: "glossary",
      budgetMs: 200_000,
      values: { ...SCHOOL, topic: "Fotosintez va o'simlik fiziologiyasi", subject: "Biologiya", grade: 8, termCount: "20", glossaryType: "uch-tilli", includeExample: true },
      checks: (f, pages) => {
        const m = f.doc.teacher?.glossary;
        const terms = m?.terms ?? [];
        const tri = terms.filter((t) => t.ru && t.en).length;
        const withExample = terms.filter((t) => t.example).length;
        return [
          ...teacherChecks(f, pages, "glossary"),
          ok("atamalar 20", terms.length === 20, `${terms.length} ta`),
          ok("uch tilli (ru + en)", tri === terms.length, `${tri}/${terms.length}`),
          ok("misol qatori", withExample >= Math.ceil(terms.length * 0.8), `${withExample}/${terms.length}`),
          ok("alifbo tartibi", isSorted(f.doc), "h3 sarlavhalari"),
          ok("jadval bor (uch tilli)", (f.doc.tables ?? []).length === 1, `${(f.doc.tables ?? []).length} jadval`),
          suffixCheck(f, "-glossariy"),
        ];
      },
    },
    {
      /* Keys — 5 vaziyat, har birida rubrika 10 ball (alohida `rubric` bo'limi). */
      name: "keys",
      tool: "keys",
      budgetMs: 260_000,
      values: { ...SCHOOL, university: "Toshkent davlat pedagogika universiteti", topic: "Boshlang'ich sinfda sinf boshqaruvi", subject: "Pedagogika", keysType: "muammoli", caseCount: 5, audience: "otm" },
      checks: (f, pages) => {
        const m = f.doc.teacher?.keys;
        const cases = m?.cases ?? [];
        const rubricSums = cases.map((c) => c.rubric.reduce((n, r) => n + r.points, 0));
        return [
          ...teacherChecks(f, pages, "keys"),
          ok("keyslar 5", cases.length === 5, `${cases.length} ta`),
          ok("har keysda 2+ topshiriq", cases.every((c) => c.questions.length >= 2), cases.map((c) => c.questions.length).join(",")),
          ok("namunaviy kalit bo'sh emas", cases.every((c) => c.solution.trim().length > 40), `${cases.filter((c) => c.solution.trim().length <= 40).length} qisqa`),
          ok("rubrika 10 ball", rubricSums.every((s) => s === 10), rubricSums.join(",")),
          ok("`rubric` bo'limi bor", f.doc.sections.some((s) => s.id === "rubric"), f.doc.sections.map((s) => s.id).join(",")),
          suffixCheck(f, "-keys"),
        ];
      },
    },
    {
      /* Test (mavzu rejimi) — 20 savol, 2 variant, kalit, OMR PNG, hisobot ≥ 55. */
      name: "test-topic",
      tool: "test",
      budgetMs: 400_000,
      values: { ...SCHOOL, topic: "Hosila va uning tatbiqlari", subject: "Matematika", grade: 10, mode: "topic", testType: "nazorat", count: 20, variants: 2, difficulty: "aralash", omr: true, answerKey: "alohida-bet", timeMin: 45 },
      checks: (f, pages) => {
        const m = f.doc.teacher?.test;
        const qs = m?.questions ?? [];
        const omr = (f.doc.teacher?.figures ?? []).find((g) => g.spec.kind === "omr");
        const review = f.doc.teacher?.review;
        const keyLens = (m?.variants ?? []).map((v) => m!.key[v.id]?.length ?? 0);
        return [
          ...teacherChecks(f, pages, "test"),
          ok("savollar 20", qs.length === 20, `${qs.length} ta`),
          ok("2 variant", (m?.variants.length ?? 0) === 2, (m?.variants ?? []).map((v) => v.id).join(",")),
          ok("kalit har variantda to'liq", keyLens.every((n) => n === qs.length), keyLens.join("/")),
          ok("OMR PNG chizildi", Boolean(omr?.url?.startsWith("data:image/png")) || Boolean(omr?.assetId), omr ? `${omr.w}×${omr.h}` : "yo'q"),
          ok("hisobot ≥ 55 ball", (review?.score ?? 0) >= 55, `${review?.score ?? 0} ball`),
          reviewRule(f, "keyMatchesVariants"),
          reviewRule(f, "oneCorrect"),
          ok("har savolda izoh", qs.every((q) => q.explanation.trim()), `${qs.filter((q) => !q.explanation.trim()).length} izohsiz`),
          suffixCheck(f, "-test"),
        ];
      },
    },
    {
      /*
       * Test (fayl rejimi) — `--source <fayl.docx>` SHART. Da'vo: savollar
       * MANBADAN chiqadi (`sourceGrounded` bandi iqtibosni manba matnidan
       * qidiradi), ya'ni «AI o'ylab topmaydi» va'dasi tekshiriladi.
       */
      name: "test-file",
      tool: "test",
      budgetMs: 420_000,
      values: { ...SCHOOL, topic: "Yuklangan matn bo'yicha", subject: "Biologiya", grade: 9, mode: "file", sourceAssetId: "live", testType: "nazorat", count: 15, variants: 2, omr: true },
      checks: (f, pages) => {
        const qs = f.doc.teacher?.test?.questions ?? [];
        const quoted = qs.filter((q) => q.source?.quote).length;
        return [
          ...teacherChecks(f, pages, "test"),
          ok("manba berildi", Boolean(sourceArg()), sourceArg() ?? "--source YO'Q — holat ma'nosiz"),
          ok("savollar 12+", qs.length >= 12, `${qs.length} ta`),
          ok("iqtibos bilan", quoted >= Math.ceil(qs.length * 0.8), `${quoted}/${qs.length} savolda manba iqtibosi`),
          reviewRule(f, "sourceGrounded"),
        ];
      },
    },
    {
      /*
       * Test (darslik rejimi) — rasmiy dastur mavzulari (fizika, 8-sinf).
       * Da'vo: har savol `topicId` bilan belgilanadi va `curriculumCoverage`
       * bandi tanlangan mavzularning HAMMASI qamralganini ko'radi.
       */
      name: "test-curriculum",
      tool: "test",
      budgetMs: 420_000,
      values: {
        ...SCHOOL,
        topic: "Elektr zaryad va elektr toki",
        subject: "Fizika",
        grade: 8,
        mode: "curriculum",
        subjectId: "fizika",
        topicIds: JSON.stringify(["elektr-zaryad-elektr-maydon-1", "elektr-zaryad-elektr-maydon-3", "elektr-zaryad-elektr-maydon-5", "elektr-toki-1", "elektr-toki-4"]),
        testType: "nazorat",
        count: 20,
        variants: 2,
        omr: true,
      },
      checks: (f, pages) => {
        const m = f.doc.teacher?.test;
        const qs = m?.questions ?? [];
        const tagged = qs.filter((q) => q.topicId).length;
        const covered = new Set(qs.map((q) => q.topicId).filter(Boolean)).size;
        return [
          ...teacherChecks(f, pages, "test"),
          ok("savollar 20", qs.length === 20, `${qs.length} ta`),
          ok("mavzu id belgilangan", tagged >= Math.ceil(qs.length * 0.8), `${tagged}/${qs.length}`),
          ok("5 mavzuning hammasi qamralgan", covered === 5, `${covered}/5 mavzu`),
          ok("topicIds modelda", (m?.topicIds.length ?? 0) === 5, (m?.topicIds ?? []).join(",")),
          reviewRule(f, "curriculumCoverage"),
        ];
      },
    },
  ];
}

/* ═════════════ 2-dastur — bosma o'yinlar + infografika (AUDIT-21) ═════════════ */

/**
 * Krossvord — ikkala holat (mavzu/fayl) bir xil da'volarni tekshiradi,
 * faqat manba tasdig'i (`fileMode`) qo'shiladi. `WP-B`/`WP-C` hali
 * ulanmagan bo'lsa (`buildGameDoc`/`buildInfographicArtifact` `null`
 * qaytaradi) `buildArtifact` xato tashlaydi va `runCase` buni «✘ XATO»
 * deb ANIQ ko'rsatadi — checks funksiyasi hech qachon soxta yashil
 * bermaydi, chunki u yiqilgan holatda umuman chaqirilmaydi.
 */
function crosswordChecks(f: BuiltFile, pages: number | null, o: { wordCount: number; fileMode?: boolean }): Check[] {
  const g = f.doc.game;
  const cw = g?.crossword;
  const words = cw?.words ?? [];
  const dropped = cw?.dropped ?? [];
  const grid = cw?.grid;
  const crossings = words.length ? countGridCrossings(words) : 0;
  const sectionIds = f.doc.sections.map((s) => s.id);
  const figures = g?.figures ?? [];
  const review = g?.review;
  const d = f.delivered;
  return [
    ok("doc.game.crossword bor", g?.kind === "crossword" && Boolean(cw), cw ? `${words.length} so'z, ${dropped.length} tashlangan` : "YO'Q — dvigatel ishlamadi"),
    ok(`so'z ${o.wordCount} (dropped ≤1)`, words.length >= o.wordCount - 1 && dropped.length <= 1, `${words.length} joylashdi, ${dropped.length} tashlandi`),
    ok("to'r ≤21×21", Boolean(grid) && grid!.rows <= 21 && grid!.cols <= 21, grid ? `${grid.rows}×${grid.cols}` : "yo'q"),
    ok("kesishma ≥ so'z/2", crossings >= Math.ceil(words.length / 2), `${crossings} kesishma / ${words.length} so'z`),
    ok("bo'limlar grid·across·down·answers", JSON.stringify(sectionIds) === JSON.stringify(CROSSWORD_SECTION_IDS), sectionIds.join(" · ")),
    ok("figure 2 ta (bo'sh + javob)", figures.length === 2, figures.map((x) => x.id).join(",") || "yo'q"),
    ok("hisobot ≥ 55 ball", (review?.score ?? 0) >= 55, review ? `${review.score} ball` : "yo'q"),
    ok("cost.calls > 0", (f.cost?.calls ?? 0) > 0, f.cost ? `${f.cost.calls} chaqiruv, ${f.cost.provider}/${f.cost.model}` : "yo'q"),
    ok("delivered joylashgan/so'ralgan mos", !d || d.got < d.want, d ? `${d.got}/${d.want} ${d.unit ?? ""} → farq qaytadi` : "to'liq yetkazildi (10/10)"),
    ok("DOCX 2–4 bet", pages === null || (pages >= 2 && pages <= 4), `${pages ?? "o'girilmadi"} bet`),
    suffixCheck(f, "-krossvord"),
    ...(o.fileMode ? [ok("manba berildi (so'zlar fayldan)", Boolean(sourceArg()), sourceArg() ?? "--source YO'Q — holat ma'nosiz")] : []),
  ];
}

function gameCases(): Case[] {
  return [
    {
      /* Krossvord — mavzu rejimi: «Fotosintez», 10 so'z, klassik. */
      name: "crossword",
      tool: "crossword",
      budgetMs: 180_000,
      values: { topic: "Fotosintez", subject: "Biologiya", grade: 7, language: "uz", mode: "topic", crosswordType: "klassik", wordCount: 10 },
      checks: (f, pages) => crosswordChecks(f, pages, { wordCount: 10 }),
    },
    {
      /* Krossvord — fayl rejimi: `--source <fayl.docx>` SHART; so'zlar manbadan olinishi kerak. */
      name: "crossword-file",
      tool: "crossword",
      budgetMs: 220_000,
      values: { topic: "Yuklangan matn bo'yicha", subject: "Biologiya", grade: 7, language: "uz", mode: "file", sourceAssetId: "live", crosswordType: "klassik", wordCount: 10 },
      checks: (f, pages) => crosswordChecks(f, pages, { wordCount: 10, fileMode: true }),
    },
    {
      /*
       * Flesh kartalar — WP-B (`games/flashcards/**`) hali yo'q:
       * `buildGameDoc` flashcards shoxi dinamik importda modulni
       * topolmay `null` qaytaradi, `buildArtifact` esa «AI javob
       * bermadi» xatosini tashlaydi. Holat shu bilan ANIQ yiqiladi —
       * WP-B ulangach checks o'zi ishga tushadi.
       */
      name: "flashcards",
      tool: "flashcards",
      budgetMs: 150_000,
      values: { topic: "Biologiya atamalari: hujayra", language: "uz", cardType: "term-def", cardCount: 10, includeExample: "ha" },
      checks: (f, pages) => {
        const g = f.doc.game;
        const cards = g?.cards?.cards ?? [];
        const bounds = cards.every(
          (c) =>
            c.front.length >= GAME_LIMITS.cardFrontCharsMin &&
            c.front.length <= GAME_LIMITS.cardFrontCharsMax &&
            c.back.length >= GAME_LIMITS.cardBackCharsMin &&
            c.back.length <= GAME_LIMITS.cardBackCharsMax,
        );
        const review = g?.review;
        const d = f.delivered;
        return [
          ok("doc.game.cards bor", g?.kind === "flashcards" && Boolean(g?.cards), cards.length ? `${cards.length} karta` : "YO'Q — dvigatel yo'q (WP-B)"),
          ok("kartalar 10", cards.length === 10, `${cards.length} ta`),
          ok("old/orqa yuz chegaralari", cards.length > 0 && bounds, cards.length ? "ichida" : "tekshirilmadi"),
          ok("misol qatori (includeExample=ha)", cards.length === 0 || cards.some((c) => c.example), cards.filter((c) => c.example).length + "/" + cards.length),
          ok("hisobot ≥ 55 ball", (review?.score ?? 0) >= 55, review ? `${review.score} ball` : "yo'q"),
          ok("cost.calls > 0", (f.cost?.calls ?? 0) > 0, f.cost ? `${f.cost.calls} chaqiruv` : "yo'q"),
          ok("delivered mos", !d || d.got < d.want, d ? `${d.got}/${d.want} ${d.unit ?? ""}` : "to'liq yetkazildi"),
          /*
           * BET SONI YUMSHOQ (egasi ko'rsatmasi): 2×4 karta = 4 bet (2 old
           * + 2 orqa, duplex) WP-B ning `drawCards`/`gameFlow` maketi
           * kelgach qat'iylashadi — hozircha faqat «bir nechta bet chiqdi».
           */
          ok("DOCX bet (yumshoq — WP-B maketi kelmaguncha)", pages === null || pages >= 1, `${pages ?? "o'girilmadi"} bet (mo'ljal 4 — 2 old + 2 orqa)`),
          suffixCheck(f, "-kartalar"),
        ];
      },
    },
    {
      /*
       * Saralash (AUDIT-22 WP-D/R) — «Toifalar bo'yicha» standart tur,
       * 4 toifa × 5 element = 20 (`GAME_LIMITS.categoryCountDefault` ×
       * `itemsPerCategoryDefault`). `GAME_MS.sorting` (160 s + 0,8 s/el)
       * ≈ 176 s — byudjet shundan sezilarli katta (baholovchi/sayqal
       * zaxirasi bilan).
       */
      name: "sorting",
      tool: "sorting",
      budgetMs: 260_000,
      values: { topic: "Hayvonlar tasnifi", subject: "Biologiya", grade: 5, language: "uz", sortingType: "toifa", categoryCount: 4, itemsPerCategory: 5 },
      checks: (f, pages) => sortingChecks(f, pages, { categoryCount: 4 }),
    },
    {
      /*
       * Tinglash (AUDIT-22 WP-D/R) — ona uz, o'rganiladigan en, 10 so'z,
       * 4 variant (`GAME_LIMITS.listeningOptionsDefault` — forma
       * maydoni YO'Q, reyestr standarti). `GAME_MS.listening` (160 s +
       * 9 s/topshiriq) ≈ 250 s.
       *
       * TTS kalitlari YO'Q (WP-A ochiq bandi): `putAsset` berilmasa
       * dvigatel sintezni UMUMAN chaqirmaydi (`index.ts` — behuda TTS
       * puli ketmasin), shuning uchun bu yerga ATAYLAB `putAsset`
       * BERILMAYDI — `audioAssetId` bo'sh chiqishi KUTILGAN va
       * `listeningChecks` buni YUMSHOQ (har doim yashil) tekshiradi.
       */
      name: "listening",
      tool: "listening",
      budgetMs: 320_000,
      values: { topic: "Kundalik hayot so'zlari", subject: "Ingliz tili", grade: 6, listeningType: "sozlar", nativeLanguage: "uz", targetLanguage: "en", itemCount: 10 },
      checks: (f, pages) => listeningChecks(f, pages, { itemCount: 10 }),
    },
  ];
}

/**
 * Saralash — model + hisobot + fayl. `WP-D`/`R` ulangan (STUB emas):
 * checks har doim chaqiriladi, dvigatel yiqilsa `buildArtifact` xato
 * tashlaydi va `runCase` buni «✘ XATO» deb ko'rsatadi (WP-B naqshi).
 */
function sortingChecks(f: BuiltFile, pages: number | null, o: { categoryCount: number }): Check[] {
  const g = f.doc.game;
  const m = g?.sorting;
  const categories = m?.categories ?? [];
  const allItems = categories.flatMap((c) => c.items);
  const uniqueItems = new Set(allItems.map((s) => s.trim().toLowerCase()));
  const sectionIds = f.doc.sections.map((s) => s.id);
  const review = g?.review;
  const d = f.delivered;
  return [
    ok("doc.game.sorting bor", g?.kind === "sorting" && Boolean(m), m ? `${categories.length} toifa, ${allItems.length} element` : "YO'Q — dvigatel ishlamadi"),
    ok(`toifa ${o.categoryCount}`, categories.length === o.categoryCount, `${categories.length} ta`),
    // MUTATSIYA (`pickCategories`): element ikki toifada takrorlansa o'yin yechilmaydigan bo'ladi.
    ok("elementlar NOYOB (butun o'yinda)", allItems.length > 0 && uniqueItems.size === allItems.length, `${uniqueItems.size}/${allItems.length}`),
    ok("bo'limlar intro·sorting·answers", JSON.stringify(sectionIds) === JSON.stringify(["intro", "sorting", "answers"]), sectionIds.join(" · ")),
    ok("hisobot ≥ 55 ball", (review?.score ?? 0) >= 55, review ? `${review.score} ball` : "yo'q"),
    ok("cost.calls > 0", (f.cost?.calls ?? 0) > 0, f.cost ? `${f.cost.calls} chaqiruv, ${f.cost.provider}/${f.cost.model}` : "yo'q"),
    ok("delivered mos", !d || d.got < d.want, d ? `${d.got}/${d.want} ${d.unit ?? ""}` : "to'liq yetkazildi"),
    ok("DOCX 2–3 bet", pages === null || (pages >= 2 && pages <= 3), `${pages ?? "o'girilmadi"} bet`),
    suffixCheck(f, "-saralash"),
  ];
}

/**
 * Tinglash — model + hisobot + fayl. `audioAssetId` YUMSHOQ: kalitsiz
 * muhitda 0 ta ham YASHIL (WP-A kalitlari kelgach shu son > 0 bo'lishi
 * kutiladi — o'sha paytda tekshiruv qo'lda kuchaytiriladi).
 */
function listeningChecks(f: BuiltFile, pages: number | null, o: { itemCount: number }): Check[] {
  const g = f.doc.game;
  const m = g?.listening;
  const items = m?.items ?? [];
  const inRange = items.length > 0 && items.every((it) => it.answer >= 0 && it.answer < it.options.length);
  const withAudio = items.filter((it) => it.audioAssetId).length;
  const sectionIds = f.doc.sections.map((s) => s.id);
  const review = g?.review;
  const d = f.delivered;
  return [
    ok("doc.game.listening bor", g?.kind === "listening" && Boolean(m), m ? `${items.length} topshiriq` : "YO'Q — dvigatel ishlamadi"),
    ok(`topshiriq ${o.itemCount}`, items.length === o.itemCount, `${items.length} ta`),
    // MUTATSIYA (`answerInRange`): indeks chegaradan chiqsa o'yin har javobni «xato» deb sanardi.
    ok("javob diapazonda (answer < options.length)", inRange, inRange ? "hammasi ichida" : "chegaradan chiqdi"),
    ok("variant 4 tadan", items.every((it) => it.options.length === GAME_LIMITS.listeningOptionsDefault), items.map((it) => it.options.length).join(",")),
    ok("audioAssetId (TTS kalitsiz — yumshoq)", true, `${withAudio}/${items.length} audio bilan`),
    ok("bo'limlar intro·items·answers", JSON.stringify(sectionIds) === JSON.stringify(["intro", "items", "answers"]), sectionIds.join(" · ")),
    ok("hisobot ≥ 55 ball", (review?.score ?? 0) >= 55, review ? `${review.score} ball` : "yo'q"),
    ok("cost.calls > 0", (f.cost?.calls ?? 0) > 0, f.cost ? `${f.cost.calls} chaqiruv` : "yo'q"),
    ok("delivered mos", !d || d.got < d.want, d ? `${d.got}/${d.want} ${d.unit ?? ""}` : "to'liq yetkazildi"),
    ok("DOCX render", pages === null || pages >= 1, `${pages ?? "o'girilmadi"} bet`),
    suffixCheck(f, "-tinglash"),
  ];
}

/**
 * Media (AUDIT-22 WP-A) — podkast va tabriknoma.
 *
 * TTS KALITLARI HALI YO'Q (`AZURE_SPEECH_KEY`+`AZURE_SPEECH_REGION`,
 * `AISHA_API_KEY` — egasidan, WP-A ochiq bandi 1). Dvigatel (`audio/
 * engine.ts`) buni SSENARIYDAN OLDIN tekshiradi va ANIQ xato tashlaydi
 * («Ovoz provayderi sozlanmagan. Administrator bilan bog'laning — to'lov
 * qaytarildi.») — `runCase` buni «✘ XATO» deb ko'rsatadi, LLM puli
 * sarflanmaydi. `audioChecks` shuning uchun HOZIR ishga tushmaydi;
 * kalitlar kelgach checks o'zi ishlay boshlaydi (WP-B/WP-D naqshi).
 */
function audioChecks(f: BuiltFile, o: { minutes: number }): Check[] {
  const a = f.doc.audio;
  const script = a?.script ?? [];
  const words = script.reduce((n, l) => n + l.text.trim().split(/\s+/).filter(Boolean).length, 0);
  const wantSeconds = o.minutes * 60;
  const d = f.delivered;
  return [
    ok("doc.audio bor", Boolean(a) && script.length > 0, script.length ? `${script.length} replika` : "YO'Q — dvigatel/provayder yo'q"),
    ok("MP3 fayl bor", f.mime === "audio/mpeg" && f.bytes.byteLength > 0, `${f.mime}, ${Math.round(f.bytes.byteLength / 1024)} KB`),
    ok("doc.audio.script bo'sh emas", words > 0, `${words} so'z`),
    ok(`seconds ≥ 0.8×${o.minutes}×60`, (a?.seconds ?? 0) >= 0.8 * wantSeconds, a?.seconds ? `${a.seconds} s (kerak ≥ ${Math.round(0.8 * wantSeconds)} s)` : "yo'q — TTS ishlamadi"),
    ok("cost.tts bor (LLM+TTS yig'indisi)", (f.cost?.calls ?? 0) > 0 && (f.cost?.usd ?? 0) > 0, f.cost ? `${f.cost.calls} chaqiruv, $${f.cost.usd}, ${f.cost.provider}` : "yo'q"),
    ok("delivered mos", !d || d.got < d.want, d ? `${d.got}/${d.want} ${d.unit ?? ""}` : "to'liq yetkazildi"),
  ];
}

function audioCases(): Case[] {
  return [
    {
      name: "podcast",
      tool: "podcast",
      budgetMs: 240_000,
      values: { topic: "Sun'iy intellekt ta'limda", mode: "topic", podcastType: "tushuntirish", durationMin: 1, language: "uz" },
      checks: (f) => audioChecks(f, { minutes: 1 }),
    },
    {
      name: "greeting",
      tool: "greeting",
      budgetMs: 180_000,
      values: { recipient: "Dilnoza opa", relation: "ustozim", occasion: "tugilgan-kun", durationMin: 1, language: "uz" },
      checks: (f) => audioChecks(f, { minutes: 1 }),
    },
  ];
}

/**
 * Infografika — WP-C (`infographic/engine.ts`) hali STUB (`null`):
 * `buildArtifact` «Infografika yaratilmadi» xatosini tashlaydi va holat
 * shu bilan yiqiladi. Ulangach PNG o'lchamini `sharp` bilan HAQIQIY
 * o'qiydi (A4 @300 dpi ≈ 2480×3508 px, ±2 % — DOCX/PDF o'girmasidan
 * FARQLI, bu yerda `pageCount` ishlamaydi: chiqish rasm, PDF emas).
 */
function infographicCase(): Case {
  return {
    name: "infographic",
    tool: "infographic",
    budgetMs: 150_000,
    values: { topic: "Suv aylanishi", infographicType: "process", blockCount: 5, palette: "indigo", size: "A4", language: "uz" },
    checks: async (f) => {
      const spec = f.doc.infographic?.spec;
      const review = f.doc.infographic?.review;
      let dims = "o'qilmadi";
      let dimsOk = false;
      try {
        const meta = await sharp(f.bytes).metadata();
        const wantW = 2480;
        const wantH = 3508;
        dimsOk = Boolean(meta.width && meta.height) && Math.abs(meta.width! - wantW) / wantW <= 0.02 && Math.abs(meta.height! - wantH) / wantH <= 0.02;
        dims = `${meta.width}×${meta.height} (mo'ljal ${wantW}×${wantH})`;
      } catch (e) {
        dims = e instanceof Error ? e.message : String(e);
      }
      return [
        ok("PNG fayl bor", f.bytes.byteLength > 0 && f.mime === "image/png", `${Math.round(f.bytes.byteLength / 1024)} KB, ${f.mime}`),
        ok("A4 @300dpi ≈2480×3508 px (±2%)", dimsOk, dims),
        ok("doc.infographic.spec.blocks 5", (spec?.blocks.length ?? 0) === 5, `${spec?.blocks.length ?? 0} blok`),
        ok("hisobot ≥ 55 ball", (review?.score ?? 0) >= 55, review ? `${review.score} ball` : "yo'q"),
        ok("cost.calls > 0", (f.cost?.calls ?? 0) > 0, f.cost ? `${f.cost.calls} chaqiruv` : "yo'q"),
      ];
    },
  };
}

/**
 * `scripts/slide-audit.mts` (AUDIT-25 P5) — reja qamrovi, tartib raqami
 * sizishi, uydirma raqamlar, yupqa mazmun, blok tartibi ustidan bitta
 * o'qish. Har xil `kind` bitta ALOHIDA "✘" bandiga aylanadi (nuqson
 * bo'lmasa — bitta "✔ slide-audit"), ya'ni `slide`/`pro-slide`
 * holatlarining checks ro'yxati yiqilish sababini ANIQ ko'rsatadi.
 */
function slideAuditChecks(doc: AcademicDoc): Check[] {
  const { issues } = auditSlideDoc(doc);
  if (issues.length === 0) return [ok("slide-audit", true, "reja/mazmun nuqsonsiz")];
  const kinds = Array.from(new Set(issues.map((i) => i.kind)));
  return kinds.map((kind) => {
    const forKind = issues.filter((i) => i.kind === kind);
    const detail = forKind.map((i) => `#${i.slide || "?"} ${i.detail}`).join(" | ");
    return ok(`slide-audit:${kind}`, false, detail.length > 240 ? `${detail.slice(0, 240)}…` : detail);
  });
}

/**
 * Slayd holatlari (AUDIT-25 P5) — `slide`/`pro-slide` PARITET keyslari
 * (yuqorida edi, endi shu yerga ko'chdi) + egasining haqiqiy
 * foydalanish naqshlarini oynalaydigan yangi 5 ta: dars/ma'ruza/hisobot
 * (oddiy slayd), ochiq dars (pro) va min-slayd sig'im qisqartirishi
 * (pro). Har biri `slideAuditChecks` bilan tugaydi — S1–S4 (AUDIT-25 §1)
 * regressiyaga qaytmasligi shu orqali kafolatlanadi.
 */
function slideCases(): Case[] {
  return [
    {
      /*
       * Pro-slayd: har parametr ta'sir qilishi shart (AUDIT-9). Bu keys
       * brifni to'liq beradi — auditoriya, tur, bloklar, test, internet,
       * izohsiz → «Javoblar» slaydi, logo yo'q (worker beradi).
       */
      name: "pro-slide",
      tool: "pro-slide",
      budgetMs: 400_000,
      values: {
        topic: "Orol dengizi fojiasi va uni tiklash choralari",
        slideAudience: "school_8_9",
        slidePurpose: "open_lesson",
        blocks: "reja,maqsadlar,motivatsiya,amaliyot,test,uyga_vazifa,adabiyotlar",
        planItems: 4,
        slideCount: 10,
        subject: "Geografiya",
        language: "uz",
        slideImageStyle: "illustration",
        author: "Karimova Nilufar",
        position: "Geografiya o‘qituvchisi",
        organization: "Toshkent shahar 12-maktab",
        keyIdeas: "Orol qurishi inson faoliyati oqibati\nOrolbo‘yida saksovul ekish\nSuvni tejash har kimga bog‘liq",
        localExamples: true,
        internetSearch: true,
        quizCount: 3,
        speakerNotes: false,
        titleSlide: true,
        agendaSlide: true,
        textVolume: "standart",
      },
      checks: (file) => {
        const slides = file.doc.slides ?? [];
        const layouts = slides.map((s) => s.layout);
        const research = file.doc.slideResearch;
        const quiz = slides.filter((s) => s.layout === "quiz");
        const leaked = quiz.filter((s) => (s.quiz ?? []).length === 0);
        return [
          ok("slaydlar soni", slides.length === 10, `${slides.length} / 10`),
          ok("reja bandlari", (slides.find((s) => s.layout === "agenda")?.bullets?.length ?? 0) === 4, `${slides.find((s) => s.layout === "agenda")?.bullets?.length ?? 0} band`),
          ok("test slaydi", quiz.length >= 1 && leaked.length === 0, `${quiz.length} ta quiz, bo'sh: ${leaked.length}`),
          ok("javoblar slaydi", layouts.includes("answers"), layouts.join(" › ")),
          ok("adabiyotlar", layouts.includes("references"), ""),
          ok("internet manbalari", !!research && research.sources.length > 0, `${research?.sources.length ?? 0} manba, ${research?.queries.length ?? 0} so'rov`),
          /*
           * Izoh o'chiq bo'lsa javoblar `notes` da QOLADI (ular «Javoblar»
           * slaydidan tashqari zaxira), lekin FAYLGA tushmasligi kerak —
           * shuni `slideNotes` bilan tekshiramiz, xom maydon bilan emas.
           */
          ok("izoh fayldan chiqmaydi", slides.every((s) => slideNotes(s, false) === ""), ""),
          ok("rasm bor", slides.some((s) => !!s.image), `${slides.filter((s) => !!s.image).length} rasm`),
          ok("footer", slides.some((s) => (s.footer ?? "").includes("Karimova")), slides[1]?.footer ?? ""),
          ...slideAuditChecks(file.doc),
        ];
      },
    },
    {
      /*
       * Oddiy slayd — PARITET keysi: yangi maydonlar (auditoriya, tur,
       * matn hajmi, test, internet, reja bandlari, izoh) shu vositada
       * ham ishlashi kerak, narx esa paketlarda qoladi.
       */
      name: "slide",
      tool: "slide",
      budgetMs: 260_000,
      values: {
        topic: "Kasr sonlarni qo‘shish va ayirish",
        slideAudience: "school_5_7",
        slidePurpose: "lesson",
        planItems: 3,
        quality: "standard",
        language: "uz",
        textVolume: "qisqa",
        quizCount: 3,
        internetSearch: false,
        speakerNotes: true,
        subject: "Matematika",
        author: "Sobirov Anvar",
        organization: "45-maktab",
      },
      checks: (file) => {
        const slides = file.doc.slides ?? [];
        const layouts = slides.map((s) => s.layout);
        const body = slides.filter((s) => (s.bullets ?? []).length);
        const chars = body.flatMap((s) => s.bullets ?? []).map((b) => b.length);
        const avg = chars.length ? Math.round(chars.reduce((a, b) => a + b, 0) / chars.length) : 0;
        return [
          ok("slaydlar", slides.length >= 8, `${slides.length} ta`),
          ok("test slaydi", layouts.includes("quiz"), layouts.join(" › ")),
          ok("javob izohda", slides.some((s) => /Javob/i.test(s.notes ?? "")), ""),
          ok("javoblar slaydi YO‘Q", !layouts.includes("answers"), "izoh yoqiq — kalit izohda"),
          ok("qisqa matn", avg > 0 && avg <= 120, `o‘rtacha ${avg} belgi/band`),
          ok("maktab shrifti", true, "maket testlarida qulflangan"),
          ok("manbasiz", !file.doc.slideResearch, "internet o‘chiq"),
          ...slideAuditChecks(file.doc),
        ];
      },
    },
    {
      /* Dars (lesson) — oddiy slayd, 10 ta, 4 bandli reja — eng ko'p uchraydigan haqiqiy foydalanish. */
      name: "slide-lesson",
      tool: "slide",
      budgetMs: 260_000,
      values: {
        topic: "Suv aylanish jarayoni tabiatda",
        slideAudience: "school_5_7",
        slidePurpose: "lesson",
        planItems: 4,
        slideCount: 10,
        language: "uz",
        textVolume: "standart",
        subject: "Tabiatshunoslik",
        author: "Yusupova Zarina",
        organization: "22-maktab",
        titleSlide: true,
        agendaSlide: true,
      },
      checks: (file) => {
        const slides = file.doc.slides ?? [];
        const agenda = slides.find((s) => s.layout === "agenda");
        return [
          ok("slaydlar soni", slides.length === 10, `${slides.length} / 10`),
          ok("reja bandlari 4", (agenda?.bullets?.length ?? 0) === 4, `${agenda?.bullets?.length ?? 0} band`),
          ...slideAuditChecks(file.doc),
        ];
      },
    },
    {
      /* Ma'ruza (lecture) — 12 slayd, 5 bandli reja, test YO'Q (lecture standart bloklarida `test` yo'q). */
      name: "slide-lecture",
      tool: "slide",
      budgetMs: 300_000,
      values: {
        topic: "Kvant fizikasi asoslari",
        slideAudience: "students_bachelor",
        slidePurpose: "lecture",
        planItems: 5,
        slideCount: 12,
        language: "uz",
        textVolume: "standart",
        subject: "Fizika",
        author: "Rahimov Bahodir",
        organization: "TATU",
        titleSlide: true,
        agendaSlide: true,
      },
      checks: (file) => {
        const slides = file.doc.slides ?? [];
        const layouts = slides.map((s) => s.layout);
        const agenda = slides.find((s) => s.layout === "agenda");
        return [
          ok("slaydlar soni", slides.length === 12, `${slides.length} / 12`),
          ok("reja bandlari 5", (agenda?.bullets?.length ?? 0) === 5, `${agenda?.bullets?.length ?? 0} band`),
          ok("test YO'Q (lecture standart blokida test yo'q)", !layouts.includes("quiz"), layouts.join(" › ")),
          ...slideAuditChecks(file.doc),
        ];
      },
    },
    {
      /*
       * Ochiq dars (pro) — attestatsiya naqshi: izoh o'chiq, internet
       * o'chiq, 3 ta test. Rasm: `slideImageStyle` reyestrida ("minimal
       * / illustration / chalk / photo") «rasmsiz» variant YO'Q — shu
       * sabab rasm YOQIQ qoladi (AUDIT-25 P5 topshirig'i: «"none" bo'lsa
       * — aks holda rasmni saqlash»); pro-slayd rasm HAR doim urinadi.
       */
      name: "pro-slide-open-lesson",
      tool: "pro-slide",
      budgetMs: 380_000,
      values: {
        topic: "Ozon qatlami va uni asrash",
        slideAudience: "school_8_9",
        slidePurpose: "open_lesson",
        planItems: 4,
        slideCount: 12,
        subject: "Kimyo",
        language: "uz",
        slideImageStyle: "minimal",
        author: "Nazarova Feruza",
        position: "Kimyo o‘qituvchisi",
        organization: "7-maktab",
        quizCount: 3,
        speakerNotes: false,
        internetSearch: false,
        titleSlide: true,
        agendaSlide: true,
        textVolume: "standart",
      },
      checks: (file) => {
        const slides = file.doc.slides ?? [];
        const agenda = slides.find((s) => s.layout === "agenda");
        const quiz = slides.filter((s) => s.layout === "quiz");
        return [
          ok("slaydlar soni", slides.length === 12, `${slides.length} / 12`),
          ok("reja bandlari 4", (agenda?.bullets?.length ?? 0) === 4, `${agenda?.bullets?.length ?? 0} band`),
          ok("test 3 ta atrofida", quiz.length >= 1, `${quiz.length} quiz slayd`),
          ok("izoh o'chiq — fayldan chiqmaydi", slides.every((s) => slideNotes(s, false) === ""), ""),
          ok("internet o'chiq — manba yo'q", !file.doc.slideResearch, ""),
          ok("rasm YOQIQ (\"none\" varianti yo'q)", slides.some((s) => !!s.image), `${slides.filter((s) => !!s.image).length} rasm`),
          ...slideAuditChecks(file.doc),
        ];
      },
    },
    {
      /* Hisobot (report) — oddiy slayd, 8 ta, 3 bandli reja; standart bloklarda diagramma(stats)+jadval bor. */
      name: "slide-report",
      tool: "slide",
      budgetMs: 240_000,
      values: {
        topic: "2025-yil o'quv yili natijalari tahlili",
        slideAudience: "management",
        slidePurpose: "report",
        planItems: 3,
        slideCount: 8,
        language: "uz",
        textVolume: "standart",
        subject: "Boshqaruv",
        author: "Tosheva Madina",
        organization: "14-maktab",
        titleSlide: true,
        agendaSlide: true,
      },
      checks: (file) => {
        const slides = file.doc.slides ?? [];
        const layouts = slides.map((s) => s.layout);
        const agenda = slides.find((s) => s.layout === "agenda");
        return [
          ok("slaydlar soni", slides.length === 8, `${slides.length} / 8`),
          ok("reja bandlari 3", (agenda?.bullets?.length ?? 0) === 3, `${agenda?.bullets?.length ?? 0} band`),
          ok("diagramma (stats) bor", layouts.includes("stats"), layouts.join(" › ")),
          ok("jadval bor", layouts.includes("table"), layouts.join(" › ")),
          ...slideAuditChecks(file.doc),
        ];
      },
    },
    {
      /*
       * Min-slayd sig'im qisqartirishi (AUDIT-25 §2.3 `planCapacity`):
       * 4 slayd (PRO_SLIDE_MIN) so'ralib, 6 bandli reja (PLAN_ITEMS_MAX)
       * so'raladi — buncha band 4 slaydga jismonan sig'maydi. Dvigatel
       * `planItems`ni sig'imga QISQARTIRISHI kerak (preflight xato EMAS),
       * natija baribir REJA=MAZMUN shartnomasiga to'liq mos bo'lishi
       * kerak — buni `slideAuditChecks` (`plan-coverage`) o'zi ushlaydi:
       * qisqartirilmagan bo'lsa, qolgan reja bandlari mazmunsiz qoladi.
       */
      name: "pro-slide-min",
      tool: "pro-slide",
      budgetMs: 220_000,
      values: {
        topic: "Ma'lumotlar bazasi asoslari",
        slideAudience: "students_bachelor",
        slidePurpose: "lecture",
        /*
         * REVIEW item 6(b): lecture'ning standart bloklari
         * `reja,maqsadlar,adabiyotlar` — `adabiyotlar` `YIELDING_BLOCKS`da
         * yo'q (`slide-blocks.ts:116`), ya'ni 4 slaydda (title+agenda+
         * closing = 3 tizim o'rni qoladi 1ga) sig'im 0 bo'lib qolar edi —
         * bu P1'ning [1,0] chekkasini, klemp'ni EMAS sinaydi. `blocks:
         * "reja"` bilan sig'im 1 bo'ladi: «6 so'ralib, 1gacha qisqartirildi,
         * 4 slaydda TO'LIQ qamrov» — haqiqiy clamp sinovi.
         */
        blocks: "reja",
        planItems: 6,
        slideCount: 4,
        subject: "Informatika",
        language: "uz",
        slideImageStyle: "minimal",
        author: "Qodirov Sardor",
        organization: "TATU",
        titleSlide: true,
        agendaSlide: true,
        textVolume: "qisqa",
      },
      checks: (file) => {
        const slides = file.doc.slides ?? [];
        const agenda = slides.find((s) => s.layout === "agenda");
        const planTotal = agenda?.bullets?.length ?? 0;
        const v = { tool: "pro-slide", blocks: "reja", slideCount: 4, planItems: 6, titleSlide: true };
        const expectedPlan = effectivePlanItems(6, planCapacity(v), 4);
        return [
          ok("slaydlar soni = 4 (PRO_SLIDE_MIN)", slides.length === 4, `${slides.length} / 4`),
          /*
           * REVIEW item 6(a): `planTotal <= 6` chegarasi klemp BO'LMASA ham
           * o'tardi (`PLAN_ITEMS_MAX` allaqachon 6 bilan cheklaydi — bu
           * sig'im qisqartirishni SINAMAYDI). `< 6` qat'iy — faqat haqiqiy
           * qisqartirilganda o'tadi.
           * P1 birlashgach: kutilgan son AYNAN dvigatel formulasidan —
           * `effectivePlanItems(6, planCapacity(values), 4)`.
           */
          ok(
            "reja sig'imga qisqartirilgan (= effectivePlanItems)",
            planTotal === expectedPlan,
            `${planTotal} band (so'ralgan 6, sig'im ${expectedPlan})`,
          ),
          ...slideAuditChecks(file.doc),
        ];
      },
    },
  ];
}

const CASES: Case[] = [
  {
    /*
     * Rezyume 2 (AUDIT-15): tuzilmali kirish → LLM qayta yozadi va
     * tartiblaydi. Eng muhim da'vo — MODEL FAKT O'YLAB TOPMASLIGI:
     * kompaniya nomlari verbatim, kirishda yo'q yil yo'q.
     * `--enrich off` bilan ikkinchi yugurish `ai` bandlarni butunlay
     * yo'qotishi kerak.
     */
    name: "resume",
    tool: "resume",
    budgetMs: 150_000,
    values: {
      ...RESUME_VALUES,
      language: langArg(),
      enrich: !process.argv.includes("--enrich-off"),
      // `--resume-template <id>` — AUDIT-16 da 10 shablon; suratsiz (`ats`,
      // `timeline`, `compact`, `letter`) + `--photo` = surat tushMASligi kerak.
      resumeTemplate: resumeTemplateArg(),
      resumePalette: "ember",
    },
    checks: (f, pages) => {
      const m = f.doc.resume;
      const enrich = !process.argv.includes("--enrich-off");
      const bullets = m?.experience.flatMap((e) => e.bullets) ?? [];
      const aiCount = bullets.filter((b) => b.ai).length + (m?.skills.filter((s) => s.ai).length ?? 0);
      const text = JSON.stringify(m ?? {});
      const strayYear = (text.match(/\b(19|20)\d{2}\b/g) ?? []).find((y) => !RESUME_YEARS.has(y));
      const perRow = m?.experience.map((e) => e.bullets.filter((b) => b.ai).length) ?? [];
      return [
        ok("model bor", Boolean(m), m ? `${m.experience.length} ish joyi, ${m.skills.length} ko'nikma` : "yo'q"),
        /*
         * Uzunlik YOZUV TIZIMIGA bog'liq: 209 ta yapon belgisi inglizcha
         * ~450 belgiga teng ma'lumot beradi. Chegara dvigatel bilan
         * BITTA manbadan (`summaryLimits`) olinadi — aks holda jonli
         * sinov modelni to'g'ri yozgani uchun yiqitardi.
         */
        ok(
          `summary ≥ ${minSummaryChars(langArg())}`,
          (m?.summary.length ?? 0) >= minSummaryChars(langArg()) && (m?.summary.length ?? 0) <= summaryLimits(langArg()).promptMax + 120,
          `${m?.summary.length ?? 0} belgi (til ${langArg()})`,
        ),
        ok("kompaniya verbatim", Boolean(m) && ["Artel Electronics", "Korzinka"].every((c) => m!.experience.some((e) => e.company === c)), m?.experience.map((e) => e.company).join(" | ") ?? ""),
        ok("sana o'zgarmagan", m?.experience[0]?.end === "now" && m?.experience.some((e) => e.start === "2019-08"), m?.experience.map((e) => `${e.start}→${e.end}`).join(" ") ?? ""),
        ok("uydirma yil yo'q", !strayYear, strayYear ? `topildi: ${strayYear}` : "toza"),
        ok("xronologik tartib", (m?.experience[0]?.end ?? "") === "now", m?.experience.map((e) => e.end).join(",") ?? ""),
        ok(enrich ? "AI bandlar bor" : "AI bandlar yo'q", enrich ? aiCount > 0 : aiCount === 0, `${aiCount} ta ai`),
        ok("AI shifti (≤2/ish joyi)", perRow.every((n) => n <= 2), perRow.join(",")),
        ok("yorliq tili", Boolean(m) && m!.labels.experience.length > 0, `${m?.labels.experience} · ${m?.labels.education}`),
        ok("chiqish tili", m?.language === langArg(), String(m?.language)),
        ok("shablon saqlandi", m?.template === resumeTemplateArg(), String(m?.template)),
        ok(
          templateHasPhoto(resumeTemplateArg()) ? "surat modelda (suratli shablon)" : "surat modelda YO'Q (suratsiz shablon)",
          templateHasPhoto(resumeTemplateArg()) ? !photoArg() || Boolean(m?.photo?.url) : !m?.photo,
          m?.photo ? `surat: ${m.photo.shape}` : "surat yo'q",
        ),
        ok("DOCX 1–2 bet", pages === null || (pages >= 1 && pages <= 2), `${pages ?? "?"} bet`),
      ];
    },
  },
  {
    /* Tarjimon 2: matn rejimi — aniqlangan til, glossariy, raqam/URL saqlanishi, `translation` profil. */
    name: "translation-text",
    tool: "translation",
    budgetMs: 200_000,
    values: { mode: "text", sourceText: TRANSLATION_SAMPLE, language: "en", sourceLang: "avto", style: "formal" },
    checks: (f, pages) => {
      const t = f.doc.translation;
      const pair = t?.pairs.find((p) => p.src.includes("1 250"));
      return [
        ok("hisobot bor", Boolean(t), t ? `${t.translated}/${t.segments} band` : "yo'q"),
        ok("aniqlangan til uz", t?.detected === "uz", String(t?.detected)),
        ok("glossariy", (t?.glossary.length ?? 0) >= 3, `${t?.glossary.length ?? 0} atama`),
        ok("hamma band tarjima", Boolean(t) && t!.pairs.every((p) => p.dst.trim() && p.dst !== p.src), "asl bilan bir xil emas"),
        ok("raqam saqlangan", Boolean(pair) && pair!.dst.replace(/\D/g, "").includes("1250"), pair?.dst.slice(0, 80) ?? "juft topilmadi"),
        ok("URL saqlangan", Boolean(t?.pairs.some((p) => p.dst.includes("https://aral.uz"))), ""),
        ok("ogohlantirish yo'q", (t?.warnings.length ?? 0) === 0, (t?.warnings ?? []).map((w) => w.code).join(",") || "toza"),
        ok("DOCX 1+ bet", (pages ?? 1) >= 1, `${pages ?? "?"} bet`),
      ];
    },
  },
  {
    /* Tarjimon 2: fayl rejimi — `--source <fayl>` shart; chiqish = kirish formati, sahifa soni teng. */
    name: "translation-file",
    tool: "translation",
    budgetMs: 400_000,
    values: { mode: "file", sourceAssetId: "live", language: process.env.LIVE_TARGET || "en", sourceLang: "avto", style: "formal" },
    checks: (f, pages) => {
      const t = f.doc.translation;
      const src = sourceArg();
      const wantExt = src ? (sourceKindOf(src) === "pdf" ? "docx" : sourceKindOf(src)) : "";
      return [
        ok("hisobot bor", Boolean(t), t ? `${t.translated}/${t.segments} band, ${t.chars} belgi` : "yo'q"),
        ok("chiqish formati = kirish", f.fileName.toLowerCase().endsWith(`.${wantExt}`), f.fileName),
        ok("hamma band tarjima", Boolean(t) && t!.pairs.every((p) => p.dst.trim()), ""),
        ok("ogohlantirishlar", true, (t?.warnings ?? []).map((w) => `${w.code}`).join(",") || "yo'q"),
        ok("PDF sahifa", pages !== null, `${pages ?? "o'girilmadi"} bet (asl bilan qo'lda solishtiring)`),
      ];
    },
  },
  /*
   * ── Maqola 2 (AUDIT-17) — 4 jonli holat. `--article-type <id>` va
   * `--profile <id>` bayroqlari istalgan holatning turi/profilini bekor
   * qiladi. Da'volar: `doc.article` bor; iqtiboslar 100% reyestrda
   * (`verifyCitations` unresolved bo'sh); ro'yxatda faqat cited va
   * tekshirilgan manbalar; annotatsiya 3 ta × profil chegarasida; kalit
   * so'zlar chegarada; titul/mundarija YO'Q; sxema SPEC bor; `cost.calls>0`.
   */
  {
    /* OAK: imrad_oak · uz · oak · 10–15 bet · natijalar + o'z manbalari (haqiqiy DOI). */
    name: "article-oak",
    tool: "article",
    budgetMs: 150_000 + 13 * 16_000,
    values: {
      topic: "Sun’iy intellekt asosidagi adaptiv o‘qitish tizimlarining oliy ta’limdagi samaradorligi",
      articleType: articleTypeArg("imrad_oak"),
      pubProfile: profileArg("oak"),
      language: "uz",
      pages: "10-15",
      authors: JSON.stringify([
        { name: "Karimova Dilnoza Baxtiyorovna", degree: "PhD, dotsent", org: "Toshkent davlat iqtisodiyot universiteti", email: "d.karimova@tsue.uz", orcid: "0000-0002-1825-0097" },
        { name: "Aliyev Ali Valiyevich", degree: "magistrant", org: "Toshkent davlat iqtisodiyot universiteti" },
      ]),
      udk: "004.8:378",
      keywords: JSON.stringify(["sun’iy intellekt", "adaptiv o‘qitish", "oliy ta’lim", "o‘zlashtirish", "baholash"]),
      userFacts: "2024/2025 o‘quv yilida TDIU da 120 talaba ishtirokidagi tajriba o‘tkazildi: tajriba guruhi (n=60) adaptiv platformada, nazorat guruhi (n=60) an’anaviy usulda o‘qidi. Tajriba guruhida o‘rtacha ball 4,1 dan 4,6 ga oshdi, nazorat guruhida 4,1 dan 4,2 ga. Mashg‘ulotga sarflangan o‘rtacha vaqt haftasiga 6,5 soatdan 5,2 soatga kamaydi.",
      userRefs: JSON.stringify([{ doi: "10.1186/s40561-023-00260-y" }, { raw: "Karimov A. Ta’limda raqamli texnologiyalar. — Toshkent: Fan, 2022. — 240 b." }]),
      userData: JSON.stringify({ categories: ["Boshlang‘ich", "Oraliq", "Yakuniy"], series: [{ name: "Tajriba guruhi", values: [4.1, 4.4, 4.6] }, { name: "Nazorat guruhi", values: [4.1, 4.15, 4.2] }], unit: "ball" }),
      figureCount: 2,
      research: true,
    },
    checks: (f, pages) => articleChecks(f, pages, { pagesMin: 10 }),
  },
  {
    /* Sistematik sharh: review_systematic · en · apa · PRISMA majburiy · structured annotatsiya. */
    name: "article-review",
    tool: "article",
    budgetMs: 150_000 + 8 * 16_000,
    values: {
      topic: "Large language models as tutoring agents in higher education: effects on learning outcomes",
      articleType: articleTypeArg("review_systematic"),
      pubProfile: profileArg("apa"),
      language: "en",
      pages: "5-10",
      authors: JSON.stringify([{ name: "Dilnoza Karimova", org: "Tashkent State University of Economics", orcid: "0000-0002-1825-0097" }]),
      keywords: JSON.stringify(["large language models", "intelligent tutoring", "higher education", "learning outcomes"]),
      figureCount: 1,
      research: true,
    },
    checks: (f, pages) => [
      ...articleChecks(f, pages, { pagesMin: 5 }),
      ok("PRISMA sxemasi", Boolean(f.doc.article?.figures.some((x) => x.spec.kind === "prisma")), f.doc.article?.figures.map((x) => x.spec.kind).join(",") ?? "—"),
      ok("structured annotatsiya", (f.doc.abstracts ?? []).every((a) => /^Background: |^Maqsad: |^Цель: /m.test(a.text)), f.doc.abstracts?.[0]?.text.slice(0, 40) ?? "—"),
    ],
  },
  {
    /* Sxema turlari (AUDIT-18 Q-5/Q-6): analytical · uz · oak · 5–10 bet · foydalanuvchi FAQAT cycle/matrix/compare ni ruxsat etdi. */
    name: "article-kinds",
    tool: "article",
    budgetMs: 150_000 + 8 * 16_000 + 90_000,
    values: {
      topic: "Mexanika mashinasozlikda raqamli egizak texnologiyasini joriy etish: afzalliklar va to‘siqlar",
      articleType: articleTypeArg("analytical"),
      pubProfile: profileArg("oak"),
      language: "uz",
      pages: "5-10",
      authors: JSON.stringify([{ name: "Karimov Aziz", org: "Toshkent davlat texnika universiteti" }]),
      keywords: JSON.stringify(["raqamli egizak", "mashinasozlik", "bashoratli xizmat"]),
      figureCount: 3,
      figureKinds: JSON.stringify(["cycle", "matrix", "compare"]),
      research: true,
    },
    checks: (f, pages) => {
      const kinds = f.doc.article?.figures.map((x) => x.spec.kind) ?? [];
      return [
        ...articleChecks(f, pages, { pagesMin: 5 }),
        ok("sxemalar faqat ruxsat etilgan turlardan", kinds.length > 0 && kinds.every((k) => ["cycle", "matrix", "compare", "chart"].includes(k)), kinds.join(",") || "—"),
        ok("kamida 2 xil yangi tur", new Set(kinds.filter((k) => k !== "chart")).size >= 2, kinds.join(",")),
        ok("hammasi PNG (fallback emas)", (f.doc.article?.figures ?? []).every((x) => Boolean(x.url)), (f.doc.article?.figures ?? []).map((x) => (x.url ? "png" : "fallback")).join(",")),
      ];
    },
  },
  {
    /* Konferensiya tezisi: conference_thesis · uz · conference · 200–300 so'z, bitta blok. */
    name: "article-thesis",
    tool: "article",
    budgetMs: 150_000 + 2 * 16_000,
    values: {
      topic: "Qishloq xo‘jaligida tomchilatib sug‘orishning suv tejamkorligi: Farg‘ona vodiysi misolida",
      articleType: articleTypeArg("conference_thesis"),
      pubProfile: profileArg("conference"),
      language: "uz",
      pages: "1-2",
      authors: JSON.stringify([{ name: "Rahimov Bobur", org: "Farg‘ona politexnika instituti" }]),
      keywords: JSON.stringify(["tomchilatib sug‘orish", "suv tejamkorligi", "Farg‘ona vodiysi"]),
      userFacts: "2023-yilda 12 gektar paxta maydonida tomchilatib sug‘orish joriy etildi: suv sarfi gektariga 7 200 m³ dan 4 300 m³ ga kamaydi, hosildorlik 31,5 s/ga dan 36,8 s/ga ga oshdi.",
      figureCount: 0,
      research: true,
    },
    checks: (f, pages) => {
      const body = f.doc.sections.reduce((n, s) => n + s.blocks.filter((b) => b.kind === "p" || b.kind === "li").reduce((m, b) => m + b.text.split(/\s+/).length, 0), 0);
      return [
        ...articleChecks(f, pages, { pagesMin: 1, figures: false }),
        ok("bitta blok", f.doc.sections.length === 1, `${f.doc.sections.length} bo'lim`),
        // ±5 %: model o'zbek so'zini kam sanaydi (jonli 185 → 198 → 207); 2 qayta urinishdan keyin ham 190–200 chiqishi mumkin.
        ok("tezis 200–300 so'z (±5 %)", body >= 190 && body <= 315, `${body} so'z`),
        ok("foydalanuvchi raqamlari", /7 ?200/.test(JSON.stringify(f.doc.sections)) && /36,8|36\.8/.test(JSON.stringify(f.doc.sections)), "7 200 va 36,8"),
      ];
    },
  },
  {
    /* «Tezis» VOSITASI (AUDIT-19): maqola dvigateli, ruxsatsiz tur (imrad_oak) → conference_thesis; hisobot + sayqal; 1–2 bet. */
    name: "thesis",
    tool: "thesis",
    budgetMs: 150_000 + 2 * 16_000 + 90_000,
    values: {
      topic: "Oliy ta’limda raqamli baholash tizimlarining talabalar o‘zlashtirishiga ta’siri",
      articleType: "imrad_oak",
      language: "uz",
      pages: "3-5",
      authors: JSON.stringify([{ name: "Karimova Dilnoza", org: "Toshkent davlat iqtisodiyot universiteti" }]),
      keywords: JSON.stringify(["raqamli baholash", "oliy ta’lim", "o‘zlashtirish"]),
      userFacts: "2025-yilda 2 ta guruhda (n=48 va n=46) raqamli baholash tizimi joriy etildi: o‘rtacha ball 3,9 dan 4,4 ga oshdi, topshiriqlarni o‘z vaqtida topshirish 71 % dan 89 % ga.",
      figureCount: 2,
      research: true,
    },
    checks: (f, pages) => {
      const body = f.doc.sections.reduce((n, s) => n + s.blocks.filter((b) => b.kind === "p" || b.kind === "li").reduce((m, b) => m + b.text.split(/\s+/).length, 0), 0);
      return [
        ...articleChecks(f, pages, { pagesMin: 1, figures: false }),
        ok("vosita thesis, tur conference_thesis (imrad_oak rad etildi)", f.doc.meta.toolId === "thesis" && f.doc.article?.type === "conference_thesis", `${f.doc.meta.toolId}/${f.doc.article?.type}`),
        ok("1–2 bet paketi (3-5 so'ralgan edi)", f.doc.meta.targetPages <= 2, `${f.doc.meta.targetPages}`),
        ok("bitta blok, 200–300 so'z (±5 %)", f.doc.sections.length === 1 && body >= 190 && body <= 315, `${f.doc.sections.length} bo'lim, ${body} so'z`),
        ok("sxema yo'q (1–2 betda 0)", (f.doc.article?.figures.length ?? 0) === 0, `${f.doc.article?.figures.length}`),
        ok("foydalanuvchi raqamlari", /n=48/.test(JSON.stringify(f.doc.sections)) && /89 ?%/.test(JSON.stringify(f.doc.sections)), "n=48 va 89 %"),
        ok("hisobot paneli ma'lumoti (tezis 4 mezon)", (f.doc.article?.review?.checks ?? []).filter((c) => /^judge:(?!fix)/.test(c.id)).length === 4, String((f.doc.article?.review?.checks ?? []).filter((c) => /^judge:(?!fix)/.test(c.id)).length)),
      ];
    },
  },
  {
    /* Xalqaro: elsevier_ieee_style · en · ieee · raqamlangan bo'limlar, highlights, structured abstract. */
    name: "article-en-ieee",
    tool: "article",
    budgetMs: 150_000 + 8 * 16_000,
    values: {
      topic: "Energy-efficient scheduling for edge computing workloads using reinforcement learning",
      articleType: articleTypeArg("elsevier_ieee_style"),
      pubProfile: profileArg("ieee"),
      language: "en",
      pages: "5-10",
      authors: JSON.stringify([{ name: "Bobur Rahimov", org: "Tashkent University of Information Technologies", email: "b.rahimov@tuit.uz" }, { name: "Dilnoza Karimova", org: "TSUE" }]),
      keywords: JSON.stringify(["edge computing", "reinforcement learning", "task scheduling", "energy efficiency"]),
      userFacts: "In a simulation with 200 edge nodes and 50 000 tasks, the proposed scheduler reduced energy consumption by 18.4% and mean latency by 11.2% compared with a round-robin baseline.",
      figureCount: 2,
      research: true,
    },
    checks: (f, pages) => [
      ...articleChecks(f, pages, { pagesMin: 5 }),
      ok("highlights 3–5 × ≤85", (f.doc.article?.highlights?.length ?? 0) >= 3 && (f.doc.article?.highlights ?? []).every((h) => h.length <= 85), `${f.doc.article?.highlights?.length ?? 0} ta`),
      ok("foydalanuvchi raqamlari", /18\.4/.test(JSON.stringify(f.doc.sections)) && /11\.2/.test(JSON.stringify(f.doc.sections)), "18.4 va 11.2"),
    ],
  },
  {
    /*
     * Maktab/DTM adabiy inshosi (AUDIT-19 WP-E1): epigraf + asar iqtibosi,
     * 3 varaq, DTM 24 ballik rubrikasi (5 mezon).
     */
    name: "essay-dtm",
    tool: "essay",
    budgetMs: 200_000,
    values: {
      topic: "«O'tkan kunlar» romanida sevgi va burch kurashi",
      essayContext: "school_dtm",
      essayKind: "literary",
      pages: "3",
      language: "uz",
      workTitle: "O'tkan kunlar",
      epigraph: "Sevgi — qalbning eng sof tuyg'usi",
      epigraphAuthor: "Abdulla Qodiriy",
      userFacts: "Romanni 11-sinfda o'qiganman; Otabek bilan Kumushning Toshkentdagi uchrashuvi eng ta'sirli sahna bo'lgan.",
      design: "vintage",
    },
    checks: (f, pages) => essayChecks(f, pages, { criteria: 5, context: "school_dtm" }).concat([
      ok("epigraf birinchi blok (quote)", f.doc.sections[0]?.blocks[0]?.kind === "quote" && /Abdulla Qodiriy/.test(f.doc.sections[0].blocks[0].text), f.doc.sections[0]?.blocks[0]?.kind ?? "—"),
      ok("asar nomi modelda", f.doc.essay?.workTitle === "O'tkan kunlar", f.doc.essay?.workTitle ?? "yo'q"),
      ok("ramka faylga tushadi (`design`)", f.doc.meta.design === "vintage" && f.doc.essay?.design === "vintage", `${f.doc.meta.design}/${f.doc.essay?.design}`),
      ok("renderlangan sahifa ≥ 2", pages === null || pages >= 2, `${pages ?? "—"} bet`),
    ]),
  },
  {
    /* OTM akademik esse: 800 so'z, thesis statement + har bandda topic sentence, ingliz tili. */
    name: "essay-academic",
    tool: "essay",
    budgetMs: 200_000,
    values: {
      topic: "Should universities replace final exams with continuous assessment?",
      essayContext: "academic",
      essayKind: "argumentative",
      wordTarget: "800",
      language: "en",
      person: "third",
      userFacts: "In my faculty, 62 of 90 students said weekly quizzes helped them retain material better than a single final exam.",
    },
    checks: (f, pages) => essayChecks(f, pages, { criteria: 5, context: "academic" }).concat([
      ok("thesis statement bor", Boolean(f.doc.essay?.thesisStatement?.trim()), f.doc.essay?.thesisStatement?.slice(0, 80) ?? "yo'q"),
      ok("topic sentence rejasi", (f.doc.essay?.paragraphs ?? []).filter((p) => p.role === "body" && p.topicSentence).length >= 2, `${(f.doc.essay?.paragraphs ?? []).filter((p) => p.topicSentence).length} ta`),
      ok("3-shaxs (xolis): «I think» yo'q", !/\bI (think|believe)\b/i.test(essayText(f)), "—"),
      ok("hajm ~800 so'z (paket 4 varaq, narx o'zgarmaydi)", f.doc.meta.targetPages <= 5, `${f.doc.meta.targetPages} varaq`),
    ]),
  },
  {
    /*
     * IELTS Task 2 — eng qattiq holat: 250–330 so'z, 4 band mezoni va
     * SAHIFA DARVOZASI o'tkazib yuborilishi (1 betlik ish yiqilmasin).
     */
    name: "essay-ielts",
    tool: "essay",
    budgetMs: 180_000,
    values: {
      topic: "Some people think that governments should invest in public transport rather than new roads. To what extent do you agree or disagree?",
      essayContext: "ielts_task2",
      essayKind: "opinion",
      language: "uz",
    },
    checks: (f, pages) => essayChecks(f, pages, { criteria: 4, context: "ielts_task2" }).concat([
      ok("til majburan ingliz (formada «uz» yuborilgan edi)", f.doc.essay?.language === "en" && f.doc.meta.language === "en", `${f.doc.essay?.language}/${f.doc.meta.language}`),
      ok("hajm 250–330 so'z", wordCount(f.doc) >= 250 && wordCount(f.doc) <= 360, `${wordCount(f.doc)} so'z`),
      /*
       * Bu keysning BOSH sababi: IELTS inshosi 1 betga sig'adi va eski
       * sahifa darvozasi (`max(2, …)`) uni har safar yiqitardi.
       */
      ok("1 bet ham qabul (sahifa darvozasi yo'q)", pages === null || pages >= 1, `${pages ?? "—"} bet`),
      ok("band → ball o'girmasi (IELTS rubrikasi)", f.doc.essay?.rubric === "ielts_band", f.doc.essay?.rubric ?? "—"),
    ]),
  },
  /* ── Talaba ishlari 2 (AUDIT-19): `work/` dvigateli — kurs ishi / referat / mustaqil ish ── */
  ...(["coursework-theory", "coursework-applied", "referat", "independent"] as const).map((name): Case => {
    const common = {
      language: "uz",
      university: "Toshkent davlat pedagogika universiteti",
      faculty: "Boshlang‘ich ta’lim fakulteti",
      department: "Boshlang‘ich ta’lim metodikasi kafedrasi",
      author: "Aliyev Ali",
      group: "301-guruh",
      course: "3",
      teacher: "Karimova D.",
      teacherDegree: "p.f.n., dotsent",
      city: "Toshkent",
      ministry: "oliy",
      tocMethod: "ai",
      research: true,
    };
    const byName: Record<typeof name, { tool: "coursework" | "referat" | "mustaqil-ish"; values: FormValues; pagesMin: number; refsMin: number; visuals: boolean }> = {
      "coursework-theory": {
        tool: "coursework",
        pagesMin: 15,
        refsMin: 15,
        visuals: true,
        values: { ...common, topic: "Boshlang‘ich sinf o‘quvchilarida o‘qish ko‘nikmalarini rivojlantirish metodikasi", workKind: "theory", subjectProfile: "humanities", subjectName: "Pedagogika", pages: "15-20", includeVisuals: true, figureCount: 1, tableCount: 1, refsMin: 15 },
      },
      "coursework-applied": {
        tool: "coursework",
        pagesMin: 20,
        refsMin: 15,
        visuals: true,
        values: {
          ...common,
          topic: "Kichik ishlab chiqarish korxonasida elektr energiyasi sarfini kamaytirish: hisob-kitob va tavsiyalar",
          workKind: "applied",
          subjectProfile: "technical",
          subjectName: "Elektr ta’minoti",
          university: "Toshkent davlat texnika universiteti",
          faculty: "Energetika fakulteti",
          department: "Elektr ta’minoti kafedrasi",
          pages: "20-25",
          includeVisuals: true,
          figureCount: 2,
          tableCount: 2,
          figureKinds: JSON.stringify(["flow", "compare"]),
          userFacts: "Korxonada 2024-yilda oylik o‘rtacha sarf 18 400 kVt·soat; 12 ta 250 Vt li lampani LED (45 Vt) ga almashtirish hisobi: yillik tejam 7 380 kVt·soat; reaktiv quvvat kompensatsiyasidan keyin cos φ 0,78 dan 0,93 ga oshdi.",
          refsMin: 15,
        },
      },
      referat: {
        tool: "referat",
        pagesMin: 10,
        refsMin: 5,
        visuals: false,
        values: { ...common, topic: "O‘zbekistonda inklyuziv ta’limning rivojlanish bosqichlari", workKind: "informative", subjectProfile: "humanities", subjectName: "Pedagogika tarixi", pages: "10-15", includeVisuals: false, figureCount: 0, tableCount: 0, refsMin: 5 },
      },
      independent: {
        tool: "mustaqil-ish",
        pagesMin: 10,
        refsMin: 8,
        visuals: true,
        values: { ...common, topic: "Kichik biznesda soliq imtiyozlarining samaradorligi: O‘zbekiston misolida", workKind: "written", subjectProfile: "economic", subjectName: "Soliqlar va soliqqa tortish", university: "Toshkent davlat iqtisodiyot universiteti", faculty: "Moliya fakulteti", department: "Soliqlar kafedrasi", pages: "10-15", includeVisuals: true, figureCount: 1, tableCount: 1, refsMin: 8 },
      },
    };
    const c = byName[name];
    return {
      name,
      tool: c.tool,
      budgetMs: 150_000 + 90_000 + 9_000 * (c.pagesMin + 3),
      values: c.values,
      checks: (f, pages) => {
        const w = f.doc.work;
        const refs = w?.references ?? [];
        const cited = refs.filter((r) => r.cited);
        const intro = w ? Object.entries(w.intro.parts).filter(([, v]) => v).map(([k]) => k) : [];
        const chapters = w?.chapters ?? [];
        const secs = f.doc.sections;
        const body = secs.reduce((n, s) => n + s.blocks.filter((b) => b.kind === "p" || b.kind === "li").reduce((m, b) => m + b.text.split(/\s+/).length, 0), 0);
        const tables = (f.doc.tables ?? []).length;
        const figures = w?.figures.filter((x) => x.url).length ?? 0;
        const review = w?.review;
        const red = review?.checks.filter((x) => x.level === "red").map((x) => x.id) ?? [];
        return [
          ok("doc.work bor", Boolean(w), w ? `${w.genre}/${w.kind}/${w.subject}` : "yo'q"),
          ok("kirish 7 element", w?.genre !== "coursework" || intro.length >= 7, intro.join(",")),
          ok("boblar/paragraflar skeletda", chapters.length >= 2 && chapters.every((ch) => ch.paragraphs.length >= 2), chapters.map((ch) => `${ch.id}:${ch.paragraphs.length}`).join(" ")),
          ok("intro/xulosa bo'limlari", secs.some((x) => x.id === "intro") && secs.some((x) => x.id === "conclusion"), secs.map((x) => x.id).join(",")),
          ok("manbalar 100 % tekshirilgan (uydirma yo'q)", cited.length > 0 && cited.every((r) => r.verified !== "unverified"), `${cited.length} cited: ${[...new Set(cited.map((r) => r.verified))].join(",")}`),
          ok(`manbalar ≥ ${Math.min(c.refsMin, 8)} (mo'ljal ${c.refsMin}; Books kalitsiz 429)`, cited.length >= Math.min(c.refsMin, 8), `${cited.length} (turlar: ${[...new Set(cited.map((r) => kindOf(r)))].join(",")})`),
          ok("iqtiboslar reyestrda", (f.doc.work?.review?.checks.find((x) => x.id === "refsCited")?.level ?? "green") !== "red", review?.checks.find((x) => x.id === "refsCited")?.detail ?? "—"),
          ok("hajm darvozasi (so'z)", body >= 0.8 * (workGateWords(f.doc) ?? 230 * c.pagesMin), `${body} so'z (kerak ≥ ${Math.round(0.8 * (workGateWords(f.doc) ?? 230 * c.pagesMin))} — reja tanasi ${workGateWords(f.doc) ?? "?"})`),
          ok("renderlangan sahifa", pages === null || pages >= Math.round(0.85 * c.pagesMin), `${pages ?? "—"} bet (kerak ≥ ${Math.round(0.85 * c.pagesMin)})`),
          ok("vizuallar", !c.visuals || tables + figures >= 1, `jadval ${tables}, sxema ${figures}`),
          ok("hisobot bor va ≥ 55 ball", Boolean(review) && (review?.score ?? 0) >= 55, review ? `${review.score} ball, qizil: ${red.join(",") || "yo'q"}` : "yo'q"),
          ok("manbasiz raqam yo'q", (review?.checks.find((x) => x.id === "unsourcedNumbers")?.level ?? "green") !== "red", review?.checks.find((x) => x.id === "unsourcedNumbers")?.detail ?? "—"),
          ok("cost.calls > 0", (f.cost?.calls ?? 0) > 0, f.cost ? `${f.cost.calls} chaqiruv, ${f.cost.provider}/${f.cost.model}` : "yo'q"),
        ];
      },
    };
  }),
  /*
   * ── O'qituvchi vositalari 2 (AUDIT-20 WP-F) — 7 jonli holat ──
   *
   * Eski `glossary` va `lesson` holatlari shu ro'yxatga KO'CHDI: ular
   * `h3` sarlavhalarni va birinchi jadval qatorlarini sanardi, ya'ni
   * MATNNI tekshirardi. Yangi dvigatelda da'vo MODEL ustida
   * (`doc.teacher`) — hisobot, sarf va `delivered` ham shundan.
   */
  ...teacherCases(),
  /* ── 2-dastur (AUDIT-21) — bosma o'yinlar + infografika ── */
  ...gameCases(),
  infographicCase(),
  /* ── 3-dastur (AUDIT-22) — TTS/media (podkast, tabriknoma) ── */
  ...audioCases(),
  /* ── Slayd (AUDIT-25 P5) — paritet 2 + egasining haqiqiy naqshlarini oynalaydigan 5 ta ── */
  ...slideCases(),
];

/** Glossariy atamalari alifbo tartibidami. */
function isSorted(doc: AcademicDoc): boolean {
  const terms = doc.sections.flatMap((s) => s.blocks.filter((b) => b.kind === "h3").map((b) => b.text));
  const collator = new Intl.Collator(doc.meta.language || "uz", { sensitivity: "base", numeric: true });
  for (let i = 1; i < terms.length; i++) {
    if (collator.compare(terms[i - 1], terms[i]) > 0) return false;
  }
  return terms.length > 0;
}

/** DOCX/PPTX ni PDF ga o'girib sahifa sonini sanaydi. `null` — o'girib bo'lmadi. */
async function pageCount(file: BuiltFile): Promise<number | null> {
  if (!pdfAvailable()) return null;
  const pdf = await toPdf(file.bytes, file.fileName).catch(() => null);
  if (!pdf) return null;
  try {
    const { getDocumentProxy } = await import("unpdf");
    const proxy = await getDocumentProxy(new Uint8Array(pdf));
    return proxy.numPages;
  } catch {
    return null;
  }
}

async function runCase(c: Case) {
  const started = Date.now();
  const tool = TOOL_BY_ID[c.tool];
  const meta = extractMeta(tool, c.values);
  process.stdout.write(`\n▶ ${c.name} (${tool.title}, byudjet ${c.budgetMs / 1000}s)\n`);

  try {
    /*
     * Jonli hodisalar STDOUT ga — bu skript «streaming ishladimi» ni
     * ko'z bilan tekshirish uchun yagona joy. Vaqt tamg'asi muhim:
     * `slide` hodisalari bo'lak TUGASHIDAN oldin kelsa, oqim haqiqatan
     * ishlagan; hammasi bir soniyada guruh bo'lib kelsa — bo'lakli yo'l.
     */
    const onProgress = (ev: SlideProgressEvent) => {
      const dt = ((Date.now() - started) / 1000).toFixed(1);
      const tail =
        ev.type === "slide"
          ? ` #${ev.index} ${ev.slide.title}`
          : ev.type === "stage"
            ? ` ${ev.stage}`
            : ev.type === "image"
              ? ` #${ev.index}`
              : ev.type === "plan"
                ? ` ${ev.slides.length} slayd`
                : ev.type === "deck"
                  ? ` ${ev.slides.length} slayd`
                  : ev.type === "images"
                    ? ` ${ev.wait.length} kutilmoqda`
                    : ev.type === "research"
                      ? ` ${ev.sources} manba`
                      : "";
      process.stdout.write(`   ⟶ +${dt}s ${ev.type}${tail}\n`);
    };
    /*
     * `--template <fayl.pptx>` — «O'z shablonim» jonli sinovi (Shablonlar 2):
     * namuna tahlil qilinadi va deka uning master/layout/temasi ichiga
     * yoziladi (`renderPptxWithTemplate`), worker yo'lining o'zi.
     */
    const tplPath = templateArg();
    const template =
      tplPath && (c.tool === "slide" || c.tool === "pro-slide")
        ? await (async () => {
            const bytes = new Uint8Array(await readFile(tplPath));
            const profile = await parsePptxTemplate(bytes);
            process.stdout.write(`   ⟶ namuna ${path.basename(tplPath)}: ${profile.layouts.length} layout, rollar ${Object.keys(profile.roles).join("/")}\n`);
            return { bytes, template: { assetId: "live", name: path.basename(tplPath), profile, previews: {} } };
          })()
        : undefined;
    /*
     * `--source <fayl>` — FAYL rejimi: bayt `BuildOptions.source` orqali
     * (worker `sourceForJob` yo'li). Tarjimondan tashqari test vositasi
     * ham shu yo'ldan yuradi (AUDIT-20): worker endi `tool.modes` e'lon
     * qilgan har vositaga manbani uzatadi.
     */
    const srcPath = sourceArg();
    const source =
      srcPath && c.values.mode === "file"
        ? await (async () => {
            const bytes = new Uint8Array(await readFile(srcPath));
            const kind = sourceKindOf(srcPath);
            process.stdout.write(`   ⟶ manba ${path.basename(srcPath)}: ${kind}, ${(bytes.byteLength / 1024).toFixed(0)} KB\n`);
            return { bytes, name: path.basename(srcPath), kind, mime: "application/octet-stream", chars: 0 };
          })()
        : undefined;
    /* `--photo <fayl>` — rezyume surati (worker `photoDataUrl` yo'li). */
    const photoPath = photoArg();
    const photo =
      photoPath && c.tool === "resume"
        ? await (async () => {
            const bytes = await readFile(photoPath);
            const mime = photoPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
            process.stdout.write(`   ⟶ surat ${path.basename(photoPath)}: ${(bytes.byteLength / 1024).toFixed(0)} KB\n`);
            return {
              url: `data:${mime};base64,${bytes.toString("base64")}`,
              assetId: "live",
              shape: (mime === "image/png" ? "circle" : "square") as "circle" | "square",
            };
          })()
        : undefined;
    const onStage = (ev: { progress: number; step: string }) => {
      const dt = ((Date.now() - started) / 1000).toFixed(1);
      process.stdout.write(`   ⟶ +${dt}s ${ev.progress}% ${ev.step}\n`);
    };
    const file = await buildArtifact(tool, c.values, { deadline: Date.now() + c.budgetMs, onProgress, template, source, photo, onStage });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const pages = await pageCount(file);
    await writeFile(path.join(OUT, file.fileName), file.bytes);

    const checks = await c.checks(file, pages);
    for (const ch of checks) {
      process.stdout.write(`   ${ch.ok ? "✔" : "✘"} ${ch.label.padEnd(26)} ${ch.detail}\n`);
    }
    process.stdout.write(
      `   · ${secs}s · ${(file.bytes.byteLength / 1024).toFixed(0)} KB · ${wordCount(file.doc)} so'z · ${meta.targetPages} maqsad` +
        (file.cost ? ` · sarf ${file.cost.calls} chaqiruv (${file.cost.provider}/${file.cost.model}, ${file.cost.inputTokens}→${file.cost.outputTokens} token)` : "") +
        `\n`,
    );
    /* Maqola: hisobot uchun bo'limlar, manbalar va annotatsiya qisqacha. */
    if (file.doc.article) {
      const a = file.doc.article;
      process.stdout.write(`   bo'limlar: ${file.doc.sections.map((s) => `${s.id}(${s.blocks.length})`).join(" ")}\n`);
      for (const r of a.references) process.stdout.write(`   manba ${r.id} [${r.verified}${r.cited ? ",cited" : ""}] ${r.authors.slice(0, 2).join(", ")} (${r.year ?? "?"}) ${r.title.slice(0, 70)}${r.doi ? ` doi:${r.doi}` : ""}\n`);
      for (const x of file.doc.abstracts ?? []) process.stdout.write(`   annotatsiya ${x.lang}: ${x.text.split(/\s+/).length} so'z · kalit: ${x.keywords}\n`);
      for (const g of a.figures) process.stdout.write(`   sxema ${g.id}: ${g.spec.kind} — ${g.caption.slice(0, 70)}\n`);
      if (a.highlights) process.stdout.write(`   highlights: ${a.highlights.map((h) => `«${h}»`).join(" ")}\n`);
      await writeFile(path.join(OUT, `${c.name}.doc.json`), JSON.stringify(file.doc, null, 2));
    }
    /*
     * O'qituvchi hujjati: model xulosasi + hisobot bandlari; `doc.json` —
     * WP-C maketi va ko'ruvchi paritetini o'lchash uchun URUG': jonli
     * chaqiruvsiz (LLM sarfisiz) qayta-qayta ochib ko'rish mumkin.
     */
    if (file.doc.teacher) {
      const t = file.doc.teacher;
      const counts = [
        t.lesson && `${t.lesson.stages.length} bosqich / ${t.lesson.stages.reduce((n, s) => n + s.minutes, 0)} daq`,
        t.map && `${t.map.quarters.length} blok / ${t.map.quarters.flatMap((q) => q.weeks).length} hafta`,
        t.glossary && `${t.glossary.terms.length} atama`,
        t.keys && `${t.keys.cases.length} keys`,
        t.test && `${t.test.questions.length} savol / ${t.test.variants.length} variant`,
      ].filter(Boolean);
      process.stdout.write(`   model: ${t.kind}/${t.type} — ${counts.join(", ")}\n`);
      process.stdout.write(`   bo'limlar: ${file.doc.sections.map((s) => `${s.id}(${s.blocks.length})`).join(" ")}\n`);
      for (const ch of t.review?.checks ?? []) {
        if (ch.level !== "green") process.stdout.write(`   hisobot ${ch.level}: ${ch.id} — ${(ch.detail ?? "").slice(0, 90)}\n`);
      }
      for (const n of t.userNeeds ?? []) process.stdout.write(`   sizdan kutiladi: ${n.label}\n`);
      for (const g of t.figures ?? []) process.stdout.write(`   rasm ${g.id}: ${g.spec.kind} ${g.w}×${g.h}\n`);
      await writeFile(path.join(OUT, `${c.name}.doc.json`), JSON.stringify(file.doc, null, 2));
    }
    /* Talaba ishi: boblar, manbalar (tur/tasdiq), vizuallar; doc.json — smoke urug'i uchun. */
    if (file.doc.work) {
      const w = file.doc.work;
      process.stdout.write(`   boblar: ${w.chapters.map((ch) => `${ch.id}«${ch.title.slice(0, 40)}»(${ch.paragraphs.length})`).join(" ")}\n`);
      for (const r of w.references) process.stdout.write(`   manba ${r.id} [${kindOf(r)},${r.verified}${r.cited ? ",cited" : ""}] ${r.authors.slice(0, 2).join(", ")} (${r.year ?? "?"}) ${r.title.slice(0, 70)}\n`);
      for (const g of w.figures) process.stdout.write(`   sxema ${g.id}: ${g.spec.kind} — ${g.caption.slice(0, 70)}\n`);
      await writeFile(path.join(OUT, `${c.name}.doc.json`), JSON.stringify(file.doc, null, 2));
    }
    /*
     * O'yin (krossvord/kartalar): model xulosasi + hisobot; `doc.json` —
     * WP-B maketi (`games/layout.ts planGame`) va ko'ruvchi paritetini
     * o'lchash uchun urug', jonli chaqiruvsiz qayta ochib ko'rish mumkin.
     */
    if (file.doc.game) {
      const g = file.doc.game;
      const counts = [
        g.crossword && `${g.crossword.words.length} so'z / ${g.crossword.dropped.length} tashlangan / ${g.crossword.grid.rows}×${g.crossword.grid.cols} to'r`,
        g.cards && `${g.cards.cards.length} karta`,
      ].filter(Boolean);
      process.stdout.write(`   model: ${g.kind}/${g.type} — ${counts.join(", ")}\n`);
      process.stdout.write(`   bo'limlar: ${file.doc.sections.map((s) => `${s.id}(${s.blocks.length})`).join(" ")}\n`);
      for (const ch of g.review?.checks ?? []) {
        if (ch.level !== "green") process.stdout.write(`   hisobot ${ch.level}: ${ch.id} — ${(ch.detail ?? "").slice(0, 90)}\n`);
      }
      for (const n of g.userNeeds ?? []) process.stdout.write(`   sizdan kutiladi: ${n.label}\n`);
      await writeFile(path.join(OUT, `${c.name}.doc.json`), JSON.stringify(file.doc, null, 2));
    }
    /* Infografika: `doc.infographic` — PNG chiqishi yonida spetsifikatsiya urug'i. */
    if (file.doc.infographic) {
      const ig = file.doc.infographic;
      process.stdout.write(`   plakat: ${ig.spec.type} — ${ig.spec.blocks.length} blok, palitra ${ig.spec.palette}\n`);
      for (const ch of ig.review?.checks ?? []) {
        if (ch.level !== "green") process.stdout.write(`   hisobot ${ch.level}: ${ch.id} — ${(ch.detail ?? "").slice(0, 90)}\n`);
      }
      await writeFile(path.join(OUT, `${c.name}.doc.json`), JSON.stringify(file.doc, null, 2));
    }
    /*
     * Slayd (AUDIT-25 P5, review item 7b): boshqa oilalar kabi `doc.json`
     * yozamiz — `scripts/slide-audit.mts` shu faylni o'qiydi
     * (`npm run slide-audit -- eval-out/live`). Buni qo'shmaguncha CLI'ni
     * jonli chiqish ustida ishlatib bo'lmasdi.
     */
    if (file.doc.slides?.length) {
      await writeFile(path.join(OUT, `${c.name}.doc.json`), JSON.stringify(file.doc, null, 2));
    }
    return { name: c.name, ok: checks.every((x) => x.ok), failed: checks.filter((x) => !x.ok) };
  } catch (e) {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`   ✘ XATO (${secs}s): ${msg}\n`);
    return { name: c.name, ok: false, failed: [{ label: "buildArtifact", ok: false, detail: msg }] };
  }
}

/** `--photo <fayl>` — «Rezyume» jonli sinovi uchun surat (PNG doira, JPEG kvadrat). */
function resumeTemplateArg(): ResumeTemplateId {
  const i = process.argv.indexOf("--resume-template");
  return normalizeResumeTemplate(i > 0 ? process.argv[i + 1] : "modern");
}

function photoArg(): string | null {
  const i = process.argv.indexOf("--photo");
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** `--source <fayl>` — «Tarjimon» jonli sinovi uchun kirish fayli (DOCX/PPTX/XLSX/PDF/TXT/MD/CSV). */
function sourceArg(): string | null {
  const i = process.argv.indexOf("--source");
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const SOURCE_KINDS = ["docx", "pptx", "xlsx", "pdf", "txt", "md", "csv"] as const;
function sourceKindOf(file: string): (typeof SOURCE_KINDS)[number] {
  const ext = path.extname(file).slice(1).toLowerCase() as (typeof SOURCE_KINDS)[number];
  if (!SOURCE_KINDS.includes(ext)) throw new Error(`--source: noma'lum format .${ext}`);
  return ext;
}

/** `--lang <kod>` — rezyume chiqish tili (standart `en`: 18 tildan biri). */
function langArg(): string {
  const i = process.argv.indexOf("--lang");
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : "en";
}

/* ────────────────────────── Maqola 2 (AUDIT-17) jonli yordamchilari ────────────────────────── */

/** `--article-type <id>` — maqola holatlarining turini bekor qiladi. */
function articleTypeArg(fallback: ArticleTypeId): ArticleTypeId {
  const i = process.argv.indexOf("--article-type");
  const v = i > 0 ? process.argv[i + 1] : "";
  return isArticleTypeId(v) ? v : fallback;
}

/** `--profile <id>` — nashr profilini bekor qiladi. */
function profileArg(fallback: PublicationProfileId): PublicationProfileId {
  const i = process.argv.indexOf("--profile");
  const v = i > 0 ? process.argv[i + 1] : "";
  return isPublicationProfileId(v) ? v : fallback;
}

/** Inshoning butun matni (epigraf bilan) — klişe/shaxs tekshiruvlari uchun. */
function essayText(f: BuiltFile): string {
  return f.doc.sections.flatMap((s) => s.blocks.map((b) => b.text)).join("\n");
}

/**
 * Insho holatlarining umumiy da'volari (AUDIT-19 WP-E1).
 *
 * Maqoladan farqi: manba, sxema va annotatsiya YO'Q — o'lchanadigan
 * narsa hajm (SO'Z bilan, `doc.essay.words`), tuzilma (bitta bo'lim),
 * kontekst mezonlari (DTM 5 / akademik 5 / IELTS 4) va klişe taqiqi.
 */
function essayChecks(f: BuiltFile, pages: number | null, o: { criteria: number; context: string }): Check[] {
  const e = f.doc.essay;
  const text = essayText(f);
  const words = wordCount(f.doc);
  const review = e?.review;
  const judge = (review?.checks ?? []).filter((c) => /^judge:(?!fix)/.test(c.id));
  /*
   * Klişe — `guardSection` + hisobot `filler` qoidasi bilan bir xil
   * ro'yxatdan (`ESSAY_FILLER`): jonli matnda ular QOLMASLIGI kerak,
   * chunki DTM va IELTS baholovchilari aynan shularni jazolaydi.
   */
  const lower = text.toLowerCase();
  const fillerHits = ESSAY_FILLER.filter((p) => lower.includes(p.toLowerCase()));
  return [
    ok("doc.essay bor", Boolean(e), e ? `${e.context}/${e.kind}/${e.rubric}` : "yo'q"),
    ok("kontekst so'ralganicha", e?.context === o.context, `${e?.context ?? "—"} (kutilgan ${o.context})`),
    ok("bitta bo'lim (mundarija/titul qoidasi kontekstdan)", f.doc.sections.length === 1 && f.doc.toc === false, `${f.doc.sections.length} bo'lim, toc=${f.doc.toc}`),
    ok(
      "hajm dvigatel oralig'ida",
      Boolean(e) && words >= Math.round(e!.words.min * 0.9) && words <= Math.round(e!.words.max * 1.15),
      e ? `${words} so'z (${e.words.min}–${e.words.max}, mo'ljal ${e.words.aim})` : `${words} so'z`,
    ),
    ok("hisobot bor va > 0 ball", (review?.score ?? 0) > 0, review ? `${review.score} ball, ${review.checks.filter((c) => c.level === "red").length} qizil` : "hisobot yo'q"),
    ok(`kontekst mezonlari ${o.criteria} ta`, judge.length === o.criteria, `${judge.length} ta: ${judge.map((c) => c.id.replace("judge:", "")).join(",")}`),
    ok("klişe iboralar yo'q", fillerHits.length === 0, fillerHits.length ? `topildi: ${fillerHits.join(", ")}` : "toza"),
    ok("cost.calls > 0", (f.cost?.calls ?? 0) > 0, f.cost ? `${f.cost.calls} chaqiruv, ${f.cost.provider}/${f.cost.model}` : "cost yo'q"),
    ok("DOCX chiqdi", f.bytes.byteLength > 0, `${Math.round(f.bytes.byteLength / 1024)} KB, ${pages ?? "?"} bet`),
  ];
}

/**
 * Maqola holatlarining umumiy da'volari. Iqtibos tekshiruvi yakuniy hujjat
 * ustida QAYTA yuritiladi (`verifyCitations`) — dvigatel o'z ichida nima
 * qilganidan qat'i nazar, chiqishda reyestrda yo'q id qolmagan bo'lsin.
 */
function articleChecks(f: BuiltFile, pages: number | null, o: { pagesMin: number; figures?: boolean }): Check[] {
  const a = f.doc.article;
  const refs = a?.references ?? [];
  const profile = a ? PUBLICATION_PROFILES[a.profile] : PUBLICATION_PROFILES.oak;
  const v = a ? verifyCitations(f.doc.sections, refs) : null;
  const cited = v ? v.kept : 0;
  const abs = f.doc.abstracts ?? [];
  const absWords = abs.map((x) => x.text.split(/\s+/).filter(Boolean).length);
  const [minW, maxW] = profile.abstractWords;
  const [minK, maxK] = profile.keywords;
  const kw = a ? (["uz", "ru", "en"] as const).map((l) => a.keywords[l]?.length ?? 0) : [];
  const wantFigures = o.figures !== false && (f.doc.meta.figureCount ?? 0) > 0;
  // Foydalanuvchi faktidagi foiz (18.4%) manbasiz emas — `guard.ts` bilan bir xil qoida.
  const facts = new Set(factNumbers(a?.userFacts));
  const unsourced = f.doc.sections.flatMap((s) =>
    s.blocks
      .filter((b) => (b.kind === "p" || b.kind === "li") && !/\[(W\d+|u\d+)/.test(b.text))
      .flatMap((b) => (b.text.match(/\d+[.,]?\d*\s*%/g) ?? []).map((p) => p.replace(/\s+/g, "").replace(",", ".")))
      .filter((p) => !facts.has(p)),
  );
  return [
    ok("doc.article bor", Boolean(a), a ? `${a.type}/${a.profile}/${a.cite}` : "yo'q"),
    ok("titul/mundarija yo'q", f.doc.titlePage === false && f.doc.toc === false, `titlePage=${f.doc.titlePage} toc=${f.doc.toc}`),
    ok("iqtiboslar 100% reyestrda", Boolean(v) && v!.unresolved.length === 0 && cited > 0, v ? `${cited} iqtibos, ${v.unresolved.length} noma'lum` : "—"),
    /*
     * Ro'yxatga FAQAT `cited` chiqadi (`orderReferences`), tekshirilmagani
     * yo'q. Avto-sayqal bo'limni qayta yozganda iqtibos tushib qolsa
     * `cited:false` bo'lib modelda qoladi (renderga chiqmaydi) — bu xato emas.
     */
    ok("ro'yxat: cited manbalar tekshirilgan, iqtibossizi renderga chiqmaydi", refs.length > 0 && refs.filter((r) => r.cited).every((r) => r.verified !== "unverified") && planArticle(f.doc).refs.length === refs.filter((r) => r.cited).length, `${refs.length} manba (${refs.filter((r) => r.cited).length} cited): ${refs.map((r) => `${r.id}:${r.verified}${r.cited ? "" : ":uncited"}`).join(" ")}`),
    ok(`manbalar ≥ ${Math.min(profile.refsMin, 5)}`, refs.length >= Math.min(profile.refsMin, 5), `${refs.length} (profil ${profile.refsMin}–${profile.refsMax})`),
    ok("annotatsiya ×3", abs.length === 3 && ["uz", "ru", "en"].every((l) => abs.some((x) => x.lang === l)), abs.map((x) => x.lang).join(",")),
    ok(`annotatsiya ${minW}–${maxW} so'z (±30%)`, absWords.length === 3 && absWords.every((n) => n >= minW * 0.7 && n <= maxW * 1.3), absWords.join("/")),
    ok(`kalit so'zlar ${minK}–${maxK}`, kw.length === 3 && kw.every((n) => n >= minK && n <= maxK), kw.join("/")),
    ok("annotatsiyada iqtibos yo'q", abs.every((x) => !/\[(W\d+|u\d+)/.test(x.text)), ""),
    // WP3: sxema PNG chiziladi (`url` data: PNG, 1890 px) yoki maketlanmasa `fallbackBlocks` — ikkalasi ham to'g'ri, lekin kamida bittasi PNG bo'lsin.
    ok(
      wantFigures ? "sxema PNG chizilgan (yoki fallback)" : "sxema yo'q",
      wantFigures
        ? (a?.figures.length ?? 0) > 0 && a!.figures.every((x) => x.spec && (x.url?.startsWith("data:image/png") || x.fallbackBlocks?.length)) && a!.figures.some((x) => x.url)
        : (a?.figures.filter((x) => x.spec.kind !== "prisma").length ?? 0) === 0,
      a?.figures.map((x) => `${x.id}:${x.spec.kind}${x.url ? ` ${x.w}px` : x.fallbackBlocks ? " fallback" : " url yo'q"}`).join(",") || "—",
    ),
    ok("hisobot bor va ≥ 60 ball", (a?.review?.score ?? 0) >= 60, a?.review ? `${a.review.score} ball, ${a.review.checks.filter((c) => c.level === "red").length} qizil` : "hisobot yo'q"),
    ok("manbasiz foiz yo'q", unsourced.length === 0, unsourced.length ? `topildi: ${unsourced.join(", ")}` : "toza"),
    ok("cost.calls > 0", (f.cost?.calls ?? 0) > 0, f.cost ? `${f.cost.calls} chaqiruv, ${f.cost.provider}/${f.cost.model}` : "cost yo'q"),
    ok(`DOCX ≥ ${o.pagesMin} bet`, pages === null || pages >= o.pagesMin, `${pages ?? "?"} bet`),
  ];
}

function templateArg(): string | null {
  const i = process.argv.indexOf("--template");
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  /*
   * `--list` — holatlar ro'yxati, LLM CHAQIRUVISIZ (AUDIT-20).
   *
   * Jonli yugurish pul turadi va uni lead qachon o'tkazishini o'zi hal
   * qiladi; ro'yxat esa «yangi holat ulandimi, nomi to'g'rimi, byudjeti
   * qancha» degan savolga bepul javob beradi.
   */
  if (process.argv.includes("--list")) {
    for (const c of CASES) {
      process.stdout.write(`${c.name.padEnd(18)} ${String(c.tool).padEnd(20)} ${String(c.budgetMs / 1000).padStart(5)}s\n`);
    }
    process.stdout.write(`\nJami: ${CASES.length} holat\n`);
    process.exit(0);
  }
  if (!process.env.GEMINI_API_KEY && !process.env.XAI_API_KEY) {
    console.error("GEMINI_API_KEY yo'q — jonli tekshiruv o'tkazib yuborildi.");
    process.exit(2);
  }
  await mkdir(OUT, { recursive: true });
  // `--no-polish` — avto-sayqal o'chiq (maqola AUDIT-18 8-bosqichi, insho AUDIT-19 5-bosqichi).
  if (process.argv.includes("--no-polish")) {
    process.env.ARTICLE_POLISH = "0";
    process.env.ESSAY_POLISH = "0";
  }

  const tpl = templateArg();
  const src = sourceArg();
  const rtpl = process.argv.includes("--resume-template") ? process.argv[process.argv.indexOf("--resume-template") + 1] : null;
  // `--article-type X` / `--profile Y` qiymatlari keys nomi emas.
  const flagValues = new Set(["--article-type", "--profile"].filter((f) => process.argv.includes(f)).map((f) => process.argv[process.argv.indexOf(f) + 1]));
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-") && a !== tpl && a !== src && a !== langArg() && a !== rtpl && a !== photoArg() && !flagValues.has(a));
  const cases = only.length ? CASES.filter((c) => only.includes(c.name)) : CASES;
  process.stdout.write(
    `Jonli tekshiruv — ${cases.length} keys · model ${process.env.GEMINI_MODEL || "gemini"} · PDF ${pdfAvailable() ? "bor" : "yo'q"}\n`,
  );

  const results = [];
  for (const c of cases) results.push(await runCase(c));

  const bad = results.filter((r) => !r.ok);
  process.stdout.write(
    `\n${"─".repeat(64)}\nNatija: ${results.length - bad.length}/${results.length} keys o'tdi\n`,
  );
  for (const r of bad) {
    for (const f of r.failed) process.stdout.write(`  ✘ ${r.name}: ${f.label} — ${f.detail}\n`);
  }
  process.stdout.write(`Fayllar: ${OUT}\n`);
  process.exit(bad.length ? 1 : 0);
}

await main();
