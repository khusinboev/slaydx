/**
 * RASM PARAMETRLARI REYESTRI — yagona manba (Formalar 3 / AUDIT-24, WP-E).
 *
 * `slide-params.ts`/`resume-params.ts` bilan bir xil shartnoma: **bezak
 * maydon yo'q**. `ImageStudio.tsx` `ToolChrome`siz, o'z qo'lda yozilgan
 * chizg'ichi bilan edi (etalon nomuvofiqligi — boshqa 21 forma `ToolChrome`
 * ichida); shu WP uni ham kartalar+`data-field` naqshiga o'tkazdi, lekin
 * ilgari reyestr umuman yo'q edi — «Nechta rasm» narxni o'zgartirsa ham
 * buni tasdiqlovchi test yo'q edi. `tests/image-params.test.mts`
 * differensial zond o'tkazadi: har `id` uchun `probeA`/`probeB` e'lon
 * qilingan ta'sirda (`prompt`/`size`/`price`) farq berishi SHART.
 *
 * Zond TO'LIQ `buildImageArtifact`ni chaqirmaydi (u fal.ai/LLM ga tarmoq
 * so'rovi yuboradi) — faqat sof funksiyalar: `composePrompt`,
 * `imageRatioById`, `priceFor`. `expandPrompt` (LLM boyitish) tarmoqqa
 * bog'liq, shuning uchun bu yerda zond qilinmaydi.
 */
import type { FormValues } from "../types";

export type ImageParamImpact =
  /** `composePrompt(...)` chiqishi (sahna, uslub suffiksi yoki freym) */
  | "prompt"
  /** Chiqish o'lchami (`imageRatioById(...).w/h`) */
  | "size"
  /** `priceFor(image, values)` */
  | "price";

export type ImageParam = {
  id: string;
  encode: "string" | "number";
  /** Differensial zond uchun ikki xil qiymat. */
  probeA: FormValues[string];
  probeB: FormValues[string];
  /** Shu chiqishlarda A va B farq qilishi SHART. */
  impacts: ImageParamImpact[];
};

export const IMAGE_PARAMS: ImageParam[] = [
  { id: "prompt", encode: "string", probeA: "a red apple on a table", probeB: "a blue whale in the ocean", impacts: ["prompt"] },
  { id: "imageStyle", encode: "string", probeA: "photo", probeB: "pencil", impacts: ["prompt"] },
  { id: "imageRatio", encode: "string", probeA: "1:1", probeB: "9:16", impacts: ["prompt", "size"] },
  { id: "imageCount", encode: "number", probeA: 1, probeB: 4, impacts: ["price"] },
];

/**
 * Forma AYNAN shu maydonlarni chizadi — `tests/ui/image-studio.test.mts`
 * qamrov testi shu ro'yxat bilan DOM dagi `data-field` larni solishtiradi.
 */
export const IMAGE_FORM_FIELDS: string[] = IMAGE_PARAMS.map((p) => p.id);

/** Tavsif maydoni uzunlik chegarasi — `LimitedTextarea` hisoblagichi uchun. */
export const IMAGE_PROMPT_LIMIT = 500;
