-- Slayd/rasm mediasi uchun alohida jadval.
--
-- Ilgari rasm base64 `data:` URL sifatida hujjat ichida yurardi: bir xil
-- bayt PPTX ichida, `doc_json` da va `html` da — uch nusxa. Endi bayt bir
-- marta shu yerda saqlanadi, hujjatda esa `/api/.../assets/{id}` havolasi
-- turadi (brauzer keshlaydi, JSONB kichik qoladi).

CREATE TABLE IF NOT EXISTS generation_assets (
  generation_id UUID NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  asset_id      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  bytes         BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (generation_id, asset_id)
);
CREATE INDEX IF NOT EXISTS generation_assets_expires_idx ON generation_assets(expires_at);
