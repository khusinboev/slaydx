import { romanNumeral } from "./quality";

/**
 * Generatsiya tili.
 *
 * Formadagi til tanlovi shu paytgacha promptga faqat kod (`ru`, `en`) sifatida
 * tushardi, tizim prompti esa o'zbekcha yozilgani uchun model deyarli doim
 * o'zbekcha javob qaytarardi. Shu modul tilni modelga tushunarli qilib
 * (endonim + inglizcha nom) va qat'iy ko'rsatma bilan uzatadi, hamda hujjat
 * sarlavhalarini (mundarija, adabiyotlar, titul) shu tilga o'giradi.
 */

type LangInfo = {
  /** Modelga aytiladigan nom. */
  name: string;
  /** O'sha tildagi o'z nomi — model uchun qo'shimcha ishora. */
  native: string;
};

const LANGS: Record<string, LangInfo> = {
  uz: { name: "Uzbek (Latin script)", native: "o‘zbek tili" },
  kaa: { name: "Karakalpak (Latin script)", native: "qaraqalpaq tili" },
  kk: { name: "Kazakh (Cyrillic script)", native: "қазақ тілі" },
  ky: { name: "Kyrgyz (Cyrillic script)", native: "кыргыз тили" },
  tg: { name: "Tajik (Cyrillic script)", native: "забони тоҷикӣ" },
  tk: { name: "Turkmen (Latin script)", native: "türkmen dili" },
  ru: { name: "Russian", native: "русский язык" },
  en: { name: "English", native: "English" },
  tr: { name: "Turkish", native: "Türkçe" },
  ar: { name: "Arabic", native: "العربية" },
  de: { name: "German", native: "Deutsch" },
  fr: { name: "French", native: "français" },
  es: { name: "Spanish", native: "español" },
  zh: { name: "Chinese (Simplified)", native: "中文" },
  ko: { name: "Korean", native: "한국어" },
  ja: { name: "Japanese", native: "日本語" },
  it: { name: "Italian", native: "italiano" },
  pt: { name: "Portuguese", native: "português" },
};

export function langInfo(code: string): LangInfo {
  return LANGS[(code || "uz").toLowerCase()] ?? LANGS.uz;
}

export function isUzbek(code: string) {
  return (code || "uz").toLowerCase() === "uz";
}

/**
 * Har bir tizim promptining BIRINCHI qatori bo'lishi kerak bo'lgan qat'iy
 * til ko'rsatmasi. Modelga ko'rsatma qaysi tilda kelganidan qat'i nazar,
 * chiqish tili shu bo'ladi.
 */
export function languageDirective(code: string): string {
  const { name, native } = langInfo(code);
  return [
    `OUTPUT LANGUAGE: ${name} (${native}). This is absolute.`,
    `Write EVERY word of the result — headings, body text, lists, table cells, captions, references — in ${name}.`,
    `These instructions are written in Uzbek for convenience; do NOT let that change the output language.`,
    `Do not translate or mirror the text into any second language. Do not add the original in brackets.`,
  ].join(" ");
}

/** Hujjat ichidagi doimiy sarlavhalar. */
export type DocLabels = {
  toc: string;
  references: string;
  keywords: string;
  doneBy: string;
  /**
   * O'qituvchi hujjatlarida muallif yorlig'i.
   *
   * «Bajardi» — TALABA tili: u topshiriq bajaradi. O'qituvchi esa dars
   * ishlanmasini yoki texnologik xaritani TUZADI, shuning uchun
   * titulda «Tuzuvchi» turishi kerak.
   */
  compiledBy: string;
  supervisor: string;
  subject: string;
  faculty: (name: string) => string;
  department: (name: string) => string;
  course: (n: string) => string;
  group: (n: string) => string;
  academicYear: (a: number, b: number) => string;
  ministryHigher: string;
  ministrySchool: string;
};

const UZ: DocLabels = {
  toc: "MUNDARIJA",
  references: "FOYDALANILGAN ADABIYOTLAR",
  keywords: "Kalit so‘zlar",
  doneBy: "Bajardi",
  compiledBy: "Tuzuvchi",
  supervisor: "Ilmiy rahbar",
  subject: "Fan",
  faculty: (n) => `${n} fakulteti`,
  department: (n) => (n.toLowerCase().includes("kafedra") ? n : `${n} kafedrasi`),
  course: (n) => `${n}-kurs`,
  group: (n) => `${n}-guruh`,
  academicYear: (a, b) => `${a}-${b} o‘quv yili`,
  ministryHigher: "O‘ZBEKISTON RESPUBLIKASI\nOLIY TA’LIM, FAN VA INNOVATSIYALAR VAZIRLIGI",
  ministrySchool: "O‘ZBEKISTON RESPUBLIKASI\nMAKTABGACHA VA MAKTAB TA’LIMI VAZIRLIGI",
};

const RU: DocLabels = {
  toc: "СОДЕРЖАНИЕ",
  references: "СПИСОК ИСПОЛЬЗОВАННОЙ ЛИТЕРАТУРЫ",
  keywords: "Ключевые слова",
  doneBy: "Выполнил",
  compiledBy: "Составитель",
  supervisor: "Научный руководитель",
  subject: "Предмет",
  faculty: (n) => `Факультет ${n}`,
  department: (n) => (n.toLowerCase().includes("кафедр") ? n : `Кафедра ${n}`),
  course: (n) => `${n} курс`,
  group: (n) => `группа ${n}`,
  academicYear: (a, b) => `${a}-${b} учебный год`,
  ministryHigher: "РЕСПУБЛИКА УЗБЕКИСТАН\nМИНИСТЕРСТВО ВЫСШЕГО ОБРАЗОВАНИЯ, НАУКИ И ИННОВАЦИЙ",
  ministrySchool: "РЕСПУБЛИКА УЗБЕКИСТАН\nМИНИСТЕРСТВО ДОШКОЛЬНОГО И ШКОЛЬНОГО ОБРАЗОВАНИЯ",
};

const EN: DocLabels = {
  toc: "TABLE OF CONTENTS",
  references: "REFERENCES",
  keywords: "Keywords",
  doneBy: "Prepared by",
  compiledBy: "Compiled by",
  supervisor: "Supervisor",
  subject: "Subject",
  faculty: (n) => `Faculty of ${n}`,
  department: (n) => (n.toLowerCase().includes("department") ? n : `Department of ${n}`),
  course: (n) => `Year ${n}`,
  group: (n) => `Group ${n}`,
  academicYear: (a, b) => `${a}-${b} academic year`,
  ministryHigher: "REPUBLIC OF UZBEKISTAN\nMINISTRY OF HIGHER EDUCATION, SCIENCE AND INNOVATION",
  ministrySchool: "REPUBLIC OF UZBEKISTAN\nMINISTRY OF PRESCHOOL AND SCHOOL EDUCATION",
};

/**
 * Hujjat sarlavhalari. Faqat uz/ru/en to'liq tarjima qilingan — qolgan tillar
 * (qaraqalpaq, qozoq, qirg'iz...) O'zbekiston OTME hujjatlari uchun
 * o'zbekcha rasmiy shaklda qoladi.
 */
export function docLabels(code: string): DocLabels {
  const c = (code || "uz").toLowerCase();
  if (c === "ru") return RU;
  if (c === "en") return EN;
  return UZ;
}

/**
 * Bo'lim sarlavhalari.
 *
 * Bular hujjat skeletini yasaydi — LLM emas, kod yozadi. Shuning uchun tanlangan
 * tilga o'girilmasa, ruscha inshoda ham «Kirish», «I BOB ...NING NAZARIY ASOSLARI»
 * turadi. `chapterTheory` mavzuni qo'shimcha bilan biriktiradi (o'zbekcha «-ning»).
 */
export type SectionLabels = {
  intro: string;
  main: string;
  conclusion: string;
  /** «I BOB.» / «ГЛАВА I.» / «CHAPTER I.» — bob raqami sarlavha oldida. */
  chapterPrefix: (n: number) => string;
  chapterTheory: (topic: string) => string;
  chapterAnalysis: string;
  chapterPractice: string;
  chapterProblems: string;
  /** Hajmni to'ldirish uchun qo'shiladigan bobning nomi. */
  chapterExtra: string;
  /** Shu bobning ostmavzu nomlari (qo'shimcha tahlil burchaklari). */
  extraAngles: { practical: string; problem: string; compare: string; history: string; outlook: string };
  sub11: string;
  sub12: string;
  sub21: string;
  sub22: string;
  codeSample: string;
  // Maxsus hujjatlar
  lessonPassport: string;
  lessonMap: string;
  homework: string;
  timeTable: string;
  /** Vaqt jadvali: bosqich · daqiqa · kutilgan natija (B5 — «Faoliyat» olib tashlandi). */
  timeCols: [string, string, string];
  terms: string;
  shortTable: string;
  termCols: [string, string];
  caseWord: string;
  tasks: string;
  answerKey: string;
  /** Keys uchun baholash rubrikasi. */
  rubric: string;
  points: string;
  totalPoints: string;
  subjectPassport: string;
  yearPlan: string;
  yearCols: [string, string, string, string, string, string];
  summary: string;
  experience: string;
  education: string;
  skills: string;
  /**
   * Sayt ko'ruvchisi chizadigan qisqa yorliqlar.
   *
   * Bular DOCX da YO'Q (ko'ruvchi bezagi), lekin ru/en hujjatda ular
   * o'zbekcha turib qolgani foydalanuvchiga aralash til ko'rsatardi
   * (AUDIT-6 A4). Endi ular ham hujjat tiliga ergashadi.
   */
  viewerGlossary: string;
  viewerKeys: string;
  viewerLesson: string;
  viewerMap: string;
  viewerResume: string;
  fieldContact: string;
  fieldLanguage: string;
  /** «(davomi)» — jadval bir necha varaqqa bo'linganda. */
  continued: string;
  /** «12 ta atama» / «12 терминов» — ko'ruvchi muqovasida. */
  unitTerms: (n: number) => string;
  /** «5 ta vaziyatli topshiriq» — ko'ruvchi muqovasida. */
  unitCases: (n: number) => string;
  translation: string;
  translationBody: string;
  /** «Manba: fayl.docx» — tarjima info bloki. */
  translationSource: (name: string) => string;
  /** «Tildan: rus → o'zbek» — tarjima info bloki. */
  translationDirection: (from: string, to: string) => string;
  /** «Hajm: 12 000 belgi» — tarjima info bloki. */
  translationLength: (n: string) => string;
  /** Manba tili «avto» tanlanganda ko'rsatiladigan so'z. */
  autoDetected: string;
  /** Fayl yuklanmagan, matn joylashtirilgan bo'lsa — «Manba: …» o'rniga. */
  pastedText: string;
  imradIntro: string;
  imradMethods: string;
  imradResults: string;
  imradDiscussion: string;
  abstract: string;
  // Kod yozadigan qatorlar (LLM emas) — bular ham tarjima qilinishi kerak.
  fieldSubject: string;
  fieldGrade: string;
  fieldDuration: string;
  fieldTopic: string;
  fieldWeeklyHours: string;
  fieldTotalHours: string;
  fieldWeeks: string;
  minutesShort: string;
  stage: string;
  equipmentFallback: string;
  goalFallback: (topic: string) => string;
  homeworkFallback: (topic: string) => string;
  mapIntroFallback: string;
  glossaryIntroFallback: (topic: string) => string;
  keysIntroFallback: (topic: string) => string;
};

const SECTIONS: Record<string, SectionLabels> = {
  uz: {
    intro: "Kirish",
    main: "Asosiy qism",
    conclusion: "Xulosa",
    chapterPrefix: (n) => `${romanNumeral(n)} BOB.`,
    chapterTheory: (t) => `I BOB. ${t.toUpperCase()}NING NAZARIY ASOSLARI`,
    chapterAnalysis: "II BOB. TAHLIL VA MEXANIZM",
    chapterPractice: "II BOB. AMALIY TAHLIL VA TAVSIYALAR",
    chapterProblems: "III BOB. MUAMMO, YECHIM VA TAVSIYALAR",
    chapterExtra: "QO‘SHIMCHA TAHLIL VA ISTIQBOL",
    extraAngles: {
      practical: "Amaliy tahlil va O‘zbekiston tajribasi",
      problem: "Tipik qiyinchiliklar va ularning yechimi",
      compare: "Yondashuvlarning qiyosiy tahlili",
      history: "Shakllanish bosqichlari",
      outlook: "Istiqbol va amaliy tavsiyalar",
    },
    sub11: "1.1. Tushuncha, mohiyat va tasnif",
    sub12: "1.2. Asosiy unsurlari va bog‘liqlik",
    sub21: "2.1. Amaliy holat va muammolar",
    sub22: "2.2. Yechim va tavsiyalar",
    codeSample: "Namunaviy kod",
    lessonPassport: "Dars pasporti",
    lessonMap: "Darsning texnologik xaritasi",
    homework: "Uyga vazifa",
    timeTable: "Vaqt taqsimoti",
    timeCols: ["Bosqich", "Daqiqa", "Kutilgan natija"],
    terms: "Atamalar ro‘yxati",
    shortTable: "Qisqa jadval",
    termCols: ["Atama", "Izoh"],
    caseWord: "Keys",
    tasks: "Topshiriqlar",
    answerKey: "Namunaviy kalit",
    rubric: "Baholash mezonlari",
    points: "ball",
    totalPoints: "Jami",
    subjectPassport: "1. Fan pasporti",
    yearPlan: "O‘quv yili bo‘yicha taqsimot",
    yearCols: ["Hafta", "Soat", "Mavzu", "Metod", "Kutilgan natija", "Nazorat"],
    summary: "Qisqacha",
    experience: "Ish tajribasi",
    education: "Ta’lim",
    skills: "Ko‘nikmalar",
    viewerGlossary: "Glossariy",
    viewerKeys: "Kalitlar (keys)",
    viewerLesson: "Dars rejasi",
    viewerMap: "Texnologik xarita",
    viewerResume: "Rezyume",
    fieldContact: "Aloqa",
    fieldLanguage: "Til",
    continued: "(davomi)",
    unitTerms: (n) => `${n} ta atama`,
    unitCases: (n) => `${n} ta vaziyatli topshiriq`,
    translation: "Tarjima",
    translationBody: "Tarjima matni",
    translationSource: (n) => `Manba: ${n}`,
    translationDirection: (from, to) => `Tildan: ${from} → ${to}`,
    translationLength: (n) => `Hajm: ${n} belgi`,
    autoDetected: "avtomatik aniqlangan",
    pastedText: "matn",
    imradIntro: "1. Kirish (Introduction)",
    imradMethods: "2. Metodlar (Methods)",
    imradResults: "3. Natijalar (Results)",
    imradDiscussion: "4. Muhokama (Discussion)",
    abstract: "Annotatsiya",
    fieldSubject: "Fan",
    fieldGrade: "Sinf",
    fieldDuration: "Davomiyligi",
    fieldTopic: "Mavzu",
    fieldWeeklyHours: "Haftalik soat",
    fieldTotalHours: "Jami",
    fieldWeeks: "Haftalar",
    minutesShort: "daq",
    stage: "Bosqich",
    equipmentFallback: "Jihozlar: darslik, doska, tarqatma.",
    goalFallback: (t) => `Maqsad: ${t} bo‘yicha tushuncha shakllantirish.`,
    homeworkFallback: (t) => `${t} bo‘yicha 5 ta savol.`,
    mapIntroFallback: "Texnologik xarita — mavzu, soat, metod, natija, nazorat.",
    glossaryIntroFallback: (t) => `Ushbu glossariy «${t}» atamalarini izohlaydi.`,
    keysIntroFallback: (t) => `Kalitlar — «${t}» bo‘yicha vaziyatli topshiriqlar.`,
  },
  ru: {
    intro: "Введение",
    main: "Основная часть",
    conclusion: "Заключение",
    chapterPrefix: (n) => `ГЛАВА ${romanNumeral(n)}.`,
    chapterTheory: (t) => `ГЛАВА I. ТЕОРЕТИЧЕСКИЕ ОСНОВЫ ТЕМЫ «${t.toUpperCase()}»`,
    chapterAnalysis: "ГЛАВА II. АНАЛИЗ И МЕХАНИЗМ",
    chapterPractice: "ГЛАВА II. ПРАКТИЧЕСКИЙ АНАЛИЗ И РЕКОМЕНДАЦИИ",
    chapterProblems: "ГЛАВА III. ПРОБЛЕМЫ, РЕШЕНИЯ И РЕКОМЕНДАЦИИ",
    chapterExtra: "ДОПОЛНИТЕЛЬНЫЙ АНАЛИЗ И ПЕРСПЕКТИВЫ",
    extraAngles: {
      practical: "Практический анализ и опыт Узбекистана",
      problem: "Типичные трудности и их решение",
      compare: "Сравнительный анализ подходов",
      history: "Этапы становления",
      outlook: "Перспективы и практические рекомендации",
    },
    sub11: "1.1. Понятие, сущность и классификация",
    sub12: "1.2. Основные элементы и взаимосвязи",
    sub21: "2.1. Практическая ситуация и проблемы",
    sub22: "2.2. Решения и рекомендации",
    codeSample: "Пример кода",
    lessonPassport: "Паспорт урока",
    lessonMap: "Технологическая карта урока",
    homework: "Домашнее задание",
    timeTable: "Распределение времени",
    timeCols: ["Этап", "Минуты", "Ожидаемый результат"],
    terms: "Список терминов",
    shortTable: "Краткая таблица",
    termCols: ["Термин", "Определение"],
    caseWord: "Кейс",
    tasks: "Задания",
    answerKey: "Примерный ключ",
    rubric: "Критерии оценивания",
    points: "балл",
    totalPoints: "Итого",
    subjectPassport: "1. Паспорт предмета",
    yearPlan: "Распределение по учебному году",
    yearCols: ["Неделя", "Часы", "Тема", "Метод", "Ожидаемый результат", "Контроль"],
    summary: "Кратко о себе",
    experience: "Опыт работы",
    education: "Образование",
    skills: "Навыки",
    viewerGlossary: "Глоссарий",
    viewerKeys: "Кейсы",
    viewerLesson: "План урока",
    viewerMap: "Технологическая карта",
    viewerResume: "Резюме",
    fieldContact: "Контакты",
    fieldLanguage: "Язык",
    continued: "(продолжение)",
    unitTerms: (n) => `${n} терминов`,
    unitCases: (n) => `${n} ситуационных заданий`,
    translation: "Перевод",
    translationBody: "Текст перевода",
    translationSource: (n) => `Источник: ${n}`,
    translationDirection: (from, to) => `Язык: ${from} → ${to}`,
    translationLength: (n) => `Объём: ${n} символов`,
    autoDetected: "определён автоматически",
    pastedText: "текст",
    imradIntro: "1. Введение (Introduction)",
    imradMethods: "2. Методы (Methods)",
    imradResults: "3. Результаты (Results)",
    imradDiscussion: "4. Обсуждение (Discussion)",
    abstract: "Аннотация",
    fieldSubject: "Предмет",
    fieldGrade: "Класс",
    fieldDuration: "Продолжительность",
    fieldTopic: "Тема",
    fieldWeeklyHours: "Часов в неделю",
    fieldTotalHours: "Всего",
    fieldWeeks: "Недель",
    minutesShort: "мин",
    stage: "Этап",
    equipmentFallback: "Оборудование: учебник, доска, раздаточный материал.",
    goalFallback: (t) => `Цель: сформировать представление о теме «${t}».`,
    homeworkFallback: (t) => `5 вопросов по теме «${t}».`,
    mapIntroFallback: "Технологическая карта — тема, часы, метод, результат, контроль.",
    glossaryIntroFallback: (t) => `Данный глоссарий раскрывает термины по теме «${t}».`,
    keysIntroFallback: (t) => `Кейсы — ситуационные задания по теме «${t}».`,
  },
  en: {
    intro: "Introduction",
    main: "Main body",
    conclusion: "Conclusion",
    chapterPrefix: (n) => `CHAPTER ${romanNumeral(n)}.`,
    chapterTheory: (t) => `CHAPTER I. THEORETICAL FOUNDATIONS OF ${t.toUpperCase()}`,
    chapterAnalysis: "CHAPTER II. ANALYSIS AND MECHANISM",
    chapterPractice: "CHAPTER II. PRACTICAL ANALYSIS AND RECOMMENDATIONS",
    chapterProblems: "CHAPTER III. PROBLEMS, SOLUTIONS AND RECOMMENDATIONS",
    chapterExtra: "ADDITIONAL ANALYSIS AND OUTLOOK",
    extraAngles: {
      practical: "Practical analysis and local experience",
      problem: "Typical difficulties and their solutions",
      compare: "Comparative analysis of approaches",
      history: "Stages of development",
      outlook: "Outlook and practical recommendations",
    },
    sub11: "1.1. Concept, essence and classification",
    sub12: "1.2. Core elements and relationships",
    sub21: "2.1. Practical situation and problems",
    sub22: "2.2. Solutions and recommendations",
    codeSample: "Code sample",
    lessonPassport: "Lesson passport",
    lessonMap: "Lesson technology map",
    homework: "Homework",
    timeTable: "Time allocation",
    timeCols: ["Stage", "Minutes", "Expected outcome"],
    terms: "List of terms",
    shortTable: "Summary table",
    termCols: ["Term", "Definition"],
    caseWord: "Case",
    tasks: "Tasks",
    answerKey: "Model answer",
    rubric: "Assessment criteria",
    points: "points",
    totalPoints: "Total",
    subjectPassport: "1. Subject passport",
    yearPlan: "Distribution across the academic year",
    yearCols: ["Week", "Hours", "Topic", "Method", "Expected outcome", "Assessment"],
    summary: "Summary",
    experience: "Work experience",
    education: "Education",
    skills: "Skills",
    viewerGlossary: "Glossary",
    viewerKeys: "Case studies",
    viewerLesson: "Lesson plan",
    viewerMap: "Technology map",
    viewerResume: "Résumé",
    fieldContact: "Contact",
    fieldLanguage: "Language",
    continued: "(continued)",
    unitTerms: (n) => `${n} terms`,
    unitCases: (n) => `${n} case tasks`,
    translation: "Translation",
    translationBody: "Translated text",
    translationSource: (n) => `Source: ${n}`,
    translationDirection: (from, to) => `Language: ${from} → ${to}`,
    translationLength: (n) => `Length: ${n} characters`,
    autoDetected: "auto-detected",
    pastedText: "text",
    imradIntro: "1. Introduction",
    imradMethods: "2. Methods",
    imradResults: "3. Results",
    imradDiscussion: "4. Discussion",
    abstract: "Abstract",
    fieldSubject: "Subject",
    fieldGrade: "Grade",
    fieldDuration: "Duration",
    fieldTopic: "Topic",
    fieldWeeklyHours: "Hours per week",
    fieldTotalHours: "Total",
    fieldWeeks: "Weeks",
    minutesShort: "min",
    stage: "Stage",
    equipmentFallback: "Equipment: textbook, board, handouts.",
    goalFallback: (t) => `Goal: build an understanding of ${t}.`,
    homeworkFallback: (t) => `Five questions on ${t}.`,
    mapIntroFallback: "A technology map lists topic, hours, method, outcome and assessment.",
    glossaryIntroFallback: (t) => `This glossary explains the key terms of ${t}.`,
    keysIntroFallback: (t) => `Case studies — situational tasks on ${t}.`,
  },
};

export function sectionLabels(code: string): SectionLabels {
  return SECTIONS[(code || "uz").toLowerCase()] ?? SECTIONS.uz;
}

/**
 * Slayd shabloni sarlavhalari (LLM ishlamay qolganda va titul/yakun slaydda).
 *
 * Bu yorliqlarni KOD yozadi, model emas — shuning uchun ular tanlangan
 * tilga ergashishi shart. `quiz`/`references`/`answers` yangi maketlar
 * uchun (`slide-layout-extra.ts`), `goals`/`homework`/`practice` esa
 * tuzilma bloklari uchun (`slide-blocks.ts`).
 */
export type SlideLabels = {
  agenda: string;
  conclusion: string;
  questions: string;
  presentation: string;
  /** Nazorat testi slaydining sarlavhasi. */
  quiz: string;
  /** Adabiyotlar/manbalar slaydi. */
  references: string;
  /** Test javoblari slaydi — izoh o’chiq bo‘lganda `finalizeQuiz` qo‘shadi. */
  answers: string;
  goals: string;
  homework: string;
  practice: string;
};

const SLIDE_LABELS: Record<string, SlideLabels> = {
  uz: {
    agenda: "Reja",
    conclusion: "Xulosa",
    questions: "Savollar va muhokama",
    presentation: "Taqdimot",
    quiz: "Nazorat testi",
    references: "Foydalanilgan adabiyotlar",
    answers: "Test javoblari",
    goals: "Maqsadlar",
    homework: "Uyga vazifa",
    practice: "Amaliyot",
  },
  ru: {
    agenda: "План",
    conclusion: "Заключение",
    questions: "Вопросы и обсуждение",
    presentation: "Презентация",
    quiz: "Контрольный тест",
    references: "Использованная литература",
    answers: "Ответы к тесту",
    goals: "Цели",
    homework: "Домашнее задание",
    practice: "Практика",
  },
  en: {
    agenda: "Agenda",
    conclusion: "Conclusion",
    questions: "Questions and discussion",
    presentation: "Presentation",
    quiz: "Quiz",
    references: "References",
    answers: "Answer key",
    goals: "Goals",
    homework: "Homework",
    practice: "Practice",
  },
};

export function slideLabels(code: string): SlideLabels {
  return SLIDE_LABELS[(code || "uz").toLowerCase()] ?? SLIDE_LABELS.uz;
}
