/**
 * INSHO (Talaba ishlari 2, AUDIT-19) FORMA PARAMETRLARI REYESTRI.
 *
 * Qoida (slayd/rezyume/maqola bilan bir xil): formada ko'ringan har
 * maydon shu yerda e'lon qilinadi va `tests/essay-params.test.mts`
 * differensial zondi uni qulflaydi — parametr e'lon qilingan HAR
 * ta'sirda `probeA` va `probeB` farqli natija bermasa test qizaradi
 * («bezak maydon yo'q», mahsulot egasi qarori 5).
 *
 * Narx ta'siri FAQAT `pages` da: insho narxi varaqqa bog'langan
 * (1–5 varaq → 2 000–4 000 tanga, `tools.ts`) va bu sprintda
 * O'ZGARMAYDI. Akademik esse va IELTS hajmi so'z bilan o'lchansa ham
 * narx baribir varaq chipidan.
 */
import type { FormValues } from "../types";

export type EssayParamImpact =
  /** Tizim/foydalanuvchi prompti matni. */
  | "prompt"
  /** Bandlar rejasi — kontekst tuzilmasi (soni, rollari). */
  | "structure"
  /** Tayyorlik hisoboti qoidalari/bandlari. */
  | "review"
  /** `meta.language` va inshoning yozilish tili. */
  | "language"
  /** Hujjat modeli: titul, ramka, epigraf, hajm — `doc.essay` va `doc.titlePage`. */
  | "layout"
  /** `priceFor` natijasi. */
  | "price";

export type EssayParam = {
  id: string;
  encode: "string" | "boolean" | "number";
  probeA: FormValues[string];
  probeB: FormValues[string];
  impacts: EssayParamImpact[];
  /** Zond shu qo'shimcha qiymatlar bilan o'lchanadi (masalan tur/kontekst). */
  probeWith?: FormValues;
};

export const ESSAY_PARAMS: EssayParam[] = [
  { id: "topic", encode: "string", probeA: "Ona tilim — g‘ururim", probeB: "Kitob o‘qishning foydasi", impacts: ["prompt", "layout"] },
  /*
   * Kontekst — eng kuchli parametr: turlar ro'yxati, hajm o'lchovi
   * (varaq/so'z), thesis statement va topic sentence talabi, titul
   * varaq, rubrika va baholovchi mezonlari — hammasi shundan.
   */
  { id: "essayContext", encode: "string", probeA: "school_dtm", probeB: "academic", impacts: ["structure", "prompt", "review", "layout"] },
  { id: "essayKind", encode: "string", probeA: "reflective", probeB: "argumentative", impacts: ["prompt", "layout"] },
  // Til — akademik kontekstda tanlanadi (maktab inshosi faqat o'zbekcha, IELTS faqat inglizcha).
  { id: "language", encode: "string", probeA: "uz", probeB: "en", probeWith: { essayContext: "academic", essayKind: "argumentative" }, impacts: ["language", "prompt", "layout"] },
  { id: "pages", encode: "string", probeA: "1", probeB: "5", impacts: ["prompt", "structure", "layout", "price"] },
  /*
   * So'z maqsadi — faqat akademik esseda (IELTS chegarasi qat'iy 250–330).
   * `price`: akademik esse narxi dvigatel YOZADIGAN hajmdan (cheklangan
   * `wordTarget` → varaq, `lib/tools.ts priceFor`, W4-E) — `pages` bilan
   * zid qo'lda yasalgan so'rov ham yoziladigan hajmni to'laydi.
   */
  { id: "wordTarget", encode: "number", probeA: 550, probeB: 950, probeWith: { essayContext: "academic", essayKind: "argumentative" }, impacts: ["prompt", "layout", "price"] },
  // Asar nomi — adabiy tahlilda; hisobotda `workQuote` bandi shunga qaraydi.
  { id: "workTitle", encode: "string", probeA: "", probeB: "Alpomish", probeWith: { essayContext: "school_dtm", essayKind: "literary" }, impacts: ["prompt", "review", "layout"] },
  { id: "epigraph", encode: "string", probeA: "", probeB: "So‘z — qalb kaliti — Alisher Navoiy", probeWith: { essayContext: "school_dtm", essayKind: "literary" }, impacts: ["prompt", "layout"] },
  { id: "userFacts", encode: "string", probeA: "", probeB: "O‘tkazgan so‘rovimda sinfdoshlarimning 78 % i kitob o‘qimasligini aytdi.", impacts: ["prompt", "review"] },
  { id: "design", encode: "string", probeA: "iris", probeB: "vintage", impacts: ["layout"] },
  { id: "person", encode: "string", probeA: "first", probeB: "third", impacts: ["prompt", "review"] },
  { id: "extra", encode: "string", probeA: "", probeB: "Jonli tilda, uzun jumlalarsiz yozing.", impacts: ["prompt"] },
];

export const ESSAY_FORM_FIELDS = ESSAY_PARAMS.map((p) => p.id);
