# Slaydtop.uz — «O'yinlar» guruhi chuqur audit: Krossvord, Flesh kartalar, Tinglash o'yini

**Sana:** 2026-09-16
**Metod:** login qilingan Playwright sessiya (`st-state.json`, `adkhambek_4` emas — sinov hisobi "Abdujabbor", balans 2 000 tanga), formalar ochildi, rejim plitkalari/tablar bosildi, `Ko'proq (+10)` til ro'yxatlari kengaytirildi, `Qo'shimcha (ixtiyoriy)` bo'limi ochildi, so'z/karta sonini almashtirib narx tekshirildi. **Hech narsa yaratilmadi/generatsiya qilinmadi**, "Yaratish" tugmalari bosilmadi, balans sarflanmadi, sozlamalar o'zgartirilmadi. Asos: `docs/research/slaydtop-public.md` (ochiq audit) — bu hisobot uni faqat shu 3 vosita bo'yicha chuqurlashtiradi, takrorlamaydi.

**Umumiy xulosa oldindan:** uchala vosita ham **bir xil narx (2 000 tanga, tekis — so'z/karta soni narxga TA'SIR QILMAYDI)**, bir xil til-tanlash naqshi (8 til ko'rinadi + «Ko'proq (+10)» tugmasi bilan yana 10 ta, jami **18 til**), va bir xil miqdor-chip naqshiga ega. Farqi — krossvordda qo'shimcha «Fayl asosida» rejimi va shu rejimda **chiqish formati tanlovi (PPTX/DOCX/PDF)** bor, flesh kartalar va tinglash o'yinida esa rejim tanlash umuman yo'q (to'g'ridan-to'g'ri mavzu-forma) va chiqish formati tanlovi ko'rinmadi — bular sof interaktiv veb-o'yin bo'lishi ehtimoli katta (**taxmin**).

---

## 1. Krossvord yaratuvchi (`/uz/crossword`)

**Nima qiladi:** mavzu yoki fayl asosida so'z+izoh krossvordi yaratadi. **Kimga:** o'qituvchilar (dars/mashq materiali), talabalar (o'z-o'zini sinash).

**Rejimlar (kirish sahifasida 2 ta katta plitka):**
1. **Mavzu asosida** (`/uz/crossword/topic`) — AI noldan yaratadi.
2. **Fayl asosida** (`/uz/crossword/file`) — hujjat yuklab shundan yaratadi (PDF/DOCX/PPTX/TXT — kirish plitkasida yozilgan qamrov; forma ichida esa faqat **PDF, DOCX, TXT, MD, maks 15 MB**).

### 1.1. «Mavzu asosida» — barcha maydonlar

| # | Maydon | Tur | Variantlar / standart | Majburiymi |
|---|---|---|---|---|
| 1 | Krossvord mavzusini kiriting | textarea | placeholder "Biologiya atamalari"; bo'sh | Ha (bosh maydon) |
| 2 | Krossvord tilini tanlang | chips (bitta tanlov) | 8 ko'rinadi: 🇺🇿O'zbekcha (standart), Qaraqalpaqsha, Қазақ тілі, Кыргызча, Забони тоҷикӣ, Türkmençe, Русский, English + **«Ko'proq (+10)»** → 🇸🇦Arabcha, 🇩🇪Nemis, 🇪🇸Ispan, 🇫🇷Fransuz, 🇯🇵Yapon, 🇰🇷Koreys, 🇱🇹Litva, 🇱🇻Latish, 🇹🇷Turk, 🇨🇳Xitoy — **jami 18 til** | Standart bor (O'zbekcha) |
| 3 | Krossvordda nechta so'z bo'lsin? | chips (bitta tanlov) | 10 / 15 / 20 ta so'z, standart **10** | Standart bor |
| 4 | To'liq ismingiz, kursingiz va guruhingizni yozing (ixtiyoriy) | textarea | profildan avtomatik to'ldiriladi (sinov hisobida: "Adhambek Ho'sinboyev 3-kurs 56-24-guruh") | Yo'q |
| 5 | **Qo'shimcha (ixtiyoriy)** — akkordion, ochilganda: | | | |
| 5a | So'zlar olinadigan matnni qo'ying (ixtiyoriy) | textarea | placeholder "Matnni shu yerga joylashtiring..." | Yo'q |
| 5b | Manba hujjat havolasini qo'ying (ixtiyoriy) | text (url) | placeholder "https://..." | Yo'q |

**Muhim kuzatuv:** «Mavzu asosida» rejimida **chiqish formati tanlovi YO'Q** — tugma shunchaki "Krossvordni yaratish — 2000 tanga". So'z sonini 10→15→20 o'zgartirganda narx **o'zgarmadi** (doim 2000 tanga).

### 1.2. «Fayl asosida» — farqlar

Bir xil maydonlar (mavzu, til, 10/15/20 so'z, F.I.Sh.) + qo'shimcha:

| Maydon | Tur | Variantlar |
|---|---|---|
| Fayl yuklang | file input (drag-drop) | PDF, DOCX, TXT, MD — maks 15 MB |
| Krossvord mavzusini kiriting | text | **ixtiyoriy** bu rejimda (fayl bo'lsa mavzu shart emas) |
| **Yuklab olish formati** | chips | **PPTX / DOCX / PDF**, standart **PDF** |

**Bu — hisobotdagi eng muhim topilma:** fayl-asosli rejimda chiqish aniq **hujjat fayli** (PPTX/DOCX/PDF, bosma/tarqatma krossvord varag'i bo'lishi mumkin) sifatida tanlanadi, mavzu-asosli rejimda esa bunday tanlov yo'q — ehtimol u faqat **interaktiv veb-o'yin** sifatida chiqadi (yoki formatni avtomatik belgilaydi). Ikkala holatda ham narx bir xil — **2000 tanga, tekis**.

---

## 2. Flesh kartalar yaratuvchi (`/uz/flashcard`)

**Nima qiladi:** mavzu bo'yicha savol/javob (yoki atama/ta'rif) xotira kartochkalari to'plami yaratadi. **Kimga:** o'quvchilar/talabalar — so'z, atama, formula yodlash.

**Rejim tanlash YO'Q** — sahifa to'g'ridan-to'g'ri forma (fayl-asosli variant, "Fayl asosida" plitkasi bu vositada umuman ko'rinmadi — faqat mavzu-asosli).

### Barcha maydonlar

| # | Maydon | Tur | Variantlar / standart | Majburiymi |
|---|---|---|---|---|
| 1 | Flesh kartalar mavzusini kiriting | textarea | placeholder "Mavzuni kiriting..."; bo'sh | Ha |
| 2 | Kartalar tilini tanlang | chips | xuddi krossvorddagi kabi **18 til** (8 ko'rinadi + Ko'proq +10, ro'yxat bir xil: uz/kaa/kk/ky/tg/tk/ru/en/ar/de/es/fr/ja/ko/lt/lv/tr/zh), standart O'zbekcha | Standart bor |
| 3 | Nechta karta bo'lsin? | chips | **5 / 10 / 15 / 20** ta karta, standart holatda sahifa yuklanganda ba'zan **20** tanlangan holda keldi (ekran suratida ko'rindi) | Standart bor |

**Narx tekshiruvi:** 5, 10, 15, 20 ta karta — barchasida **2000 tanga**, o'zgarmadi. Qo'shimcha/ixtiyoriy bo'lim, F.I.Sh. maydoni, chiqish formati tanlovi — **yo'q**. Bu eng sodda formali vosita (jami 3 maydon).

---

## 3. Tinglab tushunish o'yini (`/uz/listening-game`)

**Nima qiladi:** audio asosidagi til o'rganish o'yini — ikki o'lchamli til tanlovi (ona til / o'rganiladigan til) bilan. **Kimga:** til o'rganuvchilar (masalan o'zbek foydalanuvchi ingliz tilini o'rganish uchun).

**Rejim tanlash YO'Q** — to'g'ridan-to'g'ri forma.

### Barcha maydonlar

| # | Maydon | Tur | Variantlar / standart | Majburiymi |
|---|---|---|---|---|
| 1 | O'yin mavzusini kiriting | textarea | placeholder "Mavzuni kiriting..."; bo'sh | Ha |
| 2 | Ona tilingizni tanlang | chips | **18 til** (uz standart + 6 ko'rinadi + Ko'proq +10) — har birida parentez ichida o'zbekcha nom ham bor (masalan "Қазақ тілі (Qozoq tili)") | Standart: O'zbekcha |
| 3 | Qaysi tilni o'rganmoqchisiz? | chips | xuddi shu **18 til** ro'yxati, alohida mustaqil tanlov (ona tildan farqli tanlash mumkin) | Standart holatda **English (Ingliz tili)** tanlangan edi (ekran suratida) |
| 4 | Nechta so'z bo'lsin? | chips | 5 / 10 / 15 / 20 ta so'z, standart holatda **10** tanlangan ko'rindi | Standart bor |

**Narx tekshiruvi:** 5/10/15/20 so'z — barchasida **2000 tanga**. Qo'shimcha maydon, F.I.Sh., format tanlovi — yo'q. Bu 2 ta mustaqil 18-tillik tanlov (ona til × maqsad til = nazariy 18×18 kombinatsiya) — bizda o'xshashi yo'q UX naqshi.

---

## 4. O'yinchi tomoni (havola/QR, natijalar, ulashish, o'qituvchi kabineti)

**Tekshirish urinildi, lekin natija YO'Q edi — sabab:** login qilingan sinov hisobida ("Abdujabbor") **hech qanday O'yinlar (krossvord/flesh kartalar/tinglash/saralash) namunasi mavjud emas**. Bosh sahifadagi (`/uz`) «Mening fayllarim» bo'limida filtr tablari bor: **Barchasi / Slaydlar / Hujjatlar / Testlar / O'yinlar** — lekin ro'yxatda faqat 2 ta eski namuna bor (ikkalasi ham "Slayd"/"Professional slayd" turkumidan, 1 hafta oldin yaratilgan), «O'yinlar» filtri bo'yicha ko'rinadigan narsa yo'q. `/uz/test` sahifasida ham "Mening testlarim — Hozircha yo'q" / "Menga ulashilgan — Hozircha yo'q" deb aniq yozilgan; krossvord/flesh kartalar/tinglash sahifalarida bunday ro'yxat umuman ko'rinmadi (ehtimol faqat kamida bitta namuna bo'lsa chiqadi).

Vazifa qat'iy taqiqlagani uchun ("Yaratish" tugmasini bosma, balansni sarflama) — yangi o'yin yaratib natija skrinshotini olish **imkonsiz edi**. Shuning uchun quyidagilar **ochiq savol** bo'lib qoladi, keyingi auditda (mavjud namuna yoki maxsus ruxsat bilan) tekshirilishi kerak:
- O'yin yaratilgach qanday havola/QR beriladi (masalan `slaydtop.uz/play/<id>` yoki alohida domen);
- Natijalar qanday ko'rinadi (ball, to'g'ri/xato, vaqt);
- Ulashish mexanizmi (havola nusxalash, QR, Telegram ulashish);
- O'qituvchi kabineti/sinf boshqaruvi bormi (masalan Kahoot/Blooket uslubidagi "xost ekran + o'quvchilar PIN bilan qo'shiladi" formati) — CSP `frame-src`da tashqi o'yin-platforma domeni yo'q, demak bu **o'z ichki dvigateli**, lekin real-vaqt (Kahoot-uslub) xususiyati bormi yoki yo'qmi aniqlanmadi.

---

## 5. Texnik izlar

- **CSP (`/uz/listening-game` javobidan):**
  - `media-src 'self' blob: https://*.sodda.ai https://*.digitaloceanspaces.com` — audio fayllar **serverda tayyorlanib DigitalOcean Spaces'da saqlanadi**, brauzer tashqi TTS API'ga to'g'ridan-to'g'ri murojaat qilmaydi → **TTS provayderi CSP orqali aniqlanmaydi** (server-side chaqiriladi, taxmin: ElevenLabs/Azure/Google/OpenAI TTS — bizning `fal.ai`/boshqa provayderimiz bilan solishtirish uchun ma'lumot yetarli emas).
  - `frame-src 'self' blob: https://accounts.google.com https://appleid.apple.com` — **tashqi o'yin/embed platformasi (Genially, H5P, LearningApps va h.k.) yo'q** → o'yinlar o'z ichki (custom) dvigatelida ishlanadi, uchinchi tomon widjeti emas.
  - `connect-src`da `wss://*.sodda.ai` va `wss://slaydtopbot.sodda.ai` (websocket) bor — bu bizning "Mening fayllarim" generatsiya holati kuzatuvidagidek, real-vaqt progress uchun ishlatiladi (o'yin generatsiyasi ham xuddi shu queue orqali o'tishi mumkin).
- **Forma render:** barcha uchta sahifa ham client-side (Next.js) render — statik/JS'siz holatda faqat skelet ko'rinadi (avvalgi ochiq auditdagi kuzatuv bilan mos).
- **Profil-avtoto'ldirish:** krossvordning "To'liq ismingiz, kursingiz va guruhingiz" maydoni profil sahifasidagi (`/uz/profile`) "Titul sahifasi" bo'limidagi saqlangan qiymatdan avtomatik keladi — bizning "muallif profili saqlanishi" (`AUDIT-12`, Formalar 2) naqshiga juda o'xshash.
- **Fayl-asosli krossvordning "Yuklab olish formati"** (PPTX/DOCX/PDF) — bu, o'yin generatorlarining bir qismi aslida "interaktiv o'yin + bosma hujjat" gibrid mahsulot ekanini ko'rsatadi: mavzu-asosli krossvord ehtimol veb-o'yin, fayl-asosli esa bosma varaq (**taxmin**, aniqlash uchun haqiqiy generatsiya kerak).

---

## 6. Narx jadvali (xulosa)

| Vosita | Narx | Narxga ta'sir qiluvchi parametr |
|---|---|---|
| Krossvord (mavzu asosida) | 2000 tanga (tekis) | Yo'q — 10/15/20 so'z narxni o'zgartirmaydi |
| Krossvord (fayl asosida) | 2000 tanga (tekis) | Yo'q — so'z soni, format (PPTX/DOCX/PDF) narxni o'zgartirmaydi |
| Flesh kartalar | 2000 tanga (tekis) | Yo'q — 5/10/15/20 karta bir xil narx |
| Tinglash o'yini | 2000 tanga (tekis) | Yo'q — 5/10/15/20 so'z bir xil narx |

Uchala vosita ham raqobatchining boshqa "kichik/tez" vositalari (infografika, saralash o'yini) bilan bir xil **2000 tanga tekis narx** darajasida — bizning eng arzon vositalarimiz (insho/rasm 2000) bilan bir xil segment.

---

## 7. Bizning naqshga qanday sig'adi (`lib/tools.ts` / `components/forms/`)

Uchala vosita ham bizning mavjud reyestr naqshiga **to'g'ridan-to'g'ri sig'adi**, yangi field-kind kerak emas: tekis narx (masalan `lesson-plan`/`keys` kabi `price: 2000` konstant), `kind: "chips"` (miqdor — 5/10/15/20, xuddi `lesson-plan`dagi davomiylik chipsi kabi) + `kind: "language"` (til — mavjud `glossary`/`keys`dagi til maydoni bilan bir xil). Yangi `group: "oyinlar"` qo'shib, `lib/generation/`ga yangi `crossword`/`flashcard`/`listening-game` yozuvchi modul qo'shish — narx/forma darajasida mavjud arxitekturaga mos, faqat chiqish DOCX/PPTX o'rniga **interaktiv veb-ko'ruvchi** (ehtimol `AcademicDoc`ga o'xshash yangi "GameDoc" yagona-manba modeli) talab qiladi.

---

## Ochiq qolgan savollar

1. O'yinchi tomoni (havola/QR, natija ekrani, ulashish, o'qituvchi kabineti) — hisobda namuna yo'qligi sababli ko'rilmadi; real generatsiya (boshqa ruxsat bilan) kerak.
2. TTS provayderi (tinglash o'yini uchun) — CSP orqali aniqlanmadi, server-side.
3. Mavzu-asosli krossvordning chiqish formati (fayl-aslidagidan farqli, tanlov yo'q) — avtomatik PDF/veb ekanini tasdiqlash uchun real generatsiya kerak.
4. Saralash o'yini (`/uz/sortball-game`) bu hisobot doirasiga kirmadi (vazifa faqat 3 vositani so'ragan) — keyingi audit uchun ochiq.
