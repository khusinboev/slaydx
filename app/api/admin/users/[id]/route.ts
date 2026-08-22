import { ApiError, handler, json, readJson } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";
import { adminAdjustWallet, recentTransactions, type Wallet } from "@/lib/server/credits";
import { getUserById } from "@/lib/server/session";
import { query } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WALLETS: readonly Wallet[] = ["points", "quota", "balance"];

/** Bitta foydalanuvchi — profil + so'nggi 50 tranzaksiya. */
export const GET = handler("admin/users/get", async (req, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const user = await getUserById(id);
  if (!user) throw new ApiError("Topilmadi", 404);
  const transactions = await recentTransactions(id, 50);
  return json({ user, transactions });
});

type AdjustBody = { wallet?: unknown; delta?: unknown; note?: unknown };

/**
 * Bitta hamyonni tuzatadi.
 *
 *   PATCH /api/admin/users/:id  { wallet: "balance", delta: 1000000, note?: "" }
 *
 * `delta` musbat — qo'shadi, manfiy — yechadi (hamyon manfiyga tushmaydi).
 * Har amal kim bajarganini jurnalga yozadi (`note` ustida adminning
 * o'z ismi/ID si bilan birga).
 */
export const PATCH = handler("admin/users/adjust", async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user: admin } = await requireAdmin(req);
  const { id } = await ctx.params;

  const body = await readJson<AdjustBody>(req, 4_000);
  const wallet = String(body.wallet ?? "");
  if (!WALLETS.includes(wallet as Wallet)) {
    throw new ApiError(`Hamyon noto'g'ri. Kerak: ${WALLETS.join(" | ")}`, 400);
  }
  const delta = Number(body.delta);
  if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
    throw new ApiError("Miqdor butun va noldan farqli bo'lishi kerak", 400);
  }
  // Bitta so'rovda haddan tashqari katta o'zgarish — ehtimol xato bosish.
  if (Math.abs(delta) > 100_000_000) {
    throw new ApiError("Miqdor juda katta", 400);
  }
  const note = String(body.note ?? "").slice(0, 200);

  const target = await getUserById(id);
  if (!target) throw new ApiError("Foydalanuvchi topilmadi", 404);

  const adminLabel = admin.phone ? `admin:${admin.phone}` : `admin:${admin.id}`;
  const result = await adminAdjustWallet(id, wallet as Wallet, delta, adminLabel, note);
  if (!result.ok) {
    throw new ApiError(`Yetarli emas. Mavjud: ${result.available.toLocaleString("uz-UZ")}`, 400);
  }

  const updated = await getUserById(id);
  return json({ user: updated, before: result.before, after: result.after });
});

/** Bloklash / blokdan chiqarish — mavjud `is_blocked` ustunidan foydalanadi. */
export const PUT = handler("admin/users/block", async (req, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const body = await readJson<{ blocked?: unknown }>(req, 1_000);
  const blocked = Boolean(body.blocked);

  const rows = await query<{ id: string }>(
    "UPDATE users SET is_blocked = $2, updated_at = now() WHERE id = $1 RETURNING id",
    [id, blocked],
  );
  if (!rows.length) throw new ApiError("Foydalanuvchi topilmadi", 404);

  const updated = await getUserById(id);
  return json({ user: updated });
});
