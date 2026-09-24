import test from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";

/**
 * CONC-16: birinchi kirish poygasi (`upsertTelegramUser`).
 *
 * Ilgari `SELECT … FOR UPDATE` hali YO'Q qatorni qulflamasdi: ikki parallel
 * birinchi kirish (Mini App avto-kirish + vidjet, yoki ikki marta bosish)
 * ikkalasi ham `INSERT` qilardi va ikkinchisi `users_telegram_id_key` ga
 * urilib 500 berardi. Endi `INSERT … ON CONFLICT (telegram_id) DO UPDATE`:
 * hammasi BITTA foydalanuvchini oladi, tanish bonusi esa AYNAN BIR MARTA
 * (jurnal `transactions (kind, reference)` bo'yicha idempotent).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, ensureMigrated, pool } = await import("../lib/server/db.ts");
const { upsertTelegramUser, SIGNUP_BONUS_POINTS } = await import("../lib/server/auth.ts");

const ids: string[] = [];
test.after(async () => {
  if (!hasDb) return;
  if (ids.length) await query("DELETE FROM users WHERE telegram_id = ANY($1)", [ids]);
  await pool().end();
});

function freshTelegramId(): string {
  const id = String(9_100_000_000 + randomInt(0, 800_000_000));
  ids.push(id);
  return id;
}

async function ledger(telegramId: string) {
  const users = await query<{ id: string; points: string }>("SELECT id, points FROM users WHERE telegram_id = $1", [telegramId]);
  const bonus = users.length
    ? await query<{ points_delta: string }>("SELECT points_delta FROM transactions WHERE user_id = $1 AND kind = 'bonus'", [users[0]!.id])
    : [];
  return { users, bonus };
}

test("parallel birinchi kirish: hammasi muvaffaqiyatli, BITTA foydalanuvchi, BITTA bonus", { skip }, async () => {
  await ensureMigrated();
  for (let round = 0; round < 5; round++) {
    const telegramId = freshTelegramId();
    const p = { telegramId, username: "race", name: "Poyga", photoUrl: null };
    const settled = await Promise.allSettled([upsertTelegramUser(p), upsertTelegramUser(p), upsertTelegramUser(p)]);
    const rejected = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
    assert.equal(rejected.length, 0, `MUTATSIYA: birinchi kirish poygasi — ${rejected.map((r) => String(r.reason?.message ?? r.reason)).join(" | ")}`);
    const users = settled.map((s) => (s as PromiseFulfilledResult<{ id: string; points: number }>).value);
    assert.equal(new Set(users.map((u) => u.id)).size, 1, "hammasi bitta foydalanuvchini olishi kerak");

    const { users: rows, bonus } = await ledger(telegramId);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0]!.points), SIGNUP_BONUS_POINTS, "bonus bir marta qo'shilgan");
    assert.equal(bonus.length, 1, "jurnalda bitta bonus yozuvi");
    assert.equal(Number(bonus[0]!.points_delta), SIGNUP_BONUS_POINTS);
    assert.ok(users.every((u) => u.points === SIGNUP_BONUS_POINTS), "qaytgan foydalanuvchida bonusli balans");
  }
});

test("mavjud foydalanuvchi qayta kiradi: profil yangilanadi, bonus/balans o'zgarmaydi", { skip }, async () => {
  await ensureMigrated();
  const telegramId = freshTelegramId();
  const first = await upsertTelegramUser({ telegramId, username: "old", name: "Eski Ism", photoUrl: null });
  const second = await upsertTelegramUser({ telegramId, username: "new", name: "Yangi Ism", photoUrl: "https://t.me/p.jpg" });
  assert.equal(second.id, first.id);
  assert.equal(second.username, "new");
  assert.equal(second.name, "Yangi Ism");
  assert.equal(second.photoUrl, "https://t.me/p.jpg");
  assert.equal(second.points, SIGNUP_BONUS_POINTS);
  const { bonus } = await ledger(telegramId);
  assert.equal(bonus.length, 1, "qayta kirishda ikkinchi bonus yo'q");
  // `author` faqat yaratishda ism bilan to'ldiriladi — qayta kirish uni bosib ketmaydi.
  const author = await query<{ author: string }>("SELECT author FROM users WHERE telegram_id = $1", [telegramId]);
  assert.equal(author[0]!.author, "Eski Ism");
});
