/**
 * INFOGRAFIKA (AUDIT-21) FORMA PARAMETRLARI REYESTRI.
 *
 * Qoida boshqa vositalar bilan bir xil: formada ko'ringan HAR maydon shu
 * yerda e'lon qilinadi, differensial zond (`tests/infographic-params.
 * test.mts`, WP-C) uni qulflaydi — parametr chiqishga ta'sir qilmasa
 * test qizaradi («bezak maydon yo'q», mahsulot egasi qarori 14).
 *
 * R0 da bu fayl REYESTRNING O'ZI; zondning O'ZI (forma →
 * `buildInfographicArtifact` → PNG/model farqi) WP-C da ulanadi.
 *
 * Manba: `docs/research/infographic.md` §3 parametrlar jadvali.
 *
 * NARX: parametrlar narxga ta'sir QILMAYDI — tekis 2 000. Palitrada ham
 * shunday: hisobot §2 da palitrani LLM tanlashi taklif qilingan edi,
 * biz esa uni FOYDALANUVCHIGA berdik («ko'rdim = oldim»: plakat rangini
 * o'qituvchi maktab dizayniga moslashi mumkin), lekin narx o'zgarmaydi.
 */
import type { FormValues } from "../types";

export type InfographicParamImpact =
  /** Tizim/foydalanuvchi prompti matni. */
  | "prompt"
  /** Spetsifikatsiya SHAKLI — blok soni, majburiy maydonlar. */
  | "structure"
  /** SVG maketi (`figures/layout-infographic.ts`) — zona, ustun, o'lcham. */
  | "layout"
  /** Ranglar (`PALETTES`). */
  | "palette"
  /** Hisobot qoidalari (`INFOGRAPHIC_RULE_IDS`) yoki baholovchi. */
  | "review"
  /** `meta.language` / plakat tili. */
  | "language"
  /** Ish byudjeti (`infographicBudgetMs`). */
  | "budget";

export type InfographicParam = {
  id: string;
  encode: "string" | "number";
  probeA: FormValues[string];
  probeB: FormValues[string];
  impacts: readonly InfographicParamImpact[];
  probeWith?: FormValues;
};

export const INFOGRAPHIC_PARAMS: InfographicParam[] = [
  { id: "topic", encode: "string", probeA: "Suv aylanishi", probeB: "Amir Temur davri islohotlari", impacts: ["prompt", "layout"] },
  { id: "infographicType", encode: "string", probeA: "list", probeB: "timeline", impacts: ["prompt", "structure", "layout", "review"] },
  /*
   * probeA/probeB IKKALA turda ham ruxsat etilgan qiymatlar
   * (`normalizeBlockCountFor` turga qarab kesadi): 3 va 6 — barcha yetti
   * turning chegarasiga tushadi, ya'ni zond qaysi tur bilan o'tkazilsa
   * ham haqiqiy FARQ o'lchaydi. 8 bo'lsa `process` (maks 6) da ikkala
   * qiymat 6 ga kesilib, zond «farqni o'lchay olmadi» deb qizarardi —
   * aynan shu tuzoq AUDIT-20 `translationLangs` da topilgan.
   */
  /*
   * `budget` ta'siri WP-C da QO'SHILDI: `budgetFor` (`budget.ts:271`)
   * ish vaqtini `infographicBudgetMs(normalizeBlockCountFor(...))` dan
   * oladi, ya'ni blok soni ISH MUDDATIGA ham ta'sir qiladi. R0 buni
   * e'lon qilmagan edi va `budget` ta'siri hech bir parametrda
   * ko'rsatilmay, zondning «o'lik ta'sir yo'q» bandi qizarardi.
   */
  { id: "blockCount", encode: "number", probeA: 3, probeB: 6, impacts: ["prompt", "structure", "layout", "review", "budget"] },
  { id: "palette", encode: "string", probeA: "indigo", probeB: "forest", impacts: ["palette", "layout"] },
  { id: "size", encode: "string", probeA: "A4", probeB: "A3", impacts: ["layout"] },
  { id: "language", encode: "string", probeA: "uz", probeB: "ru", impacts: ["language", "prompt", "layout"] },
  /*
   * `extra` — infografikada bu MA'LUMOT kanali, shunchaki uslub tilagi
   * emas: halollik qoidasi (`statPresent`/`honestyCheck`) bo'yicha
   * `stat` va `source` FAQAT shu yerdan (yoki manba faylidan) kelgan
   * raqamlar bilan to'ldiriladi. Shuning uchun `review` ham ta'sirda.
   */
  { id: "extra", encode: "string", probeA: "", probeB: "Yer yuzasining 71% i suv bilan qoplangan (manba: darslik, 6-sinf).", impacts: ["prompt", "review"] },
];

/** Formadan yuboriladigan maydon nomlari (`lib/tools.ts` shu ro'yxatni to'ldiradi). */
export const INFOGRAPHIC_FORM_FIELDS = INFOGRAPHIC_PARAMS.map((p) => p.id);
