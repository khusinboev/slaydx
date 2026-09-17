# R7 — TTS (matndan ovozga): provayder tanlovi va sinov rejasi

AUDIT-20 §1 shabloni bo'yicha. Har faktga URL berilgan; tekshirib
bo'lmagan joyda "aniqlanmadi" deb ochiq qoldirilgan.

**Muhim topilma (halollik uchun):** 2026-09-16 holatiga ko'ra **Google
Cloud TTS'da ham, Azure'ning rasmiy til-jadvalida ham, ElevenLabs'da
ham, Gemini TTS rasmiy til ro'yxatida ham, Yandex SpeechKit'da ham
o'zbekcha (`uz-UZ`) ovoz rasmiy hujjatda ro'yxatga OLINMAGAN** — faqat
**Azure'ning o'ziga (2021-yilgi 49-til kengaytmasi e'loni) qo'shilgan
`uz-UZ-MadinaNeural`/`SardorNeural`** va **mahalliy o'zbek provayderlar
(Aisha AI/Navoiy TTS, Muxlisa AI)** o'zbek tilini rasman qo'llab-quvvatlaydi.
Bu AUDIT-20 §1 R7 qatoridagi taxminni ("Google Cloud TTS uz-UZ, Azure
uz-UZ, ElevenLabs multilingual") qisman rad etadi — Google/ElevenLabs
hozircha **uz-UZ bermaydi**, faqat Azure va mahalliy provayderlar beradi.

## 1. Provayderlar taqqoslash jadvali

| Provayder | O'zbek ovoz (rasmiy) | Narx/1M belgi | ≈Narx/daqiqa (950 b/daq) | Chegara (so'rov) | MP3 | SDK (Node) | Litsenziya |
|---|---|---|---|---|---|---|---|
| **Azure AI Speech** | **HA** — `uz-UZ-MadinaNeural` (ayol), `uz-UZ-SardorNeural` (erkak), Neural | $16 (aggregator, rasmiy sahifada narx WebFetch orqali o'qib bo'lmadi — [azure.microsoft.com/pricing/.../speech-services](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/), F0 bepul 0.5M belgi/oy) | ≈$0.015 | Real vaqt: ~10 daq audio kesim; SSML/turn ≤64 KB ([learn.microsoft.com/.../speech-services-quotas-and-limits](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits)) | ha (audio-outputformat) | `microsoft-cognitiveservices-speech-sdk` yoki oddiy REST | tijorat OK |
| **Google Cloud TTS** | **YO'Q** — rasmiy `uz-UZ` topilmadi (2 marta tekshirildi: [list-voices-and-types](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types)) | Standard/WaveNet $4, Neural2/Polyglot $16, Chirp3-HD $30, Studio $160 ([costbench.com/.../google-tts-api](https://costbench.com/software/voice-apis/google-tts-api/), [texttolab.com/.../google-cloud-tts-pricing](https://texttolab.com/blog/google-cloud-tts-pricing)) | mavjud bo'lsa ≈$0.004–0.015 | **5000 bayt/so'rov, qat'iy, oshirib bo'lmaydi** ([cloud.google.com/text-to-speech/quotas](https://cloud.google.com/text-to-speech/quotas)) | ha | `@google-cloud/text-to-speech` | uz yo'qligi sabab **hozircha ishlatib bo'lmaydi** |
| **ElevenLabs** | **YO'Q** (rasmiy) — Multilingual v2 29 til, Flash/Turbo v2.5 32 til, v3 "70+" — uzbekcha hech birida ro'yxatda ko'rinmadi ([elevenlabs.io/languages](https://elevenlabs.io/languages)) | Pro $99/600k belgi ≈$0.165/1000 belgi | ≈$0.157 (agar ishlasa) | so'rov/kredit chegarasi tarifga bog'liq | ha | `elevenlabs` (npm) | tijorat OK, lekin uz yo'q |
| **Gemini TTS** (`gemini-2.5-flash-preview-tts` / yangi `3.1-flash-tts-preview`) | Rasmiy til ro'yxatida **yo'q** (90+ til sanalgan, o'zbek yo'q — [ai.google.dev/gemini-api/docs/speech-generation](https://ai.google.dev/gemini-api/docs/speech-generation)); LLM-asosli bo'lgani uchun **amalda sinash mumkin** (bizda `GEMINI_API_KEY` bor — qo'shimcha xarajatsiz sinov) | $0.50/1M kirish token + $10/1M audio-chiqish token ([invideo.io/blog/gemini-tts-ai-voice](https://invideo.io/blog/gemini-tts-ai-voice/)) | ≈$0.01–0.02 (**taxminiy** — token/soniya nisbati aniq hujjatlashtirilmagan) | 32k token kontekst oynasi | ha (PCM→MP3 o'zimiz) | `@google/genai` (mavjud Gemini SDK) | preview — SLA yo'q |
| **OpenAI tts-1 / tts-1-hd / gpt-4o-mini-tts** | Rasmiy til ro'yxati Whisper asosida, **o'zbek sanalmagan**; "ovozlar asosan inglizcha uchun optimallashtirilgan" ([developers.openai.com/.../text-to-speech](https://developers.openai.com/api/docs/guides/text-to-speech)) | tts-1 $15/1M, tts-1-hd $30/1M, mini-tts $0.6/1M kirish + $12/1M audio-chiqish ([texttolab.com/blog/openai-tts-pricing](https://texttolab.com/blog/openai-tts-pricing)) | ≈$0.014–0.03 | aniqlanmadi | ha | `openai` (npm) | tijorat OK, sifat noaniq |
| **Yandex SpeechKit** | Rasmiy `uz-UZ` topilmadi (rasmiy hujjatlarda ru/en/tr va boshqa CIS tillari ko'proq ta'kidlangan); AUDIT-20 rejadagi taxmin **tasdiqlanmadi** | belgi-asosli (v1) yoki so'rov-asosli (v3) ([aistudio.yandex.ru/docs/en/speechkit/pricing](https://aistudio.yandex.ru/docs/en/speechkit/pricing.html)) | aniqlanmadi | aniqlanmadi | ha | REST | RU-hisob, xalqaro karta/hudud cheklovi ehtimoli — tekshirish kerak |
| **Aisha AI / Navoiy TTS** (`aisha.group`, ochiq manba baza `Navoiy TTS` = CosyVoice2-0.5B) | **HA, mahalliy o'zbek uchun махсус o'qitilgan** — "Gulnoza" modeli, mood (Neutral/Cheerful/Happy/Sad), tezlik 0.5–2.0 ([aisha.group/en/tts-uzbek](https://aisha.group/en/tts-uzbek), [aisha.group/en/blog/navoiy-tts-open-source-uzbek-text-to-speech](https://aisha.group/en/blog/navoiy-tts-open-source-uzbek-text-to-speech)) | **1 so'm/belgi** (pay-as-you-go, "Starter") — o'zbek so'mida, aniq narx sahifasidan ([aisha.group/en/pricing](https://aisha.group/en/pricing)) | ≈950 so'm/daq | **1000 belgi/so'rov (API kalit bilan), 500 (kalitsiz)** — eng qattiq chegara ([aisha.group/en/api-documentation/text-to-speech](https://aisha.group/en/api-documentation/text-to-speech)) | **YO'Q — chiqish WAV** (mono 16-bit 16 kHz) — MP3'ga o'zimiz aylantirishimiz kerak | oddiy REST (`X-Api-Key`, `back.aisha.group/api/v1/tts/post/`) | narx sahifasida aniq shart yo'q — biznes/tijorat foydalanish uchun "Business" tarifga murojaat tavsiya etilgan |
| **Muxlisa AI** (`muxlisa.uz`) | E'lon qilingan, lekin so'nggi jamoat e'lonlari asosan **STT**ga (nutqni matnga) urg'u beradi; ochiq TTS API/narx sahifasi **topilmadi** | aniqlanmadi (kontakt asosida) | aniqlanmadi | aniqlanmadi | aniqlanmadi | aniqlanmadi | aniqlanmadi — korxona bilan bog'lanish talab qilinishi mumkin |

**Bloklovchi cheklovlar:** Aisha 1000 belgi/so'rov (eng qattiq — bo'laklash
chegarasi shunga moslashtirilishi kerak, 4500 emas); Google 5000 bayt/so'rov
(lekin uz yo'q); Azure SSML/turn 64 KB (yetarli keng).

**MP3 kodlash kutubxonasi — litsenziya tuzatildi (WP-A2):** WAV chiqadigan
provayderlar (Aisha, Gemini) uchun tanlangan `@breezystack/lamejs` (sof
JavaScript LAME porti, §6 ochiq savoli 6) ning litsenziyasi **LGPL-3.0**
(paketning o'z `package.json`i tasdiqlaydi) — **MIT EMAS**. LGPL-3.0
majburiyati kutubxona O'ZGARTIRILIB qayta TARQATILGANDA yuzaga keladi;
bizda u faqat SERVER (worker) ichida, o'zgartirilmasdan, `npm` paketi
sifatida ishlatiladi va foydalanuvchiga alohida tarqatilmaydi — shuning
uchun LGPL majburiyati (manba kodini ochish/relink imkonini berish)
kelib chiqmaydi. MP3 formatining o'zi ham 2017-yildan beri patentsiz
(Fraunhofer/Technicolor litsenziyasi 2017-yil aprelda tugagan).

## 2. Raqobatchi va NotebookLM formati

**sodda.ai** (`docs/research/slaydtop-b-oyinlar-1.md`,
`slaydtop-c-oyinlar-media.md`): podkast/tabriknoma/tinglash o'yinida
**ovoz TANLASH imkoniyati YO'Q** — faqat matn tili tanlanadi (8 til +
«Ko'proq (+10)» = 18), ovoz avtomatik server tomonida. Audio fayllar
DigitalOcean Spaces'da saqlanadi, TTS provayderi CSP orqali
aniqlanmaydi (server-side chaqiriladi). Narx tekis: podkast/tabriknoma
4000, tinglash o'yini 2000 — bizning PM qarori (AUDIT-20 §1, band 6)
bilan bir xil. **Xulosa: biz ham ovoz tanlovini foydalanuvchiga
chiqarmasak ham bo'ladi** — til → standart ovoz jadvali orqali avtomatik
tanlansin (raqobatchi naqshi bilan mos, forma soddaligini saqlaydi).

**NotebookLM Audio Overview** (Google, 2024+): manba matn + suhbat
shablon promptidan LLM **ikki boshlovchili dialog** yozadi, har qatorni
**alohida ovozga** TTS orqali o'giradi, keyin qisqa pauzalar bilan
**MP3'ga tikadi**; 10–20 daqiqalik format ([blog.google/technology/ai/notebooklm-audio-overviews](https://blog.google/technology/ai/notebooklm-audio-overviews/), [ruzuku.com/.../notebooklm-audio-overview](https://www.ruzuku.com/learn/tools/ai/notebooklm-audio-overview)). Bu aynan
bizning `AcademicDoc.audio = {script[{speaker,text}], seconds, voice}`
arxitekturasi bilan mos — **1-2 ovozli ssenariy → har qator alohida
TTS chaqiruvi → bo'laklarni MP3 sifatida birlashtirish** naqshini
tasdiqlaydi. Farq: NotebookLM 10-20 daqiqa, bizning podkast 1-5 daqiqa
(qisqaroq, kamroq TTS chaqiruvi — arzonroq).

## 3. Bizga tavsiya

**Zanjir tartibi** (`llm/chain.ts` naqshi, AUDIT-22 §4 dizayni bilan mos):

1. **Azure** (`uz-UZ-SardorNeural`/`MadinaNeural`) — birinchi, chunki
   yagona xalqaro provayder rasmiy o'zbek Neural ovozga ega, MP3 to'g'ridan-
   to'g'ri chiqadi, narx o'rtacha ($16/1M).
2. **Aisha AI (Navoiy TTS)** — zaxira/qiyoslash uchun, chunki mahsus
   o'zbek uchun o'qitilgan (talaffuz sifati yaxshiroq bo'lishi mumkin),
   lekin WAV chiqishi (MP3'ga konvertatsiya kerak) va 1000 belgi/so'rov
   chegarasi bor.
3. **Gemini TTS** — bepul/arzon sinov uchun uchinchi zveno (bizda
   `GEMINI_API_KEY` bor, qo'shimcha kalit sotib olmasdan sinash mumkin),
   lekin o'zbek rasmiy ro'yxatda yo'q — **sifat noma'lum, lab sinovi
   hal qiladi**.
4. Boshqa 17 til (ru/en/kk/ky/tg/tk/kaa, arab/nemis/...) uchun — Azure/
   Google/ElevenLabs barchasi keng qamrovga ega (ru/en/kk/tg/ar/de barcha
   uchta providerda odatda bor); **faqat kaa (qoraqalpoq) va ky
   (qirg'iz) alohida tekshirish talab qiladi** — vaqt yetmadi, ochiq
   savol (§6).

**`TTS_VOICE` zanjir sxemasi** (AUDIT-22 §4 taklifiga mos):
```
TTS_VOICE_UZ=azure:uz-UZ-SardorNeural,aisha:gulnoza,gemini:kore
TTS_VOICE_RU=azure:ru-RU-DmitryNeural,elevenlabs:...
```
til kodi bo'yicha alohida zanjir (`chain.ts` "rol" o'rniga "til" bilan
parametrlangan), kalitsiz provayder o'tkazib yuboriladi (mavjud
`completeWithChain` naqshi to'g'ridan-to'g'ri qayta ishlatiladi — faqat
`KEY_ENV` ga `AZURE_SPEECH_KEY`, `AISHA_API_KEY` qo'shiladi, `GEMINI_API_KEY`
mavjud).

**Adapter interfeysi:** `synthesize(text, {lang, voice, speed?}) =>
Promise<{mp3: Uint8Array; seconds: number; chars: number} | {error, retryable}>`.
Aisha/PCM chiquvchi provayderlar uchun WAV→MP3 konvertatsiya qatlami
shart (`tts/mp3.ts`): worker'da `ffmpeg` YO'Q (Dockerfile'da faqat
LibreOffice/poppler bor) — `apk add ffmpeg` (+~30-50 MB rasm) yoki
sof-JS/WASM MP3 enkoder tanlovi §6 ga qoldi.

**Matn bo'laklash chegarasi:** eng qattiq provayder (Aisha, 1000 belgi)
ga moslab **≤900 belgi/bo'lak** (xavfsizlik zaxirasi bilan) — barcha
provayderlar uchun universal, Azure/Gemini kabi kengroq chegarali
provayderlarda ortiqcha so'rov ozgina xarajat oshiradi, lekin kod
soddaligi ustunroq.

**MP3 birlashtirish:** bitrate/format provayderlar orasida bir xil
emas (Azure CBR MP3, Aisha WAV) — CBR frame konkatenatsiya faqat
BITTA provayder ichida ishonchli; aralash ovoz (masalan Azure + Aisha
bir podkastda) holatida **`ffmpeg` yoki WASM MP3 enkoder shart**.

**`TtsMeter`:** `llm-roles.ts CostMeter` naqshiga o'xshash — har
`synthesize` chaqiruvidan keyin `{provider, voice, chars, seconds,
costUsd}` yig'iladi → `cost_json` ga qo'shiladi, `cost-report`da
podkast/tabriknoma marja tekshiriladi.

**Til → ovoz jadvali (18 til, boshlang'ich taklif):**

| Til | Provayder:ovoz | Manba |
|---|---|---|
| uz | azure:uz-UZ-SardorNeural / MadinaNeural | yuqoridagi jadval |
| ru | azure:ru-RU-DmitryNeural | keng qamrov, standart Azure ro'yxati |
| en | azure:en-US-JennyNeural yoki gemini:kore | standart |
| kk | azure:kk-KZ (mavjudligi yuqori ehtimol, aniq ovoz nomi tekshirilmadi) | aniqlanmadi — R7 hajmidan tashqarida qoldi |
| ky, tg, tk, kaa | **aniqlanmadi** — alohida tekshirish kerak (§6) | — |
| ar, de va qolgan ~10 til | Azure/Google keng qamrovga ega (Neural ovozlar bor, aniq nomlar tekshirilmagan) | — |

## 4. Sinov rejasi

**`scripts/tts-lab.mts` spetsifikatsiyasi:**

- Kirish: bitta qattiq kodlangan ~60 soniyalik o'zbek namunasi (ʻ/‘
  belgilar bilan): «Assalomu alaykum va SlaydX podkastiga xush
  kelibsiz! Bugun biz o'quvchilarning eng ko'p so'raydigan savoli —
  "sun'iy intellekt yordamida qanday qilib o'z dars materialini
  tayyorlash mumkin" — haqida gaplashamiz. Va albatta, tug'ilgan
  kuningiz bilan — omad va ilhom hamrohingiz bo'lsin!»
- 3–4 provayder: Azure, Aisha, Gemini TTS, (agar egasi kalit bersa)
  ElevenLabs — parallel chaqiriladi.
- Har biri `scratch/tts/<provider>.mp3` ga yoziladi (Aisha WAV bo'lsa
  ham skript darhol MP3'ga aylantiradi, taqqoslash bir xil formatda
  bo'lishi uchun).
- Natija jadvali (skript konsolga chiqaradi + `scratch/tts/report.json`):
  `provider | soniya | belgi soni | so'rov narxi (hisoblangan) | latensiya (ms)`.
- Ishga tushirish: `npm run heavy -- tsx scripts/tts-lab.mts` (`heavy.sh`
  qulfi ostida, chunki tarmoq I/O va bir nechta parallel so'rov).

**Egasi qanday baholaydi (5 mezon, eshitib):**
1. Talaffuz to'g'riligi (o'zbek fonetikasi — ʻ/ʼ tovushlar, lotin harflar).
2. Tabiiylik/intonatsiya (robotga o'xshamasligi).
3. Tezlik/pauza mosligi (matn uzunligiga nisbatan audio davomiyligi).
4. Ovoz yoqimliligi (jins/ohang — Madina/Sardor/Gulnoza orasidan tanlov).
5. Narx/sifat nisbati (jadval №1 asosida).

**Qaysi kalitlar kerak (aniq ro'yxat + olish yo'li):**

| Kalit | Olish yo'li (5 qadam) |
|---|---|
| `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` | 1) portal.azure.com da hisob 2) "Create a resource" → "Speech" 3) F0 (bepul) yoki S0 pastki reja tanlash 4) "Keys and Endpoint" bo'limidan KEY1 va Region nusxalash 5) `.env` ga qo'yish |
| `AISHA_API_KEY` | 1) voicelab.uz/app da ro'yxatdan o'tish 2) hisobga UZS balans to'ldirish (pay-as-you-go) 3) profil/API bo'limidan kalit yaratish 4) `X-Api-Key` sifatida saqlash 5) test so'rovi bilan tekshirish |
| `GEMINI_API_KEY` | **allaqachon bor** — qo'shimcha qadam yo'q |
| `ELEVENLABS_API_KEY` (ixtiyoriy, uz yo'q, boshqa 17 til uchun) | 1) elevenlabs.io da hisob 2) Free/Starter reja 3) profil → API keys 4) kalit yaratish 5) `.env` ga qo'yish |

## 5. Xavflar

- **X-1**: o'zbek ovoz sifati past bo'lishi mumkin (barcha xalqaro
  provayderlarda kam o'qitilgan til) — faqat sinov (§4) hal qiladi,
  hujjat/marketing da'vosiga ishonib bo'lmaydi.
- **X-2**: Aisha/Muxlisa kabi mahalliy provayderlarning **tijorat
  litsenziyasi/SLA aniq emas** — "Business" tarifga alohida murojaat
  kerak, hozirgi "Starter" pay-as-you-go tijorat mahsulotda ishlatishga
  yaroqliligi tasdiqlanmagan.
- **X-3**: Aisha WAV chiqishi + 1000 belgi/so'rov — ko'p kichik so'rov
  + WAV→MP3 konvertatsiya qatlami qo'shimcha ishlab chiqish va worker
  image hajmini oshiradi (ffmpeg yoki WASM enkoder).
- **X-4**: Gemini TTS **preview** bosqichida (SLA yo'q, narx/chegara
  o'zgarishi mumkin) — production uchun asosiy zanjir emas, faqat
  zaxira/sinov zvenosi sifatida ishlatilsin.
- **X-5**: kk/ky/tg/tk/kaa uchun rasmiy ovoz mavjudligi bu hisobotda
  **tekshirilmadi** (vaqt yetmadi) — 18 tilni to'liq qamrash uchun
  qo'shimcha kichik tadqiqot kerak, aks holda ba'zi tillarda TTS
  zanjiri butunlay bo'sh qaytishi mumkin.
- **X-6**: Yandex SpeechKit rejadagi taxmin ("uz-UZ bor") rasmiy
  manbada tasdiqlanmadi — zanjirga kiritilmasin, agar egasi alohida
  dalil topsa qayta ko'rib chiqiladi.

## 6. Ochiq savollar / egasidan kerak narsalar

1. Azure'ni birinchi zveno qilishga roziligmi (yagona xalqaro rasmiy
   `uz-UZ` provayder), yoki mahalliy Aisha'ni ustun qo'yish kerakmi
   (o'zbekcha uchun maxsus o'qitilgan, lekin litsenziya/SLA noaniq)?
2. Aisha/Muxlisa bilan tijorat foydalanish uchun rasman bog'lanish va
   narx/shartlarni aniqlashtirish kerak — kim (egasi yoki agent)
   bog'lanadi?
3. `AZURE_SPEECH_KEY`, `AISHA_API_KEY` (va ixtiyoriy `ELEVENLABS_API_KEY`)
   — egasidan qachon olamiz? Sinov (`tts-lab.mts`) shu kalitlarsiz
   ishga tushmaydi.
4. Gemini TTS preview modelini production zanjiriga qo'shishga
   roziligmi (SLA yo'q xavfi bilan), yoki faqat ichki sinov/qiyoslash
   uchun qoldiramizmi?
5. kk/ky/tg/tk/kaa uchun alohida qisqa tadqiqot (R7 davomida yoki
   alohida) buyurtma qilinsinmi — hozir ochiq qoldi.
6. WAV→MP3 konvertatsiya yechimi: `ffmpeg` (Dockerfile'ga qo'shish,
   rasm hajmi oshadi) yoki sof-JS/WASM enkoder — qaysi yo'nalishda
   davom etamiz (WP-A dizayn qarori, lekin egasi byudjet/murakkablik
   nuqtai nazaridan fikr bildirishi foydali)?
