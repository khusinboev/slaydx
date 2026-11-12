/**
 * Pexels bepul stock-foto provayderi (AUDIT-9 P3).
 *
 * Zanjirning BIRINCHI bo'g'ini (`chainProvider([pexelsProvider,
 * pixabayProvider])`, `image-provider.ts` `pickProvider`).
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
import { photoOrientation, requestBudget, type ImageFailure, type ImageAsk, type ImageProvider, type ImageResult, type StockSearch } from "./image-provider";
import { getProviderKey } from "../server/providers/resolve";
import { recordProviderCall } from "./provider-calls";

const PEXELS_URL = "https://api.pexels.com/v1/search";

export function pexelsKey() {
  return getProviderKey("pexels");
}

/**
 * HTTP kodini shartnomadagi beshta sababga o'giradi.
 *
 * 401/403 — kalit yaroqsiz yoki hisob bloklangan: qayta urinish
 * ma'nosiz, `chainProvider` shu provayderni DEKA OXIRIGACHA belgilaydi.
 * 429 — vaqtinchalik so'rov chegarasi.
 */
function pexelsReason(status: number): ImageFailure {
  if (status === 401 || status === 403) return "blocked";
  if (status === 429) return "rate";
  return "failed";
}

type PexelsPhoto = { src?: { large2x?: string; large?: string; tiny?: string; small?: string }; alt?: string };

/**
 * Pexels search -> candidates (docs/slide-quality/SPEC.md §B). The ONE network path of this provider:
 * `requestPexelsImage` (the legacy first-unseen chain) is built on it, so key/budget/error classes stay identical.
 */
export async function searchPexels(ask: Pick<ImageAsk, "searchQuery" | "size">, deadline?: number, perPage = 5): Promise<StockSearch> {
  const key = pexelsKey();
  if (!key) return { ok: false, reason: "no-key", detail: "PEXELS_API_KEY yo'q" };

  const query = (ask.searchQuery || "").trim();
  if (!query) {
    // Uslub `photo` emas (yoki chaqiruvchi so'rov bermagan — ataylab AI
    // chizishni xohlaydi).
    // Tarmoqqa CHIQILMAYDI: bu bepul kvota va vaqtni tejaydi.
    return { ok: false, reason: "failed", detail: "qidiruv so'rovi yo'q (uslub fotodan boshqa yoki berilmagan)" };
  }

  const budget = requestBudget(deadline);
  if (budget === null) return { ok: false, reason: "timeout", detail: "byudjet 2 s dan kam" };

  // Usage counter for the admin «Provayderlar» page: one count per request that actually went out.
  let sent = false;
  try {
    const url = `${PEXELS_URL}?query=${encodeURIComponent(query)}&orientation=${photoOrientation(ask.size)}&per_page=${perPage}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(budget),
      headers: { Authorization: key },
    });
    sent = true;
    recordProviderCall("pexels", res.ok);
    if (!res.ok) {
      const reason = pexelsReason(res.status);
      const line = `${res.status} ${res.statusText || "request failed"}`;
      if (reason === "blocked") console.error("[pexels] provayder rad etdi (hisob/kalit):", line);
      else console.warn("[pexels]", line);
      return { ok: false, reason, detail: line };
    }
    const data = (await res.json()) as { photos?: PexelsPhoto[] };
    const photos = Array.isArray(data.photos) ? data.photos : [];
    const candidates = photos
      .map((p) => {
        const full = p.src?.large2x || p.src?.large;
        return full ? { url: full, thumb: p.src?.tiny || p.src?.small || full, alt: p.alt || query, provider: "pexels" as const } : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    return { ok: true, candidates };
  } catch (e) {
    if (!sent) recordProviderCall("pexels", false);
    const msg = e instanceof Error ? e.message : "network";
    console.warn("[pexels]", msg);
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, reason: timedOut ? "timeout" : "failed", detail: msg };
  }
}

export async function requestPexelsImage(ask: ImageAsk, deadline?: number): Promise<ImageResult> {
  const found = await searchPexels(ask, deadline);
  if (!found.ok) return found;
  // Bitta dekada bir xil foto ikki marta chiqmasin: `seen` da YO'Q
  // birinchi natija tanlanadi, topilmasa (5 tasi ham ishlatilgan)
  // birinchisi qaytariladi — dekada 5 tadan ko'p rasm kerak bo'lsa
  // takrorlanish muqarrar, lekin hech qachon rasmsiz qolmaslik
  // ustunroq.
  const usable = found.candidates;
  if (!usable.length) return { ok: false, reason: "failed", detail: "natija yo'q" };
  const picked = usable.find((c) => !ask.seen?.has(c.url)) ?? usable[0];
  return { ok: true, image: { url: picked.url, alt: picked.alt } };
}

export const pexelsProvider: ImageProvider = {
  id: "pexels",
  // Stock API HTTP so'rovi — Gemini chizishdan tezroq, lekin juda
  // qisqa qilib qo'yish shart emas: aynan shu qiymat
  // `deadline - Date.now() < minMs` bilan "so'rov umuman yubormaslik"
  // chegarasi, past qilinsa vaqt tugaganda ham behuda so'rov ketardi.
  minMs: 6_000,
  hasKey: () => Boolean(pexelsKey()),
  fetchImage: requestPexelsImage,
};
