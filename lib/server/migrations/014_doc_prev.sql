-- "Asl holatga qaytarish" — birinchi tahrirdan OLDINGI `doc_json` nusxasi.
--
-- `commitDocOps` (`slide-commit.ts`) BIRINCHI tahrirda (`doc_version = 0`
-- bo'lganda) `doc_prev = doc_json`ni yozadi — `COALESCE(doc_prev, doc_json)`
-- bilan, ya'ni keyingi tahrirlar bu ustunni HECH QACHON ustidan yozmaydi
-- (bir marta yozilgach o'zgarmasdan qoladi). `POST …/doc/restore`
-- `doc_json = doc_prev` qilib qaytaradi.
--
-- `doc_prev` `ROW_COLUMNS` ro'yxatiga (jobs.ts) KIRMAYDI — faqat
-- `doc_prev IS NOT NULL AS has_prev` hisoblangan ustun sifatida.
ALTER TABLE generations
  ADD COLUMN IF NOT EXISTS doc_prev JSONB;
