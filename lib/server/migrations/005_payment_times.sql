-- To'lov vaqtlarini ajratish va Click uchun raqamli prepare id.
--
-- Ikkita muammo tuzatiladi:
--
-- 1) Payme `CheckTransaction` da `create_time` va `perform_time` alohida
--    qiymatlar bo'lishi kerak. Ilgari ikkalasi ham `perform_time` ustunidan
--    o'qilardi: tranzaksiya bajarilgach «yaratilgan vaqt» ham to'lov
--    vaqtiga o'zgarib ketardi va Payme sverkasi mos kelmasdi.
--
-- 2) Click `merchant_prepare_id` sifatida odatda butun son kutadi.
--    Ilgari UUID qaytarilardi — bu haqiqiy integratsiyada rad etilishi
--    mumkin edi.

ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS create_time BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS prepare_id BIGINT;

CREATE SEQUENCE IF NOT EXISTS payment_prepare_seq START 1000;

-- Mavjud qatorlarda `create_time` ni `perform_time` dan tiklaymiz.
UPDATE payment_orders SET create_time = perform_time WHERE create_time = 0 AND perform_time <> 0;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_prepare_idx
  ON payment_orders(prepare_id) WHERE prepare_id IS NOT NULL;
