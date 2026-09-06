-- Yetkazilgan miqdor — natija sahifasida ko'rsatish uchun (AUDIT-6 C7).
--
-- Ilgari `file.delivered` (masalan «4 tadan 3 tasi») faqat qisman
-- qaytarish tranzaksiyasining IZOHIDA qolardi — worker jurnalida bor,
-- foydalanuvchiga esa hech qayerda ko'rinmasdi. `ResultView` "Tayyor"
-- deb ko'rsatar, foydalanuvchi nega kam rasm/qator kelganini bilmasdi.
ALTER TABLE generations ADD COLUMN IF NOT EXISTS delivered_json JSONB;
