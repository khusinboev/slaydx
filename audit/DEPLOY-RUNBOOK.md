# SlaydX — prod-readiness auditni deploy qilish (runbook)

Bu fayl `audit/production-readiness` filialidagi barcha to'lqinlar (W1-W4)
`main`ga birlashtirilgach, orchestrator server'ga deploy qilishda amal
qiladigan qo'shimcha qo'llanma. Umumiy deploy jarayoni **`.claude/deploy.md`**
da (bu yerda TAKRORLANMAYDI, faqat ushbu audit uchun XOS farqlar va
qo'shimcha tekshiruvlar). Server manzili hech qachon shu faylga yozilmaydi —
`<SERVER_IP>` bilan almashtirilgan; haqiqiy IP `.claude/deploy.md`da (bu
fayl reponing public qismida emas — `.claude/` gitignore'da).

**Muhim:** `ADMIN_PHONES` uchun HAQIQIY raqamlar bu faylga HECH QACHON
yozilmaydi — faqat egasi tomonidan to'g'ridan-to'g'ri serverdagi
`/opt/slaydx/.env`ga qo'yiladi.

## 1. Oldindan tekshiruvlar (pre-checks)

Serverga SSH orqali kirib (`ssh root@<SERVER_IP>`), deploydan OLDIN:

```bash
# 1. CPU — kamida 2 yadro (compose'da web/worker/postgres `cpus:` chegaralari
#    JAMI 7 ga yaqin so'raydi, lekin bu SOFT limit — reservatsiya emas;
#    box UCHTA loyiha bilan umumiy, shuning uchun haqiqiy bo'sh yadro sonini
#    ham tekshiring, `uptime` bilan load average'ni solishtiring).
nproc
uptime

# 2. Docker Compose v2 SHART (`docker compose ...`, `docker-compose` emas —
#    `deploy.sh` va bu runbook `docker compose -p slaydx` shaklida yozadi).
docker compose version   # "Docker Compose version v2.x.y" kutiladi

# 3. Bo'sh disk — build (LibreOffice/shrift paketlari, `.claude/deploy.md`
#    §2 da uzoq build sifatida tilga olingan) + yangi postgres image
#    (16.15-alpine3.24, agar hali tortilmagan bo'lsa) + pg_dump zaxira
#    uchun kamida 5-10 GB bo'sh joy tavsiya etiladi.
df -h /var/lib/docker /root /opt/slaydx

# 4. pg_dump zaxira + ROLLBACK.txt — `.claude/deploy.md` §1 AYNAN shu
#    ketma-ketlikda, HAR DOIM deploydan oldin:
mkdir -p /root/slaydx-backups
ts=$(date +%Y%m%d%H%M%S)
docker exec slaydx-postgres-1 pg_dump -U slaydx slaydx > /root/slaydx-backups/slaydx-$ts.sql
cd /opt/slaydx && git rev-parse --short HEAD > /root/slaydx-backups/ROLLBACK.txt
cat /root/slaydx-backups/ROLLBACK.txt   # keyinroq §7 uchun kerak bo'ladi
```

`docker ps` bilan deploydan OLDIN konteynerlar ro'yxatini yozib qo'ying
(`.claude/deploy.md` "Qat'iy taqiqlar" §6) — deploydan keyin solishtirish
uchun (§5).

## 2. Yangi env o'zgaruvchilar — prod `.env`ga qo'shish

`git diff 76ddf91 -- .env.example docker-compose.yml` orqali chiqarilgan —
bu audit filiali `76ddf91`dan (oxirgi ma'lum deploy nuqtasi) beri
qo'shilgan HAMMA yangi o'zgaruvchi. Hech biri **MAJBURIY** emas — compose
har birini `${VAR:-standart}` bilan o'rab beradi, ya'ni `.env`da yo'q
bo'lsa ham deploy YIQILMAYDI — lekin quyidagilarni ANIQ yozib qo'yish
tavsiya etiladi (audit izi, keyingi operator uchun aniqlik):

| O'zgaruvchi | Tavsiya etilgan qiymat | Ixtiyoriymi? |
|---|---|---|
| `DATABASE_STATEMENT_TIMEOUT_MS` | `30000` | Ixtiyoriy — kod standarti bilan bir xil |
| `DATABASE_CONNECT_TIMEOUT_MS` | `5000` | Ixtiyoriy — kod standarti bilan bir xil |
| `PAYME_SANDBOX` | **bo'sh qoldiring** (`false`) | Ixtiyoriy, lekin **PROD'DA HAQIQIY QIYMAT — bo'sh/false bo'lishi SHART** (§8 owner follow-up'ga qarang: sandbox qayta sertifikatlanmaguncha) |
| `ADMIN_PHONES` | **EGASI to'g'ridan-to'g'ri qo'yadi** — bu faylga yozilmaydi | Ixtiyoriy (bo'sh bo'lsa kod ichidagi bitta hardcode raqam ishlaydi — §8 owner follow-up) |
| `FREE_LLM_DISABLED` | `false` | Ixtiyoriy — kod standarti |
| `FREE_LLM_DAILY_OUTLINE` | `20` | Ixtiyoriy — kod standarti |
| `FREE_LLM_DAILY_UDK` | `20` | Ixtiyoriy — kod standarti |
| `FREE_LLM_DAILY_REWRITE` | `30` | Ixtiyoriy — kod standarti |
| `FREE_LLM_DAILY_POLISH` | `10` | Ixtiyoriy — kod standarti |
| `FREE_LLM_DAILY_GLOBAL` | `20000` | Ixtiyoriy — kod standarti |
| `QUEUE_TOTAL_SLOTS` | `8` | Ixtiyoriy — kod standarti (2 worker × 4 = 8 slot, C22 qarori) |
| `QUEUE_MEAN_SERVICE_SEC` | `200` | Ixtiyoriy — kod standarti |
| `QUEUE_MAX_WAIT_SEC` | `900` | Ixtiyoriy — kod standarti |
| `USER_MAX_INFLIGHT` | `2` | Ixtiyoriy — kod standarti |
| `QUEUE_TTL_SEC` | `2700` | Ixtiyoriy — kod standarti |
| `RETENTION_BONUS_DAYS` | `180` | Ixtiyoriy — kod standarti (egasi qarori 2026-09-23) |
| `PDF_MAX_CONCURRENCY` | `2` | Ixtiyoriy — kod standarti |
| `WEB_MEM_LIMIT` | `2g` | Ixtiyoriy — kod standarti |
| `WEB_CPUS` | `2` | Ixtiyoriy — kod standarti |
| `WORKER_MEM_LIMIT` | `2g` | Ixtiyoriy — kod standarti |
| `WORKER_CPUS` | `2` | Ixtiyoriy — kod standarti |
| `PG_MEM_LIMIT` | `1g` | Ixtiyoriy — kod standarti |
| `PG_CPUS` | `2` | Ixtiyoriy — kod standarti |

Standart qiymatlar (`docker-compose.yml`dagi `${VAR:-N}`) allaqachon
yuqoridagi ustundagi bilan BIR XIL — ya'ni `.env`ga hech narsa qo'shmasdan
deploy qilish ham xavfsiz (compose o'zi shu qiymatlarni beradi). Ularni
`.env`ga aniq yozish faqat operatorlarga keyinroq "bu qiymat qayerdan
kelgan" savolini oldini oladi. **Yagona amaliy istisno — `PAYME_SANDBOX`
va `ADMIN_PHONES`**: bular xavfsizlik bilan bog'liq, standart bo'sh
qiymat ATAYLAB shunday (fail-closed/fail-safe), egasi qaroriga qadar
O'ZGARTIRILMASIN.

**`WORKER_CONCURRENCY` — prod `.env`da eski `WORKER_CONCURRENCY=2`
qolgan bo'lsa, uni `4` ga o'zgartiring** (C22 qarori: 2 worker × 4 = 8 slot).
Aks holda compose `${WORKER_CONCURRENCY:-4}` o'rniga 2 ni oladi: 2 × 2 = 4 slot,
web esa qabul/ETA ni 8 slot (`QUEUE_TOTAL_SLOTS` standarti) deb hisoblaydi.

**Deploydan oldin (PRE-DEPLOY R3/R4):** ishlayotgan image'larni tezkor
orqaga qaytarish uchun belgilang — `docker tag slaydx-web:latest
slaydx-web:pre-audit && docker tag slaydx-worker:latest slaydx-worker:pre-audit`;
navbat bo'sh paytni tanlang (`SELECT status, count(*) FROM generations WHERE
status IN ('QUEUED','IN_PROGRESS') GROUP BY 1` — 0 qator kutiladi), chunki
Postgres bir marta qayta yaratiladi va eski worker ishni tashlab ketadi.

`FILE_TTL_HOURS` — bu audit davomida OLIB TASHLANGAN (endi
`RETENTION_BONUS_DAYS` + `files_purged_at` mexanizmi bor, 022-migratsiya).
Eski `.env`da qolgan bo'lsa — zarasi yo'q (compose uni endi umuman
o'qimaydi), lekin tozalab qo'yish mumkin.

## 3. Migratsiyalar 022-028

Migratsiyalar **avtomatik** ishga tushadi (`ensureMigrated`, advisory
lock bilan, worker/web ko'tarilganda) — qo'lda `npm run db:migrate` shart
emas (`.claude/deploy.md` §3). Quyidagi jadval — shu audit filialida
`b4a9ff1` holatida repoda BOR migratsiyalar (022-026); agar deploy vaqtida
`lib/server/migrations/`da 027/028 ham bo'lsa (boshqa to'lqin fixerlari
qo'shgan bo'lishi mumkin — bu runbook yozilganda ular hali repoga
tushmagan edi), **deploydan oldin ularni ham o'qing**: har biri loyihaning
konvensiyasiga ko'ra fayl boshida "Qulflar"/"ORQAGA QAYTARISH" izohini
o'z ichiga oladi — shu izohni ROLLBACK qadamida ishlatasiz.

| Migratsiya | Nima qiladi | Qulf / kutilgan davomiylik |
|---|---|---|
| `022_retention.sql` | `generations.files_purged_at` ustuni + 2 ta qisman indeks (`finished_at` bo'yicha, `COMPLETED`/`FAILED` filtri bilan) | `ADD COLUMN` qisqa ACCESS EXCLUSIVE, `lock_timeout=5s`; indekslar oddiy `CREATE INDEX` (SHARE qulf). Hozirgi hajmda — soniyalar. |
| `023_indexes.sql` | 5 ta indeks: `login_tickets`, `sessions.revoked_at`, `login_codes.expires_at`, `game_sessions.expires_at`, `generations` (QUEUED+created_at) | Oddiy `CREATE INDEX` (SHARE qulf), `lock_timeout=5s`. Soniyalar. |
| `024_idempotency.sql` | `generations.idempotency_key` (UUID) ustuni + UNIQUE qisman indeks | `ADD COLUMN` + indeks, `lock_timeout=5s`. Soniyalar. |
| `025_payment_events.sql` | Yangi jadval `payment_events` + 3 indeks + `payment_ledger` VIEW | Faqat YANGI ob'ektlar — mavjud jadvallarga tegilmaydi, qulf yo'q. Soniyalar. |
| `026_game_results_keep.sql` | `game_results.submission_id` ustuni + UNIQUE indeks | `ADD COLUMN` + indeks, `lock_timeout=5s`. Soniyalar. |
| `027_queue_indexes.sql` | `generations_stale_idx` → `generations_running_user_idx` (IN_PROGRESS, `user_id`), ortiqcha `generations_queue_idx` o'chiriladi, `fillfactor=90` | `CREATE INDEX` (SHARE) + `DROP INDEX` (qisqa ACCESS EXCLUSIVE), `lock_timeout=5s`. Prod'da `generations` ~100 qator — millisekundlar. Orqaga mos: eski kod indeks nomlariga tayanmaydi. |

Hammasi kichik jadvallarda (hozirgi hajmda) ishlaydi — kutilgan umumiy
vaqt bir necha soniya. `lock_timeout=5s` bor migratsiyalar uzoq davom
etayotgan boshqa tranzaksiya (masalan osilib qolgan so'rov) ortida
navbatda tursa, YIQILADI va keyingi ishga tushishda (worker/web qayta
ko'tarilganda) qayta uriniladi — bu ATAYLAB shunday (butun `generations`
jadvaliga trafikni to'xtatib qo'yishning oldini oladi), lekin agar
migratsiya bir necha marta ketma-ket yiqilsa, sabab (odatda osilib qolgan
tranzaksiya) `pg_stat_activity`dan topilishi kerak:

```bash
docker exec slaydx-postgres-1 psql -U slaydx -d slaydx \
  -c "SELECT pid, now()-xact_start AS age, state, query FROM pg_stat_activity WHERE state <> 'idle' ORDER BY age DESC LIMIT 10;"
```

## 4. Birinchi deploy — Postgres qayta ishga tushadi

`docker-compose.yml`da Postgres endi `command:` orqali server
parametrlari bilan ishga tushadi (`max_connections=100`,
`shared_buffers=256MB`, `shared_preload_libraries=pg_stat_statements`,
va h.k. — §2 jadvalidagi izohga qarang). Bu `command:` o'zgarishi
tufayli **`docker compose up -d` `slaydx-postgres-1` konteynerini QAYTA
YARATADI (recreate), oddiy restart emas** — konteyner SIGTERM oladi,
Postgres toza to'xtaydi (WAL checkpoint), keyin yangi parametrlar bilan
qayta ko'tariladi. Ma'lumot **yo'qolmaydi** (`pgdata` volume saqlanadi),
lekin bu QISQA (odatda bir necha soniya) ulanish uzilishi degani — web/
worker konteynerlari `depends_on: postgres: condition: service_healthy`
tufayli Postgres tayyor bo'lguncha kutadi, shuning uchun ular ham shu
oynada qayta ko'tariladi. **Bu — kutilgan, bir martalik hodisa** (keyingi
deploylarda `command:` o'zgarmasa, Postgres qayta yaratilmaydi, faqat
web/worker).

`shared_preload_libraries=pg_stat_statements` — kutubxona SHU
qayta yaratishda yuklanadi, lekin `CREATE EXTENSION pg_stat_statements`
alohida (hali repoda yo'q, kelajakdagi OBS-13 kengaytmasi) — hozircha
faqat server kutubxonasi tayyor, kengaytma o'rnatilmagan.

## 5. Worker — 2 replika

`worker` servisi `deploy.replicas: 2` bilan ko'tariladi (C22 qarori,
`WORKER_CONCURRENCY=4` — jami 8 slot, ilgari 1 worker × 2 = 2 slot edi
prod'da hali FAOLLASHTIRILMAGAN bo'lsa). Konteyner nomlari
`container_name` ATAYLAB yo'q bo'lgani uchun Compose avtomatik
`slaydx-worker-1` va `slaydx-worker-2` nomini beradi. Deploydan keyin:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep slaydx-worker
# ikkita qator kutiladi: slaydx-worker-1, slaydx-worker-2 (Up, healthy)
```

Agar faqat BITTASI ko'tarilsa (masalan xotira yetmasa —
`WORKER_MEM_LIMIT=2g` × 2 = 4 GB + `WEB_MEM_LIMIT=2g` + `PG_MEM_LIMIT=1g`
= 7 GB jami, box boshqa 2 loyiha bilan umumiy), `docker compose -p slaydx
logs worker` bilan sababni tekshiring — resurs yetishmovchiligi bo'lsa,
egasi bilan kelishib `WORKER_MEM_LIMIT`/`WEB_MEM_LIMIT`ni pasaytiring
(masalan `1500m`), boshqa loyihalarning limitiga tegmang.

## 6. Sog'lik tekshiruvi — 5 daqiqagacha kuting

`deploy.sh`ning standart `/api/health` so'rovi 2 daqiqagacha (
`.claude/deploy.md` §2) — bu audit filialidagi migratsiyalar (§3) +
Postgres qayta yaratilishi (§4) + 2-chi worker ko'tarilishi birgalikda
2 daqiqadan OSHISHI mumkin. Deploy skriptini o'zgartirmasdan, operator
QO'LDA uzunroq kutsin:

```bash
for i in $(seq 1 30); do   # 30 × 10s = 5 daqiqa
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health)
  echo "$(date +%T) health=$code"
  [ "$code" = "200" ] && break
  sleep 10
done
```

5 daqiqadan keyin ham `200` kelmasa — `docker compose -p slaydx logs
--tail=100 web worker postgres` bilan sababni tekshiring (odatda: migratsiya
`lock_timeout`da bir necha marta yiqilib qayta urinmoqda, yoki `.env`da
majburiy o'zgaruvchi — `SESSION_SECRET` — yo'q).

## 7. Deploydan keyingi tutun testi (smoke)

```bash
# 1. Sog'lik
curl -s http://127.0.0.1:3000/api/health | head -c 500; echo

# 2. Kirish sahifasi (200, HTML)
curl -s -o /dev/null -w '%{http_code}\n' https://slaydxx.uz/

# 3. Arzon generatsiya — HAQIQIY navbat orqali, admin hisobiga
#    (`.claude/deploy.md` "Admin vositalari" — bu skript kredit yechadi,
#    worker bajaradi, TO'G'RIDAN-TO'G'RI SQL EMAS):
docker compose -p slaydx exec -T worker npx tsx --conditions=react-server scripts/seed-demo.mts adkhambek_4 keys
# natijani kuzating: docker compose -p slaydx logs -f worker (COMPLETED holatini kuting)

# 4. Fayl yuklab olish — natija ID sini yuqoridagi logdan/saytdan olib:
curl -s -o /tmp/smoke.docx -w '%{http_code}\n' \
  -H "Cookie: slaydx_session=<admin sessiya cookie>" \
  https://slaydxx.uz/api/generations/<id>/file
file /tmp/smoke.docx   # "Microsoft Word 2007+" kutiladi

# 5. PDF eksport (LibreOffice yo'li ham ishlayotganini tasdiqlaydi):
curl -s -o /tmp/smoke.pdf -w '%{http_code}\n' \
  -H "Cookie: slaydx_session=<admin sessiya cookie>" \
  https://slaydxx.uz/api/generations/<id>/file?format=pdf
file /tmp/smoke.pdf   # "PDF document" kutiladi
```

Admin sessiya cookie — brauzerda `adkhambek_4` (owner hisobi, telefon
raqami `.claude/deploy.md`da) bilan kirib, DevTools orqali olinadi; real
raqam bu faylga yozilmaydi (`tests/no-pii-in-repo.test.mts`).

## 8. Orqaga qaytarish (rollback)

`.claude/deploy.md` §4 bilan bir xil, audit-xos qo'shimcha bilan:

```bash
cd /opt/slaydx
git reset --hard $(cat /root/slaydx-backups/ROLLBACK.txt)
docker compose -p slaydx build && docker compose -p slaydx up -d
```

**Migratsiyalar faqat OLDINGA** — schema orqaga qaytmaydi. Yuqoridagi
`git reset` kod darajasida orqaga qaytaradi, lekin 022-028 migratsiyalari
bazada QOLADI. Bu odatda ZARARSIZ, chunki HAMMASI orqaga mos (backward
compatible) qilib yozilgan — eski kod yangi ustunlarni/jadvallarni
bilmaydi va ularga tegmaydi:

- `022`/`024`/`026` — faqat YANGI, NULL-li/standartsiz ustunlar qo'shadi;
  eski kod ularni o'qimaydi.
- `023` — faqat indekslar; xatti-harakatga ta'sir qilmaydi.
- `025` — faqat yangi jadval/VIEW; mavjud kodga bog'liq emas.
- `027`/`028` (agar mavjud bo'lsa) — **rollback qilishdan oldin har
  birining "ORQAGA QAYTARISH" izohini o'qing**; agar biror migratsiya
  MAVJUD ustunni o'zgartirgan/o'chirgan bo'lsa (ORQAGA MOS EMAS), oddiy
  `git reset` yetarli emas — `pg_dump` zaxiradan (§1) tiklash kerak
  bo'ladi. Bu YO'QOTISHGA olib keladigan amal — **egasi bilan
  kelishmasdan qilinmasin**.

`ROLLBACK.txt`dagi commit Postgres `command:`ni ham eski holatga
qaytarishi mumkin (agar rollback shu audit filialidan OLDINGI commit'ga
bo'lsa) — bu holda §4dagi kabi Postgres yana bir marta qayta yaratiladi.

## 9. Egasi qadam (owner follow-up) — bu paket QILMAYDI

Quyidagilar operatorning o'zi, ushbu audit filiali TASHQARISIDA
bajarishi kerak bo'lgan qadamlar — hech biri ushbu deploy bilan
avtomatik hal bo'lmaydi:

1. **Payme/Click sandbox qayta sertifikatlash** — jonli to'lovlarni
   yoqishdan oldin, Payme/Click bilan yangi (audit tuzatishlaridan
   keyingi) endpoint xatti-harakatini sandbox orqali qayta tasdiqlash
   kerak (`audit/reviews/W3-C.md`da qayd etilgan protokol farqlari —
   masalan xato kodlari — hali sandbox'da tasdiqlanmagan). `PAYME_SANDBOX`
   prod'da **bo'sh/`false`** qolishi shart shu tasdiqlanguncha.
2. **`TELEGRAM_WEBHOOK_SECRET` + webhook qayta ro'yxatdan o'tkazish** —
   hozirgi webhook `CRON_SECRET` ni `secret_token` sifatida ishlatadi va
   yangi kod `TELEGRAM_WEBHOOK_SECRET` bo'lmasa AYNAN shunga qaytadi
   (boot'da ogohlantirish yozadi) — ya'ni deploydan keyin login ishlashda
   davom etadi. `TELEGRAM_WEBHOOK_SECRET` ni `.env`ga qo'yish va
   `setWebhook`ni YANGI `secret_token` bilan qayta chaqirish BITTA qadamda
   bajarilsin: faqat birini qilsangiz, Telegram yuborgan update'lar 401
   oladi va bot orqali kirish to'xtaydi (PRE-DEPLOY R9).
3. **Hardcoded admin raqamni o'chirish** — `ADMIN_PHONES` prod `.env`ga
   qo'yilgach, `lib/server/admin-phones.ts`dagi `ADMIN_PHONES_FALLBACK`
   qatoridagi haqiqiy raqamni kod'dan o'chirib, alohida commit va deploy
   qiling (DEPS-01/DEPS-08 — hozir bu raqam public repoda ko'rinadi).
   **`ADMIN_PHONES` o'rnatilmaguncha bu qadamni QILMANG** — aks holda
   hech kim admin sifatida kira olmay qoladi (fail-closed).
4. **Kunlik avtomatik zaxira cron'ini o'rnatish** — `.claude/deploy.md`
   §1a: `scripts/backup.sh`/`scripts/restore-check.sh` serverda hali
   cron orqali ulanmagan (bu — bir martalik, egasi tomonidan qo'lda
   qadam). `/etc/slaydx/backup.env` (agar box tashqarisiga nusxa/Telegram
   alert kerak bo'lsa) ham shu bosqichda sozlanadi.
