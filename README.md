# SlaydX

Ta'lim hujjatlarini AI bilan yaratuvchi web ilova: slayd, insho, kurs ishi, referat,
maqola, tezis, rezyume, tarjima, glossariy, dars rejasi va boshqalar — 15 ta vosita
(shundan ikkitasi taqdimot: oddiy **slayd** va **pro slayd**).

Chiqish: **DOCX / PPTX / PNG**.

---

## Arxitektura

```
Brauzer ──► Next.js Route Handlers ──► PostgreSQL
                    │                      ▲
                    │  navbatga qo'yadi    │ holat, fayl
                    ▼                      │
                 Worker ────► Gemini / Claude / xAI
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
docker run -d --name slaydx-pg \
  -e POSTGRES_USER=slaydx -e POSTGRES_PASSWORD=slaydx -e POSTGRES_DB=slaydx \
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
| `GEMINI_API_KEY` | «Rasm» vositasi va pro-slayd rasmlari ishlamaydi (oddiy slayd rasmlari stock'dan — Pexels/Pixabay) |
| `PEXELS_API_KEY` / `PIXABAY_API_KEY` | Oddiy slaydlar rasmsiz (bepul stock manbalar yo'q, rasm va'da qilinmaydi) |
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

Ikkala oqimda ham sessiya **bir martalik havolani bosgan brauzerda** ochiladi
(`GET /api/auth/telegram/enter?t=<token>`): token 32 tasodifiy bayt, bazada
faqat xesh, 5 daqiqa, bir marta. Havola faqat foydalanuvchining Telegram
chatiga boradi — shuning uchun «o'z havolasini qurbonga yuborish» hujumi
ishlamaydi: tajovuzkor brauzeri tokenni ko'rmaydi.

**Saytdan:** «Telegram orqali kirish» → sayt chipta (`nonce`) ochadi va
`t.me/<bot>?start=<nonce>` ga yuboradi → bot chiptani profilga bog'lab
kirish havolasini yuboradi → foydalanuvchi bosadi → sayt kirgan holda ochiladi.

**Botdan (yangi):** foydalanuvchi botga oddiy `/start` yoki `/login` bosadi →
bot chiptani va havolani **o'zi** yaratadi (`createBotLoginLink`) va
«🔑 Saytga kirish» tugmasini yuboradi → bosganda avtomatik kiradi. Nonce bu
oqimda brauzerga umuman chiqmaydi. Boshqa har qanday matnga bot «/login
yozing» deb javob beradi. Bot menyusi: `npm run bot:commands` (`setMyCommands`).

Mini App ichida havola kerak emas — `initData` imzosi yetarli.

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

## Ishlab chiqarish (slaydxx.uz)

Server: `root@<SERVER_IP>` (aniq manzil — egasining `.env`/deploy sozlamasida),
jild `/opt/slaydx`. Serverda boshqa loyihalar ham bor (bir nechta nginx
sayti, bir nechta bot xizmati) — shuning uchun hamma narsa ajratilgan:

| | |
|---|---|
| Compose proyekt nomi | `slaydx` (`docker compose -p slaydx`) |
| Konteynerlar | `slaydx-web-1`, `slaydx-worker-1`, `slaydx-worker-2`, `slaydx-postgres-1` (C22: worker 2 replika) |
| Port | `127.0.0.1:3000` — faqat localhost, nginx proxy qiladi |
| Postgres | konteyner ichida, host portiga CHIQARILMAGAN |
| nginx | `/etc/nginx/sites-available/slaydx`, `default_server` emas |
| Kod | GitHub'dan faqat o'qish huquqli deploy kaliti bilan |

```bash
ssh root@<SERVER_IP>
/opt/slaydx/deploy.sh          # main dan yangi versiya
/opt/slaydx/enable-https.sh    # DNS tayyor bo'lgach — certbot
docker compose -p slaydx logs -f web
```

Sirlar `/opt/slaydx/.env` da (huquq 600). `SESSION_SECRET`,
`POSTGRES_PASSWORD` va `CRON_SECRET` shu server uchun alohida
yaratilgan — lokal qiymatlar takrorlanmagan.

### Resurs chegaralari (C18, `docker-compose.yml`)

Box uchta loyiha bilan umumiy — har service'ning xotira/CPU chegarasi
`.env` orqali sozlanadi (standartlar quyida, o'zgartirmasa shular ishlaydi):

| O'zgaruvchi | Standart | Nima uchun |
|---|---|---|
| `WEB_MEM_LIMIT` | `2g` | `web` konteyner xotira shifti |
| `WEB_CPUS` | `2` | `web` konteyner CPU shifti |
| `WORKER_MEM_LIMIT` | `2g` | HAR BIR worker konteyner (2 replika — C22) xotira shifti |
| `WORKER_CPUS` | `2` | HAR BIR worker konteyner CPU shifti |
| `PG_MEM_LIMIT` | `1g` | Postgres konteyner xotira shifti |
| `PG_CPUS` | `1` | Postgres konteyner CPU shifti |

**Deploy oldidan tekshiring:** `docker info --format '{{.NCPU}}'` — agar
host'da jami CPU soni `WEB_CPUS + 2×WORKER_CPUS + PG_CPUS`dan kam bo'lsa,
Docker konteynerni "Range of CPUs is from 0.01 to N" xatosi bilan
ko'tarmaydi; kerak bo'lsa `.env`da kichikroq qiymat bering. Peak xotira
ish boshiga hali o'lchanmagan (`audit/designs/capacity.md`) — 2g ishonchli
chegara deb tasdiqlanguncha `docker stats` bilan kuzating.

**HTTPS hali yo'q:** `slaydxx.uz` DNS'da umuman ko'rinmaydi (A ham, NS
ham yo'q). Domen shu serverga yo'naltirilgach `enable-https.sh` ni
ishga tushiring — u avval DNS ni tekshiradi va mos kelmasa certbot'ni
umuman chaqirmaydi, chunki muvaffaqiyatsiz urinishlar Let's Encrypt
chegarasini yeydi.

### Zaxira (backup)

Ilgari zaxira faqat qo'lda, deploydan oldin olinardi va bitta diskda
saqlanardi — tiklash hech qachon sinalmagan edi (INFRA-05). Endi ikkita
skript bor (`scripts/backup.sh`, `scripts/restore-check.sh`), lekin ular
faqat REPO'da — serverga o'rnatish (cron qo'shish) egasi tomonidan
qo'lda bajariladi:

```bash
# /etc/cron.d/slaydx-backup yoki `crontab -e` (root):
30 3 * * * /opt/slaydx/scripts/backup.sh >> /var/log/slaydx-backup.log 2>&1
0 5 * * 0 /opt/slaydx/scripts/restore-check.sh >> /var/log/slaydx-backup.log 2>&1
```

`backup.sh` — `pg_dump -Fc` (siqilgan, `bytea` ikki barobar shishmaydi)
`${BACKUP_DIR:-/root/slaydx-backups}` ga, `pg_restore --list` bilan
tekshirilgan, `BACKUP_KEEP_DAYS` (standart 7) dan eskisi o'chiriladi.
`restore-check.sh` — eng so'nggi dumpni MUSTAQIL (`slaydx-*` OILASIGA
UMUMAN TEGMAYDIGAN), vaqtinchalik Postgres konteynerga tiklab, asosiy
jadvallar va balans invariantini (`balance == sum(transactions)`)
tekshiradi, oxirida shu vaqtinchalik konteynerni o'chiradi. Ikkalasi ham
hech qachon `docker compose down`/prune ishlatmaydi va boshqa (slaydx
yoki qo'shni loyiha) konteynerlariga tegmaydi (`.claude/deploy.md`ning
umumiy box qoidasi).

**Box tashqarisiga nusxa va Telegram alert — FAQAT `/etc/slaydx/backup.env`
orqali.** `cron` BO'SH muhitda ishga tushadi va `/opt/slaydx/.env`ni
O'QIMAYDI — `BACKUP_REMOTE`/`BACKUP_TG_CHAT`/`TELEGRAM_BOT_TOKEN` uchun
BOSHQA hech qanday joy YO'Q. Fayl repo checkout'idan (`/opt/slaydx`)
ATAYLAB TASHQARIDA — `git`/`docker build` uni umuman ko'rmaydi:

```bash
install -d -m 700 /etc/slaydx
cat > /etc/slaydx/backup.env <<'EOF'
BACKUP_REMOTE=b2:slaydx-backups
BACKUP_TG_CHAT=123456789
TELEGRAM_BOT_TOKEN=...
EOF
chmod 600 /etc/slaydx/backup.env
```

600 huquq shart emas — skript boshqacha ruxsat bo'lsa ochiq ogohlantiradi,
lekin baribir o'qiydi. Fayl umuman bo'lmasa — muammo emas: faqat lokal
dump olinadi, box tashqarisiga nusxa YO'Q va skript har safar buni ochiq
ogohlantiradi. Yo'l `BACKUP_ENV_FILE` bilan almashtiriladi.

### Jurnal, ish izi va metrikalar (C31)

Pul va navbat yo'llari (`worker`, `jobs`, `credits`, `payments`, to'lov
webhook'lari, `handler()` bilan o'ralgan API) `lib/server/log.ts` orqali
yozadi: har qator — **bitta JSON** (`ts, level, msg, reqId?, jobId?,
userId?, genId?, provider?, err{message, stack}` + `attempt`, `stage`,
`orderId` kabi maydonlar). Kalitlar, `?key=`, `Authorization`, telefon
raqami (oxirgi 2 raqam qoladi) jurnalga yozilishdan oldin yashiriladi.

- Har API javobida `x-request-id` sarlavhasi bor; 500 javobida u
  `requestId` sifatida ham qaytadi — foydalanuvchi shuni yuborsa, aynan
  o'sha so'rovning qatorlari topiladi.
- Foydalanuvchiga (`generations.error`, refund izohi) faqat qisqa o'zbekcha
  matn boradi; pg/provayder xatosining xom matni va stack'i faqat jurnalda.

```bash
L="docker compose -p slaydx logs --no-log-prefix --since 24h web worker"
# Bitta ishning to'liq tarixi (navbat → claim → urinishlar → xato/refund):
$L | grep -F '"jobId":"<generation-id>"' | jq -c '{ts,level,msg,attempt,stage,provider,err:.err.message}'
# Foydalanuvchi ko'rsatgan requestId bo'yicha:
$L | grep -F '"reqId":"<request-id>"' | jq .
# Pul qaytmay qolgan ishlar (housekeeping keyin qayta urinadi, lekin ko'rib chiqing):
$L | grep -F '"alert":"REFUND_FAILED"' | jq -c '{ts,jobId,userId,err:.err.message}'
```

**Metrikalar** — `scripts/metrics-report.mts` (faqat o'qiydi, READ ONLY
tranzaksiya): oxirgi N kun uchun vosita × holat bo'yicha ishlar, yiqilish
va qaytarish ulushi, o'rtacha davomiylik, to'lovlar (so'm) va yechimlar,
buyurtma holatlari, navbat kutishi p50/p95, eng ko'p xato matnlari.
Worker/web image'da `tsx` yo'q, shuning uchun lokal checkout'dan, bazaga
SSH tunnel orqali ishga tushiriladi (Postgres host portiga chiqarilmagan):

```bash
PG_IP=$(ssh root@<SERVER_IP> "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' slaydx-postgres-1")
ssh -N -L 55432:$PG_IP:5432 root@<SERVER_IP> &
DATABASE_URL=postgres://slaydx:<POSTGRES_PASSWORD>@127.0.0.1:55432/slaydx \
  scripts/heavy.sh npx tsx --conditions=react-server scripts/metrics-report.mts 7          # jadval
#                                                   ... scripts/metrics-report.mts 30 --json  # JSON
```

Tannarx/marja uchun — `scripts/cost-report.mts` (xuddi shu usulda).

## Buyruqlar

> ⚠️ **`npm run build` ni dev server ishlab turganda bajarmang.**
> Ikkalasi ham bitta `.next` jildidan foydalanadi: build uni qayta yozadi
> va dev server shundan keyin har so'rovga 500 qaytaradi
> (`ENOENT … _buildManifest.js.tmp`). Xato build vaqtida emas, keyinroq
> brauzerda «internal server error» bo'lib ko'rinadi, ya'ni sababi bilan
> bog'lash qiyin. `npm run build` buni endi o'zi tekshiradi va to'xtaydi.
> Tuzatish: dev serverni to'xtatib `rm -rf .next`.
>
> ⚠️ **Dvigatel kodini o'zgartirsangiz dev serverni qayta ishga tushiring** —
> inline worker hot reload olmaydi va eski kodni ishlatishda davom etadi.

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

`smoke` LLM provayderi uzilganini MAHSULOT nuqsonidan ajratadi: kalit
tugagan bo'lsa generatsiya yo'li «chetlab o'tildi» bo'ladi, lekin
fail-closed va REFUND yo'li aksincha tekshiriladi — provayder uzilishi
o'sha yo'lni sinash uchun eng yaxshi imkoniyat.
| `node scripts/eval-services.mjs r1` | Chiqish SIFATI: hajm, slaydlar soni, speaker notes, uydirma manba, TARIF FARQI |

`db:migrate`, `worker`, `topup`, `bot` va `smoke` `.env.local` ni o'zi
o'qiydi (`--env-file-if-exists`). Ilgari faqat `next` uni yuklardi va
qolgan skriptlar «DATABASE_URL sozlanmagan» deb yiqilardi.

**Eval har vositaning ENG QIMMAT tarifini ham sinaydi.** Buni buzmang:
loyihada uch marta shunday nuqson chiqdi — slayd sifat paketi, IMRAD
maqola va uzun kurs ishi qimmatroq tarifda ARZONI bilan bir xil natija
berardi. Eval bitta tarifda sinagani uchun uchalasi ham sezilmay qoldi.
`TIER_PAIRS` aynan shuni tekshiradi va yiqilsa eval qizil bo'ladi.

> **Diqqat:** `WORKER_INLINE=true` (standart) bo'lganda inline worker
> hot reload OLMAYDI. `lib/generation/` ni o'zgartirgach dev serverni
> qayta ishga tushiring, aks holda eval ESKI kodni sinaydi.

---

## API

| Endpoint | Nima qiladi |
|---|---|
| `GET /api/health` | Baza, navbat, yoqilgan imkoniyatlar. Baza tushsa 503 |
| `POST /api/auth/telegram` | Login Widget yoki Mini App `initData` (imzo serverda tekshiriladi) |
| `POST /api/auth/telegram/ticket` | Kirish chiptasi (saytdan boshlangan oqim) → `t.me/<bot>?start=<nonce>` |
| `GET /api/auth/telegram/enter?t=<token>` | Bir martalik kirish havolasi (ikkala oqim) → sessiya + redirect `/uz` |
| `POST /api/telegram/webhook` | Telegram update (maxfiy sarlavha bilan himoyalangan) |
| `POST /api/auth/otp?action=request\|verify` | Zaxira OTP (yetkazuvchi ulanmagan) |
| `GET\|DELETE /api/auth/session` | Joriy sessiya / chiqish (`?all=1` — hamma joydan) |
| `GET\|PATCH /api/users/me` | Profil + tranzaksiyalar jurnali |
| `GET\|POST /api/generations` | Ro'yxat / navbatga qo'yish |
| `GET\|DELETE /api/generations/{id}` | Holat / o'chirish (navbatdagisi bekor qilinib puli qaytadi) |
| `GET /api/generations/{id}/file[?format=pdf]` | DOCX / PPTX / PNG; `format=pdf` — talab bo‘yicha PDF |
| `GET /api/generations/{id}/assets/{assetId}` | Slayd va rasm mediasi |
| `POST /api/extract` | Hujjatdan matn (DOCX, PDF, PPTX, XLSX, TXT) — «fayl asosida» rejimlar uchun |
| `POST /api/uploads/source` · `DELETE /api/uploads/source/{assetId}` | Tarjimon manba fayli (≤20 MB): bayt saqlanadi, `chars` (tarjima qilinadigan segmentlar) hisoblanadi — narx shundan; skanlangan PDF 422 |
| `POST /api/uploads/template` · `GET` · `DELETE /{assetId}` | «O'z shablonim» (pro-slayd) PPTX namunasi |
| `POST /api/uploads/photo` · `GET /api/uploads/photo/{assetId}` | Rezyume surati (≤5 MB): kesilgan nusxa + asl + kesish ramkasi |
| `GET\|PUT\|DELETE /api/resume/draft` | Rezyume formasi qoralamasi (foydalanuvchiga bitta) — `/api/forms/resume/draft` o'rami |
| `GET\|PUT\|DELETE /api/forms/{toolId}/draft` | Forma qoralamasi (`form_drafts`, vosita bo'yicha bittadan; hozircha `resume`, `article`) |
| `POST /api/generations/{id}/rewrite` | Maqola «Tuzatish»: `{baseVersion, fix}` → bo'lim/annotatsiya/kalit so'z/highlights qayta yoziladi, hisobot qayta hisoblanadi (kredit yechilmaydi; 20 ta / 10 daq) |
| `POST /api/generations/{id}/polish` | Maqola/insho/talaba ishi «Hammasini tuzatish» (avto-sayqal, AUDIT-18): `{baseVersion}` → tuzatiladigan bandlar AI bilan qayta yoziladi, baholovchi qayta baholaydi, faqat ball OSHSA yoziladi; javob `{generation, ops, polish}` (kredit yechilmaydi; 3 ta / maqola / kun, 20 ta / foydalanuvchi / kun) |
| `POST /api/article/udk` | UDK taklifi: `{topic, language}` → `{udk, label, note}` (LLM `fast`; «taklif — tekshiring»; 30 ta / soat) |
| `POST /api/payments/orders` | To'lov buyurtmasi + provayder URL |
| `POST /api/payments/click` | Click Prepare/Complete webhook |
| `POST /api/payments/payme` | Payme Merchant API (JSON-RPC) |
| `PATCH /api/generations/{id}/doc` | Slaydlarni tahrirlash (operatsiyalar ro'yxati) |
| `POST /api/generations/{id}/rebuild` | PPTX faylni qayta yasash |
| `POST /api/generations/{id}/slides/{index}/image` | Slaydga rasm yuklab olish |
| `POST /api/generations/{id}/photo` | Rezyume suratini almashtirish (ko'ruvchida) |

Barcha `/api/generations*`, `/api/extract` va `/api/uploads/*` **kirishni talab qiladi**.
Egalik SQL darajasida tekshiriladi — id ni bilgan begona foydalanuvchi hech narsa ola olmaydi.

### Jonli generatsiya

Dekaning yaratilishi jonli bo'lishi mumkin: `live` maydoni IN_PROGRESS sifatida hujjatni qaytaradi.

```bash
GET /api/generations/{id}[?since=<liveSeq>]
```

Javob:
```json
{
  "generation": {
    "id": "...",
    "doc": { "slides": [...], "meta": {...} },
    "liveSeq": 42,
    "live": {
      "stage": "images",
      "progress": 0.7,
      "step": "Rasmlar · 7/12 slayd · 3/9 rasm",
      "slides": [...]
    }
  }
}
```

`?since=42` qo'yilsa va `live_seq ≥ 42` bo'lsa `live` kalit qaytarilmaydi (o'zgarish yo'q).

### Ko'ruvchida tahrirlash

Tamamlangan dekani brauzerda tahrirlash mumkin. Operatsiyalar:

```bash
PATCH /api/generations/{id}/doc
Content-Type: application/json

{
  "baseVersion": 5,
  "ops": [
    { "op": "text", "index": 2, "src": { "f": "title" }, "value": "Yangi sarlavha" },
    { "op": "delete", "index": 3 },
    { "op": "layout", "index": 1, "layout": "process" }
  ]
}
```

PPTX qayta yasash avtomatik bo'ladi (3 sekund debounce).

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
- Fayl saqlash muddati (C23): **real to'lov bilan** (balans yoki Pro `quota`) yaratilgan
  hujjatlar — **muddatsiz**; **faqat bonus** (ro'yxatdan o'tish ballari) bilan yaratilganlar —
  **180 kun**, shundan keyin fayl/rasm o'chiriladi, lekin generatsiya yozuvi va tarix (kredit
  jurnali bilan) saqlanib qoladi — foydalanuvchi "fayl muddati tugagan" holatini ko'radi
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

- **Brend.** Nom **SlaydX**, bot [@SlaydX_bot](https://t.me/SlaydX_bot).
  Nom va logo kodda qattiq yozilmagan — `lib/brand.ts` yagona manba,
  ikkita o'zgaruvchi bilan boshqariladi:

  ```bash
  NEXT_PUBLIC_BRAND_NAME=SlaydX
  NEXT_PUBLIC_BRAND_LOGO=/logo.png   # public/ ichida
  ```

  Ular yon panel, sahifa sarlavhalari, manifest va **PPTX fayl
  metadatasini** birdaniga o'zgartiradi. Belgining manbasi `brand/*.svg`,
  PNG lar shundan `sharp` bilan chiqariladi (`brand/README.md`).
  Domen hali olinmagan — ochilishdan oldin hal qilinishi kerak.
- **SMS/telefon orqali kirish yo'q.** Yagona haqiqiy kirish yo'li — Telegram.
  `/api/auth/otp` endpointi bor va tekshiruvi to'g'ri, lekin kodni telefonga
  yuboruvchi provayder ulanmagan.
- **i18n.** Interfeys matnlari kodda o'zbekcha qattiq yozilgan. Til tanlash
  generatsiya tiliga ta'sir qiladi, interfeysga emas.
- **`npm audit`: 5 ta high.** Har biri tekshirildi va hozirgi ishlatishda
  erishib bo'lmaydi:
  - `next → sharp` (libvips CVE) — `next/image` umuman ishlatilmaydi va
    `next.config.ts` da `images: { unoptimized: true }` qo'yilgan, ya'ni
    `/_next/image` hech qanday tasvirni qayta ishlamaydi va zaif kod
    yo'liga umuman kirilmaydi;
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

## Uchinchi tomon litsenziyalari

- **`@breezystack/lamejs` — LGPL-3.0.** WAV → MP3 kodlash uchun (TTS,
  `lib/generation/tts/mp3.ts`), faqat `worker` konteynerida, `loadMp3Encoder()`
  orqali **lazy** (`import()`) yuklanadi — kod o'zgartirilmagan, npm'dan
  o'zgarishsiz ishlatiladi. LGPL-3.0 shuni talab qiladi: kutubxona manbasi
  ochiq qolsin (npm ro'yxati orqali allaqachon ochiq), o'zgartirilsa —
  o'zgarishlar ham LGPL bilan tarqatilsin, va kutubxona **dinamik** bog'lanishi
  (alohida almashtirsa bo'ladigan holatda) saqlansin — bu yerda aynan shunday
  (dependency versiyasi `package.json` orqali erkin yangilanadi/almashtiriladi,
  ilova kodi bilan statik bog'lanmagan). SlaydX'ning o'zi (server kodi)
  boshqa litsenziya bilan qoladi — LGPL faqat shu bitta kutubxonaga tegishli.
- Boshqa bog'liqliklar (Next.js, React va h.k.) — odatiy MIT/Apache-2.0
  turkumidagi ochiq litsenziyalar; alohida shart qo'ymaydi. To'liq ro'yxat
  kerak bo'lsa: `npx license-checker --summary`.

