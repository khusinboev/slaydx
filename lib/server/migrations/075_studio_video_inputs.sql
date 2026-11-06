-- Studio P11 §D (docs/studio/P11-SPEC.md): «Dublyaj» and «Transkripsiya» accept the user's OWN video upload, through the
-- same upload path and table as the P6 audio inputs (`studio_audio_inputs`): the row's `mime` may now be 'video/mp4'
-- (type sniffed from the bytes, length read from `moov/mvhd`, 1 s – 3 min, ≤ 25 MB). The P6 modes (voice changer,
-- isolator) still read audio rows only (`lib/server/media/audio-inputs.ts ownAudioInput`) and still refuse audio under 3 s
-- in the app; ownership stays `user_id` in every SQL.
--
-- Additive only: the CHECK on `mime` widens by one value, the CHECK on `billed_seconds` lowers its floor to 1 (a one-second
-- clip); no column, row or index changes. The constraints keep the names Postgres gave them at creation (069), so a
-- rollback restores the exact old shape.
--
-- ROLLBACK:
--   DELETE FROM studio_audio_inputs WHERE mime = 'video/mp4' OR billed_seconds < 3;
--   ALTER TABLE studio_audio_inputs DROP CONSTRAINT IF EXISTS studio_audio_inputs_mime_check;
--   ALTER TABLE studio_audio_inputs ADD CONSTRAINT studio_audio_inputs_mime_check CHECK (mime IN ('audio/wav', 'audio/mpeg'));
--   ALTER TABLE studio_audio_inputs DROP CONSTRAINT IF EXISTS studio_audio_inputs_billed_seconds_check;
--   ALTER TABLE studio_audio_inputs ADD CONSTRAINT studio_audio_inputs_billed_seconds_check CHECK (billed_seconds BETWEEN 3 AND 300);
--   DELETE FROM schema_migrations WHERE name = '075_studio_video_inputs.sql';
SET LOCAL lock_timeout = '5s';

ALTER TABLE studio_audio_inputs DROP CONSTRAINT IF EXISTS studio_audio_inputs_mime_check;
ALTER TABLE studio_audio_inputs ADD CONSTRAINT studio_audio_inputs_mime_check CHECK (mime IN ('audio/wav', 'audio/mpeg', 'video/mp4'));
ALTER TABLE studio_audio_inputs DROP CONSTRAINT IF EXISTS studio_audio_inputs_billed_seconds_check;
ALTER TABLE studio_audio_inputs ADD CONSTRAINT studio_audio_inputs_billed_seconds_check CHECK (billed_seconds BETWEEN 1 AND 300);
