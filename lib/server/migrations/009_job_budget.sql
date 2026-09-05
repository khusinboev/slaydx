-- Ish byudjeti — har generatsiya uchun alohida.
--
-- Ilgari `reclaimStaleJobs` global `WORKER_JOB_TIMEOUT_MS` bilan
-- solishtirardi: uzoq (lekin sog'lom) 45 betlik kurs ishi o'lik deb
-- belgilanib, navbatga qaytarilishi mumkin edi. Endi har ish o'z
-- byudjeti bo'yicha baholanadi.
--
-- 0 — «byudjet yozilmagan» (eski qatorlar): bunda global qiymat ishlatiladi.
ALTER TABLE generations ADD COLUMN IF NOT EXISTS budget_ms INT NOT NULL DEFAULT 0;
