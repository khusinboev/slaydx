/**
 * Pexels bepul stock-foto provayderi (AUDIT-9 P3).
 *
 * Zanjirning BIRINCHI bo'g'ini (`chainProvider([pexelsProvider,
 * pixabayProvider, falProvider])`, `image-provider.ts` `pickProvider`).
 * Faqat oddiy `slide` vositasi uchun ishlaydi va faqat uslub `photo`
 * bo'lganda (`ask.searchQuery` bo'lmasa — pastga qarang — darhol
 * o'tkazib yuboriladi, tarmoqqa chiqilmaydi).
 *
 * API: `GET https://api.pexels.com/v1/search?query=…&orientation=…&per_page=5`,
 * sarlavha `Authorization: <PEXELS_API_KEY>` (Bearer SO'Zi YO'Q — Pexels
 * kalitni to'g'ridan-to'g'ri kutadi). Javob: `photos[].src.large2x`
 * (yo'q bo'lsa `large`) — bu HALI HAM masofaviy URL, `persistImage`
 * (`slide-images.ts`) uni yuklab `data:` ga aylantiradi va PNG/JPEG
 * baytlarini SNIFF qiladi (soxta MIME'ga ishonmaydi).
 */
import { photoOrientation, requestBudget, type FalFailure, type ImageAsk, type ImageProvider, type ImageResult } from "./image-provider";

const PEXELS_URL = "https://api.pexels.com/v1/search";

export function pexelsKey() {
  return process.env.PEXELS_API_KEY?.trim() || "";
}

/**
 * HTTP kodini shartnomadagi beshta sababga o'giradi.
 *
 * 401/403 — kalit yaroqsiz yoki hisob bloklangan: qayta urinish
 * ma'nosiz, `chainProvider` shu provayderni DEKA OXIRIGACHA belgilaydi.
 * 429 — vaqtinchalik so'rov chegarasi.
 */
function pexelsReason(status: number): FalFailure {
  if (status === 401 || status === 403) return "blocked";
  if (status === 429) return "rate";
  return "failed";
}

type PexelsPhoto = { src?: { large2x?: string; large?: string }; alt?: string };

export async function requestPexelsImage(ask: ImageAsk, deadline?: number): Promise<ImageResult> {
  const key = pexelsKey();
  if (!key) return { ok: false, reason: "no-key", detail: "PEXELS_API_KEY yo'q" };

  const query = (ask.searchQuery || "").trim();
  if (!query) {
    // Uslub `photo` emas (yoki chaqiruvchi so'rov bermagan, masalan
    // `regenerateSlideImage` — u ataylab AI qayta chizishni xohlaydi).
    // Tarmoqqa CHIQILMAYDI: bu bepul kvota va vaqtni tejaydi.
    return { ok: false, reason: "failed", detail: "qidiruv so'rovi yo'q (uslub fotodan boshqa yoki berilmagan)" };
  }

  const budget = requestBudget(deadline);
  if (budget === null) return { ok: false, reason: "timeout", detail: "byudjet 2 s dan kam" };

  try {
    const url = `${PEXELS_URL}?query=${encodeURIComponent(query)}&orientation=${photoOrientation(ask.size)}&per_page=5`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(budget),
      headers: { Authorization: key },
    });
    if (!res.ok) {
      const reason = pexelsReason(res.status);
      const line = `${res.status} ${res.statusText || "request failed"}`;
      if (reason === "blocked") console.error("[pexels] provayder rad etdi (hisob/kalit):", line);
      else console.warn("[pexels]", line);
      return { ok: false, reason, detail: line };
    }
    const data = (await res.json()) as { photos?: PexelsPhoto[] };
    const photos = Array.isArray(data.photos) ? data.photos : [];
    // Bitta dekada bir xil foto ikki marta chiqmasin: `seen` da YO'Q
    // birinchi natija tanlanadi, topilmasa (5 tasi ham ishlatilgan)
    // birinchisi qaytariladi — dekada 5 tadan ko'p rasm kerak bo'lsa
    // takrorlanish muqarrar, lekin hech qachon rasmsiz qolmaslik
    // ustunroq.
    const usable = photos.map((p) => p.src?.large2x || p.src?.large).filter((u): u is string => Boolean(u));
    if (!usable.length) return { ok: false, reason: "failed", detail: "natija yo'q" };
    const url2 = usable.find((u) => !ask.seen?.has(u)) ?? usable[0];
    const alt = photos.find((p) => (p.src?.large2x || p.src?.large) === url2)?.alt || query;
    return { ok: true, image: { url: url2, alt } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network";
    console.warn("[pexels]", msg);
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, reason: timedOut ? "timeout" : "failed", detail: msg };
  }
}

export const pexelsProvider: ImageProvider = {
  id: "pexels",
  // Stock API HTTP so'rovi — Gemini/fal chizishdan tezroq, lekin
  // fal (8s) dan kamroq qilib qo'yish shart emas: aynan shu qiymat
  // `deadline - Date.now() < minMs` bilan "so'rov umuman yubormaslik"
  // chegarasi, past qilinsa vaqt tugaganda ham behuda so'rov ketardi.
  minMs: 6_000,
  hasKey: () => Boolean(pexelsKey()),
  fetchImage: requestPexelsImage,
};
