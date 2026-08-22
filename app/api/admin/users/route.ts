import { handler, json } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";
import { query } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdminUserRow = {
  id: string;
  name: string;
  username: string | null;
  telegramId: string | null;
  localId: string | null;
  phone: string | null;
  points: number;
  quota: number;
  balance: number;
  plan: string;
  isBlocked: boolean;
  createdAt: string;
};

const PAGE_SIZE = 30;

/**
 * Foydalanuvchilar ro'yxati — qidiruv va sahifalash bilan.
 *
 *   GET /api/admin/users?q=<matn>&page=<son>
 *
 * `q` ismi, username, Telegram ID yoki telefon (`local_id`) bo'yicha
 * qidiradi — admin panelida qaysi maydon bilan qidirilayotgani
 * ko'rinmaydi, shuning uchun hammasi bittada tekshiriladi.
 */
export const GET = handler("admin/users/list", async (req) => {
  await requireAdmin(req);

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const where = q ? "WHERE name ILIKE $1 OR username ILIKE $1 OR local_id ILIKE $1 OR telegram_id::text ILIKE $1" : "";
  const params = q ? [`%${q}%`] : [];

  const rows = await query<{
    id: string;
    name: string;
    username: string | null;
    telegram_id: string | null;
    local_id: string | null;
    phone: string | null;
    points: string;
    quota: string;
    balance: string;
    plan: string;
    is_blocked: boolean;
    created_at: Date;
  }>(
    `SELECT id, name, username, telegram_id, local_id, phone, points, quota, balance, plan, is_blocked, created_at
       FROM users
       ${where}
      ORDER BY created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET $${params.length + 1}`,
    [...params, offset],
  );

  const [{ count }] = await query<{ count: string }>(`SELECT count(*) FROM users ${where}`, params);

  const users: AdminUserRow[] = rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    username: r.username,
    telegramId: r.telegram_id ? String(r.telegram_id) : null,
    localId: r.local_id,
    phone: r.phone,
    points: Number(r.points),
    quota: Number(r.quota),
    balance: Number(r.balance),
    plan: r.plan,
    isBlocked: r.is_blocked,
    createdAt: new Date(r.created_at).toISOString(),
  }));

  return json({ users, total: Number(count), page, pageSize: PAGE_SIZE });
});

