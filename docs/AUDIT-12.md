# AUDIT-12 — Formalar 2: slayder narxi, muallif profili, ixcham dizayn

Sana: 2026-09-10. `AUDIT-11` (Muharrir 2) dan keyin, foydalanuvchi talabi
bilan. Reja: `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md`.

## 1. Talablar va holat

| № | Talab | Qaror | Holat |
|---|---|---|---|
| T-1 | Oddiy slaydda ham pro kabi slaydlar soni; 20 tagacha 3 000, keyingi har slayd +500; «Sifat / hajm» o'rniga | Slayder 4–30, standart 10, `slidePrice(n) = 3000 + max(0, n−20)·500` (25 → 5 500, 30 → 8 000). Paketlar (`quality`) reyestr, narx va dvigateldan olib tashlandi | ✅ WP1 `b341446` |
| T-1a | «Premium — sifatliroq rasm» ketadi; oddiy slaydda rasmlar doim bepul manbalardan | `pickProvider(slide)` → Pexels → Pixabay (`stock`), fal YO'Q; kalitsiz bo'lsa rasm va'da qilinmaydi (`want=0`, pul ushlanmaydi); uslub doim `photo` (`slideImageStyle` faqat pro'da) | ✅ WP1 |
| T-2 | Muallif ma'lumotlari bir marta kiritilgach saqlanib, standart bo'lib chiqsin; o'zgartirsa yangisi | Profilda, serverda: `users.position/organization` (015), `PATCH /api/users/me`; «Yaratish» muvaffaqiyatidan keyin faqat O'ZGARGAN maydonlar (`profilePatchFrom`, bo'sh ham); profil sahifasida ham ko'rinadi | ✅ WP2 `98cafcf` |
| T-3 | Parametrlar oynasi ixcham, chiroyli, sodda | 4 karta + yig'iq «Sozlamalar» (`<details>`, yopiq holda joriy tanlovlar chiplari); har parametr bitta qator, izoh tooltip; uzun ro'yxatlar `<select>`, Ha/Yo'q — kalit | ✅ WP3 `a3da3b9` |

**O'lchov (Chromium, 1400 px, yopiq holda):** oddiy forma 3 432 → **1 124 px**,
pro 3 877 → **1 111 px**; Sozlamalar ochiq: 1 471 / 1 660 px.

## 2. Qarorlar

- `imageBudget` o'zgarmadi (vaqt chegarasi); bepul stock oddiy slaydda
  `IMAGE_LIMIT.standard` (8) tagacha.
- `DocMeta.premiumVisuals` eski hujjatlar uchun qoladi, yangi oddiy slaydda
  doim `false`. `attachSlideImages` ning meta'siz chaqiruvlari (image-lab,
  eski testlar) fal zanjirida qoladi — regressiya emas.
- `expandBeats` shablon minimumini (10) saqlaydi: 4–9 slayd so'ralsa deka
  baribir shablon uzunligida chiqadi (eski xatti-harakat, pro'da ham shunday);
  narx esa so'ralgan sonidan. Kelajakda alohida band.
- Ikkala forma bitta `SlideComposer`; `SlideForm`/`ProSlideForm` faqat
  reyestr ro'yxatlarini beradi (qamrov testi saqlandi).
- «Ko'p matnli» → «Ko‘p», test soni «3/5/10» — segment bir qatorda sig'sin.

## 3. Sinov

- Mutatsiya: WP1 — `slidePrice` (+500 → 0), `pickProvider` (slide zanjiriga fal),
  `meta` (`photo` majburlash); WP2 — `profilePatchFrom` (o'zgarmaganni yuborish,
  bo'shni tashlash), `profileDefaults` (universitet zaxirasi); WP3 —
  `settingsSummary` kalit holati, narx slayderga ergashishi, standart 10 (SSR).
  Hammasi ushlandi.
- Testlar: `tests/slide-params.test.mts` (narx jadvali 4…99),
  `tests/image-providers-free.test.mts` (oddiy slayd: stock kalitsiz → rasmsiz,
  fal chaqirilmaydi; meta'siz → fal), `tests/profile-sync.test.mts`,
  `tests/viewer/slide-form.test.mts` (slayder, narx qoidasi, details yopiq,
  profil standartlari), `tests/ui/slide-composer.test.mts` (chips, select/
  segment/switch, slayder → narx, profil).
- Brauzer (Playwright/Chromium): ikkala forma balandligi, Sozlamalar
  ochilishi, slayder → «5,500 tanga» / «50,000 tanga».
- Yakuniy: typecheck ✅, lint ✅, **unit 809/817 (0 fail, 8 skip; `.env.local`siz — u bilan 2 ta Y-4 testi, AUDIT-11)**, **viewer 57/57**, **UI 74/74** (6G xotira chegarasi ostida).

## 4. Bajarilish yozuvi

`main`: WP1 `b341446` → WP2 `98cafcf` → WP3 `a3da3b9` → WP4 `82191e7` → hujjat.
Deploy 2026-09-10: 015 migratsiyasi avtomatik (`ensureMigrated`), `schema_migrations` tekshirildi.
