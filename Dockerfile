# syntax=docker/dockerfile:1

# Base image pin (INFRA-14/DEPS-05): faqat major tegga emas, aniq patch +
# Alpine minor versiyaga qulflangan — bir xil commit ikki xil kunda
# qurilganda boshqa Node/Alpine patch tortib olinmasin (build har doim
# prod box'da, deploy vaqtida bo'ladi — INFRA-13, ya'ni "qayta qurish"
# tez-tez sodir bo'ladigan holat, ixtiyoriy emas).
#
# Yangilash tartibi (ataylab, tasodifiy emas): `curl -s
# "https://registry.hub.docker.com/v2/repositories/library/node/tags?page_size=100&name=22." | jq -r '.results[].name' | grep alpine`
# dan eng so'nggi `22.x.y-alpineN.NN` ni tanlang, pastdagi `ARG`
# qiymatini shunga yangilang (to'rtta `FROM` shu bitta manbadan o'qiydi),
# `docker compose -p slaydx build` bilan sinab ko'ring va alohida
# commitda kiriting — boshqa o'zgarish bilan aralashtirmang.
ARG NODE_IMAGE=node:22.23.2-alpine3.24

# ─── Bog'liqliklar ────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─── Qurish ───────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `standalone` — kerakli modullarni bitta papkaga yig'adi, natijada
# ishlash imiji ~10 barobar kichik bo'ladi.
ENV NEXT_OUTPUT=standalone
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# `lib/server/parse-worker.ts` (worker_threads tahlil hovuzi, W1-D) — prod
# `standalone` to'plamida `tsx`/manba fayllar YO'Q, shuning uchun worker
# thread'ini bu yerda, build vaqtida, bitta ishlaydigan `.mjs`ga yig'amiz.
# Bo'lmasa prod jimgina process ichida (in-process) parslashga qaytadi —
# hovuzning butun maqsadi (asosiy event loop'ni bloklamaslik) yo'qoladi.
# `esbuild` alohida o'rnatilmagan — `tsx`ning o'z bog'liqligi sifatida
# `node_modules`da allaqachon bor (`npm ci` shu bosqichda dev bog'liqliklarni
# ham o'rnatadi, `NODE_ENV=production` faqat keyingi bosqichlarda o'rnatiladi).
RUN npx esbuild lib/server/parse-worker.ts --bundle --platform=node --format=esm --target=node22 \
  --outfile=.next/standalone/parse-worker.mjs \
  --banner:js="import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);"

# ─── Ishlash ──────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# PDF eksport uchun LibreOffice.
#
# Faqat Writer va Impress filtrlari kerak — to'liq to'plam emas.
# `ttf-liberation` Times New Roman va Arial bilan METRIK MOS: hujjat
# maketi o'zgarmaydi, `font-noto` esa kirill va boshqa yozuvlarni yopadi.
# Ular bo'lmasa PDF da matn kvadratchalarga aylanadi.
#
# Bu tasvirga ~400 MB qo'shadi. PDF kerak bo'lmasa shu qatorni olib
# tashlash mumkin: `pdfAvailable()` `false` qaytaradi va UI da PDF
# tugmasi umuman chiqmaydi.
# `poppler-utils` (`pdftoppm`) — «O'z shablonim» uchun layout fonlarini
# rasterlash (yuklash paytida, web konteynerida: `lib/server/template-upload.ts`).
#
# `font-noto-cjk` va `font-noto-arabic` (AUDIT-16): Tarjimon 2 hujjatni
# 18 tilga o'giradi — xitoy, koreys, yapon va arab yozuvi ham bor. `font-noto`
# faqat lotin/kirill/yunonni yopadi; yaponchaga tarjima qilingan PPTX ning
# PDF ko'rinishi va eskizi (LibreOffice shu konteynerda o'giradi) butunlay
# «□□□» bo'lib chiqardi. Faylning o'zi to'g'ri edi — foydalanuvchi
# kompyuterida shrift bor — lekin saytdagi ko'rinish buzuq. ~+60 MB.
RUN apk add --no-cache       libreoffice-writer libreoffice-impress       ttf-liberation font-noto font-noto-cjk font-noto-arabic poppler-utils   && fc-cache -f >/dev/null 2>&1 || true   && soffice --headless --version >/dev/null 2>&1 || true

# Root ostida ishlatmaymiz.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Migratsiyalar `process.cwd()/lib/server/migrations` dan o'qiladi.
COPY --from=builder --chown=nextjs:nodejs /app/lib/server/migrations ./lib/server/migrations

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

# ─── Worker ───────────────────────────────────────────────────────────
# Alohida target: worker Next.js server emas, oddiy Node processi.
# Standalone to'plamda `scripts/` va `tsx` yo'q, shuning uchun bu yerda
# to'liq manba va bog'liqliklar saqlanadi.
FROM ${NODE_IMAGE} AS worker
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Sxema (SVG → PNG, `sharp`/librsvg — Maqola 2) SHU konteynerda chiziladi:
# shriftsiz matn «□□□» bo'lib chiqadi (2026-09-12 prod: birinchi maqolada
# sxema yorliqlari tofu). `runner` dagi to'plam bilan bir xil oila:
# lotin/kirill (Liberation = TNR metrikasi, Noto), fontconfig keshi.
RUN apk add --no-cache fontconfig ttf-liberation font-noto && fc-cache -f >/dev/null 2>&1 || true

COPY package.json package-lock.json ./
# Tarix (INFRA-12/DEPS-06): ilgari bu yerda `npm ci --include=dev` turardi,
# chunki `tsx` `devDependencies`da edi va `ENV NODE_ENV=production` uni
# bayroqsiz tashlab ketardi — o'sha holatda `CMD`dagi `npx tsx` har
# konteyner ishga tushganda tsx ni INTERNETDAN yuklashga urinardi:
#
# npm warn exec The following package was not found and will be
# installed: tsx@4.23.13
#
# Registry yetib bo'lmasa worker umuman ko'tarilmasdi — BARCHA
# generatsiya navbatda abadiy qotib qolardi. `--include=dev` o'sha
# muammoni to'g'ri hal qilgan edi, lekin haddan tashqari keng: `tsx`
# bilan birga eslint/jsdom/tailwindcss/typescript/@testing-library/* —
# ~430 hech qachon ishlatilmaydigan paket ham prod worker image'iga
# tushardi (kattaroq attack surface, kattaroq image, foydasiz).
#
# Endi `tsx` `package.json`da `dependencies`da (worker CMD va admin
# skriptlari — `topup`/`seed-demo`/`seed-images`/`bot` — unga to'g'ridan
# to'g'ri tayanadi), shuning uchun `--omit=dev` xotirjam ishlatiladi:
# tsx (va uning yagona bog'liqligi `esbuild`) HAR DOIM local diskda,
# tarmoqqa chiqmasdan bor — aynan o'sha tuzatish, faqat torroq ko'lamda.
RUN npm ci --omit=dev && npm cache clean --force
COPY lib ./lib
COPY scripts ./scripts
COPY tsconfig.json ./
# `data/` — kasblar ro'yxati (Rezyume 2). Hozir uni faqat FORMA o'qiydi,
# ya'ni worker'ga kerak emas; lekin `lib/` ichidagi biror modul kelajakda
# uni import qilsa (masalan ko'nikma tavsiyasi promptga qo'shilsa), fayl
# yo'qligi worker'ni ishga tushishida yiqitardi — 6 KB uchun bu xavf
# arzimaydi.
COPY data ./data

RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001 && chown -R worker:nodejs /app
USER worker

# Worker tarmoq porti tinglamaydi, shuning uchun `web`dagi kabi HTTP
# HEALTHCHECK ishlamaydi. Shartnoma (`audit/designs/w2-contracts.md`):
# worker sikli sog'lom bo'lsa `/tmp/slaydx-worker-alive` faylini kamida
# har 30 s da yangilaydi (`lib/server/worker.ts`, W2-D2); fayl 2 daqiqadan
# eskirsa — ish to'xtab qolgan (INFRA-06: ilgari o'lik worker hech qanday
# signal bermasdi, `docker ps` uni abadiy "Up" deb ko'rsatardi).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD find /tmp/slaydx-worker-alive -mmin -2 | grep -q .

# `npx` emas, to'g'ridan-to'g'ri o'rnatilgan ikkilik: tarmoqqa chiqmaydi.
CMD ["./node_modules/.bin/tsx", "--conditions=react-server", "scripts/worker.ts"]
