# syntax=docker/dockerfile:1

# ─── Bog'liqliklar ────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─── Qurish ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `standalone` — kerakli modullarni bitta papkaga yig'adi, natijada
# ishlash imiji ~10 barobar kichik bo'ladi.
ENV NEXT_OUTPUT=standalone
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Ishlash ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
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
FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Sxema (SVG → PNG, `sharp`/librsvg — Maqola 2) SHU konteynerda chiziladi:
# shriftsiz matn «□□□» bo'lib chiqadi (2026-09-12 prod: birinchi maqolada
# sxema yorliqlari tofu). `runner` dagi to'plam bilan bir xil oila:
# lotin/kirill (Liberation = TNR metrikasi, Noto), fontconfig keshi.
RUN apk add --no-cache fontconfig ttf-liberation font-noto && fc-cache -f >/dev/null 2>&1 || true

COPY package.json package-lock.json ./
# `--include=dev` MAJBURIY va u `--omit=dev` ishlatmaslikdan KUCHLIROQ.
# 
# Yuqoridagi `ENV NODE_ENV=production` npm ga devDependencies ni
# tashlab ketishni buyuradi — bayroqsiz ham. Ilgari bu yerda faqat
# `npm ci` turar va izoh «--omit=dev ishlatmaymiz» deb tinchlantirardi,
# amalda esa `tsx` O'RNATILMAS edi.
# 
# Oqibati jonli serverda ko'rindi: `CMD` dagi `npx tsx` har konteyner
# ishga tushganda tsx ni INTERNETDAN yuklab olardi —
# 
# npm warn exec The following package was not found and will be
# installed: tsx@4.23.13
# 
# Ya'ni npm registry yetib bo'lmasa worker umuman ko'tarilmaydi va
# BARCHA generatsiya navbatda abadiy qotib qoladi. Deploy internetga
# bog'liq bo'lib qolgan edi, tasvirga esa emas.
# 
# Yon foyda: `npm run topup` kabi admin vositalari ham ishlaydi — ular
# `tsx` ni to'g'ridan-to'g'ri chaqiradi.
RUN npm ci --include=dev && npm cache clean --force
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

# `npx` emas, to'g'ridan-to'g'ri o'rnatilgan ikkilik: tarmoqqa chiqmaydi.
CMD ["./node_modules/.bin/tsx", "--conditions=react-server", "scripts/worker.ts"]
