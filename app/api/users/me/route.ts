import { handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { getUserById } from "@/lib/server/session";
import { recentTransactions } from "@/lib/server/credits";
import { getPaymentBonusPercent } from "@/lib/server/payment-bonus";
import { profilePatchFromBody, updateProfile } from "@/lib/server/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Profil + oxirgi tranzaksiyalar + `paymentBonusPercent` (C-Q4: every paid top-up earns N % as
 * bonus; 0 = off — the wallet shows «Har bir to‘ldirishga +N% bonus» while N > 0;
 * `lib/server/payment-bonus.ts`).
 */
export const GET = handler("users/me", async (req) => {
  const { user } = await requireUser(req);
  const [transactions, percent] = await Promise.all([recentTransactions(user.id, 30), getPaymentBonusPercent()]);
  return json({ user, transactions, paymentBonusPercent: percent });
});

/**
 * Profilni yangilaydi (writer profile — forma standart qiymatlari).
 *
 * Faqat oq ro'yxatdagi maydonlar (`lib/profile/fields.ts EDITABLE_FIELDS`).
 * Yozuvchi — `lib/server/profile.ts updateProfile`; bot ham aynan shuni
 * chaqiradi (bitta qoida: NUL olib tashlanadi, trim, ≤ 200 belgi, audit
 * qatori o'sha tranzaksiyada). `points`/`quota`/`balance`/`plan` bu yerdan
 * hech qachon o'zgarmaydi — aks holda foydalanuvchi o'ziga cheksiz kredit
 * yozib olardi.
 */
export const PATCH = handler("users/update", async (req) => {
  const { user, ip } = await requireUser(req);
  await limit(`profile:${user.id}`, 30, 300);

  const body = await readJson<Record<string, unknown>>(req, 20_000);
  if (!Object.keys(profilePatchFromBody(body)).length) return json({ user });

  await updateProfile(user.id, body, "web", { ip, userAgent: req.headers.get("user-agent") });
  return json({ user: await getUserById(user.id) });
});
