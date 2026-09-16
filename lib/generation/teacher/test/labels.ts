/**
 * TEST HUJJATIDAGI DOIMIY YORLIQLAR (AUDIT-20 WP-B).
 *
 * Hujjat TILIGA ergashadi, interfeys tiliga emas (`i18n.ts` qoidasi):
 * o'qituvchi rus sinfiga test tuzsa, «Javoblar kaliti» ham ruscha
 * chiqishi kerak. 18 tilning uchtasi (uz/ru/en) qo'lda yozilgan, qolgani
 * o'zbekchaga tushadi — yorliqlar bor-yo'g'i o'nta satr, LLM bilan
 * tarjima qilish ularni har generatsiyada boshqacha qilardi.
 */
export type TestLabels = {
  variant: string;
  instructions: string;
  key: string;
  keyWarning: string;
  criteria: string;
  answerSheet: string;
  gradeTable: string;
  points: string;
  grade: string;
  question: string;
  answer: string;
  bloom: string;
  difficulty: string;
  skill: string;
  task: string;
  criterion: string;
  student: string;
  openAnswer: string;
  percent: string;
};

const UZ: TestLabels = {
  variant: "variant",
  instructions: "Ko'rsatma",
  key: "Javoblar kaliti",
  keyWarning: "O'QITUVCHI UCHUN — o'quvchiga tarqatilmaydi",
  criteria: "Baholash mezonlari va ball",
  answerSheet: "Javoblar varag'i",
  gradeTable: "Ball → baho",
  points: "Ball",
  grade: "Baho",
  question: "№",
  answer: "Javob",
  bloom: "Bloom",
  difficulty: "Qiyinlik",
  skill: "Baholanadigan ko'nikma",
  task: "Topshiriq",
  criterion: "Baholash mezoni",
  student: "F.I.Sh. ______________________  Sinf ______  Sana ______  Ball ____ / ____  Baho ____",
  openAnswer: "Javob:",
  percent: "Foiz",
};

const RU: TestLabels = {
  variant: "вариант",
  instructions: "Инструкция",
  key: "Ключ ответов",
  keyWarning: "ДЛЯ УЧИТЕЛЯ — не раздавать ученикам",
  criteria: "Критерии оценивания и баллы",
  answerSheet: "Лист ответов",
  gradeTable: "Баллы → оценка",
  points: "Балл",
  grade: "Оценка",
  question: "№",
  answer: "Ответ",
  bloom: "Блум",
  difficulty: "Сложность",
  skill: "Оцениваемый навык",
  task: "Задание",
  criterion: "Критерий оценивания",
  student: "Ф.И.О. ______________________  Класс ______  Дата ______  Балл ____ / ____  Оценка ____",
  openAnswer: "Ответ:",
  percent: "Процент",
};

const EN: TestLabels = {
  variant: "variant",
  instructions: "Instructions",
  key: "Answer key",
  keyWarning: "FOR THE TEACHER — do not hand out to pupils",
  criteria: "Marking criteria and points",
  answerSheet: "Answer sheet",
  gradeTable: "Score → grade",
  points: "Points",
  grade: "Grade",
  question: "No.",
  answer: "Answer",
  bloom: "Bloom",
  difficulty: "Difficulty",
  skill: "Assessed skill",
  task: "Task",
  criterion: "Marking criterion",
  student: "Name ______________________  Class ______  Date ______  Score ____ / ____  Grade ____",
  openAnswer: "Answer:",
  percent: "Percent",
};

export function testLabels(lang: string): TestLabels {
  const c = (lang || "uz").toLowerCase();
  return c === "ru" ? RU : c === "en" ? EN : UZ;
}

/** Tur nomi hujjat tilida (reyestr yorliqlaridan; boshqa tillarda o'zbekcha). */
export function typeTitle(label: { uz: string; ru: string; en: string }, lang: string): string {
  const c = (lang || "uz").toLowerCase();
  return c === "ru" ? label.ru : c === "en" ? label.en : label.uz;
}
