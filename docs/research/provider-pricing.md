# Tashqi servislar — rasmiy narxlar (2026-sentabr tekshiruvi)

Sana: **2026-09-20**. Har qatorda manba URL + olingan sana. `lib/generation/llm-pricing.ts`
dagi taxminiy jadval bilan solishtirish — «kodda» ustuni shu fayldan, «rasmiy» ustuni
quyidagi tadqiqotdan.

## 1. LLM matn modellari (USD / 1M token)

| Model | Kodda (in/out) | Rasmiy (in/out) | Farq | Manba | Sana |
|---|---|---|---|---|---|
| gemini-3.7-flash (2026-12-31 gacha) | 0.75 / 3.75 | **0.75 / 3.75** | mos | [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) | 2026-09-20 |
| gemini-3.7-flash (2027-01-01 dan) | 1.5 / 7.5 | **1.50 / 7.50** | mos | shu yuqoridagi | 2026-09-20 |
| gemini-3.5-flash-lite | 0.3 / 2.5 | **0.30 / 2.50** | mos | shu yuqoridagi | 2026-09-20 |
| gemini-3.7-flash-lite | kodda yo'q | **topilmadi** — rasmiy sahifada shu nom yo'q; o'rniga **gemini-3.1-flash-lite: 0.25/1.50** (matn/rasm/video), audio kirish 0.50 | — | shu yuqoridagi | 2026-09-20 |
| gemini-3.1-pro (≤200K token) | 2 / 12 | **2.00 / 12.00** | mos | shu yuqoridagi | 2026-09-20 |
| gemini-3.1-pro (>200K token) | kodda yo'q | **4.00 / 18.00** — kodda bu chegara umuman hisobga olinmagan | ⚠ farq | shu yuqoridagi | 2026-09-20 |
| claude-sonnet-5 | 2 / 10 | **2 / 10** | mos | [claude.com/pricing](https://claude.com/pricing) | 2026-09-20 |
| claude-opus-5 | 5 / 25 | **5 / 25** | mos | shu yuqoridagi | 2026-09-20 |
| claude-haiku-4-5 | 1 / 5 | **1 / 5** | mos | shu yuqoridagi | 2026-09-20 |
| — Anthropic prompt caching | kodda yo'q | **cache read: $0.20/MTok Sonnet 5 uchun (~90% chegirma)** | ⚠ kodda hisobga olinmagan (marja optimallashtirish imkoniyati) | shu yuqoridagi | 2026-09-20 |
| — Anthropic batch API | kodda yo'q | **50% chegirma** | ⚠ kodda hisobga olinmagan | shu yuqoridagi | 2026-09-20 |
| — Anthropic Opus 5 "fast mode" | kodda yo'q | **2× standart narx** (taxmin — WebFetch xulosasi, birlamchi jadvalda alohida ko'rilmagan) | taxmin | shu yuqoridagi | 2026-09-20 |
| xai grok-4.3 (<200K token) | 1.25 / 2.5 | **1.25 / 2.50**, kesh kirish 0.20 | mos | [docs.x.ai/docs/models](https://docs.x.ai/docs/models) (x.ai/api saytiga to'g'ridan-to'g'ri kirish 403 berdi, docs.x.ai orqali tasdiqlandi) | 2026-09-20 |
| xai grok-4.3 (≥200K token) | kodda yo'q | **2.50 / 5.00**, kesh 0.40 — uzun-kontekst narxi kodda YO'Q | ⚠ farq | shu yuqoridagi | 2026-09-20 |

**Eng muhim farqlar:** (1) Gemini 3.1 Pro va Grok 4.3 uchun 200K token'dan yuqori "uzun kontekst"
narxi (2× taxminan) kodda umuman qamrab olinmagan — uzun hujjatlarda (kurs ishi, maqola) real
xarajat kod hisoblaganidan yuqori bo'lishi mumkin. (2) Anthropic prompt caching (~90% chegirma)
va batch (50% chegirma) kodda hisobga olinmagan — marjani pastroq ko'rsatishi mumkin, lekin
xavfsiz tomonga (haqiqiy xarajat kod hisoblaganidan KAM bo'ladi, ko'p emas).

## 2. Gemini qo'shimcha xizmatlar

| Xizmat | Narx | Manba | Sana |
|---|---|---|---|
| gemini-3.1-flash-image (rasm gen.) | $0.045/rasm (0.5K/512px), $0.067/rasm (1K/1024px), $0.101/rasm (2K), $0.151/rasm (4K) | [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) | 2026-09-20 |
| Grounding with Google Search | **5000 so'rov/oy bepul** (Gemini 3.x oilasi umumiy), so'ngra **$14 / 1000 so'rov**; qidiruvdan qaytgan kontekst input-token sifatida hisoblanmaydi | shu yuqoridagi | 2026-09-20 |
| Gemini TTS (gemini-3.1-flash audio chiqishi) | **$20.00 / 1M chiqish TOKEN** (belgi emas, token — Gemini audio hisoblash birligi shu) | shu yuqoridagi | 2026-09-20 |

## 3. Rasm generatsiyasi — fal.ai

| Model | Narx | Manba | Sana |
|---|---|---|---|
| fal-ai/flux/schnell | **$0.003 / megapiksel** (yaqin butun megapikselgacha yaxlitlanadi) | [fal.ai/models/fal-ai/flux/schnell](https://fal.ai/models/fal-ai/flux/schnell) | 2026-09-20 |
| Boshqa fal.ai FLUX variantlari (dev, FLUX.2) | sahifada aniq narx ko'rsatilmagan — **topilmadi** (alohida model sahifasi kerak) | shu yuqoridagi | 2026-09-20 |

Kodda fal.ai narxi alohida faylda ko'rilmagan (`llm-pricing.ts` faqat LLM matn/token narxlarini saqlaydi) — solishtirish imkonsiz, faqat rasmiy raqam qayd etildi.

## 4. TTS (matndan nutqqa)

| Xizmat | Narx | Bepul kvota | Manba | Sana |
|---|---|---|---|---|
| Azure AI Speech — Neural (standart) | **~$16 / 1M belgi** (rasmiy sahifa `azure.microsoft.com/pricing/details/speech` JS orqali render bo'ladi, WebFetch narx jadvalini o'qiy olmadi — ikkinchi darajali manbadan: texttolab.com) | **F0: 500 000 belgi/oy bepul** | [azure.microsoft.com/pricing/details/speech](https://azure.microsoft.com/en-us/pricing/details/speech/) (raqam tasdiqlanmagan, jadval bo'sh keldi); ikkinchi darajali: [texttolab.com/blog/azure-text-to-speech-pricing](https://texttolab.com/blog/azure-text-to-speech-pricing) | 2026-09-20 |
| Azure AI Speech — Neural HD | **~$22 / 1M belgi** (taxmin, ikkinchi darajali manba) | — | shu ikkinchi darajali manba | 2026-09-20 |
| Google Cloud TTS — Neural2 | **~$16 / 1M belgi** (rasmiy sahifa uzun bo'lgani uchun WebFetch narx jadvalini to'liq o'qiy olmadi — ikkinchi darajali manbalardan: speechactors.com/costbench.com) | **0–1M belgi/oy bepul** (WaveNet/Neural2 uchun tarixiy standart) | [cloud.google.com/text-to-speech/pricing](https://cloud.google.com/text-to-speech/pricing) (raqam tasdiqlanmagan); ikkinchi darajali manba orqali | 2026-09-20 |
| Google Cloud TTS — Chirp 3 HD | **~$30 / 1M belgi** (taxmin, ikkinchi darajali) | — | shu | 2026-09-20 |
| Aisha AI (aisha.group) — O'zbek TTS | **topilmadi** — rasmiy saytda (`aisha.group/uz/text-to-speech`) ochiq narx jadvali yo'q, faqat mahsulot tavsifi bor | [aisha.group/uz/text-to-speech](https://aisha.group/uz/text-to-speech) | 2026-09-20 |
| VoiceLab.uz (Lison) | **topilmadi** — ochiq narx sahifasi yo'q | [voicelab.uz](https://voicelab.uz/) | 2026-09-20 |

**Eslatma:** Azure va Google Cloud TTS rasmiy sahifalari JS bilan render bo'ladi (WebFetch statik HTML oladi, jadval bo'sh chiqadi) — raqamlar ikkinchi darajali agregator saytlardan olindi va **«taxmin»** deb belgilanadi. Aniqlik uchun brauzerda qo'lda tekshirish tavsiya etiladi.

## 5. Ilmiy manba API'lari (loyihada `maqola` vositasi uchun)

| API | Bepul / narx | Manba | Sana |
|---|---|---|---|
| OpenAlex | **$1/kun bepul budjet** (kalitsiz ham ishlaydi, faqat 100 so'rov/soniya cheklov); pullik: Member $5000/yil ($20/kun), Member+ $10000/yil ($100/kun) | [help.openalex.org — Pricing](https://help.openalex.org/hc/en-us/articles/24397762024087-Pricing) | 2026-09-20 |
| Crossref | **Bepul, ro'yxatdan o'tish shart emas**, 50 so'rov/soniya limiti (oshsa 503) | [github.com/CrossRef/rest-api-doc](https://github.com/CrossRef/rest-api-doc) | 2026-09-20 |
| Google Books API | **Bepul**, kunlik so'rov kvotasi bor (aniq raqam ochiq hujjatda **topilmadi** — Google Cloud loyihasi konsolida ko'rinadi, standart taxminan 1000 so'rov/kun) | [support.google.com — Books API quota](https://support.google.com/books/partner/thread/406917582) | 2026-09-20 |

## 6. To'lov tizimlari (O'zbekiston)

| Tizim | Savdogar komissiyasi | Manba | Sana |
|---|---|---|---|
| Payme | **topilmadi** — rasmiy `help.payme.uz/uz/chavo/komissii/` sahifasida faqat iste'molchi (kartadan-kartaga 1.1%) komissiyasi bor, savdogar (merchant/biznes) tarifi ko'rsatilmagan, individual shartnoma orqali beriladi (1350 raqami) | [help.payme.uz/uz/chavo/komissii](https://help.payme.uz/uz/chavo/komissii/) | 2026-09-20 |
| Click | **topilmadi** — rasmiy `click.uz/uz/faq` sahifasida faqat kartadan-kartaga (Uzcard/Humo 1%) komissiyasi bor, Click Business (savdogar) tarifi ko'rsatilmagan (+998 71 231 08 80 orqali so'raladi) | [click.uz/uz/faq](https://click.uz/uz/faq) | 2026-09-20 |

Ikkalasida ham savdogar komissiyasi ochiq internetda YO'Q — odatda 1.5–3% oralig'ida bo'ladi deb aytiladi (uchinchi tomon bloglar), lekin bu **tasdiqlanmagan taxmin**, shuning uchun jadvalga kiritilmadi.

## 7. Infratuzilma

| Nima | Narx | Manba | Sana |
|---|---|---|---|
| VPS bozor diapazoni (8 vCPU / 16 GB RAM atrofida) | **Contabo:** ~$8.6–14/oy (aniq 8vCPU/16GB kombinatsiyasi emas, yaqin plan: 6 vCPU/16GB ≈ $11/oy); **Hetzner CX42:** 8 vCPU / 16 GB / 160 GB disk = **€16.40/oy (~$19/oy)**, 20 TB trafik | [contabo.com/en-us/vps](https://contabo.com/en-us/vps/), [hetzner.com/cloud/regular-performance](https://www.hetzner.com/cloud/regular-performance/) | 2026-09-20 |
| Loyiha serveri (14 GB RAM) | Provayder loyihada ko'rsatilmagan (`reference_slaydx_production` xotirasida faqat IP bor) — yuqoridagi diapazon bo'yicha taxminan **$10–20/oy** oralig'ida bo'lishi mumkin (taxmin) | — | 2026-09-20 |
| Telegram Bot API | **Butunlay bepul** — xabar/oy limiti yo'q; yagona pullik funksiya — Paid Broadcasts (30/soniyadan yuqori translyatsiya, ~0.1 Stars/xabar ≈ $0.002), loyihaga aloqasi yo'q | Telegram rasmiy hujjatlari (bevosita fetch 403/bloklandi, ikkinchi darajali: optimum-web.com/botract.com orqali tasdiqlandi) | 2026-09-20 |

## 8. USD → UZS kursi

| Sana | Kurs | Manba |
|---|---|---|
| 2026-09-19 | **1 USD = 11 839.59 UZS** (rasmiy, Markaziy bank kuniga bir marta 16:00da e'lon qiladi) | [cbu.uz](https://cbu.uz/uz/) |

**Kodda:** `lib/generation/llm-pricing.ts` dagi `soumPerUsd()` standart qiymati **12 700** — bu rasmiy
kursdan (**11 839.59**) taxminan **7.3% yuqori** (eski/zaxira qiymat bo'lishi mumkin; `SOUM_PER_USD`
env orqali qayta belgilanadi, shuning uchun productionda haqiqiy qiymat boshqacha bo'lishi mumkin —
buni env'dan tekshirish tavsiya etiladi, bu fayl faqat standart fallback'ni qayd etadi).

## Topilmadi ro'yxati (qisqa)

- Payme va Click **savdogar** komissiyasi foizi — ochiq manbada yo'q.
- Aisha AI / VoiceLab.uz TTS narxi (so'm/belgi yoki so'm/soniya) — ochiq narx sahifasi yo'q.
- Google Books API aniq kunlik so'rov kvotasi (raqam) — ochiq hujjatda yo'q.
- fal.ai FLUX boshqa variantlari (dev, FLUX.2) narxi — model sahifasida ko'rsatilmagan.
- Loyiha production serverining aniq provayderi — CLAUDE.md/xotirada faqat IP bor, provayder nomi yo'q.
- Azure/Google Cloud TTS rasmiy raqamlari — JS render tufayli WebFetch bilan birlamchi manbadan tasdiqlanmadi (faqat ikkinchi darajali manba, "taxmin" belgisi bilan).
