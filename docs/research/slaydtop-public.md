# SlaydX vs Slaydtop.uz — ochiq (loginsiz) ma'lumotlar bo'yicha hisobot

**Sana:** 2026-09-16
**Metod:** faqat GET so'rovlar (`curl`), login qilinmadi, hisob yaratilmadi, kod o'zgartirilmadi.
**Manba:** https://slaydtop.uz — bosh sahifa, `/uz/create`, `/uz/payment-info`, `/uz/oferta`, `/uz/privacy` va 24 ta vosita sahifasi (jami 29 ta URL, hammasi HTTP 200).

**Muhim kuzatuv (boshida):** Slaydtop.uz aslida **sodda.ai** (SoddaAi) platformasining O'zbekiston-yo'naltirilgan domeni/brendi — barcha JSON-LD, OG-teglar va API domenlar `sodda.ai` / `slaydtopbot.sodda.ai` ga ishora qiladi. Ya'ni "Slayd Top" = "SoddaAi" bitta mahsulot, ikki brend/domen ostida (`slaydtop.uz` — UZ market fokusli, `sodda.ai` — asosiy/global). Hisobotda bu ikkalasi bir raqobatchi sifatida ko'rib chiqiladi.

Ko'p forma sahifasi (slayd, pro-slayd, referat, mustaqil ish, texnologik xarita, glossariy, kalitlar, rezyume, AI rasm, atestatsiya, test, krossvord) client-side (Next.js/React) render qiladi — JS'siz statik HTMLda faqat sarlavha/skelet ko'rinadi, real parametrlar/narx ko'p hollarda **JS ishga tushgach** to'ladi. Bu sahifalar pastda **«statik holatda to'liq ko'rinmadi (JS talab qiladi)»** deb belgilangan — bu login talabi emas, balki render usuli farqi.

---

## (a) Raqobatchida BOR, bizda YO'Q xizmatlar

| Vosita | Nima qiladi | Kimga | Sahifadan bilingan parametrlar / narx |
|---|---|---|---|
| **Test yaratuvchi** (`/uz/test`) | AI yordamida o'quv test yaratadi: savol, variantlar, to'g'ri javob avtomatik. 3 rejim: (1) mavzu asosida, (2) **maktab darsligi asosida** (fan+sinf+mavzu tanlab, darslikka moslab), (3) tayyor savollar bankini (PDF/DOCX) interaktiv testga aylantirish. | Talaba va o'qituvchilar, tez baholash | Narx statik holatda ko'rinmadi (JS talab qiladi). Fayl formatlari: PDF/DOCX/PPTX/TXT. |
| **Atestatsiya testlari** (`/uz/atestatsiya`) | O'qituvchilar attestatsiyasiga tayyorgarlik — fan/sinf bo'yicha amaliy testlar, "sessiyalar va aralash mashq" bo'limi. | O'qituvchilar (attestatsiya topshiruvchilar) | Alohida, aniq segment — bizda umuman yo'q tor niша. Narx ko'rinmadi. |
| **Infografika generatori** (`/uz/infographics`) | Mavzu bo'yicha vizual infografika (diagramma/statistika) yaratadi, 18 til (10 tili "Ko'proq" ostida yashirin). | Taqdimot/dars uchun vizual material kerak bo'lganlar | **2000 tanga** (statik render, o'zgarmas ko'rinadi — bitta variant/hajm bo'lishi mumkin). Qo'shimcha tavsif — ixtiyoriy matn maydoni. |
| **Krossvord yaratuvchi** (`/uz/crossword`) | Mavzu bo'yicha so'z+izoh krossvordi, mavzu yoki fayl asosida. | Darslar, o'yin/mashqlar | Narx statik holatda ko'rinmadi. Fayl: PDF/DOCX/PPTX/TXT. |
| **Flashcard yaratuvchi** (`/uz/flashcard`) | Mavzu bo'yicha xotira kartochkalari (flashcard) to'plami, til tanlash (18 til), **5/10/15/20 ta karta** tanlovi. | O'quvchilar, so'z/tushuncha yodlash | **2000 tanga** (ko'rsatilgan, kartalar sonidan qat'i nazarmi — aniq emas, "taxmin": fiks narx). |
| **Tinglab tushunish o'yini** (`/uz/listening-game`) | Audio asosidagi interaktiv til o'rganish o'yini — "ona til" va "o'rganiladigan til" alohida tanlanadi, **5/10/15/20 so'z**. | Til o'rganuvchilar | **2000 tanga**. 7+10 til combo (ona til va maqsad til mustaqil tanlanadi — 2 o'lchamli til tanlovi, bizda yo'q UX). |
| **So'z saralash o'yini (Sortball)** (`/uz/sortball-game`) | Interaktiv "saralash" o'yini — tushuncha/so'zlarni to'p (ball) metaforasi bilan guruhlash, **2/4/6/8/10/12/15/20 ta to'p**. | Interaktiv mashq/o'yin | **2000 tanga**. |
| **Podkast generatori** (`/uz/podcast`) | Mavzu, matn yoki fayl asosida AI ovozli audio podkast (MP3), til va davomiylik tanlanadi. | O'zi eshitib o'rganish / audio kontent | Narx statik holatda ko'rinmadi ("Davomiyligi" congratulation'da 1-4 daqiqa ko'rinadi, podkastda alohida bo'lim bor lekin qiymatlari yashirin). |
| **Tabriknoma generatori** (`/uz/congratulation`) | Shaxsiy AI ovozli audio tabriknoma (MP3) — kimga/kimdan/sabab/til/davomiylik (**1-4 daqiqa**). | Shaxsiy/nofa foydalanish (tabrik, bayram) | Narx statik ko'rinmadi, lekin bu B2C/"virusli" vosita — mahsulot emas, ijtimoiy ulashish uchun mo'ljallangan bo'lishi mumkin (taxmin). |

**Umumiy naqsh:** raqobatchida narx ko'rsatilgan 4 ta yangi vosita (infografika, flashcard, tinglash o'yini, saralash o'yini) barchasi **bir xil, tekis 2000 tanga** — bizning eng arzon vositalarimiz (insho/rasm 2000) bilan bir xil narx darajasida joylashtirilgan, ya'ni ular buni "kichik/tez" vositalar toifasiga qo'ygan.

---

## (b) Ikkalamizda ham bor xizmatlar — narx va pozitsiya farqi

| Vosita | Bizniki (SlaydX, `lib/tools.ts`) | Ularniki (slaydtop.uz, sahifadan ko'ringan) | Farq / kuzatuv |
|---|---|---|---|
| **Slayd** | 3000 dan, 20 slaydgacha, keyin +500/slayd (`slidePrice`) | Narx statik ko'rinmadi (JS forma). "Mavzu asosida" / "Fayl asosida" 2 rejim — bizniki bilan bir xil UX naqshi. | Narxni taqqoslab bo'lmadi (login/JS kerak). |
| **Pro slayd** | 2000/slayd, 4-30 slayd (bazaviy 8000) | Narx statik ko'rinmadi. Tavsif: "AI rasm modeli bilan har bir slaydi tayyor rasm bo'lgan taqdimot" — bizning tavsifimizga juda o'xshash pozitsiya. | Pozitsiya deyarli bir xil; narx solishtirilmadi. |
| **Rasm (AI Rasm)** | 2000/3500/6000 (1/2/4+ dona) | Sahifa "Rasmlar yuklanmoqda" — to'liq JS render, hech narsa ko'rinmadi. | CSP'da `oaidalleapiprodscus.blob.core.windows.net` (OpenAI DALL·E) ruxsat berilgan — **taxmin: ular rasm generatsiyasida (qisman) OpenAI DALL·E dan foydalanishi mumkin**, bizda Gemini. |
| **Kurs ishi** | 12000–24000 (10-15 dan 40-45 betgacha, 7 pog'ona) | **12000 tanga** ko'rsatilgan (statik holatda — bu forma to'liq ko'ringan kam sahifalardan biri). Hajm: 10-15…40-45 bet (7 pog'ona) — **bizning pog'onalarimiz bilan bir xil oraliq va bir xil eng past narx (12000)**. Qo'shimcha: Vazirlik tanlovi (Oliy Ta'lim VA Maktab ta'limi Vazirligi) — bizda yo'q. | Narx bazaviy darajada BIR XIL. Ular vazirlik segmentini (maktab + OTM) alohida ajratadi — bizda faqat umumiy "talaba" guruhi bor. |
| **Referat** | 3000–6000 (10-15…25-30 bet) | Narx statik ko'rinmadi (mavzu/fayl rejimigacha). | Taqqoslanmadi. |
| **Insho** | 2000–4000 (1-5 varaq) | **2000 tanga** (default holatda, 1 varaq). 1-5 varaq tanlov — bizniki bilan bir xil oraliq. Qo'shimcha: 10 ta DIZAYN mavzusi (Vintage/Midnight/Smoke/Soft/Iris/Nightfall/Autumn/Crystal/Nature/Ocean) + universitet/fakultet/kafedra/fan/tekshiruvchi/shahar maydonlari — bizdan **ancha boy titul-maydon to'plami**. | Narx bazaviy daraja BIR XIL (2000). Ularda dizayn tanlovi va akademik titul maydonlari ko'proq. |
| **Maqola** | 4000/6000/8000/12000 (1-2/3-5/5-10/10-15 bet) | **8000 tanga** ko'rsatilgan (default holat — qaysi hajmga mos ekani noaniq, "taxmin": 5-10 bet darajasiga yaqin). Hajm variantlari: 3-5/5-10/10-15 bet (bizdagi 1-2 bet varianti YO'Q). Qo'shimcha: IMRAD (ilmiy format) rejimi, annotatsiya tili tanlovi (faqat maqola tili / UZ+EN+RU barchasi), muallif ma'lumotlari (F.I.Sh, kurs/guruh, ilmiy daraja, tashkilot, email). | Bizda 1-2 betlik eng arzon (4000) variant bor, ularda yo'q (eng kichik 3-5 bet). IMRAD/annotatsiya-til tanlovi bizda yo'q qo'shimcha imkoniyat. |
| **Rezyume** | 3000 (tekis) | Sahifa "Yuklanmoqda..." — to'liq JS, hech narsa ko'rinmadi. | Taqqoslanmadi. |
| **Tezis/Diplom** | Bizda "tezis" = **konferensiya tezisi** (qisqa, 1-2 bet 4000 / 3-5 bet 5000) | Ularda "Tezis" nomi ostida aslida **bitiruv-malakaviy (diplom) ishi** turibdi: 3-5/5-10/10-15/15-20/20-25 bet, IMRAD/standart tur, **6000 tanga** ko'rsatilgan (default). | **Terminologiya farqi muhim**: bizning "tezis" (conference thesis, qisqa) va ularning "Tezis" (diplom ishi, katta) BUTUNLAY BOSHQA mahsulot. Ular narxi (6000, 3-5 bet default) bizning konferensiya-tezisimizdan (5000, 3-5 bet) yuqori, lekin hajmi ancha katta bo'lishi mumkin — to'g'ridan-to'g'ri solishtirib bo'lmaydi. **Diplom ishi darajasidagi mahsulot bizda yo'q** (bu (a) bo'limiga ham tegishli bo'lishi mumkin — biz buni alohida ajratdik, chunki nomi bir xil "tezis").|
| **Tarjimon** | 3000 dan (belgilar soniga qarab) | DOCX/PPTX/XLSX/PDF, 20 MB gacha, **14 tilga** tarjima (bizda 18 til bor — `SOURCE_LANGUAGES`, ular kamroq ko'rsatgan). Narx statik ko'rinmadi. | Format qamrovi bir xil (Office + PDF). Til soni bizda ko'proq ko'rinadi (tekshirish kerak — ularning "+7 ko'proq" tugmasi bor, umumiy son aniq emas). |
| **Texnologik xarita** | 6000 (tekis) | Sahifa deyarli bo'sh render (faqat sarlavha) — JS talab qiladi. | Taqqoslanmadi. |
| **Glossariy** | 6000/9000/15000 (10/20/40 atama) | Sahifa deyarli bo'sh render. | Taqqoslanmadi. |
| **Kalitlar (Keys)** | 6000 (tekis) | Sahifa deyarli bo'sh render. | Taqqoslanmadi. |
| **Mustaqil ish** | 3000–6000 (10-15…25-30 bet) | Narx statik ko'rinmadi. | Taqqoslanmadi. |
| **Dars rejasi / ishlanmasi** | 4000 (tekis) | **12000 tanga** ko'rsatilgan (statik, to'liq forma ko'rindi: fan, sinf 1-11, sinf harfi, davomiylik 30/45/90 daqiqa, sana, maktab/viloyat/tuman/titul joyi). | **Katta narx farqi: ular 12000, biz 4000 (3x qimmat ularda)** — yoki ularning dars rejasi ancha boy/uzun chiqishi mumkin (sana, hudud, davomiylik variantlari ko'proq). Bu narx strategiyasini qayta ko'rib chiqish uchun signal bo'lishi mumkin (**taxmin**, chuqur audit kerak — ehtimol ular buni "ishlanma"ga (batafsil dars rejasi) tenglashtirgan, biz esa qisqa reja deb hisoblagan bo'lishimiz mumkin). |

---

## (c) To'lov / tarif modeli (`/uz/payment-info`, `/uz/oferta`)

- **Model: prepaid balans (coin/"tanga" emas — ularda so'm balansi)**, obuna/tarif REJALARI YO'Q. Har generatsiyadan oldin narx ko'rsatiladi, rozilik bilan balansdan yechiladi (bizning modelimizga to'g'ridan-to'g'ri o'xshash — coin/kredit tizimi emas, balans **so'mda**, biz esa "tanga" deb ataymiz).
- **To'lov usullari:** Payme, Click, Uzum (litsenziyalangan to'lov tizimlari), Uzcard/Humo/Visa/Mastercard shu tizimlar orqali. Karta ma'lumotlari ularga tegmaydi (PCI-compliant redirect).
- **Kirish (login):** Telegram OTP (bir martalik kod) — asosiy usul, oferta matnida shunday yozilgan. Lekin CSP'da `accounts.google.com` va `appleid.apple.com` ham ruxsat berilgan → **taxmin: Google va Apple orqali kirish ham mavjud** (bizda faqat Telegram + zaxira OTP, `lib/server/auth.ts`).
- **Pulni qaytarish:** balansdagi sarflanmagan mablag' — support (Telegram) orqali so'rov, 5 ish kuni ichida ko'rib chiqiladi. Ko'rsatilgan xizmat uchun qaytarilmaydi; texnik nosozlikda to'liq qaytariladi; dublikat to'lov to'liq qaytariladi. — Bu siyosat bizning odatiy amaliyotimizga o'xshaydi (moslik, alohida solishtirish uchun bizning qoidalar ko'rilmadi, vazifa doirasidan tashqari).
- **Narxlarni o'zgartirish huquqi:** bir tomonlama, oldindan sarflangan mablag'ga ta'sir qilmaydi (standart oferta bandi).
- **Coin/balans to'ldirish sahifasi** ("Xarid sahifasi", FAQ'da tilga olingan) **loginsiz topilmadi** — bir nechta taxminiy URL (`/uz/balance`, `/uz/xarid`, `/uz/topup`, `/uz/coins`, `/uz/pricing`, `/uz/tariffs`, `/uz/wallet`) barchasi 404 qaytardi. **Bu sahifa aniq login talab qiladi yoki boshqa yo'l bilan ochiladi** — boshqa agent login bilan tekshirishi kerak (balans to'ldirish paketlari/chegirmalar bormi-yo'qmi shu yerda ko'rinadi).

---

## (d) Kuzatuvlar — UI va texnologiya izlari

- **Stek:** Next.js (App Router, Turbopack — `/_next/static/chunks/turbopack-*.js` fayl nomlari ko'rinadi), `rsc`/`next-router-state-tree` sarlavhalari server-komponent (RSC) ishlatilayotganini tasdiqlaydi. Cloudflare orqasida (server: cloudflare, cf-ray, HSTS, CSP juda qattiq — nonce-based strict-dynamic).
- **Xato kuzatuvi (APM):** Sentry (`*.ingest.sentry.io`, `*.ingest.us.sentry.io`, `*.ingest.de.sentry.io` — 3 ta region, katta trafikka mo'ljallangan sozlash).
- **Analitika:** CSP'da Google Analytics/GTM, Yandex Metrika, Facebook Pixel, Hotjar, Mixpanel kabi domenlarning HECH BIRI yo'q → **kuzatuv: ular tashqi marketing-analitika skriptlarini ishlatmaydi (yoki server-side/1st-party orqali yig'adi)** — faqat Sentry (xato) bor. Bu ataylab maxfiylik/CSP siyosati bo'lishi mumkin (**taxmin**).
- **Rasm manbalari (CSP `img-src`):** `images.unsplash.com`, `cdn.pixabay.com`/`pixabay.com`, `images.pexels.com`, `upload.wikimedia.org`, `img.icons8.com` — stock-rasm integratsiyalari (bizning "Formalar 2" auditida biz ham stock-only qilgan edik — **ular ham stock-rasm manbalaridan foydalanadi**, ehtimol referens/kontent rasmlar uchun). Shu bilan birga `oaidalleapiprodscus.blob.core.windows.net` (OpenAI DALL·E natija hostingi) ham ruxsat etilgan → **taxmin: AI-rasm generatsiyasi (qisman yoki to'liq) OpenAI DALL·E orqali**, bizniki Gemini.
- **Fayl saqlash:** `*.digitaloceanspaces.com` (DigitalOcean Spaces) — generatsiya natijalari (pptx/docx/mp3) shu yerda saqlanadi, bizning fayl saqlash yechimimiz bilan solishtirish alohida vazifa.
- **Backend/bot domeni:** `slaydtopbot.sodda.ai` (https + wss) — real-time (websocket) generatsiya holati kuzatuvi uchun, va bu domen nomi ularning Telegram-bot infratuzilmasi bilan bog'liqligini ko'rsatadi (ehtimol bitta backend Telegram bot + web ikkalasiga xizmat qiladi).
- **Ko'p tillilik:** interfeys **6 tilda**: o'zbek, ingliz, rus, qoraqalpoq (kaa), qozoq (kk), qirg'iz (ky) — `hreflang` alternate teglar va JSON-LD `inLanguage` massivi orqali tasdiqlangan. Bundan tashqari, KONTENT tili (generatsiya tili) forma darajasida yanada kengroq — ko'p vositada **18 til** ro'yxati ko'rinadi (uz/kaa/kk/ky/tg/tk/ru/en + "Ko'proq (+10)" — jami taxminan 18), bu bizning `SOURCE_LANGUAGES` bilan miqyosi yaqin bo'lishi mumkin (aniq son solishtirish uchun ikkala ro'yxatni to'liq ochish kerak — ularning "+10" ro'yxati JS orqali kengayadi, statik holatda yopiq).
- **Brend-domen strategiyasi:** `slaydtop.uz` va `sodda.ai` bitta mahsulot — OG-teglar, logo, JSON-LD hammasi `sodda.ai`ga ishora qiladi, lekin `slaydtop.uz` domeni O'zbekiston bozori uchun mahalliylashtirilgan (uz interfeys default, `.uz` domen ishonchi). **Taxmin:** bu SEO/lokal-ishonch strategiyasi — bizda bitta domen (`slaydx`), ular ikki-domenli brend arxitekturasidan foydalanadi.
- **Yuridik shaxs:** "GLOWLEDGE" MChJ, STIR 311732530, manzil Toshkent (Ширин МФЙ, 26-mavze, 24-uy), tel +998 91 965 24 29, email (oferta/payment-info sahifalarida ko'rsatilgan, lekin bu hisobotda alohida takrorlanmadi — sahifada aniq ko'rinadi).
- **Segmentatsiya signali:** kurs ishi formasida "Vazirlikni tanlang" (Oliy Ta'lim, Fan va Innovatsiyalar Vazirligi **YOKI** Maktabgacha va Maktab Ta'limi Vazirligi) — ular bitta "kurs ishi" vositasini ham OTM, ham maktab segmentiga moslashtirgan. Bizda bu ajratish yo'q (**imkoniyat**: agar maktab segmenti uchun kurs ishi so'rovlari kelayotgan bo'lsa, shu farqni qo'shish mumkin).
- **Login shart emasligi UX'i:** deyarli barcha vosita sahifalari **loginsiz** ochiladi va formaning katta qismi (mavzu, til, hajm, dizayn) loginsiz to'ldirsa bo'ladi — "Yaratish" tugmasini bosgandagina login so'ralishi mumkin (FAQ shunday deydi). Bu bizning modelimizga o'xshash bo'lishi ehtimoli katta (**taxmin**, o'z tomonimiz shu vazifa doirasida qayta tekshirilmadi).

---

## Ochiq qolgan savollar (login bilan tekshirish kerak)

1. Balans to'ldirish/tarif sahifasi (paketlar, chegirmalar, minimal/maksimal summa) — URL topilmadi, login kerak bo'lishi mumkin.
2. Test, referat, mustaqil ish, texnologik xarita, glossariy, kalitlar, rezyume, tarjimon, krossvord, podkast, tabriknoma, AI rasm, slayd, pro-slayd — bu 14+ sahifada **aniq narx JS orqali yuklanadi**, statik curl buni ushlay olmadi (login emas, render usuli).
3. Maqolaning "8000 tanga" qaysi hajm pog'onasiga tegishli ekanligi aniq emas (default holat state'i noma'lum).
4. 18-til ro'yxatining to'liq tarkibi ("+10 ko'proq" tugmasi ortida) ochilmadi.
