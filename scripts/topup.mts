/**
 * Qo'lda kredit qo'shish (admin vositasi).
 *
 * Foydalanish:
 *   npm run topup -- <username> <miqdor> [points|quota|balance]
 *
 * Pul jurnaldan o'tadi — balansni to'g'ridan-to'g'ri UPDATE qilmaymiz,
 * shunda hisob har doim tranzaksiyalar yig'indisiga teng qoladi.
 */
import { randomUUID } from "node:crypto";
import { queryOne, pool } from "../lib/server/db.ts";
import { topUp } from "../lib/server/credits.ts";

const [username, rawAmount, rawWallet = "balance"] = process.argv.slice(2);
const amount = Number(rawAmount);

if (!username || !Number.isFinite(amount) || amount <= 0) {
  console.error("Foydalanish: npm run topup -- <username> <miqdor> [points|quota|balance]");
  process.exit(1);
}
if (!["points", "quota", "balance"].includes(rawWallet)) {
  console.error("Hamyon: points | quota | balance");
  process.exit(1);
}

const user = await queryOne<{ id: string; name: string }>(
  "SELECT id, name FROM users WHERE username = $1 OR telegram_id::text = $1",
  [username],
);
if (!user) {
  console.error(`Foydalanuvchi topilmadi: ${username}`);
  await pool().end();
  process.exit(1);
}

const ok = await topUp(
  String(user.id),
  { [rawWallet]: amount },
  `manual:${randomUUID()}`,
  "bonus",
  `Qo'lda qo'shildi (${rawWallet})`,
);

const after = await queryOne<{ points: string; quota: string; balance: string }>(
  "SELECT points, quota, balance FROM users WHERE id = $1",
  [user.id],
);
console.log(ok ? "✓ qo'shildi" : "✗ qo'shilmadi");
console.log(`  ${username}: ball=${after!.points} kvota=${after!.quota} balans=${after!.balance}`);
await pool().end();
