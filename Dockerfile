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
RUN apk add --no-cache       libreoffice-writer libreoffice-impress       ttf-liberation font-noto   && soffice --headless --version >/dev/null 2>&1 || true

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

COPY package.json package-lock.json ./
# `tsx` devDependency, shuning uchun `--omit=dev` ishlatmaymiz.
RUN npm ci && npm cache clean --force
COPY lib ./lib
COPY scripts ./scripts
COPY tsconfig.json ./

RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001 && chown -R worker:nodejs /app
USER worker

CMD ["npx", "tsx", "--conditions=react-server", "scripts/worker.ts"]
