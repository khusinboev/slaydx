#!/usr/bin/env bash
#
# Og'ir buyruqni ALOHIDA cgroup ichida, XOTIRA va VAQT chegarasi bilan yurgizadi.
#
# Nega kerak (2026-09-11 saboq): `npm run test:ui` node:test bilan har test
# faylini ALOHIDA jarayonda va PARALLEL yurgizadi (12 yadroli mashinada 11 ta
# jsdom jarayoni); ustiga ikkita agent o'z worktree'ida chegarasiz `npm test`
# va `tsc` yurgizgan. Jami xotira 14 GB dan oshib, OOM VS Code'ni o'ldirdi va
# sessiya uzildi. Bu skript ikki qatlamli chegara qo'yadi:
#
#   1. `slaydx-heavy.slice` — BARCHA og'ir ishlar (lead + agentlar) uchun
#      umumiy shift: MemoryMax=5G. Chegaradan oshsa OOM faqat SHU slice
#      ichidagi jarayonni o'ldiradi — VS Code, Claude va ish stoli tashqarida.
#   2. Har buyruq o'z scope'ida: MemoryMax (standart 3G) va `timeout`
#      (standart 900 s, KILL). Bitta buyruq boshqasini ham "yeb" qo'ymaydi.
#
# Foydalanish:
#   scripts/heavy.sh npm test
#   scripts/heavy.sh -m 2G -t 600 npx tsx --tsconfig tsconfig.viewer.json --test tests/ui/foo.test.mts
#   scripts/heavy.sh -m 4G npx tsc --noEmit
#
# Qoidalar (CLAUDE.md «Og'ir buyruqlar»):
#   - `npm test`, `test:ui`, `test:viewer`, `tsc`, `next build`, LibreOffice,
#     Playwright, jonli sinov — FAQAT shu skript orqali;
#   - node:test to'plamlarini bitta yugurishda emas, FAYL BO'YICHA yoki
#     `--test-concurrency=2` bilan (package.json skriptlarida o'rnatilgan);
#   - bir vaqtda 2 tadan ortiq og'ir buyruq yo'q (agentlar ham hisobga kiradi).
set -euo pipefail

MEM="${HEAVY_MEM:-3G}"
T="${HEAVY_TIMEOUT:-900}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m) MEM="$2"; shift 2 ;;
    -t) T="$2"; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
if [[ $# -eq 0 ]]; then
  echo "foydalanish: scripts/heavy.sh [-m 3G] [-t 900] <buyruq...>" >&2
  exit 2
fi

SLICE=slaydx-heavy.slice
# Umumiy shift chegarasi (idempotent; bir marta yoziladi, keyin o'zgarmaydi).
systemctl --user set-property "$SLICE" MemoryMax=5G MemoryHigh=4G MemorySwapMax=512M >/dev/null 2>&1 || true

# Node jarayonlari o'z heap'ini ham chegaralasin — OOM o'rniga aniq xato.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"

if command -v systemd-run >/dev/null 2>&1; then
  exec systemd-run --user --scope --quiet --slice="$SLICE" \
    -p MemoryMax="$MEM" -p MemorySwapMax=256M \
    timeout -s KILL "$T" "$@"
else
  # systemd bo'lmagan muhit (CI, konteyner) — hech bo'lmasa vaqt chegarasi.
  exec timeout -s KILL "$T" "$@"
fi
