"use client";

import { adminGet, adminSend, type AdminCallOptions } from "./core";

/**
 * Runtime settings API (docs/admin/02-plan.md §6.10). Thin typed wrappers over
 * `core.ts` (AbortSignal, 401 `reauth` step-up + one retry, 403/404 classes).
 *
 * Types are declared here, not imported from `lib/server/**` (admin client
 * code must not reach server modules, tests/admin-boundary.test.mts).
 */

export type SettingSource = "db" | "env" | "default";
export type SettingType = "bool" | "int" | "number" | "tool_ids";

type SettingBase = {
  key: string;
  label: string;
  description: string;
  /** Uzbek card title (Bepul AI, Generatsiya, ...). */
  group: string;
  /** Inclusive bounds of numeric settings (`null` for other types). */
  min: number | null;
  max: number | null;
  source: SettingSource;
  /** Display name of the admin who wrote the DB override (`null` without one). */
  updatedBy: string | null;
  /** ISO timestamp of that write. */
  updatedAt: string | null;
};

/** One setting; `value` and `envValue` follow `type`. */
export type SettingItem = SettingBase &
  (
    | { type: "bool"; value: boolean; envValue: boolean }
    | { type: "int" | "number"; value: number; envValue: number }
    | { type: "tool_ids"; value: string[]; envValue: string[] }
  );

/** The value a write sends: boolean, number or a list of tool ids. */
export type SettingValue = boolean | number | string[];

export function listSettings(opts: AdminCallOptions = {}): Promise<{ items: SettingItem[] }> {
  return adminGet<{ items: SettingItem[] }>("/api/admin/settings", undefined, opts);
}

function pathOf(key: string): string {
  return `/api/admin/settings/${encodeURIComponent(key)}`;
}

/** Overrides one setting (needs a fresh step-up; the core asks for it). */
export function updateSetting(key: string, value: SettingValue, reason: string, opts: AdminCallOptions = {}): Promise<{ item: SettingItem }> {
  return adminSend<{ item: SettingItem }>("PUT", pathOf(key), { value, reason }, opts);
}

/** Removes the override: the setting returns to its env/default value. */
export function resetSetting(key: string, reason: string, opts: AdminCallOptions = {}): Promise<{ item: SettingItem }> {
  return adminSend<{ item: SettingItem }>("DELETE", pathOf(key), { reason }, opts);
}
