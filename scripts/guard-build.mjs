/**
 * `next build` ni dev server ishlab turganda bajarishdan saqlaydi.
 *
 * Ikkalasi ham BITTA `.next` jildidan foydalanadi. Prod build uni qayta
 * yozadi, ishlab turgan dev server esa o'z fayllarini yo'qotadi va
 * shundan keyin HAR SO'ROVGA 500 qaytaradi:
 *
 *   ENOENT: no such file or directory,
 *   open '.next/static/development/_buildManifest.js.tmp.xxxx'
 *
 * Xato build vaqtida emas, KEYINROQ va boshqa joyda ko'rinadi — brauzerda
 * «internal server error» sifatida. Sababi bilan bog'lash qiyin, shuning
 * uchun tekshiruv shu yerda turadi.
 *
 * Yagona yechim — dev serverni to'xtatish va `.next` ni o'chirish.
 * Ataylab qilinayotgan bo'lsa: `ALLOW_DEV_BUILD=1 npm run build`.
 */
import { connect } from "node:net";

const PORT = Number(process.env.PORT || 3000);

if (process.env.ALLOW_DEV_BUILD === "1" || process.env.CI) process.exit(0);

const socket = connect({ port: PORT, host: "127.0.0.1" });
const done = (busy) => {
  socket.destroy();
  if (!busy) process.exit(0);
  console.error(
    `\n✗ ${PORT}-portda dev server ishlayapti — build to'xtatildi.\n\n` +
      `  \`next build\` va \`next dev\` bitta \`.next\` jildidan foydalanadi.\n` +
      `  Build uni qayta yozadi va dev server shundan keyin har so'rovga\n` +
      `  500 (ENOENT _buildManifest) qaytaradi.\n\n` +
      `  Avval to'xtating:\n` +
      `    kill $(ss -lptn 'sport = :${PORT}' | grep -oP 'pid=\\K[0-9]+' | sort -u)\n` +
      `    rm -rf .next\n\n` +
      `  Ataylab bo'lsa: ALLOW_DEV_BUILD=1 npm run build\n`,
  );
  process.exit(1);
};
socket.setTimeout(700);
socket.on("connect", () => done(true));
socket.on("timeout", () => done(false));
socket.on("error", () => done(false));
