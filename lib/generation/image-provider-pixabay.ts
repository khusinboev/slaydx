/**
 * Pixabay bepul stock-foto provayderi (AUDIT-9 P3).
 *
 * Zanjirning IKKINCHI bo'g'ini — Pexels kalitsiz/yiqilgan/natijasiz
 * bo'lsa shu ishga tushadi (`image-provider-pexels.ts` bilan bir xil
 * shartnoma, faqat javob shakli boshqa).
 *
 * API: `GET https://pixabay.com/api/?key=…&q=…&image_type=photo&orientation=…&per_page=5&safesearch=true`,
 * kalit QUERY parametrida (sarlavhada emas — Pixabay shunday talab
 * qiladi). Javob: `hits[].largeImageURL`.
 */
import { photoOrientation, requestBudget, type FalFailure, type ImageAsk, type ImageProvider, type ImageResult } from "./image-provider";

const PIXABAY_URL = "https://pixabay.com/api/";

export function pixabayKey() {
  return process.env.PIXABAY_API_KEY?.trim() || "";
}

/**
 * HTTP kodini shartnomadagi beshta sababga o'giradi.
 *
 * Pixabay yaroqsiz kalit uchun HAM 400 qaytarishi mumkin (`error`
 * matnida "Invalid API key"), lekin biz 401/403 ni "blocked" deb
 * tasniflaymiz — 400 esa `failed` (keyingi so'rovda ham qayta urinib
 * ko'rish xavfsiz, chunki bu SO'ROV shaklidagi xato bo'lishi ham
 * mumkin, hisob bloki emas).
 */
function pixabayReason(status: number): FalFailure {
  if (status === 401 || status === 403) return "blocked";
  if (status === 429) return "rate";
  return "failed";
}

/** Pexels uch qiymat (`landscape`/`portrait`/`square`) qabul qiladi, Pixabay ikkitasini. */
function pixabayOrientation(size: { width: number; height: number }): "horizontal" | "vertical" {
  return photoOrientation(size) === "portrait" ? "vertical" : "horizontal";
}

type PixabayHit = { largeImageURL?: string; tags?: string };

export async function requestPixabayImage(ask: ImageAsk, deadline?: number): Promise<ImageResult> {
  const key = pixabayKey();
  if (!key) return { ok: false, reason: "no-key", detail: "PIXABAY_API_KEY yo'q" };

  const query = (ask.searchQuery || "").trim();
  if (!query) {
    return { ok: false, reason: "failed", detail: "qidiruv so'rovi yo'q (uslub fotodan boshqa yoki berilmagan)" };
  }

  const budget = requestBudget(deadline);
  if (budget === null) return { ok: false, reason: "timeout", detail: "byudjet 2 s dan kam" };

  try {
    const url =
      `${PIXABAY_URL}?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}` +
      `&image_type=photo&orientation=${pixabayOrientation(ask.size)}&per_page=5&safesearch=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(budget) });
    if (!res.ok) {
      const reason = pixabayReason(res.status);
      const line = `${res.status} ${res.statusText || "request failed"}`;
      if (reason === "blocked") console.error("[pixabay] provayder rad etdi (hisob/kalit):", line);
      else console.warn("[pixabay]", line);
      return { ok: false, reason, detail: line };
    }
    const data = (await res.json()) as { hits?: PixabayHit[] };
    const hits = Array.isArray(data.hits) ? data.hits : [];
    const usable = hits.map((h) => h.largeImageURL).filter((u): u is string => Boolean(u));
    if (!usable.length) return { ok: false, reason: "failed", detail: "natija yo'q" };
    const picked = usable.find((u) => !ask.seen?.has(u)) ?? usable[0];
    const alt = hits.find((h) => h.largeImageURL === picked)?.tags || query;
    return { ok: true, image: { url: picked, alt } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network";
    console.warn("[pixabay]", msg);
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, reason: timedOut ? "timeout" : "failed", detail: msg };
  }
}

export const pixabayProvider: ImageProvider = {
  id: "pixabay",
  minMs: 6_000,
  hasKey: () => Boolean(pixabayKey()),
  fetchImage: requestPixabayImage,
};
