import "server-only";
import { ApiError } from "./api";
import { adminTx, type AuditActor } from "./admin-audit";
import { parseReason } from "./admin-accounts";
import type { AdminActor } from "./admin-handler";
import {
  invalidateSettingsCache,
  isSettingKey,
  listSettings,
  resetSettingInTx,
  setSettingInTx,
  type SettingItem,
  type SettingKey,
  type SettingSource,
  type SettingType,
  type SettingValues,
} from "./settings";

/**
 * Route-facing layer over `settings.ts` for `/api/admin/settings`
 * (docs/admin/02-plan.md §6.10, §8). The catalog itself (labels, groups,
 * bounds, validators) stays in `settings.ts`; this module only
 *   - shapes the API item,
 *   - runs each write in ONE transaction together with its audit row, and
 *   - drops the local settings cache after COMMIT (other processes see the
 *     change within the 15 s cache TTL).
 *
 * Every catalog value is a non-secret operational flag or number (bool / int /
 * number / list of tool ids), so `envValue` is safe to send to the browser;
 * `tests/admin-settings.test.mts` pins the catalog to that shape.
 */

/** What the API sends for one setting. Extends the §6.10 shape with `group`, `min`, `max`. */
export type AdminSettingItem = {
  key: SettingKey;
  label: string;
  description: string;
  group: string;
  type: SettingType;
  min: number | null;
  max: number | null;
  value: SettingValues[SettingKey];
  source: SettingSource;
  /** What applies without a DB override: the parsed env value, or the code default. */
  envValue: SettingValues[SettingKey];
  /** Display name of the admin who wrote the DB override; `null` without an override. */
  updatedBy: string | null;
  updatedAt: string | null;
};

/** `{value, source}`: the only thing an audit row holds about a setting (§8). */
type Snapshot = { value: unknown; source: SettingSource };

function toAdminItem(it: SettingItem): AdminSettingItem {
  const writer = it.updatedBy === null ? null : it.updatedByName?.trim() || `Admin №${it.updatedBy}`;
  return {
    key: it.key,
    label: it.label,
    description: it.description,
    group: it.group,
    type: it.type,
    min: it.min,
    max: it.max,
    value: it.value,
    source: it.source,
    envValue: it.envValue,
    updatedBy: writer,
    updatedAt: it.updatedAt,
  };
}

/** Unknown key → 404 with the house `not_found` code (not the "not an admin" cloak). */
export function requireSettingKey(raw: unknown): SettingKey {
  if (!isSettingKey(raw)) throw new ApiError("Bunday sozlama yo'q", 404, { code: "not_found" });
  return raw;
}

export async function listAdminSettings(): Promise<AdminSettingItem[]> {
  return (await listSettings()).map(toAdminItem);
}

async function itemOf(key: SettingKey): Promise<AdminSettingItem> {
  const found = (await listSettings()).find((it) => it.key === key);
  // The key came from the catalog and `listSettings` returns every catalog key.
  if (!found) throw new ApiError("Bunday sozlama yo'q", 404, { code: "not_found" });
  return toAdminItem(found);
}

function snapshot(s: Snapshot): Snapshot {
  return { value: s.value, source: s.source };
}

/**
 * PUT: validates `value` with the catalog (400 with the validator's message),
 * upserts the row and writes `settings.update` (before/after = `{value, source}`)
 * in the same transaction. `admin` is the web route's actor or, for the bot
 * admin panel (`payment-bonus.ts setPaymentBonusPercent`), the bot's audit
 * actor; `opts.via` marks the audit row (`meta.via = "bot"`).
 */
export async function updateAdminSetting(
  admin: AuditActor & Pick<AdminActor, "id">,
  rawKey: unknown,
  body: Record<string, unknown>,
  opts: { via?: "bot" } = {},
): Promise<AdminSettingItem> {
  const key = requireSettingKey(rawKey);
  const reason = parseReason(body.reason)!;
  await adminTx(admin, async (client, audit) => {
    const r = await setSettingInTx(client, key, body.value, admin.id);
    await audit({
      action: "settings.update",
      targetType: "setting",
      targetId: key,
      reason,
      before: snapshot(r.before),
      after: snapshot(r.after),
      ...(opts.via ? { meta: { via: opts.via } } : {}),
    });
  });
  // After COMMIT: the next read in this process reloads (others within 15 s).
  invalidateSettingsCache();
  return itemOf(key);
}

/**
 * DELETE: removes the override (back to env/default) and writes
 * `settings.reset`. A key without a DB row is 409 `state` and writes nothing.
 */
export async function resetAdminSetting(admin: AdminActor, rawKey: unknown, body: Record<string, unknown>): Promise<AdminSettingItem> {
  const key = requireSettingKey(rawKey);
  const reason = parseReason(body.reason)!;
  await adminTx(admin, async (client, audit) => {
    // Locks the row so two concurrent resets cannot both pass the check.
    const row = await client.query("SELECT 1 FROM app_settings WHERE key = $1 FOR UPDATE", [key]);
    if (row.rowCount === 0) {
      throw new ApiError("Bu sozlama allaqachon standart qiymatda", 409, { code: "state" });
    }
    const r = await resetSettingInTx(client, key);
    await audit({
      action: "settings.reset",
      targetType: "setting",
      targetId: key,
      reason,
      before: snapshot(r.before),
      after: snapshot(r.after),
    });
  });
  invalidateSettingsCache();
  return itemOf(key);
}
