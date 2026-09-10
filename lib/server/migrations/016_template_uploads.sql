-- «O'z shablonim» (Shablonlar 2, Sprint B): foydalanuvchi PPTX namunasini
-- yuklaydi, deka shu namunaning master/layout/temasi ichida yasaladi.
--
-- `logo_uploads` naqshi: egalik FOYDALANUVCHIGA, bayt qatorning o'zida,
-- muddatsiz. `profile` — tahlil natijasi (`TemplateProfile`), `previews` —
-- rol → layout foni PNG (`data:` URL) va `dark` bayrog'i; ikkalasi ham
-- yuklash paytida bir marta hisoblanadi (LibreOffice 20–40 s), keyin har
-- generatsiya ularni bazadan oladi.
CREATE TABLE IF NOT EXISTS template_uploads (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  bytes      BYTEA NOT NULL,
  profile    JSONB NOT NULL,
  previews   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);
