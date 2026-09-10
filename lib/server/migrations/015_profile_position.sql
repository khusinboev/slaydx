-- Formalar 2: slayd formasidagi muallif ma'lumotlari (lavozim, tashkilot)
-- profilda saqlanadi — bir marta kiritilgach keyingi safar standart bo'lib
-- chiqadi. `organization` `university` dan alohida: o'qituvchi uchun bu
-- maktab/markaz nomi, talaba uchun universitet o'z ustunida qoladi.
ALTER TABLE users ADD COLUMN IF NOT EXISTS position     TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization TEXT NOT NULL DEFAULT '';
