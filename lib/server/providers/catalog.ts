import { GROUNDING_USD, IMAGE_PRICES, OPENAI_IMAGE_USD_PER_MTOK, PRICING, TTS_PRICING } from "../../generation/llm-pricing";
import { HEYGEN_USD_PER_SECOND } from "../../media/catalog-video";
import type { ProviderId } from "./registry";
import type { RouteId } from "./routes";

/**
 * What the admin «Provayderlar» page tells the owner about each provider and each PURPOSE (owner request
 * 2026-10-31): which ones cost money, what each is used for, what is required and what is enough. Pure data and
 * pure functions (no I/O, no secrets) so the page text, the verdict rules and the tests share one source.
 *
 * Prices are never typed twice: the notes read the price book (`llm-pricing.ts`), the same numbers the cost reports
 * use. `tests/provider-catalog.test.mts` pins that every registry provider has an entry and every purpose names
 * only registry providers.
 */

export type Billing = "paid" | "free" | "free-tier";
/** How much the product needs this provider overall. */
export type Need = "required" | "recommended" | "optional";

export type ProviderMeta = {
  billing: Billing;
  /** One short line: what it costs. */
  priceNote: string;
  /** One sentence: what the product uses it for. */
  role: string;
  need: Need;
  /** Works without a key (OpenAlex, Google Books): a key only raises the quota, so «Kalit yo'q» is not «ishlamaydi». */
  keyless: boolean;
  /** Where the owner gets a key (a public sign-up / console page, never a secret). */
  keyUrl: string | null;
};

const usd = (n: number): string => `$${Number(n.toFixed(4))}`;

function llmNote(provider: string, model: string): string {
  const row = PRICING.find((r) => r.provider === provider && r.model === model && !r.from);
  return row ? `${model}: ${usd(row.inUsdPerM)} kirish / ${usd(row.outUsdPerM)} chiqish (1M token)` : model;
}

const tts = (provider: string) => TTS_PRICING.find((r) => r.provider === provider);

/** Provider facts keyed by registry id. A provider with no entry fails `provider-catalog.test.mts`. */
export const PROVIDER_META: Readonly<Record<string, ProviderMeta>> = {
  gemini: {
    billing: "paid",
    priceNote: `${llmNote("gemini", "gemini-3.7-flash")} · rasm ${usd(IMAGE_PRICES["gemini-3.1-flash-lite-image"])} / dona · internet qidiruvi ${usd(GROUNDING_USD)} / so'rov`,
    role: "Asosiy motor: barcha matn vositalari, AI rasm (Nano Banana), ovoz (TTS), Studio «Musiqa»dagi Lyria (qo'shiq $0.04 / $0.08), domla javobini tinglash, pro-slayddagi internet qidiruvi va AI chat.",
    need: "required",
    keyless: false,
    keyUrl: "https://aistudio.google.com/apikey",
  },
  anthropic: {
    billing: "paid",
    priceNote: llmNote("anthropic", "claude-sonnet-5"),
    role: "Maqolaning «baholovchisi» (tayyorlik hisoboti): Gemini'dan qattiqroq tekshiradi. Yo'q bo'lsa baholashni Gemini bajaradi.",
    need: "recommended",
    keyless: false,
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  qwen: {
    billing: "paid",
    priceNote: `${llmNote("qwen", "qwen3.7-plus")} · ${llmNote("qwen", "qwen3.8-flash")}`,
    role: "Gemini ishlamay qolganda birinchi zaxira: barcha matn vositalari shu model bilan yakunlanadi. Internet qidiruvi va ovozni baholash zaxiraga o'tmaydi. O'zbekcha sifatini avval sinab ko'ring.",
    need: "optional",
    keyless: false,
    keyUrl: "https://modelstudio.console.alibabacloud.com/",
  },
  deepseek: {
    billing: "paid",
    priceNote: `${llmNote("deepseek", "deepseek-flash")} · ${llmNote("deepseek", "deepseek-v4-pro")} · tungi soatlarda yarim narx`,
    role: "Ikkinchi arzon zaxira: Gemini va Qwen javob bermasa matnni yozadi. O'zbekcha sifatini avval sinab ko'ring.",
    need: "optional",
    keyless: false,
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  pexels: {
    billing: "free",
    priceNote: "Bepul · soatiga 200 so'rov limiti bor",
    role: "Oddiy slayddagi stok fotosuratlar (birinchi manba).",
    need: "recommended",
    keyless: false,
    keyUrl: "https://www.pexels.com/api/",
  },
  pixabay: {
    billing: "free",
    priceNote: "Bepul · daqiqasiga 100 so'rov limiti bor",
    role: "Stok fotosuratlarning zaxira manbasi (Pexels topolmasa).",
    need: "optional",
    keyless: false,
    keyUrl: "https://pixabay.com/api/docs/",
  },
  azure: {
    billing: "free-tier",
    priceNote: `${tts("azure")?.billing === "chars" ? usd((tts("azure") as { usdPerMChars: number }).usdPerMChars) : "$16"} / 1M belgi · oyiga 500 ming belgi bepul (F0 tarif)`,
    role: "Podkast, tabriknoma va tinglash o'yini uchun o'zbek va boshqa tillardagi ovoz (birinchi tanlov, barqaror kvota).",
    need: "optional",
    keyless: false,
    keyUrl: "https://portal.azure.com/",
  },
  aisha: {
    billing: "paid",
    priceNote: "1 so'm / belgi",
    role: "Mahalliy o'zbek ovozi — Azure bo'lmasa zaxira.",
    need: "optional",
    keyless: false,
    keyUrl: "https://voicelab.uz/",
  },
  elevenlabs: {
    billing: "paid",
    priceNote: `${usd(((tts("elevenlabs") as { usdPerMChars?: number } | undefined)?.usdPerMChars ?? 80) / 1000)} / 1000 belgi`,
    role: "«Premium ovoz» (podkast, tabriknoma) — foydalanuvchi alohida tanlaydi, standart zanjirga kirmaydi.",
    need: "optional",
    keyless: false,
    keyUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
  openalex: {
    billing: "free",
    priceNote: "Bepul",
    role: "Maqola va ilmiy ishlar uchun manbalarni topish va tekshirish (Crossref bilan birga).",
    need: "recommended",
    keyless: true,
    keyUrl: "https://openalex.org/",
  },
  googlebooks: {
    billing: "free",
    priceNote: "Bepul · kunlik kvota bor",
    role: "Maqola va kurs ishida kitob manbalarini topish.",
    need: "optional",
    keyless: true,
    keyUrl: "https://console.cloud.google.com/apis/library/books.googleapis.com",
  },
  "openai-image": {
    billing: "paid",
    priceNote: `Token bo'yicha: rasm chiqishi ${usd(OPENAI_IMAGE_USD_PER_MTOK.imageOut)} / 1M token (1 rasm taxminan $0.05)`,
    role: "«Rasm» vositasidagi ChatGPT tanlovi. Kalitsiz bu tanlov foydalanuvchiga ko'rsatilmaydi.",
    need: "optional",
    keyless: false,
    keyUrl: "https://platform.openai.com/api-keys",
  },
  fal: {
    billing: "paid",
    priceNote: "Oldindan to'lanadi (balans) · rasm $0.03–0.22 / dona, modelga qarab (Studio'dagi narx = tannarx × ustama)",
    role: "Studio «Rasm» bo'limidagi qo'shimcha modellar: FLUX 3, Seedream 5 Lite / Pro, Ideogram 4.5, Recraft 4.1 / Pro. Kalitsiz bu modellar foydalanuvchiga ko'rinmaydi.",
    need: "optional",
    keyless: false,
    keyUrl: "https://fal.ai/dashboard/keys",
  },
  veo: {
    billing: "paid",
    priceNote: "Taxminan $0.10 / soniya video (8 soniya ≈ $0.81) · Gemini kaliti bilan ishlaydi",
    role: "«Video yaratish» vositasi (Google Gemini Omni Flash). Sozlamalarda «Video yaratish yoqilgan» bo'lsa ishlaydi.",
    need: "optional",
    keyless: false,
    keyUrl: "https://aistudio.google.com/apikey",
  },
  kling: {
    billing: "paid",
    priceNote: "Har soniya video pullik (narx kalit kiritilgach hisobotda ko'rinadi)",
    role: "Video yaratishning ikkinchi varianti (Kling AI). Google video yetarli bo'lsa shart emas.",
    need: "optional",
    keyless: false,
    keyUrl: "https://kling.ai/dev/api-key",
  },
  heygen: {
    billing: "paid",
    priceNote: `Oldindan to'lanadi (API balansi, kamida $5) · Avatar IV ≈ ${usd(HEYGEN_USD_PER_SECOND.avatar_iv)} / soniya, Avatar III ≈ ${usd(HEYGEN_USD_PER_SECOND.avatar_iii)} / soniya (Studio'dagi narx = tannarx × ustama)`,
    role: "Studio «Video» bo'limidagi gapiruvchi avatar: avatar foydalanuvchi yozgan matnni (o'zbekcha ham) yoki uning «Ovoz» bo'limidagi tayyor ovozini gapiradi. Kalitsiz bu model foydalanuvchiga ko'rinmaydi.",
    need: "optional",
    keyless: false,
    keyUrl: "https://platform.heygen.com/api-keys",
  },
};

export type PurposeId = "text" | "image" | "stock" | "tts" | "stt" | "search" | "sources" | "video";

export type Purpose = {
  id: PurposeId;
  title: string;
  /** What the owner sees this purpose do in the product, in plain words. */
  summary: string;
  need: Need;
  /** One line: what is the minimum, and what is enough. */
  minimum: string;
  /** Providers that can serve it, in the order shown. Only these count for the verdict. */
  providers: readonly ProviderId[];
  /** Providers shown with it but never part of the standard chain (the premium voice): they do not count for the verdict. */
  premium: readonly ProviderId[];
  /**
   * The purpose needs ONE of these, whatever else is switched on: the image tools are Gemini-only, and the default text
   * chain does not contain Claude, so a working Claude alone cannot write a slide. `null` = any listed provider will do.
   */
  requires: readonly ProviderId[] | null;
  /** Routing slots editable inside this purpose. */
  routes: readonly RouteId[];
  /**
   * The listed providers back each other up automatically (text chain, stock photos, voice order): one working
   * provider is a single point of failure. `false` when they are alternatives the user or the owner picks (image
   * model, video provider, source types) — one working provider is then simply enough.
   */
  fallback: boolean;
  /** A runtime flag in «Sozlamalar» that also gates this purpose. */
  setting: { key: string; label: string } | null;
};

export const PURPOSES: readonly Purpose[] = [
  {
    id: "text",
    title: "Matn yozish va baholash",
    summary: "Slayd, kurs ishi, referat, insho, maqola, tarjima, rezyume, AI chat, domla savollari, test xatolari tahlili va hujjat tahriri — barcha matn shu yerdan keladi.",
    need: "required",
    minimum: "Kamida bitta matn provayderi ishlashi shart (asosiysi Gemini). Qwen va DeepSeek — Gemini to'xtaganda ishlaydigan arzon zaxira, Claude — baholovchi.",
    providers: ["gemini", "qwen", "deepseek", "anthropic"],
    premium: [],
    requires: ["gemini", "qwen", "deepseek"],
    routes: ["llm.chain", "llm.model", "llm.writer", "llm.researcher", "llm.judge", "llm.fast", "tests.analysis"],
    fallback: true,
    setting: null,
  },
  {
    id: "image",
    title: "AI rasm yaratish",
    summary: "«Rasm» vositasi, Studio, pro-slayddagi AI rasmlar va bitiruvchi portreti.",
    need: "required",
    minimum: "Gemini (Nano Banana) yetarli. ChatGPT va fal.ai (Studio'dagi FLUX, Seedream, Ideogram, Recraft) — foydalanuvchiga qo'shimcha tanlov, shart emas.",
    providers: ["gemini", "openai-image", "fal"],
    premium: [],
    requires: ["gemini"],
    routes: ["image.gemini"],
    fallback: false,
    setting: null,
  },
  {
    id: "stock",
    title: "Stok fotosuratlar",
    summary: "Oddiy slayddagi tayyor fotosuratlar (bepul manbalardan).",
    need: "recommended",
    minimum: "Bittasi yetarli (Pexels). Ikkinchisi zaxira; ikkalasi ham bo'lmasa slaydlar fotosuratsiz chiqadi.",
    providers: ["pexels", "pixabay"],
    premium: [],
    requires: null,
    routes: [],
    fallback: true,
    setting: null,
  },
  {
    id: "tts",
    title: "Ovoz (TTS)",
    summary: "Podkast, tabriknoma, tinglash o'yini va domlaning ovozli savollari.",
    need: "recommended",
    minimum: "Bitta ovoz provayderi yetarli. Hozir Gemini ovozi ishlaydi, lekin kvotasi cheklangan — Azure qo'shilsa barqarorroq bo'ladi.",
    providers: ["azure", "aisha", "gemini"],
    premium: ["elevenlabs"],
    requires: null,
    routes: ["tts.order"],
    fallback: true,
    setting: null,
  },
  {
    id: "stt",
    title: "Ovozni tinglash va baholash (domla)",
    summary: "Talaba ovozli xabar yuboradi — Gemini uni matnga aylantirib, javobni baholaydi.",
    need: "optional",
    minimum: "Faqat Gemini bilan ishlaydi (boshqa variant yo'q).",
    providers: ["gemini"],
    premium: [],
    requires: null,
    routes: [],
    fallback: false,
    setting: null,
  },
  {
    id: "search",
    title: "Internet qidiruvi (pro-slayd)",
    summary: "Pro-slayd mavzu bo'yicha internetdan yangi ma'lumot topadi (Google qidiruvi orqali).",
    need: "optional",
    minimum: "Faqat Gemini bilan ishlaydi (boshqa variant yo'q).",
    providers: ["gemini"],
    premium: [],
    requires: null,
    routes: [],
    fallback: false,
    setting: null,
  },
  {
    id: "sources",
    title: "Ilmiy manbalar",
    summary: "Maqola va kurs ishidagi adabiyotlarni topish va haqiqiyligini tekshirish. Model manbani o'ylab topmaydi.",
    need: "recommended",
    minimum: "OpenAlex yetarli (Crossref kalitsiz ishlaydi). Google Books — kitoblar uchun qo'shimcha.",
    providers: ["openalex", "googlebooks"],
    premium: [],
    requires: null,
    routes: [],
    fallback: false,
    setting: null,
  },
  {
    id: "video",
    title: "Video yaratish",
    summary: "Matndan qisqa video (har soniya pullik, shuning uchun ataylab yoqiladi).",
    need: "optional",
    minimum: "Google video (Gemini kaliti bilan) yetarli. Kling — ikkinchi variant. HeyGen — Studio'dagi gapiruvchi avatar (ixtiyoriy).",
    providers: ["veo", "kling", "heygen"],
    premium: [],
    requires: null,
    routes: [],
    fallback: false,
    setting: { key: "video.enabled", label: "Video yaratish yoqilgan" },
  },
];

export type Verdict = "ok" | "single" | "missing" | "off";

export type VerdictInfo = { verdict: Verdict; headline: string; detail: string };

/**
 * «Yetarlimi?» for one purpose, from which of its providers are usable right now (enabled and keyed).
 *   missing  a needed purpose with no working provider — the product cannot do it;
 *   single   one provider works and a second could exist — a stop of that one stops the purpose;
 *   ok       enough (a fallback exists, or no fallback can exist);
 *   off      an optional purpose nobody switched on.
 */
export function purposeVerdict(purpose: Purpose, usable: readonly ProviderId[], labelOf: (id: ProviderId) => string): VerdictInfo {
  const working = purpose.providers.filter((p) => usable.includes(p));
  if (purpose.requires && !purpose.requires.some((p) => usable.includes(p))) {
    const must = purpose.requires.map(labelOf).join(" yoki ");
    return {
      verdict: "missing",
      headline: "Yetarli emas",
      detail: `${must} ishlamayapti — bu vazifa ularsiz bajarilmaydi${working.length > 0 ? `, boshqa provayderlar (${working.map(labelOf).join(", ")}) uning o'rnini bosa olmaydi` : ""}. Kamida bittasini yoqing yoki kalitini kiriting: ${must}.`,
    };
  }
  if (working.length === 0) {
    if (purpose.need === "optional") {
      return { verdict: "off", headline: "Yoqilmagan", detail: "Ixtiyoriy vosita: provayder kaliti kiritilmaguncha foydalanuvchiga ko'rinmaydi." };
    }
    return {
      verdict: "missing",
      headline: "Yetarli emas",
      detail: `Hech bir provayder ishlamayapti — bu vazifa bajarilmaydi. Kamida bittasini yoqing: ${purpose.providers.map(labelOf).join(", ")}.`,
    };
  }
  const names = working.map(labelOf).join(" + ");
  if (purpose.providers.length === 1) return { verdict: "ok", headline: "Yetarli", detail: `${names} ishlayapti. Bu vazifaning boshqa varianti yo'q.` };
  if (purpose.fallback && working.length === 1 && purpose.need !== "optional") {
    return { verdict: "single", headline: "Yetarli, zaxirasiz", detail: `Faqat ${names} ishlayapti: u to'xtasa bu vazifa ham to'xtaydi. Zaxira provayder qo'shish tavsiya etiladi.` };
  }
  return { verdict: "ok", headline: "Yetarli", detail: working.length > 1 ? `${names} ishlayapti — zaxira bor.` : `${names} ishlayapti.` };
}

/** Plain-language name and help of each routing slot (the admin page; `routes.ts` holds the rules). */
export const ROUTE_INFO: Readonly<Record<RouteId, { title: string; help: string }>> = {
  "llm.chain": {
    title: "Matn zanjiri (asosiy va zaxira)",
    help: "Barcha matn shu tartibda yoziladi: birinchisi javob bermasa (hisob, balans yoki uzilish) keyingisi yozadi. Xitoy modelini birinchi qo'yish ham mumkin. Kaliti yo'q yoki o'chirilgan provayder o'tkazib yuboriladi. Quyidagi rollarda o'z tartibi saqlangan bo'lsa, u rol o'z tartibida ishlaydi.",
  },
  "llm.model": {
    title: "Gemini matn modeli",
    help: "Matn zanjiridagi Gemini shu model bilan ishlaydi (slayd, pro-slayd, kurs ishi, referat, tarjima, rezyume va boshqalar). «Matn zanjiri» saqlangan bo'lsa, undagi Gemini modeli ustun turadi va bu sozlama ishlamaydi.",
  },
  "llm.writer": {
    title: "Yozuvchi",
    help: "Matn yozadi: maqola, insho, podkast, o'yinlar, infografika, konspekt, o'qituvchi hujjatlari, domla savollari. Birinchisi javob bermasa keyingisi yozadi.",
  },
  "llm.researcher": {
    title: "Tadqiqotchi",
    help: "Maqola uchun manbalarni tanlaydi va topilgan ma'lumotni jamlaydi.",
  },
  "llm.judge": {
    title: "Baholovchi",
    help: "Tayyor ishni tekshirib «tayyorlik hisoboti» (ball) chiqaradi: maqola, insho, kurs ishi, o'yinlar, o'qituvchi hujjatlari.",
  },
  "llm.fast": {
    title: "Tez yordamchi",
    help: "Kichik tezkor vazifalar: AI chat, lex.uz va manba so'rovlarini tayyorlash.",
  },
  "tests.analysis": {
    title: "Test tahlili modeli",
    help: "«Test ishlash» natijasida har xato javobni tushuntiradi: savol rasmini o'qib, to'g'ri javob nega to'g'riligini va tanlangan javob nega xatoligini yozadi. Har savol bir marta tahlil qilinadi va hamma uchun saqlanadi. Rasmni o'qiy oladigan kuchli model kerak (standart: Gemini 3.1 Pro).",
  },
  "image.gemini": {
    title: "Gemini rasm modeli",
    help: "Barcha AI rasmlar shu modelda chiziladi: arzon (lite) yoki sifatliroq va qimmatroq (flash).",
  },
  "tts.order": {
    title: "Ovoz provayderlari tartibi",
    help: "Yuqoridagi provayder birinchi o'qiydi, ishlamasa keyingisi. Provayderni butunlay to'xtatish uchun uni «Provayderlar» ro'yxatida o'chiring. Serverdagi TTS_VOICE_<til> bo'lsa, o'sha til uchun u ustun turadi.",
  },
};
