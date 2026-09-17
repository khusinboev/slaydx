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
- WP-D: `planSectionsOnly` o'rniga haqiqiy bosma jadval (saralash
  ustunlari, tinglash lug'ati) + `sorting`/`listening` dvigatellari.
- R: `ResultView` «O'yin havolasi + QR» paneli, `/o/` uchun `robots.ts`,
  `worker.ts housekeeping` ga `purgeExpiredSessions`, jonli smoke
  (havola → ism → o'yin → natija egasida).
