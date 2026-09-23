-- O'YIN NATIJALARI: SAQLASH VA TAKRORIY YUBORISH (prod-readiness C36).
--
-- ORQAGA QAYTARISH (rollback):
--   DROP INDEX IF EXISTS game_results_session_submission_uidx;
--   ALTER TABLE game_results DROP COLUMN IF EXISTS submission_id;
--   DELETE FROM schema_migrations WHERE name = '026_game_results_keep.sql';
--
-- BEA-08 (natijalar havola muddati bilan o'chib ketishi) — bu yerda
-- USTUN KERAK EMAS: sabab `game_results.session_id … ON DELETE CASCADE`
-- EMAS (u to'g'ri — generatsiya o'chsa natijalar ham o'chishi kerak),
-- balki `purgeExpiredSessions` SHARTSIZ `DELETE FROM game_sessions`
-- yozgan edi, FK esa natijalarni ORTIDAN olib ketardi. Tuzatish
-- `lib/server/game-sessions.ts`da: endi natijasi BOR sessiya
-- o'chirilmaydi (`NOT EXISTS (SELECT 1 FROM game_results …)`), token
-- shunchaki `expires_at` orqali ishlamay qoladi. Schema o'zgarishsiz.
--
-- UX-06/ABUSE-04 (takroriy yuborish, sessiya cheklamasi) — BU ustun
-- kerak: klient bitta urinish uchun BIR MARTA `crypto.randomUUID()`
-- generatsiya qiladi va uni har `submit` so'rovida yuboradi. Tarmoq
-- uzilib javob kelmasa, «Qayta yuborish» AYNI id bilan qayta so'raydi —
-- `(session_id, submission_id)` UNIQUE tufayli ikkinchi qator
-- YOZILMAYDI (`game-sessions.ts addResult` `ON CONFLICT DO NOTHING`
-- bilan avvalgi qatorni qaytaradi).
--
-- NULL ga ruxsat beriladi (ustun majburiy emas): eski (migratsiyadan
-- oldingi) qatorlar va `submissionId` yubormagan chaqiruvchilar
-- (`jsonb-writes.test.mts`) UNIQUE shartga umuman kirmaydi — Postgres
-- NULL larni bir-biriga TENG deb hisoblamaydi, ya'ni ular hech qachon
-- to'qnashmaydi.
SET LOCAL lock_timeout = '5s';

ALTER TABLE game_results ADD COLUMN IF NOT EXISTS submission_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS game_results_session_submission_uidx
  ON game_results (session_id, submission_id);
