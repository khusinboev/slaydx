# Qolgan bosqichlar — o‘z mahsulot sifatida qurish

Klonlash shu yerda to‘xtaydi. `sodda-web` endi **o‘z loyihangizning boshlang‘ich qobig‘i**: UI skeleti, 13 ta vosita formasi, demo kirish, lokal fayl chiqishi. Bundan keyin maqsad sodda.ai ni nusxalash emas — shu qobiq ustida **o‘z backend, AI, to‘lov va sifat** ni qurish.

Asosiy ma’lumot: `SODDAAI_TIZIM_HISOBOTI.md` (API/mahsulot tahlili). U yerda yozilgan xavfsizlik teshiklarini (`user_id` body, global list) **ko‘chirmang**.

---

## 0. Hozir nima tayyor

> Yangilangan: 2026-08-14. 1–6 bosqichlarning texnik qismi yopildi.

| Qism | Holat |
|---|---|
| Next.js qobiq, sidebar, header, qidiruv, sozlama, bildirishnoma | ✅ |
| 14 vosita formasi | ✅ |
| PostgreSQL + migratsiyalar (`lib/server/migrations`) | ✅ 1-bosqich |
| Sessiya: httpOnly cookie, bazada hash, «hamma joydan chiqish» | ✅ 2-bosqich |
| Telegram Login Widget + Mini App `initData` (imzo serverda) | ✅ 2-bosqich |
| OTP: 5 xonali kod, 2 daqiqa, 5 urinish, hash holida | ⚠️ 2-bosqich — **yetkazuvchi ulanmagan** |
| Kredit: ball → kvota → balans, jurnal, idempotent, qaytarish | ✅ 3-bosqich |
| Job queue: `QUEUED → IN_PROGRESS → COMPLETED \| FAILED \| REVOKED` | ✅ 4-bosqich |
| Worker: inline yoki alohida process, osilib qolganini tiklash | ✅ 4-bosqich |
| Generatsiya: Gemini / xAI + shablon zaxira, DOCX/PPTX/PNG | ✅ 4-bosqich |
| Fayl ombori: bazada, TTL bilan, egalik tekshiruvi | ✅ 5-bosqich |
| Click + Payme: imzo tekshiruvi, idempotent webhook | ✅ 6-bosqich |
| Rate limit, xavfsizlik sarlavhalari, `/api/health`, xato chegaralari | ✅ 9-bosqich |
| Testlar (39 ta), Docker, docker-compose | ✅ |
| PDF eksport, SuperDoc tahrir, i18n (interfeys) | ❌ |
| Telegram bot, OTP bot | ❌ 7-bosqich |
| Test / o‘yin / podkast / tabriknoma | ❌ 8-bosqich |

**Qolgan asosiy qarz:**

1. **Brend** (1-bosqich) — nom, logo, domen hali `sodda.ai` dan. `NEXT_PUBLIC_BRAND_NAME`
   bor, lekin matn va logotip almashtirilishi kerak. Bu huquqiy masala, birinchi qilinsin.
2. **OTP yetkazish** — kod yaratiladi va tekshiriladi, lekin foydalanuvchiga yuborilmaydi.
   Telegram OTP bot yoki SMS provayder kerak (7-bosqich bilan birga).
3. **To'lov kalitlari** — kod tayyor, Click/Payme merchant hisobi ochilishi kerak.
4. **Interfeys tarjimasi** — matnlar kodda o‘zbekcha qattiq yozilgan.

**Qoida:** keyingi ishni “asl saytdagi kabi qilamiz” deb emas, “talaba/o‘qituvchi shu yerda yakuniy fayl oladi” deb rejalang.

---

## 1-bosqich — Mahsulot va texnik poydevor

**Maqsad:** klon emas, o‘z brend/stack. UI qolishi mumkin, lekin nom, domen, token, to‘lov o‘zingizniki.

- [ ] Nom, logo, domen, til (avval `uz`, keyin ru/en)
- [ ] Repo: `sodda-web` ni o‘z gitiga ajratish; `sodda-ai` (do‘kon boti) va `sodda-ai-mobile` (WebView) ni asos qilmang
- [ ] Backend tanlash: FastAPI yoki shu Next.js ichida Route Handler + worker
- [ ] DB: PostgreSQL (users, sessions, generations, transactions, writer_profile)
- [ ] Fayl ombori: S3-mos (Spaces / MinIO) + TTL (aslida ~24 soat)
- [ ] Env: `DATABASE_URL`, `JWT_SECRET`, `LLM_*`, to‘lov kalitlari — hech narsa frontendga chiqmasin
- [ ] Job status: `QUEUED → IN_PROGRESS → COMPLETED | FAILED | REVOKED`

**Tayyor deyish:** bo‘sh backend `/health`, migratsiya, bitta `users` jadvali.

---

## 2-bosqich — Haqiqiy auth

**Maqsad:** demo modal o‘rniga sessiya.

Tartib (sodda.ai dagi kabi, lekin o‘z bot):

1. Telegram Mini App `init_data` → `POST /auth/webapp`
2. Telegram Login Widget (brauzer)
3. OTP: 5 xonali kod, alohida OTP bot, 2 daqiqa

- [ ] JWT access + refresh, rotatsiya, `kind=user` (admin alohida)
- [ ] Cookie httpOnly **yoki** faqat server session. `localStorage` dagi token uzoq muddat qolmasin
- [ ] `GET /users/me`, sessiyalar ro‘yxati, chiqish / hamma joydan chiqish
- [ ] Writer profile: universitet, fakultet, kafedra, muallif, fan, o‘qituvchi, shahar — forma defaultlari shundan
- [ ] Google/Apple — ixtiyoriy, oxirida

**Tayyor deyish:** Telegram orqali kirib, `/uz/essay` ochiladi; token yangilanadi; logout ishlaydi.

---

## 3-bosqich — Kredit va tarif (to‘lovsiz ichki hisob)

**Maqsad:** avval pul ulamasdan, ball/kvota mantiqini yopish.

- [ ] 3 qatlam: `points` (bonus) → `quota` (Pro) → `balance` (so‘m)
- [ ] Yangi user: masalan 3000 ball
- [ ] Pro: 15 000 so‘m / 30 kun / 15 000 kvota (yoki o‘z narxingiz)
- [ ] Narx jadvali (`pricing`): const / bet / sifat. Hozirgi UI dagi raqamlar bilan moslang
- [ ] `POST /subscriptions/buy` — avval faqat balansdan (test)
- [ ] Tranzaksiya jurnali: charge, cashback, topup
- [ ] Yetarli emas → “Balansni to‘ldirish” (`/uz/purchase`)

**Tayyor deyish:** insho 2000 ball yechadi; qayta urinishda dublikat yechilmaydi; bekor qilingan queued ish pulni qaytaradi.

---

## 4-bosqich — Generation engine (asosiy qiymat)

**Maqsad:** shablon o‘rniga haqiqiy kontent. Pul ketmasligi uchun avval bitta arzon/lokal model.

Tavsiya etilgan tartib (arzon → qimmat):

1. Bitta yozuvchi oilasi: **Insho** (qisqa, 1–5 varaq) — sifatni shu yerda o‘rganasiz
2. Referat / mustaqil ish (per_page)
3. Kurs ishi (uzun, mundarija, vazirlik)
4. Maqola / tezis (IMRAD)
5. Glossariy, kalitlar, texnologik xarita, dars rejasi
6. Slayd (alohida pipeline)
7. Rezyume wizard
8. Tarjimon (fayl parse + token narx)

Har bir vosita uchun:

- [ ] Prompt + struktura (titul, mundarija, kirish, boblar, xulosa, adabiyot)
- [ ] Til: forma tillari (uz, kaa, kk, ky, tg, tk, ru, en…)
- [ ] Writer profile titulga tushishi
- [ ] Fayl: DOCX (Times New Roman, 14pt, 1.5 interval, A4, 2–2.5 sm)
- [ ] PDF export (LibreOffice/headless yoki alohida converter)
- [ ] Job queue (Celery / BullMQ / pg-boss) — so‘rovni HTTP da ushlab turmang
- [ ] Progress: WS yoki polling `GET /generations/{id}`
- [ ] Bekor: faqat `QUEUED` / erta `IN_PROGRESS`
- [ ] Xato: userga tushunarli matn, pul qaytarish

**Slayd alohida:**

- [ ] Mavzu yoki fayl → outline → slaydlar → PPTX
- [ ] Sifat paketlari (3k / 5k / 6k / 8k)
- [ ] Ixtiyoriy: shablon, rasm (keyinroq, qimmat)

**Tayyor deyish:** 5 ta real insho (turli til/varaq) ochib, universitet tituliga o‘xshaydi; navbat 2+ ishni parallel yutmaydi.

---

## 5-bosqich — Fayl hayoti va tahrir

- [ ] `GET /generations/my` — filter: barchasi / slayd / hujjat
- [ ] Ko‘rish: HTML preview (hozirgi iframe) yetarli start
- [ ] Yuklab olish: DOCX / PPTX / PDF, sanash
- [ ] O‘chirish: faqat yakunlangan
- [ ] TTL: muddati o‘tgach URL o‘chadi
- [ ] Keyin: Word tahrir (SuperDoc yoki onlyoffice) — **oxirgi** qilib qo‘ying, erta qimmat

**Tayyor deyish:** yaratilgan fayl 1 soatdan keyin ham ochiladi; o‘chirilgach list tozalanadi.

---

## 6-bosqich — To‘lov

- [ ] Click, Payme (asosiy). Uzum/Paynet — keyin
- [ ] `POST /payments/orders` → provider URL
- [ ] Webhook imzo tekshiruvi, idempotent
- [ ] Muvaffaqiyat: balance yoki Pro quota
- [ ] 10% cashback — ixtiyoriy
- [ ] UI: `/uz/purchase` dagi “Pro'ga o‘tish” endi haqiqiy order

**Tayyor deyish:** test karta/click sandbox dan 15 000 tushadi, Pro 30 kun ochiladi. Ikki marta webhook = ikki marta pul emas.

---

## 7-bosqich — Telegram

Web barqaror bo‘lgach:

- [ ] Bot: `/start`, Mini App tugmasi
- [ ] OTP bot (web login)
- [ ] Mini App avto-login
- [ ] (Ixtiyoriy) natijani Telegramga yuborish

Mobil: hozirgi Flutter WebView ni **o‘z URL** ingizga o‘girish yetadi. Native ekran yozmang.

---

## 8-bosqich — Qolgan vositalar (ixtiyoriy)

Faqat 1–6 yopilgach:

- Test, atestatsiya
- Infografika, AI rasm
- Krossvord, flesh karta, tinglash, saralash
- Podkast, tabriknoma

Har biri alohida sprint. Avvalgi 13 tani buzmasin.

---

## 9-bosqich — Sifat, xavfsizlik, chiqish

- [ ] Auth: user faqat o‘z generationini ko‘radi (IDOR yo‘q)
- [ ] Rate limit, fayl hajmi (tarjima ≤ 20 MB)
- [ ] PII logda yo‘q
- [ ] i18n: `uz` to‘liq, keyin `ru`/`en`
- [ ] Dark/system allaqachon UI da — saqlang
- [ ] Sentry + oddiy analitika
- [ ] Staging + production, backup
- [ ] 10 ta real foydalanuvchi beta: insho + slayd + to‘lov

---

## Tavsiya etilgan ketma-ketlik (8–10 hafta, 1–2 kishi)

| Hafta | Bosqich | Chiqish |
|---|---|---|
| 1 | 1 — poydevor | DB, health, deploy |
| 2 | 2 — auth | Telegram kirish |
| 3 | 3 — kredit | Ball yechiladi |
| 4–5 | 4a — insho + referat | Birinchi “haqiqiy” fayl |
| 6 | 4b — kurs ishi, maqola, tezis, metodika | Yozuvchi oilasi |
| 7 | 4c — slayd + rezyume + tarjimon | Mashhur to‘liq |
| 8 | 5–6 — fayl + to‘lov | Pul tushadi |
| 9+ | 7–9 | Bot, beta, qolgan vositalar |

To‘xtash nuqtalari: 2-dan keyin ichki demo; 4a dan keyin birinchi haqiqiy user; 6 dan keyin pullik ochish.

---

## Qilmang (hali)

- Qolgan sodda.ai sahifalarini (test, o‘yin, rasm) klonlash
- SuperDoc / slayd editor ni birinchi haftada
- 6 tilni bir vaqtda
- `sodda-ai` bot kodini generatorga aylantirish — u do‘kon boti
- Clientga `user_id` yuborish, boshqa user listini ochish

---

## Keyingi aniq qadam

Texnik poydevor tayyor (Next.js + Postgres tanlandi, `lib/server/`). Endi
qolgani — tashqi hisoblar va brend:

1. **Brend.** Nom, logo, domen. `NEXT_PUBLIC_BRAND_NAME` dan boshlang, keyin
   `components/` dagi matnlar va `public/logo.png`.
2. **Telegram bot.** @BotFather da bot oching → `TELEGRAM_BOT_TOKEN`.
   Shundan keyin haqiqiy kirish ishlaydi va `DEV_LOGIN_ENABLED` ni o‘chirish mumkin.
3. **OTP yetkazish.** Shu bot orqali kodni yuboruvchi funksiya
   (`lib/server/auth.ts` → `issueLoginCode` natijasini botga uzating).
4. **To‘lov hisobi.** Click va Payme merchant kabinet → `.env` ga kalitlar.
   Webhook manzillari README da.
5. **Deploy.** `docker compose up` yoki Vercel + boshqariladigan Postgres.
   Vercel da `WORKER_INLINE=false` qilib worker ni alohida joyda ko‘taring —
   serverless funksiya uzoq ishlay olmaydi.

Har biri kod emas, hisob/sozlama ishi. Kod tomonidan hammasi kutmoqda.
