/**
 * Alohida worker processi.
 *
 * Foydalanish:
 *   WORKER_INLINE=false  — web konteynerda worker o'chadi
 *   npm run worker       — shu faylni alohida konteynerda ishga tushiring
 *
 * Kod web ichidagi inline worker bilan bir xil — farqi faqat joylashuvida.
 */
import { runWorkerProcess } from "../lib/server/worker";

runWorkerProcess().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
