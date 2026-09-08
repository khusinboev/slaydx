/**
 * Gemini rasm provayderi (AUDIT-9 WP-E) — `pro-slide` yo'li.
 *
 * SHAKL JONLI TASDIQLANGAN (2026-09-08, bitta pullik chaqiruv). Bu
 * muhim, chunki `interactions` endpointi Gemini ning odatdagi
 * `models/…:generateContent` yo'lidan BUTUNLAY boshqacha: model nomi
 * URL da emas, TANADA; javob esa `candidates[].content.parts[]` emas,
 * `steps[].content[]`.
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   x-goog-api-key: <GEMINI_API_KEY>
 *   {"model":"gemini-3.1-flash-image",
 *    "input":[{"type":"text","text":"…"}],
 *    "response_format":{"type":"image","mime_type":"image/jpeg",
 *                       "aspect_ratio":"16:9","image_size":"1K"}}
 *
 * Javob: HTTP 200, rasm `$.steps[1].content[0]` da
 * `{ data: <base64>, mime_type: "image/jpeg" }` ko'rinishida (790 KB
 * JPEG, ~1550 output token). Narx $0.067/rasm (1K); zaxira model
 * `gemini-3.1-flash-lite-image` ($0.034).
 *
 * `steps[1]` INDEKSI QATTIQ YOZILMAGAN — `findImagePart` `steps[]`
 * ichidan `data` + `mime_type` juftligi bor birinchi tugunni rekursiv
 * qidiradi. Sabab: bitta jonli chaqiruvda ko'rilgan indeks shartnoma
 * emas; model bir qadam qo'shsa (masalan xavfsizlik filtri) rasm
 * `steps[2]` ga surilardi va qattiq yo'l jimgina `failed` bera
 * boshlardi.
 */
import { requestBudget, type FalFailure, type ImageAsk, type ImageProvider, type ImageResult } from "./image-provider";

/**
 * Bitta rasm so'rovining eng katta vaqti. O'lchov (2026-09-08,
 * `gemini-3.1-flash-image`, 1K): sarlavha 13 s, to'liq tana 34 s.
 * Shift ikki barobar zaxira bilan olingan — bosqich byudjeti baribir
 * ustidan cheklaydi (`requestBudget` ikkalasining KICHIGINI oladi).
 */
export const GEMINI_IMAGE_CAP_MS = 120_000;

const GEMINI_IMAGE_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_MODEL = "gemini-3.1-flash-image";
const DEFAULT_SIZE = "1K";

/**
 * Provayder qabul qiladigan nisbatlar — boshqasi 400 beradi.
 *
 * Slayd sloti ixtiyoriy nisbatda bo'lishi mumkin (`slotPixels` uni
 * pikselga o'giradi), shuning uchun ENG YAQINI tanlanadi — aks holda
 * har slot uchun qo'lda jadval yozish kerak bo'lardi va yangi maket
 * qo'shilganda u jimgina 1:1 ga tushib qolardi.
 */
export const GEMINI_ASPECTS = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
export type GeminiAspect = (typeof GEMINI_ASPECTS)[number];

export function geminiImageModel() {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
}

export function geminiImageSize() {
  return process.env.GEMINI_IMAGE_SIZE?.trim() || DEFAULT_SIZE;
}

export function geminiKey() {
  return process.env.GEMINI_API_KEY?.trim() || "";
}

/**
 * Slot pikselidan eng yaqin ruxsat etilgan nisbat.
 *
 * Masofa LOGARIFMDA o'lchanadi: nisbatlar ko'paytiruvchi kattalik, ya'ni
 * 0.67 → 0.75 farqi 1.33 → 1.5 farqi bilan bir xil «uzoqlikda» bo'lishi
 * kerak. Chiziqli ayirma tik slotlarni sun'iy ravishda 1:1 ga tortardi.
 */
export function aspectFor(size: { width: number; height: number }): GeminiAspect {
  const target = Math.max(1, size.width) / Math.max(1, size.height);
  let best: GeminiAspect = "1:1";
  let bestDist = Infinity;
  for (const id of GEMINI_ASPECTS) {
    const [w, h] = id.split(":").map(Number);
    const dist = Math.abs(Math.log(w / h) - Math.log(target));
    if (dist < bestDist) {
      bestDist = dist;
      best = id;
    }
  }
  return best;
}

/**
 * HTTP kodini shartnomadagi beshta sababga o'giradi.
 *
 * 401/403 — kalit yoki hisob (billing yoqilmagan, kvota tugagan):
 * `blocked`, ya'ni `attachSlideImages` qolgan so'rovlarni umuman
 * yubormaydi. 429 — vaqtinchalik chastota chegarasi.
 */
function geminiReason(status: number): FalFailure {
  if (status === 401 || status === 402 || status === 403) return "blocked";
  if (status === 429) return "rate";
  return "failed";
}

type ImagePart = { data: string; mime: string };

/**
 * Javob daraxtidan `data` + `mime_type` juftligini rekursiv topadi.
 *
 * Qidiruv `steps` dan boshlanadi (butun tanadan emas): `usage` yoki
 * kelajakdagi metadata bloklarida tasodifan base64 satr uchrasa u
 * rasm deb olinmasin.
 */
function findImagePart(node: unknown, depth = 0): ImagePart | null {
  if (node == null || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findImagePart(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const rec = node as Record<string, unknown>;
  const data = rec.data ?? rec.b64_json;
  const mime = rec.mime_type ?? rec.mimeType;
  // 64 belgidan qisqa base64 rasm bo'lolmaydi — shovqinni chetlab o'tamiz.
  if (typeof data === "string" && data.length > 64 && typeof mime === "string" && /^image\//i.test(mime)) {
    return { data, mime };
  }
  for (const value of Object.values(rec)) {
    const hit = findImagePart(value, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Javobdagi birinchi matn bo'lagi — rad etish sababini ko'rsatadi. */
function firstText(node: unknown, depth = 0): string {
  if (node == null || depth > 8) return "";
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = firstText(item, depth + 1);
      if (hit) return hit;
    }
    return "";
  }
  if (typeof node !== "object") return "";
  const rec = node as Record<string, unknown>;
  if (typeof rec.text === "string" && rec.text.trim()) return rec.text.trim();
  for (const value of Object.values(rec)) {
    const hit = firstText(value, depth + 1);
    if (hit) return hit;
  }
  return "";
}

function errorDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "request failed";
  const rec = body as Record<string, unknown>;
  const err = rec.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === "string" && msg) return msg;
  }
  const msg = rec.message;
  return typeof msg === "string" && msg ? msg : "request failed";
}

export async function requestGeminiImage(ask: ImageAsk, deadline?: number): Promise<ImageResult> {
  const key = geminiKey();
  if (!key) {
    console.warn("[gemini-image] GEMINI_API_KEY missing");
    return { ok: false, reason: "no-key", detail: "GEMINI_API_KEY yo'q" };
  }
  /*
   * 45 s (fal uchun mos shift) Gemini uchun YETMAYDI: o'lchandi —
   * sarlavhagacha ~13 s, keyin 2.3 MB base64 tanani o'qish yana ~20 s,
   * uzunroq promptda 45 s dan oshadi. Abort esa `res.json()` ni
   * yiqitardi va xato «javobda rasm yo'q» bo'lib ko'rinardi (jonli
   * sinovda 7/7 rasm shu sabab yo'qoldi).
   */
  const budget = requestBudget(deadline, GEMINI_IMAGE_CAP_MS);
  if (budget === null) return { ok: false, reason: "timeout", detail: "byudjet 2 s dan kam" };

  try {
    const res = await fetch(GEMINI_IMAGE_URL, {
      method: "POST",
      signal: AbortSignal.timeout(budget),
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: geminiImageModel(),
        input: [{ type: "text", text: ask.prompt }],
        response_format: {
          type: "image",
          mime_type: "image/jpeg",
          aspect_ratio: aspectFor(ask.size),
          image_size: geminiImageSize(),
        },
      }),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch (e) {
      /*
       * Sarlavha keldi-yu tana o'qilmadi — deyarli har doim byudjet
       * tugagani (2 MB dan katta javob). Buni «rasm yo'q» deb yozish
       * sababni yashiradi: hisobotda `skipped` bo'lishi kerak.
       */
      const aborted = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      const line = `javob tanasi o'qilmadi (${e instanceof Error ? e.name : "xato"}, byudjet ${Math.round(budget / 1000)} s)`;
      console.warn("[gemini-image]", line);
      return { ok: false, reason: aborted ? "timeout" : "failed", detail: line };
    }
    if (!res.ok) {
      const line = `${res.status} ${errorDetail(body)}`;
      const reason = geminiReason(res.status);
      // Hisob/kalit — operator aralashuvi kerak, o'z-o'zidan tuzalmaydi.
      if (reason === "blocked") console.error("[gemini-image] provayder rad etdi (hisob/kalit):", line);
      else console.warn("[gemini-image]", line);
      return { ok: false, reason, detail: line };
    }
    const steps = body && typeof body === "object" ? (body as Record<string, unknown>).steps : null;
    const part = findImagePart(steps);
    if (!part) {
      /*
       * 200 keldi-yu rasm yo'q — bu odatda MODEL RAD ETGANI (xavfsizlik
       * filtri yoki prompt tushunilmagani) yoki javob hali tugallanmagani.
       * Sababsiz "rasm yo'q" jurnali bu holatni ajratib bo'lmas qiladi,
       * shuning uchun bosqich turlari, holat va matn boshi yoziladi.
       */
      const rec = (body ?? {}) as Record<string, unknown>;
      const kinds = Array.isArray(steps)
        ? steps.map((st) => (st as Record<string, unknown>)?.type ?? "?").join(",")
        : typeof steps;
      const said = firstText(steps).slice(0, 160);
      const line = `javobda rasm yo'q (status=${String(rec.status ?? "?")}, steps=[${kinds}]${said ? `, matn: ${said}` : ""})`;
      console.warn("[gemini-image]", line);
      return { ok: false, reason: "failed", detail: line };
    }
    /*
     * `data:` URL bo'lib chiqadi — `slide-images.ts` `persistImage` →
     * `fetchImageBytes` uni allaqachon qo'llaydi (`decodeDataUrl`) va
     * u yerda baytlar SNIFF qilinadi. Ya'ni provayder yolg'on
     * `mime_type` yuborsa ham PNG/JPEG bo'lmagan bayt o'tmaydi.
     */
    return {
      ok: true,
      image: { url: `data:${part.mime};base64,${part.data}`, alt: ask.prompt.slice(0, 80) },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network";
    console.warn("[gemini-image]", msg);
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, reason: timedOut ? "timeout" : "failed", detail: msg };
  }
}

export const geminiProvider: ImageProvider = {
  id: "gemini",
  hasKey: () => Boolean(geminiKey()),
  fetchImage: requestGeminiImage,
};
