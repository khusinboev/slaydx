-- Maqola 2 (AUDIT-17): tannarx telemetriyasi, umumiy forma qoralamasi,
-- manba keshi.
--
-- 1. `generations.cost_json` — har ishning LLM sarfi
--    `{provider, model, inputTokens, outputTokens, calls, usd}`. Narx
--    tannarxdan past bo'lmasligi mahsulot egasi talabi: `scripts/cost-report.mts`
--    vosita bo'yicha o'rtacha tannarx vs narx (marja) ni shu ustundan hisoblaydi.
--    Kredit/`price` bilan aralashmaydi — u faqat kuzatuv uchun.
ALTER TABLE generations ADD COLUMN IF NOT EXISTS cost_json JSONB;

-- 2. `form_drafts` — `resume_drafts` ning UMUMLASHGAN shakli: (user, tool)
--    bo'yicha bitta qator. Maqola formasi rezyume kabi uzun (mualliflar,
--    manbalar, natijalar matni) — qoralama shart. Rezyume qoralamalari
--    ko'chiriladi; `resume_drafts` jadvali rollback xavfsizligi uchun
--    021 gacha qoladi (yangi kod faqat `form_drafts` ni o'qiydi/yozadi).
CREATE TABLE IF NOT EXISTS form_drafts (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id    TEXT   NOT NULL,
  data       JSONB  NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tool_id)
);
INSERT INTO form_drafts (user_id, tool_id, data, updated_at)
  SELECT user_id, 'resume', data, updated_at FROM resume_drafts
  ON CONFLICT (user_id, tool_id) DO NOTHING;

-- 3. `source_cache` — OpenAlex/Crossref javoblari keshi (kalit:
--    `openalex:<id>` | `crossref:<doi>` | `q:<sha256(so'rov)>`), 30 kun.
--    Sabab: bir mavzuga qayta-qayta murojaat (qayta yaratish, tuzatish)
--    tashqi API kvotasini yemasin; OpenAlex 2026-02 dan kunlik $1 bepul
--    limit bilan ishlaydi.
CREATE TABLE IF NOT EXISTS source_cache (
  key        TEXT PRIMARY KEY,
  payload    JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS source_cache_fetched_idx ON source_cache (fetched_at);
