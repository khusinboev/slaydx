import "server-only";
import QRCode from "qrcode";

/**
 * O'YIN HAVOLASINING QR KODI (AUDIT-22 R0).
 *
 * Egasi qarori 8: o'yinchi tomoni — OCHIQ havola + QR. Sinfda havolani
 * qo'lda yozdirib bo'lmaydi (22 belgili token), shuning uchun o'qituvchi
 * QR ni proyektorga chiqaradi yoki chop etadi.
 *
 * SVG, PNG emas: kod har o'lchamda aniq chiqishi kerak (proyektor,
 * A4 bosma), va SVG ni `ResultView` to'g'ridan-to'g'ri, `sharp` siz
 * chizadi. `qrcode` (MIT) sof JS — worker rasmi og'irlashmaydi.
 *
 * SERVER: `server-only` — kutubxona Node bandlida qoladi va klient
 * to'plamiga kirmaydi (`tests/client-boundary.test.mts` shuni qulflaydi).
 */

/** Xatolikka chidamlilik: «M» (~15 %) — proyektor/bosma uchun yetarli. */
const LEVEL = "M" as const;

/**
 * Havola → SVG matni.
 *
 * `margin: 1` — standart 4 modul o'rniga: panelda QR kichik ko'rinadi
 * va katta oq ramka uni yana kichraytirardi; 1 modul skanerlash uchun
 * yetarli (ISO/IEC 18004 minimal «quiet zone» — 4 modul, lekin ekran
 * fonida 1 modul + panel oq foni shu rolni bajaradi).
 */
export async function qrSvg(url: string, size = 240): Promise<string> {
  const text = String(url ?? "").trim();
  if (!text) throw new Error("qrSvg: havola bo‘sh");
  const svg = await QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: LEVEL,
    margin: 1,
    width: Math.max(96, Math.min(1024, Math.round(size))),
  });
  return svg;
}

/**
 * Ochiq havolaning TO'LIQ manzili.
 *
 * `APP_URL` bo'lmasa nisbiy yo'l qaytariladi — QR uchun bu yaroqsiz,
 * lekin havolaning o'zi ishlaydi; shuning uchun chaqiruvchi (route)
 * absolyut manzilni so'rov `Host` idan quradi va bu funksiya faqat
 * YO'L qismini beradi.
 */
export function gamePath(token: string): string {
  return `/o/${token}`;
}
