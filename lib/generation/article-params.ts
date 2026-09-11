/**
 * Maqola 2 (AUDIT-17) forma parametrlari REYESTRI.
 *
 * Qoida (slayd/rezyume bilan bir xil): formada ko'ringan har maydon shu
 * yerda e'lon qilinadi va `tests/article-params.test.mts` differensial
 * zondi uni qulflaydi — parametr chiqishga ta'sir qilmasa test qizaradi
 * («bezak maydon yo'q»). Narx impact'i FAQAT `pages` va `articleType` da:
 * narx hajmga qarab, hammasi ichida (mahsulot egasi qarori).
 */
import type { FormValues } from "../types";

export type ArticleParamImpact =
  /** Tizim/foydalanuvchi prompti matni. */
  | "prompt"
  /** Tur skeleti — bo'limlar ro'yxati/tartibi. */
  | "structure"
  /** Nashr profili — shrift/interval/chegara/iqtibos uslubi. */
  | "profile"
  /** `planArticle` natijasi (tartib, raqamlash, mualliflar bloki). */
  | "layout"
  /** Manba qidiruv so'rovlari/ro'yxati. */
  | "research"
  /** Sxema/jadval rejasi. */
  | "figures"
  /** Tayyorlik hisoboti mezonlari. */
  | "review"
  /** `priceFor` natijasi. */
  | "price"
  /** `meta.language`. */
  | "language";

export type ArticleParam = {
  id: string;
  encode: "string" | "boolean" | "csv" | "json" | "number";
  probeA: FormValues[string];
  probeB: FormValues[string];
  impacts: ArticleParamImpact[];
  probeWith?: FormValues;
};

/** JSON bo'lib yuboriladigan maydonlar — `validate.ts` `JSON_FIELDS` (24 000 belgi). */
export const ARTICLE_JSON_FIELDS = ["authors", "userRefs", "keywords", "userData"] as const;

export const ARTICLE_PARAMS: ArticleParam[] = [
  { id: "topic", encode: "string", probeA: "Sun'iy intellekt ta'limda", probeB: "Qayta tiklanuvchi energiya", impacts: ["prompt", "research", "layout"] },
  { id: "articleType", encode: "string", probeA: "imrad_oak", probeB: "three_part_uz", impacts: ["structure", "prompt", "layout"] },
  { id: "pubProfile", encode: "string", probeA: "oak", probeB: "apa", impacts: ["profile", "layout", "review"] },
  { id: "citeStyle", encode: "string", probeA: "gost", probeB: "apa7", impacts: ["layout"] },
  { id: "language", encode: "string", probeA: "uz", probeB: "en", impacts: ["language", "prompt", "layout"] },
  { id: "pages", encode: "string", probeA: "3-5", probeB: "10-15", impacts: ["prompt", "price"] },
  { id: "authors", encode: "json", probeA: '[{"name":"Aliyev Ali"}]', probeB: '[{"name":"Karimova Dilnoza","org":"TDIU","orcid":"0000-0002-1825-0097"}]', impacts: ["layout"] },
  { id: "udk", encode: "string", probeA: "", probeB: "004.8", impacts: ["layout"] },
  { id: "keywords", encode: "json", probeA: "[]", probeB: '["sun\'iy intellekt","ta\'lim","adaptiv o\'qitish","LLM","baholash"]', impacts: ["prompt", "layout"] },
  { id: "userFacts", encode: "string", probeA: "", probeB: "Tajribada 120 talaba ishtirok etdi, o'rtacha ball 4,1 dan 4,6 ga oshdi.", impacts: ["prompt", "review"] },
  { id: "userRefs", encode: "json", probeA: "[]", probeB: '[{"doi":"10.1186/s40561-023-00260-y"},{"raw":"Karimov A. Ta\'limda AI. — Toshkent: Fan, 2022."}]', impacts: ["research", "layout"] },
  { id: "userData", encode: "json", probeA: "", probeB: '{"categories":["2022","2023","2024"],"series":[{"name":"Talabalar","values":[80,110,120]}]}', impacts: ["figures"] },
  // Sxema soni paketga bog'liq (`FIGURES_BY_PAGES`: 3–5 bet → 1) — zond katta paketda 0 va 2 ni solishtiradi.
  { id: "figureCount", encode: "number", probeA: 0, probeB: 2, probeWith: { pages: "10-15" }, impacts: ["figures", "prompt"] },
  { id: "research", encode: "boolean", probeA: false, probeB: true, impacts: ["research"] },
  { id: "extra", encode: "string", probeA: "", probeB: "Rasmiy uslub, «biz» olmoshisiz.", impacts: ["prompt"] },
];

export const ARTICLE_FORM_FIELDS = ARTICLE_PARAMS.map((p) => p.id);
