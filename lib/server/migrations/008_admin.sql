-- Admin panel — telefon raqami orqali aniqlanadigan boshqaruvchilar.
--
-- Admin ro'yxati BAZADA emas, kodda hardcode (`lib/server/admin.ts`):
-- so'ralgan talab shu. Bu yerga faqat identifikatsiya uchun kerak bo'lgan
-- narsa qo'shiladi.
--
-- Telegram orqali kirish (ticket oqimi) telefon raqamini olib kelmaydi —
-- Telegram buni standart login oqimida bermaydi. Shuning uchun admin
-- o'z raqamini botga bir marta ULASHADI (contact tugmasi orqali) va
-- bot uni shu ustunga yozadi. Oddiy foydalanuvchida bu ustun bo'sh qoladi.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_key ON users(phone) WHERE phone IS NOT NULL;

-- Admin qo'lda balans o'zgartirsa alohida `kind` bilan yoziladi.
--
-- Nega mavjud 'topup'/'charge' ishlatilmadi: ular haqiqiy to'lov va
-- generatsiya xarajatlari bilan bir xatorda turadi. Admin tuzatishini
-- ular bilan aralashtirish moliyaviy hisobotni buzardi — "necha pul
-- to'landi" degan savolga admin bergan bonus ham qo'shilib ketardi.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'transactions'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT %I', c);
  END IF;
END $$;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check
  CHECK (kind IN ('charge', 'refund', 'topup', 'bonus', 'subscription', 'admin_credit', 'admin_debit'));
