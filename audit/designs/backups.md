# Design — backups (C24)

**Owner decision (2026-09-23):** a daily `pg_dump` compressed with gzip, plus an off-box copy to a destination set through env. The script and the cron line live in the repo; the owner installs them on the server.

## Problem
- Today's backups are manual, taken before deploys only, kept on the same disk, and a restore has never been tested (INFRA-05).
- A plain-format dump stores `bytea` as hex (2×).

## Design
1. **`scripts/backup.sh`** (bash, idempotent, `set -euo pipefail`):
   - It takes the dump with `docker exec slaydx-postgres-1 pg_dump -U slaydx -Fc slaydx`. The custom format is compressed, restores in parallel, and stores `bytea` compactly.
   - Output goes to `${BACKUP_DIR:-/root/slaydx-backups}/slaydx-YYYYmmdd-HHMMSS.dump`. The file is created with `umask 077` and written to a `.tmp` first, then moved into place.
   - A dump is invalid when `pg_restore --list` fails on it or its size is under 1 MB. An invalid dump is deleted and the script exits non-zero.
   - Local copies are rotated, keeping `BACKUP_KEEP_DAYS` (default 7).
   - **Off-box:** if `BACKUP_REMOTE` is set (an rclone remote such as `b2:slaydx-backups`, or an rsync target `user@host:/path`), the dump is copied there and verified by size. Without it, the script prints a loud warning that no off-box copy was made.
   - It writes one JSON line to `${BACKUP_DIR}/backup.log`: timestamp, size, duration, status. That gives the health check or the owner something to read.
   - With `BACKUP_TG_CHAT` set, it can optionally send a Telegram message on failure through the bot token.
2. **`scripts/restore-check.sh`:** it restores the newest dump into a throwaway `postgres:16-alpine` container on a random port, then runs `SELECT count(*)` on the users, generations and transactions tables and checks the ledger invariant (`balance == sum(transactions)` per user). The owner runs it weekly, or as a second cron line.
3. **Cron** (documented, installed by the owner):
   - `30 3 * * * /opt/slaydx/scripts/backup.sh >> /var/log/slaydx-backup.log 2>&1`
   - `0 5 * * 0 /opt/slaydx/scripts/restore-check.sh >> /var/log/slaydx-backup.log 2>&1`
4. **Commands only:** the scripts never use `docker compose down` or prune, and only address the `slaydx-*` container names, because the box is shared with other projects.

## Tests
- `tests/backup-script.test.mts`: `bash -n` syntax checks. A dry run against the throwaway Postgres (container name through env) produces a dump that `pg_restore --list` accepts, rotation keeps N files, and an invalid dump returns non-zero.
- It runs through `heavy2.sh`.
