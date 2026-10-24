import "server-only";
import { env } from "../env";
import type { ConfirmFailure } from "./proposals";

/** HTTP shape of a refused confirmation (web API). Texts are Uzbek, like the rest of the web. */
export function confirmFailureResponse(f: ConfirmFailure): { status: number; body: Record<string, unknown> } {
  switch (f.reason) {
    case "invalid":
      return { status: 400, body: { error: "Tasdiqlash havolasi yaroqsiz. Taklifni qaytadan so'rang.", code: "invalid" } };
    case "used":
      return { status: 409, body: { error: "Bu taklif allaqachon ishlatilgan yoki bekor qilingan.", code: "used" } };
    case "expired":
      return { status: 410, body: { error: "Taklif muddati tugadi (10 daqiqa). Qaytadan so'rang.", code: "expired" } };
    case "tampered":
      return { status: 409, body: { error: "Taklif o'zgargan. Qaytadan so'rang.", code: "tampered" } };
    case "rate":
      return { status: 429, body: { error: "Juda ko'p so'rov. Birozdan keyin urinib ko'ring.", code: "rate" } };
    case "unavailable":
      return { status: 503, body: { error: "Xizmat hozir band — birozdan keyin urinib ko'ring.", code: "unavailable" } };
    case "adjust":
      return { status: 422, body: { error: "Ma'lumotlarni to'g'rilash kerak.", code: "adjust", issues: f.issues } };
    case "price_changed":
      return { status: 409, body: { error: `Narx o'zgardi. Yangi narx: ${f.price.toLocaleString("uz-UZ")} so'm. Taklifni qaytadan so'rang.`, code: "price_changed", price: f.price } };
    case "insufficient":
      return {
        status: 402,
        body: {
          error: `Balans yetarli emas. Kerak: ${f.required.toLocaleString("uz-UZ")} so'm, mavjud: ${f.available.toLocaleString("uz-UZ")}.`,
          code: "insufficient",
          required: f.required,
          available: f.available,
          topUp: `${env.appUrl}/uz/wallet`,
        },
      };
    case "refused":
      return { status: f.status, body: { error: f.message, ...(f.extra ?? {}), ...(f.code ? { code: f.code } : {}) } };
    case "admission":
      return { status: 429, body: { error: f.message, code: "admission", retryAfterSec: f.retryAfterSec } };
  }
}
