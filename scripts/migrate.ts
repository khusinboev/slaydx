/**
 * Migratsiyalarni qo'lda qo'llash: `npm run db:migrate`.
 *
 * Server ham ishga tushishda avtomatik migratsiya qiladi, lekin deploy
 * quvurida (masalan konteyner ko'tarilishidan oldin) alohida qadam
 * bo'lgani xavfsizroq.
 */
import { migrate, pool } from "../lib/server/db";

migrate()
  .then(async () => {
    console.log("[db] migratsiyalar tayyor");
    await pool().end();
  })
  .catch(async (e) => {
    console.error("[db] xato:", e instanceof Error ? e.message : e);
    await pool().end().catch(() => {});
    process.exit(1);
  });
