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
import { providerUsage, type ProviderUsage, type ProviderUsageBody } from "./admin-provider-usage";
import { parseBreakers, parseLimiters, type AiBreaker, type AiLimiter, type AiProcess } from "./admin-ai";
import { isStale } from "./admin-heartbeat";
import { soumPerUsd } from "./admin-cost";
import { azureRegion } from "../generation/tts/azure";
import { geminiTtsModel } from "../generation/tts/gemini";
import { getSetting } from "./settings";
import { PROVIDER_META, PURPOSES, ROUTE_INFO, purposeVerdict, type Billing, type Need, type PurposeId, type Verdict } from "./providers/catalog";
import { effectiveRoute, type RouteSource } from "./providers/route-effective";
import { ROUTE_SPECS, checkRoute, isRouteId, modelOptions, type ModelOption, type RouteEntry, type RouteId, type RouteShape } from "./providers/routes";
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
import { ensureProviderKeys, reloadProviderKeys } from "./providers/store";

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
  /** The provider can serve requests right now: switched on and a key resolves (Azure also needs its region). */
  usable: boolean;
  billing: Billing;
  priceNote: string;
  /** What the product uses it for, one sentence. */
  role: string;
  need: Need;
  keyUrl: string | null;
  /** The purposes (`AdminPurposeItem.id`) this provider takes part in. */
  purposes: PurposeId[];
  /** A circuit breaker of this provider is open: requests are skipped until `openUntil`. */
  breaker: { state: "open" | "half-open"; openUntil: string | null } | null;
  usage: ProviderUsage;
};

export type AdminRouteEntryState = RouteEntry & { label: string; usable: boolean };

export type AdminRouteItem = {
  id: RouteId;
  title: string;
  help: string;
  shape: RouteShape;
  max: number;
  /** Providers allowed in the slot, with their label. */
  providers: { id: ProviderId; label: string }[];
  /** Selectable models with their price (empty for the voice order). */
  models: ModelOption[];
  /** `db` = the admin's choice, `env` = the server's environment variable, `default` = built in. */
  source: RouteSource;
  entries: AdminRouteEntryState[];
  /** What «Standartga qaytarish» restores (env value when set, else the built-in default). */
  fallbackEntries: AdminRouteEntryState[];
  updatedBy: string | null;
  updatedAt: string | null;
};

export type AdminPurposeItem = {
  id: PurposeId;
  title: string;
  summary: string;
  need: Need;
  minimum: string;
  fallback: boolean;
  providerIds: ProviderId[];
  premiumIds: ProviderId[];
  verdict: Verdict;
  headline: string;
  detail: string;
  /** A «Sozlamalar» flag that also gates the purpose, with its current value. */
  setting: { key: string; label: string; enabled: boolean } | null;
  routes: AdminRouteItem[];
};

export type AdminSystemBody = { processes: AiProcess[]; breakers: AiBreaker[]; limiters: AiLimiter[] };

export type AdminProvidersBody = {
  items: AdminProviderItem[];
  purposes: AdminPurposeItem[];
  system: AdminSystemBody;
  /** 30-day spend of providers that are no longer in the registry (kept so history stays in the totals). */
  otherUsage: ProviderUsageBody["other"];
  total30: ProviderUsageBody["total30"];
  soumPerUsd: number;
  generatedAt: string;
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

type ItemCtx = {
  showHint: boolean;
  usage: ProviderUsageBody;
  system: AdminSystemBody;
};

/** The provider a circuit-breaker name belongs to: `gemini`, `image:pexels`, `research:api.openalex.org`. */
export function providerOfBreaker(name: string): ProviderId | null {
  if (isProviderId(name)) return name;
  if (name.startsWith("image:")) {
    const id = name.slice("image:".length);
    if (id === "openai") return "openai-image";
    return isProviderId(id) ? id : null;
  }
  if (name === "research:api.openalex.org") return "openalex";
  if (name === "research:www.googleapis.com") return "googlebooks";
  return null;
}

function breakerOf(id: ProviderId, system: AdminSystemBody): AdminProviderItem["breaker"] {
  let worst: AdminProviderItem["breaker"] = null;
  for (const b of system.breakers) {
    if (b.stale || b.state === "closed" || providerOfBreaker(b.name) !== id) continue;
    if (b.state === "open" || worst === null) worst = { state: b.state, openUntil: b.openUntil };
  }
  return worst;
}

function toItem(id: ProviderId, row: DbRow | undefined, ctx: ItemCtx): AdminProviderItem {
  const def = providerDef(id)!;
  const meta = PROVIDER_META[id];
  const enabled = row?.enabled ?? true;
  const hasDbKey = Boolean(row?.key_ciphertext);
  const unreadable = hasDbKey && !isReadable(id, row!.key_ciphertext!);
  const envPresent = hasEnvKey(id);
  const keySource = !enabled ? "none" : hasDbKey && !unreadable ? "db" : envPresent ? "env" : "none";
  // Azure Speech is a key plus a region: without the region it cannot synthesise.
  const usable = keySource !== "none" && (id !== "azure" || Boolean(azureRegion()));
  return {
    id,
    label: def.label,
    kinds: def.kinds,
    implemented: def.implemented,
    testable: def.testable,
    keyFormat: def.keyHint,
    enabled,
    hasDbKey,
    keyHint: ctx.showHint && hasDbKey ? (row!.key_hint ?? null) : null,
    envPresent,
    keySource,
    unreadable,
    updatedBy: row ? (row.updated_by_name?.trim() || null) : null,
    updatedAt: row ? new Date(row.updated_at).toISOString() : null,
    usable,
    billing: meta.billing,
    priceNote: meta.priceNote,
    role: meta.role,
    need: meta.need,
    keyUrl: meta.keyUrl,
    purposes: PURPOSES.filter((pu) => pu.providers.includes(id) || pu.premium.includes(id)).map((pu) => pu.id),
    breaker: breakerOf(id, ctx.system),
    usage: ctx.usage.byProvider[id],
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

type HeartbeatRow = { process_id: string; role: string; last_seen_at: Date | string; breakers: unknown; limiters: unknown };

/** Processes, circuit breakers and concurrency limiters from the heartbeats (what `/admin/ai` used to show). */
async function readSystem(nowMs: number): Promise<AdminSystemBody> {
  const beats = await query<HeartbeatRow>(
    `SELECT process_id, role, last_seen_at, breakers, limiters FROM process_heartbeats ORDER BY process_id LIMIT 200`,
  );
  const out: AdminSystemBody = { processes: [], breakers: [], limiters: [] };
  for (const b of beats) {
    const stale = isStale(b.last_seen_at, nowMs);
    out.processes.push({ process: b.process_id, role: b.role === "worker" ? "worker" : "web", lastSeenAt: new Date(b.last_seen_at).toISOString(), stale });
    out.breakers.push(...parseBreakers(b.breakers, b.process_id, stale));
    out.limiters.push(...parseLimiters(b.limiters, b.process_id, stale));
  }
  return out;
}

type RouteRow = { route: string; updated_at: Date | string; updated_by_name: string | null };

async function readRouteRows(): Promise<Map<string, RouteRow>> {
  const rows = await query<RouteRow>(
    `SELECT r.route, r.updated_at, u.name AS updated_by_name
       FROM ai_routes r
       LEFT JOIN admin_accounts a ON a.id = r.updated_by
       LEFT JOIN users u ON u.id = a.user_id`,
  );
  return new Map(rows.map((r) => [r.route, r]));
}

function entryState(e: RouteEntry, items: ReadonlyMap<string, AdminProviderItem>): AdminRouteEntryState {
  const it = items.get(e.provider);
  return { ...e, label: it?.label ?? e.provider, usable: it?.usable ?? false };
}

function routeItem(id: RouteId, items: ReadonlyMap<string, AdminProviderItem>, rows: ReadonlyMap<string, RouteRow>): AdminRouteItem {
  const spec = ROUTE_SPECS[id];
  const info = ROUTE_INFO[id];
  const eff = effectiveRoute(id);
  const row = eff.source === "db" ? rows.get(id) : undefined;
  return {
    id,
    title: info.title,
    help: info.help,
    shape: spec.shape,
    max: spec.max,
    providers: spec.providers.map((p) => ({ id: p, label: providerDef(p)?.label ?? p })),
    models: modelOptions(id),
    source: eff.source,
    entries: eff.entries.map((e) => entryState(e, items)),
    fallbackEntries: effectiveRoute(id, process.env, { ignoreStored: true }).entries.map((e) => entryState(e, items)),
    updatedBy: row ? (row.updated_by_name?.trim() || null) : null,
    updatedAt: row ? new Date(row.updated_at).toISOString() : null,
  };
}

async function buildPurposes(items: ReadonlyMap<string, AdminProviderItem>, rows: ReadonlyMap<string, RouteRow>): Promise<AdminPurposeItem[]> {
  const out: AdminPurposeItem[] = [];
  for (const pu of PURPOSES) {
    const usable = pu.providers.filter((id) => {
      const it = items.get(id);
      if (!it?.usable) return false;
      // Gemini voices are a preview model that stays off until TTS_GEMINI_MODEL is set.
      if (pu.id === "tts" && id === "gemini") return Boolean(geminiTtsModel());
      return true;
    });
    const labelOf = (id: ProviderId) => items.get(id)?.label ?? id;
    let v = purposeVerdict(pu, usable, labelOf);
    let setting: AdminPurposeItem["setting"] = null;
    if (pu.setting) {
      const enabled = (await getSetting(pu.setting.key as "video.enabled")) === true;
      setting = { key: pu.setting.key, label: pu.setting.label, enabled };
      if (!enabled) {
        v = {
          verdict: "off",
          headline: "Sozlamalarda o'chirilgan",
          detail: usable.length > 0 ? `Provayder tayyor, lekin «${pu.setting.label}» o'chiq — foydalanuvchiga ko'rinmaydi.` : v.detail,
        };
      }
    }
    out.push({
      id: pu.id,
      title: pu.title,
      summary: pu.summary,
      need: pu.need,
      minimum: pu.minimum,
      fallback: pu.fallback,
      providerIds: [...pu.providers],
      premiumIds: [...pu.premium],
      verdict: v.verdict,
      headline: v.headline,
      detail: v.detail,
      setting,
      routes: pu.routes.map((r) => routeItem(r, items, rows)),
    });
  }
  return out;
}

/** Every registry provider and purpose with its stored state, usage and health. `role` decides whether the masked hint is included. */
export async function listAdminProviders(role: string, now: Date = new Date()): Promise<AdminProvidersBody> {
  await ensureProviderKeys();
  const [rows, routeRows, usage, system, rate] = await Promise.all([readRows(), readRouteRows(), providerUsage(now), readSystem(now.getTime()), soumPerUsd()]);
  const ctx: ItemCtx = { showHint: can(role, "settings.edit"), usage, system };
  const items = PROVIDERS.map((p) => toItem(p.id, rows.get(p.id), ctx));
  const byId = new Map<string, AdminProviderItem>(items.map((i) => [i.id, i]));
  return {
    items,
    purposes: await buildPurposes(byId, routeRows),
    system,
    otherUsage: usage.other,
    total30: usage.total30,
    soumPerUsd: rate,
    generatedAt: now.toISOString(),
    canStoreKeys: sealingKeySource() !== "none",
    sealingKey: sealingKeySource(),
    propagationSec: Math.round(PROVIDER_CACHE_TTL_MS / 1000),
  };
}

async function itemOf(id: ProviderId, role: string): Promise<AdminProviderItem> {
  const now = new Date();
  const [rows, usage, system] = await Promise.all([readRows(), providerUsage(now), readSystem(now.getTime())]);
  return toItem(id, rows.get(id), { showHint: can(role, "settings.edit"), usage, system });
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

/* ───────────────────────────── routing slots ───────────────────────────── */

const ROUTE_NOT_FOUND = () => new ApiError("Bunday sozlama yo'q", 404, { code: "not_found" });

/** Unknown slot id -> 404 with the house `not_found` code. */
export function requireRouteId(raw: unknown): RouteId {
  if (!isRouteId(raw)) throw ROUTE_NOT_FOUND();
  return raw;
}

async function routeItemOf(id: RouteId, role: string): Promise<AdminRouteItem> {
  const now = new Date();
  const [rows, routeRows, usage, system] = await Promise.all([readRows(), readRouteRows(), providerUsage(now), readSystem(now.getTime())]);
  const ctx: ItemCtx = { showHint: can(role, "settings.edit"), usage, system };
  const items = new Map<string, AdminProviderItem>(PROVIDERS.map((p) => [p.id, toItem(p.id, rows.get(p.id), ctx)]));
  return routeItem(id, items, routeRows);
}

async function lockRoute(client: Client, id: string): Promise<RouteEntry[] | null> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`ai_routes:${id}`]);
  const r = await client.query<{ entries: unknown }>("SELECT entries FROM ai_routes WHERE route = $1", [id]);
  if (!r.rows[0]) return null;
  const check = isRouteId(id) ? checkRoute(id, r.rows[0].entries) : null;
  return check?.ok ? check.entries : [];
}

const sameEntries = (a: readonly RouteEntry[], b: readonly RouteEntry[]): boolean =>
  a.length === b.length && a.every((e, i) => e.provider === b[i].provider && (e.model ?? null) === (b[i].model ?? null));

/**
 * PUT `{entries, reason}`: stores the admin's choice for a routing slot. The entries are validated against the
 * slot's spec (allowed providers, models of the price book, no duplicates); 409 `state` when they equal what is
 * stored. One transaction with its audit row, serialised per slot by an advisory lock; the local snapshot reloads
 * after COMMIT, the other process within the TTL.
 */
export async function setAdminRoute(admin: AdminActor, rawId: unknown, body: Record<string, unknown>): Promise<AdminRouteItem> {
  const id = requireRouteId(rawId);
  const reason = parseReason(body.reason)!;
  const check = checkRoute(id, body.entries);
  if (!check.ok) throw new ApiError(check.error, 400, { code: "route_invalid" });
  await adminTx(admin, async (client, audit) => {
    const before = await lockRoute(client, id);
    if (before && sameEntries(before, check.entries)) throw new ApiError("Bu tanlov allaqachon saqlangan", 409, { code: "state" });
    await client.query(
      `INSERT INTO ai_routes (route, entries, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (route) DO UPDATE SET entries = EXCLUDED.entries, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [id, JSON.stringify(check.entries), admin.id],
    );
    await audit({
      action: "routes.set",
      targetType: "route",
      targetId: id,
      reason,
      before: { entries: before },
      after: { entries: check.entries },
    });
  });
  await reloadProviderKeys();
  return routeItemOf(id, admin.role);
}

/** DELETE `{reason}`: removes the admin's choice; the env value (else the built-in default) applies again. 409 `state` when none is stored. */
export async function resetAdminRoute(admin: AdminActor, rawId: unknown, body: Record<string, unknown>): Promise<AdminRouteItem> {
  const id = requireRouteId(rawId);
  const reason = parseReason(body.reason)!;
  await adminTx(admin, async (client, audit) => {
    const before = await lockRoute(client, id);
    if (before === null) throw new ApiError("Bu sozlama allaqachon standart holatda", 409, { code: "state" });
    await client.query("DELETE FROM ai_routes WHERE route = $1", [id]);
    await audit({
      action: "routes.reset",
      targetType: "route",
      targetId: id,
      reason,
      before: { entries: before },
      after: { entries: null },
    });
  });
  await reloadProviderKeys();
  return routeItemOf(id, admin.role);
}
