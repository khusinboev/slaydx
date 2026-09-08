/**
 * RASM PROVAYDERI — yagona shartnoma (AUDIT-9 WP-E).
 *
 * Nega bu fayl bor. Ilgari rasm olishning YAGONA yo'li `slide-images.ts`
 * ichidagi `requestFalImage` edi: fal.ai ning URL i, sarlavhasi, tana
 * shakli va xato kodlari `attachSlideImages` bilan bitta faylda
 * chirmashib yotardi. Ikkinchi provayder qo'shish uchun o'sha
 * funksiyani `if (gemini) …` bilan ikkiga bo'lish kerak bo'lardi —
 * ya'ni har bir yangi provayder rasm bosqichining MANTIG'INI
 * (byudjet, blok qisqa tutashuvi, hisobot) qayta yozishga majbur
 * qilardi.
 *
 * Endi ajratish shunday:
 *   — provayder FAQAT «shu promptdan shu o'lchamda rasm ol» ni biladi;
 *   — `slide-images.ts` FAQAT «nechta rasm, qancha vaqt, nima hisobot»
 *     ni biladi va provayder qaysiligini bilmaydi.
 *
 * Shu sababli yiqilish TASNIFI (`FalFailure`) ham shartnomaning bir
 * qismi: `attachSlideImages` `blocked` ni ko'rib qolgan so'rovlarni
 * bekor qiladi, `timeout` ni esa `skipped` deb sanaydi. Yangi provayder
 * o'z HTTP kodlarini shu beshta holatga o'girishi SHART, aks holda
 * hisobot va pul qaytarish mantig'i unga ishlamaydi.
 */
import type { ToolId } from "../types";
import type { SlideImageStyle } from "./slide-params";
import type { DocMeta } from "./types";
import { falProvider } from "./image-provider-fal";
import { geminiProvider } from "./image-provider-gemini";

/**
 * Rasm so'rovi — provayderga yetadigan HAMMA narsa.
 *
 * `styleId` promptga allaqachon `slide-image-prompts.ts` da singdirilgan;
 * bu yerda u provayderning o'z sozlamasi uchun (jurnal, kelajakda uslubga
 * mos model tanlash) qoladi — provayder uni e'tiborsiz qoldirishi mumkin.
 */
export type ImageAsk = {
  prompt: string;
  size: { width: number; height: number };
  styleId: SlideImageStyle;
  /** Deka bo'ylab BITTA seed — 8–30 rasm bitta «kamera»dan chiqsin. */
  seed?: number;
  /**
   * Premium yo'l.
   *
   * Interfeysga ATAYIN kirdi: fal.ai da bu boshqa model va boshqa
   * inference qadami degani (`FAL_MODEL_PREMIUM`, `FAL_STEPS_PREMIUM`),
   * ya'ni uni tashlab yuborsak premium paket jimgina standartga
   * aylanardi. Gemini yo'lida esa bu bayroq hech nimani o'zgartirmaydi —
   * provayder uni shunchaki e'tiborsiz qoldiradi.
   */
  premium?: boolean;
};

/** `slide-images.ts` `persistImage` ga beriladigan manzil: `https:` yoki `data:`. */
export type ImageOk = { ok: true; image: { url: string; alt?: string } };

export type ImageFail = { ok: false; reason: FalFailure; detail: string };

export type ImageResult = ImageOk | ImageFail;

/**
 * Rasm so'rovi NEGA yiqilgani.
 *
 * Ilgari hamma yiqilish bitta `null` edi va bitta `console.warn` bilan
 * o'tardi. Jonli sinovda 19 ta so'rovning hammasi
 * `[fal] 403 User is locked. Reason: TOP_UP.` bilan rad etildi — ya'ni
 * HISOB bloklangan edi — lekin bu jurnalda vaqt tugagan holatdan
 * (`budget exhausted`) hech nima bilan farq qilmasdi. Ikkisining
 * yechimi butunlay boshqa: birinchisi hisobni to'ldirishni talab
 * qiladi, ikkinchisi byudjetni.
 *
 * Nom `Fal…` bo'lib qoldi (provayder-neytral bo'lsa ham): u
 * `slide-images.ts` dan eksport qilinadi va tashqi kod shu nom bilan
 * ishlaydi — qayta nomlash shartnomani buzardi, foyda bermay.
 */
export type FalFailure =
  /** Kalit umuman sozlanmagan. */
  | "no-key"
  /** Hisob yoki kalit rad etdi: 401/402/403. Qayta urinish ma'nosiz. */
  | "blocked"
  /** So'rov cheklovi (429) — vaqtinchalik. */
  | "rate"
  /** Vaqt yetmadi (byudjet yoki timeout). */
  | "timeout"
  /** Qolgan hammasi: 5xx, tarmoq, javobda rasm yo'q. */
  | "failed";

export type ImageProviderId = "fal" | "gemini";

export interface ImageProvider {
  /**
   * Bitta rasm uchun ENG KAM ma'noli vaqt. Undan kam qolganda so'rov
   * yuborilmaydi: javob baribir uzilib qoladi (o'lchov — Gemini 1K
   * rasmi ~35 s), lekin token/pul sarflangan bo'lardi va hisobotda
   * «failed» bo'lib ko'rinardi.
   */
  minMs: number;
  id: ImageProviderId;
  /**
   * Kalit sozlanganmi.
   *
   * `attachSlideImages` buni rasm VA'DA qilishdan oldin so'raydi:
   * kalitsiz muhitda (dev/test) `want` nolga tushadi, aks holda har
   * lokal deka «kam yetkazildi» bo'lib chiqar va kredit qaytarish
   * mantig'i bo'sh joyda ishga tushardi.
   */
  hasKey(): boolean;
  fetchImage(ask: ImageAsk, deadline?: number): Promise<ImageResult>;
}

/**
 * Bitta so'rov uchun qolgan vaqt — hamma provayderda bir xil qoida.
 *
 * `null` qaytsa so'rov umuman yuborilmaydi (`timeout` deb sanaladi):
 * 2 soniyada javob kelmasligi aniq, lekin so'rov baribir umumiy
 * byudjetni yeb qo'yardi.
 */
export function requestBudget(deadline: number | undefined, cap = 45_000): number | null {
  const budget = deadline ? Math.min(cap, Math.max(0, deadline - Date.now())) : cap;
  return budget < 2_000 ? null : budget;
}

/**
 * Qaysi vosita — qaysi provayder.
 *
 * `pro-slide` — slaydiga alohida to'lanadigan pullik mahsulot, shuning
 * uchun u qimmatroq va matnni to'g'ri tushunadigan Gemini rasm modeliga
 * boradi. Oddiy `slide` esa fal.ai da qoladi: eski xatti-harakat
 * O'ZGARMAYDI, ya'ni bu ish oqimi hech qanday regressiya keltirmaydi.
 *
 * `meta` berilmasa — fal. Shu tanlov `attachSlideImages` ning eski
 * (meta'siz) chaqiruvlarini, `scripts/image-lab.mts` ni va mavjud
 * testlarni o'z holida qoldiradi.
 */
export function pickProvider(meta?: Pick<DocMeta, "toolId"> | null): ImageProvider {
  const toolId: ToolId | undefined = meta?.toolId;
  return toolId === "pro-slide" ? geminiProvider : falProvider;
}
