-- Rezyume 2 (AUDIT-15): forma qoralamasi va surat yuklashlari.
--
-- 1. `resume_drafts` — foydalanuvchiga BITTA qator. Rezyume formasi eng
--    uzun forma (ism, aloqa, ish joylari, ta'lim, ko'nikmalar): sahifa
--    yopilib qayta ochilganda hammasini qaytadan yozish — foydalanuvchi
--    talabidagi 1-band. Qiymatlar `sanitizeValues` dan o'tgan `FormValues`
--    (JSON maydonlar bilan), ya'ni generatsiya so'rovi bilan bir xil
--    shakl — qayta tiklashda hech qanday o'girish kerak emas.
--    Foydalanuvchi «Tozalash» tugmasi bilan o'zi o'chira oladi (PII).
--
-- 2. `photo_uploads` — `logo_uploads` naqshi (bayt qatorda, egalik PK da),
--    lekin ikki farq bilan:
--      * `kind` — 'crop' (rezyumega tushadigan, kesilgan 600×600) yoki
--        'original' (asl fayl). Asl nusxa «Rasmni markazlash» uchun
--        saqlanadi: qayta kesish uchun asl piksel kerak, kesilganidan
--        qayta kesish sifatni yo'qotadi.
--      * `crop` — {x, y, zoom}: kesish dialogi qayta ochilganda ramka
--        aynan o'sha joyda turadi.
--    Doira shaklidagi shablonlar uchun bayt SHAFFOF PNG bo'lib keladi
--    (klient niqoblaydi) — `docx` `ImageRun` doira kesa olmaydi.
CREATE TABLE IF NOT EXISTS resume_drafts (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photo_uploads (
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id          TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'crop',
  mime              TEXT NOT NULL,
  size_bytes        BIGINT NOT NULL,
  bytes             BYTEA NOT NULL,
  original_asset_id TEXT,
  crop              JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);

-- `purgeOldPhotos` shu ustun bo'yicha yuradi (manba fayllar naqshi):
-- indekssiz tozalash bayt ustuni bilan butun jadvalni skanerlardi.
CREATE INDEX IF NOT EXISTS photo_uploads_created_at_idx ON photo_uploads (created_at);
