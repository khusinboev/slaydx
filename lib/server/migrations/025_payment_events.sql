-- To'lov webhook'larining xom izi (AUDIT prod-readiness C30: OBS-09, OBS-14).
--
-- `payment_orders` faqat HOLAT MASHINASI uchun kerakli hosila ustunlarni
-- saqlaydi — Click/Payme aslida NIMA yuborganini emas. Summa/holat bo'yicha
-- nizo yoki provayder hisoboti (sverka) bilan farq chiqsa, solishtiradigan
-- asl hujjat yo'q edi. Endi autentifikatsiyadan o'tgan HAR webhook (takrorlar
-- ham) shu yerga bitta qator bo'lib tushadi: nima keldi va biz nima javob
-- berdik (`response_code`: Payme xato kodi yoki 0 = natija; Click `error`).
--
-- Maxfiy maydonlar (Click `sign_string`, Payme `ChangePassword` paroli va
-- h.k.) yozishdan OLDIN `[REDACTED]` bilan almashtiriladi
-- (`lib/server/payment-events.ts redactPayload`). `Authorization` sarlavhasi
-- umuman saqlanmaydi — faqat so'rov tanasi.
--
-- `order_id` — TEXT va FK siz: noma'lum/yaroqsiz buyurtma raqami bilan kelgan
-- so'rov ham iz qoldirishi kerak, foydalanuvchi o'chirilganda esa audit izi
-- saqlanib qoladi. Saqlash muddati — 1 yil (`purgePaymentEvents`).
--
-- `payment_ledger` (OBS-14): `transactions.reference` to'lovlar uchun
-- `"<provider>:<provider_txn yoki order id>"` shaklida — kredit yozuvini
-- buyurtmaga qo'lda satr ajratmasdan bog'laydigan ko'rinish.
--
-- Qulflar: faqat yangi jadval/indeks/ko'rinish — mavjud jadvallarga tegilmaydi.
--
-- ORQAGA QAYTARISH (rollback):
--   DROP VIEW IF EXISTS payment_ledger;
--   DROP TABLE IF EXISTS payment_events;
--   DELETE FROM schema_migrations WHERE name = '025_payment_events.sql';

CREATE TABLE IF NOT EXISTS payment_events (
  id             BIGSERIAL PRIMARY KEY,
  provider       TEXT NOT NULL CHECK (provider IN ('click', 'payme')),
  -- Payme: JSON-RPC metodi; Click: 'prepare' | 'complete' | action qiymati.
  method         TEXT NOT NULL,
  order_id       TEXT,
  provider_txn   TEXT,
  payload        JSONB NOT NULL,
  response_code  INT,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_events_order_idx ON payment_events (order_id, received_at);
CREATE INDEX IF NOT EXISTS payment_events_txn_idx ON payment_events (provider, provider_txn);
-- `purgePaymentEvents` eski qatorlarni shu bo'yicha topadi.
CREATE INDEX IF NOT EXISTS payment_events_received_idx ON payment_events (received_at);

CREATE OR REPLACE VIEW payment_ledger AS
SELECT t.id          AS transaction_id,
       t.user_id,
       t.kind,
       t.quota_delta,
       t.balance_delta,
       t.reference,
       t.created_at,
       o.id          AS order_id,
       o.provider,
       o.provider_txn,
       o.amount_soum,
       o.state       AS order_state
  FROM transactions t
  LEFT JOIN payment_orders o
    ON t.reference = o.provider || ':' || COALESCE(o.provider_txn, o.id::text)
 WHERE t.kind IN ('topup', 'subscription');
