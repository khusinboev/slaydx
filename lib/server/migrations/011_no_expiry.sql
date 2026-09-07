-- 72 soatlik fayl/aktiv muddati va 90 kunlik yozuv o'chirilishi olib
-- tashlandi — foydalanuvchi so'rovi bilan: barcha yaratilgan hujjatlar
-- endi MUDDATSIZ saqlanadi. Ustunlar o'chirilmadi (kelajakda kerak
-- bo'lsa qaytarish oson bo'lsin uchun), lekin ular endi to'ldirilmaydi
-- va HECH QANDAY so'rov ular bo'yicha tozalamaydi.
ALTER TABLE generation_files ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE generation_assets ALTER COLUMN expires_at DROP NOT NULL;

-- Mavjud yozuvlarni ham "muddatsiz"ga o'tkazamiz — aks holda eski
-- muddat vaqti kelganda ular hamon o'chirilgan bo'lardi.
UPDATE generation_files SET expires_at = NULL WHERE expires_at IS NOT NULL;
UPDATE generation_assets SET expires_at = NULL WHERE expires_at IS NOT NULL;
UPDATE generations SET expires_at = NULL WHERE expires_at IS NOT NULL;
