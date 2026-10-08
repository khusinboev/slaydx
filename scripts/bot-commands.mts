/**
 * Bot menyusidagi buyruqlarni (`setMyCommands`, uz + ru/en) va menyu
 * tugmasini («Ilova» → Mini App, `setChatMenuButton`) Telegram'ga yozadi.
 * Prod webhook rejimida — `npm run bot` ishlamaydi, shu skript
 * ishlatiladi (deploydan keyin bir marta): `npm run bot:commands`.
 */
import { botConfigured, BOT_COMMANDS, setBotCommands, setMenuButton } from "../lib/server/telegram.ts";
if (!botConfigured()) {
  console.error("TELEGRAM_BOT_TOKEN yo'q");
  process.exit(1);
}
const list = BOT_COMMANDS.map((c) => `/${c}`).join(", ");
console.log((await setBotCommands()) ? `✅ buyruqlar o'rnatildi (${list}; uz/ru/en)` : "✘ setMyCommands yiqildi");
console.log((await setMenuButton()) ? "✅ menyu tugmasi «Ilova» → /uz" : "✘ setChatMenuButton yiqildi (APP_URL public https emasmi?)");
process.exit(0);
