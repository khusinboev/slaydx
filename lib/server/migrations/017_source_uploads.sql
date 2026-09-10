-- Tarjima manbasi (Tarjimon 2, WP1): foydalanuvchi DOCX/PPTX/XLSX/PDF/TXT
-- faylini yuklaydi, tarjima esa AYNAN SHU baytlar ustida bajariladi —
-- chiqish formati kirish formatiga teng bo'lishi uchun.
--
-- `template_uploads` naqshi: egalik FOYDALANUVCHIGA (`user_id` bilan PK),
-- bayt qatorning o'zida. Farqi ikkita:
--
--   1. `chars` — narx SHU USTUNDAN hisoblanadi. Klient yuborgan
--      `sourceChars` ga ISHONILMAYDI: aks holda 200 000 belgilik hujjat
--      «1 000 belgi» deb 3 000 tangaga tarjima qilinardi. Yuklashda bir
--      marta o'lchanadi, `/api/generations` esa uni bazadan o'qiydi.
--   2. `text` — yuklash paytida olingan matn (≤200 000). Forma «Olingan
--      matn (ko'rish)» panelida ko'rsatadi va ikkinchi marta ekstraksiya
--      qilishning hojati qolmaydi.
--
-- Muddat: namunadan farqli, manba MUDDATLI — 30 kundan eskisini worker
-- `housekeeping` tozalaydi (`purgeOldSources`). Sabab: bu bir martalik
-- ish fayli, namuna esa qayta-qayta ishlatiladigan sozlama; hujjat
-- baytlarini abadiy saqlash ham keraksiz, ham maxfiylik yuki.
CREATE TABLE IF NOT EXISTS source_uploads (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  bytes      BYTEA NOT NULL,
  chars      INTEGER NOT NULL DEFAULT 0,
  text       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);

-- `purgeOldSources` aynan shu ustun bo'yicha yuradi: indekssiz tozalash
-- butun jadvalni (bayt ustuni bilan birga) skanerlardi.
CREATE INDEX IF NOT EXISTS source_uploads_created_at_idx ON source_uploads (created_at);
