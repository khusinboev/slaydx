import { handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { query } from "@/lib/server/db";
import { getUserById } from "@/lib/server/session";
import { recentTransactions } from "@/lib/server/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Profil + oxirgi tranzaksiyalar. */
export const GET = handler("users/me", async (req) => {
  const { user } = await requireUser(req);
  const transactions = await recentTransactions(user.id, 30);
  return json({ user, transactions });
});

/**
 * Profilni yangilaydi (writer profile — forma standart qiymatlari).
 *
 * Faqat oq ro'yxatdagi maydonlar. `points`/`quota`/`balance`/`plan` bu
 * yerdan hech qachon o'zgarmaydi — aks holda foydalanuvchi o'ziga
 * cheksiz kredit yozib olardi.
 */
const EDITABLE = [
  "name",
  "language",
  "university",
  "faculty",
  "department",
  "group",
  "course",
  "author",
  "subject",
  "teacher",
  "city",
] as const;

export const PATCH = handler("users/update", async (req) => {
  const { user } = await requireUser(req);
  await limit(`profile:${user.id}`, 30, 300);

  const body = await readJson<Record<string, unknown>>(req, 20_000);
  const sets: string[] = [];
  const params: unknown[] = [user.id];

  for (const field of EDITABLE) {
    const value = body[field];
    if (typeof value !== "string") continue;
    params.push(value.replace(/\0/g, "").trim().slice(0, 200));
    // `group` — Postgres da zaxiralangan so'z, shuning uchun qo'shtirnoqda.
    sets.push(`"${field}" = $${params.length}`);
  }
  if (!sets.length) return json({ user });

  await query(`UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
  return json({ user: await getUserById(user.id) });
});
