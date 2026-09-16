/**
 * NAMUNAVIY TALABA ISHI (AUDIT-19 WP-C) — render/paritet testlari,
 * LibreOffice ko'z tekshiruvi va galereya uchun.
 *
 * Manbalar HAQIQIY EMAS (`verified: "user"` bilan belgilangan), lekin
 * shakli dvigatel chiqaradigan hujjat bilan AYNAN bir xil: matn
 * `sections` da TEKIS (bob = `ch1` sarlavha bo'limi, paragraf = `ch1.1`),
 * metama'lumot `doc.work` da, iqtiboslar xom `[id]` shaklida — raqamni
 * `planWork` beradi.
 *
 * `article/samples.ts` naqshi.
 */
import type { AcademicDoc, DocMeta, Reference } from "../types";
import { workLabels } from "./labels";
import { genreOf, workKindOf } from "./registry";
import { SUBJECT_PROFILES } from "./subjects";
import type { SubjectProfileId, WorkGenreId, WorkKindId, WorkModel } from "./types";

/* ────────────────────────── manbalar (15 ta) ────────────────────────── */

/**
 * Tartib SINOV uchun ATAYIN aralash berilgan: `orderUzReferences`
 * ularni O'zbekiston qoidasiga solishi kerak (qonun → Prezident →
 * VM → kitob → maqola → statistika → internet).
 */
export const SAMPLE_WORK_REFS: Reference[] = [
  { id: "u1", kind: "book", title: "Ta’limda raqamli texnologiyalar", authors: ["Karimov A. N."], year: 2022, publisher: "Fan", place: "Toshkent", pageCount: 240, verified: "user", cited: true },
  { id: "W2741809807", kind: "article", doi: "10.1186/s40561-023-00260-y", title: "Artificial intelligence in intelligent tutoring systems toward sustainable education", authors: ["Lin C.", "Huang A.", "Lu O."], year: 2023, venue: "Smart Learning Environments", pages: "45–67", verified: "user", cited: true },
  { id: "lex:1", kind: "law", title: "Ta’lim to‘g‘risida", authors: [], docNo: "O‘RQ-637", docDate: "2020-09-23", issuer: "O‘zbekiston Respublikasi", url: "https://lex.uz/docs/5013009", accessed: "2026-09-16", verified: "user", cited: true },
  { id: "u2", kind: "book", title: "Pedagogik tadqiqot metodologiyasi", authors: ["Aliyev B. T."], year: 2021, publisher: "O‘qituvchi", place: "Toshkent", pageCount: 180, verified: "user", cited: true },
  { id: "W4385", kind: "article", doi: "10.3390/app13116716", title: "Exploring the potential impact of artificial intelligence on interactive learning", authors: ["Ahmad S.", "Rahmat M.", "Mubarik M."], year: 2023, venue: "Applied Sciences", pages: "12–29", verified: "user", cited: true },
  { id: "lex:2", kind: "law", title: "Raqamli O‘zbekiston — 2030 strategiyasi to‘g‘risida", authors: [], docNo: "PF-6079", docDate: "2020-10-05", issuer: "O‘zbekiston Respublikasi Prezidenti", url: "https://lex.uz/docs/5030957", accessed: "2026-09-16", verified: "user", cited: true },
  { id: "u3", kind: "book", title: "Oliy ta’lim didaktikasi", authors: ["Yusupova M. S.", "Rahimov D. Q."], year: 2019, publisher: "Universitet", place: "Toshkent", pageCount: 312, verified: "user", cited: true },
  { id: "W5512", kind: "article", doi: "10.1016/j.compedu.2022.104516", title: "Adaptive learning systems and student achievement: a meta-analysis", authors: ["Zhang Y.", "Wang L."], year: 2022, venue: "Computers & Education", pages: "104–118", verified: "user", cited: true },
  { id: "u4", kind: "book", title: "Axborot texnologiyalari asoslari", authors: ["Sattorov F. A."], year: 2020, publisher: "Iqtisod-Moliya", place: "Toshkent", pageCount: 264, verified: "user", cited: true },
  { id: "lex:3", kind: "law", title: "Uzluksiz ta’lim tizimini rivojlantirish chora-tadbirlari to‘g‘risida", authors: [], docNo: "824-son", docDate: "2020-12-31", issuer: "O‘zbekiston Respublikasi Vazirlar Mahkamasi", url: "https://lex.uz/docs/5222888", accessed: "2026-09-16", verified: "user", cited: true },
  { id: "u5", kind: "book", title: "Ta’lim sifatini baholash", authors: ["Ergasheva N. X."], year: 2023, publisher: "Fan va texnologiya", place: "Toshkent", pageCount: 196, verified: "user", cited: true },
  { id: "W7731", kind: "article", doi: "10.1111/bjet.13334", title: "Learning analytics dashboards in higher education", authors: ["Ivanova E.", "Petrov S."], year: 2023, venue: "British Journal of Educational Technology", pages: "77–95", verified: "user", cited: true },
  { id: "u6", kind: "book", title: "Zamonaviy o‘qitish texnologiyalari", authors: ["Qodirov Sh. B."], year: 2018, publisher: "Navro‘z", place: "Toshkent", pageCount: 208, verified: "user", cited: true },
  { id: "st1", kind: "web", title: "Ta’lim sohasi ko‘rsatkichlari: statistik to‘plam", authors: [], year: 2025, publisher: "O‘zbekiston Respublikasi Statistika qo‘mitasi", url: "https://stat.uz/uz/rasmiy-statistika/education", accessed: "2026-09-16", verified: "user", cited: true },
  { id: "w1", kind: "web", title: "Oliy ta’lim muassasalari reytingi", authors: [], year: 2025, publisher: "Ta’lim sifatini nazorat qilish davlat inspeksiyasi", url: "https://tsni.uz/reyting", accessed: "2026-09-16", verified: "user", cited: true },
];

/* ────────────────────────── namuna ────────────────────────── */

export type SampleWorkOpts = {
  genre?: WorkGenreId;
  kind?: WorkKindId;
  subject?: SubjectProfileId;
  /** Sxema PNG (`data:` URL) — berilmasa o'rinbosar ramka chiziladi. */
  png?: string;
  /** Ilova bo'limi qo'shilsinmi (standart — ha). */
  appendix?: boolean;
};

/**
 * `sampleWorkDoc(meta, {genre, kind, subject})` — 2 bob × 2 paragraf,
 * 1 jadval («Manba:» bilan), 1 sxema, 1 formula, 15 manba va 1 ilova.
 * Har manba matnda kamida bir marta iqtibos qilingan — `citedOnly`
 * ro'yxatni to'liq saqlaydi.
 */
export function sampleWorkDoc(meta: DocMeta, over: SampleWorkOpts = {}): AcademicDoc {
  const genre = over.genre ?? "coursework";
  const kindId = over.kind ?? genreOf(genre).defaultKind;
  const kind = workKindOf(genre, kindId);
  const subject = SUBJECT_PROFILES[over.subject ?? "technical"];
  const language = meta.language || "uz";
  const L = workLabels(language);
  const topic = meta.topic || "Oliy ta’limda adaptiv o‘qitish tizimlarini joriy etish";

  const model: WorkModel = {
    v: 1,
    genre,
    kind: kind.id,
    subject: subject.id,
    language,
    title: topic,
    university: "Toshkent axborot texnologiyalari universiteti",
    faculty: "Dasturiy injiniring",
    department: "Axborot ta’lim texnologiyalari",
    subjectName: "Ta’limda axborot texnologiyalari",
    group: "301",
    course: "3",
    author: "Aliyev Ali Valiyevich",
    teacher: "Karimova Dilnoza Baxtiyorovna",
    teacherDegree: "PhD, dotsent",
    city: "Toshkent",
    ministry: "oliy",
    chapters: [
      {
        id: "ch1",
        title: "Adaptiv o‘qitish tizimlarining nazariy asoslari",
        paragraphs: [
          { id: "ch1.1", title: "Adaptiv o‘qitish tushunchasi va tasnifi", sectionId: "ch1.1" },
          { id: "ch1.2", title: "Xorijiy va mahalliy tajriba tahlili", sectionId: "ch1.2" },
        ],
      },
      {
        id: "ch2",
        title: "Tizimni joriy etish va samaradorlikni baholash",
        paragraphs: [
          { id: "ch2.1", title: "Tizim arxitekturasi va algoritmi", sectionId: "ch2.1" },
          { id: "ch2.2", title: "Samaradorlikni baholash natijalari", sectionId: "ch2.2" },
        ],
      },
    ],
    intro: {
      parts: { relevance: true, aim: true, tasks: true, object: true, subject: true, methods: true, structure: true, novelty: false, significance: false },
    },
    references: SAMPLE_WORK_REFS.map((r) => ({ ...r })),
    figures: [
      {
        id: "f1",
        kind: "scheme",
        caption: "Adaptiv o‘qitish tizimining umumiy tuzilmasi",
        spec: {
          kind: "flow",
          direction: "TB",
          nodes: [
            { id: "n1", label: "Talaba faoliyati", kind: "start" },
            { id: "n2", label: "Ma’lumot yig‘ish" },
            { id: "n3", label: "Tahlil moduli" },
            { id: "n4", label: "Shaxsiy traektoriya", kind: "end" },
          ],
          edges: [
            { from: "n1", to: "n2" },
            { from: "n2", to: "n3" },
            { from: "n3", to: "n4" },
          ],
        },
        w: 1890,
        h: 1400,
        source: L.byAuthor,
        ...(over.png ? { url: over.png } : {}),
      },
    ],
    refsMin: kind.refsMin,
    polishAccept: 2,
  };

  const doc: AcademicDoc = {
    meta: { ...meta, topic, language, workLabel: meta.workLabel || "Kurs ishi" },
    titlePage: true,
    toc: true,
    sections: [
      {
        id: "intro",
        title: L.intro,
        blocks: [
          { kind: "p", text: "Mavzuning dolzarbligi. Oliy ta’limda raqamli transformatsiya o‘quv jarayonini har talabaning o‘zlashtirish sur’atiga moslashtirishni talab qilmoqda [lex:2]. Uzluksiz ta’lim tizimini rivojlantirish chora-tadbirlari ham shu yo‘nalishni belgilaydi [lex:3]." },
          { kind: "p", text: "Ishning maqsadi — adaptiv o‘qitish tizimining talabalar o‘zlashtirishiga ta’sirini baholash. Ish vazifalari: nazariy asoslarni tizimlashtirish, mavjud tajribani tahlil qilish, tizim arxitekturasini ishlab chiqish va samaradorlikni o‘lchash [u2]." },
          { kind: "p", text: "Tadqiqot obyekti — oliy ta’lim muassasasining o‘quv jarayoni; tadqiqot predmeti — adaptiv o‘qitish vositalari [lex:1]. Tadqiqot metodlari: adabiyotlar tahlili, qiyosiy tahlil, pedagogik kuzatuv va statistik ishlov [u3]." },
          { kind: "p", text: "Ish tuzilmasi: kirish, ikki bob, xulosa, foydalanilgan adabiyotlar ro‘yxati va ilovadan iborat." },
        ],
      },
      { id: "ch1", title: "Adaptiv o‘qitish tizimlarining nazariy asoslari", blocks: [] },
      {
        id: "ch1.1",
        title: "Adaptiv o‘qitish tushunchasi va tasnifi",
        blocks: [
          { kind: "p", text: "Adaptiv o‘qitish — o‘quv materiali va uning ketma-ketligini talabaning joriy bilim darajasiga moslashtiruvchi yondashuv [W2741809807]. Bunday tizimlar uch qismdan iborat: talaba modeli, mazmun modeli va pedagogik qoidalar to‘plami [u1; 45-b.]." },
          { kind: "p", text: "Tasniflash mezoni sifatida moslashuv darajasi olinadi: mazmun bo‘yicha, sur’at bo‘yicha va baholash bo‘yicha moslashuv [u6]. Ushbu bo‘linish keyingi bobdagi arxitektura tanlovini asoslaydi." },
        ],
      },
      {
        id: "ch1.2",
        title: "Xorijiy va mahalliy tajriba tahlili",
        blocks: [
          { kind: "p", text: "Meta-tahlil natijalariga ko‘ra adaptiv tizimlar o‘zlashtirishni o‘rtacha darajada oshiradi [W5512]. Interaktiv o‘qitishda esa samara mazmun sifatiga kuchli bog‘liq [W4385]." },
          { kind: "tableRef", text: "Adaptiv o‘qitish tizimlarining qiyosiy tavsifi", tableId: "t1" },
          { kind: "p", text: "Mahalliy amaliyotda tizimlar asosan pilot rejimida sinovdan o‘tkazilgan [u4]; ta’lim ko‘rsatkichlarining rasmiy statistikasi bu jarayonni bilvosita tasdiqlaydi [st1]." },
        ],
      },
      { id: "ch2", title: "Tizimni joriy etish va samaradorlikni baholash", blocks: [] },
      {
        id: "ch2.1",
        title: "Tizim arxitekturasi va algoritmi",
        blocks: [
          { kind: "p", text: "Taklif etilayotgan arxitektura to‘rt bosqichdan iborat: faoliyatni qayd etish, ma’lumot yig‘ish, tahlil va traektoriya shakllantirish [fig:f1]." },
          { kind: "figure", text: "Adaptiv o‘qitish tizimining umumiy tuzilmasi", figureId: "f1" },
          { kind: "p", text: "Tahlil moduli o‘zlashtirish o‘sishini quyidagi nisbat bilan hisoblaydi; bu yerda x₁ — boshlang‘ich, x₂ — yakuniy o‘rtacha ball [u5]." },
          { kind: "formula", text: "\\Delta = \\frac{\\bar{x}_2 - \\bar{x}_1}{\\bar{x}_1} \\cdot 100\\%", display: true },
        ],
      },
      {
        id: "ch2.2",
        title: "Samaradorlikni baholash natijalari",
        blocks: [
          { kind: "p", text: "Baholash mezonlari sifatida o‘zlashtirish o‘sishi, topshiriqni bajarish vaqti va talabalar qoniqishi olindi [u5]. Mezonlar tanlovi ta’lim sifatini baholash bo‘yicha tavsiyalarga mos keladi [W7731]." },
          { kind: "p", text: "Muassasalar reytingi ma’lumotlari natijalarni tashqi mezon bilan solishtirish imkonini beradi [w1]. Umumiy xulosa: adaptiv traektoriya nazorat guruhiga nisbatan sezilarli farq beradi [u3]." },
        ],
      },
      {
        id: "conclusion",
        title: L.conclusion,
        blocks: [
          { kind: "p", text: "Nazariy asoslar tizimlashtirildi: adaptiv o‘qitish uch komponentli model sifatida ta’riflanadi va moslashuv darajasi bo‘yicha tasniflanadi." },
          { kind: "p", text: "Mavjud tajriba tahlili xorijiy tizimlarning samarasi mazmun sifatiga bog‘liqligini, mahalliy amaliyotda esa pilot bosqich ustunligini ko‘rsatdi." },
          { kind: "p", text: "Ishlab chiqilgan arxitektura va baholash mezonlari kirishda qo‘yilgan vazifalarga to‘liq javob beradi; tizimni fanlararo joriy etish tavsiya etiladi." },
        ],
      },
    ],
    tables: [
      {
        id: "t1",
        caption: "Adaptiv o‘qitish tizimlarining qiyosiy tavsifi",
        headers: ["Tizim", "Moslashuv turi", "Baholash usuli"],
        rows: [
          ["Knewton", "Mazmun bo‘yicha", "Uzluksiz test"],
          ["ALEKS", "Sur’at bo‘yicha", "Bilim kartasi"],
          ["Mahalliy pilot", "Aralash", "Nazorat ishi"],
        ],
        anchor: "ch1.2",
        source: L.byAuthor,
      },
    ],
    work: model,
  };

  if (over.appendix !== false) {
    doc.sections.push({
      id: "appendix-1",
      title: "Tajriba guruhlari bo‘yicha boshlang‘ich ma’lumotlar",
      blocks: [
        { kind: "p", text: "Ilovada tajriba va nazorat guruhlarining boshlang‘ich o‘zlashtirish ko‘rsatkichlari keltirilgan." },
        { kind: "li", text: "Tajriba guruhi — 60 talaba, boshlang‘ich o‘rtacha ball 4,1." },
        { kind: "li", text: "Nazorat guruhi — 60 talaba, boshlang‘ich o‘rtacha ball 4,1." },
      ],
    });
  }

  return doc;
}
