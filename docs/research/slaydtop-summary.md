# slaydtop.uz (sodda.ai) — bizda yo'q xizmatlar: jamlama va tavsiya (2026-09-16)

Manbalar: `slaydtop-public.md` (loginsiz), `slaydtop-a-test-atestatsiya-infografika.md`, `slaydtop-b-oyinlar-1.md`, `slaydtop-c-oyinlar-media.md` (login sessiyasi bilan, 3 agent parallel). Narxlar — tanga (1 so'm = 1 tanga).

## 1. Bizda yo'q 9 xizmat

| # | Xizmat | Nima qiladi | Parametrlar (raqobatchida) | Narx | Chiqish | Bizga sig'ishi |
|---|---|---|---|---|---|---|
| 1 | **Test yaratuvchi** | Mavzu/fayl/darslik asosida test | 4 rejim: mavzu · fayl (PDF/DOCX/PPTX/TXT) · maktab darsligi (fan→sinf→mavzu, 0/5 tanlov, 🎲) · tayyor testni yuklash (savollar banki → interaktiv); savol soni, qiyinlik, OMR varaq, format; 18 til | 3 000 tekis (import — fayl hajmiga qarab) | DOCX/PDF + interaktiv | **Oson**: `academic` DOCX quvuri + javoblar kaliti; darslik rejimi uchun o'quv dasturi bazasi kerak |
| 2 | **Atestatsiya** | O'qituvchi attestatsiyasiga amaliy test | Fan→sinf→mavzu (test bilan bir xil darslik bazasi); «Mavjud testdan» (1 000), «Yangi test tuzish» (narx noma'lum), «Tasodifiy» | 1 000+ (UI da ko'rsatilmaydi) | Interaktiv test | **Qiyin**: haqiqiy attestatsiya savollar bazasi/o'quv dasturi kerak |
| 3 | **Infografika** | Mavzu bo'yicha vizual infografika | Mavzu, til (18), ixtiyoriy tavsif | 2 000 tekis | PNG (taxmin) | **Oson**: `image`/pro-slide rasm dvigatelimiz + LLM sxema (figures/) |
| 4 | **Krossvord** | Mavzu/fayl asosida krossvord | 2 rejim (mavzu/fayl); so'z soni 5/10/15/20; til (18); fayl rejimida format PPTX/DOCX/PDF; profildan F.I.Sh./kurs/guruh | 2 000 tekis | Fayl rejimi — hujjat; mavzu rejimi — interaktiv (taxmin) | **Oson** (bosma DOCX/PDF: to'r + savollar + javob), interaktiv — keyin |
| 5 | **Flesh kartalar** | O'rganish kartalari | Mavzu, karta soni 5/10/15/20, til (18) | 2 000 tekis | Interaktiv (+ bosma?) | **Oson** (bosma karta DOCX/PDF), interaktiv — keyin |
| 6 | **Tinglash o'yini** | Til o'rganish audio o'yini | Ona tili × o'rganiladigan til (18×18), mavzu, soni | 2 000 tekis | Interaktiv web + audio | **O'rta-qiyin**: TTS + o'yin runtime |
| 7 | **Saralash o'yini** | Toifalarga saralash (to'plar) | Mavzu, til (18), to'p soni 2…20 (standart 10) | 2 000 tekis | Interaktiv web | **O'rta**: o'yin runtime (web), matn LLM dan |
| 8 | **Podkast** | AI ovozli podkast | 3 rejim (mavzu/matn/fayl, `/topic /text /file`), til (18), davomiylik 1–5 daq, fayl rejimida manba havolasi; ovoz TANLANMAYDI | 4 000 tekis | MP3 (taxmin) | **O'rta**: TTS (o'zbek ovozi sifati hal qiluvchi) |
| 9 | **Tabriknoma** | Ovozli tabrik | Kimga (majburiy), kim bo'ladi/sabab, til (18), davomiylik 1–4 daq | 4 000 tekis | MP3 (taxmin) | **Oson** (podkast bilan bitta TTS quvuri) |

Umumiy naqsh: hamma yangi xizmat **tekis narx**, parametrlar narxga ta'sir qilmaydi; til tanlovi 8 + «Ko'proq (+10)» = 18; ovoz tanlovi yo'q; TTS provayderi ko'rinmaydi (server tomonida, DigitalOcean Spaces).

## 2. Xizmatlardan tashqari topilmalar

- **Obuna qatlami** (`/uz/purchase`): 1:1 to'ldirish + 3 oylik reja (29 000 / 99 000 / 199 000 so'm, 10/20/30 % bonus, alohida «kvota» havzasi). Bizda faqat prepaid balans.
- **Profil «Titul sahifasi»** — 10 maydon bir marta to'ldiriladi, barcha hujjatlarda avtomatik. Bizda muallif profili (AUDIT-12) qisman; WorkComposer titulini shu bilan bog'lash — kichik ish.
- **Darslik/o'quv dasturi bazasi** (fan→sinf→mavzu) — test, atestatsiya (va ehtimol dars rejasi) uchun. Bizda yo'q; strategik aktiv.
- Narx farqlari: dars rejasi ularda 12 000 (bizda 4 000); «tezis» ularda diplom ishi (bizda konferensiya tezisi); kurs ishida OTM/maktab vazirligi segmenti (bizda AUDIT-19 da vazirlik tanlovi bor).
- Texnika: Next.js + Cloudflare + Sentry, 6 interfeys tili, rasm: Unsplash/Pixabay/Pexels + DALL·E (taxmin).

## 3. Tavsiya (PM taklifi — muhokama uchun)

| Ustuvorlik | Xizmat | Sabab | Taxminiy hajm |
|---|---|---|---|
| 1 | **Test yaratuvchi** (mavzu + fayl rejimlari, DOCX/PDF + javoblar kaliti, keyin interaktiv) | O'qituvchilar uchun eng talabgir; mavjud hujjat quvurimizga to'g'ri tushadi; 3 000 narx | 1 sprint |
| 2 | **Krossvord + Flesh kartalar** (bosma DOCX/PDF) | Bitta «o'yin-hujjat» dvigateli, LLM + maket; 2 000 × 2 xizmat | 1 sprint (birga) |
| 3 | **Infografika** | Rasm dvigatelimiz bor; LLM sxema (figures/) + rasm; 2 000 | 0.5 sprint |
| 4 | **Podkast + Tabriknoma** | Bitta TTS quvuri (Google Cloud TTS `uz-UZ` / Azure `uz-UZ` / ElevenLabs — o'zbek sifatini sinash shart); 4 000 × 2 | 1 sprint + provayder sinovi |
| 5 | **Saralash + Tinglash o'yinlari** | Yangi interaktiv runtime (o'yinchi havolasi/QR, natijalar) — yangi mahsulot yuzasi | 1.5–2 sprint |
| 6 | **Atestatsiya** | Haqiqiy savollar/o'quv dasturi bazasisiz qiymati past; avval darslik bazasi | keyinroq |
| + | Obuna rejalari, profil tituli, darslik bazasi | Monetizatsiya va umumiy poydevor | alohida qaror |

Qo'shmaslik mumkin bo'lganlar: atestatsiya (baza yo'q), tinglash o'yini (TTS + runtime, tor auditoriya) — bozor signalisiz kechiktirish.

## 4. Ochiq savollar / cheklovlar

- O'yinlarning o'yinchi tomoni (havola/QR, natijalar, o'qituvchi kabineti) ko'rilmadi — hisobda namuna yo'q, yaratish taqiqlangan edi.
- Podkast/tabriknoma chiqish formati (MP3) va ovoz sifati eshitilmadi.
- Hodisa: A agenti «Atestatsiya → Mavjud testdan» qatorini bosganda darhol generatsiya bo'lib **1 000 tanga** yechildi (narx oldindan ko'rsatilmagan navigatsiya-ko'rinishli qator). Boshqa xarajat yo'q.
