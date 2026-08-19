-- Boshlang'ich sxema: foydalanuvchi, sessiya, kredit hisobi, generatsiya navbati,
-- fayl ombori va to'lov buyurtmalari.

CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  telegram_id     BIGINT UNIQUE,
  username        TEXT,
  name            TEXT NOT NULL DEFAULT '',
  photo_url       TEXT,
  language        TEXT NOT NULL DEFAULT 'uz',

  -- Uch qatlamli hamyon (REJA.md, 3-bosqich). Hech qachon manfiy bo'lmaydi.
  points          BIGINT NOT NULL DEFAULT 0 CHECK (points  >= 0),
  quota           BIGINT NOT NULL DEFAULT 0 CHECK (quota   >= 0),
  balance         BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),

  plan            TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  plan_expires_at TIMESTAMPTZ,

  -- Forma standart qiymatlari shu profildan olinadi.
  university      TEXT NOT NULL DEFAULT '',
  faculty         TEXT NOT NULL DEFAULT '',
  department      TEXT NOT NULL DEFAULT '',
  "group"         TEXT NOT NULL DEFAULT '',
  course          TEXT NOT NULL DEFAULT '',
  author          TEXT NOT NULL DEFAULT '',
  subject         TEXT NOT NULL DEFAULT '',
  teacher         TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT 'Toshkent',

  is_blocked      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessiya tokeni bazada faqat SHA-256 hash ko'rinishida turadi: baza
-- o'g'irlansa ham tayyor cookie chiqmaydi.
CREATE TABLE IF NOT EXISTS sessions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  user_agent   TEXT,
  ip_hash      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

-- Bir martalik kirish kodi. Kod ham hash holida.
CREATE TABLE IF NOT EXISTS login_codes (
  id          BIGSERIAL PRIMARY KEY,
  identifier  TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_codes_ident_idx ON login_codes(identifier, created_at DESC);

-- Generatsiya = ish navbatidagi bitta vazifa.
CREATE TABLE IF NOT EXISTS generations (
  id            UUID PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id       TEXT NOT NULL,
  topic         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'QUEUED'
                CHECK (status IN ('QUEUED','IN_PROGRESS','COMPLETED','FAILED','REVOKED')),
  price         BIGINT NOT NULL DEFAULT 0,
  format        TEXT NOT NULL DEFAULT 'docx',
  progress      INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  step          TEXT NOT NULL DEFAULT '',
  values_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  doc_json      JSONB,
  html          TEXT,
  file_name     TEXT NOT NULL DEFAULT '',
  error         TEXT,

  -- Navbat boshqaruvi: qaysi worker oldi, necha marta urindik.
  attempts      INT NOT NULL DEFAULT 0,
  locked_by     TEXT,
  locked_at     TIMESTAMPTZ,
  run_after     TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS generations_user_idx ON generations(user_id, created_at DESC);
-- Navbatdan ish tanlash uchun — faqat kutayotgan qatorlar indeksda.
CREATE INDEX IF NOT EXISTS generations_queue_idx
  ON generations(run_after) WHERE status = 'QUEUED';
CREATE INDEX IF NOT EXISTS generations_stale_idx
  ON generations(locked_at) WHERE status = 'IN_PROGRESS';

-- Yaratilgan bayt (DOCX/PPTX/PNG). Diskda emas bazada saqlanadi —
-- bir nechta instansiya bo'lganda ham fayl har joydan ochiladi.
CREATE TABLE IF NOT EXISTS generation_files (
  generation_id UUID PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  bytes         BYTEA NOT NULL,
  downloads     INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS generation_files_expires_idx ON generation_files(expires_at);

-- Har bir pul harakati. Balans shu jurnaldan qayta hisoblanishi mumkin.
CREATE TABLE IF NOT EXISTS transactions (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('charge','refund','topup','bonus','subscription')),
  -- Qaysi hamyondan qancha olingani — qaytarishda aynan shu tiklanadi.
  points_delta   BIGINT NOT NULL DEFAULT 0,
  quota_delta    BIGINT NOT NULL DEFAULT 0,
  balance_delta  BIGINT NOT NULL DEFAULT 0,
  reference      TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_user_idx ON transactions(user_id, created_at DESC);
-- Idempotentlik kaliti: bitta generatsiya ikki marta yechilmaydi,
-- bitta webhook ikki marta pul qo'shmaydi.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_ref_idx
  ON transactions(kind, reference) WHERE reference IS NOT NULL;

-- To'lov buyurtmasi (Click / Payme).
CREATE TABLE IF NOT EXISTS payment_orders (
  id             UUID PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL CHECK (provider IN ('click','payme')),
  purpose        TEXT NOT NULL CHECK (purpose IN ('topup','pro')),
  -- Tiyin (Payme) emas, so'm. Providerga uzatishda 100 ga ko'paytiriladi.
  amount_soum    BIGINT NOT NULL CHECK (amount_soum > 0),
  state          TEXT NOT NULL DEFAULT 'created'
                 CHECK (state IN ('created','pending','paid','cancelled')),
  provider_txn   TEXT,
  perform_time   BIGINT NOT NULL DEFAULT 0,
  cancel_time    BIGINT NOT NULL DEFAULT 0,
  cancel_reason  INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_orders_user_idx ON payment_orders(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_txn_idx
  ON payment_orders(provider, provider_txn) WHERE provider_txn IS NOT NULL;

-- Oynali (fixed window) rate limit hisoblagichi.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket      TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits(window_start);
