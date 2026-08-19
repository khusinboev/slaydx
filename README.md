# sodda-web

Ta'lim hujjatlarini AI bilan yaratuvchi web ilova: slayd, insho, kurs ishi, referat,
maqola, tezis, rezyume, tarjima, glossariy, dars rejasi va boshqalar — 14 ta vosita.

Chiqish: **DOCX / PPTX / PNG**.

---

## Arxitektura

```
Brauzer ──► Next.js Route Handlers ──► PostgreSQL
                    │                      ▲
                    │  navbatga qo'yadi    │ holat, fayl
                    ▼                      │
                 Worker ────► Gemini / xAI / fal.ai
```

Hujjat **HTTP so'rovi ichida yaratilmaydi**. So'rov faqat vazifani navbatga qo'yadi;
uni worker bajaradi, klient esa `GET /api/generations/{id}` bilan holatni kuzatadi.
Shu sababli brauzer yopilsa ham ish davom etadi, uzun kurs ishi timeout ga urilmaydi
va progress boshqa qurilmada ham ko'rinadi.

| Qatlam | Joylashuv |
|---|---|
| UI | `app/`, `components/` |
| API | `app/api/` |
| Server mantiqi | `lib/server/` (auth, kredit, navbat, to'lov, fayl) |
| Generatsiya dvigateli | `lib/generation/` |
| Migratsiyalar | `lib/server/migrations/*.sql` |
| Testlar | `tests/*.test.mts` |

---

## Ishga tushirish

### 1. Baza

```bash
docker run -d --name sodda-pg \
  -e POSTGRES_USER=sodda -e POSTGRES_PASSWORD=sodda -e POSTGRES_DB=sodda \
  -p 5432:5432 postgres:16-alpine
```

### 2. Sozlama

```bash
cp .env.example .env.local
# Majburiy: DATABASE_URL
# Prod uchun majburiy: SESSION_SECRET (openssl rand -base64 48)
```

Kalitlarsiz ham ishlaydi:

| Kalit yo'q | Nima bo'ladi |
|---|---|
| `GEMINI_API_KEY` / `XAI_API_KEY` | Matn shablondan yoziladi (LLM chaqirilmaydi) |
| `FAL_KEY` | Slaydlar rasmsiz, «Rasm» vositasi ishlamaydi |
| `TELEGRAM_BOT_TOKEN` | Telegram kirish o'chadi (OTP qoladi) |
| `CLICK_*` / `PAYME_*` | To'lov usuli UI da «o'chiq» ko'rinadi |

### 3. Ishga tushirish

```bash
npm install
npm run db:migrate     # ixtiyoriy — server o'zi ham qiladi
npm run dev            # 1-terminal: web + worker
npm run bot            # 2-terminal: Telegram bot (long-polling)
```

> **Diqqat:** `WORKER_INLINE=true` (standart) bo'lganda worker web process
> ichida **uzoq ishlaydigan tsikl** sifatida turadi va Next.js ning hot
> reload'ini olmaydi. `lib/generation/` yoki `lib/server/` o'zgartirilsa
> `npm run dev` ni **qayta ishga tushiring** — aks holda navbat eski kod
> bilan ishlashda davom etadi va o'zgarish chiqmagandek ko'rinadi.

[http://localhost:3000/uz](http://localhost:3000/uz)

### Telegram orqali kirish qanday ishlaydi

1. Sayt «chipta» ochadi (tasodifiy `nonce`) va `t.me/<bot>?start=<nonce>` havolasini beradi
2. Foydalanuvchi Telegram'da **Start** bosadi → bot uni taniydi
3. Bot 5 xonali kodni **aynan o'sha chatga** yuboradi
4. Foydalanuvchi kodni saytga kiritadi → sessiya ochiladi

Nega kod kerak: kodsiz, faqat `nonce` bilan avtomatik kirishda tajovuzkor o'z
havolasini qurbonga yuborib, uning nomidan o'z brauzerida sessiya ocha olardi.
Kod esa faqat qurbonning Telegramiga boradi.

Chipta 5 daqiqa, 5 urinish. Mini App ichida kod so'ralmaydi — `initData` imzosi yetarli.

**Prod da webhook:**

```bash
curl -F "url=https://<domen>/api/telegram/webhook" \
     -F "secret_token=$CRON_SECRET" \
     "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"
```

Webhook ham, `npm run bot` ham bir xil `handleUpdate` ni chaqiradi.

`DEV_LOGIN_ENABLED=true` bo'lsa zaxira OTP kodi javobda qaytadi (SMS ulanmagan).
**Prod da bu bayroq yoqilsa server ishga tushmaydi** — himoya ataylab qattiq.

### Docker bilan

```bash
export SESSION_SECRET=$(openssl rand -base64 48)
docker compose up --build
```

`web` va `worker` alohida konteyner; migratsiya web ko'tarilganda qo'llanadi.

---

## Buyruqlar

```bash
npm run dev          # ishlab chiqish
npm run build        # prod build
npm run check        # typecheck + lint + test
npm test             # faqat testlar
npm run db:migrate   # migratsiyalar
npm run worker       # alohida worker (WORKER_INLINE=false bilan)
npm run bot          # Telegram bot (long-polling, lokal uchun)
npm run topup -- <username> <miqdor> [points|quota|balance]
npm run smoke        # uchidan-uchiga tutun sinovi (server ishlab turishi kerak)
```

Uch xil tekshiruv bir-birini to'ldiradi:

| Buyruq | Nimani tekshiradi |
|---|---|
| `npm run check` | Kod: tiplar, lint, birlik testlari |
| `npm run smoke` | Tizim ishlayaptimi: kirish, sahifalar, ko'ruvchilar, yaratish→yuklab olish→o'chirish, xato yo'llari |
| `node scripts/eval-services.mjs r1` | Chiqish SIFATI: hajm, slaydlar soni, speaker notes, uydirma manba |

---

## API

| Endpoint | Nima qiladi |
|---|---|
| `GET /api/health` | Baza, navbat, yoqilgan imkoniyatlar. Baza tushsa 503 |
| `POST /api/auth/telegram` | Login Widget yoki Mini App `initData` (imzo serverda tekshiriladi) |
| `POST /api/auth/telegram/ticket[?action=verify]` | Kirish chiptasi: bot havolasi / kodni tasdiqlash |
| `POST /api/telegram/webhook` | Telegram update (maxfiy sarlavha bilan himoyalangan) |
| `POST /api/auth/otp?action=request\|verify` | Zaxira OTP (yetkazuvchi ulanmagan) |
| `GET\|DELETE /api/auth/session` | Joriy sessiya / chiqish (`?all=1` — hamma joydan) |
| `GET\|PATCH /api/users/me` | Profil + tranzaksiyalar jurnali |
| `GET\|POST /api/generations` | Ro'yxat / navbatga qo'yish |
| `GET\|DELETE /api/generations/{id}` | Holat / o'chirish (navbatdagisi bekor qilinib puli qaytadi) |
| `GET /api/generations/{id}/file[?format=pdf]` | DOCX / PPTX / PNG; `format=pdf` — talab bo‘yicha PDF |
| `GET /api/generations/{id}/assets/{assetId}` | Slayd va rasm mediasi |
| `POST /api/extract` | Hujjatdan matn (DOCX, PDF, PPTX, XLSX, TXT) |
| `POST /api/payments/orders` | To'lov buyurtmasi + provayder URL |
| `POST /api/payments/click` | Click Prepare/Complete webhook |
| `POST /api/payments/payme` | Payme Merchant API (JSON-RPC) |

Barcha `/api/generations*` va `/api/extract` **kirishni talab qiladi**.
Egalik SQL darajasida tekshiriladi — id ni bilgan begona foydalanuvchi hech narsa ola olmaydi.

---

## Navbat kafolatlari

- Yechish va navbatga qo'yish **bitta tranzaksiyada** — to'lanmagan ish navbatga tushmaydi
- `FOR UPDATE SKIP LOCKED` — bir vazifani ikki worker olmaydi
- Worker natijani yozishdan oldin **qulf hali o'zida ekanini** tekshiradi;
  bo'lmasa natija tashlanadi (uzoq ish qayta navbatga tushgan holat)
- Progress yangilanishi ayni paytda qulf «heartbeat»i — sog'lom uzoq ish
  o'lik deb hisoblanmaydi
- Osilib qolgan ish 2 urinishdan keyin `FAILED` bo'ladi va **puli qaytariladi**

## Kredit modeli

Uch qatlam, shu tartibda yechiladi: **ball** (bonus) → **kvota** (Pro) → **balans** (so'm).

- Yangi akkaunt: 3 000 ball
- Pro: 15 000 so'm / 30 kun / 15 000 kvota
- Narx **serverda** hisoblanadi — klient yuborgan `price` e'tiborsiz qoladi
- Har harakat `transactions` jurnaliga tushadi; balans jurnaldan qayta hisoblanishi mumkin
- Yechish va navbatga qo'yish **bitta tranzaksiyada**
- Xato yoki bekor qilishda pul **aynan olingan hamyonga** qaytadi
- `reference` bo'yicha idempotent: bitta ish ikki marta yechilmaydi, bitta webhook ikki marta pul qo'shmaydi

## To'lov

`POST /api/payments/orders` buyurtma yaratadi va provayder URL ini qaytaradi.
Kredit **faqat webhook tasdiqlagandan keyin** qo'shiladi.

Provayder panelida webhook manzillari:

```
Click:  https://<domen>/api/payments/click     (Prepare va Complete uchun bir xil)
Payme:  https://<domen>/api/payments/payme
```

Click imzosi MD5 formulasi bo'yicha, Payme esa `Basic Paycom:<KEY>` bilan tekshiriladi;
ikkalasi ham doimiy vaqtli taqqoslash ishlatadi.

---

## Xavfsizlik

**Autentifikatsiya**
- Sessiya tokeni httpOnly cookie da; bazada faqat SHA-256 hashi
- Telegram imzosi bot token bilan serverda tekshiriladi — klient `user_id` siga ishonilmaydi
- Kirish kodi hash holida, 5 daqiqa, 5 urinish, bir martalik
- Telegram akkaunti (`telegram_id`) va telefon akkaunti (`local_id`) **alohida fazolar** —
  bir fazodagi identifikator boshqasidagi akkauntga tusha olmaydi

**So'rov darajasida**
- CSRF: `Origin` + `Sec-Fetch-Site` qat'iy tekshiriladi (holat o'zgartiruvchi metodlarda)
- Rate limit: generatsiya 5/daqiqa va 60/soat, extract 20/5 daqiqa, chipta 10/5 daqiqa
- Yuklangan fayl hajmi **tahlildan oldin** tekshiriladi; ZIP ochilish byudjeti bor (zip bomb)
- Kutilmagan xato matni klientga chiqmaydi (faqat log da)
- `/api/health` batafsil javobi `CRON_SECRET` talab qiladi

**Ma'lumot**
- Egalik SQL darajasida: id ni bilgan begona foydalanuvchi hujjat ham, rasm ham ola olmaydi
- Fayl va media `FILE_TTL_HOURS` dan keyin, generatsiya yozuvlari 90 kundan keyin o'chadi
- CSP, HSTS, nosniff, Referrer-Policy, Cross-Origin-Resource-Policy

**Ma'lum cheklov:** `script-src` da `'unsafe-inline'` bor — Next.js inline runtime
skriptlaridan foydalanadi. Nonce ga o'tish middleware talab qiladi.

### Telegram Mini App haqida

`X-Frame-Options` **ataylab qo'yilmagan**: u faqat bitta qiymatni qabul qiladi va
Mini App ni (`web.telegram.org` iframe i) butunlay bloklardi. O'rniga CSP
`frame-ancestors` ishlatiladi — u aniqroq va zamonaviy brauzerlarda XFO dan ustun.

Telegram'ning **web** versiyasida ishlatmoqchi bo'lsangiz
`SESSION_COOKIE_SAMESITE=none` qo'ying (HTTPS shart). Mobil ilovada kerak emas.

---

## Ma'lum cheklovlar

- **Brend.** Nom va logo hali `sodda.ai` dan. Endi ular kodda qattiq
  yozilmagan — `lib/brand.ts` yagona manba, ikkita o'zgaruvchi bilan
  boshqariladi:

  ```bash
  NEXT_PUBLIC_BRAND_NAME=Mening.ai
  NEXT_PUBLIC_BRAND_LOGO=/mening-logo.png   # public/ ichiga qo'ying
  ```

  Ular yon panel, sahifa sarlavhalari, manifest va **PPTX fayl
  metadatasini** birdaniga o'zgartiradi. Domen esa alohida masala —
  bu huquqiy jihat, ochilishdan oldin hal qilinishi kerak.
- **SMS/telefon orqali kirish yo'q.** Yagona haqiqiy kirish yo'li — Telegram.
  `/api/auth/otp` endpointi bor va tekshiruvi to'g'ri, lekin kodni telefonga
  yuboruvchi provayder ulanmagan.
- **i18n.** Interfeys matnlari kodda o'zbekcha qattiq yozilgan. Til tanlash
  generatsiya tiliga ta'sir qiladi, interfeysga emas.
- **`npm audit`: 5 ta high.** Har biri tekshirildi va hozirgi ishlatishda
  erishib bo'lmaydi:
  - `next → sharp` (libvips CVE) — `next/image` umuman ishlatilmaydi va
    `next.config.ts` da `images` sozlamasi yo'q, ya'ni optimizator hech
    qachon ishga tushmaydi;
  - `next → postcss` (XSS, sourceMappingURL) — PostCSS faqat build
    vaqtida, faqat bizning CSS ustida ishlaydi;
  - `pptxgenjs → image-size` (ICNS/JXL/HEIF parserlarida DoS) — rasm
    baytlari `sniffImageType` bilan tekshiriladi va faqat haqiqiy PNG
    yoki JPEG o'tadi.

  Tuzatish `next@16` ga o'tishni talab qiladi (breaking). Uni alohida
  vazifa sifatida rejalashtiring; yuqoridagi tahlil eskirmasligi uchun
  `next/image` yoki foydalanuvchi yuklaydigan rasm qo'shilsa qayta
  ko'rib chiqing.
- Fayllar Postgres `BYTEA` da (25 MB chegara). Hajm o'sganda S3 ga ko'chirish kerak.

