import { env } from "../env";
import { queryOne } from "../db";
import { can, isRole, permissionsOf, type Permission, type Role } from "../admin-rbac";
import type { AuditActor } from "../admin-audit";
import { langOf, type Lang } from "./i18n";

/**
 * Who may use the in-bot admin panel (docs/bot-admin/PLAN.md A-Q1). Called on
 * EVERY admin message and button — nothing about the admin is cached in
 * callback data or in `bot_admin_state`.
 *
 * A Telegram user is a bot admin when ALL hold:
 *   - an account with this `telegram_id` exists and is not blocked;
 *   - it is linked to an `admin_accounts` row (`getAdminAccountForUser` rules:
 *     `active` or `pending` — a pending account is activated by its first web
 *     entry in simple mode, so the bot accepts it too); `disabled` / deleted
 *     (revoked) → no panel;
 *   - with the 2FA switch on (`ADMIN_2FA_REQUIRED`): the account is `active`
 *     AND enrolled (a TOTP secret) — the same rule as a web admin session.
 * The role's permissions come from the RBAC code constant (`admin-rbac.ts`),
 * never from the database.
 *
 * Identity: the webhook is authenticated by Telegram's secret header, and the
 * router accepts admin taps only in a private chat whose id is the tapping
 * user's id — so `from.id` is the Telegram account the admin linked.
 */

export type BotAdmin = {
  adminId: string;
  userId: string;
  role: Role;
  telegramId: number;
  name: string;
  lang: Lang;
  permissions: Permission[];
};

type Row = {
  user_id: string;
  name: string | null;
  language: string | null;
  is_blocked: boolean;
  admin_id: string | null;
  role: string | null;
  status: string | null;
  enrolled: boolean | null;
};

/** The user's bot language even when they are not an admin (for the «Ruxsat yo‘q» toast). */
export type AdminLookup = { lang: Lang; admin: BotAdmin | null };

export async function lookupAdmin(telegramId: number): Promise<AdminLookup> {
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return { lang: "uz", admin: null };
  const r = await queryOne<Row>(
    `SELECT u.id::text AS user_id, u.name, u.language, u.is_blocked,
            a.id::text AS admin_id, a.role, a.status,
            (a.totp_enabled_at IS NOT NULL AND a.totp_secret_enc IS NOT NULL) AS enrolled
       FROM users u
       LEFT JOIN admin_accounts a ON a.user_id = u.id
      WHERE u.telegram_id = $1`,
    [String(telegramId)],
  );
  if (!r) return { lang: "uz", admin: null };
  const lang = langOf(r.language);
  if (r.is_blocked || !r.admin_id || !r.role || !isRole(r.role)) return { lang, admin: null };
  if (r.status !== "active" && r.status !== "pending") return { lang, admin: null };
  if (env.admin2faRequired && (r.status !== "active" || !r.enrolled)) return { lang, admin: null };
  return {
    lang,
    admin: {
      adminId: r.admin_id,
      userId: r.user_id,
      role: r.role,
      telegramId,
      name: r.name?.trim() || "Admin",
      lang,
      permissions: permissionsOf(r.role),
    },
  };
}

/** `adminCtx(telegramUser)`: the linked admin with the role's permissions, or `null`. */
export async function adminCtx(telegramUser: { id: number }): Promise<BotAdmin | null> {
  return (await lookupAdmin(telegramUser.id)).admin;
}

/** For the reply keyboard: whether this Telegram user gets the «🛠 Admin» row. */
export async function isLinkedAdmin(telegramId: number | string): Promise<boolean> {
  return (await adminCtx({ id: Number(telegramId) })) !== null;
}

export function allowed(a: BotAdmin, perm: Permission): boolean {
  return can(a.role, perm);
}

/** The audit actor of a bot action: no IP / browser; `requestId` = the Telegram update. */
export function actorOf(a: BotAdmin, updateId: number): AuditActor & { id: string; userId: string } {
  return { id: a.adminId, userId: a.userId, role: a.role, ip: null, userAgent: "telegram-bot", requestId: `tg-update:${updateId}` };
}
