-- KRITIK: OTP identifikatori va Telegram username bitta ustunda edi.
--
-- `upsertLocalUser` foydalanuvchini `username` bo'yicha qidirardi, lekin
-- `username` ga Telegram username ham yozilardi. Natijada OTP orqali
-- «egam_haq» identifikatori bilan kirgan kishi @egam_haq Telegram
-- foydalanuvchisining akkauntiga tushib qolardi — ya'ni akkauntni
-- o'zlashtirish mumkin edi.
--
-- Endi ikki fazo butunlay ajratilgan:
--   telegram_id — Telegram akkaunti
--   local_id    — OTP/telefon akkaunti
-- `username` faqat ko'rsatish uchun qoladi va unikal emas.

ALTER TABLE users ADD COLUMN IF NOT EXISTS local_id TEXT;

-- Telegram bilan bog'lanmagan mavjud qatorlar — bular OTP akkauntlari.
UPDATE users SET local_id = username WHERE telegram_id IS NULL AND local_id IS NULL;

-- Telegram akkauntlarida `username` faqat ko'rsatish uchun.
CREATE UNIQUE INDEX IF NOT EXISTS users_local_id_idx ON users(local_id) WHERE local_id IS NOT NULL;
