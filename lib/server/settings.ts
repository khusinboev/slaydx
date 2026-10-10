import "server-only";
import type { PoolClient } from "pg";
import { soumPerUsd } from "../generation/llm-pricing";
import { TOOL_BY_ID } from "../tools";
import type { ToolId } from "../types";
import { ApiError } from "./api";
import { query } from "./db";
import { env } from "./env";
import { toJsonb } from "./jsonb";
import { log } from "./log";
import { PAYMENT_BONUS_DEFAULT, PAYMENT_BONUS_MAX, PAYMENT_BONUS_MIN } from "../payment-bonus";

/**
 * Runtime settings (docs/admin/02-plan.md §6.10, §17.7).
 *
 * A small typed catalog of flags the admin can change without a deploy. The
 * effective value of a key is the `app_settings` row when one exists,
 * otherwise the env value (or the code default for keys without an env var).
 * With no rows every value equals what the product used before this module,
 * so behavior is unchanged until an admin writes an override.
 *
 * Reads go through a 15 s per-process cache of ALL rows (one query). A write
 * invalidates the cache of the process that made it (the caller runs
 * `invalidateSettingsCache()` after COMMIT); other processes see the change
 * within 15 s. A failing read never fails product code: it logs and falls
 * back to the last good snapshot, or to env/default values.
 */

/** Value type of every key — the single source of truth for `SettingKey`. */
export type SettingValues = {
  "free_llm.disabled": boolean;
  "free_llm.daily.outline": number;
  "free_llm.daily.udk": number;
  "free_llm.daily.rewrite": number;
  "free_llm.daily.polish": number;
  "free_llm.daily.global": number;
  "generation.paused": boolean;
  "generation.paused_tools": ToolId[];
  "admin.wallet_confirm_threshold": number;
  "finance.soum_per_usd": number;
  payment_bonus_percent: number;
  "pricing.target_markup": number;
  "pricing.payment_fee_percent": number;
};

export type SettingKey = keyof SettingValues;

export type SettingType = "bool" | "int" | "number" | "tool_ids";

/** Where an effective value comes from. */
export type SettingSource = "db" | "env" | "default";

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export type SettingDef<K extends SettingKey = SettingKey> = {
  key: K;
  /** Uzbek card title on the settings page. */
  group: string;
  label: string;
  description: string;
  type: SettingType;
  /** Inclusive bounds for numeric types (shown in the edit dialog). */
  min?: number;
  max?: number;
  /** Env variable behind the default, when there is one. */
  envVar?: string;
  /** Strict check of an admin-supplied value; returns the normalized value. */
  validate(raw: unknown): Validation<SettingValues[K]>;
  /** Value used when no DB row exists (env, or the code default). */
  envDefault(): SettingValues[K];
};

/** Upper bound for plain counters: generous, but stops a typo like 1e15. */
const INT_MAX = 1_000_000_000;

function boolValidator(raw: unknown): Validation<boolean> {
  return typeof raw === "boolean" ? { ok: true, value: raw } : { ok: false, error: "Qiymat true yoki false bo'lishi kerak" };
}

function intValidator(min: number, max: number) {
  return (raw: unknown): Validation<number> => {
    if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
      return { ok: false, error: "Qiymat butun son bo'lishi kerak" };
    }
    if (raw < min || raw > max) {
      return { ok: false, error: `Qiymat ${min} dan ${max} gacha bo'lishi kerak` };
    }
    return { ok: true, value: raw };
  };
}

function numberValidator(min: number, max: number) {
  return (raw: unknown): Validation<number> => {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return { ok: false, error: "Qiymat son bo'lishi kerak" };
    }
    if (raw < min || raw > max) {
      return { ok: false, error: `Qiymat ${min} dan ${max} gacha bo'lishi kerak` };
    }
    return { ok: true, value: raw };
  };
}

/**
 * A number on a fixed grid (`step`) inside `[min, max]`: the stored value is
 * snapped to the grid and cleaned of float noise (0.1 × 3 → 0.3, not
 * 0.30000000000000004), so what the admin typed is what is stored.
 */
function stepNumberValidator(min: number, max: number, step: number) {
  const inRange = numberValidator(min, max);
  return (raw: unknown): Validation<number> => {
    const checked = inRange(raw);
    if (!checked.ok) return checked;
    const n = checked.value / step;
    if (Math.abs(n - Math.round(n)) > 1e-9) {
      return { ok: false, error: `Qiymat ${String(step).replace(".", ",")} qadam bilan bo'lishi kerak` };
    }
    return { ok: true, value: Number((Math.round(n) * step).toFixed(6)) };
  };
}

/** Registry order, so a stored list is stable regardless of input order. */
const TOOL_ORDER: readonly ToolId[] = Object.keys(TOOL_BY_ID) as ToolId[];

function isToolId(v: unknown): v is ToolId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TOOL_BY_ID, v);
}

function toolIdsValidator(raw: unknown): Validation<ToolId[]> {
  if (!Array.isArray(raw)) return { ok: false, error: "Qiymat vositalar ro'yxati bo'lishi kerak" };
  if (raw.length > TOOL_ORDER.length * 2) return { ok: false, error: "Ro'yxat juda uzun" };
  const unknownIds = raw.filter((v) => !isToolId(v));
  if (unknownIds.length) {
    const shown = unknownIds.slice(0, 5).map((v) => String(v).slice(0, 40)).join(", ");
    return { ok: false, error: `Noma'lum vosita: ${shown}` };
  }
  const set = new Set(raw as ToolId[]);
  return { ok: true, value: TOOL_ORDER.filter((id) => set.has(id)) };
}

/** `soumPerUsd()` may return a fraction from env; the setting is an integer. */
function soumPerUsdDefault(): number {
  return Math.max(1, Math.round(soumPerUsd()));
}

const FREE_GROUP = "Bepul AI";
const GEN_GROUP = "Generatsiya";
const FIN_GROUP = "Moliya";
const PRICING_GROUP = "Narxlar";

type DailyKey = "free_llm.daily.outline" | "free_llm.daily.udk" | "free_llm.daily.rewrite" | "free_llm.daily.polish";

function dailyCap<K extends DailyKey>(key: K, label: string, envVar: string, read: () => number): SettingDef<K> {
  return {
    key,
    group: FREE_GROUP,
    label,
    description: "Bitta foydalanuvchi uchun kunlik urinishlar soni (Toshkent kuni). 0 — bu amal bepul ishlamaydi.",
    type: "int",
    min: 0,
    max: INT_MAX,
    envVar,
    validate: intValidator(0, INT_MAX),
    envDefault: read,
  };
}

type Catalog = { [K in SettingKey]: SettingDef<K> };

const CATALOG: Catalog = {
  "free_llm.disabled": {
    key: "free_llm.disabled",
    group: FREE_GROUP,
    label: "Bepul AI o'chirilgan",
    description:
      "Yoqilsa reja, UDK, «Tuzatish» va «Hammasini tuzatish» darhol to'xtaydi — provayder chaqirilmaydi.",
    type: "bool",
    envVar: "FREE_LLM_DISABLED",
    validate: boolValidator,
    envDefault: () => env.freeLlm.disabled,
  },
  "free_llm.daily.outline": dailyCap("free_llm.daily.outline", "Reja: kunlik limit", "FREE_LLM_DAILY_OUTLINE", () => env.freeLlm.dailyOutline),
  "free_llm.daily.udk": dailyCap("free_llm.daily.udk", "UDK: kunlik limit", "FREE_LLM_DAILY_UDK", () => env.freeLlm.dailyUdk),
  "free_llm.daily.rewrite": dailyCap("free_llm.daily.rewrite", "«Tuzatish»: kunlik limit", "FREE_LLM_DAILY_REWRITE", () => env.freeLlm.dailyRewrite),
  "free_llm.daily.polish": dailyCap("free_llm.daily.polish", "«Hammasini tuzatish»: kunlik limit", "FREE_LLM_DAILY_POLISH", () => env.freeLlm.dailyPolish),
  "free_llm.daily.global": {
    key: "free_llm.daily.global",
    group: FREE_GROUP,
    label: "Umumiy kunlik limit",
    description: "Barcha foydalanuvchilar bo'yicha kunlik birliklar (vazn bilan) — bepul AI xarajatining shifti.",
    type: "int",
    min: 0,
    max: INT_MAX,
    envVar: "FREE_LLM_DAILY_GLOBAL",
    validate: intValidator(0, INT_MAX),
    envDefault: () => env.freeLlm.dailyGlobal,
  },
  "generation.paused": {
    key: "generation.paused",
    group: GEN_GROUP,
    label: "Barcha generatsiyalar to'xtatilgan",
    description: "Yoqilsa yangi generatsiya qabul qilinmaydi (pul yechilmasdan). Navbatdagi ishlar davom etadi.",
    type: "bool",
    validate: boolValidator,
    envDefault: () => false,
  },
  "generation.paused_tools": {
    key: "generation.paused_tools",
    group: GEN_GROUP,
    label: "To'xtatilgan vositalar",
    description: "Faqat shu vositalar uchun yangi generatsiya qabul qilinmaydi (pul yechilmasdan).",
    type: "tool_ids",
    validate: toolIdsValidator,
    envDefault: () => [],
  },
  "admin.wallet_confirm_threshold": {
    key: "admin.wallet_confirm_threshold",
    group: FIN_GROUP,
    label: "Hamyon tuzatishini tasdiqlash chegarasi",
    description: "Shu miqdordan katta hamyon tuzatishi uchun admin miqdorni qayta yozib tasdiqlaydi.",
    type: "int",
    min: 0,
    max: INT_MAX,
    validate: intValidator(0, INT_MAX),
    envDefault: () => 1_000_000,
  },
  "finance.soum_per_usd": {
    key: "finance.soum_per_usd",
    group: FIN_GROUP,
    label: "Dollar kursi (so'm)",
    description: "1 AQSh dollari necha so'm — AI xarajati va marjani hisoblash uchun (faqat admin hisobotlari).",
    type: "int",
    min: 1,
    max: 1_000_000,
    envVar: "SOUM_PER_USD",
    validate: intValidator(1, 1_000_000),
    envDefault: soumPerUsdDefault,
  },
  payment_bonus_percent: {
    key: "payment_bonus_percent",
    group: FIN_GROUP,
    label: "To'lov bonusi (%)",
    description:
      "Har bir to'langan to'ldirishga shu foiz bonus ball qo'shiladi (har qanday summa, shiftsiz). 0 — bonus o'chirilgan. Yangi qiymat faqat keyingi to'lovlarga qo'llanadi.",
    type: "int",
    min: PAYMENT_BONUS_MIN,
    max: PAYMENT_BONUS_MAX,
    validate: intValidator(PAYMENT_BONUS_MIN, PAYMENT_BONUS_MAX),
    envDefault: () => PAYMENT_BONUS_DEFAULT,
  },
  "pricing.target_markup": {
    key: "pricing.target_markup",
    group: PRICING_GROUP,
    label: "Maqsadli ustama (×)",
    description: "Narx tavsiyasi shu ustamaga intiladi: o'rtacha narx ÷ to'liq xarajat.",
    type: "number",
    min: 1,
    max: 20,
    validate: numberValidator(1, 20),
    envDefault: () => 3,
  },
  "pricing.payment_fee_percent": {
    key: "pricing.payment_fee_percent",
    group: PRICING_GROUP,
    label: "To'lov komissiyasi (%)",
    description:
      "To'lov tizimi (Click va h.k.) har bir tushumdan oladigan foiz, qadam 0,1. «Narxlar» sahifasidagi marja hisobida tushumdan shuncha foiz ayriladi. 0 — hisobga olinmaydi.",
    type: "number",
    min: 0,
    max: 10,
    validate: stepNumberValidator(0, 10, 0.1),
    envDefault: () => 0,
  },
};

/** Catalog order = display order. */
export const SETTING_KEYS: readonly SettingKey[] = Object.keys(CATALOG) as SettingKey[];

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(CATALOG, key);
}

export function settingDef<K extends SettingKey>(key: K): SettingDef<K> {
  return CATALOG[key] as SettingDef<K>;
}

/** Validates an admin-supplied value for `key` (no DB access). */
export function validateSetting<K extends SettingKey>(key: K, raw: unknown): Validation<SettingValues[K]> {
  return settingDef(key).validate(raw);
}

/** Source of the fallback value: the env var is set, or only the code default applies. */
function fallbackSource(def: SettingDef): SettingSource {
  return def.envVar && (process.env[def.envVar] ?? "").trim() !== "" ? "env" : "default";
}

/**
 * Stored rows are re-validated on read: a row edited by hand, or a tool id
 * removed from the registry later, must not break product code. Unknown tool
 * ids are dropped from a stored list (the rest of the override still applies);
 * any other invalid row is ignored in favour of the env/default value.
 */
function parseStored<K extends SettingKey>(key: K, raw: unknown): Validation<SettingValues[K]> {
  const def = settingDef(key);
  const input = def.type === "tool_ids" && Array.isArray(raw) ? raw.filter(isToolId) : raw;
  return def.validate(input);
}

// ---------------------------------------------------------------------------
// Cache

type Row = { key: string; value: unknown; updated_by: string | null; updated_at: Date };

/** Validated effective overrides by key (rows that failed validation are left out). */
type Snapshot = Map<SettingKey, unknown>;

type Cache = {
  values: Snapshot | null;
  /** Epoch ms after which the snapshot is reloaded. */
  expiresAt: number;
  /** Bumped by `invalidateSettingsCache`; a load started earlier is discarded. */
  version: number;
  inflight: Promise<Snapshot | null> | null;
};

const TTL_MS = 15_000;
/** After a failed load: retry no sooner than this (do not hammer a sick DB). */
const ERROR_RETRY_MS = 5_000;

// On globalThis: Next dev reloads modules, and a second module instance must
// share the snapshot that `invalidateSettingsCache` clears.
const g = globalThis as typeof globalThis & { __slaydxSettingsCache?: Cache };

function cache(): Cache {
  return (g.__slaydxSettingsCache ??= { values: null, expiresAt: 0, version: 0, inflight: null });
}

/** Rows are validated once per load, so a bad row logs every 15 s, not per request. */
function toSnapshot(rows: Row[]): Snapshot {
  const out: Snapshot = new Map();
  for (const r of rows) {
    if (!isSettingKey(r.key)) continue; // a key removed from the catalog: ignored
    const parsed = parseStored(r.key, r.value);
    if (parsed.ok) out.set(r.key, parsed.value);
    else log("warn", "[settings] bazadagi qiymat yaroqsiz — env/standart ishlatiladi", { setting: r.key, error: parsed.error });
  }
  return out;
}

async function loadSnapshot(): Promise<Snapshot | null> {
  const c = cache();
  // Fresh snapshot, or backing off after an error (then `values` may be null).
  if (Date.now() < c.expiresAt) return c.values;
  if (c.inflight) return c.inflight;
  const version = c.version;
  const p: Promise<Snapshot | null> = query<Row>("SELECT key, value, updated_by, updated_at FROM app_settings").then(
    (rows) => {
      const snap = toSnapshot(rows);
      if (c.version === version) {
        c.values = snap;
        c.expiresAt = Date.now() + TTL_MS;
      }
      return snap;
    },
    (err: unknown) => {
      log("warn", "[settings] o'qib bo'lmadi — oxirgi qiymatlar yoki env ishlatiladi", { err });
      if (c.version === version) c.expiresAt = Date.now() + ERROR_RETRY_MS;
      return c.values;
    },
  );
  c.inflight = p;
  void p.finally(() => {
    if (c.inflight === p) c.inflight = null;
  });
  return p;
}

/**
 * Drops the snapshot freshness so the next read reloads. Call after the
 * transaction that wrote `app_settings` has committed. The last snapshot is
 * kept only as the fallback for a failing reload.
 */
export function invalidateSettingsCache(): void {
  const c = cache();
  c.version++;
  c.expiresAt = 0;
  c.inflight = null;
}

function effective<K extends SettingKey>(key: K, row: Row | undefined): { value: SettingValues[K]; source: SettingSource } {
  const def = settingDef(key);
  if (row) {
    const parsed = parseStored(key, row.value);
    if (parsed.ok) return { value: parsed.value, source: "db" };
  }
  return { value: def.envDefault(), source: fallbackSource(def) };
}

/** Effective value of `key`. Never throws because of the database. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValues[K]> {
  const snap = await loadSnapshot();
  if (snap?.has(key)) {
    const v = snap.get(key) as SettingValues[K];
    // A copy, so a caller cannot mutate the shared snapshot.
    return (Array.isArray(v) ? [...v] : v) as SettingValues[K];
  }
  return settingDef(key).envDefault();
}

/**
 * Effective value of `key` read inside the caller's transaction straight from
 * `app_settings` (no cache, no lock). A money path that must apply the value in
 * force at that moment — not a snapshot up to 15 s old — uses this
 * (`payment-bonus.ts`). An invalid row falls back to env/default, as on reads.
 */
export async function getSettingInTx<K extends SettingKey>(client: Pick<PoolClient, "query">, key: K): Promise<SettingValues[K]> {
  const res = await client.query<Row>("SELECT key, value, updated_by, updated_at FROM app_settings WHERE key = $1", [key]);
  return effective(key, res.rows[0]).value;
}

// ---------------------------------------------------------------------------
// Admin listing and writes

export type SettingItem<K extends SettingKey = SettingKey> = {
  key: K;
  group: string;
  label: string;
  description: string;
  type: SettingType;
  min: number | null;
  max: number | null;
  value: SettingValues[K];
  source: SettingSource;
  /** What applies without a DB override (env value, or the code default). */
  envValue: SettingValues[K];
  /** `admin_accounts.id` of the last writer (null when no row, or the admin was removed). */
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
};

type ListRow = Row & { updated_by_name: string | null };

/**
 * Every catalog key with its effective value and provenance. Reads the DB
 * directly (not the cache) so the admin page is always current; a DB error
 * propagates here — the admin should see it, not stale data.
 */
export async function listSettings(): Promise<SettingItem[]> {
  const rows = await query<ListRow>(
    `SELECT s.key, s.value, s.updated_by, s.updated_at, u.name AS updated_by_name
       FROM app_settings s
       LEFT JOIN admin_accounts a ON a.id = s.updated_by
       LEFT JOIN users u ON u.id = a.user_id`,
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SETTING_KEYS.map((key) => {
    const def = settingDef(key);
    const row = byKey.get(key);
    const eff = effective(key, row);
    const fromDb = eff.source === "db" && row;
    return {
      key,
      group: def.group,
      label: def.label,
      description: def.description,
      type: def.type,
      min: def.min ?? null,
      max: def.max ?? null,
      value: eff.value,
      source: eff.source,
      envValue: def.envDefault(),
      updatedBy: fromDb ? (row.updated_by ?? null) : null,
      updatedByName: fromDb ? (row.updated_by_name ?? null) : null,
      updatedAt: fromDb ? new Date(row.updated_at).toISOString() : null,
    };
  });
}

/** Audit snapshot (§8): only the value and its provenance, never more. */
export type SettingSnapshot<K extends SettingKey = SettingKey> = { value: SettingValues[K]; source: SettingSource };

function requireKey(key: string): SettingKey {
  if (!isSettingKey(key)) throw new ApiError("Bunday sozlama yo'q", 404);
  return key;
}

async function snapshotInTx<K extends SettingKey>(client: PoolClient, key: K): Promise<SettingSnapshot<K>> {
  const res = await client.query<Row>(
    "SELECT key, value, updated_by, updated_at FROM app_settings WHERE key = $1 FOR UPDATE",
    [key],
  );
  return effective(key, res.rows[0]);
}

/**
 * Validates and stores an override inside the caller's transaction and
 * returns before/after snapshots for the audit row. Throws `ApiError` 404 for
 * an unknown key and 400 for an invalid value. The caller must call
 * `invalidateSettingsCache()` after COMMIT.
 */
export async function setSettingInTx(
  client: PoolClient,
  key: string,
  rawValue: unknown,
  adminId: string | number | null,
): Promise<{ key: SettingKey; before: SettingSnapshot; after: SettingSnapshot }> {
  const k = requireKey(key);
  const checked = validateSetting(k, rawValue);
  if (!checked.ok) throw new ApiError(checked.error, 400);
  const before = await snapshotInTx(client, k);
  await client.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [k, toJsonb(checked.value), adminId === null ? null : String(adminId)],
  );
  return { key: k, before, after: { value: checked.value, source: "db" } };
}

/**
 * Removes the override (back to env/default) inside the caller's transaction.
 * Same contract as `setSettingInTx`; resetting a key without a row is a no-op
 * whose before and after are equal.
 */
export async function resetSettingInTx(
  client: PoolClient,
  key: string,
): Promise<{ key: SettingKey; before: SettingSnapshot; after: SettingSnapshot }> {
  const k = requireKey(key);
  const before = await snapshotInTx(client, k);
  await client.query("DELETE FROM app_settings WHERE key = $1", [k]);
  return { key: k, before, after: effective(k, undefined) };
}
