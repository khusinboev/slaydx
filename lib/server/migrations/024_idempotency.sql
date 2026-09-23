-- `POST /api/generations` uchun `Idempotency-Key` (AUDIT prod-readiness W3-A,
-- C34: CONC-10, FE-06).
--
-- Pul navbatga qo'yish bilan BITTA tranzaksiyada yechiladi, lekin COMMIT dan
-- keyin javob yo'qolsa (nginx 502/504, tarmoq uzilishi) foydalanuvchi xato
-- ko'radi va qayta bosadi — ilgari bu ikkinchi pullik ish edi. Endi klient
-- har yuborishga UUID kalit beradi (`Idempotency-Key` sarlavhasi); bir
-- foydalanuvchi + bir kalit 24 soat ichida o'sha generatsiyani qaytaradi
-- (`lib/server/jobs.ts` `enqueueGeneration`).
--
-- Orqaga mos: ustun NULL-li va standartsiz — eski kod uni bilmaydi va
-- o'qimaydi; kalitsiz so'rovlar (eski klient, seed skriptlari) NULL yozadi.
-- Indeks QISMAN (`IS NOT NULL`) — kalitsiz tarixiy qatorlar unga kirmaydi.
-- UNIQUE — parallel ikki so'rov poygasining oxirgi to'sig'i (asosiysi —
-- foydalanuvchi qatori qulfi); 24 soatdan eski kalit qayta ishlatilsa
-- `enqueueGeneration` eski qatorning kalitini avval NULL qiladi.
--
-- Qulflar: `ADD COLUMN` (standartsiz) — faqat metama'lumot, qisqa ACCESS
-- EXCLUSIVE; `lock_timeout` uzoq tranzaksiya ortida butun trafikni
-- to'xtatib qo'ymaslik uchun (022 bilan bir xil). Indeks bo'sh ustun
-- ustida — qurilish hozirgi hajmda soniyalar.
--
-- ORQAGA QAYTARISH (rollback):
--   DROP INDEX IF EXISTS generations_user_idem_idx;
--   ALTER TABLE generations DROP COLUMN IF EXISTS idempotency_key;
--   DELETE FROM schema_migrations WHERE name = '024_idempotency.sql';
SET LOCAL lock_timeout = '5s';

ALTER TABLE generations ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS generations_user_idem_idx
  ON generations (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
