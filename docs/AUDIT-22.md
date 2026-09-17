# AUDIT-22 — TTS (podkast, tabriknoma, tinglash o'yini) + interaktiv runtime (saralash o'yini; test/krossvord/flesh karta 2-bosqichi)

Umumiy dastur va egasi qarorlari: `docs/AUDIT-20.md` §1. Tadqiqot: `docs/research/{tts,podcast,greeting,listening-game,sorting-game}.md`.

## 1. Reja (AUDIT-20 §1 dan, 2026-09-17)

### 3-dastur (AUDIT-22) — TTS + interaktiv runtime

- **TTS adapteri** `lib/generation/tts/{types,google,azure,elevenlabs,chain}.ts` (`llm/chain.ts` naqshi: `TTS_VOICE=provider:voice,…` zanjir, `synthesize(text,{lang,voice,speed}) → {mp3, seconds, chars}`, `TtsMeter` → `cost_json`, `env.ts` kalitlari, `compose-env` qulfi); uzun matn 4 500 belgili bo'laklar; MP3 birlashtirish — CBR frame konkatenatsiya (`tts/mp3.ts`), aks holda `ffmpeg` (tadqiqotdan keyin).
- **Vositalar** (Media, 4 000): `podcast` (mavzu/matn/fayl, 1–5 daq, ssenariy → 1–2 ovoz → MP3), `greeting` (kimga/sabab/til/1–4 daq); `ToolConfig.output`/`Generation.format` += `mp3`, `ViewerKind "audio"` → `AudioViewer.tsx` (`<audio src=…/file?inline=1>` + transkript), model `AcademicDoc.audio = {script[{speaker,text}], seconds, voice}`, `delivered` soniya.
- **Interaktiv runtime**: `021_games.sql` — `game_sessions(id, generation_id, user_id, token unique, kind, settings_json, expires_at)` + `game_results(id, session_id, player_name, score, total, answers_json, seconds, ip_hash)`; ochiq `app/o/[token]/page.tsx` (noindex) + `app/api/o/[token]` (GET — `publicGameView(doc)`: to'g'ri javob CHIQMAYDI; `submit` POST `checkOrigin` + `rateLimit` 30/daq, ball serverda); egasi `POST /api/generations/[id]/share`, `results` (jadval + CSV), `ResultView` «O'yin havolasi + QR» (`qrcode` npm, SVG); `components/game/{Player,Sorting,Listening,Quiz,Crossword,Cards}.tsx` + `lib/game/engine.ts` (sof holat mashinasi, jsdom testlari). Saralash (`sorting`, 2 000): `game.sorting = {categories[2–20]{name, items[]}}`, bosma versiya jadval. Tinglash (`listening`, 2 000): so'z/ibora → TTS parchalar (`putAssetBytes`), o'yinchi variant tanlaydi.
- WP (≈9–10 kun): R0 lead — TTS lab/egasi tanlovi, migratsiya, `mp3`, `ToolGroup "media"` (1); WP-A opus — `tts/**` + podcast/greeting + `AudioViewer` (2.5); WP-B opus — sessions/results + ochiq API + `publicGameView` (javob sizmasligi — mutatsiya majburiy) (2); WP-C sonnet — o'yinchi UI 5 tur + `lib/game/engine.ts` (2.5); WP-D sonnet — saralash/tinglash dvigateli + bosma (1.5); R lead — QR/natijalar paneli, jonli, smoke (havola → ism → o'yin → natija egasida), deploy (1.5).


### Aniqlashtirishlar (tadqiqotdan)
- **TTS** (`tts.md`): o'zbek ovozi faqat **Azure** (`uz-UZ-MadinaNeural`/`SardorNeural`) va mahalliy **Aisha AI** (1 so'm/belgi, WAV, ≤1 000 belgi/so'rov); Google/ElevenLabs/Gemini TTS da yo'q; zanjir Azure → Aisha → Gemini (bepul sinov); bo'laklash ≤900 belgi; MP3 birlashtirish bitta provayder ichida CBR-xavfsiz, aralash/WAV → ffmpeg (worker Dockerfile) yoki WASM; `TtsMeter` → `cost_json`; kalitlar: `AZURE_SPEECH_KEY`+`AZURE_SPEECH_REGION`, `AISHA_API_KEY` (egasidan), `GEMINI_API_KEY` bor. **TTS lab** (`scripts/tts-lab.mts`) kalitlar kelgach.
- **Podkast/tabriknoma** (`podcast.md`, `greeting.md`): ssenariy intro/3 blok/outro, 150 so'z/daq ishchi qiymat; tabriknoma janrlari; ovoz tanlanmaydi (til → ovoz jadvali); fon musiqasi yo'q (litsenziya); narx 4 000 tekis.
- **Saralash** (`sorting-game.md`): `categoryCount` 2–6 × `itemsPerCategory` 3–8; ball = to'g'ri/jami, leaderboard yo'q; bosma jadval versiyasi. **Tinglash** (`listening-game.md`): so'z/ibora → 3–4 variant, ona til × o'rganiladigan til; TTS parchalar aktivga. Narx 2 000 tekis.
- **Runtime**: `021_games.sql` (`game_sessions`, `game_results`), ochiq `app/o/[token]` (noindex) + `app/api/o/[token]` (`publicGameView` — javob sizmaydi; `submit` rate-limit, ball serverda), egasi `share`/`results` (CSV), QR (`qrcode` npm), `components/game/*` + `lib/game/engine.ts`; test/krossvord/flesh karta interaktiv 2-bosqichi shu runtime orqali.
- Tartib: **R0** substrat (migratsiya, `ToolGroup media`, 4 vosita, `output mp3`, `ViewerKind audio`, runtime jadvallari/route skeleti) → **WP-B** runtime server + ochiq API (kalitsiz) → **WP-C** o'yinchi UI → **WP-D** saralash dvigateli + bosma → **WP-A** TTS adapterlari + podkast/tabriknoma/tinglash (kalitlar kelgach; kalitsiz — adapter interfeysi + mock testlar) → R jonli/smoke/deploy.

## 5. Bajarilish yozuvi


### R0 — Substrat (lead, 2026-09-17) ✅

WP-A/WP-B/WP-C/WP-D tayanadigan SHARTNOMA. Dvigatellar STUB (`null`) —
vosita, narx, byudjet, ko'ruvchi, forma va RUNTIME ular yozilguncha
ulanadi (AUDIT-20/21 R0 da ishlagan naqsh). TTS kalitlari YO'Q, shuning
uchun provayder chaqiruvi ATAYLAB yozilmadi — faqat interfeys va jadval.

**Tiplar/reyestr**

- `lib/generation/audio/types.ts` — `AudioKind = "podcast"|"greeting"`,
  `AudioModel` = `AcademicDoc.audio` `{v, kind, type, language,
  script[{speaker, text}], seconds?, voice?, voiceB?, review?, polish?,
  userNeeds?}`. `speaker` — ROL belgisi («A»/«B»), ovoz NOMI emas:
  provayder/kalit almashganda eski hujjat mavjud bo'lmagan ovozga ishora
  qilardi. `seconds` — REJA emas, provayder o'lchagan uzunlik
  (`delivered` shundan). `AUDIO_LIMITS`: podkast 1–5 daq, tabriknoma
  1–4, 150 so'z/daq (±15 %), replika ≤900 belgi (TTS bo'lagi bilan AYNI
  son — replika hech qachon ikki so'rovga bo'linmasin).
- `audio/registry.ts` — podkast 3 tur (mavzu-tushuntirish / intervyu /
  savol-javob), tabriknoma 6 janr (**standart — `umumiy`**, so'ng ustoz
  kuni, tug'ilgan kun, bitiruv, 8-mart, Navro'z). Har turda `skeleton`
  (kirish/3 blok/yakun), `guidance` (en, «TYPE RULES»), `JudgeSpec` (5+5
  mezon), janrda tayyor `occasion` iborasi. `AUDIO_RULE_IDS` — hisobot
  qoidalari nomlari (`durationWords`, `lineLength`, `addresseeNamed`, …).
- `lib/generation/tts/types.ts` — `TtsProvider {id, configured(),
  synthesize(text, {lang, voice, speed}) → {mp3?|wav?, seconds, chars}}`.
  `mp3`/`wav` IKKALASI ixtiyoriy va aynan bittasi to'ladi: Azure MP3,
  Aisha WAV (`tts.md` §3) — yagona «bytes» maydoni formatni yo'qotib,
  birlashtiruvchi WAV ni MP3 kadri deb ulab yuborardi. `TTS_LANG_VOICES`
  — 18 til × ovoz (uz: `uz-UZ-MadinaNeural`/`SardorNeural` + `aisha`);
  **kaa/ky/tg/tk — `verified: false`** (rasmiy ovoz topilmadi, jadvalda
  eng yaqin til; hisobot foydalanuvchini ogohlantiradi). `chunkText(≤900)`
  jumla → so'z → qattiq kesish tartibida (matn yo'qolmaydi),
  `TtsMeter` belgi bo'yicha `cost_json` (`TTS_PRICES`: azure $16/1M,
  aisha ≈$80/1M, gemini 0).
- `games/types.ts` — `GameKind += "sorting"|"listening"`;
  `SortingModel {categories[{id, name, items[]}]}` (id — javob
  `answers_json` da NOM emas, ID bilan yozilsin),
  `ListeningModel {items[{id, text, options[], answer, audioAssetId?}],
  nativeLanguage, targetLanguage}` — **`answer` INDEKS**, matn emas:
  ochiq ko'rinish faqat maydonni tashlaydi, modelni qayta yozmaydi.
  Chegaralar: toifa 2–6 × element 3–8; tinglash 10/15/20 × 3–4 variant.
  `gamePromisedCount(kind, values)` — VA'DA qilingan hajm (saralashda
  toifa × element): byudjet, `delivered` va darvoza bitta manbadan.
- `games/registry.ts` — saralash 2 tur (`toifa`, `qarama-qarshi` — ikki
  qutb, toifa chipi AYNAN 2), tinglash 2 tur (`sozlar`, `iboralar`),
  har biriga 5 mezonli `JudgeSpec` va qoidalar ro'yxati. Saralashning
  hal qiluvchi qoidasi — `itemSingleCategory` (element ikki toifaga
  tushsa o'yin YECHILMAYDI), tinglashniki — `answerInRange`.

**Vositalar va ko'ruvchi**

- `ToolId += sorting|listening|podcast|greeting`, `ToolConfig.output +=
  "mp3"`, `Generation.format += "mp3"`, `ToolMode.id += "text"`.
- Narx TEKIS (egasi qarori 6): saralash/tinglash 2 000,
  podkast/tabriknoma 4 000 — `tests/pricing.test.mts` har parametr
  ustida mutatsiya bilan qulflaydi.
- Forma maydonlari reyestrdan: saralash (tur, toifa soni, element soni,
  til), tinglash (tur, **til JUFTLIGI** — `nativeLanguage`/
  `targetLanguage`, topshiriq soni; uchinchi «Til» maydoni ATAYLAB yo'q),
  podkast (3 rejim — mavzu/matn/fayl, tur, daqiqa, til), tabriknoma
  (**«Kimga?» majburiy**, munosabat, janr chipi, daqiqa, til). Ovoz
  TANLANMAYDI — u til jadvalidan olinadi.
- «Media» bo'limi endi vositali va `visibleToolGroups()` da ko'rinadi.
- `ViewerKind "audio"` → `components/viewers/AudioViewer.tsx`: pleer
  `/api/generations/{id}/file?inline=1` + transkript `doc.audio.script`
  («ko'rdim = oldim» audio varianti). Tahrir proplari ATAYLAB
  berilmaydi: transkriptni tahrirlash audio bilan ajralib ketardi.
- `file/route.ts` — audio uchun `Accept-Ranges: bytes`; `inline` esa
  PARAMETRGA bog'liq qoladi, aks holda «MP3 yuklab olish» tugmasi
  faylni tabda ochib yuborardi. `FilePreview` MP3 kartasi + `buildPreview`
  audio shoxi (transkriptning birinchi replikalari).
- Dvigatel shoxlari: `audio/engine.ts buildAudioArtifact` (STUB `null`,
  `BuiltFile` qaytaradi — `infographic` naqshi), `index.ts` audio shoxi
  («Audio yaratilmadi» + kredit qaytishi), `write-llm.ts` da audio
  ANIQ `null` (aks holda podkast so'ragan foydalanuvchi referat matnini
  olardi), `games/engine.ts` yangi kindlar `null`, `gameGateFail`
  saralash/tinglash darvozalari (0.7 ulush), `games/layout.ts
  planSectionsOnly` — interaktiv o'yinlarning bosma varag'i (WP-D uni
  toifa/lug'at JADVALIGA almashtiradi; usiz oqim jimgina karta
  panjarasiga tushib ketardi), `audio-params.ts` zond reyestri.

**Runtime substrati**

- `021_games.sql` — `game_sessions(id, generation_id, user_id, token
  UNIQUE, kind, settings_json, expires_at, created_at)` +
  `game_results(id, session_id, player_name, score, total, answers_json,
  seconds, ip_hash, created_at)` + indekslar; ikkalasi ham generatsiyaga
  `ON DELETE CASCADE`. Token generatsiyada EMAS, sessiyada: bitta o'yin
  ikki sinfga ikki havola bilan berilishi va natijalar alohida
  ko'rinishi kerak.
- `lib/server/game-sessions.ts` — `createGameSession` (egalik SQL
  darajasida: `INSERT … SELECT … WHERE g.user_id = $3 AND status =
  'COMPLETED'`), `getGameSessionByToken` (muddat SQL da), `listResults`
  (`JOIN … s.user_id = $2`), `addResult` (ism 40 belgi, soniya ≤86 400,
  IP **xeshlanadi** — loginsiz xizmatda manzil saqlanmaydi),
  `purgeExpiredSessions`. Token — `randomBytes(16).base64url` (22 belgi,
  128 bit).
- `lib/game/public.ts publicGameView(doc, kind, {seed})` — **TO'G'RI
  JAVOB CHIQMAYDI**: quiz — savol + variantlar (`open`/`match`
  o'ynalmaydi, `total` shunga mos); krossvord — to'r SHAKLI (`cells`
  boolean!) + raqamlar + savollar; kartalar — faqat old yuz; saralash —
  toifa NOMLARI + aralashtirilgan elementlar; tinglash — audio id +
  aralashtirilgan variantlar. Uch qoida: ko'rinish qo'lda quriladi
  (`{...model}` YO'Q), element id — MATN xeshi (tartib javobni oshkor
  qilmasin), variantlar `publicOptionOrder` bilan aralashadi. Izomorf:
  server importi yo'q.
- `lib/game/score.ts scoreAnswers(doc, kind, answers)` — ball SERVERDA;
  variantlar tartibi AYNI sof funksiyadan tiklanadi (sessiyada hech
  narsa saqlanmaydi). Krossvordda apostrof/registr jazolanmaydi;
  kartalarda ball — «bildim» soni (halol o'lchov emasligi izohda).
- Route lar: `POST/GET /api/generations/[id]/share` (egasi, token + URL,
  30/soat), `GET …/results` (egasi, JSON yoki `?format=csv` — BOM +
  formula injeksiyasidan himoya), `GET /api/o/[token]` (ochiq,
  `publicGameView`, 404 sababsiz), `POST /api/o/[token]/submit` (ochiq,
  `checkOrigin` + IP 30/daq + ism ≤40; klient `score` i E'TIBORSIZ,
  javobda faqat `{score, total, percent}`).
- `app/o/[token]/page.tsx` (`robots: noindex, nofollow`) +
  `components/game/Player.tsx` skeleti (yuklanmoqda → ism → o'yin →
  natija); tur bo'yicha ekranlar va `lib/game/engine.ts` — WP-C.
- `lib/game/qr.ts qrSvg(url)` — `qrcode` (MIT, SVG, `server-only`);
  «O'yin havolasi + QR» paneli `ResultView` da WP-C/R bosqichida.
  CSP `media-src 'self'` allaqachon bor va endi TEST bilan qulflangan.

**Testlar**: `audio-registry` 7, `tts-types` 7, `game-registry` 16 (+6),
`game-public` 11, `game-score` 10, `game-sessions` 8, `game-routes` 12,
`migrations` 6, `pricing` +4, `viewer-kind` +4, `csp-headers` +1;
`game-params`/`game-wiring`/`viewer/game-parity` yangilandi. Har fayl
sarlavhasida MUTATSIYALAR ro'yxati (jami 30+). `npm test` 2396 yashil,
`test:viewer` 214, `test:ui` 234, `tsc`/eslint toza.

**Ochiq bandlar (keyingi WP lar uchun)**

- WP-A: TTS kalitlari (`AZURE_SPEECH_KEY`+`AZURE_SPEECH_REGION`,
  `AISHA_API_KEY`) egasidan; `tts/{azure,aisha,gemini,chain,mp3}.ts`,
  `scripts/tts-lab.mts`, MP3 birlashtirish (CBR konkatenatsiya vs
  `ffmpeg` — worker rasmida ffmpeg YO'Q).
- WP-C: o'yinchi UI 5 tur + `lib/game/engine.ts`; tinglashda audio
  bo'lmasa ekran nima ko'rsatishi (hozir `audioAssetId` yo'q → placeholder).
- ~~WP-D: `planSectionsOnly` o'rniga haqiqiy bosma jadval (saralash
  ustunlari, tinglash lug'ati) + `sorting`/`listening` dvigatellari.~~
  ✅ quyidagi «WP-D» yozuvi.
- R: `ResultView` «O'yin havolasi + QR» paneli, `/o/` uchun `robots.ts`,
  `worker.ts housekeeping` ga `purgeExpiredSessions`, jonli smoke
  (havola → ism → o'yin → natija egasida).

### WP-C — O'yinchi tomoni: holat mashinasi + 5 ekran + havola paneli (2026-09-17) ✅

R0 ning `publicGameView`/`scoreAnswers` shartnomasini O'YNALADIGAN
qilib yopdi: havola → ism → o'yin → natija, va egasi tomonida havola +
QR + natijalar jadvali.

**`lib/game/engine.ts` — sof holat mashinasi**

`createGame(view) → state`, `answer(state, id, value)`, `next`/`prev`/
`goTo`, `flip`, `pick`/`place`, `toggleIndex`, `progress`/
`answeredCount`, `elapsed`, `finish(state) → {state, answers, seconds}`.
React'siz va DOM'siz — `tests/game-engine.test.mts` uni jsdom SIZ
sinaydi, jsdom testi esa faqat chizilishni.

Ikki shartnoma fayl boshida yozilgan va test bilan qulflangan:

1. **TARTIB TEGILMAYDI.** O'yinchi bosgan OCHIQ indeks
   (`publicOptionOrder` aralashtirgan) payloadga O'ZGARMASDAN tushadi;
   `score.ts` uni sof funksiyadan qayta quradi. Dvigatelda «tartibga
   solish» paydo bo'lsa, ball jimgina noto'g'ri hisoblanardi va na
   `game-public`, na `game-score` buni ko'rardi — ikkalasi ham
   dvigatelni chaqirmaydi. Shuning uchun test
   `publicGameView → engine.finish → scoreAnswers` halqasini besh
   turda uchidan-uchiga yuradi va TO'LIQ ball talab qiladi.
2. **To'g'ri javob dvigatelda YO'Q** — ball faqat submit javobidan.

Turga xos qarorlar: quiz/kartalar/tinglash — elementma-element qadam
(telefon ekraniga bitta savol + katta tugma sig'adi), krossvord va
saralash — bitta ekran (kesishma va toifalar bir vaqtda ko'rinishi
shart). Krossvordda `answers` kaliti — KATAK (`r:c`), so'z → harflar
payload i `finish()` da yig'iladi: kesishgan katakni o'yinchi bir marta
yozadi va u ikkala so'zga tushadi; katak yo'llari savol raqami +
yo'nalish + to'r shaklidan tiklanadi (`crosswordSlots`), chunki ochiq
ko'rinishda so'zning kataklari YO'Q. `oʻ`/`gʻ` — bitta katak
(`oneLetter` apostrofni ergashtiradi). Xato qiymat ISTISNO EMAS:
noto'g'ri id/shakl — holat o'zgarmaydi (`score.ts` falsafasi).

**Ekranlar** — `components/game/{NameGate,Quiz,Crossword,Cards,Sorting,
Listening,Result}.tsx` + qobiq `Player.tsx`; `app/o/[token]/page.tsx`
mobil maket (360 px, tugmalar ≥48 px, `min-h-dvh`).

- **Ism darvozasi** — 40 belgi (server ham shunga kesadi, o'quvchi buni
  HOZIR ko'rsin); parol/telefon/sinf SO'RALMAYDI.
- **Kartalar** — «ag'darish» JAVOBNI KO'RSATMAYDI va ko'rsata olmaydi:
  `PublicCard` da `back` yo'q (bu ATAYLAB — bosma to'plamning nusxasi
  emas). Ag'darish — o'zini tekshirishga o'tish; «bildim»/«bilmadim»
  ikkalasi ham progressda sanaladi (to'plam oxirigacha ko'rilsin).
- **Saralash** — asosiy oqim TANLAB-JOYLASH: HTML5 DnD mobil
  brauzerlarda umuman ishlamaydi. Drag ham bor va AYNI `pick`/`place`
  ga tushadi; joylangan element bosilsa taxtaga qaytadi.
- **Tinglash** — TTS kelmaguncha (WP-A) «audio hali tayyor emas» deb
  AYTADI va ishlamaydigan tugmani chizmaydi.
- **Xatolar** o'zbekcha va SABABSIZ (404 da «yo'q» va «muddati tugagan»
  farqlanmaydi — route ham ajratmaydi). Submit yiqilsa o'yin
  YO'QOLMAYDI: javoblar joyida, tugma «Qayta yuborish» ga aylanadi.
- Natija ekrani QAYSI topshiriq xato ekanini KO'RSATMAYDI (bir
  urinishdan keyin javob varag'i tarqalardi). «Yana o'ynash» — YANGI
  qator, eskisini o'chirmaydi.

**`components/files/GameSharePanel.tsx`** — `ResultView` da, tayyorlik
hisoboti panelidan KEYIN va ko'ruvchidan OLDIN (o'qituvchi avval
«tayyormi» ni ko'radi, so'ng sinfga beradi). Ro'yxat `publicGameKindOf`
dan — `share` route bilan BITTA manba, ya'ni «panel bor, tugma 400
qaytaradi» holati bo'lmaydi. Ichida: bo'sh holat (nima bo'lishini
aytadi — loginsiz ochiq havola qaytarib bo'lmaydigan qadam), «O'yin
havolasi yaratish», URL + «Nusxalash», QR, amal muddati, bir nechta
havola yorlig'i, natijalar jadvali (ism, ball, foiz, vaqt, sana) +
«CSV» va «Yangilash». **Real-time/leaderboard YO'Q** (egasi qarori 8) —
avtomatik so'rov ham yo'q, «Yangilash» yetarli.

QR **KLIENTDA** chiziladi (`qrcode` brauzer bandli, `toString` → SVG,
DINAMIK import — o'yin bo'lmagan hujjatlarda kutubxona yuklanmaydi):
`lib/game/qr.ts` `server-only` va uni klient komponenti import qila
olmaydi, ochiq QR route esa yo'q (havolaning o'zi sir). `GAME_KIND_LABEL`
`engine.ts` da — panel yorliqni `Player.tsx` dan olsa, butun o'yin
bandli har natija sahifasiga ergashardi.

**Testlar**: `game-engine` 20 (jsdom siz), `ui/game-player` 12,
`ui/game-share-panel` 9. **13 mutatsiya tasdiqlangan** — dvigatelda 6
(tartib oynasi, `down` yo'nalishi, apostrof, karta ag'darilgan
qolishi, buzuq javob yozilishi, yarim so'z sanalishi), o'yinchi UI da 4
(teskari indeks, ism tanadan tushishi, inglizcha 429 matni, teskari
katak kaliti), panelda 3 (QR tokendan chizilishi, natijasiz CSV,
`ResultView` shartining `isGame` ga almashishi). `npm test` 2418
(2405 pass / 0 fail), `test:viewer` 214, `test:ui` 255, `tsc`/eslint
toza; `client-boundary` yashil — o'yinchi sahifasi server moduliga
yetmaydi.

**Ochiq bandlar (R uchun)**

- **Tinglashda audio havolasi**: `Listening` `audioSrc` prop i
  `/api/o/[token]/audio/[assetId]` ni kutadi, lekin BU ROUTE YO'Q
  (`/api/generations/[id]/assets/[assetId]` `requireUser` talab qiladi
  va faqat rasm mime lariga ruxsat beradi). WP-A TTS parchalarini
  chiqargach, ochiq (tokenga bog'langan) audio route kerak; hozir ekran
  «audio tayyor emas» holatida qoladi.
- **`PublicListeningItem` da `text` YO'Q**, shuning uchun «audio
  bo'lmasa matnni ko'rsatib tinglashni keyinga qoldirish» rejasini
  bajarib bo'lmadi. Matn javobning O'ZI emas (javob — variantlardan
  biri), shuning uchun uni ochiq ko'rinishga qo'shish sizish emas —
  lekin bu `lib/game/public.ts` o'zgarishi (WP-C egaligida emas).
- **Kartalarda orqa yuz yo'q** — «ag'darish» javobni ko'rsatmaydi.
  Hozirgi yechim halol (o'zini tekshirish), lekin egasi qarori kerak:
  takrorlash mashqi shundayligicha qolsinmi yoki `back` ochiq
  ko'rinishga chiqsinmi (chiqsa — ball «bildim» soni bo'lib qolaveradi,
  lekin o'quvchi o'zini tekshira oladi).
- **Chromium smoke bajarilmadi** — dev server (3111) ko'tarilmagan edi;
  jsdom bilan cheklandi. R bosqichida «havola → ism → o'yin → natija
  egasida» jonli oqimi brauzerda ko'rilishi shart (AUDIT-11 Y-5
  darsi: jsdom hit-testing xatolarini ko'rmaydi — ayniqsa krossvord
  katak fokusi va saralash drag'i).
- **R (lead) — WP-C birlashtiruvi va o'yinchi oqimi smoke**: WP-C main da (`0002175`). Chromium (dev 3111, scratch `play22.mjs`): egasi `POST …/share` → token; LOGINSIZ kontekstda `/o/<token>` → ism «Smoke O'quvchi» → test 20 savol (har birida birinchi variant) → natija 5/20 (25 %) «Natijangiz o'qituvchingizga yuborildi» → egasida `GET …/results` 1 qator (`answers.results` per-savol), CSV 3 qator; 0 brauzer xatosi. Ochiq: share URL `APP_URL` dan (dev `localhost:3000`); `PublicListeningItem.text` va `PublicCard.back` (javob emas) — R da qo'shiladi; ochiq audio route (`/api/o/[token]/audio/[assetId]`) — WP-A TTS bilan.
### WP-D — Saralash va tinglash dvigatellari + bosma maketlar (2026-09-17) ✅

R0 ikkala kind uchun MODEL, reyestr, chegara va `null` stubini qoldirgan
edi; WP-D ularni ishlaydigan vositaga aylantirdi. Naqsh AUDIT-21 WP-B
(flesh kartalar) bilan AYNI: `{prompts,input,engine,review,polish}.ts`,
`complete("writer")` + `CostMeter`, MODEL shaklidagi sayqal.

**Saralash** (`lib/generation/games/sorting/`)

- `prompts.ts` — markaziy qoida promptda BIRINCHI o'rinda: «ONE CATEGORY
  PER ITEM», element HAR toifaga solishtirib ko'riladi, toifa nomlari
  BIR XIL abstraksiya darajasida (`sorting-game.md` §5 yomon misoli).
- `input.ts` — VA'DA `categoryCount × itemsPerCategory` KO'PAYTMASIDAN
  saqlanadi. Sabab moliyaviy: «Qarama-qarshi juftlik» turida reyestr
  toifani 2 taga qulflaydi, `gamePromisedCount` esa turni BILMAYDI —
  4 toifa × 5 element tanlagan o'qituvchi 10 element olar va darvoza
  (`gameGateFail`, 70 %) hujjatni RAD ETARDI. Endi elementlar mavjud
  toifalarga qayta taqsimlanadi (2 × 10), jami o'zgarmaydi. Oddiy
  turda formula ayni forma qiymatlarini qaytaradi.
- `engine.ts buildSortingDoc` — `pickCategories` (global noyoblik:
  element toifalar ORASIDA ham takrorlanmaydi; element toifa NOMI bilan
  bir xil bo'lsa tashlanadi), yetishmasa +1 so'rov, `numbered` barqaror
  id lar (`s1…` — `game_results.answers_json` shularga tayanadi),
  `shuffleStable` (urug' — elementlarning o'zi, `Math.random` YO'Q) va
  `sortingSections` → `intro`/`sorting`/`answers`. `delivered` —
  element soni.
- `review.ts` — `GAME_RULE_IDS.sorting` (7 band) + `categoryNameDistinct`.
  Ikki ma'nolilik IKKI marta: deterministik `ambiguousItems`
  (matndagi to'qnashuv + `sameStem` bilan topilgan DARAJA to'qnashuvi —
  torroq toifaning har elementi kengrog'iga ham tegishli) va baholovchi
  `unambiguity`. `itemsPerCategory` TENGLIKNI o'lchaydi: hisobot vaqtida
  forma qiymatlari yo'q (tahrirdan keyin ham qayta hisoblanadi).
- `polish.ts` — MODEL qayta yoziladi (aralash nasrdan modelni tiklab
  BO'LMAYDI); toifa va element soni qo'riqlanadi, id lar saqlanadi.

**Tinglash** (`lib/generation/games/listening/`)

- `prompts.ts` — ikki tillilik ISTISNOSI birinchi qatordan keyin aniq
  aytiladi (aks holda model butun topshiriqni bitta tilga o'girardi);
  distraktorlar AYNI semantik maydondan, hech biri ikkinchi tarjima
  emas. Javob INDEKS emas, MATN sifatida so'raladi — modellar indeksni
  muntazam bir pozitsiyaga adashtiradi, matnni esa adashtirmaydi.
- `input.ts` — `nativeLanguage` (variantlar va varaq matni;
  `GameModel.language` ham SHU) + `targetLanguage` (TTS ovozi). Teng
  kelgan juftlik zaxiraga tushadi.
- `engine.ts buildListeningDoc` — `pickItems` javobni indeksga
  aylantiradi va variantlarni BARQAROR tartibda aralashtiradi (to'g'ri
  javob doim birinchi turgan to'plamda o'quvchi qoidani payqab qolardi);
  `attachAudio` — TTS SEAM.
- **TTS seam**: `GameBuildOpts.tts?: TtsProvider` + `putAsset?`.
  Kalitlar yo'q (`tts.md` §6), shuning uchun BUGUNGI yo'l — audiosiz:
  `audioAssetId` bo'sh, bosma varaq baribir chiqadi. Seam berilsa har
  `text` uchun bitta parcha sintez qilinib aktivga chiqariladi; bitta
  parcha yiqilsa QOLGANLARI davom etadi. Ikkala shox ham TEST bilan
  qulflangan (soxta provayder).
- `review.ts` — `GAME_RULE_IDS.listening` (7 band) +
  `distractorSimilarity` evristikasi (uzunlik/so'z soni — semantik
  maydonning IZI). `answerInRange` QIZIL: indeks chegaradan chiqsa o'yin
  har javobni «xato» deb sanaydi va buni faqat o'ynagan o'quvchi sezadi.
- `polish.ts` — matn O'ZGARSA `audioAssetId` TASHLANADI (noto'g'ri audio
  audiosizdan yomonroq), o'zgarmasa saqlanadi (qayta sintez — bekorga
  sarf).

**Dispatch va maket**

- `games/engine.ts` — to'rtala dvigatel STATIK import (AUDIT-21 smoke
  saboqi: dinamik `import()` worker qadog'ida jimgina yiqilardi);
  `GameBuildOpts` ga `tts`/`putAsset` qo'shildi.
- `games/layout.ts` — `planSectionsOnly` O'CHDI, o'rniga
  `planInteractive`: saralashda CHEGARALI toifalar jadvali (ustun =
  toifa, kataklar BO'SH — yozish joyi, `minRows` eng katta toifadan) va
  javob kalitida to'ldirilgan nusxasi; tinglashda raqam + variantlar
  (eshitiladigan matn ATAYLAB bosilmaydi — aks holda mashq O'QISHga
  aylanardi), matn javob kalitida. Javob kaliti ikkalasida ham YANGI
  BETDAN. `GameCluesItem` `bordered`/`minRows` bilan kengaytirildi —
  DOCX ham, ko'ruvchi ham SHU bitta banddan chizadi.
- `samples.ts` — saralash/tinglash namunalari endi dvigatelning O'Z
  bo'lim quruvchisidan (qo'lda yig'ilgan nasr jimgina ajralib ketardi).

**Testlar**: `sorting-engine` 16, `sorting-review` 13,
`listening-engine` 16, `listening-review` 13, `game-layout` 26 (+6),
`viewer/game-parity` 14 (+2). `npm test` 2449 yashil, `test:viewer` 216,
`tsc`/eslint toza.

**Mutatsiya** (har biri aynan kerakli testni qizartirdi, so'ng
qaytarildi): (1) `ambiguousItems` → `[]`; (2) `uniqueItems` faqat toifa
ICHIDA; (3) `answerInRange` tekshiruvi olib tashlandi; (4) dispatch
saralash/tinglashni `null` qoldirdi (R0 stubi); (5) `planInteractive`
javob kalitiga sahifa uzilishini qo'ymadi.

**LibreOffice ko'z** (DOCX → PDF → PNG, ikkala namuna × 2 bet) uchta
nuqson topdi va uchalasi TUZATILDI:

1. tinglash qatorlari `li` edi — raqamlangan matn ustiga marker qo'yilib
   «• 1. A) …» bo'lib chiqardi; endi `p`;
2. saralashning javob betida AYNI javob ikki marta turardi (nasr
   qatorlari + to'ldirilgan jadval) — nasr endi CHIZILMAYDI (hujjatda
   qoladi: `answerKey` qoidasi, baholovchi va qidiruv shuni o'qiydi);
3. chegarali jadval ro'yxatning oxirgi bandiga TEGIB turardi — jadval
   oldiga bo'sh qator qo'shildi (ko'ruvchida `margin-top`).

**Ochiq savollar**

- `gamePromisedCount` (`games/types.ts`, R0 da qulflangan) turni
  bilmaydi. WP-D uni kirish bosqichida AYLANIB o'tdi (elementlarni qayta
  taqsimlash), lekin toza yechim — funksiyaga `type` ni uzatish; bu R0
  shartnomasini va `game-registry` testini o'zgartirishni talab qiladi.
- Bosma varaqdagi ARALASH ro'yxat bitta ustunda: 6 × 8 = 48 element
  betning ko'p qismini egallaydi. Ikki ustunli ro'yxat (mavjud
  chegarasiz `clues` bandi bilan) zichroq bo'lardi — PM qaroriga
  qoldirildi.
- Ko'rsatmadagi til nomi `langInfo(target).native` («English»). Uzbek
  matnda «ingliz tili» tabiiyroq, lekin 18 tilning o'zbekcha nomlari
  jadvali hozir YO'Q.
- Tinglash formasida `optionCount` maydoni yo'q (reyestr standarti 4);
  3 variantli rejim kerakmi — PM qarori.

### WP-A — TTS adapterlari, podkast va tabriknoma dvigateli (2026-09-17) ✅

R0 SHARTNOMASI o'zgarmadi: `buildAudioArtifact(tool, meta, values, opts)`
imzosi, `AudioModel` shakli va `TtsProvider` interfeysi o'z joyida —
bu WP faqat TANANI to'ldirdi. **Kalitlar hali YO'Q**, shuning uchun
provayder adapterlari hujjatga ko'ra yozildi va `deps.fetchImpl` seam'i
orqali mock `fetch` bilan sinaladi; haqiqiy so'rov `npm run tts-lab`
bilan, egasi kalit bergach.

**TTS qatlami** (`lib/generation/tts/`)

- `azure.ts` — REST (`https://<region>.tts.speech.microsoft.com/cognitiveservices/v1`,
  `Ocp-Apim-Subscription-Key`, `X-Microsoft-OutputFormat:
  audio-24khz-96kbitrate-mono-mp3`), SSML `<speak><voice><prosody>` +
  `<break>`. SDK ATAYLAB olinmadi (~10 MB, ichida audio qurilma/WebRTC
  qatlamlari). `xml:lang` OVOZ nomidan olinadi, forma tilidan emas:
  tasdiqlanmagan to'rtlikda (`kaa`/`ky`/`tg`/`tk`) ovoz qo'shni tilniki
  va `xml:lang` mos kelmasa Azure 400 qaytaradi. Xato tasnifi
  401/403/400 → `retryable:false` (zanjir keyingisiga), 429/5xx/tarmoq
  → `true`. Davomiylik javob sarlavhasida kelmaydi — MP3 KADRLARIDAN
  o'lchanadi.
- `aisha.ts` — WAV yo'li. 1 000 belgi chegarasi TARMOQQA CHIQMASDAN
  tekshiriladi; javobning uch shakli qo'llanadi (xom WAV, base64,
  havola + ikkinchi so'rov). ⚠ So'rov/javob shakli TASDIQLANMAGAN va
  ataylab IKKI funksiyada jamlangan (`aishaBody`/`readAishaAudio`) —
  kalit kelgach `tts-lab` birinchi haqiqiy javobni ko'rsatadi va
  tuzatiladigan yer shu ikkisi bo'ladi.
- `gemini.ts` — preview. `configured()` `GEMINI_API_KEY` ga EMAS,
  `TTS_GEMINI_MODEL` ga bog'langan: o'zbekcha sifat sinovdan o'tmagan
  va SLA yo'q, shuning uchun provayder ATAYLAB yoqiladi. Aks holda
  Azure yiqilganda har podkast jimgina preview modelga tushib qolardi.
  PCM → WAV, chastota `mimeType` dan (`rate=24000`).
- `chain.ts` — `TTS_VOICE_<TIL>=provider:voice,…` (jadvalni
  ALMASHTIRADI, kengaytirmaydi). **Eng muhim qaror: provayder BUTUN ISH
  uchun bog'lanadi**, har bo'lak uchun emas — aks holda bitta faylda
  Azure 24 kHz MP3 va Aisha 16 kHz WAV aralashib, `concatMp3` yiqilardi
  (yoki tekshiruvsiz — o'ynamaydigan fayl chiqardi). Provayder yiqilsa
  keyingisi HAMMA bo'lakni boshidan aytadi. Jurnal `llm/chain.ts`
  formatida: `[tts:uz] azure → ok 1 284 ms (6 bo'lak, 4 120 belgi)`.
- `mp3.ts` — kadr sarlavhasi tahlili (MPEG1/2/2.5 Layer III), ID3v2
  (SYNCSAFE uzunlik)/ID3v1 tashlash, Xing/Info kadrini chiqarib
  tashlash, PROFIL tekshiruvi bilan konkatenatsiya, `wavInfo` (RIFF
  bo'laklarini yuradi — `data` 44-baytda bo'lmasligi mumkin),
  `pcmToWav`, `wavToMp3`.
- `types.ts` ga kichik qo'shimcha: `TtsError` (shartnomada e'lon
  qilingan istisnoning shakli), `TtsSynthOpts.pauseMs`/`timeoutMs`,
  `TTS_LIMITS.callTimeoutMs`.

**Bog'liqlik qarori (`tts.md` §6 ochiq savoli 6)**: `@breezystack/lamejs`
— sof JavaScript LAME porti (WASM ham, native ham emas), worker rasmiga
tizim paketi qo'shmaydi; `ffmpeg` esa +30–50 MB bo'lardi. Kutubxona
LAZY yuklanadi (`await import`), ya'ni Azure yo'li (asosiy zanjir,
to'g'ridan-to'g'ri MP3) uni UMUMAN ochmaydi; yo'q bo'lsa `wavToMp3`
`null` beradi va Azure ishlashda davom etadi.
⚠ **Litsenziya LGPL-3.0, tadqiqotdagi «MIT» — XATO** (`tts.md` §1
tuzatilishi kerak). Kutubxona o'zgartirilmaydi va faqat SERVERDA
ishlaydi (foydalanuvchiga tarqatilmaydi), shuning uchun LGPL
majburiyati yuzaga kelmaydi; MP3 patentlari 2017 da tugagan.
Jonli tekshirildi: 2 s / 16 kHz WAV → 25 056 bayt MP3, `mp3Seconds`
2.088 s, profil `mpeg2/16000/mono`, ikki nusxa ulanganda 4.176 s.

**Audio dvigateli** (`lib/generation/audio/`)

- `input.ts` — forma → `AudioInput` (ikki tomonga: `encodeAudioValues`).
  Rejim/janr/daqiqa SERVERDA qayta siqiladi; `topic` rejimida manba
  matn ATAYLAB o'qilmaydi. `normalizeScript`: rollar faqat «A»/«B»
  (uchinchi rol ovozsiz qolardi), uzun replika KESILMAYDI — jumla
  chegarasida BO'LINADI.
- `script.ts` — rol → ovoz indeksi, so'z byudjeti (daqiqa × 150 ±15 %),
  ovoz ulushi SO'Z bo'yicha (replika soni bo'yicha emas: qisqa «ha,
  tushunarli» javoblar soxta muvozanat berardi), TTS bo'laklari.
  Pauzalar: replika orasida 350 ms, ROL ALMASHGANDA 500 ms, replika
  ichidagi bo'laklar orasida 0, oxirida 0. `<break>` teg faqat Azure
  SSML ida tug'iladi — xom matnga qo'shilsa Aisha uni O'QIB yuborardi.
- `prompts.ts` — skelet reyestrdan, «aytiladigan matn» qoidalari
  (qavs/havola/formula/markdown/sahna ko'rsatmasi yo'q) va HALOLLIK
  CHEGARASI ikki xil: podkastda soxta STATISTIKA, tabriknomada soxta
  SHAXSIY tafsilot (yosh, sana, xotira) taqiqi.
- `review.ts` — bandlar `AUDIO_RULE_IDS` bilan AYNAN mos (podkast 8,
  tabriknoma 7) + baholovchi. `greeting.md` §4 `noCliche` ALOHIDA band
  EMAS: u baholovchining `originality` mezoni — deterministik klişe
  ro'yxati yaxshi matnni ham qizartirardi. Yillar `noFakeStats` dan
  chiqarilgan (bayram yili uydirma emas). `relation` («Kim bo'ladi?»)
  `respectForm` bandining OG'IRLIGINI belgilaydi: ustoz/rahbar/katta
  yoshlida «sen» — QIZIL, do'stda — sariq.
- `polish.ts` — nishon bitta (`script`); qabul qilinganda `seconds`
  TASHLANADI (u eski matnning o'lchovi edi).
- `engine.ts` — bosqichlar kirish→ssenariy(+1 qayta so'rov)→hisobot→
  sayqal→sintez→qadoqlash. ⚠ **TARTIB `infographic` dan FARQ QILADI**:
  sayqal SINTEZDAN OLDIN, chunki qayta «chizish» bu oilada TTS ni
  ikkinchi marta to'lash degani. `null` va ISTISNO ajratilgan: matn
  chiqmasa `null` («Audio yaratilmadi»), OVOZ provayderi sozlanmagan
  bo'lsa ANIQ xato «Ovoz provayderi sozlanmagan» — va u ssenariydan
  OLDIN tekshiriladi, ya'ni kalitsiz holatda LLM puli sarflanmaydi.
  Ikkala yo'lda ham kredit qaytadi. `seconds` FAYLDAN o'lchanadi
  (`mp3Seconds`), `delivered = {got, want: daqiqa×60, unit:"soniya"}`.
  `cost` — LLM + TTS yig'indisi (`CostJson` shakli o'zgarmadi; TTS
  BELGILARI token ustuniga qo'shilmaydi — birlik boshqa).

**Kalitlar va muhit**: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`,
`AISHA_API_KEY`, `TTS_GEMINI_MODEL`, `TTS_VOICE_{UZ,RU,EN}` —
`lib/server/env.ts` (`env.tts`, `ttsConfigured()`,
`assertRuntimeConfig` ogohlantirishi), `.env.example` (olish yo'li
bilan), `docker-compose.yml` web+worker, `tests/compose-env.test.mts`
(+4 kalit va +1 test). Kalitning O'ZI hech qayerda chop etilmaydi.

**`scripts/tts-lab.mts`** (`npm run tts-lab`, hisobot §4): bitta
~60 soniyalik o'zbek namunasi × barcha sozlangan provayder/ovoz →
`eval-out/tts/*.mp3` + jadval (soniya / belgi / narx / latensiya /
bo'lak) + `report.json`. Chiqish `scratch/` emas `eval-out/` ga:
u allaqachon `.gitignore` da. Kalitsiz YIQILMAYDI — har provayder
«sozlanmagan» deb belgilanadi va kalitni QAYERDAN olish yozib
qo'yiladi. Kalitsiz yurgizib tekshirildi.

**Testlar**: `tts-mp3` 14, `tts-azure` 11, `tts-aisha` 10 (Aisha 6 +
Gemini 4), `tts-chain` 14, `audio-review` 16, `audio-engine` 13,
`compose-env` +1 — jami +79. Har fayl sarlavhasida MUTATSIYALAR
ro'yxati (31 + 13 + 12 = **56**). `npm test` 2 477 yashil, `tsc`/eslint
toza.

**WP-A dan qolgan ochiq bandlar**

1. **Kalitlar egasidan** (`tts.md` §6): `AZURE_SPEECH_KEY` +
   `AZURE_SPEECH_REGION`, `AISHA_API_KEY`. Ularsiz podkast/tabriknoma
   ishga tushmaydi va `assertRuntimeConfig` ogohlantiradi.
2. **Aisha so'rov/javob shakli** tasdiqlanmagan — kalit kelgach
   `tts-lab` bilan tekshirilib, `aishaBody`/`readAishaAudio` tuzatiladi.
3. **`docs/research/tts.md` §1 tuzatilsin**: `lamejs` litsenziyasi MIT
   emas, LGPL-3.0.
4. **Reyestr nomuvofiqligi (`audio-params.ts`, WP-A egaligidan tashqari)**:
   `podcastType` va `occasion` parametrlari `structure` ta'sirini e'lon
   qiladi, lekin uchala podkast turi ham `PODCAST_SKELETON` + `blocks: 3`
   + `speakers: 2` ni, oltala tabriknoma janri esa `GREETING_SKELETON`
   ni BIR XIL ishlatadi — ya'ni ssenariy TUZILMASI tur bo'yicha
   farqlanmaydi (farq faqat `guidance`/`occasion` da, ya'ni `prompt`
   va `model` da). Differensial zond (`tests/audio-params.test.mts`)
   shu sababli HALI yozilmadi: u yoki `AUDIO_PARAMS` dagi `structure`
   ta'sirini olib tashlashni, yoki reyestrga turga xos skelet/replika
   sonini kiritishni talab qiladi — ikkalasi ham WP-A egaligidan
   tashqaridagi fayllar (`audio-params.ts`, `audio/registry.ts`).
5. **Jonli sinov va ko'z bilan tekshirish** (CLAUDE.md 2/3-bosqich)
   kalitlar kelgandan keyin: `npm run tts-lab`, so'ng `npm run live`
   podkast/tabriknoma bilan va MP3 ni haqiqatan TINGLAB ko'rish.
6. `worker.ts`/`doc-polish.ts` audio «Tuzatish» yo'li: sayqal
   `relation`/`minutes` ni dvigateldan oladi, standalone «Tuzatish»
   esa ularni hujjatdan tiklashi kerak (`minutesOf`/`recipientOf` bor,
   `relation` uchun manba yo'q).

### R (lead) — tinglash TTS seam'i, ochiq audio route, o'yinchi oqimlari (2026-09-17)

**Ulash (`9c780bf`).** WP-D dvigateli `tts`/`putAsset` seam'ini e'lon qilgan,
lekin uni hech kim bermasdi — tinglash o'yini ishlab chiqarishda DOIM
audiosiz chiqardi. Endi:

- `lib/server/worker.ts` — `buildArtifact` ga `putAsset: (bytes, mime) =>
  putAssetBytes(job.id, mime, …)` beradi (aktiv SHU ishning id si bilan
  yoziladi; qulf yo'qolsa `deleteAssets` baribir tozalaydi).
- `lib/generation/index.ts` — `BuildOptions.putAsset`/`tts`; `putAsset`
  bo'lsa standart TTS zanjiri ulanadi (`providerOfChain(ttsChain)`),
  bo'lmasa sintez umuman chaqirilmaydi (jonli `buildArtifact`
  chaqiruvlarida behuda TTS puli ketmasin).
- `lib/generation/tts/chain.ts providerOfChain` — zanjirni bitta-parcha
  `TtsProvider` shaklida beradi: tinglash har so'zni alohida aktivga
  yozadi, zanjir esa `synthesizeAll` bilan ishlaydi; provayder tanlovi,
  qayta urinish, yiqilganda keyingisiga o'tish zanjirda qoladi. `voice`
  e'tiborsiz — ovoz til jadvalidan (`TTS_VOICE_*` bitta joydan).
- `write-llm.ts WriteExtras` += `tts`/`putAsset` → `buildGameDoc`.
- **Ochiq audio route** `GET /api/o/[token]/audio/[assetId]` (loginsiz):
  sessiya → generatsiya → `getAsset` egalik SQL sessiyadagi `userId`
  bilan; ikkinchi darvoza — aktiv `publicGameView` ro'yxatida BO'LISHI
  shart (token bitta generatsiyaning boshqa aktivlariga kalit emas);
  MIME oq ro'yxati `audio/mpeg`/`audio/wav`, `public, immutable` kesh,
  `nosniff`, `X-Robots-Tag: noindex`. Har nomuvofiqlik — 404, sabab
  aytilmaydi. `Player.tsx` allaqachon shu manzilga murojaat qilardi.

Testlar +8: `game-routes` +5 (200/MIME/kesh/egalik parametrlari;
ro'yxatda yo'q aktiv → 404 va aktiv SQL chaqirilmaydi; saralash/
noma'lum token/tugallanmagan/yaroqsiz id → 404; oq ro'yxatdan tashqari
MIME → `octet-stream`; `audioAssetIds`), `tts-chain` +2 (adapter ovozni
jadvaldan oladi; sozlanmagan zanjir aniq xato), `game-wiring` +1 (manba
skani: worker → index → write-llm → Player). Mutatsiyalar (ikkalasi
qizardi): ro'yxat tekshiruvi olib tashlandi; adapter `configured`
doim `true`.

**Byudjet tuzatuvi (`061e495`).** Saralash/tinglash 90 s byudjeti
zaxiralardan (hisobot 40 s + sayqal 55 s) kichik bo'lib, yozishga «0 ms»
qolardi («0 toifa» xatosi). `GAME_MS.sorting {160 s, +0.8 s/element}`,
`listening {160 s, +9 s/topshiriq}`; `game-wiring` da byudjet ≥
zaxiralar qulfi. Dars: `WORKER_INLINE` da dev serverni qayta ishga
tushirmaguncha navbat eski byudjet bilan ishlaydi.

**Chromium smoke (dev 3111, egasi + loginsiz kontekst).**
`games21.mjs sorting` — forma (2 000 tanga) → natija → hisobot 100/13
band → DOCX 10,8 KB, 0 brauzer xatosi. O'yinchi oqimlari, TO'G'RI
javoblar egasi hujjatidan olinib UI orqali kiritildi (`play22b.mjs`
saralash — element → toifa; `play22c.mjs` krossvord — `data-cell`
harflari, tinglash — `options[answer]` matni, kartalar — «bilaman»):

| O'yin | Natija ekrani | Egasida `results` | Izoh |
|---|---|---|---|
| Saralash (20 element, 4 toifa) | 20/20, 100 % | 20/20 | avvalgi umumiy skript 0/20 bergan edi — skript sababli, ball serverda to'g'ri |
| Krossvord (10 so'z, 54 katak) | 10/10 | 10/10 | |
| Tinglash (10 topshiriq) | 10/10 | 10/10 | kalit yo'q → `data-no-audio` belgisi, `[data-audio]` 0 — kutilgan |
| Flesh kartalar (10) | 10/10 | 10/10 | |

Hammasida 0 brauzer xatosi, natija egasi jadvaliga tushdi.
Audio bilan tinglash (haqiqiy `/audio/[assetId]` so'rovi) — kalitlar
kelgach qayta yurgiziladi.
