import { photoSlot, slotPixels } from "./slide-layout";
import { composeSlideImagePrompt, writeSlideImagePrompts } from "./slide-image-prompts";
import type { SlideVisual } from "./slide-templates";
import type { SlideModel } from "./slide-types";

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

function visualPrompt(topic: string, title: string, layout: string, size: FalSize) {
  return composeSlideImagePrompt(topic, { title, layout: layout as import("./slide-types").SlideLayout }, size);
}

export async function generateFalImage(
  prompt: string,
  size: FalSize,
  deadline?: number,
  tier: VisualTier = {},
): Promise<SlideImage | null> {
  const key = falKey();
  if (!key) {
    console.warn("[fal] FAL_KEY missing");
    return null;
  }
  // Umumiy byudjetdan oshib ketmaslik uchun timeout ni qisqartiramiz.
  const budget = deadline ? Math.min(45_000, Math.max(0, deadline - Date.now())) : 45_000;
  if (budget < 2_000) return null;
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
      console.warn("[fal]", res.status, typeof data.detail === "string" ? data.detail : data.error || "request failed");
      return null;
    }
    const url = data.images?.[0]?.url;
    if (!url) return null;
    return { url, alt: prompt.slice(0, 80) };
  } catch (e) {
    console.warn("[fal]", e instanceof Error ? e.message : "network");
    return null;
  }
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

export async function searchSlideImages(query: string, limit = 6): Promise<SlideImage[]> {
  const q = query.replace(/\s+/g, " ").trim();
  if (!q) return [];
  const n = Math.max(1, Math.min(limit, IMAGE_LIMIT.premium));
  const out: SlideImage[] = [];
  const size = { width: 1024, height: 576 };
  for (let i = 0; i < n; i++) {
    const im = await generateFalImage(
      visualPrompt(q, i === 0 ? "cover" : `scene ${i + 1}`, i === 0 ? "title" : "section", size),
      size,
    );
    if (im) {
      const kept = await persistImage(im);
      if (kept) out.push(kept);
    }
  }
  return out;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const ret: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      ret[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return ret;
}

/**
 * Slaydlarga rasm biriktiradi.
 *
 * `budgetMs` — butun rasm bosqichiga ajratilgan vaqt. Rasmlar ketma-ket
 * navbat bilan olinadi, shuning uchun cheklovsiz qoldirilsa 8 ta rasm
 * so'rov `maxDuration` dan oshib ketishi va butun taqdimot yo'qolishi mumkin
 * edi. Vaqt tugasa qolgan slaydlar shunchaki rasmsiz qoladi — deck baribir
 * tayyor bo'ladi.
 */
export async function attachSlideImages(
  slides: SlideModel[],
  topic: string,
  visual: SlideVisual = "classic",
  budgetMs = 60_000,
  tier: VisualTier = {},
) {
  if (!falKey()) {
    console.warn("[fal] skip images: no key");
    return slides;
  }
  const deadline = Date.now() + budgetMs;
  const seed = tier.seed ?? seedFrom(topic);
  const jobs = slides
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => IMAGE_LAYOUTS.has(s.layout) && !s.image)
    .slice(0, tier.premium ? IMAGE_LIMIT.premium : IMAGE_LIMIT.standard);
  if (!jobs.length) return slides;

  const prompts = await writeSlideImagePrompts(
    topic,
    jobs.map((j) => j.s),
    visual,
  );

  let skipped = 0;
  await mapPool(jobs, 3, async ({ s }) => {
    if (Date.now() >= deadline) {
      skipped += 1;
      return null;
    }
    const slot = photoSlot(s.layout, visual);
    if (!slot) return null;
    const size = slotPixels(slot);
    const prompt = prompts[s.id] || composeSlideImagePrompt(topic, s, size);
    const im = await generateFalImage(prompt, size, deadline, { ...tier, seed });
    if (im) {
      const kept = await persistImage(im);
      if (kept) s.image = kept;
    }
    return im;
  });
  if (skipped) console.warn("[fal] image budget exhausted, skipped", skipped);
  return slides;
}
