/**
 * Telegram bot — long-polling rejimi (lokal ishlab chiqish uchun).
 *
 * Prod da webhook ishlatiladi (`/api/telegram/webhook`), lekin lokalda
 * ochiq HTTPS manzil bo'lmaydi. Ikkala yo'l ham bir xil `handleUpdate`
 * ni chaqiradi, shuning uchun xatti-harakat bir xil.
 *
 * Ishga tushirish: npm run bot
 */
import { env } from "../lib/server/env.ts";
import { ensureMigrated, pool } from "../lib/server/db.ts";
import { botConfigured, getMe, handleUpdate, purgeExpiredTickets } from "../lib/server/telegram.ts";
import type { TelegramUpdate } from "../lib/server/telegram.ts";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

if (!botConfigured()) {
  console.error("TELEGRAM_BOT_TOKEN yo'q — .env.local ni tekshiring");
  process.exit(1);
}

await ensureMigrated();

/**
 * Tarmoq vaqtincha uzilgan bo'lishi mumkin, shuning uchun birinchi
 * urinishdayoq taslim bo'lmaymiz — aks holda internet bir soniyaga
 * uzilsa bot butunlay o'chib qolardi.
 */
let me: Awaited<ReturnType<typeof getMe>> = null;
for (let attempt = 1; attempt <= 5; attempt++) {
  me = await getMe();
  if (me) break;
  console.warn(`[bot] getMe ishlamadi (${attempt}/5) — qayta urinilmoqda...`);
  await sleep(attempt * 2000);
}
if (!me) {
  console.error("Bot tokeni tekshirilmadi. TELEGRAM_BOT_TOKEN va tarmoqni tekshiring.");
  process.exit(1);
}
console.log(`[bot] @${me.username} ishga tushdi (long-polling)`);

// Webhook o'rnatilgan bo'lsa getUpdates ishlamaydi — avval o'chiramiz.
await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/deleteWebhook`, {
  method: "POST",
}).catch(() => {});

let offset = 0;
let stopped = false;
let sincePurge = 0;

const shutdown = () => {
  console.log("[bot] to'xtatilmoqda...");
  stopped = true;
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

while (!stopped) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/getUpdates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset, timeout: 25, allowed_updates: ["message"] }),
      // Long-poll 25 s, shuning uchun timeout undan kattaroq.
      signal: AbortSignal.timeout(40_000),
    });
    const data = (await res.json()) as { ok: boolean; result?: TelegramUpdate[]; description?: string };
    if (!data.ok) {
      console.warn("[bot] getUpdates:", data.description);
      await sleep(3000);
      continue;
    }
    for (const update of data.result ?? []) {
      offset = Math.max(offset, update.update_id + 1);
      try {
        await handleUpdate(update);
        console.log(`[bot] update ${update.update_id} qayta ishlandi`);
      } catch (e) {
        console.error("[bot] update xatosi:", e instanceof Error ? e.message : e);
      }
    }
    sincePurge += 1;
    if (sincePurge >= 20) {
      sincePurge = 0;
      await purgeExpiredTickets().catch(() => {});
    }
  } catch (e) {
    // Timeout — long-poll da normal holat, jim o'tamiz.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/timeout|abort/i.test(msg)) {
      // Tarmoq uzilishi — bot to'xtamaydi, 3 soniyadan keyin qayta uriniladi.
      console.warn(`[bot] tarmoq uzildi (${msg}) — qayta urinilmoqda...`);
      await sleep(3000);
    }
  }
}

await pool().end();

