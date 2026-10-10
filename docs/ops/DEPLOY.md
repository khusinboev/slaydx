# Deploy yo'riqnomasi (2026-10-07 dan)

Bu hujjat deployning joriy shaklini va uning barcha sozlamalarini bir joyda beradi. Qaror va tadqiqot tarixi: `PLAN.md`, `O1…O4`.
Server IP, token va sirlar bu repoda YO'Q (`<SERVER_IP>` — haqiqiy manzil egasida).

## 1. Umumiy oqim

```
git push (main) ──► GitHub Actions (ci.yml)
                      ├─ static (tsc + eslint) · unit ×4 · ui ×3 · build        ← ~3 daqiqa, parallel
                      ├─ images: web + worker quriladi → ghcr.io/khusinboev/slaydx-{web,worker}:build-<sha>
                      └─ ci-ok yashil bo'lsagina promote: :<sha> va :main teglari (qayta qurmasdan)
                                            │
server (cron, har daqiqa) ◄─ slaydx-auto-deploy ──┘  origin/main da yangi, promote qilingan commit bormi?
   └─► slaydx-deploy <sha>:  lokal zaxira → image pull → migratsiya → konteynerlarni almashtirish
                             → sog'liq tekshiruvi → xato bo'lsa AVTOMATIK rollback
   └─► Telegram: 🚀 boshlandi · ✅ yangilandi (soniya) · ❌ muvaffaqiyatsiz
```

- Serverda **build yo'q** (avval ~6–8 daqiqa edi, serverni og'irlashtirardi). Deploy serverda ~3 daqiqa (o'lchandi: 195 s, shundan lokal zaxira ~120 s, pull 17 s, migratsiya 8 s, almashtirish 13 s, sog'liq 25 s).
- GitHub'da serverga kirish kaliti YO'Q: server o'zi so'raydi (pull modeli). Serverga tashqaridan yangi yo'l ochilmagan.
- Ishonch modeli: `main`ga push qila oladigan odam serverda ishlaydigan narsani (image, compose, cron skriptlari) allaqachon o'zgartira oladi;
  avto-deploy yangi huquq bermaydi, faqat CI'dan o'tgan commit'ni chiqaradi.

## 2. Avtomatik deploy (`deploy/auto-deploy.sh` → `/usr/local/bin/slaydx-auto-deploy`)

Cron: `/etc/cron.d/slaydx-auto-deploy`, har daqiqa, log `/var/log/slaydx-auto-deploy.log`.

**Deploy QILMAYDI**, agar:
| Holat | Nima bo'ladi |
|---|---|
| `/etc/slaydx/auto-deploy.disabled` fayli bor | hech narsa (o'chirib qo'yish) |
| boshqa deploy ketayapti (qulf band) | kutadi; 30 daqiqadan oshsa bir marta ogohlantiradi |
| commit deploy qilinganining davomi emas (history o'zgargan) | bir marta ogohlantiradi, qo'lda hal qilinadi |
| web/worker image'lari hali `:<sha>` bilan promote qilinmagan (CI ketayapti/qizil) | kutadi; 45 daqiqadan oshsa bir marta ogohlantiradi |
| commit xabarida `[skip deploy]` bor | o'tkazib yuboradi |
| faqat `docs/ tests/ loadtests/ .github/ .claude/ deploy/ *.md LICENSE` o'zgargan | deploy yo'q; `/opt/slaydx` checkout'i yangilanadi. `deploy/` o'zgarsa — qo'lda qayta o'rnatish haqida xabar |
| shu commit allaqachon xato bo'lgan | qayta urinmaydi (yangi commit yoki qo'lda) |
| soatiga 6 ta avto-deploy bajarilgan | kutadi |
| `slaydx-deploy` rad etdi (masalan, xavfli migratsiya) | ❌ xabar; qo'lda `--allow-destructive` bilan |

**Boshqarish**
```
touch /etc/slaydx/auto-deploy.disabled      # to'xtatish (deploy'lar to'xtaydi, boshqa narsa ishlayveradi)
rm /etc/slaydx/auto-deploy.disabled         # davom ettirish
git commit -m "... [skip deploy]"           # bitta commit'ni o'tkazib yuborish
```

## 3. Qo'lda deploy va rollback

```
ssh root@<SERVER_IP>
slaydx-deploy <40-hex sha>                  # promote qilingan commit; SSH uzilsa ham davom etadi (alohida jarayon)
slaydx-deploy <sha> --allow-destructive     # xavfli migratsiya (DROP/RENAME/TRUNCATE/SET NOT NULL/ALTER TYPE) ko'rib chiqilgandan keyin
slaydx-deploy-build                         # ZAXIRA yo'l: eski usul, serverda build (GitHub/GHCR ishlamasa)
```
- Log: `/root/slaydx-backups/deploy-<vaqt>-<sha7>.log`; natija: `/var/lib/slaydx-deploy/last-run.env`, tarix: `history.log`.
- **Avtomatik rollback:** sog'liq tekshiruvi o'tmasa oldingi image'larga qaytadi (`:rollback` teglari), `rc=1` qaytaradi.
- **Qo'lda rollback:** `slaydx-deploy <oldingi sha>` (history.log'dan), yoki DB muammosi bo'lsa — deploy oldidan olingan zaxira
  `/root/slaydx-backups/slaydx-<vaqt>.dump` + `ROLLBACK.txt`. Migratsiyalar additive, shuning uchun image'ni qaytarish odatda yetarli.
- Deploydan oldingi zaxira **faqat lokal** (Google Drive'ni kutmaydi); kechasi 01:30 dagi to'liq zaxira Drive'ga ham yuklaydi.

## 4. Sozlamalar va fayllar (serverda)

| Joy | Nima | Eslatma |
|---|---|---|
| `/etc/slaydx/backup.env` (root, **600**) | `TELEGRAM_BOT_TOKEN`, `BACKUP_TG_CHAT` (yoki `ALERT_TG_CHAT`) — barcha Telegram xabarlari; `BACKUP_REMOTE`, `BACKUP_KEEP_DAYS`, `BACKUP_REMOTE_RETENTION=gfs\|off`, `BACKUP_GFS_DAILY/WEEKLY/MONTHLY`, `LEDGER_KEEP_HOURS`; `WATCHDOG_AUTO_RESTART=1`, `WATCHDOG_CERT_FILE` | 600 emasa avto-deploy ishlamaydi. `BACKUP_REMOTE_KEEP_DAYS` endi ishlatilmaydi (GFS) |
| `/etc/slaydx/docker/config.json` (root, 700/600) | GHCR o'qish tokeni (`read:packages`) | **1 yillik** — 2027-10-01 gacha yangilang: GitHub → Settings → Tokens, so'ng `DOCKER_CONFIG=/etc/slaydx/docker docker login ghcr.io -u khusinboev` |
| `/etc/slaydx/auto-deploy.disabled` | avto-deploy o'chirgichi | mavjud bo'lsa — to'xtagan |
| `/opt/slaydx/.env` | ilova sirlari + `SLAYDX_TAG=<sha>` (deploy o'zi yozadi) | git'da yo'q; deploy `git reset --hard` qilganda saqlanadi |
| `/var/lib/slaydx-deploy/` | `current.env` (joriy sha), `history.log`, `last-run.env`, `auto-seen`, `auto-failed`, `auto-times`, `auto-started`, `auto-deploy.lock` | holat; o'chirsa — faqat qayta ko'rib chiqadi |
| `/etc/cron.d/slaydx-backup` | 01:30 to'liq zaxira · har soat ledger (`:05`) · yakshanba 05:00 tiklash sinovi | `deploy/install-ops.sh` yozadi |
| `/etc/cron.d/slaydx-watchdog` | har 3 daqiqa tekshiruv · 06:00 kunlik hisobot | faqat ogohlantiradi (`WATCHDOG_AUTO_RESTART=1` bo'lsa qayta ishga tushiradi) |
| `/etc/cron.d/slaydx-auto-deploy` | har daqiqa avto-deploy | |
| `/etc/cron.d/slaydx-metrics` | har 5 daqiqada server yuklamasi namunasi (`server_metrics`, kind `host`) | `deploy/install-ops.sh` yozadi; batafsil `docs/ops/METRICS.md` |
| `/etc/logrotate.d/slaydx-ops` | haftalik, 8 ta, `create 0600` | |
| `/usr/local/bin/` | `slaydx-deploy`, `slaydx-deploy-build`, `slaydx-backup`, `slaydx-auto-deploy`, `slaydx-metrics` | root nusxalari (symlink emas) |

Skriptlar uchun muhit o'zgaruvchilari (odatda tegilmaydi): `SLAYDX_APP_DIR` (/opt/slaydx), `SLAYDX_STATE_DIR`, `SLAYDX_LOCK_FILE`
(/run/lock/slaydx-deploy.lock — watchdog ham shuni tekshiradi), `SLAYDX_AUTO_MAX_PER_HOUR` (6), `SLAYDX_REGISTRY` (ghcr.io/khusinboev),
`SLAYDX_BACKUP_CMD`, `SLAYDX_DOCKER_CONFIG`, `SLAYDX_HEALTH_TRIES/INTERVAL`, `SLAYDX_MIN_FREE_GB`.

## 5. O'rnatish va yangilash (serverda, root)

`deploy/` papkasidagi skriptlar **o'zi yangilanmaydi** (root buyruqlari avtomatik almashmasligi uchun). Ular o'zgarsa avto-deploy xabar beradi:
```
cd /opt/slaydx && git fetch -q origin && git reset -q --hard origin/main
bash deploy/install-deploy.sh      # slaydx-deploy, -build, slaydx-backup, slaydx-auto-deploy
bash deploy/install-ops.sh         # cron fayllari + logrotate  (--dry-run: faqat ko'rsatadi)
```
Yangi serverda avval GHCR login (4-bo'lim), keyin bir marta qo'lda `slaydx-deploy <sha>` (avto-deploy `current.env` asosidan boshlanadi).

## 6. GitHub tomoni (`.github/workflows/`)

- `ci.yml`: static · unit ×4 (har biri o'z Postgres'i) · ui ×3 · build · images (faqat `main` push'da GHCR'ga yuklaydi; PR'da faqat qurib tekshiradi) ·
  `ci-ok` (hammasi yashil bo'lishi shart) · `promote` (faqat `ci-ok` + images va paketlar **private** bo'lsa; aks holda to'xtaydi). `main` ishga tushirishlari hech qachon bekor qilinmaydi.
- `ghcr-retention.yml`: haftalik tozalash, standart **dry-run**; haqiqiy o'chirish uchun repo o'zgaruvchisi `GHCR_RETENTION_APPLY=true`. `main`, `keep-*` va so'nggi 10 promote qilingan versiya hech qachon o'chirilmaydi.
- `uptime.yml`: har 10 daqiqada tashqaridan sayt tekshiruvi. **Yoqish uchun** repo secrets: `UPTIME_TG_TOKEN`, `UPTIME_TG_CHAT` (hozircha qo'yilmagan).
- GHCR paketlari (`slaydx-web`, `slaydx-worker`) **private** bo'lishi shart; ochiq bo'lib qolsa `promote` to'xtaydi.

## 7. Muammolarni hal qilish

| Belgi | Sabab / yechim |
|---|---|
| Telegram: "image'lar 45 daqiqadan beri tayyor emas" | CI qizil yoki GHCR tokeni eskirgan: Actions'ni va `docker manifest inspect ghcr.io/khusinboev/slaydx-web:<sha>` ni tekshiring |
| ❌ avto-deploy muvaffaqiyatsiz | Log: `/root/slaydx-backups/deploy-*-<sha7>.log`; rollback bo'lgan. Kodni tuzatib yangi commit, yoki qo'lda `slaydx-deploy` |
| "deploy 30 daqiqadan beri tugamadi" | `ps aux \| grep slaydx-deploy`, logni o'qing; qotgan bo'lsa jarayonni to'xtating va `last-run.env`/konteynerlarni tekshiring |
| avto-deploy hech narsa qilmayapti | `/var/log/slaydx-auto-deploy.log`; `/etc/slaydx/backup.env` 600 va root egaligida ekanini, `auto-deploy.disabled` yo'qligini, `current.env` borligini tekshiring |
| disk to'lmoqda | `scripts/docker-cleanup.sh` (faqat slaydx image'lari, `--apply` bilan); Docker build keshi endi serverda yig'ilmaydi |
| GitHub Actions sekin/ishlamayapti | githubstatus.com; zaxira yo'l: `slaydx-deploy-build` |

## 8. Hozirgi ko'rsatkichlar
CI ~3–4 daqiqa (avval ~13) · image build GitHub'da ~1–3 daqiqa (kesh bilan) · serverda deploy ~3,3 daqiqa o'lchandi (avval ~10–12 + Drive kutish) ·
worker image 681 MB (avval 1,88 GB) · push'dan saytda yangilanguncha ~7–9 daqiqa, qo'lsiz (birinchi avtomatik deploy: f88b8d9, 195 s).
Keyingi tezlashtirish imkoniyati: deploy oldidan zaxira ~120 s (pg_dump + tekshiruv); migratsiyasiz commit'larda uni o'tkazib yuborish yoki soatlik ledger dump'iga tayanish mumkin.
