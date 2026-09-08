import { mapPool } from "./quality";
import { pickProvider } from "./image-provider";
import { photoSlot, slotPixels } from "./slide-layout";
import { composeSlideImagePrompt, writeSlideImagePrompts } from "./slide-image-prompts";
import type { SlideVisual } from "./slide-templates";
import type { SlideModel } from "./slide-types";
import type { DocMeta, SlideImageReport } from "./types";
import type { FalSize, SlideImage, VisualTier } from "./image-provider-fal";

/*
 * fal.ai ning HTTP mantig'i endi `image-provider-fal.ts` da (WP-E) —
 * bu yerdan QAYTA EKSPORT qilinadi, chunki `image-studio.ts` va
 * `scripts/image-lab.mts` uni shu yo'ldan import qiladi: provayder
 * ajratilishi ularga umuman ko'rinmasligi kerak edi.
 */
export { generateFalImage, requestFalImage } from "./image-provider-fal";
export type { FalResult, FalSize, SlideImage, VisualTier } from "./image-provider-fal";
export type { FalFailure } from "./image-provider";

export type ImageBytes = { data: string; type: "jpg" | "png"; w?: number; h?: number };

const IMAGE_LAYOUTS = new Set(["title", "section", "bullets", "agenda", "quote", "closing"]);

/**
 * Rasm byudjeti paketga bog'liq.
 *
 * Premium paketlarda ko'proq rasm va ko'proq inference qadami beriladi —
 * «Premium» so'zi shu yerda haqiqiy farqqa aylanadi. Ilgari to'rttala
 * paket ham 4 qadamli `schnell` va 8 ta rasm olardi.
 */
const IMAGE_LIMIT = { standard: 8, premium: 10 } as const;

/**
 * Rasm cheklovi deka uzunligiga bog'lanadi.
 *
 * Ilgari u qat'iy son edi: `premium` uchun 10. 16 slaydli premium dekada
 * rasm ko'tara oladigan slaydlar soni ham AYNAN 10 chiqadi — ya'ni
 * cheklov chegaraga tegib turardi va shablon mixi biroz o'zgarishi bilan
 * rasm jim yo'qola boshlardi. Endi chegara 10 slaydlik dekadagi zichlikni
 * (0.8) saqlaydi va hech qachon o'zi bog'lovchi bo'lmaydi.
 *
 * Bu rasm SONINI va'da qilish emas: forma «sifatli rasm» deb yozadi va
 * uni model hamda qadamlar soni beradi. Bu shunchaki sun'iy shiftni
 * olib tashlaydi — nechta rasm chiqishini layout mixi hal qiladi.
 */
/** Rasm so'rovlarining parallel yo'laklari — test ham shundan o'qiydi. */
export const PRO_IMAGE_LANES = 5;
export const IMAGE_LANES = 3;

export function imageBudget(slideCount: number, premium: boolean): number {
  const base = premium ? IMAGE_LIMIT.premium : IMAGE_LIMIT.standard;
  return Math.max(base, Math.ceil(Math.max(0, slideCount) * 0.8));
}

/**
 * Mavzudan barqaror seed.
 *
 * Bitta deck ichidagi barcha rasmlar bir xil seed bilan chiziladi —
 * shunda 8–10 rasm bitta «kamera»dan olingandek bir uslubda chiqadi.
 * Ilgari seed berilmasdi va har slayd o'z uslubida bo'lardi: bir joyda
 * akvarel, boshqasida foto, uchinchisida 3D — deck yamoqqa o'xshardi.
 */
export function seedFrom(topic: string): number {
  let h = 2166136261;
  for (const ch of topic) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 1_000_000;
}

function jpegSize(buf: Buffer): { w: number; h: number } | undefined {
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) return undefined;
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3 && i + 8 < buf.length) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return undefined;
}

function pngSize(buf: Buffer): { w: number; h: number } | undefined {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return undefined;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/**
 * Rasm turini BAYTLARDAN aniqlaydi, sarlavhadan emas.
 *
 * Ilgari tur `content-type` yoki URL kengaytmasidan olinardi va baytlar
 * tekshirilmasdi. `pptxgenjs` ichidagi `image-size` esa formatni magic
 * baytlar bo'yicha aniqlaydi — ya'ni ICNS/HEIF/JXL fayl «jpg» yorlig'i
 * bilan o'tib, o'sha kutubxonaning DoS zaifligi bor parserlariga
 * tushishi mumkin edi. Endi faqat haqiqiy PNG va JPEG qabul qilinadi.
 */
function sniffImageType(buf: Buffer): "png" | "jpg" | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  return null;
}

function decodeDataUrl(url: string): ImageBytes | null {
  const m = url.match(/^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  const type = sniffImageType(buf);
  if (!type) return null;
  const mime = type === "png" ? "image/png" : "image/jpeg";
  const dim = type === "png" ? pngSize(buf) : jpegSize(buf);
  return { data: `${mime};base64,${m[2]}`, type, ...dim };
}

/** Bitta rasm uchun chegara — xotirani himoyalaydi. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export { sniffImageType };

export async function fetchImageBytes(url: string): Promise<ImageBytes | null> {
  if (url.startsWith("data:")) return decodeDataUrl(url);
  // Faqat HTTPS: provayder javobidagi URL o'zgarib ketsa ham ichki
  // tarmoqqa so'rov ketmasin (SSRF).
  if (!/^https:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
    if (!res.ok) return null;
    // Provayder rasm o'rniga katta narsa qaytarsa, oldindan to'xtatamiz.
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    if (buf.length < 800) return null;
    const type = sniffImageType(buf);
    if (!type) {
      console.warn("[fal] rasm formati qo‘llab-quvvatlanmaydi, tashlandi");
      return null;
    }
    const dim = type === "png" ? pngSize(buf) : jpegSize(buf);
    return {
      data: `image/${type === "png" ? "png" : "jpeg"};base64,${buf.toString("base64")}`,
      type,
      ...dim,
    };
  } catch {
    return null;
  }
}

/**
 * Rasmni o'zimizda saqlaymiz.
 *
 * `null` qaytishi muhim: ilgari yuklab olish yiqilsa provayderning
 * MUDDATLI URL i qaytarilardi va bazaga yozilardi. Fayl bir necha soatdan
 * keyin 404 bo'lardi — foydalanuvchi ochgan taqdimotda rasm o'rnida
 * bo'shliq qolardi. Endi bunday rasm umuman biriktirilmaydi.
 */
async function persistImage(remote: SlideImage): Promise<SlideImage | null> {
  const bytes = await fetchImageBytes(remote.url);
  if (!bytes) {
    console.warn("[fal] rasm saqlanmadi, tashlandi");
    return null;
  }
  return { url: `data:${bytes.data}`, alt: remote.alt };
}

/**
 * Dekada nechta rasm SLOTI rejalashtirilgan — va'daning yagona manbasi.
 *
 * Ilgari bu ro'yxat faqat `attachSlideImages` ichida, yo'l-yo'lakay
 * hisoblanardi va hech qayerga chiqmasdi. Endi undan chiqqan SON
 * yetkazishni o'lchashda ham kerak (`delivered.ts`) — u yerda reja
 * qayta hisoblanmaydi, shu funksiya bergan `want` hisobot orqali
 * uzatiladi. Aks holda `photoSlot`/`imageBudget` o'zgarganda ikkita
 * nusxa jimgina ajralib ketardi.
 *
 * `!s.image` filtri ATAYIN yo'q: allaqachon rasmi bor slayd ham
 * REJADAGI slot, u yetkazilgan deb sanaladi. Filtr chaqiruv joyida.
 *
 * `pro` — `pro-slide` vositasi (WP-E). Unda `imageBudget` SHIFTI
 * umuman qo'llanmaydi: foydalanuvchi har slaydga alohida to'laydi
 * (`PRO_SLIDE_PER_SLIDE`), ya'ni 30 slaydli dekada 24 ta rasm bilan
 * cheklash to'langan va'daning bir qismini jimgina yeb qo'yardi.
 * Nechta rasm bo'lishini faqat MAKET hal qiladi — `photoSlot` slot
 * bergan har slayd rasm oladi.
 */
export function plannedImageSlots(
  slides: SlideModel[],
  visual: SlideVisual = "classic",
  premium = false,
  pro = false,
): { s: SlideModel; size: FalSize }[] {
  const eligible = slides.filter((s) => IMAGE_LAYOUTS.has(s.layout));
  return (pro ? eligible : eligible.slice(0, imageBudget(slides.length, premium)))
    .map((s) => {
      const slot = photoSlot(s.layout, visual);
      return slot ? { s, size: slotPixels(slot) } : null;
    })
    .filter((x): x is { s: SlideModel; size: FalSize } => x !== null);
}

/**
 * Slaydlarga rasm biriktiradi.
 *
 * `budgetMs` — butun rasm bosqichiga ajratilgan vaqt. Rasmlar ketma-ket
 * navbat bilan olinadi, shuning uchun cheklovsiz qoldirilsa 8 ta rasm
 * so'rov `maxDuration` dan oshib ketishi va butun taqdimot yo'qolishi mumkin
 * edi. Vaqt tugasa qolgan slaydlar shunchaki rasmsiz qoladi — deck baribir
 * tayyor bo'ladi.
 *
 * Qaytaradi: bosqich HISOBOTI (`SlideImageReport`). Ilgari `slides`
 * qaytarardi va chaqiruvchi natijani e'tiborsiz qoldirardi — rasm nol
 * kelgani hech qayerga yozilmasdi, ya'ni na worker, na natija sahifasi
 * bundan xabar topardi. Hisobot `doc.slideImages` ga tushadi va u yerdan
 * `deliveredCount` pul qaroriga aylantiradi.
 *
 * `opts.meta` (WP-E) — provayder tanlash, rasm uslubi va mahalliy
 * misollar uchun. Berilmasa hamma narsa ESKICHA qoladi: fal.ai,
 * `photo` uslubi, `imageBudget` shifti — ya'ni eski chaqiruvlar
 * (`scripts/image-lab.mts`, mavjud testlar) regressiyasiz ishlaydi.
 */
export type AttachImageOpts = VisualTier & { meta?: DocMeta };

export async function attachSlideImages(
  slides: SlideModel[],
  topic: string,
  visual: SlideVisual = "classic",
  budgetMs = 60_000,
  opts: AttachImageOpts = {},
): Promise<SlideImageReport> {
  const pro = opts.meta?.toolId === "pro-slide";
  const provider = pickProvider(opts.meta);
  const planned = plannedImageSlots(slides, visual, Boolean(opts.premium), pro);
  const report: SlideImageReport = {
    want: planned.length,
    got: 0,
    blocked: 0,
    skipped: 0,
    failed: 0,
  };
  if (!provider.hasKey()) {
    // Kalitsiz muhitda (dev/test) rasm umuman va'da qilinmaydi — aks
    // holda har lokal deka «kam yetkazildi» bo'lib chiqardi.
    console.warn(`[${provider.id}] skip images: no key`);
    return { ...report, want: 0 };
  }
  if (!report.want) return report;

  const deadline = Date.now() + budgetMs;
  const seed = opts.seed ?? seedFrom(topic);
  const jobs = planned.filter(({ s }) => !s.image);
  report.got = report.want - jobs.length;

  const prompts = await writeSlideImagePrompts(
    topic,
    jobs.map((j) => j.s),
    visual,
    opts.meta,
  );

  /*
   * Hisob bloklangach qolgan so'rovlar yuborilmaydi.
   *
   * Jonli sinovda 19 ta so'rovning 19 tasi ham bir xil 403 bilan
   * qaytdi — ya'ni 18 tasi oldindan ma'lum javob uchun vaqt sarfladi.
   * Blok kalit/hisob darajasida bo'lgani uchun keyingi so'rov ham
   * albatta shu javobni oladi.
   */
  let blockReason = "";
  /*
   * Yo'laklik: pro dekada 30 tagacha rasm so'raladi, ya'ni 3 yo'lak
   * bilan navbat rasm byudjetidan uzunroq cho'zilib, oxirgi slaydlar
   * doim `skipped` bo'lib qolardi.
   *
   * 5 — o'lchovdan chiqarilgan: bitta Gemini rasm so'rovi ~40 s
   * (sarlavha 13 s + 2.3 MB tana ~20 s). 30 slaydli dekada ~21 rasm
   * bo'ladi; 4 yo'lak bilan 6 to'lqin × 40 s = 240 s kerak, ammo rasm
   * bosqichiga 201 s ajratiladi — ya'ni oxirgi to'lqin doim yo'qolardi.
   * 5 yo'lakda 5 to'lqin ≈ 200 s byudjetga sig'adi.
   */
  await mapPool(jobs, pro ? PRO_IMAGE_LANES : IMAGE_LANES, async ({ s, size }) => {
    if (blockReason) {
      report.blocked += 1;
      return null;
    }
    /*
     * Qolgan vaqt bitta rasmga yetmasa — so'rov YUBORILMAYDI. Ilgari
     * shart `Date.now() >= deadline` edi: 5 s qolganda ham so'rov
     * ketardi, javob uzilardi va bu pul sarflab, hisobotda ham
     * chalkash iz qoldirardi.
     */
    if (deadline - Date.now() < provider.minMs) {
      report.skipped += 1;
      return null;
    }
    const prompt = prompts[s.id] || composeSlideImagePrompt(topic, s, size, opts.meta);
    const res = await provider.fetchImage(
      { prompt, size, styleId: opts.meta?.slideImageStyle ?? "photo", seed, premium: opts.premium },
      deadline,
    );
    if (!res.ok) {
      if (res.reason === "blocked" || res.reason === "no-key") {
        report.blocked += 1;
        if (!blockReason) blockReason = res.detail;
      } else if (res.reason === "timeout") report.skipped += 1;
      else report.failed += 1;
      return null;
    }
    const kept = await persistImage(res.image);
    if (kept) {
      s.image = kept;
      report.got += 1;
    } else {
      report.failed += 1;
    }
    return kept;
  });
  if (blockReason) report.blockReason = blockReason;

  /*
   * Uch xil yiqilish — uch xil satr.
   *
   * Ilgari ikkalasi ham bir xil jimlik bilan o'tardi: bloklangan hisob
   * ham, tugagan byudjet ham faqat `console.warn` qoldirardi va
   * `[fal] image budget exhausted` satri hisob blokida ham chiqardi.
   * Endi blok XATO darajasida va sababi bilan yoziladi.
   */
  const tag = `[${provider.id}]`;
  if (report.blocked) {
    console.error(
      `${tag} HISOB/KALIT BLOKLANGAN — ${report.got}/${report.want} rasm chizildi, ${report.blocked} so‘rov rad etildi. Sabab: ${blockReason || "noma’lum"}. Kredit qisman qaytariladi.`,
    );
  }
  if (report.skipped) {
    console.warn(`${tag} vaqt tugadi — ${report.skipped} slayd rasmsiz qoldi (${report.got}/${report.want})`);
  }
  if (report.failed) {
    console.warn(`${tag} ${report.failed} so‘rov boshqa sabab bilan yiqildi (${report.got}/${report.want})`);
  }
  return report;
}
