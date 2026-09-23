-- Saqlash muddati (AUDIT prod-readiness C23, `audit/designs/retention.md`).
--
-- Egasi qarori (2026-09-23): FAQAT bonus ball (`points`) bilan to'langan
-- generatsiyaning fayli/aktivlari/hujjat matni 180 kundan keyin
-- o'chiriladi (`lib/server/retention.ts` `purgeBonusFiles`). Haqiqiy pul
-- (`balance`) yoki Pro kvota (`quota`) bilan to'langanlari — muddatsiz
-- (`011_no_expiry.sql` o'z kuchida).
--
-- `generations` qatorining O'ZI o'chirilmaydi: tarix ro'yxati va pul
-- jurnali (`transactions.reference`) butun qoladi. `files_purged_at` —
-- «bu qatorning fayllari ataylab tozalangan» belgisi: ham qayta ishlashni
-- to'xtatadi (idempotentlik), ham UI «Topilmadi» holatining SABABINI
-- ko'rsata oladi.
--
-- Orqaga mos: eski kod bu ustunni bilmaydi va o'qimaydi.
-- Indeks — kichik jadval (faqat metama'lumot, baytlar boshqa jadvalda),
-- oddiy `CREATE INDEX` soniyalarda quriladi; migratsiya tranzaksiya
-- ichida ishlaydi, shuning uchun `CONCURRENTLY` mumkin ham emas.
--
-- ORQAGA QAYTARISH (rollback):
--   DROP INDEX IF EXISTS generations_retention_idx;
--   ALTER TABLE generations DROP COLUMN IF EXISTS files_purged_at;
--   DELETE FROM schema_migrations WHERE name = '022_retention.sql';
ALTER TABLE generations ADD COLUMN IF NOT EXISTS files_purged_at TIMESTAMPTZ;

-- `purgeBonusFiles` aynan shu shart bilan nomzod qidiradi: tozalanmagan
-- tayyor ishlar, `finished_at` bo'yicha eskisidan boshlab.
CREATE INDEX IF NOT EXISTS generations_retention_idx
  ON generations (finished_at)
  WHERE status = 'COMPLETED' AND files_purged_at IS NULL;
