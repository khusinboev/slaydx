/**
 * `returnTo` kabi so'rov parametridan kelgan manzilni saf(safe) qiladi.
 *
 * C02/FE-01/SECA-02: `?returnTo=javascript:...` login'dan keyin
 * `router.push(returnTo)` ga hech qanday tekshiruvsiz berilardi. Next
 * 15.5 kelib chiqishi (origin) mos kelmagan manzilni "tashqi" deb bilib
 * `location.assign(...)` chaqiradi; CSP `script-src 'unsafe-inline'`
 * bo'lgani uchun `javascript:` sxemasi sayt kelib chiqishi ICHIDA
 * ishga tushadi (DOM XSS). `https://` qiymat esa oddiy open redirect.
 *
 * Shuning uchun faqat saytning o'zidagi, bitta "/" bilan boshlangan,
 * "/uz" ostidagi nisbiy yo'llar o'tkaziladi — boshqa hamma narsa
 * (protokol-nisbiy "//", teskari chiziq, boshqaruv belgilari,
 * bo'shliqlar, foizli kodlash bilan yashiringan "//"/"\\") `null`
 * qaytaradi. Bu modul toza (pure) — hech qanday DOM/tarmoq/store'ga
 * bog'liq emas, shu bois `lib/ui.ts` (zustand do'koni) va
 * `LoginModal.tsx` (router) ikkalasida ham mustaqil ishlatiladi.
 */
export function safeReturnTo(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0) return null;

  // Boshida/oxirida bo'shliq bo'lsa rad etamiz — trim'dan KEYIN emas,
  // OLDIN tekshiramiz, aks holda " javascript:..." kabi qiymatlar
  // bo'shliq olib tashlangandan keyin "to'g'ri" ko'rinib qolardi.
  if (v !== v.trim()) return null;

  // Xom (encoded emas) boshqaruv belgilari — masalan "\x01/uz".
  if (/[\x00-\x1f\x7f]/.test(v)) return null;

  // Faqat bitta "/" bilan boshlanadi: "//evil.com" (protokol-nisbiy) va
  // "javascript:...", "https://evil.com", "data:..." kabi sxemali
  // qiymatlar shu yerda tushib qoladi (ular "/" bilan boshlanmaydi).
  if (!v.startsWith("/")) return null;
  if (v.startsWith("//")) return null;
  // Ba'zi brauzerlar "/\evil.com" ni ham protokol-nisbiy deb o'qiydi.
  if (v.startsWith("/\\")) return null;
  if (v.includes("\\")) return null;

  // Foizli kodlash orqali "//"/"\\" ni yashirish urinishi
  // ("/%2F%2Fevil.com" → dekodlanganda "//evil.com" bo'ladi).
  let decoded: string;
  try {
    decoded = decodeURIComponent(v);
  } catch {
    return null;
  }
  if (decoded.startsWith("//") || decoded.startsWith("/\\") || decoded.includes("\\")) return null;

  // Kelib chiqishi (origin) haqiqatan ham o'zgarmasligini `URL` bilan
  // ham tasdiqlaymiz — yuqoridagi qatordan chiqib ketgan har qanday
  // holat uchun ikkinchi qatlam.
  let url: URL;
  try {
    url = new URL(v, "https://x.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://x.invalid") return null;

  // Ilovada yagona marshrut ildizi "/uz" (`app/uz/...`) — shundan
  // tashqarisiga yo'naltirish ma'nosiz va ehtiyotkorlik uchun rad etiladi.
  if (!(v === "/uz" || v.startsWith("/uz/") || v.startsWith("/uz?") || v.startsWith("/uz#"))) return null;

  return v;
}
