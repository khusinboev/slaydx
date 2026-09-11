# SlaydX — deploy qo'llanmasi

Bu fayl productionga qanday xavfsiz deploy qilishni tasvirlaydi. Serverda
**SlaydX yagona loyiha emas** — quyidagi qoidalar shu sababli qat'iy.

## Server

| | |
|---|---|
| Manzil | `root@194.163.136.239` (Ubuntu 24.04) |
| Ulanish | `ssh root@194.163.136.239` |
| Ochiq domen | `https://slaydxx.uz` |
| Loyiha jildi | `/opt/slaydx` — `origin/main`ni kuzatuvchi git checkout |
| Compose loyiha nomi | `slaydx` — **HAR DOIM** `docker compose -p slaydx ...` |
| Konteynerlar | `slaydx-web-1`, `slaydx-worker-1`, `slaydx-postgres-1` |
| Web porti | `127.0.0.1:3000` — faqat localhost, nginx proxy qiladi |
| Postgres | konteyner ichida, host portiga CHIQARILMAGAN |
| Sirlar | `/opt/slaydx/.env` (huquq 600) — **git'da YO'Q** |

## ⚠️ Serverda BOSHQA loyihalar bor — halal bermaslik qoidalari

Bir xil box'da yana ikkita mustaqil loyiha ishlaydi:

- **nodavlattalim** — `/home/nodavlattalim`, 4 konteyner (o'z Postgres va Redis'i bilan): `nodav-api`, `nodav-dashboard`, `nodav-redis`, `nodav-db`
- **mser** — `/home/mser`, shu jumladan `milliy_sertificat_bot`
- nginx saytlar: `nodavlattalim`, `talim24-landing`, `vakant`, `slaydx` — hammasi bitta nginx instansida

**Qat'iy taqiqlar:**

1. **`-p slaydx` bayrog'isiz `docker compose` buyrug'ini HECH QACHON ishlatmang.** Bayroqsiz `docker compose down`/`up` joriy papkadagi `docker-compose.yml`ni ko'radi, lekin konteyner nomlari to'qnashishi yoki noto'g'ri tarmoqqa ulanishi mumkin — har doim aniq yozing: `docker compose -p slaydx <buyruq>`.
2. **`docker system prune`, `docker system prune -a`, `docker volume prune` — UMUMAN ishlatmang.** Bular BOSHQA loyihalarning image/volume'larini ham o'chiradi (docker global resurs, loyihaga xos emas).
3. **`docker ps`/`docker stop`/`docker rm`ni konteyner nomi bilan ANIQ ko'rsatib ishlating** (`slaydx-*`), hech qachon hammasini qamrab oluvchi buyruq bilan emas.
4. **nginx konfiguratsiyasini tekshirmasdan tahrirlamang** — `/etc/nginx/sites-available/slaydx` FAQAT SlaydX uchun, lekin `nginx -t` yoki `systemctl reload nginx` boshqa saytlarga ham ta'sir qiladi (reload — xavfsiz, restart — qisqa uzilish beradi, ehtiyot bo'ling).
5. **Postgres portini hech qachon hostga chiqarmang** (`docker-compose.yml`da `ports:` emas, `expose:` bo'lishi shart) — boshqa loyihalarning DB porti bilan to'qnashmasligi uchun.
6. Har doim `docker ps` bilan **BARCHA** konteynerlarni ko'rib, faqat `slaydx-*` uchlikni kutilgan holatda ekanini tasdiqlang — buyruqdan OLDIN va KEYIN.

## Deploy qadamlari

### 1. Zaxira (HAR DOIM, deploydan oldin)

```bash
ssh root@194.163.136.239
mkdir -p /root/slaydx-backups
ts=$(date +%Y%m%d%H%M%S)
docker exec slaydx-postgres-1 pg_dump -U slaydx slaydx > /root/slaydx-backups/slaydx-$ts.sql
cd /opt/slaydx && git rev-parse --short HEAD > /root/slaydx-backups/ROLLBACK.txt
```

`ROLLBACK.txt` — hozirgi (deploydan OLDINGI) commit. Muammo chiqsa:
`git reset --hard <shu commit>` + qayta build.

### 2. Deploy

```bash
# Uzoq build (shrift/LibreOffice paketlari) paytida SSH uzilsa skript
# `up -d` ga yetmay qoladi (2026-09-11 da shunday bo'ldi) — nohup bilan:
ssh root@194.163.136.239 'nohup bash /opt/slaydx/deploy.sh > /root/deploy-$(date +%s).log 2>&1 &'
# keyin: ssh … 'tail -f /root/deploy-*.log'  → «✅ tayyor»
```

`deploy.sh` (untracked, git'da yo'q, serverda alohida yaratilgan) qiladi:
`git fetch` → `git reset --hard origin/main` → `docker compose -p slaydx build && up -d`
→ `/api/health`ni 2 daqiqagacha so'raydi.

**Muhim:** `git reset --hard origin/main` ishlatiladi — ya'ni **faqat
`main` filialdagi commit'lar** serverga tushadi. Boshqa filialda
(masalan `audit-6`) qolgan ish avval `main`ga birlashtirilishi (merge)
va push qilinishi SHART, aks holda deploy uni ko'rmaydi.

Untracked fayllar (`.env`, `deploy.sh`, `auto-https.sh`, `enable-https.sh`,
`topup.sh`) `git reset --hard` dan **omon qoladi** — ularni serverda
qo'lda tahrirlash xavfsiz.

### 2a. nginx — uzoq so'rovlar (AUDIT-10 dan boshlab)

Tahrir routelari (`POST /api/generations/{id}/rebuild` — 30 slaydli
PPTX qayta yasash, `…/image/regenerate` — Gemini rasm ~35–45 s) nginx
ning standart `proxy_read_timeout 60s` ga sig'masligi mumkin.
`/etc/nginx/sites-available/slaydx` da `location /api/generations/`
uchun `proxy_read_timeout 120s;` qo'ying, `nginx -t` → `systemctl
reload nginx` (reload — xavfsiz, boshqa saytlarga uzilish bermaydi).

### 3. Tekshirish (deploydan keyin, har doim)

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'   # slaydx-* uchtasi + boshqa 5 ta o'zgarishsiz
cd /opt/slaydx && git log --oneline -1                 # kutilgan commit
curl -s http://127.0.0.1:3000/api/health               # 200 va JSON
docker compose -p slaydx logs --tail=50 worker          # xato yo'qligini tekshirish
```

Yangi migratsiya qo'shilgan bo'lsa (`lib/server/migrations/0NN_*.sql`):

```bash
docker exec slaydx-postgres-1 psql -U slaydx -d slaydx \
  -tAc "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 3"
```

Migratsiyalar **o'zi** ishga tushadi (worker/web ko'tarilganda,
`ensureMigrated`, advisory lock bilan) — qo'lda `npm run db:migrate`
ishlatish shart emas.

### 4. Orqaga qaytarish (rollback), zarurat bo'lsa

```bash
cd /opt/slaydx
git reset --hard $(cat /root/slaydx-backups/ROLLBACK.txt)
docker compose -p slaydx build && docker compose -p slaydx up -d
```

Baza sxemasi orqaga qaytmaydi (migratsiyalar faqat oldinga) — agar
muammo yangi migratsiya tufayli bo'lsa, `pg_dump` zaxiradan tiklash
kerak bo'lishi mumkin (buni ehtiyotkorlik bilan, foydalanuvchi bilan
kelishib bajaring — bu YO'QOTISHGA olib keladigan amal).

## Admin vositalarini serverda ishga tushirish

Bular `worker` konteyner ICHIDA ishlaydi — u `scripts/` va to'liq
`node_modules` (shu jumladan `tsx`) ni o'z ichiga oladi, `web` esa yo'q
(standalone Next.js image).

```bash
# Kredit qo'shish
docker compose -p slaydx exec -T worker npx tsx --conditions=react-server scripts/topup.mts <username> <miqdor> [points|quota|balance]

# Admin hisobiga namunaviy kontent — HAQIQIY navbat orqali (kredit yechiladi, worker bajaradi)
docker compose -p slaydx exec -T worker npx tsx --conditions=react-server scripts/seed-demo.mts <username> all
docker compose -p slaydx exec -T worker npx tsx --conditions=react-server scripts/seed-images.mts <username>
```

**Namunaviy/sinov kontentini hech qachon to'g'ridan-to'g'ri SQL bilan
yozmang** — kredit jurnali (`transactions`) buzilib, `balance ==
sum(transactions)` invarianti yolg'on bo'lib qoladi. Har doim yuqoridagi
skriptlar orqali (haqiqiy `enqueueGeneration` yo'li).

Agar skript hali serverga yetib bormagan bo'lsa (yangi fayl, hali
deploy qilinmagan), avval nusxalab qo'ying:

```bash
docker compose -p slaydx cp <lokal-yo'l> worker:/app/<yo'l>
```

Owner hisobi: `username=adkhambek_4` (id=2), `phone=+998997333896`.

## HTTPS / DNS (kamdan-kam kerak bo'ladi)

`slaydxx.uz` domeni DNS orqali shu serverga yo'naltirilgach:

```bash
/opt/slaydx/enable-https.sh
```

Bu skript AVVAL DNS'ni tekshiradi — mos kelmasa certbot'ni umuman
chaqirmaydi (muvaffaqiyatsiz urinishlar Let's Encrypt kunlik chegarasini
yeydi, shuning uchun bu tekshiruv muhim).

## Tezkor eslatma — nima ATAYLAB gitignore'da

`.env*` (sirlar), `eval-out/` (o'lchov natijasi), va — foydalanuvchi
so'rovi bilan — `CLAUDE.md` va `.claude/` (bu ikkisi ham serverga
tegishli tafsilotlarni o'z ichiga oladi, umumiy repo'ga tushmasligi
kerak).
