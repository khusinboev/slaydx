-- Issiq qidiruvlar uchun yetishmagan indekslar (AUDIT prod-readiness DB-11).
--
-- Har indeks koddagi ANIQ so'rovga xizmat qiladi (izohda ko'rsatilgan) va
-- `tests/db-indexes.test.mts` o'sha so'rov rejasi (EXPLAIN) indeksni
-- ishlatishini tekshiradi. Bugungi hajmda hech biri buzilmaydi — lekin
-- ular foydalanuvchi/trafik soni bilan chiziqli o'sadigan to'liq skanerlar.
--
-- Qulflar: oddiy `CREATE INDEX` (SHARE qulf — qurilish davomida jadvalga
-- yozuv kutadi). Jadvallar hozir kichik (soniyalar); `lock_timeout` uzoq
-- o'quvchi tranzaksiya ortida navbatda turib trafikni to'xtatmaslik uchun
-- (migratsiya yiqiladi va yurituvchi qayta urinadi). Migratsiya tranzaksiya
-- ichida ishlaydi, shuning uchun `CONCURRENTLY` mumkin emas.
--
-- ORQAGA QAYTARISH (rollback):
--   DROP INDEX IF EXISTS login_tickets_token_idx;
--   DROP INDEX IF EXISTS sessions_revoked_idx;
--   DROP INDEX IF EXISTS login_codes_expires_idx;
--   DROP INDEX IF EXISTS game_sessions_expires_idx;
--   DROP INDEX IF EXISTS generations_queued_created_idx;
--   DELETE FROM schema_migrations WHERE name = '023_indexes.sql';
SET LOCAL lock_timeout = '5s';

-- `lib/server/telegram.ts` (havola bilan kirish): `WHERE token_hash = $1 AND
-- consumed_at IS NULL AND expires_at > now() FOR UPDATE`. Chipta yaratish
-- autentifikatsiyasiz — ko'p chipta har haqiqiy kirishni sekinlatardi.
-- UNIQUE emas: eski qatorlarda takror bo'lsa migratsiya yiqilmasin.
CREATE INDEX IF NOT EXISTS login_tickets_token_idx
  ON login_tickets (token_hash)
  WHERE token_hash IS NOT NULL;

-- `lib/server/session.ts purgeExpiredSessions` (har daqiqada): `expires_at <
-- … OR (revoked_at IS NOT NULL AND revoked_at < …)`. `expires_at` indeksi bor,
-- lekin OR ning ikkinchi tomoni indekssiz bo'lgani uchun butun `sessions`
-- skanerlanardi; endi BitmapOr ikkala indeksni birlashtiradi.
CREATE INDEX IF NOT EXISTS sessions_revoked_idx
  ON sessions (revoked_at)
  WHERE revoked_at IS NOT NULL;

-- `lib/server/session.ts purgeExpiredSessions`: `DELETE FROM login_codes
-- WHERE expires_at < now() - interval '1 day'`.
CREATE INDEX IF NOT EXISTS login_codes_expires_idx
  ON login_codes (expires_at);

-- `lib/server/game-sessions.ts purgeExpiredSessions` (worker housekeeping):
-- `WHERE expires_at IS NOT NULL AND expires_at < now()`. (`021_games.sql`
-- izohidagi `game_sessions_user_idx` bu so'rovga yaramaydi.)
CREATE INDEX IF NOT EXISTS game_sessions_expires_idx
  ON game_sessions (expires_at)
  WHERE expires_at IS NOT NULL;

-- `lib/server/jobs.ts claimJob`: `WHERE status = 'QUEUED' AND run_after <=
-- now() … ORDER BY created_at LIMIT 1`. `generations_queue_idx` `run_after`
-- bo'yicha — navbat uzun bo'lsa har olishda BUTUN navbat o'qilib saralanardi;
-- bu indeks bilan eng eski mos qatorda to'xtaydi. Faqat QUEUED qatorlar —
-- kichik.
CREATE INDEX IF NOT EXISTS generations_queued_created_idx
  ON generations (created_at)
  WHERE status = 'QUEUED';
