# Tashqi servislar inventari

Moliyaviy hisobot uchun manba. Har qator kodga havola bilan tasdiqlangan
(`fayl:qator`). Sana: 2026-09-20.

## 0. Barcha env kalitlar (`lib/server/env.ts` + `.env.example`)

| Kalit | Nima uchun | Majburiymi |
|---|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL` | asosiy LLM + pro-slide rasm | yo'q, lekin deyarli hamma vosita shunga tayanadi |
| `XAI_API_KEY`, `XAI_MODEL` | zaxira LLM (Grok) | yo'q |
| `ANTHROPIC_API_KEY` | LLM_JUDGE/zaxira yozuvchi (Claude) | yo'q |
| `OPENROUTER_API_KEY` | universal LLM zaxira (GPT/DeepSeek/Qwen) | yo'q |
| `OPENAI_API_KEY` | to'g'ridan-to'g'ri OpenAI (sotib olinmaydi, kod tayyor) | yo'q |
| `FAL_KEY`, `FAL_MODEL`, `FAL_MODEL_PREMIUM`, `FAL_STEPS`, `FAL_STEPS_PREMIUM` | fal.ai rasm | yo'q |
| `PEXELS_API_KEY` | bepul stock foto | yo'q |
| `PIXABAY_API_KEY` | bepul stock foto | yo'q |
| `GEMINI_IMAGE_MODEL`, `GEMINI_IMAGE_SIZE` | pro-slide rasm (Gemini) | yo'q |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | TTS (asosiy) | yo'q |
| `AISHA_API_KEY` | TTS (mahalliy, zaxira) | yo'q |
| `TTS_GEMINI_MODEL` | TTS (ixtiyoriy 3-zaxira, preview) | yo'q |
| `TTS_VOICE_<TIL>` | ovoz zanjirini almashtirish | yo'q |
| `OPENALEX_API_KEY`, `OPENALEX_MAILTO` | ilmiy manba qidiruv | yo'q |
| `CROSSREF_MAILTO` | DOI tasdiqlash (polite pool) | yo'q |
| `GOOGLE_BOOKS_API_KEY` | kitob manbalari | yo'q, lekin kalitsiz 429 (2026-09 tekshiruvida) |
| `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_TELEGRAM_BOT` | login/xabar | prodda MAJBURIY (DEV_LOGIN yo'q bo'lsa) |
| `CLICK_SERVICE_ID/MERCHANT_ID/SECRET_KEY/MERCHANT_USER_ID` | Click to'lov | yo'q |
| `PAYME_MERCHANT_ID/KEY/TEST_KEY` | Payme to'lov | yo'q |
| `CRON_SECRET` | ichki (webhook/health himoyasi) | Telegram bo'lsa MAJBURIY |
| `DATABASE_URL`, `DATABASE_POOL_MAX` | Postgres | MAJBURIY |
| `SESSION_SECRET` | cookie imzosi | prodda MAJBURIY (≥32 belgi) |
| `SOFFICE_BIN` | LibreOffice (ichki resurs, tashqi servis emas) | yo'q |
| `STORAGE_DIR` | **o'lik kod** — `env.ts:181` da o'qiladi, lekin faylni hech kim import qilmaydi (`grep` bo'yicha faqat shu bitta joy); haqiqiy saqlash Postgres `generation_files` jadvalida (`lib/server/storage.ts`) | — |
| `SOUM_PER_USD` | hisobot kursi (`lib/generation/llm-pricing.ts:100`) | yo'q, standart 12 700 |

---

## 1. LLM matn — rollar × provayder × model

`lib/generation/llm-roles.ts:34` — 4 rol: `writer`, `researcher`, `judge`, `fast`.
Har rol `.env`dagi `LLM_<ROL>=provider:model,provider:model,…` zanjiri
(`.env.example:162-165`); birinchisi 3 marta 429/5xx/tarmoq xatosidan keyin
ham yiqilsa keyingisiga o'tadi (`llm-roles.ts:80-93`, `lib/generation/llm/chain.ts`).
Standart (`.env.example`dagi tavsiya):

| Rol | Zanjir | Izoh |
|---|---|---|
| `writer` | `gemini:gemini-3.7-flash` | uzun matn |
| `researcher` | `gemini:gemini-3.7-flash` | manba tanlash/sintez |
| `judge` | `anthropic:claude-sonnet-5, gemini:gemini-3.7-flash` | tayyorlik baholovchi |
| `fast` | `gemini:gemini-3.7-flash` | kichik JSON |

`.env`da rol bo'sh bo'lsa — standart provayderga tushadi: `GEMINI_API_KEY`
bo'lsa Gemini, aks holda `XAI_API_KEY` (`llm-roles.ts:63-66`, `lib/generation/llm.ts:8-12`).

Adapterlar (`lib/generation/llm/*.ts`): `gemini.ts` (Google generativelanguage
API), `anthropic.ts` (`@anthropic-ai/sdk`), `xai.ts` (xAI, xuddi shu Gemini
tanaga o'xshash REST), `openrouter.ts:33` (`https://openrouter.ai/api/v1/chat/completions`),
`openai.ts:33` (`https://api.openai.com/v1/chat/completions`, sotib
olinmagan, kod tayyor turibdi).

### 1a. `complete(role, …)` chaqiruvchi vositalar (WP8 rol zanjiriga o'tgan)

Grep natijasi (`complete("writer"|"researcher"|"judge"|"fast", …)`):

- **writer**: essay/polish, audio/polish (podkast/tabriknoma tahrir), infographic/engine+polish, audio/engine, games/{sorting,flashcards,crossword,listening}/{engine,polish}, teacher/polish
- **researcher**: research/pipeline.ts:386 (manba tanlash)
- **fast**: research/lexuz.ts:321 (lex.uz hujjat ro'yxati), research/pipeline.ts:299 (qidiruv so'zlari), article/udk/route.ts:27 (UDK kodi)
- **judge**: essay/review.ts, audio/review.ts, article/review.ts, teacher/test/review.ts, games/{listening,crossword,sorting,flashcards}/review.ts, work/review.ts, teacher/review.ts, infographic/review.ts

Ya'ni maqola, referat/kurs ishi (essay), talaba ishlari (work), o'qituvchi
vositalari (teacher/test/games), infografika, audio (podkast/tabriknoma)
— HAMMASI rol zanjiridan o'tadi va zaxira/narx hisoblanadi.

### 1b. `llm.ts` ni TO'G'RIDAN-TO'G'RI chaqiradigan vositalar (WP8 dan TASHQARIDA)

`llmComplete`/`llmGrounded` (`lib/generation/llm.ts`) — faqat Gemini→xAI,
rol/zanjir yo'q, `usage` qaytmaydi → **narx hisoblanmaydi**:

| Fayl | Vosita |
|---|---|
| `lib/generation/slide-write.ts` | slayd matni (oddiy va pro-slide) |
| `lib/generation/slide-research.ts:65` | pro-slide internet qidiruvi (`llmGrounded`, Gemini `google_search` grounding) |
| `lib/generation/slide-image-prompts.ts` | slayd rasm promptlari |
| `lib/generation/image-studio.ts:153` | mustaqil «Rasm» vositasi — prompt kengaytirish |
| `lib/generation/translate/engine.ts` | Tarjimon 2 |
| `lib/generation/write-specials.ts` | maxsus yozuv yo'llari |
| `lib/generation/resume/write.ts` | Rezyume 2 AI qayta yozish |
| `lib/generation/write-llm.ts` | ASOSIY yozuvchi (article/essay oilasi) — lekin bu faylda `cost:` HAM bor (§8), ya'ni ba'zi joyda ikkala yo'l aralash ishlaydi |

**Grounding (pro-slide internet qidiruvi)** alohida narx qatori: Gemini
`google_search` tool — `lib/generation/llm.ts:39-52` izohida narxi YO'Q
deb yozilmagan, lekin bu kod bazasida **grounding uchun alohida narx
qatori yo'q** (`llm-pricing.ts` da faqat token narxi bor, grounding
so'rov-boshiga to'lov PRICING jadvalida ko'rinmaydi) → **Noaniq/tekshirilsin**.

### Narx jadvali (`lib/generation/llm-pricing.ts:31-49`, $/1M token)

| Provider | Model | Input | Output | Izoh |
|---|---|---|---|---|
| gemini | gemini-3.7-flash | 0.75 | 3.75 | 2027-01-01 dan 1.5/7.5 |
| gemini | gemini-3.5-flash-lite | 0.3 | 2.5 | |
| gemini | gemini-3.1-pro | 2 | 12 | |
| anthropic | claude-sonnet-5 | 2 | 10 | |
| anthropic | claude-opus-5 | 5 | 25 | |
| anthropic | claude-haiku-4-5 | 1 | 5 | |
| openai (OpenRouter orqali) | gpt-5.6-terra | 2 | 12 | |
| openai (OpenRouter orqali) | gpt-5.6-luna | 0.2 | 1.2 | |
| xai | grok-4.3 | 1.25 | 2.5 | |

OpenRouter — manba narxga ×1.055 ustama (`llm-pricing.ts:29,96`).
Noma'lum model → narx 0 va jurnal ogohlantirishi (`llm-pricing.ts:91-93`) —
ya'ni yangi model qo'shilib narx jadvaliga tushmasa, hisobot **kamsitib**
ko'rsatadi, xato bermaydi.

---

## 2. Rasm

Uch mustaqil bosqich, uchtasi ham bir xil `ImageProvider` shartnomasi
bilan (`lib/generation/image-provider.ts:114-133`):

| Vosita | Provayder zanjiri | Qayerda tanlanadi |
|---|---|---|
| Oddiy `slide` | Pexels → Pixabay → **fal YO'Q** (`id:"stock"`) | `image-provider.ts:241` |
| `pro-slide` | Faqat Gemini (`geminiProvider`) | `image-provider.ts:240` |
| Boshqa (fallback, `scripts/image-lab.mts` va eski test) | Pexels → Pixabay → fal | `image-provider.ts:242` |
| Mustaqil «Rasm» vositasi (`tool.id === "image"`) | Har doim fal.ai, `premium: true` (8 qadam) | `lib/generation/image-studio.ts:218` |

- **fal.ai**: `https://fal.run/<model>` (`lib/generation/image-provider-fal.ts:43`),
  standart `fal-ai/flux/schnell` (4 qadam), premium `FAL_MODEL_PREMIUM`
  (standart `fal-ai/flux/dev`, 28 qadam) — `.env.example:95-97`.
- **Gemini rasm** (pro-slide): `POST https://generativelanguage.googleapis.com/v1beta/interactions`,
  model `gemini-3.1-flash-image` standart, 1K narxi ~$0.067/rasm, zaxira
  `gemini-3.1-flash-lite-image` (~$0.034) — `lib/generation/image-provider-gemini.ts:6-19`,
  `.env.example:106-107`.
- **Pexels**: bepul, 200 so'rov/soat, 20 000/oy (`.env.example:82-83`).
- **Pixabay**: bepul, 100 so'rov/daqiqa (`.env.example:85-86`).

**Narx hisoblanmaydi**: rasm bosqichining hech biri `CostMeter`/`TtsMeter`
ga yozilmaydi — `BuiltFile.cost` faqat LLM/TTS sarfini oladi
(`lib/generation/types.ts:612-616`), fal.ai/Gemini-rasm/Pexels/Pixabay
so'rovlari hisobga kirmaydi (§8 ro'yxatiga qarang).

---

## 3. TTS (`lib/generation/tts/*`, AUDIT-22: podkast, tabriknoma)

Zanjir: Azure → Aisha → (ixtiyoriy) Gemini preview (`.env.example:190-209`).

| Provider | Endpoint/rejim | Narx (`lib/generation/tts/types.ts:374-380`) |
|---|---|---|
| `azure` | `https://<region>.tts.speech.microsoft.com/cognitiveservices/v1`, REST, MP3 (`lib/generation/tts/azure.ts:14-50`) | $16/1M belgi |
| `aisha` | voicelab.uz (mahalliy, WAV, 1000 belgi/so'rov chegara) | $80/1M belgi (1 so'm/belgi, 12 500 so'm/$) |
| `gemini` | `TTS_GEMINI_MODEL` preview, ataylab `GEMINI_API_KEY`dan mustaqil yoqiladi | $0 (bepul sinov kvotasi) |
| (jadvalda bor, ishlatilmaydi) `google`, `elevenlabs` | — | $16/1M, $165/1M — kod bor lekin zanjirda YO'Q (`TTS_LANG_VOICES`da faqat azure/aisha/gemini) |

`TtsMeter` (`lib/generation/tts/types.ts:389-436`) `audio/engine.ts` orqali
`BuiltFile.cost`ga tushadi — **narx hisoblanadi** (§8).

---

## 4. Ilmiy manbalar (`lib/generation/research/*`)

| Servis | Nima uchun | Bepulmi/kvota | Fayl |
|---|---|---|---|
| OpenAlex | jurnal maqola qidiruvi (CC0) | Bepul; 2026-02 dan kunlik $1 bepul limit **kalit bilan**, kalitsiz umumiy hovuz | `research/openalex.ts:1-20` |
| Crossref | DOI tasdiqlash + bibliografik qidiruv | Bepul; `mailto` — "polite pool" (tezroq) | `research/crossref.ts:1-19` |
| Google Books | darslik/monografiya manbalari | Kalitsiz ham ishlaydi, lekin 2026-09 tekshiruvida kalitsiz `HTTP 429` — PRODDA KALIT SHART; kalit bilan 1000/kun | `research/googlebooks.ts:1-19`, `.env.example:181-186` |
| lex.uz | normativ hujjat (qonun/farmon) | API yo'q — LLM (`fast` rol) nomzod topadi, keyin sahifa FETCH bilan tasdiqlanadi; tasdiqlanmasa rad etiladi | `research/lexuz.ts:1-30` |

Semantic Scholar/boshqa API — kodda yo'q (grep tasdiqladi).

---

## 5. To'lov (`lib/server/payments.ts`, `app/api/payments/**`)

- **Click**: imzo MD5 (`clickSignatureValid`, `payments.ts:53-67`), webhook
  `$APP_URL/api/payments/click` (`.env.example:135-136`).
- **Payme**: Basic auth, SHA-256 doimiy-vaqt taqqoslash (`paymeAuthorized`,
  `payments.ts:76-106`), webhook `$APP_URL/api/payments/payme`.
- **Kurs**: 1 so'm = 1 tanga, `SOUM_PER_COIN = 1` — `payments.ts:116`.
- **Pro tarif**: 15 000 so'm / 30 kun / 15 000 kvota — `PRO_PLAN`, `payments.ts:109-113`.
- **Komissiya foizi**: kodda YO'Q topilmadi — Click/Payme komissiyasi
  (odatda ~1-2%, provayder shartnomasiga bog'liq) kod ichida hisoblanmaydi,
  faqat to'liq summa (`amount_soum`) yoziladi → **Noaniq/tekshirilsin**
  (moliyaviy hisobotda alohida, shartnomadan olinishi kerak).

---

## 6. Auth/xabar — Telegram (`lib/server/telegram.ts`)

Bot API: `https://api.telegram.org/bot<TOKEN>/<method>` (`telegram.ts:26`).
Login: OTP chipta foydalanuvchi Telegram chatiga yuboriladi (`telegram.ts:9-15`).
Bepul (Telegram Bot API), faqat token kerak (`TELEGRAM_BOT_TOKEN`).
Webhook: `$APP_URL/api/telegram/webhook`, `CRON_SECRET` bilan himoyalangan
(`.env.example:44-49`).

---

## 7. Infratuzilma

| Komponent | Tafsilot | Manba |
|---|---|---|
| Server | 194.163.136.239, `/opt/slaydx`, `deploy.sh`; boshqa 2 loyiha bilan bo'lishilgan (provayder ko'rsatilmasin) | `.claude/deploy.md` (foydalanuvchi xotirasi) |
| Domen | slaydxx.uz, nginx (TLS tugatuvchi, reverse proxy) | `docker-compose.yml:75-78` izohi |
| Postgres | `postgres:16-alpine` konteyner, ichki tarmoqda (5432 tashqariga chiqmaydi) | `docker-compose.yml:1-16` |
| LibreOffice | DOCX/PPTX→PDF, `libreoffice-writer`+`libreoffice-impress` + `ttf-liberation`/`font-noto*`/`poppler-utils` (~400MB+60MB) | `Dockerfile:29-48` |
| Fontlar (worker) | `sharp`/librsvg orqali SVG→PNG sxema chizish uchun `fontconfig`+`ttf-liberation`+`font-noto` | `Dockerfile:76-80` |
| Fayl saqlash | Postgres `generation_files` jadvali (bytea), MUDDATSIZ; `STORAGE_DIR` env — o'lik kod, hech qanday S3/disk ishlatilmaydi | `lib/server/storage.ts:1-17` |
| Worker | alohida konteyner/process, navbat ichki (Postgres orqali), tashqi navbat servisi (Redis/SQS) YO'Q | `docker-compose.yml:83-` |

---

## 8. `generations.cost_json` telemetriyasi — QAYSI vositalarda to'ladi

`BuiltFile.cost` (`lib/generation/types.ts:612-616`) faqat LLM (`CostMeter`)
va TTS (`TtsMeter`) sarfini oladi; worker shu bo'lsagina `generations.cost_json`
ga yozadi.

### Cost BOR (LLM va/yoki TTS sarfi hisoblanadi)
- **article/essay oilasi** — `write-llm.ts`, `article/engine.ts`, `essay/engine.ts` (`cost:` mavjud)
- **teacher** (o'qituvchi vositalari, test/konspekt) — `teacher/engine.ts`
- **work** (talaba ishlari) — `work/engine.ts`
- **games** (crossword/sorting/flashcards/listening) — `games/engine.ts`
- **audio** (podkast, tabriknoma, tinglash — TTS) — `audio/engine.ts`
- **infographic** — o'z `CostMeter`si bilan, `infographic/engine.ts:278-290`

### Cost YO'Q (LLM chaqiradi, lekin sarf HECH QAYERGA yozilmaydi)
- **slide / pro-slide** — `slide-write.ts`, `slide-research.ts` (grounding!), `slide-image-prompts.ts` — eski `llmComplete` yo'lida, `usage` umuman qaytmaydi
- **image** (mustaqil «Rasm» vositasi) — `image-studio.ts` prompt-kengaytirish LLM chaqiruvi VA fal.ai rasm narxi — ikkalasi ham hisobsiz
- **translation** (Tarjimon 2) — `translate/engine.ts`
- **resume** (Rezyume 2, AI qayta yozish) — `resume/write.ts`, va `index.ts:591-608` branch cost ni umuman o'tkazmaydi

Rasm provayderlari (fal.ai/Gemini rasm/Pexels/Pixabay) HECH BIR vositada
`cost_json`ga yozilmaydi — bu haqiqiy tannarx (fal.ai/Gemini rasm pullik)
bilan hisobotdagi ko'rsatkich orasida tizimli tafovut demakdir.

---

## Noaniq / tekshirilsin

1. **Grounding (pro-slide internet qidiruvi) narxi** — Gemini `google_search`
   tool alohida to'lanadi (odatda so'rov-boshiga), lekin `llm-pricing.ts`da
   bunga mos qator yo'q va bu chaqiruv umuman `cost_json`ga tushmaydi (§1, §8).
2. **Click/Payme komissiya foizi** — kodda topilmadi; shartnoma darajasida
   bo'lishi kerak, moliyaviy hisobotga tashqaridan kiritilishi kerak.
3. **fal.ai va Gemini-rasm haqiqiy tannarxi** — hech qanday vositada
   `cost_json`ga yozilmaydi; moliyaviy hisobot uchun bu xarajat fal.ai/
   Google Cloud billing dashboard'idan qo'lda olinishi kerak.
4. **STORAGE_DIR** — `.env.example`da yo'q, faqat `env.ts:181`da standart
   qiymat sifatida bor, lekin hech qanday modul buni import qilmaydi —
   ehtimol eski (fayl-tizim asosidagi) saqlashdan qolgan o'lik konfiguratsiya.
5. **OpenRouter orqali OpenAI narxi** — `OPENROUTER_SURCHARGE = 1.055`
   qo'llanadi, lekin bu OpenRouter'ning HAQIQIY joriy narxlash siyosatiga
   mos ekanligi tasdiqlanmagan (vaqt o'tishi bilan o'zgarishi mumkin).
6. **TTS `google`/`elevenlabs` narx qatorlari** (`tts/types.ts:378-379`) —
   kodda bor, lekin hech qanday zanjirda ishlatilmaydi; nima uchun
   saqlanayotgani noaniq (kelajak rejami, yoki eski qoldiq).
7. **Server provayderi** (194.163.136.239) — foydalanuvchi xotirasida
   "provayderi noma'lum, aytmang" deyilgan — moliyaviy hisobotda bu xarajat
   qatori alohida (foydalanuvchidan) so'ralishi kerak.
