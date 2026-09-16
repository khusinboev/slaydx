/**
 * NAMUNAVIY O'QITUVCHI HUJJATLARI (AUDIT-20 WP-C) — render/paritet
 * testlari, LibreOffice ko'z tekshiruvi va galereya uchun.
 *
 * Shakli dvigatel (`teacher/{lesson,map,glossary,keys}.ts` WP-A, test —
 * WP-B) chiqaradigan hujjat bilan AYNAN bir xil: nasr `sections` da
 * TEKIS id lar bilan (`passport`, `goal`, `stages`, `q1`, `terms`,
 * `case1`, `rubric`…), jadvallar `doc.tables` da `anchor` bilan,
 * metama'lumot `doc.teacher` da. Bloklarning SHAKLI ham yozuvchilarniki
 * (`stageBlocks`, `goalBlocks`, `termBlocks`, `rubricBlocks`) — aks
 * holda namuna maketni HAQIQIY hujjatdan boshqacha sinardi.
 *
 * `work/samples.ts` naqshi. Mazmun haqiqiy o'quv materiali emas, lekin
 * uzunligi realistik: sahifa uzilishi, jadval o'ralishi va alifbo
 * tartibi shu bilan tekshiriladi.
 */
import type { AcademicDoc, Block, DocMeta, DocSection, DocTable } from "../types";
import { teacherLayoutLabels } from "./layout";
import type {
  GlossaryTerm,
  KeysCase,
  LessonStage,
  MapQuarter,
  MapWeek,
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

const COMPETENCIES = ["Tabiiy-ilmiy savodxonlik", "Axborot bilan ishlash kompetensiyasi", "Guruhda hamkorlik qilish"];
const EQUIPMENT = ["Fotosintez sxemasi (plakat)", "Kartochkalar to‘plami", "Proyektor", "Darslik, 7-sinf"];

function lessonDocSample(meta: DocMeta, o: SampleTeacherOpts): AcademicDoc {
  const L = teacherLayoutLabels(meta.language);
  const type = o.type ?? "yangi-mavzu";
  const goal = {
    talim: "O‘quvchilarda fotosintez jarayoni, uning bosqichlari va ahamiyati haqida tizimli tasavvur hosil qilish.",
    tarbiya: "Tabiatga ongli munosabatni va o‘simliklarni asrash mas’uliyatini shakllantirish.",
    rivoj: "Sxema asosida tahlil qilish va xulosa chiqarish ko‘nikmasini rivojlantirish.",
  };
  const homework = "Darslikning 24-mavzusini o‘qish; fotosintez bosqichlarini taqqoslovchi jadval tuzish (kamida 5 ta belgi bo‘yicha).";
  const assessment = "Guruh ishi 3 ta mezon bo‘yicha (to‘g‘rilik, izchillik, himoya) 5 ballik shkalada baholanadi.";
  const model: TeacherModel = {
    v: 1,
    kind: "lesson",
    type,
    school: {
      ...SCHOOL,
      language: meta.language,
      ...(o.approver === undefined ? { approver: "Direktorning o‘quv ishlari bo‘yicha o‘rinbosari" } : o.approver ? { approver: o.approver } : {}),
    },
    lesson: { type, goal, competencies: COMPETENCIES, equipment: EQUIPMENT, stages: STAGES, homework, assessment, durationMin: 45 },
  };

  // `teacher/lesson.ts` dagi `passport` / `goalBlocks` / `stageBlocks` shakli.
  const passport: Block[] = [
    p(`${L.fieldSubject}: ${SCHOOL.subject}. ${L.fieldGrade}: ${SCHOOL.grade}-${SCHOOL.gradeLetter}. ${L.fieldDuration}: 45 ${L.minutesShort}.`),
    p(`${L.fieldTopic}: ${meta.topic}`),
    { kind: "h3", text: L.competencies },
    ...COMPETENCIES.map((c): Block => ({ kind: "li", text: c })),
    { kind: "h3", text: L.equipment },
    ...EQUIPMENT.map((e): Block => ({ kind: "li", text: e })),
  ];
  const stageBlocks: Block[] = [];
  STAGES.forEach((st, i) => {
    stageBlocks.push({ kind: "h3", text: `${i + 1}. ${st.title} (${st.minutes} ${L.minutesShort})` });
    stageBlocks.push(p(st.teacher));
    stageBlocks.push(p(st.student));
    stageBlocks.push(p(`${L.method}: ${st.method}`));
  });

  const table: DocTable = {
    caption: L.timeTable,
    anchor: "stages",
    widths: [42, 13, 45],
    headers: [...L.timeCols],
    rows: STAGES.map((st) => [st.title, String(st.minutes), st.result]),
  };

  return {
    meta,
    titlePage: false,
    toc: false,
    teacher: model,
    sections: [
      section("passport", L.lessonPassport, passport),
      section("goal", L.goal, [p(`${L.goalTalim}: ${goal.talim}`), p(`${L.goalTarbiya}: ${goal.tarbiya}`), p(`${L.goalRivoj}: ${goal.rivoj}`)]),
      section("stages", L.stages, stageBlocks),
      section("homework", L.homework, [p(homework)]),
      section("assessment", L.assessment, [p(assessment)]),
    ],
    tables: [table],
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
      result: `${topic.split(" ")[0]} bo‘yicha tushuntira oladi`,
      control: CONTROLS[n % CONTROLS.length],
    }));
    if (weeks.length) out.push({ n: count === 1 ? 0 : q, weeks });
  }
  return out;
}

function mapDocSample(meta: DocMeta, o: SampleTeacherOpts): AcademicDoc {
  const L = teacherLayoutLabels(meta.language);
  const type = (o.type ?? "choraklik") === "yillik" ? "yillik" : "choraklik";
  const qs = quarters(type === "yillik" ? 1 : 4);
  const weeklyHours = 2;
  const totalHours = qs.reduce((a, q) => a + q.weeks.length * weeklyHours, 0);
  const weekCount = qs.reduce((a, q) => a + q.weeks.length, 0);
  const model: TeacherModel = {
    v: 1,
    kind: "map",
    type,
    school: { ...SCHOOL, language: meta.language, ...(o.approver !== undefined ? (o.approver ? { approver: o.approver } : {}) : { approver: "Metodik kengash raisi" }) },
    map: { type, weeklyHours, totalHours, quarters: qs },
  };

  const rowOf = (w: MapWeek) => [String(w.n), String(w.hours), w.topic, w.method, w.result, w.control];
  const passport: Block[] = [
    p(`${L.fieldSubject}: ${SCHOOL.subject}. ${L.fieldWeeklyHours}: ${weeklyHours}. ${L.fieldTotalHours}: ${totalHours}. ${L.fieldWeeks}: ${weekCount}.`),
    p("Taqvim-mavzu reja 7-sinf biologiya fani bo‘yicha amaldagi o‘quv dasturi asosida tuzilgan."),
  ];

  const sections: DocSection[] = [section("passport", L.subjectPassport, passport)];
  const tables: DocTable[] = [];
  if (type === "choraklik") {
    for (const q of qs) {
      const id = `q${q.n}`;
      const title = L.quarter(q.n);
      sections.push(section(id, title, [p(`${q.weeks.length} ${L.weekWord}, ${q.weeks.length * weeklyHours} ${L.hoursWord}.`)]));
      tables.push({ caption: `${title} — ${L.yearPlan}`, anchor: id, headers: [...L.yearCols], rows: q.weeks.map(rowOf) });
    }
  } else {
    sections.push(section("year", L.yearPlan, [p(`${weekCount} ${L.weekWord}, ${totalHours} ${L.hoursWord}.`)]));
    tables.push({ caption: L.yearPlan, anchor: "year", headers: [...L.yearCols], rows: qs[0].weeks.map(rowOf) });
  }

  return { meta, titlePage: false, toc: false, teacher: model, sections, tables };
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
  const L = teacherLayoutLabels(meta.language);
  const type = o.type ?? "fan-lugati";
  const tri = type === "uch-tilli";
  /** Alifbo tartibi — `Intl.Collator` (dvigateldagi `sortTerms` qoidasi). */
  const collator = new Intl.Collator(meta.language || "uz", { sensitivity: "base", numeric: true });
  const terms = [...TERMS].sort((a, b) => collator.compare(a.term, b.term));
  const model: TeacherModel = {
    v: 1,
    kind: "glossary",
    type,
    school: { ...SCHOOL, language: meta.language, ...(o.approver ? { approver: o.approver } : {}) },
    glossary: { type, terms, order: "alpha", includeExample: true },
  };

  const termBlocks: Block[] = [];
  for (const t of terms) {
    termBlocks.push({ kind: "h3", text: t.term });
    termBlocks.push(p(t.def));
    if (t.example) termBlocks.push(p(`${L.example}: ${t.example}`));
  }

  return {
    meta,
    titlePage: false,
    toc: false,
    teacher: model,
    sections: [
      section("intro", L.intro, [p("Glossariy 7-sinf biologiya kursining «O‘simliklar fiziologiyasi» bo‘limidagi asosiy atamalarni qamrab oladi.")]),
      section("terms", L.terms, termBlocks),
    ],
    tables: tri
      ? [{ caption: L.terms, anchor: "terms", widths: [40, 30, 30], headers: [...L.triCols], rows: terms.map((t) => [t.term, t.ru ?? "", t.en ?? ""]) }]
      : [],
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
  const L = teacherLayoutLabels(meta.language);
  const type = o.type ?? "muammoli";
  const model: TeacherModel = {
    v: 1,
    kind: "keys",
    type,
    school: { ...SCHOOL, language: meta.language, ...(o.approver ? { approver: o.approver } : {}) },
    keys: { type, audience: "maktab", cases: CASES },
  };

  const sections: DocSection[] = [
    section("intro", L.intro, [p("Keys topshiriqlari 7-sinf biologiya kursining fotosintez va mineral oziqlanish mavzulariga mo‘ljallangan; har biri guruhda 15–20 daqiqada ishlanadi.")]),
  ];
  CASES.forEach((c, i) => {
    sections.push(
      section(`case${i + 1}`, `${L.caseWord} ${i + 1}. ${c.title}`, [
        p(c.situation),
        { kind: "h3", text: L.tasks },
        ...c.questions.map((q): Block => ({ kind: "li", text: q })),
        { kind: "h3", text: L.answerKey },
        p(c.solution),
      ]),
    );
  });
  // Rubrika ALOHIDA bo'lim — keyslardan keyin (WP-A shartnomasi).
  const rubricBlocks: Block[] = [];
  CASES.forEach((c, i) => {
    rubricBlocks.push({ kind: "h3", text: `${L.caseWord} ${i + 1}` });
    for (const r of c.rubric) rubricBlocks.push({ kind: "li", text: `${r.criterion} — ${r.points} ${L.points}` });
    rubricBlocks.push(p(`${L.totalPoints}: ${c.rubric.reduce((a, r) => a + r.points, 0)} ${L.points}`));
  });
  sections.push(section("rubric", L.rubric, rubricBlocks));

  return { meta, titlePage: false, toc: false, teacher: model, sections, tables: [] };
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

/**
 * Test hujjati — WP-B dvigateli hali birlashtirilmagan, shuning uchun
 * bo'limlar BO'SH va butun maket MODELDAN quriladi (`planTeacher`
 * zaxira yo'li). WP-B kelganda bo'limlar bloklar bilan to'ladi va
 * zaxira o'z-o'zidan o'chadi — maket o'zgarmaydi.
 */
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
      /*
       * Tartib `test/engine.ts testSections` bilan AYNI: o'quvchi
       * qismi (ko'rsatma → variantlar → javob varag'i) birga, keyin
       * o'qituvchi qismi (kalit → mezon). Namunada `omr` oxirida
       * turardi va shu sababli maket testlari HECH QACHON
       * yaratilmaydigan tartibni qulflab qo'ygan edi (WP-C ochiq bandi).
       */
      section("instructions", ""),
      ...variants.map((v) => section(`variant${v.id}`, "")),
      section("omr", ""),
      section("key", ""),
      ...(test.criteria ? [section("criteria", "")] : []),
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
