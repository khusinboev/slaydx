-- Navbat indekslari: heartbeat HOT bo'lsin, ortiqcha indeks ketsin
-- (AUDIT prod-readiness DB-12, SCALE-13, W4-B).
--
-- 1) `generations_stale_idx ON generations(locked_at) WHERE status='IN_PROGRESS'`
--    O'RNIGA `generations_running_user_idx ON generations(user_id) WHERE
--    status='IN_PROGRESS'`. `locked_at` indekslangan ekan, HAR heartbeat
--    (`locked_at = now()`) HOT bo'lolmasdi: keng qatorning yangi nusxasi +
--    PK, user va stale indekslariga yangi yozuv. Yangi indeks ish davomida
--    O'ZGARMAYDIGAN ustunda — heartbeat, progress va jonli deka yozuvlari
--    HOT update bo'ladi (`tests/queue-indexes.test.mts` o'lchaydi). U
--    IN_PROGRESS sanoqlariga ham to'g'ridan-to'g'ri mos: qabul sanog'i va
--    `claimJob` adolat sanog'i `status = 'IN_PROGRESS' AND user_id = $1`.
--    `reclaimStaleJobs` (`locked_at < …`) va /api/health shu kichik qisman
--    indeks bo'ylab o'qib, `locked_at` ni qatordan filtrlaydi (IN_PROGRESS
--    qatorlar soni ≤ slotlar soni).
-- 2) `generations_queue_idx ON generations(run_after) WHERE status='QUEUED'`
--    ORTIQCHA: `claimJob`, qabul sanog'i, navbat o'rni va `expireQueuedJobs`
--    hammasi `generations_queued_created_idx` (023, `created_at`) dan
--    foydalanadi (commit c38a1fd dan beri rejalashtiruvchi 023 ni tanlaydi);
--    `run_after` bo'yicha oraliq qidiruvi yo'q. Har QUEUED yozuv/o'zgarishda
--    behuda saqlanardi.
-- 3) `fillfactor = 90`: yangi sahifalarda HOT nusxa uchun joy qoladi
--    (faqat metama'lumot, mavjud sahifalar qayta yozilmaydi).
--
-- Qulflar: `CREATE INDEX` (SHARE) va `DROP INDEX` (ACCESS EXCLUSIVE, qisqa);
-- `lock_timeout` uzoq tranzaksiya ortida trafikni to'xtatmasin (023 naqshi).
-- Migratsiya tranzaksiyada — `CONCURRENTLY` mumkin emas; IN_PROGRESS qatorlar
-- oz, qurilish millisekundlar.
--
-- ORQAGA QAYTARISH (rollback):
--   CREATE INDEX IF NOT EXISTS generations_queue_idx ON generations(run_after) WHERE status = 'QUEUED';
--   CREATE INDEX IF NOT EXISTS generations_stale_idx ON generations(locked_at) WHERE status = 'IN_PROGRESS';
--   DROP INDEX IF EXISTS generations_running_user_idx;
--   ALTER TABLE generations RESET (fillfactor);
--   DELETE FROM schema_migrations WHERE name = '027_queue_indexes.sql';
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS generations_running_user_idx
  ON generations (user_id)
  WHERE status = 'IN_PROGRESS';

DROP INDEX IF EXISTS generations_stale_idx;

DROP INDEX IF EXISTS generations_queue_idx;

ALTER TABLE generations SET (fillfactor = 90);
