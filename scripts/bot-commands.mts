/**
 * Bot menyusidagi buyruqlarni Telegram'ga yozadi (`setMyCommands`).
 * Prod webhook rejimida — `npm run bot` ishlamaydi, shu skript
 * ishlatiladi (deploydan keyin bir marta): `npm run bot:commands`.
 */
import { botConfigured, setBotCommands } from "../lib/server/telegram.ts";
if (!botConfigured()) {
  console.error("TELEGRAM_BOT_TOKEN yo'q");
  process.exit(1);
}
console.log((await setBotCommands()) ? "✅ buyruqlar o'rnatildi (/start, /login, /admin)" : "✘ setMyCommands yiqildi");
process.exit(0);
