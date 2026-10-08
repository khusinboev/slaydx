import "server-only";
import { transaction } from "./db";
import { writeAudit } from "./admin-audit";
import { EDITABLE_FIELDS, FIELD_MAX, cleanFieldValue, isBotLanguage, type EditableField } from "../profile/fields";

/**
 * The one writer of a user's own profile (docs/bot/PLAN.md, B2): the web
 * `PATCH /api/users/me` and the bot's «Profilim» both call `updateProfile`,
 * so the allowlist, the cleaning and the limit cannot drift apart.
 *
 *   - only `EDITABLE_FIELDS` (never points/quota/balance/plan/phone);
 *   - non-string values are ignored; NUL bytes stripped, trimmed, cut to
 *     `FIELD_MAX` (200) characters — the web's long-standing behaviour; the
 *     bot rejects a longer value before calling (it can re-ask);
 *   - `language` only `uz` | `ru` | `en` (the bot's interface language),
 *     anything else is ignored;
 *   - a change writes ONE `admin_audit_log` row (`profile.update`, actor =
 *     the user, `meta.via` = web | bot, before/after = the changed fields
 *     only) in the SAME transaction as the UPDATE. The log is the project's
 *     only audit table (append-only, 028); a user-initiated row is told
 *     apart by `admin_id IS NULL` + `actor_role = 'user'`.
 *   - an unchanged value is no change: no UPDATE, no audit row — so a
 *     retried (replayed) bot update or the slide form's autosave after every
 *     «Yaratish» does not fill the log.
 */

export type ProfileSource = "web" | "bot";

export type ProfileUpdate = {
  /** Fields whose stored value actually changed (empty: nothing written). */
  changed: EditableField[];
  /** The stored values of `changed` after the update. */
  values: Partial<Record<EditableField, string>>;
};

/** The cleaned allowlisted values of a request body (pure; exported for tests). */
export function profilePatchFromBody(body: Record<string, unknown>): Partial<Record<EditableField, string>> {
  const out: Partial<Record<EditableField, string>> = {};
  for (const field of EDITABLE_FIELDS) {
    const raw = body[field];
    if (typeof raw !== "string") continue;
    const value = cleanFieldValue(raw).slice(0, FIELD_MAX);
    if (field === "language" && !isBotLanguage(value)) continue;
    out[field] = value;
  }
  return out;
}

/** `group` is a reserved word in Postgres — every column name is quoted. */
const col = (field: EditableField) => `"${field}"`;

export async function updateProfile(
  userId: string,
  body: Record<string, unknown>,
  source: ProfileSource,
  ctx: { ip?: string | null; userAgent?: string | null } = {},
): Promise<ProfileUpdate> {
  const patch = profilePatchFromBody(body);
  const fields = Object.keys(patch) as EditableField[];
  if (!fields.length) return { changed: [], values: {} };

  return transaction(async (client) => {
    const cur = await client.query<Record<string, string>>(
      `SELECT ${fields.map(col).join(", ")} FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const row = cur.rows[0];
    if (!row) return { changed: [], values: {} };
    const changed = fields.filter((f) => (row[f] ?? "") !== patch[f]);
    if (!changed.length) return { changed: [], values: {} };

    const params: unknown[] = [userId];
    const sets = changed.map((f) => {
      params.push(patch[f]);
      return `${col(f)} = $${params.length}`;
    });
    // Saving «Ism» marks it as the user's own, so Telegram logins stop overwriting it (migration 040).
    if ((changed as string[]).includes("name") && patch.name) sets.push("name_custom = TRUE");
    await client.query(`UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);

    const before: Record<string, string> = {};
    const after: Record<string, string> = {};
    for (const f of changed) {
      before[f] = row[f] ?? "";
      after[f] = patch[f]!;
    }
    await writeAudit(
      client,
      { id: null, userId, role: "user", ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
      { action: "profile.update", targetType: "user", targetId: userId, before, after, meta: { via: source } },
    );
    return { changed, values: after as Partial<Record<EditableField, string>> };
  });
}
