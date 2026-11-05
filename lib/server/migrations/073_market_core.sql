-- «Ishlar bozori» core schema (docs/market/PLAN.md §8.1). The market sells sanitised, neutral copies of AI-generated works.
--
-- users.market_opt_out: «Mening ishlarim bozorga chiqmasin»; the candidate scan skips such users.
-- generations.market_item_id: set only on a buyer's copy (purchase). A copy is never a candidate. No FK: an FK on the
--   hot generations table would add a lookup on every insert for a column that is NULL on almost every row.
-- market_items: one sanitised listing. doc_json holds asset placeholders (`market-asset://<id>`), never the author's PII.
--   source_generation_id / source_user_id are admin-only and go NULL when the source is deleted; the item stays.
-- market_item_files: neutral render, served only to the admin. market_assets: images copied from the source.
-- market_previews: watermarked rasters and blurred stubs, the only body bytes that leave the server before a purchase.
-- market_purchases: one per (item, buyer). generation_id = the buyer's copy, NULL after he deleted it (restore re-clones).
-- market_ratings: 1–5 stars per purchase. market_tool_pricing: per-tool share of the original price.
-- market_views: daily view counter (conversion stats). market_reports: «Shikoyat», one per user per item (§9); three
--   reports auto-hide an item pending review.
--
-- Additive only: two new columns with safe defaults, one partial index, new tables. `transactions.kind` is unchanged
-- (a purchase is an ordinary `charge` with the generation id, an author reward an ordinary `bonus`).
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS market_reports;
--   DROP TABLE IF EXISTS market_views;
--   DROP TABLE IF EXISTS market_tool_pricing;
--   DROP TABLE IF EXISTS market_ratings;
--   DROP TABLE IF EXISTS market_purchases;
--   DROP TABLE IF EXISTS market_previews;
--   DROP TABLE IF EXISTS market_assets;
--   DROP TABLE IF EXISTS market_item_files;
--   DROP TABLE IF EXISTS market_items;
--   DROP INDEX IF EXISTS generations_market_item_idx;
--   ALTER TABLE generations DROP COLUMN IF EXISTS market_item_id;
--   ALTER TABLE users DROP COLUMN IF EXISTS market_opt_out;
--   DELETE FROM schema_migrations WHERE name = '073_market_core.sql';
SET LOCAL lock_timeout = '5s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS market_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS market_item_id UUID;
CREATE INDEX IF NOT EXISTS generations_market_item_idx ON generations (market_item_id) WHERE market_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS market_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_generation_id  UUID REFERENCES generations(id) ON DELETE SET NULL,
  source_user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  tool_id               TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'candidate'
                        CHECK (status IN ('candidate','active','sold_out','retired','rejected')),
  title                 TEXT NOT NULL,                 -- ≤ 160
  summary               TEXT NOT NULL DEFAULT '',      -- ≤ 400, admin-editable
  subject               TEXT NOT NULL DEFAULT 'boshqa',
  level                 TEXT NOT NULL DEFAULT 'otm' CHECK (level IN ('maktab','kollej','otm')),
  language              TEXT NOT NULL DEFAULT 'uz',
  pages                 INT,
  slide_count           INT,
  doc_json              JSONB NOT NULL,                -- sanitised AcademicDoc (asset placeholders)
  params_json           JSONB NOT NULL DEFAULT '{}',   -- allow-listed form params (pricing + viewer)
  outline_json          JSONB NOT NULL DEFAULT '[]',   -- section titles only
  pii_flags             JSONB NOT NULL DEFAULT '[]',
  quality_json          JSONB NOT NULL DEFAULT '{}',   -- {score, parts}
  topic_norm            TEXT NOT NULL,
  simhash               BIGINT NOT NULL DEFAULT 0,
  search_text           TEXT NOT NULL DEFAULT '',      -- normalised Latin title+summary+outline
  original_price        BIGINT NOT NULL DEFAULT 0,     -- snapshot at approval
  price_override        BIGINT CHECK (price_override IS NULL OR price_override >= 0),
  price_version         INT NOT NULL DEFAULT 1,
  max_copies            INT CHECK (max_copies IS NULL OR max_copies > 0),
  sold_count            INT NOT NULL DEFAULT 0,
  view_count            BIGINT NOT NULL DEFAULT 0,
  rating_sum            INT NOT NULL DEFAULT 0,
  rating_count          INT NOT NULL DEFAULT 0,
  preview_version       INT NOT NULL DEFAULT 1,
  reject_reason         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at           TIMESTAMPTZ,
  approved_by           BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  retired_at            TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_items_source_idx ON market_items (source_generation_id) WHERE source_generation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS market_items_catalog_idx  ON market_items (approved_at DESC, id DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS market_items_popular_idx  ON market_items (sold_count DESC, id DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS market_items_tool_idx     ON market_items (tool_id, approved_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS market_items_subject_idx  ON market_items (subject, approved_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS market_items_topic_idx    ON market_items (tool_id, topic_norm) WHERE status IN ('candidate','active','sold_out');
CREATE INDEX IF NOT EXISTS market_items_queue_idx    ON market_items (created_at DESC) WHERE status = 'candidate';

CREATE TABLE IF NOT EXISTS market_item_files (
  item_id    UUID PRIMARY KEY REFERENCES market_items(id) ON DELETE CASCADE,
  file_name  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  bytes      BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_assets (
  item_id    UUID NOT NULL REFERENCES market_items(id) ON DELETE CASCADE,
  asset_id   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  bytes      BYTEA NOT NULL,
  PRIMARY KEY (item_id, asset_id)
);

CREATE TABLE IF NOT EXISTS market_previews (
  item_id    UUID NOT NULL REFERENCES market_items(id) ON DELETE CASCADE,
  page       SMALLINT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('page','stub')),
  mime       TEXT NOT NULL,
  size_bytes INT NOT NULL,
  bytes      BYTEA NOT NULL,
  version    INT NOT NULL,
  PRIMARY KEY (item_id, page)
);

CREATE TABLE IF NOT EXISTS market_purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES market_items(id) ON DELETE RESTRICT,
  buyer_user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_id   UUID REFERENCES generations(id) ON DELETE SET NULL,
  price           BIGINT NOT NULL,
  original_price  BIGINT NOT NULL,
  university_norm TEXT NOT NULL DEFAULT '',
  fingerprint     TEXT NOT NULL,
  abuse_flag      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at     TIMESTAMPTZ,
  UNIQUE (item_id, buyer_user_id)
);
CREATE INDEX IF NOT EXISTS market_purchases_buyer_idx ON market_purchases (buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_purchases_item_idx  ON market_purchases (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_purchases_day_idx   ON market_purchases (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS market_ratings (
  purchase_id UUID PRIMARY KEY REFERENCES market_purchases(id) ON DELETE CASCADE,
  stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_tool_pricing (
  tool_id    TEXT PRIMARY KEY,
  percent    INT NOT NULL CHECK (percent BETWEEN 10 AND 100),
  updated_by BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_views (
  item_id UUID NOT NULL REFERENCES market_items(id) ON DELETE CASCADE,
  day     DATE NOT NULL,
  views   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, day)
);

CREATE TABLE IF NOT EXISTS market_reports (
  item_id    UUID NOT NULL REFERENCES market_items(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);
CREATE INDEX IF NOT EXISTS market_reports_recent_idx ON market_reports (created_at DESC);
