-- Telegram file_id cache for «Saqlash» / «Ulashish» (docs/mobile/PLAN.md §4.4, R2 §5).
--
-- One row per (generation, download format). The first save uploads the bytes
-- into the user's own bot chat (multipart sendDocument/sendAudio); every later
-- save resends by `file_id` (a tiny JSON call) and every share builds a
-- prepared inline message from it. `file_version` is generations.file_version
-- at upload time: a newer version (the document was edited and re-rendered)
-- means the cached file is stale and is uploaded again, overwriting the row.
--
-- Read only through a join on generations.user_id (ownership in SQL); the
-- file_id never reaches the client. Additive only.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS telegram_files;
--   DELETE FROM schema_migrations WHERE name = '035_telegram_files.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS telegram_files (
  generation_id  UUID NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  -- lib/downloads/formats.ts DownloadFormatId: 'native' | 'pdf' | 'slides-png' | …
  format         TEXT NOT NULL,
  file_version   INT  NOT NULL,
  -- Bot API media the file_id belongs to (a file_id cannot change type).
  media          TEXT NOT NULL CHECK (media IN ('document', 'photo', 'audio')),
  file_id        TEXT NOT NULL,
  file_unique_id TEXT,
  size_bytes     BIGINT,
  -- Last time the file was sent into the owner's bot chat (double-tap debounce).
  saved_at       TIMESTAMPTZ,
  -- Telemetry for the admin panel: sends into the bot chat / prepared shares.
  saves          INT NOT NULL DEFAULT 0,
  shares         INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_id, format)
);
