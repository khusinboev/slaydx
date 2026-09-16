/**
 * NAMUNAVIY O'QITUVCHI HUJJATLARI (AUDIT-20 WP-C) — render/paritet
 * testlari, LibreOffice ko'z tekshiruvi va galereya uchun.
 *
 * Shakli dvigatel (WP-A/WP-B) chiqaradigan hujjat bilan AYNAN bir xil:
 * nasr `sections` da TEKIS id lar bilan (`passport`, `stages`, `q1`,
 * `terms`, `case1`, `variantA`…), metama'lumot va tuzilma `doc.teacher`
 * da. `work/samples.ts` naqshi.
 *
 * Mazmun HAQIQIY o'quv materiali emas — maketni sinash uchun yetarli
 * uzunlikdagi realistik matn (sahifa uzilishi, jadval o'ralishi va
 * alifbo tartibi shu bilan tekshiriladi).
 */
import type { AcademicDoc, Block, DocMeta, DocSection } from "../types";
import type {
  GlossaryTerm,
  KeysCase,
  LessonStage,
  MapQuarter,
  TeacherKind,
  TeacherModel,
  TestModel,
  TestQuestion,
} from "./types";

const section = (id: string, title: string, blocks: Block[] = []): DocSection => ({ id, title, blocks });
const p = (text: string): Block => ({ kind: "p", text });

export type SampleTeacherOpts = {
  /** Reyestr tur id — berilmasa kindning standart turi. */
  type?: string;
  language?: string;
  /** «Tasdiqlayman» lavozimi; `""` — qator umuman chizilmaydi. */
  approver?: string;
};

const SCHOOL = {
  institution: "Toshkent shahar Chilonzor tumani 15-son umumiy o‘rta ta’lim maktabi",
  author: "Karimova Dilnoza Baxtiyorovna",
  subject: "Biologiya",
  grade: 7,
  gradeLetter: "A",
  date: "2026-09-16",
};

/* ────────────────────────── dars ishlanmasi ────────────────────────── */

const STAGES: LessonStage[] = [
  {
    title: "Tashkiliy qism",
    minutes: 5,
    teacher: "Sinf davomatini tekshiradi, dars maqsadini e’lon qiladi va o‘quvchilarni ikki guruhga ajratadi.",
    student: "Dars jihozlarini tayyorlaydi, guruhdagi o‘z rolini tanlaydi.",
    method: "Suhbat",
    result: "O‘quvchilar dars maqsadini o‘z so‘zlari bilan ayta oladi",
  },
  {
    title: "O‘tilgan mavzuni takrorlash",
    minutes: 7,
    teacher: "«Hujayra organoidlari» mavzusi bo‘yicha 5 ta blits-savol beradi va javoblarni doskada belgilaydi.",
    student: "Savollarga javob beradi, javoblarni daftarga qisqacha yozib boradi.",
    method: "Blits-so‘rov",
    result: "Organoidlarning vazifasini farqlaydi",
  },
  {
    title: "Yangi mavzu bayoni",
    minutes: 15,
    teacher: "Fotosintezning yorug‘lik va qorong‘ilik bosqichlarini sxema orqali tushuntiradi, xlorofill roliga alohida to‘xtaladi.",
    student: "Sxemani daftariga ko‘chiradi, tushunmagan o‘rinlarini savol qilib beradi.",
    method: "Ma’ruza + vizual sxema",
    result: "Fotosintez bosqichlarini ketma-ketligi bilan aytadi",
  },
  {
    title: "Mustahkamlash",
    minutes: 12,
    teacher: "Guruhlarga «Yorug‘lik bosqichi» va «Qorong‘ilik bosqichi» kartochkalarini tarqatadi, taqdimotni boshqaradi.",
    student: "Guruhda kartochkalarni to‘g‘ri ketma-ketlikda joylashtiradi va natijani himoya qiladi.",
    method: "Kichik guruhlarda ishlash",
    result: "Bosqichlarni bir-biridan ajratib, misol keltira oladi",
  },
  {
    title: "Baholash va yakun",
    minutes: 6,
    teacher: "Guruh ishini mezon asosida baholaydi, uyga vazifani izohlaydi.",
    student: "O‘z ishini mezon bo‘yicha o‘zi baholaydi, uyga vazifani yozib oladi.",
    method: "Mezonli baholash",
    result: "Baholash mezonini tushunadi va o‘z-o‘zini baholay oladi",
  },
];

function lessonDocSample(meta: DocMeta, o: SampleTeacherOpts): AcademicDoc {
  const model: TeacherModel = {
    v: 1,
    kind: "lesson",
    type: o.type ?? "yangi-mavzu",
    school: { ...SCHOOL, language: meta.language, ...(o.approver === undefined ? { approver: "Direktorning o‘quv ishlari bo‘yicha o‘rinbosari" } : o.approver ? { approver: o.approver } : {}) },
    lesson: {
      type: o.type ?? "yangi-mavzu",
      goal: {
        talim: "O‘quvchilarda fotosintez jarayoni, uning bosqichlari va ahamiyati haqida tizimli tasavvur hosil qilish.",
        tarbiya: "Tabiatga ongli munosabatni va o‘simliklarni asrash mas’uliyatini shakllantirish.",
        rivoj: "Sxema asosida tahlil qilish va xulosa chiqarish ko‘nikmasini rivojlantirish.",
      },
      competencies: ["Tabiiy-ilmiy savodxonlik", "Axborot bilan ishlash kompetensiyasi", "Guruhda hamkorlik qilish"],
      equipment: ["Fotosintez sxemasi (plakat)", "Kartochkalar to‘plami", "Proyektor", "Darslik, 7-sinf"],
      stages: STAGES,
      homework: "Darslikning 24-mavzusini o‘qish; fotosintez bosqichlarini taqqoslovchi jadval tuzish (kamida 5 ta belgi bo‘yicha).",
      assessment: "Guruh ishi 3 ta mezon bo‘yicha (to‘g‘rilik, izchillik, himoya) 5 ballik shkalada baholanadi.",
      durationMin: 45,
    },
  };
  return {
    meta,
    titlePage: false,
    toc: false,
    teacher: model,
    sections: [
      section("passport", "", [
        p("Dars mavzusi o‘quv dasturining «O‘simliklar fiziologiyasi» bo‘limiga kiradi va oldingi «Hujayra tuzilishi» mavzusiga tayanadi."),
        p("Dars aralash turda tashkil etiladi: takrorlash, yangi bilim berish va amaliy mustahkamlash bosqichlari birlashtiriladi."),
      ]),
      section("goal", ""),
      section("stages", "", [p("Bosqichlar davomiyligi 45 daqiqaga moslangan; har bosqichda o‘qituvchi va o‘quvchi faoliyati alohida ko‘rsatilgan.")]),
      section("homework", ""),
      section("assessment", ""),
    ],
  };
}

/* ────────────────────────── texnologik xarita ────────────────────────── */

const MAP_TOPICS = [
  "Botanika fanining predmeti va vazifalari",
  "O‘simlik hujayrasi tuzilishi",
  "To‘qimalar va ularning turlari",
  "Ildiz va uning vazifalari",
  "Poya tuzilishi va o‘tkazuvchi to‘qimalar",
  "Barg tuzilishi",
  "Fotosintez jarayoni",
  "Nafas olish va transpiratsiya",
  "Gul tuzilishi va changlanish",
  "Urug‘ va meva",
  "Vegetativ ko‘payish",
  "Nazorat ishi va takrorlash",
];

const METHODS = ["Ma’ruza + suhbat", "Amaliy mashg‘ulot", "Laboratoriya ishi", "Mustaqil ish"];
const CONTROLS = ["Og‘zaki so‘rov", "Yozma topshiriq", "Amaliy ish", "Test"];

function quarters(count: number): MapQuarter[] {
  const perQuarter = Math.ceil(MAP_TOPICS.length / count);
  const out: MapQuarter[] = [];
  let n = 0;
  for (let q = 1; q <= count; q++) {
    const weeks = MAP_TOPICS.slice((q - 1) * perQuarter, q * perQuarter).map((topic, i) => ({
      n: ++n,
      topic,
      hours: 2,
      method: METHODS[(n + i) % METHODS.length],
      resources: "Darslik, plakat, mikroskop",
      control: CONTROLS[n % CONTROLS.length],
    }));
    if (weeks.length) out.push({ n: count === 1 ? 0 : q, weeks });
  }
  return out;
}

function mapDocSample(meta: DocMeta, o: SampleTeacherOpts): AcademicDoc {
  const type = (o.type ?? "choraklik") === "yillik" ? "yillik" : "choraklik";
  const qs = quarters(type === "yillik" ? 1 : 4);
  const model: TeacherModel = {
    v: 1,
    kind: "map",
    type,
    school: { ...SCHOOL, language: meta.language, ...(o.approver ? { approver: o.approver } : { approver: "Metodik kengash raisi" }) },
    map: { type, weeklyHours: 2, totalHours: qs.reduce((a, q) => a + q.weeks.length * 2, 0), quarters: qs },
  };
  const ids = type === "yillik" ? ["year"] : qs.map((q) => `q${q.n}`);
  return {
    meta,
    titlePage: false,
    toc: false,
    teacher: model,
    sections: [
      section("passport", "", [
        p("Taqvim-mavzu reja 7-sinf biologiya fani bo‘yicha amaldagi o‘quv dasturi asosida tuzilgan."),
        p("Haftada 2 soat; nazorat ishlari chorak yakunida o‘tkaziladi."),
      ]),
      ...ids.map((id) => section(id, "")),
    ],
  };
}

/* ────────────────────────── glossariy ────────────────────────── */

const TERMS: GlossaryTerm[] = [
  { term: "Xlorofill", def: "Yashil plastidalarda joylashgan, yorug‘lik energiyasini yutuvchi pigment.", example: "Xlorofill barg hujayralariga yashil rang beradi.", ru: "Хлорофилл", en: "Chlorophyll" },
  { term: "Assimilyatsiya", def: "Organizmda oddiy moddalardan murakkab organik birikmalar hosil bo‘lishi jarayoni.", example: "Fotosintez — assimilyatsiyaning eng keng tarqalgan ko‘rinishi.", ru: "Ассимиляция", en: "Assimilation" },
  { term: "Transpiratsiya", def: "O‘simlikning barg og‘izchalari orqali suv bug‘latishi.", example: "Issiq kunlarda transpiratsiya tezlashadi.", ru: "Транспирация", en: "Transpiration" },
  { term: "Og‘izcha", def: "Barg epidermisidagi, gaz almashinuvini ta’minlovchi teshikcha.", example: "Og‘izchalar kechasi yopiladi.", ru: "Устьице", en: "Stoma" },
  { term: "Fotosintez", def: "Yorug‘lik energiyasi yordamida karbonat angidrid va suvdan organik modda hosil bo‘lishi.", example: "Fotosintez natijasida kislorod ajralib chiqadi.", ru: "Фотосинтез", en: "Photosynthesis" },
  { term: "Kutikula", def: "Barg yuzasini qoplab turuvchi, suv yo‘qotishni kamaytiruvchi mumsimon qatlam.", example: "Cho‘l o‘simliklarida kutikula qalin bo‘ladi.", ru: "Кутикула", en: "Cuticle" },
  { term: "Ksilema", def: "Suv va mineral moddalarni ildizdan bargga olib boruvchi o‘tkazuvchi to‘qima.", example: "Ksilema poyaning markaziga yaqin joylashadi.", ru: "Ксилема", en: "Xylem" },
  { term: "Floema", def: "Organik moddalarni bargdan boshqa organlarga tashuvchi o‘tkazuvchi to‘qima.", example: "Floema po‘stloq ostida joylashgan.", ru: "Флоэма", en: "Phloem" },
];

function glossaryDocSample(meta: DocMeta, o: SampleTeacherOpts): AcademicDoc {
  const type = o.type ?? "fan-lugati";
  /** Alifbo tartibi — `Intl.Collator` (dvigateldagi qoida bilan bir xil). */
  const collator = new Intl.Collator(meta.language || "uz", { sensitivity: "base", numeric: true });
  const terms = [...TERMS].sort((a, b) => collator.compare(a.term, b.term));
  const model: TeacherModel = {
    v: 1,
    kind: "glossary",
    type,
    school: { ...SCHOOL, language: meta.language, ...(o.approver ? { approver: o.approver } : {}) },
    glossary: { type, terms, order: "alpha" },
  };
  return {
    meta,
    titlePage: false,
    toc: false,
    teacher: model,
    sections: [
      section("intro", "", [p("Glossariy 7-sinf biologiya kursining «O‘simliklar fiziologiyasi» bo‘limidagi asosiy atamalarni qamrab oladi.")]),
      section("terms", ""),
    ],
  };
}

/* ────────────────────────── keys ────────────────────────── */

const CASES: KeysCase[] = [
  {
    title: "Quriyotgan xonaki gul",
    situation:
      "Sinf burchagidagi xonaki gul bir oy ichida barglarini to‘kib, sarg‘ayib qoldi. Sinf navbatchilari uni har kuni sug‘organ, lekin gul deraza tokchasidan shkaf ustiga ko‘chirilgan edi. Tuproq doim nam, barg uchlari qorayib turibdi.",
    questions: ["Gulning quriyotganiga qaysi omil sabab bo‘lgan?", "Fotosintez va sug‘orish o‘rtasidagi bog‘liqlikni izohlang.", "Vaziyatni tuzatish uchun qanday chora taklif qilasiz?"],
    solution:
      "Asosiy sabab — yorug‘lik yetishmasligi: shkaf ustida yorug‘lik oqimi keskin kamaygan, fotosintez sekinlashgan, ildiz esa suvni avvalgi tezlikda so‘ra olmagan. Doimiy nam tuproq ildiz chirishiga olib kelgan. Chora: gulni yorug‘ deraza yoniga qaytarish, sug‘orishni kamaytirish, chirigan ildizlarni kesish.",
    rubric: [
      { criterion: "Sababni to‘g‘ri aniqlash", points: 4 },
      { criterion: "Fiziologik bog‘liqlikni izohlash", points: 3 },
      { criterion: "Amaliy chora taklif qilish", points: 3 },
    ],
  },
  {
    title: "Issiqxonadagi hosil pasayishi",
    situation:
      "Fermer issiqxonada pomidor yetishtiradi. Qish oyida harorat va sug‘orish me’yorda bo‘lsa-da, hosil o‘tgan yilga nisbatan uchdan bir qismga kamaydi. Issiqxona plyonkasi uch yil almashtirilmagan va ancha xiralashgan.",
    questions: ["Hosil pasayishining eng ehtimolli sababi nima?", "Buni tekshirish uchun qanday oddiy tajriba o‘tkazish mumkin?", "Fermerlar uchun tavsiya tayyorlang."],
    solution:
      "Xiralashgan plyonka yorug‘lik o‘tkazuvchanligini kamaytirgan, fotosintez jadalligi pasaygan va hosil kamaygan. Tekshirish: lyuksmetr bilan eski va yangi plyonka ostidagi yorug‘likni o‘lchash. Tavsiya: plyonkani almashtirish yoki qo‘shimcha fitolampa o‘rnatish.",
    rubric: [
      { criterion: "Sabab-oqibat zanjirini ko‘rsatish", points: 4 },
      { criterion: "Tekshirish usulini taklif qilish", points: 3 },
      { criterion: "Tavsiyaning amaliyligi", points: 3 },
    ],
  },
  {
    title: "Ikki xil tuproqdagi ko‘chatlar",
    situation:
      "Maktab tajriba maydonchasida bir xil navdagi loviya ikki xil tuproqqa ekildi. Birinchi maydonchada o‘simlik baland, barglari to‘q yashil; ikkinchisida past va barglari oqargan. Sug‘orish va yorug‘lik ikkalasida bir xil.",
    questions: ["Farqning sababi nimada bo‘lishi mumkin?", "Qaysi mineral element yetishmayotganini taxmin qiling va asoslang.", "Tajribani qanday to‘g‘ri tashkil qilish kerak edi?"],
    solution:
      "Ikkinchi maydonchada azot yetishmasligi ehtimoli yuqori: azot xlorofill sinteziga kerak, yetishmasa barglar oqaradi va o‘sish sekinlashadi. Tajriba to‘g‘ri bo‘lishi uchun tuproq tarkibi oldindan tahlil qilinishi va nazorat guruhi ajratilishi kerak edi.",
    rubric: [
      { criterion: "Taxminning ilmiy asoslanishi", points: 4 },
      { criterion: "Element va belgining bog‘lanishi", points: 3 },
      { criterion: "Tajriba metodikasini baholash", points: 3 },
    ],
  },
];

function keysDocSample(meta: DocMeta, o: SampleTeacherOpts): AcademicDoc {
  const type = o.type ?? "muammoli";
  const model: TeacherModel = {
    v: 1,
    kind: "keys",
    type,
    school: { ...SCHOOL, language: meta.language, ...(o.approver ? { approver: o.approver } : {}) },
    keys: { type, audience: "maktab", cases: CASES },
  };
  return {
    meta,
    titlePage: false,
    toc: false,
    teacher: model,
    sections: [
      section("intro", "", [p("Keys topshiriqlari 7-sinf biologiya kursining fotosintez va mineral oziqlanish mavzulariga mo‘ljallangan; har biri guruhda 15–20 daqiqada ishlanadi.")]),
      ...CASES.map((c, i) => section(`case${i + 1}`, `Keys ${i + 1}. ${c.title}`)),
    ],
  };
}

/* ────────────────────────── test ────────────────────────── */

const QUESTIONS: TestQuestion[] = [
  {
    id: "q1",
    kind: "single",
    stem: "Fotosintezning yorug‘lik bosqichi qayerda kechadi?",
    options: ["Tilakoid membranalarida", "Stromada", "Mitoxondriya matriksida", "Hujayra shirasida"],
    answer: 0,
    points: 1,
    bloom: "remember",
    difficulty: "oson",
    explanation: "Yorug‘lik bosqichi xloroplast tilakoidlari membranasida kechadi.",
  },
  {
    id: "q2",
    kind: "single",
    stem: "Fotosintez natijasida ajralib chiqadigan gaz qaysi moddadan hosil bo‘ladi?",
    options: ["Suvdan", "Karbonat angidriddan", "Glyukozadan", "Azotdan"],
    answer: 0,
    points: 1,
    bloom: "understand",
    difficulty: "orta",
    explanation: "Kislorod suv molekulasining fotolizidan ajraladi.",
  },
  {
    id: "q3",
    kind: "truefalse",
    stem: "Qorong‘ilik bosqichi faqat kechasi kechadi.",
    options: ["To‘g‘ri", "Noto‘g‘ri"],
    answer: false,
    points: 1,
    bloom: "understand",
    difficulty: "orta",
    explanation: "Qorong‘ilik bosqichi yorug‘likka bevosita bog‘liq emas, kunduzi ham kechadi.",
  },
  {
    id: "q4",
    kind: "multi",
    stem: "Quyidagilardan qaysilari fotosintez tezligiga bevosita ta’sir qiladi?",
    options: ["Yorug‘lik jadalligi", "Karbonat angidrid miqdori", "Tuproq rangi", "Harorat"],
    answer: [0, 1, 3],
    points: 2,
    bloom: "analyze",
    difficulty: "qiyin",
    explanation: "Tuproq rangi fotosintezga bevosita ta’sir qilmaydi.",
  },
  {
    id: "q5",
    kind: "open",
    stem: "Barg og‘izchalarining kunduzi ochilib, kechasi yopilishi o‘simlik uchun qanday ahamiyatga ega? Javobingizni asoslang.",
    options: [],
    answer: "Kunduzi gaz almashinuvi va fotosintez uchun CO₂ kerak; kechasi og‘izchalar yopilib, ortiqcha suv bug‘lanishining oldi olinadi.",
    points: 3,
    bloom: "evaluate",
    difficulty: "qiyin",
    explanation: "Javobda gaz almashinuvi ham, suvni tejash ham qayd etilishi kerak.",
  },
];

function testDocSample(meta: DocMeta, o: SampleTeacherOpts): AcademicDoc {
  const type = o.type ?? "nazorat";
  const variants = [
    { id: "A", order: [0, 1, 2, 3, 4], optionOrder: [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1], [0, 1, 2, 3], []] },
    { id: "B", order: [2, 0, 4, 1, 3], optionOrder: [[1, 0], [2, 0, 3, 1], [], [3, 1, 0, 2], [1, 3, 0, 2]] },
  ];
  const test: TestModel = {
    mode: "topic",
    type,
    questions: QUESTIONS,
    variants,
    key: { A: ["A", "A", "B", "ABD", "—"], B: ["B", "B", "—", "C", "BDA"] },
    scoring: {
      perQuestion: 1,
      total: QUESTIONS.reduce((a, q) => a + q.points, 0),
      gradeScale: [
        { minPercent: 86, maxPercent: 100, grade: 5 },
        { minPercent: 66, maxPercent: 85, grade: 4 },
        { minPercent: 30, maxPercent: 65, grade: 3 },
        { minPercent: 0, maxPercent: 29, grade: 2 },
      ],
    },
    instructions: [
      "Testda 5 ta savol bor, ulardan biri ochiq savol.",
      "Har bir yopiq savolda bitta to‘g‘ri javob bor (4-savoldan tashqari).",
      "Javoblarni javoblar varag‘iga ko‘k siyoh bilan belgilang.",
      "Chetga va savol matniga yozmang.",
    ],
    timeMin: 45,
    topicIds: [],
    ...(type === "bsb" || type === "chsb"
      ? {
          criteria: [
            { criterion: "Fotosintez bosqichlarini farqlaydi", points: 2, skill: "Bilim", taskRef: "q1" },
            { criterion: "Sabab-oqibatni izohlaydi", points: 3, skill: "Tushunish", taskRef: "q3" },
            { criterion: "Omillarni tahlil qiladi", points: 3, skill: "Tahlil", taskRef: "q4" },
          ],
        }
      : {}),
    omr: { count: 4, optionCount: 4, columns: 1, variantIds: ["A", "B"], idBoxes: 6, hasMulti: true },
  };
  const model: TeacherModel = {
    v: 1,
    kind: "test",
    type,
    school: {
      ...SCHOOL,
      language: meta.language,
      // «Tasdiqlayman» FAQAT BSB/ChSB da (R3 §3.7).
      ...(o.approver !== undefined ? (o.approver ? { approver: o.approver } : {}) : type === "bsb" || type === "chsb" ? { approver: "Metodik birlashma raisi" } : {}),
    },
    test,
  };
  return {
    meta,
    titlePage: false,
    toc: false,
    teacher: model,
    sections: [
      section("instructions", ""),
      ...variants.map((v) => section(`variant${v.id}`, "")),
      section("key", ""),
      ...(test.criteria ? [section("criteria", "")] : []),
      section("omr", "", [{ kind: "figure", figureId: "omr", text: "" }]),
    ],
  };
}

/* ────────────────────────── kirish nuqtasi ────────────────────────── */

const BUILDERS: Record<TeacherKind, (meta: DocMeta, o: SampleTeacherOpts) => AcademicDoc> = {
  lesson: lessonDocSample,
  map: mapDocSample,
  glossary: glossaryDocSample,
  keys: keysDocSample,
  test: testDocSample,
};

/**
 * `sampleTeacherDoc("lesson", meta)` — beshala kind uchun to'liq hujjat.
 * `meta` berilmasa vositaga mos minimal meta quriladi (testlar uchun).
 */
export function sampleTeacherDoc(kind: TeacherKind, meta?: Partial<DocMeta>, opts: SampleTeacherOpts = {}): AcademicDoc {
  const full = { ...sampleTeacherMeta(kind), ...meta } as DocMeta;
  return BUILDERS[kind](full, opts);
}

const TOOL_OF: Record<TeacherKind, string> = {
  lesson: "lesson-plan",
  map: "texnologik-xarita",
  glossary: "glossary",
  keys: "keys",
  test: "test",
};

const LABEL_OF: Record<TeacherKind, string> = {
  lesson: "Dars ishlanmasi",
  map: "Texnologik xarita",
  glossary: "Glossariy",
  keys: "Keys",
  test: "Test",
};

const TOPIC_OF: Record<TeacherKind, string> = {
  lesson: "Fotosintez va uning bosqichlari",
  map: "Biologiya, 7-sinf",
  glossary: "O‘simliklar fiziologiyasi atamalari",
  keys: "Fotosintez va mineral oziqlanish",
  test: "Fotosintez",
};

export function sampleTeacherMeta(kind: TeacherKind): DocMeta {
  return {
    toolId: TOOL_OF[kind],
    workLabel: LABEL_OF[kind],
    topic: TOPIC_OF[kind],
    language: "uz",
    subject: SCHOOL.subject,
    author: SCHOOL.author,
    university: SCHOOL.institution,
    grade: SCHOOL.grade,
    duration: 45,
    weeklyHours: 2,
    totalHours: 68,
    termCount: TERMS.length,
  } as unknown as DocMeta;
}
