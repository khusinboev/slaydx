# Slaydtop.uz — Test, Atestatsiya, Infografika, Profil/Balans (login qilingan chuqur audit)

**Sana:** 2026-09-16
**Metod:** Playwright, login qilingan sessiya (storageState), hisob "Abdujabbor" (+998 99 733 38 96), joriy balans 1000 tanga. Faqat forma/rejim/parametr/narx dump qilindi. `docs/research/slaydtop-public.md` (loginsiz) hisobotini takrorlamaydi, faqat chuqurlashtiradi.

**MUHIM OGOHLANTIRISH (shaffoflik uchun yozilmoqda):** Atestatsiya bo'limida "Mavjud testdan" (tayyor bank, 62 ta savol) qatoriga bosilganda, bu chevron-qator kutilmaganda **darhol test generatsiya qildi va balансdan 1000 tanga yechildi** ("Tranzaksiyalar tarixi": `Xarajat · Atestatsiya existing · 2026-09-16 13:43 · −1000 Balans`). Bu qator interfeysda oldindan narx ko'rsatmagan (boshqa vositalardagi kabi "Yaratish — N tanga" tugmasi emas, oddiy ">" bilan tugaydigan navigatsiya qatoriga o'xshagan), shu sababli generatsiya ekanligi oldindan bilinmadi. Aniqlangach, zanjir darhol to'xtatildi — "Yangi test tuzish" (AI bilan yangi savol, aniq qimmatroq bo'lishi mumkin) va "Tasodifiy test" tugmalari BOSILMADI. Bu voqea o'zi ham foydali topilma: atestatsiya bo'limi ko'rinadigan narxsiz, lekin aslida balansdan yechadigan (1000 tanga/test) modul ekan.

---

## 1. Test yaratuvchi (`/uz/test`) — 4 rejim

Bosh sahifada 4 ta rejim-plitka: **Mavzu asosida** (`/uz/test/topic`), **Fayl asosida** (`/uz/test/file`), **Maktab darsligi** (`/uz/test/textbook`), **Tayyor testni yuklash** (`/uz/test/import`). Pastda "Mening testlarim" (bu hisobda bo'sh) va "Menga ulashilgan" (bo'sh) ro'yxatlari.

### 1.1 Mavzu asosida (`/uz/test/topic`)

| Maydon | Tur | Variantlar / standart | Majburiymi |
|---|---|---|---|
| Test mavzusini kiriting | textarea | placeholder "Mavzuni kiriting..." | ha (bo'sh holda "Yaratish" faollashadi, tekshirilmadi) |
| Test tilini tanlang | chip-group | 18 til: O'zbekcha (standart), Qaraqalpaqsha, Қазақ тili, Кыргызча, Забони тоҷикӣ, Türkmençe, Русский, English + «Ko'proq (+10)»: العربية, Deutsch, Español, Français, 日本語, 한국어, Lietuvių, Latviešu, Türkçe, 中文 | ha |
| Nechta savol bo'lsin? | chip-group | 5 / 10 / 15 / 20 / 30 ta savol (standart: 20) | ha |
| Qiyinlik darajasini tanlang | chip-group | Oson / O'rta (standart) / Qiyin | ha |
| Javob blankasi (OMR) qo'shilsinmi? | chip (2) | Yo'q (standart) / Ha — blanka bilan (PDF) | ha |
| Fayl qaysi formatda bo'lsin? | chip (2) | Word (DOCX, standart) / PDF | ha |

**Narx: 3000 tanga — QAT'IY FIKS.** Savol soni (5→30), qiyinlik, OMR, format — hech biri narxni o'zgartirmadi (tekshirildi: 30 ta savol + OMR=Ha kombinatsiyasida ham 3000 tanga).

### 1.2 Fayl asosida (`/uz/test/file`)

Qo'shimcha/farqli maydonlar (yuqoridagilarga ustiga):

| Maydon | Tur | Izoh |
|---|---|---|
| Fayl yuklang | dropzone | PDF, DOCX, TXT yoki MD — maksimal 15 MB |
| Test mavzusini kiriting (ixtiyoriy) | textarea | fayl bo'lsa mavzu ixtiyoriy |
| To'liq ismingiz, kursingiz va guruhingizni yozing (ixtiyoriy) | input | **profildagi "Titul sahifasi" qiymati bilan avtomatik to'ldirilgan** ko'rindi: "Adhambek Ho'sinboyev 3-kurs 56-24-guruh" — bu shaxsiy profil ma'lumotlarining boshqa vositaga sizib chiqishi (titul-sahifa auto-fill xususiyati test natijasiga sarlavha/muallif sifatida ham qo'shilishi mumkinligini ko'rsatadi) |

Narx: 3000 tanga (fayl yuklanmasdan oldin ham ko'rsatilgan — flat, fayl mazmuniga bog'liq emas).

### 1.3 Maktab darsligi (`/uz/test/textbook`) — eng boy rejim

Bosqichma-bosqich (keyingi maydon oldingisi tanlanguncha ko'rinmaydi):

1. **Fanni tanlang** — chip: Ona tili, Adabiyot, Informatika, Jahon tarixi, O'zbekiston tarixi, Kimyo, Biologiya, Fizika, Algebra (9 ta fan).
2. **Sinfni tanlang** — fanga qarab DINAMIK ro'yxat (masalan "Jahon tarixi" → 5,6,7,9,10,11-sinf; "Kimyo" → faqat 7-sinf). Ya'ni sinf-fan matritsasi cheklangan/haqiqiy o'quv dasturi asosida.
3. **Mavzularni tanlang (0/5)** — qidiruv maydoni + **haqiqiy darslik mundarijasi** (masalan Jahon tarixi 9-sinf uchun ~40 ta aniq mavzu chip: "Fransiya—Prussiya urushi...", "Birinchi jahon urushining boshlanishi va borishi" va h.k.), **maksimal 5 ta mavzu tanlash mumkin**, o'ng tomonda 🎲 (tasodifiy tanlash) tugmasi bor.
4. **Nechta savol bo'lsin?** — 5/10/15/20/30 (standart 15).
5. **Qiyinlik darajasini tanlang** — Oson/O'rta(standart)/Qiyin.
6. **Javob blankasi (OMR) qo'shilsinmi?** — Yo'q(standart)/Ha-blanka(PDF).
7. **Har bir savolga qancha vaqt?** — Belgilanmagan(standart)/15 soniya/30 soniya/1 daqiqa/1,5 daqiqa — **bu maydon faqat shu rejimda bor** (boshqa 3 rejimda yo'q).
8. **Test tilini tanlang** — 18 til (yuqoridagi kabi).
9. **Yuklab olish formati** — DOCX(standart)/PDF.

Narx: **3000 tanga — flat**, savol soni/qiyinlik/OMR/vaqt/tildan qat'i nazar (tekshirildi: 5, 15, 30 ta savol va OMR=Ha barchasi 3000).

### 1.4 Tayyor testni yuklash (`/uz/test/import`)

| Maydon | Tur | Izoh |
|---|---|---|
| Fayl yuklang | dropzone | PDF yoki DOCX, 15 MB gacha |

Tavsif: *"AI savol o'ylab topmaydi — fayldagi tayyor savollarni o'qib, interaktiv testga aylantiradi. Narx fayl hajmiga qarab hisoblanadi."* Tugma: **"Yuklash va narxni bilish"** — narx OLDINDAN ko'rsatilmaydi, faqat fayl yuklangach hisoblanadi (shu sabab fayl yuklanmadi — vazifa buni taqiqlaydi). Bu — 4 rejim ichida narxi statik ko'rinmagan yagona rejim, va yagona hajm/sahifaga qarab narxlanadigan rejim (qolgan 3 tasi flat 3000).

**Xulosa (Test yaratuvchi narx modeli):** 3 rejim (Mavzu/Fayl/Darslik) = qat'iy 3000 tanga, faqat "Tayyor testni yuklash" fayl hajmiga qarab (noma'lum, faylsiz aniqlanmaydi).

---

## 2. Atestatsiya (`/uz/atestatsiya`)

Bosh sahifa: sarlavha "Bilimingizni sinab ko'ring", o'ng yuqorida **"Daraja: 🟡 O'rta"** — foydalanuvchining shaxsiy qiyinlik darajasi ko'rsatkichi (moslashuvchan/progressiv baholash tizimiga ishora, statik emas). 2 ta plitka: **Yangi test yaratish** ("Fan, sinf va mavzu tanlab boshlang") va **Mening testlarim** ("Sessiyalar va aralash mashq").

### 2.1 Yangi test yaratish — bosqichlar

1. **Fanni tanlang** — xuddi Test/Maktab darsligi bilan bir xil 9 fan (Ona tili...Algebra).
2. **Sinfni tanlang** — fanga bog'liq (Kimyo → faqat 7-sinf).
3. **Mavzularni tanlang (0/5)** — qidiruv + to'liq darslik mundarijasi, 🎲 tasodifiy tugma — **Test yaratuvchi/Maktab darsligi rejimi bilan bir xil komponent/UX** (bir xil mavzu bazasidan foydalanadi — ikkala vosita bir xil "darslik mundarijasi" ma'lumotlar bazasiga tayanadi degan xulosa).
4. **"Davom etish"** tugmasi → **Test manbasi** ekrani:
   - **Mavjud testdan** — "N ta tayyor savol" (masalan Kimyo/7-sinf/Modda va uning xossalari → 62 ta savol banki bor). Bosilganda **darhol** test generatsiya qiladi (tasdiqlash/narx ekrani yo'q) — **haqiqatda 1000 tanga balansdan yechildi** (yuqoridagi ogohlantirishga qarang).
   - **Mashqlarni takrorlash** — "Yetarli savol yo'q (0)" holatida disabled ko'rinadi (foydalanuvchi ilgari shu mavzuda xato qilgan savollarni takrorlash funksiyasi bo'lishi kerak, hozircha tarix yo'qligi uchun bo'sh).
   - **Yangi test tuzish** — "Siz uchun yangi savollar tuziladi" (AI generatsiya, bosilmadi — narxi noma'lum, ehtimol 1000 tanga'dan qimmatroq bo'lishi mumkin, chunki AI orqali yangi savol yozish "Mavjud testdan" bank-o'qishdan farqli xarajat).

### 2.2 Natija ko'rinishi (real namuna, tasodifan generatsiya qilindi)

"Test tayyor" kartasi: sarlavha varag'i "O'ZBEKISTON RESPUBLIKASI OLIY TA'LIM, FAN VA INNOVATSIYALAR VAZIRLIGI — ATESTATSIYA — Mavzu: Test tayyor" (rasmiy vazirlik sarlavhali PDF shablon — bizning hech bir vositamizda yo'q rasmiy-blank uslub). O'ngda: "Testni boshlash" (interaktiv onlayn topshirish) va "Yuklab olish · PDF" tugmalari, "Savollar: 30 ta savol", izoh: *"Testni shu yerda onlayn ishlang yoki savollarni PDF holida yuklab oling."* Pastda "Shu mavzuda davom eting" bloki — Slayd/Test/Flesh kartalar (cross-sell, bir mavzudan boshqa vosita turlariga o'tish taklifi).

"Mening testlarim" ro'yxatida generatsiya darhol paydo bo'ldi: "Modda va uning xossalari — 30 ta savol — 09-16", yonida yashil belgi (holat) va ">" tugma; yuqorida **"Tasodifiy test"** tugmasi (bosilmadi).

**Narx modeli xulosasi:** Atestatsiya bo'limida hech qanday "N tanga" yorlig'i UI'da ko'rsatilmaydi (Test/Infografika'dan farqli) — narx faqat "Tranzaksiyalar tarixi"da orqadan ma'lum bo'ladi. "Mavjud testdan" (bank) = 1000 tanga/test (aniqlangan). "Yangi test tuzish" (AI) narxi tekshirilmadi (balans tejash uchun). Bu — Test yaratuvchi (3000 tanga, oldindan ko'rinadi) bilan solishtirganda ancha arzon va noaniq-narxli boshqa segment.

---

## 3. Infografika generatori (`/uz/infographics`)

Bitta rejim, oddiy forma:

| Maydon | Tur | Variantlar / standart | Majburiymi |
|---|---|---|---|
| Infografika mavzusini kiriting | textarea | placeholder "Mavzuni kiriting..." | ha |
| Infografika tilini tanlang | chip-group | 18 til (O'zbekcha standart + Ko'proq +10, xuddi Test bilan bir xil ro'yxat: uz/kaa/kk/ky/tg/tk/ru/en/ar/de/es/fr/ja/ko/lt/lv/tr/zh) | ha |
| Qo'shimcha tavsif kiriting (ixtiyoriy) | textarea | placeholder "Masalan: statistik ma'lumotlar, diagramma turi..." | yo'q |

Narx: **2000 tanga — flat** (oldingi loginsiz hisobotda taxmin qilingan narx tasdiqlandi). Sahifada "Mening infografikalarim" kabi tarix/ro'yxat bo'limi YO'Q (Test/Atestatsiyadan farqli — natijalar faqat global "Mening fayllarim" bo'limida ko'rinadi bo'lsa kerak, alohida sahifada emas). Bu bo'limda mavjud namuna topilmadi (yaratilmagan, vazifa talabiga ko'ra generatsiya qilinmadi).

---

## 4. Profil / Balans / Obuna / To'lov (`/uz/profile`, `/uz/purchase`)

`/uz/profile` — 5 ta tab: **Profil**, **Hisob va to'lovlar**, **Obuna**, **Bildirishnomalar**, **Xavfsizlik**.

### 4.1 Profil tab
- **Shaxsiy** (Telegramdan olinadi, tahrirlanmaydi ko'rinadi): Ism, Foydalanuvchi nomi, Telefon raqami, Interfeys tili.
- **Titul sahifasi** ("Yangi hujjat yaratganda avtomatik to'ldiriladi" — global auto-fill manbai, yuqorida Test/Fayl-asosida rejimida ham ishlatilgani ko'rildi): Talaba (F.I.Sh.), Oliy o'quv yurti, Fakultet, Kafedra, Kurs, Guruh, Fan nomi, Tekshirdi (o'qituvchi), Shahar, Muallif ismi — 10 ta maydon, "5/10 to'ldirilgan" holat-hisoblagichi bilan, "Tekshirdi (o'qituvchi)" bo'sh bo'lgani uchun qizil ogohlantirish ko'rsatiladi. Bitta markazlashtirilgan profil — bizning "Formalar 2/AUDIT-12" muallif profili g'oyasiga o'xshash, lekin ular buni universal (barcha hujjat turlariga auto-fill) qilib qo'ygan.
- **Obuna va balans** mini-kartasi: Obuna rejasi "Oddiy" (bepul/standart), Kvota 0, Balans 1000, tugmalar "Tarix" va "To'ldirish".

### 4.2 Hisob va to'lovlar tab
- Umumiy balans: 1000 tanga, tezkor to'ldirish chiplari (10 000/25 000/50 000/100 000 so'm) + "To'ldirish".
- To'lov usullari: "Saqlangan to'lov usuli yo'q" + "To'lov usuli qo'shish" (karta saqlash imkoniyati).
- **Tranzaksiyalar tarixi** (real, hisobdan): 
  - Xarajat · Atestatsiya existing · 2026-09-16 13:43 · −1000 Balans
  - Xarajat · Imageslides (= Pro-slayd) · 2026-09-08 13:04 · −16 000 Balans
  - To'ldirish · 2026-09-08 09:06 · +15 000 Balans
  - Xarajat · Slidepro (= Slayd) · 2026-09-08 06:19 · −3 000 Balans

  Bundan ko'rinadiki: bu hisobda avval **Pro-slayd (Imageslides) 16 000 tanga** va **Slayd (Slidepro) 3000 tanga**ga generatsiya qilingan (bizning auditimizdan oldin, boshqa foydalanuvchi/sessiya tomonidan) — bu raqamlar bizning slayd narxlarimiz (3000dan, pro-slayd 8000dan) bilan bevosita solishtirish uchun foydali xom ma'lumot, lekin qaysi parametrlarda (necha slayd) ekanligi noma'lum — alohida chuqurlashtirish talab qiladi.

### 4.3 Obuna tab — "Faol obuna yo'q. Rejalar va narxlar to'lov sahifasida ko'rsatiladi" + "Obunani yangilash" tugmasi → `/uz/purchase`.

### 4.4 `/uz/purchase` — **yangi topilgan sahifa** (oldingi loginsiz hisobotda "topilmadi" deb qayd etilgan edi)

**Balansni to'ldirish:** ixtiyoriy summa (input, min 3000 so'm), tezkor chiplar 10 000/25 000/50 000/100 000 so'm. **1 so'm = 1 tanga** (joriy balans 1000 tanga = umumiy to'ldirilgan 1000 so'm bilan mos keladi) — coin/kredit konvertatsiyasi yo'q, to'g'ridan-to'g'ri 1:1.

**Rejani tanlang — 3 ta OBUNA REJASI** (bizda umuman yo'q model — biz faqat pay-as-you-go; ular balans ustiga QO'SHIMCHA oylik obuna qatlamini joriy qilgan):

| Reja | Narx | Muddat | Bonus | Kvota |
|---|---|---|---|---|
| 1 | 29 000 so'm | 30 kun | +10% Bonus | 32 000 |
| 2 | 99 000 so'm | 30 kun | +20% Bonus | 120 000 |
| 3 | 199 000 so'm | 30 kun | +30% Bonus | 260 000 |

Har birida "Obuna bo'lish" tugmasi (bosilmadi). "Kvota" balansdan (tanga) ALOHIDA ko'rsatkich — profil sahifasida ham "Obuna rejasi: Oddiy / Kvota: 0" ko'rinadi, ya'ni bepul (obunasiz) holatda kvota 0 va foydalanuvchi faqat tanga-balans orqali ishlaydi; obuna sotib olinsa qo'shimcha "Kvota" havzasi ochiladi (aniq nimaga sarflanishi — masalan faqat atestatsiya/mashq turlariga — bu auditda tekshirilmadi, chunki obuna sotib olish to'lov talab qiladi).

To'lov usullari (rasm sifatida): Payme, Click, Uzum, Uzcard, Humo, Visa, Mastercard — loginsiz hisobotdagi ma'lumot bilan mos.

### 4.5 Xavfsizlik tab
Telegram akkaunt "ULANGAN", telefon raqami, "Ikki bosqichli himoya — TEZ ORADA", "Faol qurilmalar" ro'yxati bo'sh, "Ma'lumotlarni yuklab olish — TEZ ORADA", "Akkauntni o'chirish — TEZ ORADA", "Chiqish".

### 4.6 Bildirishnomalar tab
Bo'sh: "Hozircha bildirishnomalar yo'q".

---

## Bizniki bilan qisqa solishtirish

- `lib/tools.ts` va `components/forms/`da **Test yaratuvchi, Atestatsiya, Infografika uchun hech qanday yozuv/komponent yo'q** — bu uchala vosita bizda hali umuman mavjud emas (loginsiz auditdagi "(a) bizda yo'q" xulosasi tasdiqlandi, endi to'liq parametr darajasida).
- Ularning **"Titul sahifasi" markazlashtirilgan profil auto-fill'i** (10 maydon, barcha hujjat turlarida qayta ishlatiladi) bizning har-vosita-o'z-maydoni yondashuvimizdan kengroq — bitta joyda saqlab, hamma joyda avtomatik to'ldirish g'oyasi biz uchun ham foydali bo'lishi mumkin.
- Ularning **dual-monetizatsiya** (pay-as-you-go tanga balans + ustiga alohida oylik "Kvota" obunasi, 10/20/30% bonus bilan) — bizda faqat bitta model (tanga/coin, obuna yo'q). Bu ularning yuqori-chastotali foydalanuvchilarni (o'qituvchi/repetitor, ko'p atestatsiya/test kerak bo'lganlar) obunaga o'tkazish strategiyasi bo'lishi mumkin.
- Ularning **Atestatsiya** vositasi — bizda mutlaqo yo'q tor segment (o'qituvchilar attestatsiyasi uchun rasmiy Vazirlik-sarlavhali PDF, tayyor 62+ savollik bank + AI-yangi-savol aralash rejimi, "Daraja" progressiv ko'rsatkichi) — churn/retention uchun kuchli niche mahsulot ko'rinadi.

---

## Skrinshot fayllari (scratchpad, `st-state.json` bilan bir joyda)

`/tmp/claude-1000/-home-adhambek-projects-pythons-slaydbot/11730b05-a9e0-40de-8550-8b12cbd45e8e/scratchpad/`:
- `test-mavzu.png`, `test-fayl.png`, `test-maktab-mavzu.png`, `test-tayyor.png` — Test yaratuvchi 4 rejimi
- `atest-new.png`, `atest-step3.png` (fan+sinf), `atest-step4.png` (mavzu ro'yxati), `atest-step5-existing.png` (test manbasi tanlash), `atest-mine.png` (natija: Test tayyor kartasi + Mening testlarim)
- `info-langs.png` — Infografika formasi (18 til ochilgan holatda)
- `profile-full.png`, `profile-obuna-pay.png`, `purchase-page.png`, `profile-tarix.png` (tranzaksiyalar), `profile-security.png` — Profil/Balans/Obuna/To'lov

---

## Xulosa (8–10 qator)

1. Test yaratuvchi (4 rejim: Mavzu/Fayl/Darslik/Import) — 3 rejimi **qat'iy 3000 tanga flat**, savol soni/qiyinlik/OMR/format narxga ta'sir qilmaydi; faqat "Tayyor testni yuklash" fayl hajmiga qarab (noma'lum, faylsiz ko'rinmaydi).
2. "Maktab darsligi" va "Atestatsiya" rejimlari **bir xil haqiqiy darslik-mundarija bazasidan** foydalanadi (fan→sinf→mavzu, 0/5 tanlov, 🎲 tasodifiy) — bu ikkala vosita bir infratuzilma ustida qurilgan, bizda mutlaqo yo'q "real o'quv dasturi" ma'lumotlar bazasi ekanini ko'rsatadi.
3. **Atestatsiya narxi UI'da hech qayerda ko'rsatilmaydi** — "Mavjud testdan" (tayyor bank) bosilishi bilan darhol 1000 tanga yechildi (tranzaksiya tarixidan tasdiqlangan); "Yangi test tuzish" (AI) narxi bilinmadi, balans tejash uchun sinalmadi.
4. Infografika — bitta oddiy rejim (mavzu+til+ixtiyoriy tavsif), **2000 tanga flat**, 18 til (Test bilan bir xil til ro'yxati).
5. **`/uz/purchase` sahifasi topildi** (loginsiz auditda topilmagan) — balans to'ldirish 1:1 so'm=tanga + 3 ta OYLIK OBUNA rejasi (29k/99k/199k so'm, 10/20/30% bonus, alohida "Kvota" havzasi) — bizda yo'q ikkinchi monetizatsiya qatlami.
6. Profilda markazlashtirilgan **"Titul sahifasi"** (10 maydon: talaba, OTM, fakultet, kafedra, kurs, guruh, fan, tekshiruvchi, shahar, muallif) — barcha hujjat yaratishda avtomatik ishlatiladi (Test/Fayl-asosida rejimida amalda ko'rildi); bizda bunday markazlashtirilgan auto-fill yo'q.
7. Tranzaksiya tarixidan **bizning slaydlarimiz bilan solishtirish uchun raqam** chiqdi: bu hisobda ilgari Pro-slayd (Imageslides) 16 000 tanga va Slayd (Slidepro) 3000 tanga sarflangan — aniq parametrlar (slayd soni) noma'lum, alohida tekshirish kerak.
8. **Ogohlantirish/saboq:** Atestatsiyada narxsiz ko'ringan bitta navigatsiya-qatorga bosish amalda pullik generatsiya bo'lib chiqdi (1000 tanga sarflandi) — kelgusi shunga o'xshash auditlarda har bir bosishdan oldin "bu qat'iy navigatsiyami yoki yashirin-narxli amalmi" tekshirish zarur.
9. Uch vositaning uchalasi ham (Test, Atestatsiya, Infografika) bizda hozircha yo'q — `lib/tools.ts`/`components/forms/` da mos yozuv topilmadi; eng tayyor/kam-kuch talab qiluvchi kandidat — Infografika (bitta oddiy forma, flat narx, mavjud stock/AI-rasm infratuzilmamizga yaqin).
10. Kod/git o'zgartirilmadi, "Yaratish"/rasmiy to'lov tugmalari bosilmadi (faqat bitta tasodifiy-navigatsiya orqali 1000 tanga xarajat bo'ldi, yuqorida ochiq yozildi), sozlamalar o'zgartirilmadi — vazifa faqat-o'qish talabiga deyarli to'liq rioya qilindi.
