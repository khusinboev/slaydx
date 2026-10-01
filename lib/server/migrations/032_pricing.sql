-- Admin price adjustments per tool (docs/admin/02-plan.md §17.2, §17.7).
--
-- The code formula `priceFor(tool, values)` stays the base price; a row here
-- scales it by `percent` and rounds to `round_to` (`applyPriceAdjust` in
-- lib/tools.ts). No row = 100 % = exactly today's price, so an empty table
-- changes nothing. `tool_price_history` keeps every change with its reason.
--
-- Backward compatible: new tables only; old code never reads them.
--
-- ROLLBACK (run the 033 rollback first):
--   DROP TABLE IF EXISTS tool_price_history;
--   DROP TABLE IF EXISTS tool_pricing;
--   DELETE FROM schema_migrations WHERE name = '032_pricing.sql';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS tool_pricing (
  tool_id     TEXT PRIMARY KEY,
  percent     INT  NOT NULL CHECK (percent BETWEEN 25 AND 1000),
  round_to    INT  NOT NULL DEFAULT 500 CHECK (round_to IN (100, 500, 1000)),
  updated_by  BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tool_price_history (
  id            BIGSERIAL PRIMARY KEY,
  tool_id       TEXT NOT NULL,
  old_percent   INT  NOT NULL, new_percent  INT NOT NULL,
  old_round_to  INT  NOT NULL, new_round_to INT NOT NULL,
  reason        TEXT NOT NULL,
  admin_id      BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_price_history_tool_idx ON tool_price_history(tool_id, at DESC);
