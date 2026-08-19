-- Ro'yxatdagi kichik ko'rinish (thumbnail) uchun tayyor ma'lumot.
--
-- Ro'yxat endpointi butun `doc_json` ni qaytarmaydi (u megabaytlarcha
-- bo'lishi mumkin), lekin kartochkada rasm yoki matndan namuna kerak.
-- Shuning uchun worker tugatganda kichik `preview` ni oldindan hisoblaydi.
--
-- Shakli: { "url": "/api/.../assets/xxx", "lines": ["...", "..."] }

ALTER TABLE generations ADD COLUMN IF NOT EXISTS preview JSONB;
