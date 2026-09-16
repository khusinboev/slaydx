/**
 * TALABA ISHLARI 2 (AUDIT-19) forma parametrlari REYESTRI.
 *
 * Qoida (slayd/rezyume/maqola bilan bir xil): formada ko'ringan HAR
 * maydon shu yerda e'lon qilinadi va `tests/work-params.test.mts`
 * differensial zondi uni qulflaydi — parametr chiqishga ta'sir qilmasa
 * test qizaradi («bezak maydon yo'q», mahsulot egasi qarori 5).
 *
 * Narx impact'i FAQAT `pages` da: narx hajmga qarab, hammasi ichida
 * (`lib/tools.ts priceFor` — kurs ishi 12–24 ming, referat/mustaqil
 * 3–6 ming; AUDIT-19 da narx O'ZGARMAYDI).
 */
import type { FormValues } from "../types";

export type WorkParamImpact =
  /** Tizim/foydalanuvchi prompti matni. */
  | "prompt"
  /** Bob/paragraf skeleti — reja tuzilishi. */
  | "structure"
  /** Manba so'rovi (`WorkResearchAsk`) — kinds/quota/want/userRefs. */
  | "research"
  /** Jadval/sxema rejasi va ularning bloklari. */
  | "figures"
  /** Tayyorlik hisoboti mezonlari/bandlari. */
  | "review"
  /** `doc.work` modeli — titul, bob daraxti, maket kirishi (WP-C `planWork`). */
  | "layout"
  /** `priceFor` natijasi. */
  | "price"
  /** `meta.language` / hujjat tili. */
  | "language";

export type WorkParam = {
  id: string;
  encode: "string" | "boolean" | "csv" | "json" | "number";
  probeA: FormValues[string];
  probeB: FormValues[string];
  impacts: WorkParamImpact[];
  /** Zondni shu qiymatlar ustida o'tkazish (masalan katta paket kerak bo'lsa). */
  probeWith?: FormValues;
};

/** JSON bo'lib yuboriladigan maydonlar — `validate.ts` `JSON_FIELDS` (24 000 belgi). */
export const WORK_JSON_FIELDS = ["userRefs", "figureKinds"] as const;

export const WORK_PARAMS: WorkParam[] = [
  /* ── mavzu va tur ── */
  { id: "topic", encode: "string", probeA: "Boshlang'ich sinfda o'qish ko'nikmalari", probeB: "Suv resurslarini muhofaza qilish", impacts: ["prompt", "research", "layout"] },
  { id: "workKind", encode: "string", probeA: "theory", probeB: "applied", impacts: ["structure", "prompt", "review"] },
  { id: "subjectProfile", encode: "string", probeA: "humanities", probeB: "legal", impacts: ["prompt", "research", "layout"] },
  { id: "language", encode: "string", probeA: "uz", probeB: "ru", impacts: ["language", "prompt", "layout"] },
  { id: "pages", encode: "string", probeA: "15-20", probeB: "30-35", impacts: ["prompt", "price"] },

  /* ── titul (9 maydon + vazirlik) ── */
  { id: "university", encode: "string", probeA: "Toshkent davlat universiteti", probeB: "Buxoro davlat universiteti", impacts: ["layout", "prompt"] },
  { id: "faculty", encode: "string", probeA: "Pedagogika fakulteti", probeB: "Filologiya fakulteti", impacts: ["layout", "prompt"] },
  { id: "department", encode: "string", probeA: "Boshlang'ich ta'lim kafedrasi", probeB: "Ona tili kafedrasi", impacts: ["layout", "prompt"] },
  { id: "subjectName", encode: "string", probeA: "Pedagogika", probeB: "Ona tili o'qitish metodikasi", impacts: ["layout", "prompt"] },
  { id: "author", encode: "string", probeA: "Aliyev Ali — 3-kurs, 301-guruh", probeB: "Karimova Dilnoza — 2-kurs, 205-guruh", impacts: ["layout", "prompt"] },
  { id: "group", encode: "string", probeA: "", probeB: "404-A", impacts: ["layout"] },
  { id: "course", encode: "string", probeA: "", probeB: "4", impacts: ["layout"] },
  { id: "teacher", encode: "string", probeA: "Rahimov B.", probeB: "Yo'ldosheva M.", impacts: ["layout", "prompt"] },
  { id: "teacherDegree", encode: "string", probeA: "", probeB: "p.f.n., dotsent", impacts: ["layout", "prompt"] },
  { id: "city", encode: "string", probeA: "Toshkent", probeB: "Buxoro", impacts: ["layout", "prompt"] },
  { id: "ministry", encode: "string", probeA: "oliy", probeB: "custom", impacts: ["layout"] },
  // «O'z matnim» faqat `ministry: custom` da ko'rinadi — zond ham shu holatda.
  { id: "ministryCustom", encode: "string", probeA: "", probeB: "O'ZBEKISTON RESPUBLIKASI RAQAMLI TEXNOLOGIYALAR VAZIRLIGI", probeWith: { ministry: "custom" }, impacts: ["layout"] },

  /* ── reja ── */
  { id: "tocMethod", encode: "string", probeA: "ai", probeB: "manual", probeWith: { tocText: "", extra: "1-BOB. Nazariy asoslar\n1.1. Tushuncha\n1.2. Yondashuvlar\n2-BOB. Tahlil\n2.1. Holat\n2.2. Natija" }, impacts: ["structure", "prompt"] },
  {
    id: "tocText",
    encode: "string",
    probeA: "",
    probeB: "1-BOB. O'qish ko'nikmasining nazariy asoslari\n1.1. Ko'nikma tushunchasi\n1.2. Yondashuvlar tahlili\n2-BOB. Amaliy tahlil\n2.1. Tashxis natijalari\n2.2. Tavsiyalar",
    impacts: ["structure", "prompt", "layout"],
  },

  /* ── vizuallar ── */
  { id: "includeVisuals", encode: "boolean", probeA: false, probeB: true, impacts: ["figures", "prompt"] },
  { id: "figureCount", encode: "number", probeA: 0, probeB: 2, probeWith: { pages: "30-35", includeVisuals: true }, impacts: ["figures", "prompt"] },
  { id: "tableCount", encode: "number", probeA: 0, probeB: 2, probeWith: { pages: "30-35", includeVisuals: true }, impacts: ["figures", "prompt"] },
  { id: "figureKinds", encode: "json", probeA: "[]", probeB: '["cycle"]', probeWith: { pages: "30-35", includeVisuals: true, figureCount: 2 }, impacts: ["figures", "prompt"] },

  /* ── materiallar ── */
  { id: "userFacts", encode: "string", probeA: "", probeB: "Tajribada 120 o'quvchi qatnashdi, o'rtacha ball 4,1 dan 4,6 ga oshdi.", impacts: ["prompt", "review"] },
  { id: "sourceText", encode: "string", probeA: "", probeB: "Maktab hisoboti: 2024-yilda 3-sinf o'quvchilarining o'qish tezligi o'rtacha 62 so'z/daqiqa.", impacts: ["prompt"] },
  { id: "userRefs", encode: "json", probeA: "[]", probeB: '[{"raw":"Karimov A. Pedagogika. — Toshkent: Fan, 2022."},{"doi":"10.1186/s40561-023-00260-y"}]', impacts: ["research", "layout"] },
  { id: "refsMin", encode: "number", probeA: 15, probeB: 25, impacts: ["review", "research", "prompt"] },
  { id: "extra", encode: "string", probeA: "", probeB: "Rasmiy uslub, «biz» olmoshisiz.", impacts: ["prompt"] },
];

export const WORK_FORM_FIELDS = WORK_PARAMS.map((p) => p.id);
