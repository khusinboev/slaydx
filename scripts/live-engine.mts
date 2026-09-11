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
 *   npm run live -- article-oak essay  — faqat nomlanganlar
 *   npm run live -- article-oak --article-type analytical --profile university  — maqola turi/profili
 *
 * `GEMINI_API_KEY` shart. Chiqish `eval-out/live/` ga yoziladi.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { normalizeResumeTemplate, templateHasPhoto, type ResumeTemplateId } from "../lib/generation/resume/templates.ts";
import path from "node:path";
import { buildArtifact } from "../lib/generation/index.ts";
import { parsePptxTemplate } from "../lib/generation/pptx-template.ts";
import { readFile } from "node:fs/promises";
import { extractMeta } from "../lib/generation/meta.ts";
import { minSummaryChars, summaryLimits } from "../lib/generation/resume/write.ts";
import type { SlideProgressEvent } from "../lib/generation/slide-progress.ts";
import { wordCount } from "../lib/generation/quality.ts";
import { slideNotes } from "../lib/generation/slide-layout.ts";
import { pdfAvailable, toPdf } from "../lib/server/pdf.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { AcademicDoc, BuiltFile } from "../lib/generation/types.ts";
import { verifyCitations } from "../lib/generation/research/verify.ts";
import { PUBLICATION_PROFILES, isPublicationProfileId } from "../lib/generation/article/profiles.ts";
import { isArticleTypeId } from "../lib/generation/article/types-registry.ts";
import type { ArticleTypeId, PublicationProfileId } from "../lib/generation/article/types.ts";
import type { FormValues } from "../lib/types.ts";

type Check = { label: string; ok: boolean; detail: string };
type Case = {
  name: string;
  tool: keyof typeof TOOL_BY_ID;
  values: FormValues;
  budgetMs: number;
  /** Faylni ko'rgandan keyin nimani da'vo qilamiz. */
  checks: (file: BuiltFile, pages: number | null) => Check[];
};

const OUT = path.resolve(process.cwd(), "eval-out", "live");
const ok = (label: string, cond: boolean, detail: string): Check => ({ label, ok: cond, detail });

/** Bo'limlar ichidagi `h2` — ostmavzu/bob sarlavhalari. */
const countH2 = (doc: AcademicDoc) =>
  doc.sections.reduce((n, s) => n + s.blocks.filter((b) => b.kind === "h2").length, 0);

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
        ok("tezis 200–300 so'z", body >= 200 && body <= 300, `${body} so'z`),
        ok("foydalanuvchi raqamlari", /7 ?200/.test(JSON.stringify(f.doc.sections)) && /36,8|36\.8/.test(JSON.stringify(f.doc.sections)), "7 200 va 36,8"),
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
    /* P1-3: 5 varaq → 5 burchak (ilgari uchtasi ham 3 ta olardi). */
    name: "essay",
    tool: "essay",
    budgetMs: 160_000,
    values: {
      topic: "Ona tilim — g'ururim va iftixorim",
      pages: "5",
      language: "uz",
      author: "Valiyeva Nodira",
      design: "iris",
    },
    checks: (f, pages) => {
      const body = f.doc.sections.filter((s) => s.id.startsWith("asosiy"));
      return [
        ok("5 ta asosiy burchak", body.length === 5, `${body.length} ta`),
        ok("kirish va xulosa bor", f.doc.sections.length === 7, `${f.doc.sections.length} bo'lim`),
        ok("hajm 5 varaqqa yetadi", wordCount(f.doc) >= 920, `${wordCount(f.doc)} so'z (darvoza 920)`),
        ok("renderlangan sahifa", pages === null || pages >= 4, `${pages ?? "—"} bet`),
      ];
    },
  },
  {
    /* P1-10: prompt endi «4 ta bob» deydi — reja ham shuncha bo'lishi kerak. */
    name: "coursework",
    tool: "coursework",
    budgetMs: 420_000,
    values: {
      topic: "Boshlang'ich sinf o'quvchilarida o'qish ko'nikmalarini rivojlantirish",
      pages: "20-25",
      language: "uz",
      author: "Aliyev Ali — 3-kurs, 301-guruh",
      university: "Toshkent davlat pedagogika universiteti",
      faculty: "Boshlang'ich ta'lim",
      subject: "Pedagogika",
      teacher: "Karimova D.",
      images: "yes",
      tocMethod: "ai",
    },
    checks: (f, pages) => {
      const bobs = f.doc.sections.filter((s) => /^bob\d/.test(s.id));
      return [
        ok("4 bob (prompt bilan mos)", bobs.length === 4, `${bobs.length} bob`),
        ok("ostmavzular bor", countH2(f.doc) >= 8, `${countH2(f.doc)} ostmavzu`),
        ok("hajm darvozasi", wordCount(f.doc) >= 0.8 * 23 * 230, `${wordCount(f.doc)} so'z`),
        ok("renderlangan sahifa", pages === null || pages >= 17, `${pages ?? "—"} bet (kerak 20-25)`),
        ok("manba ogohlantirishi", Boolean(f.doc.referencesNote), f.doc.referencesNote ? "bor" : "YO'Q"),
      ];
    },
  },
  {
    /* P1-2: 20 atama va'da — kam chiqsa `delivered` to'lishi kerak. */
    name: "glossary",
    tool: "glossary",
    budgetMs: 160_000,
    values: { topic: "Fotosintez va o'simlik fiziologiyasi", termCount: "20", language: "uz" },
    checks: (f) => {
      const terms = f.doc.sections.reduce(
        (n, s) => n + s.blocks.filter((b) => b.kind === "h3").length,
        0,
      );
      const short = f.delivered;
      return [
        ok("atamalar sanaldi", terms > 0, `${terms} ta`),
        ok(
          "delivered va'daga mos",
          terms >= 20 ? short === undefined : short?.got === terms && short?.want === 20,
          short ? `${short.got}/${short.want} → farq qaytadi` : "to'liq",
        ),
        ok("alifbo tartibi", isSorted(f.doc), "h3 sarlavhalari"),
      ];
    },
  },
  {
    /* P0-3: portret profil + daqiqalar yig'indisi. */
    name: "lesson",
    tool: "lesson-plan",
    budgetMs: 140_000,
    values: {
      topic: "Kasrlarni qo'shish va ayirish",
      subject: "Matematika",
      grade: 5,
      duration: "45",
      language: "uz",
    },
    checks: (f) => {
      const rows = f.doc.tables?.[0]?.rows ?? [];
      const sum = rows.reduce((n, r) => n + (Number(r[1]) || 0), 0);
      const topicHit = f.doc.sections.some((s) =>
        s.blocks.some((b) => /kasr/i.test(b.text)),
      );
      return [
        ok("daqiqalar yig'indisi = 45", sum === 45, `${sum} daq`),
        ok("bosqichlar bor", rows.length >= 5, `${rows.length} bosqich`),
        ok("mavzuga bog'langan", topicHit, topicHit ? "«kasr» matnda" : "MAVZU YO'Q"),
      ];
    },
  },
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
      ];
    },
  },
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
    /* `--source <fayl>` — tarjima fayl rejimi: bayt `BuildOptions.source` orqali (worker `sourceForJob` yo'li). */
    const srcPath = sourceArg();
    const source =
      srcPath && c.tool === "translation" && c.values.mode === "file"
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

    const checks = c.checks(file, pages);
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
  const unsourced = f.doc.sections.flatMap((s) => s.blocks.filter((b) => (b.kind === "p" || b.kind === "li") && /\d+[.,]?\d*\s*%/.test(b.text) && !/\[(W\d+|u\d+)/.test(b.text)).map((b) => b.text.match(/\d+[.,]?\d*\s*%/)?.[0] ?? ""));
  return [
    ok("doc.article bor", Boolean(a), a ? `${a.type}/${a.profile}/${a.cite}` : "yo'q"),
    ok("titul/mundarija yo'q", f.doc.titlePage === false && f.doc.toc === false, `titlePage=${f.doc.titlePage} toc=${f.doc.toc}`),
    ok("iqtiboslar 100% reyestrda", Boolean(v) && v!.unresolved.length === 0 && cited > 0, v ? `${cited} iqtibos, ${v.unresolved.length} noma'lum` : "—"),
    ok("ro'yxat: faqat cited + tekshirilgan", refs.length > 0 && refs.every((r) => r.cited && r.verified !== "unverified"), `${refs.length} manba: ${refs.map((r) => `${r.id}:${r.verified}`).join(" ")}`),
    ok(`manbalar ≥ ${Math.min(profile.refsMin, 5)}`, refs.length >= Math.min(profile.refsMin, 5), `${refs.length} (profil ${profile.refsMin}–${profile.refsMax})`),
    ok("annotatsiya ×3", abs.length === 3 && ["uz", "ru", "en"].every((l) => abs.some((x) => x.lang === l)), abs.map((x) => x.lang).join(",")),
    ok(`annotatsiya ${minW}–${maxW} so'z (±30%)`, absWords.length === 3 && absWords.every((n) => n >= minW * 0.7 && n <= maxW * 1.3), absWords.join("/")),
    ok(`kalit so'zlar ${minK}–${maxK}`, kw.length === 3 && kw.every((n) => n >= minK && n <= maxK), kw.join("/")),
    ok("annotatsiyada iqtibos yo'q", abs.every((x) => !/\[(W\d+|u\d+)/.test(x.text)), ""),
    ok(wantFigures ? "sxema spec bor (url yo'q)" : "sxema yo'q", wantFigures ? (a?.figures.length ?? 0) > 0 && a!.figures.every((x) => x.spec && !x.url) : (a?.figures.filter((x) => x.spec.kind !== "prisma").length ?? 0) === 0, a?.figures.map((x) => `${x.id}:${x.spec.kind}`).join(",") || "—"),
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
  if (!process.env.GEMINI_API_KEY && !process.env.XAI_API_KEY) {
    console.error("GEMINI_API_KEY yo'q — jonli tekshiruv o'tkazib yuborildi.");
    process.exit(2);
  }
  await mkdir(OUT, { recursive: true });

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
