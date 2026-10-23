import "server-only";
import { ApiError } from "./api";
import { adminTx } from "./admin-audit";
import { parseReason } from "./admin-accounts";
import { isAdminCryptoError } from "./admin-crypto";
import { can } from "./admin-rbac";
import type { AdminActor } from "./admin-handler";
import { query, queryOne } from "./db";
import { log } from "./log";
import { openProviderKey, sealProviderKey, sealingKeySource } from "./providers/crypto";
import { probeProvider, type ProbeResult } from "./providers/probe";
import {
  PROVIDERS,
  isPlausibleKey,
  isProviderId,
  keyHintOf,
  providerDef,
  type ProviderId,
  type ProviderKind,
} from "./providers/registry";
import { hasEnvKey, PROVIDER_CACHE_TTL_MS } from "./providers/resolve";
import { reloadProviderKeys } from "./providers/store";

/**
 * Route-facing layer of the admin «Provayderlar» page (program-17 decision D7).
 *
 * Reads and writes `provider_settings`; the generation code never calls this, it reads the decrypted snapshot
 * through `providers/resolve.ts`. Rules:
 *   - a key is NEVER returned, logged or audited. The API sends `hasDbKey` and the masked `keyHint` (`…a1B2`),
 *     and the hint only to roles that may edit (`settings.edit`); the audit rows carry the provider id and the hint;
 *   - every write is ONE transaction with its audit row (`adminTx`), serialised per provider by an advisory lock;
 *   - after COMMIT this process reloads its snapshot at once; the other process (web <-> worker) within the TTL.
 *
 * Permissions are the existing ones: `settings.view` reads, `settings.edit` (owner + admin, step-up) writes.
 */

export type AdminProviderItem = {
  id: ProviderId;
  label: string;
  kinds: readonly ProviderKind[];
  /** The adapter exists in code. `false`: the key can be stored, the page says «tez orada». */
  implemented: boolean;
  /** «Tekshirish» has a live call for this provider. */
  testable: boolean;
  /** What a key looks like (registry hint, not validated strictly). */
  keyFormat: string;
  enabled: boolean;
  hasDbKey: boolean;
  /** `…a1B2`; `null` without a stored key AND for roles without `settings.edit`. */
  keyHint: string | null;
  /** A fallback env var is set in this process. */
  envPresent: boolean;
  /** Where the key in use comes from: the stored key, the env var, or none (also when switched off). */
  keySource: "db" | "env" | "none";
  /** A key is stored but cannot be decrypted (the sealing key changed): it is ignored, enter it again. */
  unreadable: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type AdminProvidersBody = {
  items: AdminProviderItem[];
  /** Keys can be stored: `PROVIDER_KEYS_KEY` or `ADMIN_TOTP_KEY` is set and valid. Toggles work without it. */
  canStoreKeys: boolean;
  /** Which key seals them: `provider` = PROVIDER_KEYS_KEY, `admin` = the ADMIN_TOTP_KEY fallback (the page recommends the former), `none`. */
  sealingKey: "provider" | "admin" | "none";
  /** A change made through this page reaches the other process (web <-> worker) within this many seconds. */
  propagationSec: number;
};

type DbRow = {
  provider: string;
  enabled: boolean;
  key_ciphertext: Buffer | null;
  key_hint: string | null;
  updated_at: Date | string;
  updated_by_name: string | null;
};

const NOT_FOUND = () => new ApiError("Bunday provayder yo'q", 404, { code: "not_found" });

/** Unknown id -> 404 with the house `not_found` code. */
export function requireProviderId(raw: unknown): ProviderId {
  if (!isProviderId(raw)) throw NOT_FOUND();
  return raw;
}

function isReadable(id: string, blob: Buffer): boolean {
  try {
    openProviderKey(id, blob);
    return true;
  } catch {
    return false;
  }
}

function toItem(id: ProviderId, row: DbRow | undefined, showHint: boolean): AdminProviderItem {
  const def = providerDef(id)!;
  const enabled = row?.enabled ?? true;
  const hasDbKey = Boolean(row?.key_ciphertext);
  const unreadable = hasDbKey && !isReadable(id, row!.key_ciphertext!);
  const envPresent = hasEnvKey(id);
  const keySource = !enabled ? "none" : hasDbKey && !unreadable ? "db" : envPresent ? "env" : "none";
  return {
    id,
    label: def.label,
    kinds: def.kinds,
    implemented: def.implemented,
    testable: def.testable,
    keyFormat: def.keyHint,
    enabled,
    hasDbKey,
    keyHint: showHint && hasDbKey ? (row!.key_hint ?? null) : null,
    envPresent,
    keySource,
    unreadable,
    updatedBy: row ? (row.updated_by_name?.trim() || null) : null,
    updatedAt: row ? new Date(row.updated_at).toISOString() : null,
  };
}

async function readRows(): Promise<Map<string, DbRow>> {
  const rows = await query<DbRow>(
    `SELECT p.provider, p.enabled, p.key_ciphertext, p.key_hint, p.updated_at, u.name AS updated_by_name
       FROM provider_settings p
       LEFT JOIN admin_accounts a ON a.id = p.updated_by
       LEFT JOIN users u ON u.id = a.user_id`,
  );
  return new Map(rows.map((r) => [r.provider, r]));
}

/** Every registry provider with its stored state. `role` decides whether the masked hint is included. */
export async function listAdminProviders(role: string): Promise<AdminProvidersBody> {
  const rows = await readRows();
  const showHint = can(role, "settings.edit");
  return {
    items: PROVIDERS.map((p) => toItem(p.id, rows.get(p.id), showHint)),
    canStoreKeys: sealingKeySource() !== "none",
    sealingKey: sealingKeySource(),
    propagationSec: Math.round(PROVIDER_CACHE_TTL_MS / 1000),
  };
}

async function itemOf(id: ProviderId, role: string): Promise<AdminProviderItem> {
  const rows = await readRows();
  return toItem(id, rows.get(id), can(role, "settings.edit"));
}

type Client = Parameters<Parameters<typeof adminTx>[1]>[0];

/** Serialises writers of the same provider (the audit `before` must be the row they really replace). */
async function lockProvider(client: Client, id: string): Promise<DbRow | undefined> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`provider_settings:${id}`]);
  const r = await client.query<DbRow>(
    `SELECT provider, enabled, key_ciphertext, key_hint, updated_at, NULL::text AS updated_by_name
       FROM provider_settings WHERE provider = $1`,
    [id],
  );
  return r.rows[0];
}

/** PUT `{enabled, reason}`: switches a provider on or off. 409 `state` when it already is. */
export async function setAdminProviderEnabled(admin: AdminActor, rawId: unknown, body: Record<string, unknown>): Promise<AdminProviderItem> {
  const id = requireProviderId(rawId);
  if (typeof body.enabled !== "boolean") throw new ApiError("enabled mantiqiy qiymat bo'lishi kerak", 400);
  const enabled = body.enabled;
  const reason = parseReason(body.reason)!;
  await adminTx(admin, async (client, audit) => {
    const before = await lockProvider(client, id);
    if ((before?.enabled ?? true) === enabled) {
      throw new ApiError(enabled ? "Provayder allaqachon yoqilgan" : "Provayder allaqachon o'chirilgan", 409, { code: "state" });
    }
    await client.query(
      `INSERT INTO provider_settings (provider, enabled, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (provider) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [id, enabled, admin.id],
    );
    await audit({
      action: enabled ? "providers.enable" : "providers.disable",
      targetType: "provider",
      targetId: id,
      reason,
      before: { enabled: !enabled },
      after: { enabled },
    });
  });
  await reloadProviderKeys();
  return itemOf(id, admin.role);
}

/**
 * PUT `{key, reason}`: stores or replaces the key. The key is validated for shape only, sealed with the provider
 * id as AAD, and never echoed. 503 `crypto_unavailable` when no sealing key is configured.
 */
export async function setAdminProviderKey(admin: AdminActor, rawId: unknown, body: Record<string, unknown>): Promise<AdminProviderItem> {
  const id = requireProviderId(rawId);
  const reason = parseReason(body.reason)!;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!isPlausibleKey(key)) throw new ApiError("Kalit noto'g'ri: 8–512 belgi, bo'sh joysiz, faqat ASCII", 400);
  let sealed: Buffer;
  try {
    sealed = sealProviderKey(id, key);
  } catch (e) {
    if (!isAdminCryptoError(e)) throw e;
    log("error", "[providers] kalitni shifrlab bo'lmadi", { provider: id, code: e.code });
    throw new ApiError("Shifrlash kaliti sozlanmagan (PROVIDER_KEYS_KEY yoki ADMIN_TOTP_KEY)", 503, { code: "crypto_unavailable" });
  }
  const hint = keyHintOf(key);
  await adminTx(admin, async (client, audit) => {
    const before = await lockProvider(client, id);
    await client.query(
      `INSERT INTO provider_settings (provider, key_ciphertext, key_hint, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (provider) DO UPDATE
         SET key_ciphertext = EXCLUDED.key_ciphertext, key_hint = EXCLUDED.key_hint,
             updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [id, sealed, hint, admin.id],
    );
    await audit({
      action: before?.key_ciphertext ? "providers.key_replace" : "providers.key_set",
      targetType: "provider",
      targetId: id,
      reason,
      before: { hasKey: Boolean(before?.key_ciphertext), hint: before?.key_hint ?? null },
      after: { hasKey: true, hint },
    });
  });
  await reloadProviderKeys();
  return itemOf(id, admin.role);
}

/** DELETE `{reason}`: removes the stored key; the env var applies again. 409 `state` when none is stored. */
export async function deleteAdminProviderKey(admin: AdminActor, rawId: unknown, body: Record<string, unknown>): Promise<AdminProviderItem> {
  const id = requireProviderId(rawId);
  const reason = parseReason(body.reason)!;
  await adminTx(admin, async (client, audit) => {
    const before = await lockProvider(client, id);
    if (!before?.key_ciphertext) throw new ApiError("Bu provayderda saqlangan kalit yo'q", 409, { code: "state" });
    await client.query(
      `UPDATE provider_settings SET key_ciphertext = NULL, key_hint = NULL, updated_by = $2, updated_at = now() WHERE provider = $1`,
      [id, admin.id],
    );
    await audit({
      action: "providers.key_delete",
      targetType: "provider",
      targetId: id,
      reason,
      before: { hasKey: true, hint: before.key_hint },
      after: { hasKey: false, hint: null },
    });
  });
  await reloadProviderKeys();
  return itemOf(id, admin.role);
}

/** The key «Tekshirish» uses: the stored one (decrypted, for this call only), else the env var; the switch is ignored. */
async function keyForProbe(id: ProviderId): Promise<string> {
  const row = await queryOne<{ key_ciphertext: Buffer | null }>("SELECT key_ciphertext FROM provider_settings WHERE provider = $1", [id]);
  if (row?.key_ciphertext) {
    try {
      return openProviderKey(id, row.key_ciphertext);
    } catch {
      return "";
    }
  }
  const def = providerDef(id)!;
  for (const name of def.envKeys) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return "";
}

/** POST: one cheap live call with the key in use. Audited (`providers.test`, `meta.ok`); the key is never in the answer. */
export async function testAdminProvider(admin: AdminActor, rawId: unknown, fetchImpl?: typeof fetch): Promise<ProbeResult> {
  const id = requireProviderId(rawId);
  const def = providerDef(id)!;
  if (!def.testable) throw new ApiError("Bu provayder uchun tekshiruv hali yo'q", 409, { code: "state" });
  const key = await keyForProbe(id);
  const result = key ? await probeProvider(id, key, { fetchImpl }) : { ok: false, message: "Kalit yo'q: avval kiriting yoki muhitga qo'ying" };
  await adminTx(admin, async (_client, audit) => {
    await audit({ action: "providers.test", targetType: "provider", targetId: id, meta: { ok: result.ok } });
  });
  return result;
}
