# Slaydtop.uz — «O'yinlar / Media» guruhi chuqur audit (sortball-game, podcast, congratulation)

**Sana:** 2026-09-16
**Metod:** Playwright, **login qilingan** sessiya (storageState), faqat o'qish — hech qanday «Yaratish»/to'lov tugmasi bosilmadi, balans sarflanmadi, sozlama o'zgartirilmadi. Har uch sahifada barcha rejim plitkalari bosildi, til ro'yxati «Ko'proq» orqali to'liq ochildi, majburiy maydon vaqtincha to'ldirilib narx paneli va tugma disabled/enabled holati tekshirildi (keyin hech narsa yuborilmadi).
**Manba:** https://slaydtop.uz/uz/sortball-game, /uz/podcast (+ /topic, /text, /file sub-rejimlari), /uz/congratulation.
**Oldingi hisobot:** `docs/research/slaydtop-public.md` (loginsiz, statik) — bu hisobot o'sha 3 vositani JS render bilan chuqurlashtiradi.

**Eng muhim umumiy topilma:** uchala vositada ham **ovoz tanlash imkoniyati YO'Q** — foydalanuvchi vazifa ta'rifida taxmin qilingan «ovozlar ro'yxati, til/jins/tezlik tanlovi» UI'da mavjud emas. Ovoz avtomatik (bitta standart AI ovoz, ehtimol serverda tilga qarab tanlanadi) — foydalanuvchi faqat **matn tili**ni tanlaydi, ovozning o'zini emas. Namuna audio ham hech qaysi sahifada ko'rinmadi (`<audio>` elementi yo'q, provayder izini forma darajasida topib bo'lmadi).

---

## 1) Sortball o'yini (`/uz/sortball-game`)

**Nima qiladi:** matn mavzusi bo'yicha AI so'z/tushunchalarni guruhlarga «saralash» o'yini generatsiya qiladi (interaktiv, o'ynaladigan link/format — natija sahifasi ko'rilmadi, chunki yaratish bosilmadi). **Kimga:** o'qituvchi/talaba, sinf mashg'uloti yoki mustaqil mashq uchun interaktiv vosita.

**Rejimlar:** yo'q — bitta to'g'ridan-to'g'ri forma (mode-tile yo'q).

| Parametr | Tur | Variantlar | Standart | Majburiymi |
|---|---|---|---|---|
| Mavzu | textarea | erkin matn | bo'sh | **Ha** (tugma matn kiritilmaguncha `disabled`) |
| O'yin tili | chip/radio, 1 tanlov | 18 til: 🇺🇿 O'zbekcha, Qaraqalpaqsha, Қазақ тілі, Кыргызча, Забони тоҷикӣ, Türkmençe, Русский, English + «Ko'proq (+10)»: العربية, Deutsch, Español, Français, 日本語, 한국어, Lietuvių, Latviešu, Türkçe, 中文 | O'zbekcha | Ha (har doim bitta tanlangan) |
| Nechta to'p bo'lsin | chip/radio, 1 tanlov | 2 / 4 / 6 / 8 / 10 / 12 / 15 / 20 ta to'p (8 pog'ona) | **10 ta to'p** | Ha (har doim bitta tanlangan) |

**Narx:** **2000 tanga — qat'iy fiks**, to'p sonidan (2 dan 20 gacha) VA tildan qat'i nazar o'zgarmaydi (barcha 8 pog'ona sinovdan o'tkazildi, hammasi 2000 tanga ko'rsatdi).

**Chiqish formati:** ko'rinmadi (yaratish bosilmagani uchun) — ehtimol interaktiv veb-o'yin (havola/embed), o'ynash uchun link. QR/o'yinchi tomoni tekshirilmadi (login-hisobda «Mening o'yinlarim» tarixi PII-siyosat tufayli ochilmadi — quyidagi «Ochiq savollar»ga qarang).

**Texnik izlar:** boshqa forma UI'lari bilan bir xil naqsh (`inline-flex ... rounded-full ... disabled:pointer-events`) — bitta umumiy dizayn-tizim komponenti. Audio yo'q, rasm/media yuklash yo'q.

---

## 2) Podkast generatori (`/uz/podcast`)

**Nima qiladi:** mavzu/matn/fayl asosida AI audio podkast (suhbat/hikoya formatidagi ovozli kontent) yaratadi. **Kimga:** eshitib o'rganish, yo'lda tinglash uchun audio-kontent istagan foydalanuvchi.

**Rejimlar (3 ta mode-tile, bosh sahifada tanlanadi):**

| Rejim | URL | Qo'shimcha maydon |
|---|---|---|
| Mavzu asosida | `/uz/podcast/topic` | — |
| Matn asosida | `/uz/podcast/text` | «Manba matni» (AI matnni qisqartirib ssenariy yozadi) |
| Fayl asosida | `/uz/podcast/file` | Fayl yuklash (PDF/DOCX/TXT/MD, maks. 15 MB) + ochiladigan «Qo'shimcha (ixtiyoriy)» blokda **«Manba hujjat havolasini qo'ying»** (link orqali ham manba berish mumkin) |

**Har uch rejimda umumiy parametrlar:**

| Parametr | Tur | Variantlar | Standart | Majburiymi |
|---|---|---|---|---|
| Podkast mavzusi | text input | erkin matn | bo'sh | **Mavzu-rejimda: ha.** Matn-rejimda: **ha** (ikkala maydon — «Manba matni» + «Podkast mavzusi» — to'ldirilmasa tugma disabled qoladi, garchi «(ixtiyoriy)» yozuvi ko'rinmasa ham). Fayl-rejimda: **yo'q**, aniq «(ixtiyoriy)» belgilangan (fayl o'zi asosiy majburiy kirish). |
| Manba matni (faqat matn-rejim) | textarea | erkin matn | bo'sh | Ha |
| Fayl (faqat fayl-rejim) | file input | PDF/DOCX/TXT/MD, ≤15 MB | — | Ha |
| Manba hujjat havolasi (fayl-rejim, «Qo'shimcha» ichida) | text input | URL | bo'sh | Yo'q (ixtiyoriy) |
| Podkast tili | chip/radio | 18 til (sortball bilan bir xil ro'yxat) | O'zbekcha | Ha |
| Davomiyligi | chip/radio | **1 / 2 / 3 / 4 / 5 daqiqa** (5 pog'ona — sortball/congratulationdan farqli, bu yerda 5-daqiqa qo'shilgan) | 1 daqiqa | Ha (har doim tanlangan) |

**Ovoz/jins/tezlik tanlovi:** **YO'Q** — hech qanday rejimda, hech qanday «Qo'shimcha» blokda ovoz bilan bog'liq parametr topilmadi.

**Narx:** **4000 tanga — qat'iy fiks**, barcha 3 rejimda va barcha 5 davomiylik pog'onasida (1-5 daqiqa sinovdan o'tkazildi, hammasi 4000 tanga) bir xil. Rejim (mavzu/matn/fayl) ham narxga ta'sir qilmaydi.

**Chiqish formati:** ko'rinmadi (generatsiya qilinmadi), ehtimol MP3 (sahifa nomi/tavsiflaridan taxmin, `docs/research/slaydtop-public.md`dagi DigitalOcean Spaces kuzatuvi bilan mos).

---

## 3) Tabriknoma generatori (`/uz/congratulation`)

**Nima qiladi:** shaxsga moslashtirilgan AI ovozli audio tabriknoma (kimga, kimdan munosabat, sabab/bayram) yaratadi. **Kimga:** B2C — shaxsiy/nofa foydalanish (tug'ilgan kun, bayram tabrigi).

**Rejimlar:** yo'q — bitta to'g'ridan-to'g'ri forma.

| Parametr | Tur | Variantlar | Standart | Majburiymi |
|---|---|---|---|---|
| Kimga tabrik | text input | erkin matn (masalan: «Dilnoza opa») | bo'sh | **Ha** (yagona majburiy maydon — to'ldirilmaguncha tugma disabled va narx umuman ko'rinmaydi) |
| Sizga kim bo'ladi | text input | erkin matn (masalan: «opa, ustoz, do'st») | bo'sh | Yo'q — aniq «(ixtiyoriy)» belgilangan |
| Sabab yoki bayram | text input | erkin matn (masalan: «tug'ilgan kun, Navro'z bayrami») | bo'sh | Yo'q — aniq «(ixtiyoriy)» belgilangan |
| Tabriknoma tili | chip/radio | 18 til (sortball/podkast bilan bir xil ro'yxat) | O'zbekcha | Ha |
| Davomiyligi | chip/radio | **1 / 2 / 3 / 4 daqiqa** (4 pog'ona) | 1 daqiqa | Ha |

**Ovoz/jins tanlovi:** **YO'Q**.

**Narx:** «Kimga tabrik» bo'sh bo'lganda narx **umuman ko'rsatilmaydi** (tugma kulrang, matnsiz). Maydon to'ldirilgach: **4000 tanga — qat'iy fiks**, barcha 4 davomiylik pog'onasida (1-4 daqiqa sinovdan o'tkazildi) bir xil qoladi.

**Chiqish formati:** ko'rinmadi (generatsiya qilinmadi), ehtimol MP3 (podkast bilan bir xil pattern — Text-to-Speech pipeline).

---

## Narx-jadval xulosasi

| Vosita | Narx | Narxga ta'sir qiluvchi parametr |
|---|---|---|
| Sortball o'yini | 2000 tanga (fiks) | **Yo'q** — to'p soni (2-20) va til narxga ta'sir qilmaydi |
| Podkast | 4000 tanga (fiks) | **Yo'q** — rejim (mavzu/matn/fayl) va davomiylik (1-5 daq) narxga ta'sir qilmaydi |
| Tabriknoma | 4000 tanga (fiks) | **Yo'q** — davomiylik (1-4 daq) narxga ta'sir qilmaydi |

Bu 3 vosita ham raqobatchining «kichik/tez vosita» narx zinasida (2000-4000 tanga, bizning eng arzon insho/rasm bilan bir xil daraja) — barcha parametrlar shunchaki **kontent sifatini** boshqaradi, narxni emas (`docs/research/slaydtop-public.md`da qayd etilgan infografika/flashcard/tinglash o'yini 2000 tanga naqshiga mos).

---

## Ochiq qolgan savollar

1. **Chiqish formati aniq tasdiqlanmadi** (MP3 taxmin, generatsiya qilinmagani uchun real faylni ko'rib bo'lmadi).
2. **Sortball o'yinining o'ynaladigan/natija tomoni** (havola/QR, ball hisoblash) ko'rilmadi — hisobning «Mening ishlarim»/tarix sahifalariga kirish urinishi **Claude Code auto-mode PII-klassifikatori tomonidan rad etildi** («PII Data Handling»); agar bu segment kerak bo'lsa, alohida ruxsat bilan qayta urinish kerak.
3. Ovoz TANLASH imkoniyati yo'qligi 100% aniq (barcha rejim/blok tekshirildi), lekin **ovoz namunasi** (tayyor generatsiya audio) ko'rilmagani uchun ovoz sifati/tabiiyligi baholanmadi.

---

## SlaydX integratsiyasi uchun qisqa izoh

Uchala vosita ham bizning `lib/tools.ts` registriga standart obyekt sifatida (`id`/`slug`/flat narx) va `components/forms/`ga mavjud chip-tanlov + til-selektor naqshlari bilan **to'g'ridan-to'g'ri sig'adi** — ovoz tanlovi yo'qligi tufayli forma murakkabligi past (matn + til + davomiylik/son, bizning boshqa vositalarimizdan sodda). Yagona yangi tashqi bog'liqlik — **Text-to-Speech (TTS) API** (podkast + tabriknoma uchun; sortball uchun kerak emas, u matnli o'yin). Hozircha bizda TTS integratsiyasi yo'q — ElevenLabs yoki Google Cloud TTS/Azure Speech eng ehtimolli nomzodlar (raqobatchi tomonida provayder izi forma darajasida topilmadi, tekshirish uchun tayyor audio namunasi kerak bo'lardi).
