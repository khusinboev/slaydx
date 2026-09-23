/**
 * `returnTo` kabi so'rov parametridan kelgan manzilni xavfsiz manzilga
 * cheklaydi.
 *
 * C02/FE-01/SECA-02: `?returnTo=javascript:...` login'dan keyin
 * `router.push(returnTo)` ga hech qanday tekshiruvsiz berilardi. Next
 * 15.5 kelib chiqishi (origin) mos kelmagan manzilni "tashqi" deb bilib
 * `location.assign(...)` chaqiradi; CSP `script-src 'unsafe-inline'`
 * bo'lgani uchun `javascript:` sxemasi sayt kelib chiqishi ICHIDA
 * ishga tushadi (DOM XSS). `https://` qiymat esa oddiy open redirect.
 *
 * Shuning uchun faqat saytning o'zidagi, "/uz" ostidagi nisbiy yo'llar
 * o'tkaziladi — boshqa hamma narsa (protokol-nisbiy "//", teskari
 * chiziq, boshqaruv belgilari, bo'shliqlar, foizli kodlash bilan
 * yashiringan "//"/"\\", nuqta segmentlari — "..") `null` qaytaradi.
 *
 * MUHIM: "/uz" tekshiruvi XOM satrda emas, `URL` RESOLVE qilgan
 * (normallashgan) `pathname`da bajariladi. "/uz/..//evil.com" yoki
 * "/uz/%2e%2e//evil.com" kabi qiymatlar XOM holda "/uz/" bilan
 * boshlanadi, lekin brauzer/Next ularni RESOLVE qilganda "/uz" segmenti
 * ".." bilan yutilib, natija "//evil.com" (protokol-nisbiy, boshqa host)
 * bo'lib qoladi — shu sabab birinchi (real audit topilmasi, ko'ring
 * `audit/reviews/W1-B.md`) yechim xom prefiks tekshiruvi yetarli emas
 * edi.
 *
 * Bu modul toza (pure) — hech qanday DOM/tarmoq/store'ga bog'liq emas,
 * shu bois `lib/ui.ts` (zustand do'koni) va `LoginModal.tsx` (router)
 * ikkalasida ham mustaqil ishlatiladi.
 */
export function safeReturnTo(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0) return null;

  // Boshida/oxirida bo'shliq bo'lsa rad etamiz — trim'dan KEYIN emas,
  // OLDIN tekshiramiz: `URL` konstruktori ba'zi bo'shliq/boshqaruv
  // belgilarini o'zi indamay olib tashlaydi (masalan
  // `new URL("\x01/uz", base).pathname === "/uz"`), shuning uchun bu
  // tekshiruvlar RESOLVED URL'dan OLDIN, xom satrda bajariladi.
  if (v !== v.trim()) return null;
  if (/[\x00-\x1f\x7f]/.test(v)) return null;

  // Sxemali qiymatlar ("javascript:...", "https://...", "data:...")
  // "/" bilan boshlanmaydi — arzon, erta rad etish.
  if (!v.startsWith("/")) return null;

  // Kelib chiqishi (origin) va yo'l (pathname) faqat `URL` RESOLVE
  // qilgandan keyingi (normallashgan) holatda tekshiriladi — xom satrda
  // "/uz/" bilan boshlangan ko'rinishi hech narsani kafolatlamaydi.
  let url: URL;
  try {
    url = new URL(v, "https://x.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://x.invalid") return null;

  const p = url.pathname;
  // Ehtiyot chorasi: resolve qilingandan keyin ham protokol-nisbiy "//"
  // chiqib qolsa ("/uz/..//evil.com" → pathname "//evil.com") alohida
  // rad etiladi — origin tekshiruvi bilan bir xil holatni ikkinchi
  // marta, boshqa maydonda tasdiqlaydi.
  if (p.startsWith("//")) return null;
  // Ilovada yagona marshrut ildizi "/uz" (`app/uz/...`) — RESOLVED yo'l
  // shundan boshlanishi shart (nuqta segmentlari bilan "/uz" doirasidan
  // chiqib ketish — masalan "/uz/../api/auth/logout" — shu yerda ushlanadi).
  if (!(p === "/uz" || p.startsWith("/uz/"))) return null;

  // Normallashtirilgan shakl qaytariladi (xom `v` emas) — nuqta
  // segmentlari va bir xil natijaga olib keladigan boshqa yozuvlar
  // izchil bitta ko'rinishga keladi.
  return p + url.search + url.hash;
}
