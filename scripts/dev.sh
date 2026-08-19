#!/usr/bin/env bash
# Lokal to'liq stek: web + worker va Telegram bot.
#
# Foydalanish:
#   ./scripts/dev.sh start   — ishga tushirish
#   ./scripts/dev.sh stop    — to'xtatish
#   ./scripts/dev.sh status  — holat
#   ./scripts/dev.sh logs    — jurnal
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOGS="$ROOT/.data/logs"
mkdir -p "$LOGS"
WEB_PID="$LOGS/web.pid"
BOT_PID="$LOGS/bot.pid"

load_env() {
  if [[ -f .env.local ]]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env.local
    set +a
  fi
}

# `npm run` o'zi wrapper process ochadi va u tugab ketishi mumkin, shuning
# uchun holatni PID emas, haqiqiy process namunasi bo'yicha tekshiramiz.
WEB_PAT="next-serve[r]|nex[t] dev"
BOT_PAT="bo[t].mts"

running() { pgrep -f "$1" >/dev/null 2>&1; }
alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

start() {
  load_env

  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL yo'q — .env.local ni tekshiring" >&2
    exit 1
  fi

  # Baza ko'tarilmagan bo'lsa migratsiya ham, server ham ishlamaydi.
  npm run db:migrate

  if running "$WEB_PAT"; then
    echo "web allaqachon ishlayapti"
  else
    nohup npm run dev >"$LOGS/web.log" 2>&1 &
    echo $! >"$WEB_PID"
    echo "web  → http://localhost:${PORT:-3000}/uz  (pid $!)"
  fi

  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    # Telegram bir vaqtda faqat bitta `getUpdates` ga ruxsat beradi
    # («Conflict: terminated by other getUpdates request»).
    if running "$BOT_PAT"; then
      echo "bot allaqachon ishlayapti"
    else
      nohup npx tsx --conditions=react-server scripts/bot.mts >"$LOGS/bot.log" 2>&1 &
      echo $! >"$BOT_PID"
      echo "bot  → @${NEXT_PUBLIC_TELEGRAM_BOT:-?}  (pid $!)"
    fi
  else
    echo "bot  → o'chiq (TELEGRAM_BOT_TOKEN yo'q)"
  fi
}

stop() {
  for f in "$WEB_PID" "$BOT_PID"; do
    if alive "$f"; then
      pkill -P "$(cat "$f")" 2>/dev/null || true
      kill "$(cat "$f")" 2>/dev/null || true
    fi
    rm -f "$f"
  done
  # Wrapper tugab, bola process qolib ketmasin.
  pkill -f "$WEB_PAT" 2>/dev/null || true
  pkill -f "$BOT_PAT" 2>/dev/null || true

  # Haqiqatan o'chguncha kutamiz — aks holda keyingi `start`
  # o'layotgan processni ko'rib «allaqachon ishlayapti» deb o'tkazib yuboradi.
  for _ in $(seq 1 20); do
    running "$WEB_PAT" || running "$BOT_PAT" || break
    sleep 0.5
  done
  pkill -9 -f "$WEB_PAT" 2>/dev/null || true
  pkill -9 -f "$BOT_PAT" 2>/dev/null || true
  sleep 1
  echo "to'xtatildi"
}

status() {
  running "$WEB_PAT" && echo "✓ web" || echo "✗ web"
  running "$BOT_PAT" && echo "✓ bot" || echo "✗ bot"
  curl -s "http://localhost:${PORT:-3000}/api/health" 2>/dev/null | head -c 300 || echo "health javob bermadi"
  echo
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  restart) stop; sleep 2; start ;;
  status) load_env; status ;;
  logs)   tail -n 40 -f "$LOGS"/*.log ;;
  *) echo "Foydalanish: $0 {start|stop|restart|status|logs}" >&2; exit 1 ;;
esac
