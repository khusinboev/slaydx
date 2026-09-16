/**
 * O'QITUVCHI VOSITALARI 2 (AUDIT-20) forma parametrlari REYESTRI.
 *
 * Qoida (slayd/rezyume/maqola/talaba ishi bilan bir xil): formada
 * ko'ringan HAR maydon shu yerda e'lon qilinadi, va WP-E ning
 * differensial zondi (`tests/teacher-params.test.mts`) uni qulflaydi —
 * parametr chiqishga ta'sir qilmasa test qizaradi («bezak maydon yo'q»,
 * mahsulot egasi qarori 14).
 *
 * R0 da bu fayl REYESTRNING O'ZI: har parametr qaysi vositalarda
 * ko'rinadi (`kinds`), nimaga ta'sir qiladi (`impacts`) va zond qaysi
 * ikki qiymatni solishtiradi (`probeA`/`probeB`). Zondning o'zi (forma →
 * `buildTeacherDoc` → hujjat farqi) WP-E da ulanadi, chunki dvigatel
 * WP-A/WP-B da yoziladi. Bugun tekshiriladigan narsa — reyestrning
 * butunligi: id lar unikal, har parametrning egasi va ta'siri bor.
 *
 * Manba: `docs/research/{lesson-plan,texnologik-xarita,glossary,keys,
 * test}.md` §3 jadvallari.
 *
 * NARX: parametrlar narxga TA'SIR QILMAYDI — bitta istisno, glossariy
 * `termCount` (6 000/9 000/15 000, `priceFor`, AUDIT-20 da o'zgarmaydi).
 */
import type { FormValues } from "../types";
import { TEACHER_KINDS, type TeacherKind } from "./teacher/types";

export type TeacherParamImpact =
  /** Tizim/foydalanuvchi prompti matni. */
  | "prompt"
  /** Hujjat SKELETI — bo'limlar, jadval ustunlari, blok soni. */
  | "structure"
  /** `doc.teacher` modeli va maket kirishi (WP-C `planTeacher`). */
  | "layout"
  /** Hisobot qoidalari/bandlari (`TEACHER_RULE_IDS`) yoki baholovchi. */
  | "review"
  /** Manba: yuklangan fayl yoki o'quv dasturi mavzulari. */
  | "source"
  /** OMR javoblar varag'i (`FigureSpec kind:"omr"`). */
  | "omr"
  /** `priceFor` natijasi. */
  | "price"
  /** `meta.language` / hujjat tili. */
  | "language"
  /** Ish byudjeti (`teacherBudgetMs`). */
  | "budget";

export type TeacherParam = {
  id: string;
  /** Qaysi vositalarda ko'rinadi — bo'sh bo'lmasligi kerak. */
  kinds: readonly TeacherKind[];
  encode: "string" | "boolean" | "number" | "csv" | "json";
  probeA: FormValues[string];
  probeB: FormValues[string];
  impacts: readonly TeacherParamImpact[];
  /** Zondni shu qiymatlar ustida o'tkazish (masalan `mode: "curriculum"`). */
  probeWith?: FormValues;
};

/** JSON bo'lib yuboriladigan maydonlar — `validate.ts` `JSON_FIELDS` (24 000 belgi). */
export const TEACHER_JSON_FIELDS = ["competencies", "questionKinds", "topicIds"] as const;

const ALL = TEACHER_KINDS;

export const TEACHER_PARAMS: TeacherParam[] = [
  /* ── umumiy: mavzu, til, shapka ── */
  { id: "topic", kinds: ALL, encode: "string", probeA: "Fotosintez jarayoni", probeB: "Hosila va uning tatbiqlari", impacts: ["prompt", "layout"] },
  { id: "subject", kinds: ALL, encode: "string", probeA: "Biologiya", probeB: "Matematika", impacts: ["prompt", "layout", "review"] },
  { id: "grade", kinds: ALL, encode: "number", probeA: 3, probeB: 9, impacts: ["prompt", "layout", "structure", "review"] },
  { id: "gradeLetter", kinds: ["lesson", "test"], encode: "string", probeA: "", probeB: "A", impacts: ["layout"] },
  { id: "date", kinds: ["lesson", "test"], encode: "string", probeA: "", probeB: "2026-09-16", impacts: ["layout"] },
  { id: "language", kinds: ALL, encode: "string", probeA: "uz", probeB: "ru", impacts: ["language", "prompt", "layout"] },
  { id: "university", kinds: ALL, encode: "string", probeA: "15-son umumiy o'rta ta'lim maktabi", probeB: "42-son ixtisoslashtirilgan maktab", impacts: ["layout"] },
  { id: "author", kinds: ALL, encode: "string", probeA: "Karimova Dilnoza", probeB: "Rahimov Bekzod", impacts: ["layout"] },
  { id: "approver", kinds: ["lesson", "map", "test"], encode: "string", probeA: "", probeB: "Direktorning o'quv ishlari bo'yicha o'rinbosari", probeWith: { testType: "bsb" }, impacts: ["layout"] },
  { id: "extra", kinds: ALL, encode: "string", probeA: "", probeB: "Interaktiv usullarga urg'u bering.", impacts: ["prompt"] },

  /* ── dars rejasi (R1 §3) ── */
  { id: "lessonType", kinds: ["lesson"], encode: "string", probeA: "yangi-mavzu", probeB: "nazorat", impacts: ["structure", "prompt", "review", "layout"] },
  { id: "duration", kinds: ["lesson"], encode: "number", probeA: 45, probeB: 90, impacts: ["prompt", "structure", "layout", "budget"] },
  { id: "stageCount", kinds: ["lesson"], encode: "number", probeA: 4, probeB: 8, impacts: ["structure", "layout", "budget"] },
  { id: "competencies", kinds: ["lesson"], encode: "json", probeA: "[]", probeB: '["Axborot bilan ishlash","Muammoni hal qilish"]', impacts: ["prompt", "review", "layout"] },
  { id: "assessmentStyle", kinds: ["lesson"], encode: "string", probeA: "an'anaviy", probeB: "bsb", impacts: ["prompt", "structure"] },

  /* ── texnologik xarita (R1 §3) ── */
  { id: "mapType", kinds: ["map"], encode: "string", probeA: "yillik", probeB: "choraklik", impacts: ["structure", "layout", "review"] },
  { id: "weeklyHours", kinds: ["map"], encode: "number", probeA: 2, probeB: 4, impacts: ["structure", "prompt", "layout", "budget"] },
  { id: "totalHours", kinds: ["map"], encode: "number", probeA: 68, probeB: 136, impacts: ["structure", "prompt", "layout", "budget"] },
  { id: "controlLink", kinds: ["map"], encode: "string", probeA: "erkin", probeB: "bsb-chsb", impacts: ["prompt", "review"] },

  /* ── glossariy (R2 §3) ── */
  { id: "glossaryType", kinds: ["glossary"], encode: "string", probeA: "fan-lugati", probeB: "uch-tilli", impacts: ["structure", "prompt", "layout"] },
  // YAGONA narxga ta'sir qiluvchi parametr (6 000/9 000/15 000) — `priceFor`.
  { id: "termCount", kinds: ["glossary"], encode: "number", probeA: 10, probeB: 40, impacts: ["structure", "prompt", "price", "review", "budget"] },
  { id: "includeExample", kinds: ["glossary"], encode: "boolean", probeA: false, probeB: true, impacts: ["prompt", "structure", "review"] },
  /*
   * probeB QASDAN bitta til ("ru"): bo'sh tanlov (probeA) `teacher/
   * input.ts`da RUXSAT ETILGAN BARCHA tillarga tushadi (`uch-tilli`
   * turida ["ru","en"]) — probeB "ru,en" bo'lsa natija AYNI probeA
   * bilan bir xil chiqib, zond «farqni o'lchay olmadi» deb qizarardi
   * (WP-E da topilgan, `tests/teacher-params.test.mts` differensial
   * test).
   */
  { id: "translationLangs", kinds: ["glossary"], encode: "csv", probeA: "", probeB: "ru", probeWith: { glossaryType: "uch-tilli" }, impacts: ["structure", "prompt", "layout"] },

  /* ── keys (R2 §3) ── */
  { id: "keysType", kinds: ["keys"], encode: "string", probeA: "muammoli", probeB: "rolli", impacts: ["structure", "prompt", "review"] },
  { id: "caseCount", kinds: ["keys"], encode: "number", probeA: 3, probeB: 8, impacts: ["structure", "prompt", "review", "budget"] },
  { id: "audience", kinds: ["keys"], encode: "string", probeA: "maktab", probeB: "otm", impacts: ["prompt", "layout", "review"] },

  /* ── test (R3 §3.2) ── */
  { id: "mode", kinds: ["test"], encode: "string", probeA: "topic", probeB: "curriculum", impacts: ["source", "prompt", "review"] },
  { id: "testType", kinds: ["test"], encode: "string", probeA: "nazorat", probeB: "bsb", impacts: ["structure", "prompt", "review", "layout"] },
  { id: "count", kinds: ["test"], encode: "number", probeA: 10, probeB: 30, impacts: ["structure", "prompt", "review", "omr", "budget"] },
  { id: "openCount", kinds: ["test"], encode: "number", probeA: 0, probeB: 3, probeWith: { testType: "bsb", questionKinds: '["single","open"]', count: 20 }, impacts: ["structure", "prompt", "review", "omr"] },
  { id: "questionKinds", kinds: ["test"], encode: "json", probeA: '["single"]', probeB: '["single","truefalse","match"]', impacts: ["prompt", "structure", "omr", "review"] },
  { id: "difficulty", kinds: ["test"], encode: "string", probeA: "oson", probeB: "qiyin", impacts: ["prompt", "review"] },
  { id: "variants", kinds: ["test"], encode: "number", probeA: 1, probeB: 4, impacts: ["structure", "layout", "omr", "review"] },
  { id: "omr", kinds: ["test"], encode: "boolean", probeA: false, probeB: true, impacts: ["omr", "layout", "review"] },
  { id: "answerKey", kinds: ["test"], encode: "string", probeA: "alohida-bet", probeB: "oxirgi-bet", impacts: ["layout", "structure"] },
  { id: "criteriaTable", kinds: ["test"], encode: "boolean", probeA: false, probeB: true, probeWith: { testType: "bsb" }, impacts: ["structure", "layout", "review"] },
  { id: "timeMin", kinds: ["test"], encode: "number", probeA: 30, probeB: 90, impacts: ["prompt", "structure", "layout"] },
  { id: "topicIds", kinds: ["test"], encode: "json", probeA: "[]", probeB: '["hosila-va-uning-tatbiqlari-1","hosila-va-uning-tatbiqlari-10"]', probeWith: { mode: "curriculum" }, impacts: ["source", "prompt", "review"] },
  { id: "sourceText", kinds: ["test"], encode: "string", probeA: "", probeB: "Hosila — funksiya orttirmasining argument orttirmasiga nisbatining limiti.", probeWith: { mode: "file" }, impacts: ["source", "prompt", "review"] },
];

/** Formadan yuboriladigan maydon nomlari (WP-E `TeacherComposer` shu ro'yxatni to'ldiradi). */
export const TEACHER_FORM_FIELDS = TEACHER_PARAMS.map((p) => p.id);

/** Bitta vositaning maydonlari — forma shu tartibda chizadi. */
export function teacherParamsOf(kind: TeacherKind): TeacherParam[] {
  return TEACHER_PARAMS.filter((p) => p.kinds.includes(kind));
}
