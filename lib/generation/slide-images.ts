import { mapPool } from "./quality";
import { photoSlot, slotPixels } from "./slide-layout";
import { composeSlideImagePrompt, writeSlideImagePrompts } from "./slide-image-prompts";
import type { SlideVisual } from "./slide-templates";
import type { SlideModel } from "./slide-types";
import type { SlideImageReport } from "./types";

export type SlideImage = { url: string; alt?: string };

export type ImageBytes = { data: string; type: "jpg" | "png"; w?: number; h?: number };

export type FalSize = { width: number; height: number };

const IMAGE_LAYOUTS = new Set(["title", "section", "bullets", "agenda", "quote", "closing"]);
const FAL_DEFAULT_MODEL = "fal-ai/flux/schnell";

/**
 * Rasm byudjeti paketga bog'liq.
 *
 * Premium paketlarda ko'proq rasm va ko'proq inference qadami beriladi —
 * «Premium» so'zi shu yerda haqiqiy farqqa aylanadi. Ilgari to'rttala
 * paket ham 4 qadamli `schnell` va 8 ta rasm olardi.
 */
const IMAGE_LIMIT = { standard: 8, premium: 10 } as const;
const STEPS = { standard: 4, premium: 8 } as const;

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
export function imageBudget(slideCount: number, premium: boolean): number {
  const base = premium ? IMAGE_LIMIT.premium : IMAGE_LIMIT.standard;
  return Math.max(base, Math.ceil(Math.max(0, slideCount) * 0.8));
}

export type VisualTier = { premium?: boolean; seed?: number };

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

function falSteps(premium: boolean) {
  const raw = Number(premium ? process.env.FAL_STEPS_PREMIUM : process.env.FAL_STEPS);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 50) return Math.round(raw);
  return premium ? STEPS.premium : STEPS.standard;
}

/** `.env` dagi FAL_MODEL ni hurmat qiladi — ilgari URL qattiq yozilgan edi. */
function falUrl(premium = false) {
  const picked = premium ? process.env.FAL_MODEL_PREMIUM || process.env.FAL_MODEL : process.env.FAL_MODEL;
  const model = (picked || FAL_DEFAULT_MODEL).trim().replace(/^\/+|\/+$/g, "");
  return `https://fal.run/${model || FAL_DEFAULT_MODEL}`;
}

function falKey() {
  return process.env.FAL_KEY?.trim() || "";
}

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

export type FalResult =
  | { ok: true; image: SlideImage }
  | { ok: false; reason: FalFailure; detail: string };

/**
 * HTTP javob kodini sababga o'giradi.
 *
 * 402/403 — hisob (to'lov, blok), 401 — kalit. Ikkalasi ham
 * «qayta urinma, hisobni ko'r» degani, shuning uchun bitta guruh.
 */
function falReason(status: number): FalFailure {
  if (status === 401 || status === 402 || status === 403) return "blocked";
  if (status === 429) return "rate";
  return "failed";
}

/** Baytlar bilan emas, sabab bilan qaytadi — chaqiruvchi jurnalni ajratsin. */
export async function requestFalImage(
  prompt: string,
  size: FalSize,
  deadline?: number,
  tier: VisualTier = {},
): Promise<FalResult> {
  const key = falKey();
  if (!key) {
    console.warn("[fal] FAL_KEY missing");
    return { ok: false, reason: "no-key", detail: "FAL_KEY yo'q" };
  }
  // Umumiy byudjetdan oshib ketmaslik uchun timeout ni qisqartiramiz.
  const budget = deadline ? Math.min(45_000, Math.max(0, deadline - Date.now())) : 45_000;
  // Ilgari bu jimgina `null` edi — vaqt tugagani xato bilan aralashardi.
  if (budget < 2_000) return { ok: false, reason: "timeout", detail: "byudjet 2 s dan kam" };
  try {
    const res = await fetch(falUrl(tier.premium), {
      method: "POST",
      signal: AbortSignal.timeout(budget),
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_size: { width: size.width, height: size.height },
        num_inference_steps: falSteps(Boolean(tier.premium)),
        num_images: 1,
        ...(tier.seed == null ? {} : { seed: tier.seed }),
        enable_safety_checker: true,
        output_format: "jpeg",
      }),
    });
    const data = (await res.json()) as {
      detail?: unknown;
      images?: { url?: string; content_type?: string; width?: number; height?: number }[];
      error?: string;
    };
    if (!res.ok) {
      const detail = typeof data.detail === "string" ? data.detail : data.error || "request failed";
      const reason = falReason(res.status);
      // Hisob bloklangani — jurnalda XATO darajasida: bu operator
      // aralashuvini talab qiladi, o'z-o'zidan tuzalmaydi.
      const line = `${res.status} ${detail}`;
      if (reason === "blocked") console.error("[fal] provayder rad etdi (hisob/kalit):", line);
      else console.warn("[fal]", line);
      return { ok: false, reason, detail: line };
    }
    const url = data.images?.[0]?.url;
    if (!url) return { ok: false, reason: "failed", detail: "javobda rasm yo'q" };
    return { ok: true, image: { url, alt: prompt.slice(0, 80) } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network";
    console.warn("[fal]", msg);
    // `AbortSignal.timeout` → `TimeoutError`: byudjet tugagani, xato emas.
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, reason: timedOut ? "timeout" : "failed", detail: msg };
  }
}

/**
 * Eski, sodda imzo — rasm yoki `null`.
 *
 * `image-studio.ts` (rasm vositasi) va `scripts/image-lab.mts` shuni
 * ishlatadi: ularda yiqilish sababi alohida hisoblanmaydi, chunki u
 * yerda yetkazish soni fayllar bo'yicha o'lchanadi (`packImages`).
 */
export async function generateFalImage(
  prompt: string,
  size: FalSize,
  deadline?: number,
  tier: VisualTier = {},
): Promise<SlideImage | null> {
  const res = await requestFalImage(prompt, size, deadline, tier);
  return res.ok ? res.image : null;
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
 * hisoblanardi. Endi u ikki joyda kerak: rasm so'rashda va yetkazishni
 * o'lchashda (`delivered.ts`). Ikkinchi joyda qayta yozilsa, ikki nusxa
 * jimgina ajralib ketardi — shuning uchun bitta eksport funksiya.
 *
 * `!s.image` filtri ATAYIN yo'q: allaqachon rasmi bor slayd ham
 * REJADAGI slot, u yetkazilgan deb sanaladi. Filtr chaqiruv joyida.
 */
export function plannedImageSlots(
  slides: SlideModel[],
  visual: SlideVisual = "classic",
  premium = false,
): { s: SlideModel; size: FalSize }[] {
  return slides
    .filter((s) => IMAGE_LAYOUTS.has(s.layout))
    .slice(0, imageBudget(slides.length, premium))
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
 */
export async function attachSlideImages(
  slides: SlideModel[],
  topic: string,
  visual: SlideVisual = "classic",
  budgetMs = 60_000,
  tier: VisualTier = {},
): Promise<SlideImageReport> {
  const planned = plannedImageSlots(slides, visual, Boolean(tier.premium));
  const report: SlideImageReport = {
    want: planned.length,
    got: 0,
    blocked: 0,
    skipped: 0,
    failed: 0,
  };
  if (!falKey()) {
    // Kalitsiz muhitda (dev/test) rasm umuman va'da qilinmaydi — aks
    // holda har lokal deka «kam yetkazildi» bo'lib chiqardi.
    console.warn("[fal] skip images: no key");
    return { ...report, want: 0 };
  }
  if (!report.want) return report;

  const deadline = Date.now() + budgetMs;
  const seed = tier.seed ?? seedFrom(topic);
  const jobs = planned.filter(({ s }) => !s.image);
  report.got = report.want - jobs.length;

  const prompts = await writeSlideImagePrompts(
    topic,
    jobs.map((j) => j.s),
    visual,
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
  await mapPool(jobs, 3, async ({ s, size }) => {
    if (blockReason) {
      report.blocked += 1;
      return null;
    }
    if (Date.now() >= deadline) {
      report.skipped += 1;
      return null;
    }
    const prompt = prompts[s.id] || composeSlideImagePrompt(topic, s, size);
    const res = await requestFalImage(prompt, size, deadline, { ...tier, seed });
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
  if (report.blocked) {
    console.error(
      `[fal] HISOB/KALIT BLOKLANGAN — ${report.got}/${report.want} rasm chizildi, ${report.blocked} so‘rov rad etildi. Sabab: ${blockReason || "noma’lum"}. Kredit qisman qaytariladi.`,
    );
  }
  if (report.skipped) {
    console.warn(`[fal] vaqt tugadi — ${report.skipped} slayd rasmsiz qoldi (${report.got}/${report.want})`);
  }
  if (report.failed) {
    console.warn(`[fal] ${report.failed} so‘rov boshqa sabab bilan yiqildi (${report.got}/${report.want})`);
  }
  return report;
}
