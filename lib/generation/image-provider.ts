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
import { pexelsProvider } from "./image-provider-pexels";
import { pixabayProvider } from "./image-provider-pixabay";

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
  /**
   * Bepul stock-foto qidiruv so'rovi (P3) — `image-search-query.ts`
   * `searchQueryFor` bergan 2-5 so'zli inglizcha so'rov.
   *
   * `null`/`undefined` — bepul manba bu so'rov uchun ISHLATILMASIN:
   * `slideImageStyle` foto emas (illustration/chalk/minimal) yoki
   * chaqiruvchi buni ataylab bermagan (AI chizishni xohlaydi). Pexels/Pixabay provayderlari bu holatda darhol
   * `failed` qaytaradi (tarmoqqa chiqmasdan) — `chainProvider` keyingi
   * bosqichga (oxir-oqibat fal) o'tadi. Gemini/fal buni e'tiborsiz
   * qoldiradi.
   */
  searchQuery?: string | null;
  /**
   * Shu deka ichida ALLAQACHON ishlatilgan foto URL lari.
   *
   * `chainProvider` egallaydi va har chaqiruvdan oldin qo'yadi — bitta
   * dekada bir xil stock foto ikki marta chiqmasin (`per_page=5`
   * natijadan birinchi ISHLATILMAGANI tanlanadi). Fal/Gemini buni
   * e'tiborsiz qoldiradi — ular har doim yangi rasm CHIZADI.
   */
  seen?: Set<string>;
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

export type ImageProviderId = "fal" | "gemini" | "pexels" | "pixabay";

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
 * Stock-foto API lari kutgan nisbat so'zi (P3).
 *
 * Pexels UCHTA qiymat qabul qiladi (`landscape`/`portrait`/`square`),
 * Pixabay ikkita (`horizontal`/`vertical`) — har provayder o'z faylida
 * shu natijani o'ziga mos so'zga o'giradi. Yagona joyda hisoblanishi
 * kerak: ikkalasi ham AYNAN bir xil slot o'lchamidan (`ask.size`)
 * kelib chiqadi.
 */
export function photoOrientation(size: { width: number; height: number }): "landscape" | "portrait" | "square" {
  if (size.width === size.height) return "square";
  return size.width > size.height ? "landscape" : "portrait";
}

/**
 * Bir nechta provayderni ZANJIRGA ulaydi (P3, «Oddiy vosita rasmi:
 * Pexels → Pixabay → fal», `docs/AUDIT-9.md`).
 *
 * Nega alohida funksiya. `attachSlideImages` BITTA `ImageProvider`
 * bilan ishlaydi — ular ichida "agar pexels
 * yiqilsa pixabay'ni sina" degan mantiq YO'Q va bo'lishi ham shart
 * emas: shu bilim shu yerda qulflanadi, chaqiruvchi kod bitta
 * `fetchImage`ni chaqiraveradi, xuddi bitta provayder bilan
 * ishlagandek.
 *
 * Qoidalar:
 *   — kalitsiz provayder UMUMAN chaqirilmaydi (tarmoqqa chiqmaydi);
 *   — `no-key`/`failed`/`rate`/`timeout`/natija yo'q — keyingisiga
 *     o'tiladi (bepul manba muvaffaqiyatsiz bo'lsa fal baribir ishlasin);
 *   — `blocked` HAM keyingisiga o'tadi, lekin shu provayder ID si
 *     DEKA OXIRIGACHA "bloklangan" deb belgilanadi (`blockedIds`) —
 *     har slaydda qayta 403 kutib vaqt sarflanmasin;
 *   — hech biri berolmasa OXIRGI urinishning natijasi qaytariladi —
 *     odatda shu fal bo'ladi, ya'ni `attachSlideImages`ning fal/Gemini
 *     uchun mo'ljallangan `blocked` qisqa tutashuvi ZANJIR OXIRIDA ham
 *     to'g'ri ishlaydi (regressiya yo'q).
 *
 * `id` ATAYLAB birinchi provayderning EMAS, `"fal"` — chaqiruvchi kod
 * (`pickProvider` regressiya testi, jurnal yorlig'i) buni "oddiy slayd
 * rasm yo'li" deb taniydi; zanjirning qaysi bo'g'ini haqiqatan
 * yetkazgani natijaning O'ZIDA (`image.url` manbasi) ko'rinadi, alohida
 * kuzatish shart emas.
 *
 * `seen` — YOPIQ holat, har chaqiruvda `chainProvider(...)` YANGI
 * tuziladi (`pickProvider` har `attachSlideImages` chaqirig'ida qayta
 * chaqiriladi), ya'ni bitta DEKA doirasida yashaydi:
 * boshqa foydalanuvchining generatsiyasi bilan aralashmaydi, xotira
 * to'planib qolmaydi.
 */
export function chainProvider(providers: ImageProvider[]): ImageProvider {
  const seen = new Set<string>();
  const blockedIds = new Set<ImageProviderId>();
  return {
    id: "fal",
    minMs: Math.min(...providers.map((p) => p.minMs)),
    hasKey: () => providers.some((p) => p.hasKey()),
    async fetchImage(ask: ImageAsk, deadline?: number): Promise<ImageResult> {
      let last: ImageResult = { ok: false, reason: "no-key", detail: "provayderlar sozlanmagan" };
      for (const provider of providers) {
        if (!provider.hasKey() || blockedIds.has(provider.id)) continue;
        const res = await provider.fetchImage({ ...ask, seen }, deadline);
        if (res.ok) {
          seen.add(res.image.url);
          return res;
        }
        if (res.reason === "blocked") blockedIds.add(provider.id);
        last = res;
      }
      return last;
    },
  };
}

/**
 * Qaysi vosita — qaysi provayder.
 *
 * `pro-slide` — slaydiga alohida to'lanadigan pullik mahsulot, shuning
 * uchun u qimmatroq va matnni to'g'ri tushunadigan Gemini rasm modeliga
 * boradi.
 *
 * Oddiy `slide` esa endi ZANJIR (P3): avval BEPUL stock-foto manbalar
 * (Pexels → Pixabay), ular kalitsiz/yiqilsa yoki uslub foto bo'lmasa
 * (`searchQueryFor` `null` qaytaradi) — fal.ai. Kalitlar YO'Q bo'lgan
 * muhitda (hozirgi dev/test standarti) zanjir bir zumda fal'ga tushadi
 * — ya'ni ESKI xatti-harakat O'ZGARMAYDI, regressiya yo'q
 * (`tests/slide-images.test.mts`).
 *
 * `meta` berilmasa — fal (zanjir ichida, kalitsiz manbalar sakrab
 * o'tiladi). Shu tanlov `attachSlideImages` ning eski (meta'siz)
 * chaqiruvlarini, `scripts/image-lab.mts` ni va mavjud testlarni o'z
 * holida qoldiradi.
 */
export function pickProvider(meta?: Pick<DocMeta, "toolId"> | null): ImageProvider {
  const toolId: ToolId | undefined = meta?.toolId;
  if (toolId === "pro-slide") return geminiProvider;
  return chainProvider([pexelsProvider, pixabayProvider, falProvider]);
}
