-- Slayd logotipi (WP-F): foydalanuvchi oldindan yuklaydi, keyin
-- `logoAssetId` orqali istalgan slayd generatsiyasida ishlatiladi.
--
-- `generation_assets` dan farqli — bu yerda egalik generatsiyaga emas,
-- FOYDALANUVCHIGA bog'langan (bir marta yuklab, bir necha deka'da
-- qayta ishlatish uchun). `002_assets.sql` dagi naqsh takrorlanadi:
-- baytlar to'g'ridan-to'g'ri qatorda, muddatsiz (`011_no_expiry.sql`
-- ruhida — bu jadval boshidanoq `expires_at`siz yaratiladi).

CREATE TABLE IF NOT EXISTS logo_uploads (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  bytes      BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);
