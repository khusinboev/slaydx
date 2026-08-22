import "server-only";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";

/**
 * Kredit hisobi — endi serverda.
 *
 * Ilgari `charge`/`refund` brauzerdagi zustand store da edi: foydalanuvchi
 * DevTools da `localStorage` ni tahrirlab o'ziga cheksiz tanga yozishi
 * mumkin edi. Endi balans faqat bazada, har harakat jurnalga tushadi va
 * `reference` bo'yicha idempotent — bitta generatsiya ikki marta yechilmaydi.
 */

export type ChargeSplit = { points: number; quota: number; balance: number };

export type ChargeResult =
  | { ok: true; split: ChargeSplit; alreadyCharged: boolean }
  | { ok: false; reason: "insufficient"; required: number; available: number };

const ZERO: ChargeSplit = { points: 0, quota: 0, balance: 0 };

/**
 * Hamyonlardan navbat bilan yechadi: avval bonus ball, keyin Pro kvota,
 * oxirida haqiqiy balans. Shu tartib foydalanuvchi uchun eng foydali —
 * muddati o'tuvchi mablag' avval sarflanadi.
 */
function splitFor(amount: number, w: ChargeSplit): ChargeSplit {
  let left = amount;
  const take = (pool: number) => {
    const n = Math.min(pool, left);
    left -= n;
    return n;
  };
  return { points: take(w.points), quota: take(w.quota), balance: take(w.balance) };
}

async function walletOf(client: PoolClient, userId: string): Promise<ChargeSplit> {
  const res = await client.query<{ points: string; quota: string; balance: string }>(
    "SELECT points, quota, balance FROM users WHERE id = $1 FOR UPDATE",
    [userId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("Foydalanuvchi topilmadi");
  return { points: Number(row.points), quota: Number(row.quota), balance: Number(row.balance) };
}

export function walletTotal(w: ChargeSplit): number {
  return w.points + w.quota + w.balance;
}

/**
 * Kreditni yechadi. `reference` — takrorlanmas kalit (odatda generation id).
 * Bir xil reference bilan ikkinchi chaqiruv pul yechmaydi.
 */
export async function charge(
  userId: string,
  amount: number,
  reference: string,
  note = "",
): Promise<ChargeResult> {
  return transaction((client) => chargeInTx(client, userId, amount, reference, note));
}

/**
 * Yechishning tranzaksiya ichidagi varianti.
 *
 * Generatsiya qatorini yaratish va pul yechish **bitta** tranzaksiyada
 * bo'lishi shart: aks holda navbatdagi worker hali to'lanmagan ishni
 * ushlab olishi yoki pul yechilib ish yaratilmay qolishi mumkin.
 */
export async function chargeInTx(
  client: PoolClient,
  userId: string,
  amount: number,
  reference: string,
  note = "",
): Promise<ChargeResult> {
  if (amount <= 0) return { ok: true, split: ZERO, alreadyCharged: false };

  {
    const prior = await client.query<{ points_delta: string; quota_delta: string; balance_delta: string }>(
      "SELECT points_delta, quota_delta, balance_delta FROM transactions WHERE kind = 'charge' AND reference = $1",
      [reference],
    );
    if (prior.rows[0]) {
      const r = prior.rows[0];
      return {
        ok: true as const,
        alreadyCharged: true,
        split: {
          points: -Number(r.points_delta),
          quota: -Number(r.quota_delta),
          balance: -Number(r.balance_delta),
        },
      };
    }

    const wallet = await walletOf(client, userId);
    const available = walletTotal(wallet);
    if (available < amount) {
      return { ok: false as const, reason: "insufficient" as const, required: amount, available };
    }

    const split = splitFor(amount, wallet);
    await client.query(
      `UPDATE users
          SET points = points - $2, quota = quota - $3, balance = balance - $4, updated_at = now()
        WHERE id = $1`,
      [userId, split.points, split.quota, split.balance],
    );
    await client.query(
      `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note)
       VALUES ($1, 'charge', $2, $3, $4, $5, $6)`,
      [userId, -split.points, -split.quota, -split.balance, reference, note],
    );
    return { ok: true as const, split, alreadyCharged: false };
  }
}

/**
 * Yechilgan mablag'ni aynan olingan hamyonlarga qaytaradi.
 * Bir xil reference uchun qayta chaqirilsa hech narsa qilmaydi.
 */
export async function refund(userId: string, reference: string, note = ""): Promise<boolean> {
  return transaction(async (client) => {
    const done = await client.query("SELECT 1 FROM transactions WHERE kind = 'refund' AND reference = $1", [
      reference,
    ]);
    if (done.rows[0]) return false;

    const charged = await client.query<{
      points_delta: string;
      quota_delta: string;
      balance_delta: string;
    }>(
      "SELECT points_delta, quota_delta, balance_delta FROM transactions WHERE kind = 'charge' AND reference = $1",
      [reference],
    );
    const row = charged.rows[0];
    if (!row) return false;

    const points = -Number(row.points_delta);
    const quota = -Number(row.quota_delta);
    const balance = -Number(row.balance_delta);
    if (points + quota + balance === 0) return false;

    await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
    await client.query(
      `UPDATE users
          SET points = points + $2, quota = quota + $3, balance = balance + $4, updated_at = now()
        WHERE id = $1`,
      [userId, points, quota, balance],
    );
    await client.query(
      `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note)
       VALUES ($1, 'refund', $2, $3, $4, $5, $6)`,
      [userId, points, quota, balance, reference, note],
    );
    return true;
  });
}

/** Balansni to'ldirish (to'lov webhook idan). `reference` — provider tranzaksiya id. */
export async function topUp(
  userId: string,
  delta: Partial<ChargeSplit>,
  reference: string,
  kind: "topup" | "bonus" | "subscription" = "topup",
  note = "",
): Promise<boolean> {
  const points = delta.points ?? 0;
  const quota = delta.quota ?? 0;
  const balance = delta.balance ?? 0;
  if (points + quota + balance <= 0) return false;

  return transaction(async (client) => {
    const done = await client.query("SELECT 1 FROM transactions WHERE kind = $1 AND reference = $2", [
      kind,
      reference,
    ]);
    // Webhook ikki marta kelishi normal holat — ikkinchisida pul qo'shilmaydi.
    if (done.rows[0]) return false;

    await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
    await client.query(
      `UPDATE users
          SET points = points + $2, quota = quota + $3, balance = balance + $4, updated_at = now()
        WHERE id = $1`,
      [userId, points, quota, balance],
    );
    await client.query(
      `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, kind, points, quota, balance, reference, note],
    );
    return true;
  });
}

/** Pro obunani yoqadi va kvota beradi. */
export async function activatePro(
  userId: string,
  quotaAmount: number,
  days: number,
  reference: string,
): Promise<boolean> {
  const added = await topUp(userId, { quota: quotaAmount }, reference, "subscription", "Pro obuna");
  if (!added) return false;
  await query(
    `UPDATE users
        SET plan = 'pro',
            -- Faol obuna ustiga qo'shiladi, tugagani yangidan boshlanadi.
            plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + ($2 || ' days')::interval,
            updated_at = now()
      WHERE id = $1`,
    [userId, String(days)],
  );
  return true;
}

/**
 * Admin bitta hamyonni to'g'ridan-to'g'ri tuzatadi.
 *
 * `topUp`/`charge` dan farqi: ular haqiqiy pul harakati (to'lov,
 * generatsiya narxi) uchun va ular bilan bir jurnalda turishi shart —
 * moliyaviy hisobot ular ustida hisoblanadi. Admin tuzatishi boshqa
 * `kind` bilan yoziladi (`admin_credit` / `admin_debit`), shuning uchun
 * ikkalasi aralashib ketmaydi: "necha pul haqiqatan to'landi" degan
 * savolga admin bergan bonus qo'shilib hisoblanmaydi.
 *
 * `wallet` — qaysi hamyon (`points` | `quota` | `balance`).
 * `delta` musbat bo'lsa qo'shiladi, manfiy bo'lsa yechiladi; hamyon
 * manfiyga tushishi CHECK constraint bilan ham, shu yerda ham
 * to'silgan (aniq xabar uchun ikkalasi kerak).
 */
export type Wallet = "points" | "quota" | "balance";

export type AdminAdjustResult =
  | { ok: true; before: number; after: number }
  | { ok: false; reason: "insufficient"; available: number };

const WALLETS: readonly Wallet[] = ["points", "quota", "balance"];

export async function adminAdjustWallet(
  userId: string,
  wallet: Wallet,
  delta: number,
  adminIdentity: string,
  note = "",
): Promise<AdminAdjustResult> {
  // `wallet` SQL ustun nomiga to'g'ridan-to'g'ri interpolyatsiya qilinadi
  // (parametrlashtirib bo'lmaydi — ustun nomi parametr emas). TypeScript
  // turi buni chaqiruv vaqtida cheklaydi, lekin bu funksiya JSON'dan
  // kelgan qiymat bilan ham chaqirilishi mumkin (API route orqali) —
  // shuning uchun runtime tekshiruvi ham SHART, faqat TS turiga
  // ishonib bo'lmaydi.
  if (!WALLETS.includes(wallet)) throw new Error(`Noma'lum hamyon: ${wallet}`);
  const amount = Math.trunc(delta);
  if (amount === 0) return { ok: true, before: 0, after: 0 };

  return transaction(async (client) => {
    const res = await client.query<Record<Wallet, string>>(
      `SELECT points, quota, balance FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const row = res.rows[0];
    if (!row) throw new Error("Foydalanuvchi topilmadi");
    const before = Number(row[wallet]);
    const after = before + amount;
    if (after < 0) return { ok: false as const, reason: "insufficient" as const, available: before };

    await client.query(`UPDATE users SET ${wallet} = ${wallet} + $2, updated_at = now() WHERE id = $1`, [
      userId,
      amount,
    ]);
    const deltaCol = `${wallet}_delta`;
    await client.query(
      `INSERT INTO transactions (user_id, kind, ${deltaCol}, reference, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        amount >= 0 ? "admin_credit" : "admin_debit",
        amount,
        randomUUID(),
        `${adminIdentity}${note ? `: ${note}` : ""}`,
      ],
    );
    return { ok: true as const, before, after };
  });
}

export type TransactionRow = {
  id: string;
  kind: string;
  points_delta: string;
  quota_delta: string;
  balance_delta: string;
  note: string | null;
  created_at: Date;
};

export async function recentTransactions(userId: string, limit = 50) {
  const rows = await query<TransactionRow>(
    `SELECT id, kind, points_delta, quota_delta, balance_delta, note, created_at
       FROM transactions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.min(limit, 200)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind,
    amount: Number(r.points_delta) + Number(r.quota_delta) + Number(r.balance_delta),
    note: r.note ?? "",
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
