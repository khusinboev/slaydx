# O1 — Deploy pipeline: build on GitHub, pull on prod (research only, nothing applied)

Repo state read: `main` (prod `926fcc7`), `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/workflows/ci.yml`,
`.claude/deploy.md`, `next.config.ts`, `instrumentation.ts`, `lib/server/db.ts` (migrate), `app/api/health/route.ts`,
`lib/server/worker.ts` (SIGTERM), `lib/brand.ts`, `lib/server/env.ts`, prod snapshot, GitHub Actions run timings (`gh api`),
GitHub/Docker docs. Measurements done locally: Alpine 3.24 APKINDEX package sizes (throwaway `alpine:3.24` container),
`.next/**/*.nft.json` trace analysis of the existing local build, production-dependency sizes from `node_modules`.

## 0. Key numbers

| Item | Today | Proposed |
|---|---|---|
| Where the image is built | prod box (4 vCPU / 7.8 GB, shared) | GitHub-hosted runner (free for public repo) |
| `next build` | 299 s on prod box | 69 s natively in CI (run 37333293185, step "npm run build"); ~90–120 s inside docker on the runner |
| Worker `chown -R /app` | 97 s + duplicates every `/app` file in a new layer | 0 s (removed) |
| Deploy wall time (push of the button → healthy) | ~10–12 min | **~1.5–2.5 min** (pull delta 20–60 s, optional migrate 5 s, recreate + health 40–90 s); first pull ~3–4 min (~1 GB compressed) |
| Push to main → deployable image | n/a (build happens during deploy) | ≈ CI duration (~13.5 min) — the image builds **in parallel** with tests and is only *promoted* after tests pass |
| Prod box load during deploy | 4 cores pegged 6–8 min, 2–3 GB RAM, swapping, 25 GB build cache growth | ~1 core for layer decompression ~20–60 s, <100 MB RAM, no build cache |
| Web image | 2.1 GB | ~1.5–1.8 GB (LibreOffice is 1 076 MiB of it, irreducible on Alpine — see §3.4) |
| Worker image | 1.88 GB | ~0.7–0.9 GB (chown duplicate gone, `@next/swc` gone, base shared with web) |

## 1. Findings (ranked by impact / effort)

| # | Finding | Evidence | Impact | Effort |
|---|---|---|---|---|
| F1 | Every deploy builds both images on the shared prod box (6–8 min of 4-core load, 2–3 GB RAM on a box with 3.9 GB swap in use). | `/opt/slaydx/deploy.sh`, O-COMMON timings | High | M |
| F2 | Worker `RUN … && chown -R worker:nodejs /app` (`Dockerfile:143`) rewrites every file of `node_modules` (~400–560 MB) into a new layer: 97 s + roughly doubles the worker image. The worker never writes into `/app` (heartbeat → `/tmp/slaydx-worker-alive`, `lib/server/worker.ts:125`; temp files via `mkdtemp`). | Dockerfile:132–143, grep of `writeFile/mkdir` | High (size, build time) | S |
| F3 | Build cache invalidation: `builder` does `COPY . .` (`Dockerfile:27`) and `.dockerignore` does not exclude `tests/` (7.9 MB, 516 files), `loadtests/` (7.2 MB), `.github/`, `deploy/`, `CLAUDE.md`. A test-only commit re-runs the 299 s `next build`. | `.dockerignore`, `git ls-files` | High (deploy time today), Medium after move | S |
| F4 | Next file tracing pulls the **whole project tree** into every route's trace (1 056 project files per `page.js.nft.json`: `tests` 486, `lib` 462, `components` 258, `app` 155, `loadtests` 146, `scripts` 34, `CLAUDE.md`…), so `standalone/` ships source + tests + loadtests. Cause: `path.join(process.cwd(), …)` reads (`lib/server/db.ts:248`, `lib/server/admin-system.ts:100,112`) defeat nft. In Docker only the build-context files are present, so the bloat is ~20–30 MB, not hundreds, but it is useless and is exposed in a public image. | `.next/server/app/admin/(auth)/login/page.js.nft.json` analysis | Low-Med | S |
| F5 | LibreOffice on Alpine (`libreoffice-writer libreoffice-impress`) drags 286 packages / **948 MiB** incl. `llvm22-libs` 182, `qt6-qtdeclarative` 58, `mesa` 42, `qt6-qtbase-x11` 22, `python3` 22, `flite` 21, `x265-libs` 20, gtk3/gtk4, gstreamer. Total web apk set = 297 pkgs / 1 076 MiB. `font-noto-cjk` 91 MiB, `font-noto-arabic` 20, `poppler-utils` 22, worker fonts 20. | APKINDEX `I:` sizes, alpine:3.24 | High size, but in a pull model it is one stable layer pulled once | L to fix (Debian `-nogui` or sidecar) |
| F6 | Worker installs `next` with its `@next/swc-linux-x64-musl` compiler binary (~140 MB; build-time only). Prod dependency tree measured = 574 MB on glibc dev box (incl. both swc variants 285 MB). | `npm ls --omit=dev` + du | Med | S (needs smoke) |
| F7 | Web and worker share no layers except the Node base: worker installs `fontconfig ttf-liberation font-noto` separately from web's set → a common `os-base` stage lets the server store/pull them once. | Dockerfile:74, 109 | Low-Med | S |
| F8 | Restart gap is larger than documented (~1–3 s in `.claude/deploy.md` §2b). Next standalone's SIGTERM handler calls `server.close()` first (`node_modules/next/dist/server/lib/start-server.js:330–360`) → the listening socket closes immediately, then it drains in-flight requests for up to `stop_grace_period: 60s`. nginx has a single upstream (`proxy_pass http://127.0.0.1:3000`) → **every new request gets 502 for the whole drain** (up to 60 s if a 45–60 s rebuild request is in flight) **plus** new-container boot (~3–5 s). | start-server.js, snapshot nginx | Med (UX at deploy) | M (§3.7) |
| F9 | Migration on boot: web + 2 worker replicas all call `migrate()` concurrently; the advisory lock (`db.ts:271–290`, 10 min wait) serialises them — correct. Risk: a slow migration keeps web's `register()` waiting → health fails → an automatic rollback would kill the migrator mid-way (transaction rolls back, but the deploy is lost). Pre-running `scripts/migrate.ts` with the **new** image while the **old** containers still serve removes this and moves failures before any downtime. All recent migrations are additive (`DROP` only in comments: 032/033/035). | db.ts, scripts/migrate.ts, migrations | Med | S |
| F10 | Nothing secret is baked today and must stay that way: no `ARG` besides `NODE_IMAGE`; `.env*` is dockerignored; compose passes no `build.args`; GHA checkout has only tracked files. `NEXT_PUBLIC_BRAND_*` / `NEXT_PUBLIC_TELEGRAM_BOT` are therefore *not* inlined at build today either (client falls back to `"SlaydX"`/`"/logo.png"`, `lib/brand.ts:17–18`; the bot name is read server-side at runtime, `lib/server/env.ts:191`) → GHA images are behaviour-identical to box-built images. Note: Next copies a root `.env*` into `standalone/` if one exists at build time — never create one in the image job. | Dockerfile, compose, ci.yml, brand.ts | Guard | S |
| F11 | `docker builder prune` / `docker system prune` are daemon-global. BuildKit records carry no compose-project label, so build cache cannot be pruned "by project" directly; images can (compose sets `com.docker.compose.project=slaydx`; we add an OCI `source` label). | Docker docs (buildx prune filters: until, id, parents, description, inuse, mutable, immutable, shared, private, type) | Med (25 GB) | S |
| F12 | `deploy.sh` is untracked and runs from the checkout it `git reset`s — bash reads scripts incrementally, so a reset that changes the script mid-run can corrupt execution. Run an *installed copy* instead. | deploy.md §2 | Low-Med | S |
| F13 | CI `concurrency: cancel-in-progress` also cancels main pushes (2 cancelled today) — fine for deploys (latest wins), but means not every main sha gets an image. | `gh run list` | Info | – |

## 2. Registry / visibility facts (GitHub docs, fetched 2026-10-05)

- GHCR: "When you first publish a package that is scoped to your personal account, the default visibility is **private**." A
  package linked to a repo inherits the repo's *access permissions, not its visibility*. "Once you make a package public, you
  **cannot make it private again**" (only delete + recreate).
- Billing: "Container image storage and bandwidth for the Container registry is **currently free**" (1-month notice before any
  change). If it ever switches to the general Packages quota, GitHub Free = 500 MB storage / 1 GB transfer per month — our private
  images would exceed that → keep a retention job (§3.5) so the bill stays bounded if the policy changes.
- Auth: "GitHub Packages only supports authentication using a personal access token (classic)" — scope `read:packages` for pull.
  A classic PAT is **not repo/package-scoped**: it can read every package the account can read. Least privilege therefore means
  either a dedicated machine account granted read on just the two packages, or accepting the owner's PAT read-only scope.
- Workflow push: `GITHUB_TOKEN` with `packages: write` can create `ghcr.io/khusinboev/slaydx-{web,worker}`; add label
  `org.opencontainers.image.source=https://github.com/khusinboev/slaydx` so the package links to the repo (otherwise later pushes
  by `GITHUB_TOKEN` can be refused). Pulls from Actions with `GITHUB_TOKEN` are free.
- Public image content = compiled public repo (no `.env`, no `audit/`, `.claude/`, `docs/` — dockerignored; runner/worker stages
  copy only `standalone`, `static`, `public`, `migrations`, `lib`, `scripts`, `data`). So **public is technically safe today**;
  the argument against it is irreversibility and that a future mistake (a secret build-arg) would be published instantly.

## 3. Proposed changes (exact snippets; NOT applied)

### 3.1 `Dockerfile` (diff against current main)

```diff
@@ ARG NODE_IMAGE=node:22.23.2-alpine3.24
+# ─── OS asos (web va worker UMUMIY qatlamlari — serverda bir marta saqlanadi/tortiladi) ───
+FROM ${NODE_IMAGE} AS os-base
+RUN apk add --no-cache fontconfig ttf-liberation font-noto && fc-cache -f >/dev/null 2>&1 || true
+LABEL org.opencontainers.image.source="https://github.com/khusinboev/slaydx"
+
 # ─── Bog'liqliklar ────────────────────────────────────────────────────
 FROM ${NODE_IMAGE} AS deps
 WORKDIR /app
 COPY package.json package-lock.json ./
 RUN npm ci
 
+# ─── Prod bog'liqliklar (worker) ───────────────────────────────────────
+# `@next/swc-*` — faqat build kompilyatori (~140 MB); worker `next/server`ni
+# import qiladi, lekin SWC'ni yuklamaydi. (WP1 worker smoke bilan tasdiqlansin.)
+FROM ${NODE_IMAGE} AS prod-deps
+WORKDIR /app
+COPY package.json package-lock.json ./
+RUN npm ci --omit=dev && npm cache clean --force && rm -rf node_modules/@next/swc-*
+
 # ─── Qurish ───────────────────────────────────────────────────────────
@@
-FROM ${NODE_IMAGE} AS runner
+FROM os-base AS runner
 WORKDIR /app
@@
-RUN apk add --no-cache       libreoffice-writer libreoffice-impress       ttf-liberation font-noto font-noto-cjk font-noto-arabic poppler-utils   && fc-cache -f >/dev/null 2>&1 || true   && soffice --headless --version >/dev/null 2>&1 || true
+# ttf-liberation/font-noto/fontconfig allaqachon `os-base`da.
+RUN apk add --no-cache libreoffice-writer libreoffice-impress font-noto-cjk font-noto-arabic poppler-utils \
+  && fc-cache -f >/dev/null 2>&1 || true \
+  && soffice --headless --version >/dev/null 2>&1 || true
@@ RUN mkdir -p /var/cache/slaydx-derived && chown nextjs:nodejs /var/cache/slaydx-derived
 
+# Qaysi commit — deploy skripti va admin tizim sahifasi uchun. Oxirida: faqat
+# metadata, og'ir qatlamlar keshini buzmaydi. SIR EMAS — bu yerga hech qachon
+# kalit/token ARG qo'shilmaydi (image ochiq bo'lishi mumkin; CI guard tekshiradi).
+ARG GIT_SHA=unknown
+ENV APP_GIT_SHA=${GIT_SHA}
+LABEL org.opencontainers.image.revision=${GIT_SHA}
+
 USER nextjs
@@
-FROM ${NODE_IMAGE} AS worker
+FROM os-base AS worker
 WORKDIR /app
 ENV NODE_ENV=production
 ENV NEXT_TELEMETRY_DISABLED=1
-
-RUN apk add --no-cache fontconfig ttf-liberation font-noto && fc-cache -f >/dev/null 2>&1 || true
-
-COPY package.json package-lock.json ./
-# Tarix (INFRA-12/DEPS-06): … (keep the history comment, move it above prod-deps)
-RUN npm ci --omit=dev && npm cache clean --force
-COPY lib ./lib
-COPY scripts ./scripts
-COPY tsconfig.json ./
-COPY data ./data
-
-RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001 && chown -R worker:nodejs /app
+# Foydalanuvchi AVVAL yaratiladi, fayllar `COPY --chown` bilan nusxalanadi:
+# ilgari `chown -R /app` alohida qatlamda butun node_modules'ni qayta yozardi
+# (97 s + image ~2 barobar). Worker `/app`ga yozmaydi (yurak urishi /tmp'da).
+RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001
+COPY --chown=worker:nodejs --from=prod-deps /app/node_modules ./node_modules
+COPY --chown=worker:nodejs package.json package-lock.json tsconfig.json ./
+COPY --chown=worker:nodejs lib ./lib
+COPY --chown=worker:nodejs scripts ./scripts
+COPY --chown=worker:nodejs data ./data
+ARG GIT_SHA=unknown
+ENV APP_GIT_SHA=${GIT_SHA}
+LABEL org.opencontainers.image.revision=${GIT_SHA}
 USER worker
```
Notes: (a) stricter alternative — drop `--chown` entirely (code root-owned, read-only for the worker user); same size/speed.
(b) uid/gid stay 1001 → the `derived-cache` volume ownership is unchanged. (c) `ARG GIT_SHA` placed last so it never busts
heavy layers. (d) Layer order makes per-deploy deltas small: worker = only the `lib/scripts/data` COPY layers (~5 MB) unless
`package-lock.json` changed; web = `standalone` + `static` (~80–120 MB compressed).

### 3.2 `.dockerignore` (append)

```diff
+# Build/runtime'ga kerak emas; `COPY . .`ni (va 299 s `next build` keshini) bekorga buzadi,
+# Next file tracing esa ularni standalone'ga ham sudrab kiritadi (F4).
+tests
+loadtests
+.github
+deploy
+CLAUDE.md
+*.md
+!package*.json
+docker-compose*.yml
+docker-bake.hcl
+coverage
+.vscode
```
Do **not** add `scripts/` (`npm run build` runs `scripts/guard-build.mjs`; worker copies `scripts/`), `data/`, `brand/`
(harmless 252 KB), `public/`. `*.md` drops `README.md` (already excluded) and `CLAUDE.md`; no `.md` is read at runtime (verify
with `grep -rn "\.md\"" lib app` in WP1).

### 3.3 `next.config.ts` (optional, F4)

```ts
  // Next file tracing `process.cwd()` asosidagi o'qishlar (db.ts migratsiyalar,
  // admin-system.ts package.json) tufayli butun loyiha daraxtini standalone'ga
  // qo'shadi. Runtime'da kerak emaslarini chiqarib tashlaymiz; migratsiyalar
  // Dockerfile'da alohida COPY qilinadi.
  outputFileTracingExcludes: {
    "*": ["tests/**", "loadtests/**", "eval-out/**", "audit/**", "docs/**", "scratch-tmp/**",
          "brand/**", "scripts/**", "components/**", "*.md", ".github/**"],
  },
```
Keep `lib/**`, `app/**`, `data/**`, `public/**` traced (some routes read files at runtime). Verify by diffing
`find .next/standalone -type f | wc -l` before/after in the CI image job summary.

### 3.4 Not now: shrinking LibreOffice (F5)

Options, all L effort and parity-risky (document rendering is pixel-tested in this project): (1) Debian `bookworm-slim` base with
`libreoffice-writer-nogui libreoffice-impress-nogui` (no Qt/GTK/LLVM; would switch musl→glibc for sharp/swc too); (2) move
LibreOffice/poppler into its own small converter service so `web` becomes ~400 MB. In the pull model the LO layer is pulled once
and reused across deploys (identical digest while the GHA cache holds it), so its cost is disk (~1 GB once), not deploy time.
Recommend revisiting only if disk or cold-start pull time becomes an issue.

### 3.5 CI: `.github/workflows/ci.yml` (append jobs; `check` unchanged)

```yaml
# (top level, after `concurrency:`)
permissions:
  contents: read

jobs:
  check:
    # … unchanged …

  # Prod image'lar testlar bilan PARALLEL quriladi, lekin faqat `build-<sha>`
  # nomzod tegi bilan. Testlar o'tgachgina `promote` ularni `<sha>` va `main`
  # deb belgilaydi — deploy skripti FAQAT `<sha>` tegini tortadi, ya'ni
  # testdan o'tmagan commit prod'ga tusha olmaydi.
  image:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      packages: write
    env:
      REG: ghcr.io/${{ github.repository_owner }}
    steps:
      - uses: actions/checkout@v4            # pin all actions below to full commit SHAs (they hold packages:write)
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Guard — no secrets as build args
        run: |
          ! grep -nEi '^\s*(ARG|ENV)\s+\S*(KEY|SECRET|TOKEN|PASSWORD)' Dockerfile
          test ! -e .env && test ! -e .env.local
      # Ikkala target BITTA builder'da ketma-ket: `os-base` bir marta quriladi va
      # ikkala image'da bayt-ma-bayt bir xil qatlam bo'ladi (serverda bir marta saqlanadi).
      - name: Build web
        uses: docker/build-push-action@v6
        with:
          context: .
          target: runner
          platforms: linux/amd64
          push: true
          provenance: false
          build-args: GIT_SHA=${{ github.sha }}
          tags: ${{ env.REG }}/slaydx-web:build-${{ github.sha }}
          cache-from: |
            type=gha,scope=web
            type=gha,scope=worker
          cache-to: type=gha,scope=web,mode=max
      - name: Build worker
        uses: docker/build-push-action@v6
        with:
          context: .
          target: worker
          platforms: linux/amd64
          push: true
          provenance: false
          build-args: GIT_SHA=${{ github.sha }}
          tags: ${{ env.REG }}/slaydx-worker:build-${{ github.sha }}
          cache-from: |
            type=gha,scope=worker
            type=gha,scope=web
          cache-to: type=gha,scope=worker,mode=max
      - name: Image sizes → summary
        run: |
          for s in web worker; do
            docker buildx imagetools inspect "$REG/slaydx-$s:build-$GITHUB_SHA" --format '{{json .Manifest}}' \
              | jq -r --arg s "$s" '"\($s): \([.layers[].size]|add/1048576|floor) MiB compressed, \(.layers|length) layers"' \
              >> "$GITHUB_STEP_SUMMARY" || true
          done

  promote:
    needs: [check, image]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      packages: write
    env:
      REG: ghcr.io/${{ github.repository_owner }}
    steps:
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Tag tested images
        run: |
          for s in web worker; do
            docker buildx imagetools create --prefer-index=false \
              -t "$REG/slaydx-$s:$GITHUB_SHA" -t "$REG/slaydx-$s:main" \
              "$REG/slaydx-$s:build-$GITHUB_SHA"
          done
          echo "Deploy: \`ssh root@<SERVER_IP> slaydx-deploy $GITHUB_SHA\`" >> "$GITHUB_STEP_SUMMARY"
```
Why `needs:` in the same workflow and not `workflow_run`: simpler, no privileged default-branch context, and `pull_request`
(incl. forks) never reaches a job with `packages: write`. Estimated image job: cold ~6–8 min, warm ~3–5 min (fits inside the
~13 min `check`), promote ~15 s. Runner minutes are free for a public repo.

Optional extra job for PRs touching `Dockerfile`/`package-lock.json`/`.dockerignore`: same build with `push: false`
(catches Dockerfile breakage before merge).

Retention — new `.github/workflows/ghcr-retention.yml` (weekly `schedule` + `workflow_dispatch`):
```yaml
on: { schedule: [{ cron: "17 3 * * 1" }], workflow_dispatch: {} }
permissions: { packages: write }
jobs:
  prune:
    runs-on: ubuntu-latest
    strategy: { matrix: { pkg: [slaydx-web, slaydx-worker] } }
    steps:
      - uses: actions/delete-package-versions@v5
        with: { package-name: "${{ matrix.pkg }}", package-type: container, min-versions-to-keep: 30 }
```
(`build-<sha>` and `<sha>`/`main` are tags on the *same* version after a carbon-copy promote, so 30 versions ≈ 30 deployable shas.)

### 3.6 Server: `deploy/deploy-pull.sh` (new, versioned; installed as `/usr/local/sbin/slaydx-deploy`)

```bash
#!/usr/bin/env bash
# slaydx-deploy — PULL asosidagi deploy (image'lar GitHub Actions'da quriladi, .claude/deploy.md §2).
#
# O'rnatish (egasi, bir marta va har yangilanganda — checkout ichidan ISHLATILMAYDI, chunki
# `git reset` ishlab turgan skriptni o'zgartirib yuborishi mumkin):
#   install -o root -g root -m 0750 /opt/slaydx/deploy/deploy-pull.sh /usr/local/sbin/slaydx-deploy
# Foydalanish:
#   slaydx-deploy <sha|main> [--no-backup] [--no-premigrate] [--force]
#   slaydx-deploy rollback            # ROLLBACK.txt dagi oldingi versiyaga
set -Eeuo pipefail
umask 077

APP_DIR=/opt/slaydx
PROJECT=slaydx
REG=ghcr.io/khusinboev
BACKUP_DIR=/root/slaydx-backups
STATE_DIR=/var/lib/slaydx-deploy
OVERRIDE="$APP_DIR/docker-compose.override.yml"
HEALTH_URL=http://127.0.0.1:3000/api/health
HEALTH_TIMEOUT=240
MIN_FREE_GB=5
KEEP_IMAGES=3
# GHCR o'qish tokeni FAQAT shu yerda (root 700) — boshqa loyihalarning docker
# buyruqlari uni ko'rmaydi. Image ommaviy bo'lsa — login kerak emas.
export DOCKER_CONFIG=/etc/slaydx/docker

T0=$(date +%s)
log() { printf '%s [+%ss] %s\n' "$(date +%T)" "$(( $(date +%s) - T0 ))" "$*"; }
die() { log "XATO: $*"; exit 1; }
dc()  { docker compose -p "$PROJECT" "$@"; }

exec 9>/run/lock/slaydx-deploy.lock
flock -n 9 || die "boshqa deploy ishlayapti"
mkdir -p "$STATE_DIR" "$BACKUP_DIR"
cd "$APP_DIR"

ARG="${1:-}"; shift || true
BACKUP=1; PREMIGRATE=1; FORCE=0
for a in "$@"; do case "$a" in
  --no-backup) BACKUP=0 ;; --no-premigrate) PREMIGRATE=0 ;; --force) FORCE=1 ;;
  *) die "noma'lum bayroq: $a" ;; esac; done
[[ "$ARG" =~ ^([0-9a-f]{7,40}|main|rollback)$ ]] || die "foydalanish: slaydx-deploy <sha|main|rollback>"

PREV_SHA=$(cat "$STATE_DIR/current" 2>/dev/null || git rev-parse HEAD)
if [ -f "$OVERRIDE" ]; then PREV_MODE=pull; else PREV_MODE=build; fi

git fetch --quiet origin main
case "$ARG" in
  main)     SHA=$(git rev-parse origin/main) ;;
  rollback) SHA=$(head -1 "$BACKUP_DIR/ROLLBACK.txt"); BACKUP=0; PREMIGRATE=0
            [ "$(sed -n 's/^mode=//p' "$STATE_DIR/rollback.env" 2>/dev/null)" = build ] \
              && die "oldingi versiya on-server build edi: deploy-build.sh $SHA ishlating" ;;
  *)        SHA=$(git rev-parse --verify --quiet "${ARG}^{commit}") || die "commit topilmadi: $ARG" ;;
esac
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "sha noto'g'ri: $SHA"
git merge-base --is-ancestor "$SHA" origin/main || die "$SHA origin/main tarixida emas"
[ "$SHA" != "$PREV_SHA" ] || [ "$PREV_MODE" = build ] || [ "$FORCE" = 1 ] || { log "allaqachon $SHA"; exit 0; }
SHORT=${SHA:0:7}
log "deploy $SHORT (oldingi: ${PREV_SHA:0:7}, $PREV_MODE)"

free_gb=$(df --output=avail -BG / | tail -1 | tr -dc 0-9)
[ "$free_gb" -ge "$MIN_FREE_GB" ] || die "disk: ${free_gb} GB bo'sh (< ${MIN_FREE_GB})"

# 1) Tortish — eski konteynerlar ishlayveradi, uzilish yo'q.
declare -A REF EXPECT
for s in web worker; do
  img="$REG/slaydx-$s:$SHA"
  docker pull -q "$img" >/dev/null || die "$img yo'q — CI 'promote' job tugadimi?"
  rev=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$img")
  [ "$rev" = "$SHA" ] || die "$img revision=$rev, kutilgan $SHA"
  # Teg o'zgaruvchan — digest bilan qadaymiz (tag@digest).
  REF[$s]="$img@$(docker image inspect -f '{{index .RepoDigests 0}}' "$img" | cut -d@ -f2)"
  EXPECT[$s]=$(docker image inspect -f '{{.Id}}' "$img")
done
log "image'lar tortildi"

# 2) Zaxira — faqat migratsiyalar o'zgarsa (kunlik cron baribir bor).
if [ "$BACKUP" = 1 ] && [ -n "$(git diff --name-only "$PREV_SHA" "$SHA" -- lib/server/migrations 2>/dev/null || echo x)" ]; then
  f="$BACKUP_DIR/pre-$SHORT-$(date +%Y%m%d-%H%M).dump"
  docker exec slaydx-postgres-1 pg_dump -U slaydx -Fc slaydx > "$f" || die "pg_dump yiqildi"
  ls -1t "$BACKUP_DIR"/pre-*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f   # oxirgi 5 ta
  log "zaxira: $f ($(du -h "$f" | cut -f1))"
fi

# 3) Orqaga qaytish ma'lumoti (ROLLBACK.txt 1-qatori = sha — eski qo'llanma bilan mos).
echo "$PREV_SHA" > "$BACKUP_DIR/ROLLBACK.txt"
printf 'sha=%s\nmode=%s\nat=%s\nreplaced_by=%s\n' "$PREV_SHA" "$PREV_MODE" "$(date -Is)" "$SHA" > "$STATE_DIR/rollback.env"
if [ "$PREV_MODE" = pull ]; then cp -f "$OVERRIDE" "$STATE_DIR/override.prev"; else rm -f "$STATE_DIR/override.prev"; fi

write_override() {  # $1=web ref, $2=worker ref, $3=sha
  cat > "$OVERRIDE.tmp" <<EOF
# BOSHQARILADI: slaydx-deploy. Qo'lda tahrirlamang. Prod image'lar $3 ga qadalgan.
# On-server build kerak bo'lsa: deploy/deploy-build.sh (bu faylni chetga oladi).
services:
  web:
    image: $1
  worker:
    image: $2
EOF
  mv "$OVERRIDE.tmp" "$OVERRIDE"
}
restore_prev() {
  git reset --quiet --hard "$PREV_SHA"
  if [ -f "$STATE_DIR/override.prev" ]; then cp -f "$STATE_DIR/override.prev" "$OVERRIDE"; else rm -f "$OVERRIDE"; fi
}

git reset --quiet --hard "$SHA"          # compose fayli (env ro'yxati) image bilan bir commitdan
write_override "${REF[web]}" "${REF[worker]}" "$SHA"
dc config -q || { restore_prev; die "compose config yaroqsiz"; }

# 4) Migratsiya YANGI image bilan, ESKI konteynerlar hali xizmat qilayotganda.
#    (Migratsiyalar faqat qo'shuvchi bo'lishi shart — expand/contract qoidasi.)
if [ "$PREMIGRATE" = 1 ]; then
  if ! dc run --rm --no-deps -T worker ./node_modules/.bin/tsx --conditions=react-server scripts/migrate.ts; then
    restore_prev; die "migratsiya yiqildi — eski versiya ishlashda davom etmoqda (uzilish bo'lmadi)"
  fi
  log "migratsiyalar tayyor"
fi

# 5) Almashtirish.
dc up -d --no-build
log "konteynerlar yangilandi, sog'liq kutilmoqda"

healthy() {  # 0=sog'lom, 1=hali emas, 2=qayta ishga tushish (darhol muvaffaqiyatsiz)
  local s want c st img rc expect
  for s in web worker; do
    want=1; [ "$s" = worker ] && want=2
    mapfile -t cs < <(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$s")
    [ "${#cs[@]}" -eq "$want" ] || return 1
    expect=${EXPECT[$s]:-}          # rollback paytida bo'sh — faqat sog'liq tekshiriladi
    for c in "${cs[@]}"; do
      read -r st img rc < <(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.Image}} {{.RestartCount}}' "$c")
      [ "$rc" = 0 ] || return 2
      [ -z "$expect" ] || [ "$img" = "$expect" ] || return 1
      [ "$st" = healthy ] || return 1
    done
  done
  curl -fsS -m 5 "$HEALTH_URL" | grep -q '"status":"ok"'
}
wait_healthy() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT )) r
  while [ "$(date +%s)" -lt "$deadline" ]; do
    healthy && return 0; r=$?; [ "$r" = 2 ] && return 1; sleep 5
  done
  return 1
}

if wait_healthy; then
  echo "$SHA" > "$STATE_DIR/current"
  echo "$(date -Is) $SHA ok $(( $(date +%s) - T0 ))s prev=$PREV_SHA" >> "$STATE_DIR/history.log"
  # 6) Tozalash — FAQAT slaydx image'lari: joriy + oldingi + oxirgi $KEEP_IMAGES.
  for s in web worker; do
    docker image ls "$REG/slaydx-$s" --format '{{.Tag}}' | grep -E '^[0-9a-f]{40}$' \
      | grep -vx -e "$SHA" -e "$PREV_SHA" | tail -n +"$KEEP_IMAGES" \
      | xargs -r -I{} docker image rm "$REG/slaydx-$s:{}" >/dev/null || true
  done
  docker image prune -f --filter "label=org.opencontainers.image.source=https://github.com/khusinboev/slaydx" >/dev/null || true
  log "✅ tayyor: $SHORT ($(( $(date +%s) - T0 )) s)"
else
  log "❌ sog'liq tekshiruvi o'tmadi — ${PREV_SHA:0:7} ga qaytarilmoqda"
  dc logs --tail=80 web worker || true
  restore_prev
  EXPECT=()
  dc up -d --no-build
  wait_healthy && log "↩ oldingi versiya tiklandi" || log "!!! oldingi versiya ham sog'lom emas — qo'lda tekshiring"
  echo "$(date -Is) $SHA FAILED rolled_back_to=$PREV_SHA" >> "$STATE_DIR/history.log"
  exit 1
fi
```
Design notes:
- Base `docker-compose.yml` needs **no change**: the auto-loaded `docker-compose.override.yml` (untracked; add it to
  `.gitignore`) overrides `image:` for `web`/`worker`, so any manual `docker compose -p slaydx up -d` / `restart` keeps the pinned
  sha (no env var to forget). `tests/compose-env.test.mts` is untouched. Avoided `build: !reset` (version-dependent); instead the
  script always uses `--no-build`, and the fallback script moves the override away (below).
- Rollback to a *build-mode* previous version (first pull deploy) works because `slaydx-web:latest`/`slaydx-worker:latest` stay
  on disk; `restore_prev` removes the override → compose falls back to those local images. Remove them only after 2–3 good pull
  deploys (owner step).
- `--no-premigrate` keeps today's boot-time migration behaviour; boot-time `ensureMigrated` stays as a safety net either way
  (it becomes a no-op after the pre-run).
- Worker jobs mid-flight: SIGTERM → graceful requeue (`lib/server/worker.ts:1229–1298`, C14) — unchanged.
- Health semantics: web `/api/health` 200 + `"status":"ok"` (DB up) + Docker health `healthy` for web and both workers + running
  image id == pinned image + `RestartCount==0` (a boot `process.exit(1)` from `assertRuntimeConfig`, `instrumentation.ts`, fails
  fast instead of waiting 240 s). Worker first health probe lands at ~30 s (interval 30 s), so typical success ≈ 35–60 s.

`deploy/deploy-build.sh` (new — the old path, kept as fallback when GHCR/CI is unavailable):
```bash
#!/usr/bin/env bash
# Zaxira yo'l: image'ni SERVERDA qurish (eski deploy.sh). Faqat GHCR/CI ishlamasa.
set -Eeuo pipefail
cd /opt/slaydx
exec 9>/run/lock/slaydx-deploy.lock; flock -n 9 || { echo "boshqa deploy ishlayapti"; exit 1; }
mkdir -p /var/lib/slaydx-deploy /root/slaydx-backups
git rev-parse HEAD > /root/slaydx-backups/ROLLBACK.txt
if [ -f docker-compose.override.yml ]; then
  cp -f docker-compose.override.yml /var/lib/slaydx-deploy/override.prev
  printf 'sha=%s\nmode=pull\nat=%s\n' "$(git rev-parse HEAD)" "$(date -Is)" > /var/lib/slaydx-deploy/rollback.env
  rm -f docker-compose.override.yml          # aks holda `build` natijasi ghcr tegi bilan belgilanib qolardi
fi
git fetch origin && git reset --hard "${1:-origin/main}"
docker compose -p slaydx build && docker compose -p slaydx up -d
for i in $(seq 1 40); do curl -fsS -m 5 http://127.0.0.1:3000/api/health >/dev/null && { echo "✅ tayyor"; git rev-parse HEAD > /var/lib/slaydx-deploy/current; exit 0; }; sleep 3; done
echo "❌ health 2 daqiqada o'tmadi"; exit 1
```
The untracked `/opt/slaydx/deploy.sh` must be retired (renamed) when pull deploys start: run while an override exists it would
build HEAD and tag it with the pinned ghcr sha name — misleading.

### 3.7 Low-downtime web swap (phase 2, F8)

One-time nginx change (graceful `nginx -t && systemctl reload nginx`, does not affect other sites), file
`deploy/nginx/slaydx.conf.example` + live config:
```nginx
upstream slaydx_web {
    server 127.0.0.1:3000 max_fails=1 fail_timeout=3s;
    server 127.0.0.1:3001 backup;          # vaqtinchalik "ko'prik" konteyner, faqat deploy paytida
}
# location / { proxy_pass http://slaydx_web; proxy_next_upstream error timeout; proxy_next_upstream_tries 2; … }
```
Script step (between §3.6 steps 4 and 5): start a bridge from the **new** image on 3001, wait healthy, recreate `web`, wait
healthy, stop the bridge:
```bash
dc run -d --rm --no-deps --name slaydx-web-bridge -p 127.0.0.1:3001:3000 web
until curl -fsS -m 3 http://127.0.0.1:3001/api/health >/dev/null; do sleep 2; done   # + timeout
dc up -d --no-build                      # old web closes its socket → nginx fails over to 3001 (connect refused = safe to retry, even POST)
wait_healthy && docker stop -t 60 slaydx-web-bridge
```
Effect: the 502 window (drain up to 60 s + boot 3–5 s) → ~0. Cost: one extra web process (~100–300 MB) for ~1 min.
`proxy_next_upstream error` only retries when the request was not sent upstream, so non-idempotent requests are not duplicated.

### 3.8 Build-cache / image cleanup on the shared box (F11)

- After the switch the box stops producing slaydx build cache. For the existing 25 GB (229 records, 0 in use):
  - Scoped: `docker buildx du --verbose` → prune only records whose description is clearly slaydx, e.g.
    `docker builder prune -f --filter description=parse-worker`, `…=libreoffice-writer`, `…=slaydx-derived`,
    `…="chown -R worker:nodejs"`, `…="NEXT_OUTPUT"`, then re-check `docker system df`. Generic layers (`npm ci`) may remain.
  - Global but harmless-to-runtime: `docker builder prune -f --filter until=168h` deletes only **build cache** (never images,
    containers, volumes); other projects only lose speed on their next build. Needs owner OK (rule: never touch other projects).
- If the fallback build path is used again: give it its own builder so its cache is isolated and prunable by name:
  `docker buildx create --name slaydx --driver docker-container` + `docker compose build --builder slaydx` (compose ≥2.20);
  cleanup = `docker buildx prune --builder slaydx -f --max-used-space 5gb` or `docker buildx rm slaydx`.
- Images: the deploy script keeps current + previous + 3 ghcr shas and prunes **dangling** images by the slaydx OCI label only.
  One-time owner step after 2–3 good pull deploys: `docker image rm slaydx-web:pre-hotfix1 slaydx-worker:pre-hotfix1
  slaydx-web:latest slaydx-worker:latest` and `docker image prune -f --filter label=com.docker.compose.project=slaydx`
  (dangling slaydx-built images only).

### 3.9 Trigger model comparison

| Model | What GitHub holds | What the server holds | Blast radius if GitHub account/workflow is compromised | Effort |
|---|---|---|---|---|
| **A. Manual** `ssh root@… slaydx-deploy <sha>` (recommended now) | nothing for prod | read-only registry token | none on prod (attacker can only push images; a human still picks the sha, script refuses non-main shas and untested tags) | S |
| B. "Deploy" button, pull-only server: `workflow_dispatch` job in environment `production` (required reviewer = owner) moves tag `:prod` → server systemd timer (60 s) reads `:prod` digest/revision label and runs `slaydx-deploy <sha>`; result to the existing backup Telegram chat | `GITHUB_TOKEN` only | read-only token | attacker with repo write could move `:prod` to any **tested main** sha (script checks ancestry + `<sha>` tag) — no shell on the box | M |
| C. GHA SSH deploy (`appleboy/ssh-action` etc.) | an SSH private key to the shared box | authorized key (ideally a `deploy` user with forced command `slaydx-deploy $SSH_ORIGINAL_COMMAND`) | without forced command: root on a box hosting 4 other projects; with it: same as B but a stolen key also exposes SSH surface; docker-group user = root-equivalent anyway | M |

## 4. Work packages (exclusive file ownership)

| WP | Files (exclusive) | Content | Verification |
|---|---|---|---|
| WP1 Image slimming | `Dockerfile`, `.dockerignore`, `next.config.ts` (tracing excludes only) | §3.1–3.3 | CI `docker build` both targets; `docker history`/sizes in summary; worker smoke: boots, heartbeat file, processes 1 job (verifies `@next/swc` removal + no `/app` writes); web smoke: PDF export (LibreOffice), template upload (`pdftoppm`), `/api/health`; `find standalone` count diff; `tests/compose-env.test.mts` still green |
| WP2 CI images | `.github/workflows/ci.yml`, `.github/workflows/ghcr-retention.yml` | §3.5 (+ SHA-pinned actions) | first main push: packages created, private, linked to repo; promote only after `check` green; a failing-test commit gets `build-<sha>` but no `<sha>` tag |
| WP3 Deploy scripts | `deploy/deploy-pull.sh`, `deploy/deploy-build.sh`, `.gitignore` (+`docker-compose.override.yml`), `tests/deploy-scripts.test.mts` (shellcheck + dry-run stubs of `docker`/`git`/`curl` on PATH testing: arg validation, non-main sha refused, health fail → rollback path, rollback restores override / removes it for build-mode) | §3.6 | `shellcheck -S warning`; stubbed tests; then a real staged run on prod with owner present |
| WP4 Docs | `.claude/deploy.md` (§2 pull path, §4 rollback, token, fallback, cache rule), `CLAUDE.md` deploy pointer if any | | review |
| WP5 (phase 2) Zero-gap web | `deploy/nginx/slaydx.conf.example`, bridge step in `deploy/deploy-pull.sh` (after WP3 merges) | §3.7 | browser/curl loop during a deploy: 0 non-2xx |
| WP6 Owner/lead server steps (no code) | server only | create token, `mkdir -m 700 /etc/slaydx/docker && DOCKER_CONFIG=/etc/slaydx/docker docker login ghcr.io -u khusinboev --password-stdin`, install script, first pull deploy, retire `deploy.sh`, cache/image cleanup §3.8 | `slaydx-deploy <sha>` timings logged in `/var/lib/slaydx-deploy/history.log` |

Order: WP1 → WP2 (can merge together) → WP3/WP4 → WP6 first pull deploy (owner present) → WP5 later.

## 5. OWNER decisions

**D1 — Registry & visibility**
1. *(recommended)* GHCR **private** packages + read-only token on the server. Free today; reversible (can go public later).
2. GHCR **public**: zero credentials on the server, simplest; image = compiled public repo (no secrets today). Irreversible.
3. Docker Hub / other registry — no advantage; extra account and rate limits.

**D2 — Deploy trigger**
1. *(recommended now)* Manual `ssh root@<SERVER_IP> slaydx-deploy <sha>` (the CI summary prints the exact command).
2. Phase 2: "Deploy" button in GitHub (environment approval) + pull-only server timer — no SSH key in GitHub.
3. GitHub Actions SSH deploy with a forced-command key — not recommended (prod key in GitHub, shared box).

**D3 — Token handling (if D1 = private)**
1. *(recommended)* Owner's classic PAT with **only** `read:packages`, 1-year expiry (calendar reminder), stored only in
   `/etc/slaydx/docker/config.json` (root 700, used only by `slaydx-deploy` via `DOCKER_CONFIG`). Caveat: classic PAT reads *all*
   packages of the account.
2. Dedicated machine GitHub account granted read on just `slaydx-web`/`slaydx-worker` + its classic `read:packages` PAT —
   true least privilege, one more account to maintain.
3. None (only if D1 = public).

**D4 — Migrations before the swap**
1. *(recommended)* Pre-run `scripts/migrate.ts` with the new image while the old containers serve (failure ⇒ no downtime, auto
   abort). Requires the existing practice "migrations are additive" to stay a rule.
2. Keep boot-only migrations (`--no-premigrate` as default).

**D5 — Existing 25 GB build cache**
1. *(recommended)* Owner-approved one-time `docker builder prune -f --filter until=168h` (build cache only; other projects'
   running containers/images/volumes untouched, their next build just isn't cached).
2. Scoped `--filter description=…` pruning of slaydx-identifiable records (partial reclaim).
3. Leave it.

## 6. Risks and rollback

| Risk | Mitigation / rollback |
|---|---|
| GHCR or Actions outage at deploy time | `deploy/deploy-build.sh` (old path) still works; script removes the override first |
| Untested image deployed | script pulls only `:<sha>`, which exists only after `promote` (needs `check`); also requires sha ∈ `origin/main` |
| Tag overwritten later (re-run / malicious push) | override pins `tag@digest`; revision label checked at pull |
| New image unhealthy | automatic rollback to previous override/sha (or to local `slaydx-*:latest` if the previous deploy was a box build); exit 1 with logs |
| Migration incompatible with old code during swap | D4 rule (additive only); pre-deploy `pg_dump -Fc` automatically when `lib/server/migrations` changed; DB never auto-restored (manual, owner-approved, as today) |
| Behaviour drift between box-built and GHA-built image | same Dockerfile, same pinned `NODE_IMAGE`, no build args/env either way (F10); first pull deploy done with owner present + smoke (PDF export, generation, admin) |
| `@next/swc` removal breaks worker | WP1 worker smoke; revert = delete the `rm -rf` |
| Disk on shared box | each deploy adds ~100–150 MB unpacked delta; keep 3 versions; first pull ~2–3 GB unpacked; script refuses < 5 GB free |
| Token expiry (D3.1) | pull fails loudly before anything changes; refresh token, re-run |
| GHCR billing policy change | retention workflow keeps 30 versions; public option removes the issue |
| Revert the whole change | `rm docker-compose.override.yml && deploy/deploy-build.sh` → exactly today's flow; CI jobs can be deleted independently |
