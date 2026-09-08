/**
 * fal.ai provayderi (AUDIT-9 WP-E).
 *
 * Bu fayl YANGI mantiq emas: `slide-images.ts` dagi `requestFalImage`
 * AYNAN shu holicha ko'chirildi va `ImageProvider` shartnomasiga
 * o'raldi. Xatti-harakat o'zgarmasligi shart, chunki oddiy `slide`
 * vositasining butun rasm yo'li shu yerdan o'tadi va `blocked` qisqa
 * tutashuvi (`403` dan keyin qolgan so'rovlar yuborilmaydi) jonli
 * sinovda 19 → 3 chaqiruv tejagan mexanizmdir.
 *
 * `slide-images.ts` `requestFalImage`/`generateFalImage` ni shu yerdan
 * QAYTA EKSPORT qiladi — `image-studio.ts` va `scripts/image-lab.mts`
 * uchun import yo'li o'zgarmadi.
 */
import { requestBudget, type FalFailure, type ImageAsk, type ImageProvider, type ImageResult } from "./image-provider";

export type FalSize = { width: number; height: number };
export type SlideImage = { url: string; alt?: string };
export type VisualTier = { premium?: boolean; seed?: number };
export type FalResult = ImageResult;

const FAL_DEFAULT_MODEL = "fal-ai/flux/schnell";

/**
 * Rasm byudjeti paketga bog'liq.
 *
 * Premium paketlarda ko'proq inference qadami beriladi — «Premium»
 * so'zi shu yerda haqiqiy farqqa aylanadi. Ilgari to'rttala paket ham
 * 4 qadamli `schnell` olardi.
 */
const STEPS = { standard: 4, premium: 8 } as const;

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

export function falKey() {
  return process.env.FAL_KEY?.trim() || "";
}

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
  const budget = requestBudget(deadline);
  // Ilgari bu jimgina `null` edi — vaqt tugagani xato bilan aralashardi.
  if (budget === null) return { ok: false, reason: "timeout", detail: "byudjet 2 s dan kam" };
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

export const falProvider: ImageProvider = {
  id: "fal",
  hasKey: () => Boolean(falKey()),
  fetchImage(ask: ImageAsk, deadline?: number) {
    return requestFalImage(ask.prompt, ask.size, deadline, {
      premium: ask.premium,
      seed: ask.seed,
    });
  },
};
