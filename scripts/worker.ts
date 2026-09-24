/**
 * Alohida worker processi.
 *
 * Foydalanish:
 *   WORKER_INLINE=false  — web konteynerda worker o'chadi
 *   npm run worker       — shu faylni alohida konteynerda ishga tushiring
 *
 * Kod web ichidagi inline worker bilan bir xil — farqi faqat joylashuvida.
 */
import { installProcessGuards, runWorkerProcess } from "../lib/server/worker";

// Ushlanmagan rad etish processni yiqitmasin (jurnal + davom); haqiqiy
// uncaughtException — nol bo'lmagan kod bilan chiqish, Docker qayta ko'taradi (C27).
installProcessGuards();

runWorkerProcess().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
