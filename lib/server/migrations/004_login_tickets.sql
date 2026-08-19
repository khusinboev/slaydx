-- Telegram orqali kirish uchun «chipta».
--
-- Oqim:
--   1. Sayt chipta yaratadi (nonce) va `t.me/BOT?start=<nonce>` havolasini beradi
--   2. Foydalanuvchi Telegram da Start bosadi → bot uni taniydi
--   3. Bot 5 xonali kod yaratib, aynan o'sha chatga yuboradi
--   4. Foydalanuvchi kodni saytga kiritadi → sessiya ochiladi
--
-- Nega kod kerak: kodsiz, faqat nonce bilan avtomatik kirish bo'lsa,
-- tajovuzkor o'z nonce'ini qurbonga yuborib, qurbon nomidan o'z brauzerida
-- sessiya ocha olardi. Kod faqat qurbonning Telegramiga boradi.

CREATE TABLE IF NOT EXISTS login_tickets (
  nonce        TEXT PRIMARY KEY,
  code_hash    TEXT,
  telegram_id  BIGINT,
  username     TEXT,
  name         TEXT,
  photo_url    TEXT,
  attempts     INT NOT NULL DEFAULT 0,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS login_tickets_expires_idx ON login_tickets(expires_at);

-- Telegram `update_id` — takroriy yetkazishni tashlab yuborish uchun.
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id  BIGINT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_updates_created_idx ON telegram_updates(created_at);
