-- Jonli generatsiya + ko'ruvchida tahrirlash — poydevor ustunlari.
--
-- `live_json`/`live_seq` — worker generatsiya JARAYONIDA (IN_PROGRESS)
-- yozadigan vaqtinchalik "jonli deka"; `getGeneration` uni faqat
-- IN_PROGRESS paytida, `?since=` liveSeq'dan katta bo'lsagina qaytaradi
-- (`jobs.ts`). Yakuniy holatda hech qachon `ROW_COLUMNS` ro'yxatiga
-- kiritilmaydi — ro'yxat so'rovlari (`GET /api/generations`) yengil
-- qoladi.
--
-- `doc_version`/`file_version` — tahrir uchun optimistik qulf: har
-- `PATCH …/doc` `doc_version`ni oshiradi, PPTX qayta yasalganda
-- `file_version` unga yetadi (`markFileVersion`). `image_redraws` —
-- dekaga 5 tagacha bepul qayta chizish limiti (`reserveRedraw`).
ALTER TABLE generations
  ADD COLUMN IF NOT EXISTS live_json JSONB,
  ADD COLUMN IF NOT EXISTS live_seq INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doc_version INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS file_version INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_redraws INT NOT NULL DEFAULT 0 CHECK (image_redraws >= 0),
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
